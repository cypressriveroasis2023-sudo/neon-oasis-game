import {test,expect} from '@playwright/test';
import {mountTransfers,IT,SERVICE} from './helpers/transfer-fixture.mjs';
let f;
test.afterEach(async({page})=>{await page.close();await f?.close();f=null;});
for(const rollout of ['missing','disabled','missing-submit','reports-held']){
 test('IT phone keeps Camera Health usable when transfer backend is '+rollout,async({page},info)=>{
  await page.setViewportSize({width:390,height:844});f=await mountTransfers(page,{rollout});
  await expect(page.getByRole('region',{name:'Equipment handoff availability'})).toContainText('Camera Health remains available');
  const frame=page.frameLocator('#cosITDailyFrame');await expect(frame.getByRole('region',{name:'Camera Health',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Check Out / Hand Off',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Check In / Return',exact:true})).toHaveCount(0);
  await expect(page.locator('#legacy')).toBeHidden();await expect(frame.locator('nav[aria-label="COS Operations"]')).toHaveText('Camera Health');
  expect(f.calls.filter(c=>['techcheck_transfer_context_v1','submit_techcheck_transfer_v1'].includes(c.name))).toHaveLength(0);
  expect(f.paths.size).toBe(0);expect(f.errors).toEqual([]);
  if(rollout==='missing')await page.screenshot({path:info.outputPath('IT-phone-backend-unavailable.png'),fullPage:true});
 });
 test('Service morning form is preserved when transfer backend is '+rollout,async({page},info)=>{
  f=await mountTransfers(page,{role:'service',rollout});
  await expect(page.getByRole('region',{name:'Equipment handoff availability'})).toContainText('morning form is unchanged');
  await expect(page.locator('#existingDailyComplete')).toBeVisible();await expect(page.locator('#existingDailyComplete')).toBeEnabled();
  await expect(page.locator('[data-techcheck-service-transfers]')).toHaveCount(0);
  expect(f.calls.filter(c=>['techcheck_transfer_context_v1','submit_techcheck_transfer_v1'].includes(c.name))).toHaveLength(0);expect(f.errors).toEqual([]);
  if(rollout==='missing')await page.screenshot({path:info.outputPath('Service-backend-unavailable.png'),fullPage:true});
 });
}
test('readiness retry switches to check-in/out only after all server gates pass',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page,{rollout:'reports-held'});
 await expect(page.locator('#cosITDailyFrame')).toBeVisible();
 await f.db.exec('update app_private.techcheck_transfer_settings set reports_ready=true');
 await page.getByRole('button',{name:'Check handoff availability',exact:true}).click();
 await expect(page.getByRole('button',{name:'Check Out / Hand Off',exact:true})).toBeVisible();await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
 expect(f.calls.filter(c=>c.name==='submit_techcheck_transfer_v1')).toHaveLength(0);expect(f.errors).toEqual([]);
});
test('desktop never probes or mounts transfers even when backend is missing',async({page})=>{
 await page.setViewportSize({width:1440,height:900});f=await mountTransfers(page,{rollout:'missing'});
 await expect(page.frameLocator('#cosITDailyFrame').getByRole('region',{name:'Camera Health',exact:true})).toBeVisible();
 expect(f.calls.some(c=>c.name?.startsWith('techcheck_transfer'))).toBe(false);expect(f.errors).toEqual([]);
});
test('schema-cache mismatch after a successful probe returns IT to Camera Health',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page,{rollout:'read-cache-missing'});
 await expect(page.getByRole('region',{name:'Equipment handoff availability'})).toContainText('not installed');
 await expect(page.frameLocator('#cosITDailyFrame').getByRole('region',{name:'Camera Health',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Check Out / Hand Off',exact:true})).toHaveCount(0);expect(f.paths.size).toBe(0);expect(f.errors).toEqual([]);
});
test('late readiness after timeout cannot replace the fallback or activate a handoff',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page,{readinessDelay:7000});
 await expect(page.getByRole('region',{name:'Equipment handoff availability'})).toContainText('verified in time');
 await expect(page.frameLocator('#cosITDailyFrame').getByRole('region',{name:'Camera Health',exact:true})).toBeVisible();
 await page.waitForTimeout(1200);
 await expect(page.getByRole('button',{name:'Check Out / Hand Off',exact:true})).toHaveCount(0);
 expect(f.calls.some(c=>c.name==='techcheck_transfer_context_v1')).toBe(false);expect(f.errors).toEqual([]);
});
test('sign-out during readiness removes private views and ignores late success',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page,{readinessDelay:700});
 await expect.poll(()=>f.calls.some(c=>c.name==='techcheck_transfer_readiness_v1')).toBe(true);
 await page.evaluate(()=>logout());await page.waitForTimeout(850);
 await expect(page.locator('#cosITDailyHost')).toHaveCount(0);await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
 expect(f.calls.some(c=>c.name==='techcheck_transfer_context_v1')).toBe(false);expect(f.errors).toEqual([]);
});

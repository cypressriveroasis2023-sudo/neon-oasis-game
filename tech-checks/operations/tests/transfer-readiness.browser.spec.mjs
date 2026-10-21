import {test,expect} from '@playwright/test';
import {mountTransfers,IT,SERVICE} from './helpers/transfer-fixture.mjs';
let f;
test.afterEach(async({page})=>{await page.close();await f?.close();f=null;});
for(const rollout of ['missing','disabled','missing-submit','reports-held']){
 test('IT phone shows disabled handoffs and no camera substitution when transfer backend is '+rollout,async({page},info)=>{
  await page.setViewportSize({width:390,height:844});f=await mountTransfers(page,{rollout});
  await expect(page.getByRole('region',{name:'Equipment handoff availability'})).toContainText('Check Out and Check In remain unavailable');
  await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Equipment Check Out / Check In',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Check Out / Hand Off',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Check In / Return',exact:true})).toBeDisabled();
  await expect(page.locator('#legacy')).toBeHidden();
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
 await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Check Out / Hand Off',exact:true})).toBeDisabled();
 await f.db.exec('update app_private.techcheck_transfer_settings set reports_ready=true');
 await page.getByRole('button',{name:'Check handoff availability',exact:true}).click();
 await expect(page.getByRole('button',{name:'Check Out / Hand Off',exact:true})).toBeEnabled();await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
 expect(f.calls.filter(c=>c.name==='submit_techcheck_transfer_v1')).toHaveLength(0);expect(f.errors).toEqual([]);
});
for (const width of [390, 430]) test('direct Test IT phone stays in held equipment actions without a blank Camera Health frame at '+width,async({page},info)=>{
 await page.setViewportSize({width,height:844});
 f=await mountTransfers(page,{rollout:'missing'});
 await page.evaluate(()=>changeActor('05bf20fe-19f7-4db7-ac05-5b2a5f681fdf'));
 await expect(page.getByRole('region',{name:'Equipment handoff availability'})).toContainText('not installed');
 await expect(page.getByRole('heading',{name:'Equipment Check Out / Check In',exact:true})).toBeVisible();
 for(const name of ['Check Out / Hand Off','Check In / Return']){
  const action=page.getByRole('button',{name,exact:true});
  await expect(action).toBeVisible();await expect(action).toBeDisabled();
 }
 await expect(page.getByRole('button',{name:'Check handoff availability',exact:true})).toBeEnabled();
 await expect(page.locator('iframe')).toHaveCount(0);
 await expect(page.getByText('Camera Health remains available below.')).toHaveCount(0);
 await expect(page.locator('#legacy')).toBeHidden();
 expect(f.calls.every(call=>call.name==='techcheck_transfer_readiness_v1')).toBe(true);
 expect(f.paths.size).toBe(0);expect(f.errors).toEqual([]);
 await page.screenshot({path:info.outputPath('direct-Test-IT-held-phone-'+width+'.png'),fullPage:true});
 await page.evaluate(()=>logout());
 await expect(page.locator('#cosITDailyHost,iframe')).toHaveCount(0);
 expect(f.calls.some(call=>call.name==='submit_techcheck_transfer_v1')).toBe(false);
});
test('desktop never probes or mounts transfers even when backend is missing',async({page})=>{
 await page.setViewportSize({width:1440,height:900});f=await mountTransfers(page,{rollout:'missing'});
 await expect(page.frameLocator('#cosITDailyFrame').getByRole('region',{name:'COS Fleet Dashboard',exact:true})).toBeVisible();
 expect(f.calls.some(c=>c.name?.startsWith('techcheck_transfer'))).toBe(false);expect(f.errors).toEqual([]);
});
test('schema-cache mismatch after a successful probe keeps IT handoffs disabled',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page,{rollout:'read-cache-missing'});
 await expect(page.getByRole('region',{name:'Equipment handoff availability'})).toContainText('not installed');
 await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Check Out / Hand Off',exact:true})).toBeDisabled();expect(f.paths.size).toBe(0);expect(f.errors).toEqual([]);
});
test('late readiness after timeout cannot replace the fallback or activate a handoff',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page,{readinessDelay:7000});
 await expect(page.getByRole('region',{name:'Equipment handoff availability'})).toContainText('verified in time');
 await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
 await page.waitForTimeout(1200);
 await expect(page.getByRole('button',{name:'Check Out / Hand Off',exact:true})).toBeDisabled();
 expect(f.calls.some(c=>c.name==='techcheck_transfer_context_v1')).toBe(false);expect(f.errors).toEqual([]);
});
test('sign-out during readiness removes private views and ignores late success',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page,{readinessDelay:700});
 await expect.poll(()=>f.calls.some(c=>c.name==='techcheck_transfer_readiness_v1')).toBe(true);
 await page.evaluate(()=>logout());await page.waitForTimeout(850);
 await expect(page.locator('#cosITDailyHost')).toHaveCount(0);await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
 expect(f.calls.some(c=>c.name==='techcheck_transfer_context_v1')).toBe(false);expect(f.errors).toEqual([]);
});

test('direct ittech desktop session opens COS Camera Health without the native account linkage',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 f=await mountTransfers(page,{rollout:'missing'});
 await page.route('**/tech-checks/camera-health.html?itDaily=1',route=>route.fulfill({
  contentType:'text/html',
  body:'<!doctype html><html><body><main role="region" aria-label="Camera Health"><h1>Camera Health</h1><p>Authorized synthetic COS session</p></main></body></html>',
 }));
 await page.evaluate(()=>changeActor('05bf20fe-19f7-4db7-ac05-5b2a5f681fdf'));
 await expect(page.locator('#cosITDailyFrame')).toHaveAttribute('src','./camera-health.html?itDaily=1');
 await expect(page.frameLocator('#cosITDailyFrame').getByRole('region',{name:'Camera Health'})).toBeVisible();
 await expect(page.locator('#legacy')).toBeHidden();
 await expect(page.getByText('Daily view access could not be verified')).toHaveCount(0);
 expect(f.calls.filter(call=>call.name?.startsWith('techcheck_transfer'))).toHaveLength(0);
 expect(f.errors).toEqual([]);
});

test('IT phone can explicitly open the same Fleet board and return to handoffs',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page);
 const nav=page.getByRole('navigation',{name:'IT daily views'});
 await nav.getByRole('button',{name:'Fleet map & troubleshooting',exact:true}).click();
 await expect(page.locator('#cosITDailyFrame')).toBeVisible();
 await expect(page.frameLocator('#cosITDailyFrame').getByRole('heading',{name:'Fleet Dashboard',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('IT-phone-shared-fleet.png'),fullPage:true});
 await nav.getByRole('button',{name:'Check out / check in',exact:true}).click();
 await expect(page.getByRole('button',{name:'Check Out / Hand Off',exact:true})).toBeVisible();await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
 expect(f.calls.some(c=>c.name==='submit_techcheck_transfer_v1')).toBe(false);expect(f.errors).toEqual([]);
});
test('IT phone keeps an open handoff form when Fleet is selected',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page);
 await page.getByRole('button',{name:'Check Out / Hand Off',exact:true}).click();
 await page.getByRole('navigation',{name:'IT daily views'}).getByRole('button',{name:'Fleet map & troubleshooting'}).click();
 await expect(page.getByRole('status').filter({hasText:'Finish or close the current handoff form'})).toBeVisible();
 await expect(page.getByLabel('Receiving Service technician')).toBeVisible();await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
 expect(f.calls.some(c=>c.name==='submit_techcheck_transfer_v1')).toBe(false);
});

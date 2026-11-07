import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {statusPinsFixture} from './fixtures/fleet-status-pins-fixture.mjs';
import {nextScheduledFleetRead} from './helpers/scheduled-fleet-read.mjs';

for(const it of [false,true])test(`VISION uses exact Field products and opens existing evidence for ${it?'IT':'Owner'}`,async({page},info)=>{
 const f=statusPinsFixture();
 const {app,state}=await mountFleet(page,it,{field:f.field,health:f.health,productConnections:f.connections,skipInitialFieldCount:true});
 const brief=app.getByRole('region',{name:'VISION Field briefing',exact:true});
 await expect(brief.getByRole('heading',{name:'A clear view of what needs you.'})).toBeVisible();
 await expect(brief.locator('.cos-vision-priority-offline strong')).toHaveText('1');
 // The census fixture includes 280 additional unlinked Field products.
 await expect(brief.locator('.cos-vision-priority-unverified strong')).toHaveText('284');
 await brief.screenshot({path:info.outputPath('vision-field-overview.png')});
 const before=state.calls.length;
 await brief.getByRole('button',{name:/Recorded offline/}).click();
 const queue=brief.getByRole('region',{name:'VISION attention list'});
 await expect(queue.locator('.cos-vision-attention-row')).toHaveCount(1);
 await expect(queue.locator('.cos-vision-attention-row')).toHaveAttribute('aria-label',/Product 1002$/);
 await expect(queue.locator('.cos-vision-attention-row')).toHaveAccessibleDescription(/Observed /);
 await queue.getByRole('button',{name:/Review .* Product 1002$/}).click();
 const drawer=app.getByRole('dialog',{name:f.units[1].unitNumber+' unit intelligence'});
 await expect(drawer).toBeVisible();
 expect(await drawer.evaluate(()=>location.hash)).toContain(f.units[1].id);
 await drawer.getByRole('button',{name:'Close unit details'}).click();
 await brief.getByRole('button',{name:/Needs verification/}).click();
 await expect(queue.locator('.cos-vision-attention-row')).toHaveCount(8);
 await expect(queue.locator('header p')).toContainText('284 Field Product IDs');
 const ids=await queue.locator('.cos-vision-attention-row').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label').match(/Product (\d+)$/)[1]).sort());
 expect(ids).toEqual(['1003','1005','1006','1007','2001','2002','2003','2004']);
 await queue.getByRole('searchbox',{name:'Find in this queue'}).fill('1005');
 await expect(queue.locator('.cos-vision-attention-row')).toHaveCount(1);
 await expect(queue.locator('.cos-vision-attention-row')).toHaveAttribute('aria-label',/Product 1005$/);
 expect(state.calls.slice(before).every(call=>call.method==='GET')).toBe(true);
 expect(state.errors).toEqual([]);
 expect(await brief.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
 await brief.screenshot({path:info.outputPath('vision-field-briefing.png')});
 await queue.getByRole('button',{name:'Close VISION attention list'}).click();
 await expect(brief.getByRole('button',{name:/Needs verification/})).toBeFocused();
});

test('VISION preserves original observation time when the next IT saved read fails',async({page})=>{
 const f=statusPinsFixture();
 const {app,state}=await mountFleet(page,true,{field:f.field,health:f.health,productConnections:f.connections,advancingClock:true,skipInitialFieldCount:true,productionTechnicianUserId:'00000000-0000-4000-8000-000000000010'});
 const brief=app.getByRole('region',{name:'VISION Field briefing'});
 await brief.getByRole('button',{name:/Recorded offline/}).click();
 const observation=brief.locator('.cos-vision-attention-evidence>small:last-child');
 const original=await observation.textContent();expect(original).toMatch(/^Observed /);
 state.fail=true;state.productConnections=null;
 await nextScheduledFleetRead(page,app,state);
 await expect(brief.getByText('Saved results retained',{exact:true})).toBeVisible();
 await expect(brief.locator('.cos-vision-priority-offline strong')).toHaveText('1');
 await expect(observation).toHaveText(original);
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);
 expect(state.errors).toEqual([]);
});

test('VISION does not invent counts without a verified Field source',async({page})=>{
 const f=statusPinsFixture();delete f.field.uploadInventory;
 const {app,state}=await mountFleet(page,true,{field:f.field,health:f.health,skipInitialFieldCount:true,failHealth:true});
 const brief=app.getByRole('region',{name:'VISION Field briefing'});
 await expect(brief.locator('.cos-vision-priority strong')).toHaveText(['—','—','—']);
 for(const button of await brief.locator('.cos-vision-priority').all())await expect(button).toBeDisabled();
 await expect(brief.getByRole('status')).toContainText('saved Field inventory is verified');
 await expect(brief.getByText('Awaiting saved fleet readings',{exact:true})).toBeVisible();
 await expect(brief.getByText('Saved results retained',{exact:true})).toHaveCount(0);
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);
});

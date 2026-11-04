import {test,expect} from '@playwright/test';
import {mountFleet,now} from './fleet-dashboard-fixtures.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
test('completed counts survive clock expiry and failed refresh, then change on a completed update',async({page})=>{
 const f=fieldProductFixture();
 const {app,state}=await mountFleet(page,false,{field:f.field,health:f.health,productConnections:f.connections,skipInitialFieldCount:true,advancingClock:true});
 const board=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});
 const online=board.locator('.cos-equipment-total-helios .cos-total-status-online b');
 const offline=board.locator('.cos-equipment-total-helios .cos-total-status-offline b');
 await expect(online).toHaveText('1');
 const originalTime=await board.locator('.cos-fleet-heading').innerText();
 // Fail every update while the original evidence crosses its validity window.
 state.fail=true;state.productConnections=null;
 await page.clock.fastForward(25*60000);
 await expect(board.getByRole('alert').filter({hasText:'Last completed results remain displayed'})).toBeVisible();
 await expect(online).toHaveText('1');await expect(offline).toHaveText('0');
 await board.getByRole('button',{name:/Refresh data/}).click();
 await expect(online).toHaveText('1');
 await expect(board.getByRole('button',{name:/Refresh data/})).toBeEnabled();
 // A newly completed negative result is allowed to replace the saved count.
 state.fail=false;state.productConnections=structuredClone(f.connections);
 let release;state.proofGate=new Promise(resolve=>{release=resolve;});
 const stamp=new Date(now+25*60000).toISOString();
 state.productConnections.trackerVerifiedAt=stamp;
 for(const item of state.productConnections.items){if(item.checkedAt)item.checkedAt=stamp;}
 const item=state.productConnections.items.find(i=>i.productId==='1001');item.status='offline';item.reason='Completed saved nonresponse.';
 await board.getByRole('button',{name:/Refresh data/}).click();
 await page.clock.fastForward(5000);
 await expect(online).toHaveText('1');await expect(offline).toHaveText('0');
 release();await expect(offline).toHaveText('1');await expect(online).toHaveText('0');
 expect(originalTime).toContain('Saved health');expect(state.errors).toEqual([]);
 await app.locator('body').evaluate(()=>window.dispatchEvent(new Event('cos-private-data-invalidated')));
 await expect(board.locator('.cos-equipment-total-helios')).toHaveCount(0);
});

test('reopening Fleet shows the last completed reading before any new camera read',async({page})=>{
 const f=fieldProductFixture();
 const {app,state}=await mountFleet(page,false,{
  field:f.field,health:f.health,productConnections:f.connections,
  skipInitialFieldCount:true,advancingClock:true,
  productionOwnerUserId:'00000000-0000-4000-8000-000000000001',
 });
 const online=app.locator('.cos-equipment-total-helios .cos-total-status-online b');
 await expect(online).toHaveText('1');
 await expect.poll(()=>app.locator('body').evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('cos-saved-fleet-reading-v1:')))).toBe(true);
 state.calls.length=0;
 await page.reload();
 const saved=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});
 await expect(saved.getByText(/Last completed reading/)).toBeVisible();
 const cameraReads=()=>state.calls.filter(call=>['/api/camera-health/summary-v3','/api/field-map','/api/product-connections'].includes(call.path));
 await app.locator('body').evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 expect(cameraReads()).toHaveLength(0);
 await saved.getByRole('button',{name:/Refresh data/}).click();
 await expect.poll(()=>cameraReads().length).toBeGreaterThan(0);
});

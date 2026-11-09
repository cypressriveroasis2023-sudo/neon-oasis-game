import {test,expect} from '@playwright/test';
import {mountFleet,now} from './fleet-dashboard-fixtures.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
test('stale health counts hide after expiry and failed refresh, then return on a completed update',async({page})=>{
 const f=fieldProductFixture();
 const {app,state}=await mountFleet(page,false,{field:f.field,health:f.health,productConnections:f.connections,skipInitialFieldCount:true,advancingClock:true});
 const board=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});
 const online=board.locator('.cos-equipment-total-helios .cos-total-status-online b');
 const offline=board.locator('.cos-equipment-total-helios .cos-total-status-offline b');
 await expect(online).toHaveText('1');
 const originalTime=await board.locator('.cos-fleet-heading').innerText();
 // Let the completed evidence expire, then explicitly prove the failed refresh.
 await expect(board.getByRole('button',{name:/Refresh data/})).toBeEnabled();
 state.fail=true;state.productConnections=null;
 await page.clock.fastForward(25*60000);
 await expect(online).toHaveText('—');await expect(offline).toHaveText('—');
 await board.getByRole('button',{name:/Refresh data/}).click();
 const warning=board.locator('.cos-fleet-status-strip').filter({hasText:'Synthetic saved camera read unavailable'});await expect(warning.locator('summary')).toBeVisible();await warning.locator('summary').click();await expect(warning.getByText('Synthetic saved camera read unavailable',{exact:true})).toBeVisible();
 await expect(board.locator('.cos-equipment-totals-note')).toContainText('Health counts stay hidden until a fresh completed board is available.');
 await expect(online).toHaveText('—');await expect(offline).toHaveText('—');await expect(online.locator('..')).toBeDisabled();
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
 await expect(online).toHaveText('—');await expect(offline).toHaveText('—');
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


test('cold provider failure persists inventory without inventing resource membership',async({page})=>{
 const f=fieldProductFixture();
 const {app,state}=await mountFleet(page,false,{
  field:f.field,health:f.health,productConnections:f.connections,
  skipInitialFieldCount:true,advancingClock:true,failHealth:true,
  productionOwnerUserId:'00000000-0000-4000-8000-000000000002',
 });
 const helios=app.locator('.cos-equipment-total-helios');
 await expect(helios.locator('.cos-equipment-total-number strong')).toHaveText('1');
 await expect(helios.locator('.cos-total-status-online b')).toHaveText('0');await expect(helios.locator('.cos-total-status-offline b')).toHaveText('0');await expect(helios.locator('.cos-total-status-unverified b')).toHaveText('1');
 await helios.locator('.cos-total-status-unverified').click();await expect(app.getByRole('region',{name:'Helios unverified Field units'})).toContainText('complete provider-resource association is not verified');
 await expect.poll(()=>app.locator('body').evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('cos-saved-fleet-reading-v1:')))).toBe(true);
 state.calls.length=0;await page.reload();
 const saved=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});
 await expect(saved.getByText(/Last completed reading/)).toBeVisible();
 await expect(helios.locator('.cos-total-status-online b')).toHaveText('0');await expect(helios.locator('.cos-total-status-offline b')).toHaveText('0');await expect(helios.locator('.cos-total-status-unverified b')).toHaveText('1');
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);
 expect(state.calls.filter(call=>['/api/camera-health/summary-v3','/api/field-map','/api/product-connections'].includes(call.path))).toHaveLength(0);
 expect(state.errors).toEqual([]);
});

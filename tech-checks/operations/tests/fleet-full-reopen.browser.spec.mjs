import {test,expect} from '@playwright/test';
import {mountFleet,now} from './fleet-dashboard-fixtures.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
const owner='00000000-0000-4000-8000-000000000001';
const reads=state=>state.calls.filter(c=>['/api/camera-health/summary-v3','/api/field-map','/api/product-connections','/api/routers','/api/vrm-fleet'].includes(c.path));
async function setup(page,extra={}){const f=fieldProductFixture();const value=await mountFleet(page,false,{field:f.field,health:f.health,productConnections:f.connections,skipInitialFieldCount:true,advancingClock:true,productionOwnerUserId:owner,...extra});await expect(value.app.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('1');await expect.poll(()=>value.app.locator('body').evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('cos-saved-fleet-presentation-v1:')))).toBe(true);return {...value,f};}
test('cold desktop reopen restores FULL dashboard, search, map, cards and verify controls without source reads',async({page},testInfo)=>{
 const {app,state}=await setup(page);state.calls.length=0;await page.reload();
 const board=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});
 await expect(board.getByText(/Last completed reading/)).toBeVisible();
 await expect(board.getByRole('button',{name:'Map',exact:true})).toBeVisible();
 await expect(board.getByRole('button',{name:'Fleet health',exact:true})).toBeVisible();
 await expect(board.getByRole('region',{name:'Equipment family totals'})).toBeVisible();
 await expect(board.locator('.cos-fleet-map-panel')).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('full-fleet-after-reload.png')});
 const search=board.getByPlaceholder('Find a unit, customer or address…');await expect(search).toBeVisible();await search.fill('Helios');
 // The same products also exist inside closed family/details panels. Check
 // the actual visible Field list rather than those deliberately hidden views.
 const unitPanel=board.getByRole('region',{name:'Fleet units in view'});
 await expect(unitPanel.locator('.cos-field-product-cards article')).toHaveCount(1);
 await expect(unitPanel.getByRole('button',{name:'Open Helios 1 Product 1001'})).toBeVisible();
 await search.fill('');
 await board.getByRole('button',{name:/^Camera units unverified /}).click();
 await expect(board.getByRole('button',{name:/Verify all \d+ now/})).toBeVisible();
 await app.locator('body').evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 expect(reads(state)).toHaveLength(0);expect(state.calls.every(c=>c.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});
test('manual refresh keeps the complete restored dashboard when newer reads fail',async({page})=>{
 const {app,state}=await setup(page);await page.reload();state.fail=true;state.productConnections=null;
 const board=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});
 await board.getByRole('button',{name:/Refresh data/}).click();
 await expect(board.getByRole('alert').filter({hasText:'Last completed results remain displayed'})).toBeVisible();
 await expect(board.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('1');
 await expect(board.getByPlaceholder('Find a unit, customer or address…')).toBeVisible();await expect(board.locator('.cos-fleet-map-panel')).toBeVisible();
 expect(state.calls.every(c=>c.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});
test('counts-only old release cache cannot hide the dashboard during migration',async({page})=>{
 const {app,state}=await setup(page);await app.locator('body').evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('cos-saved-fleet-presentation-v1:'))localStorage.removeItem(k);});
 state.calls.length=0;await page.reload();
 const board=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});
 await expect(board.getByPlaceholder('Find a unit, customer or address…')).toBeVisible();
 await expect(board.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('1');
 expect(reads(state).length).toBeGreaterThan(0);expect(state.calls.every(c=>c.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});
test('provider outage still restores full connection-based cards without another open-time read',async({page})=>{
 const {app,state}=await setup(page,{failHealth:true});state.calls.length=0;await page.reload();
 await expect(app.getByText(/Last completed reading/)).toBeVisible();await expect(app.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('1');
 await expect(app.getByPlaceholder('Find a unit, customer or address…')).toBeVisible();expect(reads(state)).toHaveLength(0);expect(state.errors).toEqual([]);
});
test('timer reads saved results at cadence, never probes; successful newer result replaces restored status',async({page})=>{
 const {app,state}=await setup(page);state.calls.length=0;await page.reload();
 // Authentication must finish before advancing ten minutes. Advancing while
 // /api/session is in flight would test the 45-second auth timeout instead.
 await expect(app.getByText(/Last completed reading/)).toBeVisible();
 expect(reads(state)).toHaveLength(0);
 const stamp=new Date(now+10*60000+5000).toISOString();
 state.productConnections.trackerVerifiedAt=stamp;for(const item of state.productConnections.items)if(item.checkedAt)item.checkedAt=stamp;
 Object.assign(state.productConnections.items.find(i=>i.productId==='1001'),{status:'offline',reason:'Completed newer saved test.'});
 await page.clock.fastForward(11*60000);
 await expect(app.locator('.cos-equipment-total-helios .cos-total-status-offline b')).toHaveText('1');
 expect(reads(state).length).toBeGreaterThan(0);expect(state.calls.every(c=>c.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});
test('session invalidation removes full cached details and prevents restoring them',async({page})=>{
 const {app}=await setup(page);await page.reload();await expect(app.getByText(/Last completed reading/)).toBeVisible();
 await app.locator('body').evaluate(()=>window.dispatchEvent(new Event('cos-private-data-invalidated')));
 await expect.poll(()=>app.locator('body').evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('cos-saved-fleet-presentation-v1:')).length)).toBe(0);
 await expect(app.locator('.cos-equipment-total-helios')).toHaveCount(0);
});

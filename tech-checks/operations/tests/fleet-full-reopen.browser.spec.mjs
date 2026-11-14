import {test,expect} from '@playwright/test';
import {mountFleet,now} from './fleet-dashboard-fixtures.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
import {openFleetView} from './fleet-view-navigation-helper.mjs';
import {completedBoard} from '../durable-board/project.ts';
const owner='00000000-0000-4000-8000-000000000001';
const reads=state=>state.calls.filter(c=>['/api/camera-health/summary-v3','/api/field-map','/api/product-connections','/api/routers','/api/vrm-fleet'].includes(c.path));
const technician='00000000-0000-4000-8000-000000000010';
async function setup(page,extra={},it=false){const f=fieldProductFixture();const value=await mountFleet(page,it,{field:f.field,health:f.health,productConnections:f.connections,skipInitialFieldCount:true,advancingClock:true,productionOwnerUserId:it?undefined:owner,productionTechnicianUserId:it?technician:undefined,...extra});await expect(value.app.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('1');await expect.poll(()=>value.app.locator('body').evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('cos-saved-fleet-presentation-v1:')))).toBe(true);return {...value,f};}
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
 const unitPanel=board.getByRole('region',{name:'Fleet units in view'});
 await expect(unitPanel.locator('.cos-field-product-cards > article')).toHaveCount(1);
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
 await expect(board.locator('.cos-fleet-status-strip').filter({hasText:'Supporting source update incomplete'})).toBeVisible();
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
 const {app,state}=await setup(page);state.fail=true;state.calls.length=0;await page.reload();
 await expect(app.getByText(/Last completed reading/)).toBeVisible();await expect(app.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('1');
 await expect(app.getByPlaceholder('Find a unit, customer or address…')).toBeVisible();expect(reads(state)).toHaveLength(0);expect(state.errors).toEqual([]);
});
test('timer reads saved results at cadence, never probes; successful newer result replaces restored status',async({page})=>{
 const {app,state}=await setup(page);state.calls.length=0;await page.reload();
 await expect(app.getByText(/Last completed reading/)).toBeVisible();expect(reads(state)).toHaveLength(0);
 const current=await app.locator('body').evaluate(()=>Date.now());
 await page.clock.pauseAt(new Date(current+1000));await page.clock.setSystemTime(new Date(now+11*60000));
 const stamp=new Date(now+10*60000).toISOString();
 state.productConnections.trackerVerifiedAt=stamp;for(const item of state.productConnections.items)if(item.checkedAt)item.checkedAt=stamp;
 Object.assign(state.productConnections.items.find(i=>i.productId==='1001'),{status:'offline',reason:'Completed newer saved test.'});
 for(let tick=0;tick<61&&reads(state).length===0;tick++)await page.clock.runFor(1000);
 await page.clock.resume();
 await expect(app.locator('.cos-equipment-total-helios .cos-total-status-unverified b')).toHaveText('1');
 expect(reads(state).length).toBeGreaterThan(0);expect(state.calls.every(c=>c.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});
test('session invalidation removes full cached details and prevents restoring them',async({page})=>{
 const {app}=await setup(page);await page.reload();await expect(app.getByText(/Last completed reading/)).toBeVisible();
 await app.locator('body').evaluate(()=>window.dispatchEvent(new Event('cos-private-data-invalidated')));
 await expect.poll(()=>app.locator('body').evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('cos-saved-fleet-presentation-v1:')).length)).toBe(0);
 await expect(app.locator('.cos-equipment-total-helios')).toHaveCount(0);
});
test('a transient local save failure recovers without another source read or camera probe',async({page})=>{
 await page.addInitScript(()=>{const original=Storage.prototype.setItem;window.__cosFirstLocalSave=null;window.__cosLocalSaveAttempts=0;Storage.prototype.setItem=function(key,value){if(key.startsWith('cos-saved-fleet-presentation-v1:')){window.__cosLocalSaveAttempts++;window.__cosFirstLocalSave??=Date.now();if(Date.now()-window.__cosFirstLocalSave<200)throw new DOMException('Synthetic transient storage failure','QuotaExceededError');}return original.call(this,key,value);};});
 const {app,state}=await setup(page);
 expect(await app.locator('body').evaluate(()=>window.__cosLocalSaveAttempts)).toBeGreaterThan(1);
 state.calls.length=0;await page.reload();await expect(app.getByText(/Last completed reading/)).toBeVisible();
 await expect(app.getByPlaceholder('Find a unit, customer or address…')).toBeVisible();
 expect(reads(state)).toHaveLength(0);expect(state.errors).toEqual([]);
});
test('pending local-save retry cannot restore private data after invalidation',async({page})=>{
 await page.addInitScript(()=>{const original=Storage.prototype.setItem;window.__cosBlockLocalSave=true;window.__cosLocalSaveAttempts=0;Storage.prototype.setItem=function(key,value){if(key.startsWith('cos-saved-fleet-presentation-v1:')){window.__cosLocalSaveAttempts++;if(window.__cosBlockLocalSave)throw new DOMException('Synthetic blocked storage','QuotaExceededError');}return original.call(this,key,value);};});
 const f=fieldProductFixture(),{app,state}=await mountFleet(page,false,{field:f.field,health:f.health,productConnections:f.connections,skipInitialFieldCount:true,advancingClock:true,productionOwnerUserId:owner});
 await expect(app.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('1');
 await expect.poll(()=>app.locator('body').evaluate(()=>window.__cosLocalSaveAttempts)).toBeGreaterThan(0);
 await app.locator('body').evaluate(()=>{window.dispatchEvent(new Event('cos-private-data-invalidated'));window.__cosBlockLocalSave=false;});
 await page.waitForTimeout(1500);
 expect(await app.locator('body').evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('cos-saved-fleet-presentation-v1:')))).toBe(false);
 await expect(app.locator('.cos-equipment-total-helios')).toHaveCount(0);expect(state.errors).toEqual([]);
});


const savedPresentation=app=>app.locator('body').evaluate(()=>{
 const entry=Object.keys(localStorage).find(key=>key.startsWith('cos-saved-fleet-presentation-v1:'));
 if(!entry)return null;
 const value=JSON.parse(localStorage.getItem(entry));
 return {checkedAt:value.checkedAt,healthAt:value.health?.refreshedAt??null,connections:value.fieldMap.productConnections};
});
const manualRefreshButtons=scope=>scope.getByRole('button',{name:/Refresh data|Reading data|Reload saved results|Reading saved results|Refresh saved evidence|Retry saved data/});
const assertSavedReadsOnly=state=>{
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);
 expect(state.calls.some(call=>/verify|probe|sweep|refresh$/.test(call.path))).toBe(false);
 expect(state.errors).toEqual([]);
};

test('IT cold reopen retains complete counts and original observation times without health or map reads',async({page})=>{
 const {app,state}=await setup(page,{},true);
 const totals=app.locator('.cos-equipment-totals'),originalCounts=await totals.locator('strong,b').allTextContents();
 await app.getByRole('button',{name:'Open Helios 1 Product 1001',exact:true}).click();
 const drawer=app.getByRole('dialog',{name:'Helios 1 unit intelligence',exact:true});
 const originalObservation=await drawer.locator('.cos-fleet-camera-card > small').innerText();
 await drawer.getByRole('button',{name:'Close unit details',exact:true}).click();
 const original=await savedPresentation(app);expect(original.checkedAt).toBeGreaterThan(0);
 state.calls.length=0;await page.reload();
 await expect(app.getByText(/Last completed reading/)).toBeVisible();
 await expect(totals.locator('strong,b')).toHaveText(originalCounts);
 expect(await savedPresentation(app)).toEqual(original);
 await app.locator('body').evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 expect(reads(state)).toHaveLength(0);
 await expect(manualRefreshButtons(app)).toHaveCount(0);
 await app.getByRole('button',{name:'Open Helios 1 Product 1001',exact:true}).click();
 await expect(drawer.locator('.cos-fleet-camera-card > small')).toHaveText(originalObservation);
 assertSavedReadsOnly(state);
});

test('IT saved data updates after ten minutes and keeps new observation times',async({page})=>{
 const {app,state}=await setup(page,{},true);state.calls.length=0;await page.reload();
 await expect(app.getByText(/Last completed reading/)).toBeVisible();expect(reads(state)).toHaveLength(0);
 const saved=await savedPresentation(app),current=await app.locator('body').evaluate(()=>Date.now());
 await page.clock.pauseAt(new Date(current+1000));
 await page.clock.runFor(9*60000);expect(reads(state)).toHaveLength(0);
 await expect(app.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('1');
 const stamp=new Date(await app.locator('body').evaluate(()=>Date.now())).toISOString();
 state.productConnections.trackerVerifiedAt=stamp;
 for(const item of state.productConnections.items)if(item.checkedAt)item.checkedAt=stamp;
 Object.assign(state.productConnections.items.find(item=>item.productId==='1001'),{status:'offline',reason:'Completed newer synthetic TCP observation.'});
 await page.clock.runFor(60000);await page.clock.resume();
 await expect(app.locator('.cos-equipment-total-helios .cos-total-status-unverified b')).toHaveText('1');
 await expect(app.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('0');
 await expect.poll(async()=> (await savedPresentation(app)).checkedAt).toBeGreaterThan(saved.checkedAt);
 expect((await savedPresentation(app)).connections.items.find(item=>item.productId==='1001').checkedAt).toBe(stamp);
 expect(state.calls.filter(call=>call.path==='/api/camera-health/summary-v3')).toHaveLength(1);
 expect(state.calls.filter(call=>call.path==='/api/field-map')).toHaveLength(1);
 assertSavedReadsOnly(state);
});

test('IT failed scheduled refresh retains completed counts and observation times',async({page})=>{
 const {app,state}=await setup(page,{},true);await page.reload();
 await expect(app.getByText(/Last completed reading/)).toBeVisible();
 const original=await savedPresentation(app),counts=await app.locator('.cos-equipment-totals strong,.cos-equipment-totals b').allTextContents();
 state.fail=true;state.productConnections=null;state.calls.length=0;
 const current=await app.locator('body').evaluate(()=>Date.now());
 await page.clock.pauseAt(new Date(current+1000));await page.clock.setSystemTime(new Date(current+10*60000));
 for(let tick=0;tick<61&&reads(state).length===0;tick++)await page.clock.runFor(1000);
 await page.clock.resume();
 await expect(app.locator('.cos-fleet-status-strip').filter({hasText:'Supporting source update incomplete'})).toBeVisible();
 await expect(app.locator('.cos-equipment-totals strong,.cos-equipment-totals b')).toHaveText(counts);
 expect(await savedPresentation(app)).toEqual(original);
 await expect(manualRefreshButtons(app)).toHaveCount(0);assertSavedReadsOnly(state);
});

for(const it of [true,false])test((it?'IT omits':'Owner retains')+' manual health refresh in Fleet, unit details, troubleshooting and Data sources',async({page})=>{
 const {app,state}=await setup(page,{},it);
 const headingRefresh=app.locator('.cos-fleet-heading').getByRole('button',{name:/Refresh data/});
 if(it)await expect(headingRefresh).toHaveCount(0);else await expect(headingRefresh).toBeVisible();
 await app.getByRole('button',{name:'Open Helios 1 Product 1001',exact:true}).click();
 const drawer=app.getByRole('dialog',{name:'Helios 1 unit intelligence',exact:true});
 if(it)await expect(drawer.getByRole('button',{name:/Refresh data/})).toHaveCount(0);else await expect(drawer.getByRole('button',{name:/Refresh data/})).toBeVisible();
 await drawer.locator('.cos-fleet-troubleshooting > summary').click();
 const workspace=drawer.getByRole('region',{name:'Camera Health',exact:true});
 await expect(workspace).toBeVisible();
 if(it)await expect(workspace.getByRole('button',{name:'Reload saved results',exact:true})).toHaveCount(0);else await expect(workspace.getByRole('button',{name:'Reload saved results',exact:true})).toBeVisible();
 await expect(workspace.getByRole('button',{name:'Open Camera Health diagnostics',exact:true})).toBeVisible();
 await drawer.getByRole('button',{name:'Close unit details',exact:true}).click();
 await openFleetView(app,'Data sources');
 const command=app.getByRole('region',{name:'Complete mHelpDesk Fleet command center',exact:true});await expect(command).toBeVisible();
 if(it)await expect(manualRefreshButtons(app)).toHaveCount(0);else await expect(command.getByRole('button',{name:'Refresh saved evidence'})).toBeVisible();
 assertSavedReadsOnly(state);
});

test('IT diagnostics deep link retains the allowed Camera Health view without manual refresh',async({page})=>{
 const {app,state}=await setup(page,{hash:'#camera-health?diagnostics=1'},true);
 await expect(app.getByRole('heading',{name:'Fleet health',exact:true,includeHidden:true})).toBeAttached();
 await expect(manualRefreshButtons(app)).toHaveCount(0);
 await expect(app.locator('.cos-equipment-grid')).toBeVisible();assertSavedReadsOnly(state);
});

test('Owner standalone Camera Health retains explicit saved-result reload',async({page})=>{
 const {app,state}=await setup(page);
 await app.getByText('Authorized tools',{exact:true}).click();
 await app.getByRole('button',{name:'Advanced camera diagnostics',exact:true}).click();
 const workspace=app.getByRole('region',{name:'Camera Health',exact:true});
 await expect(workspace.getByRole('heading',{name:'Camera Health',exact:true})).toBeVisible();
 await expect(workspace.getByRole('button',{name:'Reload saved results',exact:true})).toBeVisible();
 assertSavedReadsOnly(state);
});

test('a different verified IT actor cannot restore another actor completed dashboard',async({page})=>{
 const {app,state}=await setup(page,{},true);
 const original=await savedPresentation(app);expect(original).not.toBeNull();
 state.sessionActorId='00000000-0000-4000-8000-000000000011';state.fail=true;state.productConnections=null;state.calls.length=0;
 await page.reload();
 await expect.poll(()=>state.calls.some(call=>call.path==='/api/camera-health/summary-v3')).toBe(true);
 await expect(app.locator('.cos-fleet-status-strip').filter({hasText:'Synthetic saved camera read unavailable'})).toBeVisible();
 await expect(app.getByText(/Last completed reading/)).toHaveCount(0);
 await expect(app.locator('.cos-equipment-total-helios .cos-total-status-online b')).not.toHaveText('1');
 assertSavedReadsOnly(state);
});


test('a presentation-only saved Shop projection error cannot blank the Fleet',async({page})=>{
 const f=fieldProductFixture(),field=structuredClone(f.field);
 field.manualPlacementOverrides={contract:'COS_FLEET_SHOP_OVERRIDES_V1',items:[{unitId:'invalid-old-board-shape'}]};
 const {app,state}=await mountFleet(page,false,{field,health:f.health,productConnections:f.connections,skipInitialFieldCount:true});
 const board=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});
 await expect(board).toBeVisible();
 await expect(board.getByText('Some saved details are in safe mode',{exact:true})).toBeVisible();
 await expect(app.getByText(/Fleet details could not display|Fleet couldn’t display/)).toHaveCount(0);
 await expect(board.getByRole('region',{name:'Equipment family totals'})).toBeVisible();
 await expect(board.getByPlaceholder('Find a unit, customer or address…')).toBeVisible();
 expect(state.errors).toEqual([]);
});


test('durable Fleet open is read-only until the 10-minute cadence',async({page})=>{
 const f=fieldProductFixture(),features={durableFleetBoard:false};
 const {app,state}=await mountFleet(page,false,{field:f.field,health:f.health,productConnections:f.connections,features,skipInitialFieldCount:true,advancingClock:true,productionOwnerUserId:owner});
 await expect(app.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('1');
 const first=completedBoard(f.health,f.field,f.connections,null,f.now);
 let value={contract:'COS_DURABLE_FLEET_RESPONSE_V1',latest:{id:'completed-open',payload:first},refresh:{state:'completed'},history:[]};
 const calls=[];
 await page.route('**/functions/v1/cos-operations-pages',async route=>{
  if(route.request().method()!=='POST')return route.fallback();
  const req=route.request().postDataJSON();
  if(!req.path.startsWith('/api/fleet-saved-board'))return route.fallback();
  calls.push(req);
  return route.fulfill({headers:{'access-control-allow-origin':'http://127.0.0.1:4173'},json:value});
 });
 await app.locator('body').evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('cos-saved-fleet-presentation-v1:'))localStorage.removeItem(key);});
 features.durableFleetBoard=true;state.calls.length=0;await page.reload();
 const board=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});
 await expect(board.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('1');
 await expect.poll(()=>calls.some(c=>c.path==='/api/fleet-saved-board'&&c.method==='GET')).toBe(true);
 expect(calls.some(c=>c.method==='POST')).toBe(false);
 expect(reads(state)).toHaveLength(0);
 await page.clock.fastForward(9*60000);
 expect(calls.some(c=>c.method==='POST')).toBe(false);
 expect(reads(state)).toHaveLength(0);
 await page.clock.fastForward(2*60000);
 await expect.poll(()=>calls.some(c=>c.path==='/api/fleet-saved-board/refresh'&&c.method==='POST')).toBe(true);
 expect(reads(state)).toHaveLength(0);
 expect(state.errors).toEqual([]);
});

import {test,expect} from '@playwright/test';
import {resource,snapshot} from './fixtures/camera-evidence-fixtures.mjs';
import {openWorkspace} from './navigation-helper.mjs';

// Exercise the real hook/API against saved synthetic DB snapshots. No vendors,
// database writes, production credentials or source timestamp rewrites are used.
const start=Date.parse('2026-10-13T22:30:00Z');
const oldObservation='2026-10-13T22:18:00Z',newObservation='2026-10-13T22:33:00Z';
const unitId='90000000-0000-4000-8000-000000000001';
const summaryPath='/api/camera-health/summary-v3',mapPath='/api/field-map';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function mount(page){
 const unit={id:unitId,unitNumber:'Solar Spotter 22HDC1',modelName:'Solar Spotter',status:'field',currentLocationType:'field',address:'100 Synthetic Road',site:'Synthetic refresh test',customer:'Synthetic customer',latitude:null,longitude:null,locationVerification:'address_only'};
 const state={calls:[],errors:[],failed:false,gate:deferred()};
 page.on('pageerror',error=>state.errors.push(error.message));
 await page.addInitScript(()=>{window.savedRefreshInvalidations=[];window.addEventListener('cos-private-data-invalidated',()=>window.savedRefreshInvalidations.push(Date.now()));});
 await page.clock.install({time:new Date(start)});await page.clock.pauseAt(new Date(start));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/saved-camera-refresh-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe src="/#fleet-dashboard"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-saved-refresh-only'},location.origin)})</script>`});
  if(url.hostname==='127.0.0.1')return route.continue();
  if(/(?:^|\.)tile\.openstreetmap\.org$/.test(url.hostname))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>'});
  if(!url.pathname.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':request.headers().origin||'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  const body=request.postDataJSON(),at=await page.evaluate(()=>Date.now());state.calls.push({...body,at});
  if(body.method!=='GET')return route.fulfill({status:400,headers,json:{error:'Synthetic writes disabled'}});
  if(body.path===mapPath&&state.gate)await state.gate.promise;
  if(body.path===summaryPath&&state.failed)return route.fulfill({status:503,headers,json:{error:'Synthetic saved camera read unavailable'}});
  const observedAt=at>=Date.parse(newObservation)?newObservation:oldObservation;
  const row=resource('92001','SOLARSPOTTER022',{evidence:{kind:'provider',source:'Star4Live',resource:'camera',active:true,status:'online',observedAt,lastOnlineAt:observedAt}});
  const data=body.path==='/api/session'?{authorized:true,name:'Synthetic Owner',role:'Owner',features:{vrmRead:true}}
   :body.path===summaryPath?{...snapshot([row]),refreshedAt:new Date(at).toISOString(),identityVersion:1,unitIdentities:[{unitId,unitNumber:unit.unitNumber,kind:'native_provider',deviceIds:['92001'],unitKeys:['SOLARSPOTTER022'],proof:'a'.repeat(64)}],identityWarnings:[]}
   :body.path===mapPath?{items:[unit],inventoryItems:[unit],summary:{fieldUnits:1,mappedUnits:0,unitGps:0,missingGps:1},generatedAt:new Date(at).toISOString()}
   :body.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:new Date(at).toISOString()}
   :body.path==='/api/vrm-fleet'?{items:[],power:[]}
   :{items:[]};
  await route.fulfill({headers,json:data});
 });
 await page.goto('/saved-camera-refresh-fixture');const app=page.frameLocator('iframe');
 await expect.poll(()=>counts(state)).toEqual({health:1,map:1,routers:1,power:1});
 // A delayed paired response must not push cache expiry beyond the next tick.
 await page.clock.runFor(3000);state.gate.resolve();state.gate=null;
 await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('1');
 await expect(app.getByRole('button',{name:'↻ Refresh data',exact:true})).toBeEnabled();
 return {app,state};
}
function counts(state){const count=path=>state.calls.filter(call=>call.path===path).length;return {health:count(summaryPath),map:count(mapPath),routers:count('/api/routers'),power:count('/api/vrm-fleet')};}
async function visible(app,value){await app.locator('body').evaluate((_,isVisible)=>{Object.defineProperty(document,'hidden',{configurable:true,value:!isVisible});document.dispatchEvent(new Event('visibilitychange'));},value);}
function assertReadOnly(state){expect(state.calls.every(call=>call.method==='GET')).toBe(true);expect([...new Set(state.calls.map(call=>call.path))].sort()).toEqual(['/api/camera-health/summary-v3','/api/field-map','/api/routers','/api/session','/api/vrm-fleet']);expect(state.errors).toEqual([]);}

test('four-minute camera and saved power reads see new evidence; routers remain fifteen minutes',async({page})=>{
 const {app,state}=await mount(page);
 await page.clock.runFor(237000);await expect.poll(()=>counts(state)).toEqual({health:2,map:2,routers:1,power:2});
 expect(state.calls.filter(call=>call.path===summaryPath).map(call=>call.at)).toEqual([start,start+240000]);
 await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('1');
 await page.clock.runFor(240000);await expect.poll(()=>counts(state)).toEqual({health:3,map:3,routers:1,power:3});
 await page.clock.runFor(60000);await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('1');
 // At 22:39, the old 22:18 observation would have expired. The saved 22:33
 // producer result is still recent without changing the 20-minute truth rule.
 await page.clock.runFor(180000);await expect.poll(()=>counts(state)).toEqual({health:4,map:4,routers:1,power:4});
 await page.clock.runFor(180000);await expect.poll(()=>counts(state)).toEqual({health:4,map:4,routers:2,power:5});
 for(let minute=16;minute<=24;minute++){
  await page.clock.runFor(60000);
  if(minute%4===0)await expect.poll(()=>counts(state).health).toBe(minute/4+1);
 }
 await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('0');
 await expect(app.locator('.cos-fleet-stat-unknown strong')).toHaveText('1');
 assertReadOnly(state);
});

test('hidden tabs pause saved reads and visibility resumes one coalesced pair',async({page})=>{
 const {app,state}=await mount(page);await visible(app,false);await page.clock.runFor(20*60000);
 expect(counts(state)).toEqual({health:1,map:1,routers:1,power:1});
 await visible(app,true);await expect.poll(()=>counts(state)).toEqual({health:2,map:2,routers:2,power:2});
 await expect(app.getByRole('button',{name:'↻ Refresh data',exact:true})).toBeEnabled();
 await visible(app,true);await visible(app,true);await page.clock.runFor(60000);
 expect(counts(state)).toEqual({health:2,map:2,routers:2,power:2});assertReadOnly(state);
});

test('returning to Fleet keeps the cached pair original refresh deadline',async({page})=>{
 const {app,state}=await mount(page);
 const savedHealth=app.locator('.cos-fleet-heading > div > small'),originalRead=await savedHealth.innerText();
 // Use the static directory while Fleet is unmounted. An unrelated workspace's
 // authenticated polling must not run through this synthetic clock jump.
 await openWorkspace(app,'Operations');
 await expect(app.getByRole('region',{name:'Operations workspaces',exact:true})).toBeVisible();
 await expect(app.locator('.cos-fleet-dashboard')).toHaveCount(0);
 await page.clock.runFor(177000); // Three minutes from the original saved pair.
 expect(await app.locator('body').evaluate(()=>Date.now())).toBe(start+180000);
 await openWorkspace(app,'Field Map');
 await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('1');
 await expect(app.getByRole('button',{name:'↻ Refresh data',exact:true})).toBeEnabled();
 expect(counts(state).health).toBe(1);expect(counts(state).map).toBe(1);
 expect(await app.locator('body').evaluate(()=>window.savedRefreshInvalidations)).toEqual([]);
 state.gate=deferred();
 const healthResponse=page.waitForResponse(response=>response.request().method()==='POST'&&response.request().postDataJSON()?.path===summaryPath);
 await page.clock.runFor(60000);
 await expect.poll(()=>counts(state).health).toBe(2);await expect.poll(()=>counts(state).map).toBe(2);
 await (await healthResponse).finished();
 expect(state.calls.filter(call=>call.path===summaryPath).map(call=>call.at)).toEqual([start,start+240000]);
 // A fresh health response cannot replace the complete shared pair on its own.
 await expect(app.getByRole('button',{name:'↻ Reading data…',exact:true})).toBeDisabled();
 await expect(savedHealth).toHaveText(originalRead);
 await page.clock.runFor(45000);state.gate.resolve();state.gate=null;
 await expect(app.getByRole('button',{name:'↻ Refresh data',exact:true})).toBeEnabled();
 await expect(savedHealth).not.toHaveText(originalRead);
 await page.clock.runFor(195000);
 await expect.poll(()=>counts(state).health).toBe(3);await expect.poll(()=>counts(state).map).toBe(3);
 expect(state.calls.filter(call=>call.path===summaryPath).map(call=>call.at)).toEqual([start,start+240000,start+480000]);
 await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('1');assertReadOnly(state);
 expect(await app.locator('body').evaluate(()=>Date.now())).toBe(start+480000);
 expect(await app.locator('body').evaluate(()=>window.savedRefreshInvalidations)).toEqual([]);
});

test('a failed saved read waits four minutes to retry and manual reload remains immediate',async({page})=>{
 const {app,state}=await mount(page);state.failed=true;
 await page.clock.runFor(237000);await expect.poll(()=>counts(state).health).toBe(2);
 await expect(app.locator('.cos-fleet-message')).toContainText('Synthetic saved camera read unavailable');
 await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('0');
 await page.clock.runFor(180000);await visible(app,true);expect(counts(state).health).toBe(2);
 await page.clock.runFor(60000);await expect.poll(()=>counts(state).health).toBe(3);
 await expect(app.getByRole('button',{name:'↻ Refresh data',exact:true})).toBeEnabled();
 state.failed=false;await app.getByRole('button',{name:'↻ Refresh data',exact:true}).click();
 await expect.poll(()=>counts(state)).toEqual({health:4,map:4,routers:2,power:4});
 await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('1');assertReadOnly(state);
});

test('failed health keeps its slow map shared through manual refresh and Fleet reentry',async({page})=>{
 const {app,state}=await mount(page);state.failed=true;state.gate=deferred();
 await app.getByRole('button',{name:'↻ Refresh data',exact:true}).click();
 await expect.poll(()=>counts(state)).toEqual({health:2,map:2,routers:2,power:2});
 await expect(app.locator('.cos-fleet-message')).toContainText('Synthetic saved camera read unavailable');
 await expect(app.getByRole('button',{name:'↻ Refresh data',exact:true})).toBeEnabled();
 // The failed pair is already visible while its original map response is held.
 // A forced consumer and a newly mounted normal consumer must share that peer.
 await app.getByRole('button',{name:'↻ Refresh data',exact:true}).click();
 await expect.poll(()=>counts(state).routers).toBe(3);
 await expect(app.getByRole('button',{name:'↻ Refresh data',exact:true})).toBeEnabled();
 expect(counts(state).health).toBe(2);expect(counts(state).map).toBe(2);
 await openWorkspace(app,'Operations');
 await expect(app.locator('.cos-fleet-dashboard')).toHaveCount(0);
 await openWorkspace(app,'Field Map');
 await expect.poll(()=>counts(state).routers).toBe(4);
 await expect(app.locator('.cos-fleet-message')).toContainText('Synthetic saved camera read unavailable');
 await expect(app.getByRole('button',{name:'↻ Refresh data',exact:true})).toBeEnabled();
 expect(counts(state).health).toBe(2);expect(counts(state).map).toBe(2);
 state.gate.resolve();state.gate=null;
 await expect(app.locator('.cos-fleet-stat-field strong')).toHaveText('1');
 await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('0');
 await expect(app.locator('.cos-fleet-stat-unknown strong')).toHaveText('1');
 await expect(app.locator('.cos-fleet-message')).toContainText('Synthetic saved camera read unavailable');
 // Settled partial data was not promoted into a complete current snapshot.
 state.failed=false;await app.getByRole('button',{name:'↻ Refresh data',exact:true}).click();
 await expect.poll(()=>counts(state).health).toBe(3);await expect.poll(()=>counts(state).map).toBe(3);
 await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('1');
 expect(await app.locator('body').evaluate(()=>window.savedRefreshInvalidations)).toEqual([]);assertReadOnly(state);
});

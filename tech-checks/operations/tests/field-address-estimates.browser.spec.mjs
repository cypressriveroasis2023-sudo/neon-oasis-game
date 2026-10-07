import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {port,snapshot,resource} from './fixtures/camera-evidence-fixtures.mjs';
const origin='http://127.0.0.1:4173',now='2026-10-06T18:00:00Z',fresh='2026-10-06T17:55:00Z';
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
const source='us_census_address_range_estimate',prefix='COS_ADDRESS_ESTIMATE_V1|',address='100 Example Road, Test City, TX 77001';
function estimate(id,number,patch={}){
 const marker={schemaVersion:1,trackerId:id,unitNumber:'Sniper '+number,addressSha256:createHash('sha256').update(address.toLowerCase()).digest('hex'),latitude:30,longitude:-95,provider:'us_census_address_range',benchmark:'Public_AR_Current',providerMatchQuality:'Exact',matchedAddress:'100 EXAMPLE RD, TEST CITY, TX, 77001',geocodedAt:fresh,confidence:'address_range_interpolation',verified:false,liveGps:false,requiresOwnerConfirmation:true,batchId:'synthetic-batch',approvalReference:'synthetic-approval',appliedByDatabaseRole:'synthetic-role',appliedAt:fresh};
 return {id,unitNumber:'Sniper '+number,modelName:'SNIPERS',status:'field',currentLocationType:'field',address,readOnly:true,hasUnitGps:false,locationVerification:'coordinates_unverified',latitude:null,longitude:null,historicalLatitude:30,historicalLongitude:-95,historicalCoordinateSource:source,locationNote:prefix+JSON.stringify(marker),...patch};
}
async function mount(page,{holdHashes=false,restored=false,noEstimates=false}={}){
 const state={units:[estimate(ids[0],901),estimate(ids[1],902),estimate(ids[2],903,{latitude:30.1,longitude:-95.1,coordinateSource:'site',locationVerification:'owner_verified',gpsRecordedAt:fresh,locationVerifiedAt:fresh}),estimate(ids[3],904,{historicalLatitude:31,historicalCoordinateSource:'legacy_tracker',locationNote:'Old location only'})],writes:[],reads:0,offline:false};
 await page.clock.install({time:new Date(now)});
 if(noEstimates)state.units=state.units.map((u,i)=>i<2?{...u,locationNote:'No approved estimate'}:u);
 if(restored)await page.addInitScript(()=>history.replaceState({...history.state,cosFieldMapView:{status:'field',health:'all',center:[28,-94],zoom:6}},''));
 if(holdHashes)await page.addInitScript(()=>{const original=crypto.subtle.digest.bind(crypto.subtle);window.__hashResolvers=[];crypto.subtle.digest=(...args)=>original(...args).then(value=>new Promise(resolve=>window.__hashResolvers.push(()=>resolve(value))));});
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url===origin+'/address-estimate-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe src="/#field-map"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-only'},location.origin)})</script>`});
  if(url.startsWith(origin+'/'))return route.continue();
  if(/^https:\/\/[abc]\.tile\.openstreetmap\.org\//.test(url))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#34495b"/></svg>'});
  if(!url.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();
  if(request.method!=='GET'){state.writes.push(request);return route.fulfill({status:400,headers,body:'{}'});}
  if(request.path==='/api/field-map')state.reads++;
  const health=snapshot(state.units.map((u,i)=>resource(i+1,u.unitNumber,{name:'Synthetic service '+i,type:'Sniper',evidence:undefined,serviceEvidence:port((i===1||state.offline)?{status:'offline',reachable:false,confirmedOutage:true}:{})})));
  const data=request.path==='/api/session'?{authorized:true,name:'Synthetic Owner',role:'Owner',features:{fieldLocationVerification:true}}
   :request.path==='/api/field-map'?{items:state.units,summary:{fieldUnits:4,mappedUnits:1,unitGps:0,missingGps:3},generatedAt:now}
   :request.path==='/api/camera-health/summary-v2'?health
   :request.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:now}
   :request.path==='/api/equipment'?{items:[],models:[],trackerUnits:state.units}
   :request.path==='/api/daily-board'?{jobs:[],tasks:[],readiness:[],asOf:now}:{items:[]};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/address-estimate-fixture');const frame=page.frameLocator('iframe');await expect(frame.locator('.field-map-list>button')).toHaveCount(4);return {frame,state};
}
test('exact address estimates are visible by default, separate from health and verified pins',async({page},info)=>{
 const {frame,state}=await mount(page);
 await expect(frame.locator('.cos-field-pin')).toHaveCount(3);await expect(frame.locator('.cos-field-pin-estimate')).toHaveCount(2);await expect(frame.locator('.cos-field-pin-historical')).toHaveCount(0);
 const first=frame.locator('.cos-field-pin-estimate').filter({hasText:'901'}),second=frame.locator('.cos-field-pin-estimate').filter({hasText:'902'});
 await expect(first).toHaveCSS('background-color','rgb(53, 212, 138)');await expect(second).toHaveCSS('background-color','rgb(255, 115, 125)');await expect(first).toHaveCSS('border-top-style','dashed');
 await expect(frame.getByLabel('Nearby unit center').locator('option[value="'+ids[0]+'"]')).toHaveCount(0);await expect(frame.getByLabel('Nearby unit center').locator('option[value="'+ids[2]+'"]')).toHaveCount(1);
 await frame.locator('.field-map-list>button').filter({hasText:'Sniper 901'}).click();await expect(frame.getByRole('region',{name:'Address estimate'})).toContainText('not a verified unit position');await expect(frame.locator('.field-map-detail')).toContainText('U.S. Census address-range estimate');await expect(frame.getByRole('button',{name:'Save verified location',exact:true})).toHaveCount(0);
 await expect(frame.locator('.field-map-kpis article').nth(1).locator('b')).toHaveText('1');
 await frame.locator('.field-map-center').scrollIntoViewIfNeeded();await frame.locator('.field-map-center').screenshot({path:info.outputPath('address-estimate-pins.png')});
 await frame.getByLabel('Nearby unit center').selectOption(ids[2]);await expect(frame.locator('.cos-field-pin-estimate')).toHaveCount(0);await frame.getByLabel('Nearby unit center').selectOption('');await expect(frame.locator('.cos-field-pin-estimate')).toHaveCount(2);
 state.offline=true;await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect(first).toHaveCSS('background-color','rgb(255, 115, 125)');await expect(first).toContainText('EST');expect(state.writes).toHaveLength(0);
});
test('new address snapshot removes stale estimate and pending validation cannot restore it',async({page})=>{
 const {frame,state}=await mount(page,{holdHashes:true});
 await expect.poll(()=>frame.locator('body').evaluate(()=>window.__hashResolvers.length)).toBe(2);
 state.units=state.units.map((u,i)=>{if(i>=2)return u;const marker=JSON.parse(u.locationNote.slice(prefix.length));marker.matchedAddress='101 EXAMPLE RD, TEST CITY, TX, 77001';return {...u,address:'101 Example Road, Test City, TX 77001',locationNote:prefix+JSON.stringify(marker)};});
 await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect.poll(()=>state.reads).toBe(2);
 await expect.poll(()=>frame.locator('body').evaluate(()=>window.__hashResolvers.length)).toBe(4);
 await frame.locator('body').evaluate(()=>window.__hashResolvers.splice(0).reverse().forEach(resolve=>resolve()));
 await expect(frame.locator('.cos-field-pin-estimate')).toHaveCount(0);await expect(frame.locator('.cos-field-pin')).toHaveCount(1);expect(state.writes).toHaveLength(0);
});
for(const noEstimates of [false,true])test('restored map viewport survives asynchronous validation '+(noEstimates?'without estimates':'with estimates'),async({page})=>{
 const {frame}=await mount(page,{restored:true,noEstimates});
 await expect(frame.locator('.cos-field-pin')).toHaveCount(noEstimates?1:3);
 await page.clock.runFor(1000);
 const view=await frame.locator('body').evaluate(()=>history.state.cosFieldMapView);
 expect(view.center).toEqual([28,-94]);expect(view.zoom).toBe(6);
});
test('user viewport changes while hashes are pending are not replaced by late estimates',async({page})=>{
 const {frame}=await mount(page,{holdHashes:true});
 await expect.poll(()=>frame.locator('body').evaluate(()=>window.__hashResolvers.length)).toBe(2);
 await frame.locator('.field-map-center').scrollIntoViewIfNeeded();await frame.locator('.leaflet-control-zoom-in').click();await page.clock.runFor(1000);
 const before=await frame.locator('body').evaluate(()=>history.state.cosFieldMapView);
 await frame.locator('body').evaluate(()=>window.__hashResolvers.splice(0).forEach(resolve=>resolve()));
 await expect(frame.locator('.cos-field-pin-estimate')).toHaveCount(2);await page.clock.runFor(1000);
 const after=await frame.locator('body').evaluate(()=>history.state.cosFieldMapView);expect(after.center).toEqual(before.center);expect(after.zoom).toBe(before.zoom);
});

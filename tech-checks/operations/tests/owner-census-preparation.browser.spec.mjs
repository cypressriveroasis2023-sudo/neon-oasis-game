import {test,expect} from '@playwright/test';
import {fixture,receipt,id,preparationOwner,now} from './owner-census-preparation-fixtures.mjs';
import {otherId} from './owner-census-once-fixtures.mjs';
const origin=process.env.COS_MAP_TEST_ORIGIN||'http://127.0.0.1:4173';
const deferred=()=>{let resolve;const promise=new Promise(y=>{resolve=y;});return {promise,resolve};};
async function openLocationUnit(frame,name){const close=frame.getByRole('button',{name:'Close unit details',exact:true});if(await close.isVisible())await close.click();await frame.getByRole('button',{name:'Clear fleet search'}).click();await frame.locator('.cos-fleet-unit-row').filter({hasText:name}).click();await frame.getByRole('button',{name:'Edit / verify installation →',exact:true}).click();}
async function mount(page,{role='Owner',marker=true,holdPost=false,response=receipt()}={}){
 const f=fixture();if(!marker)delete f.row.locationGeocode.censusPreparation;
 f.snapshot.items.push({id:otherId,unitNumber:'SYNTHETIC OTHER 901',status:'field',currentLocationType:'field',readOnly:false,address:'300 Other Fixture Road, Testville, TX 77003',latitude:32,longitude:-97,coordinateSource:'manual',locationVerification:'owner_verified',gpsRecordedAt:'2026-10-11T00:00:00Z',locationVerifiedAt:'2026-10-11T00:00:00Z'});
 Object.assign(f.snapshot.summary,{fieldUnits:2,mappedUnits:1,missingGps:1});
 const state={snapshot:f.snapshot,session:role==='Owner'?preparationOwner:{...preparationOwner,role,legacyOwner:false,features:{fleetAccess:true,fieldLocationVerification:false}},posts:[],postGate:deferred(),postResponses:0,afterPost:null,mapGate:null,heldMapFinished:0,holdPost,response};
 await page.clock.install({time:new Date(now)});
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url===origin+'/owner-preparation-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe src="/${role==='IT'?'?mode=fleet':''}#field-map"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'${role.toLowerCase()}',accessToken:'synthetic-only'},location.origin)})</script>`});
  if(url.startsWith(origin+'/'))return route.continue();
  if(/^https:\/\/[abc]\.tile\.openstreetmap\.org\//.test(url))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#34495b"/></svg>'});
  if(!url.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();
  if(request.method!=='GET'){
   state.posts.push(request);
   if(request.path!=='/api/field-map/'+id+'/owner-census-prepare')return route.fulfill({status:400,headers,body:'{}'});
   if(state.holdPost)await state.postGate.promise;
   state.afterPost?.(state.snapshot);state.postResponses++;
   return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(state.response)}).catch(()=>{/* Invalidating the session or selection aborts this synthetic request. */});
  }
  let heldMap=false;
  if(request.path==='/api/field-map'&&state.mapGate){const gate=state.mapGate;state.mapGate=null;heldMap=true;await gate.promise;}
  const data=request.path==='/api/session'?state.session:request.path==='/api/field-map'?state.snapshot
   :request.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:f.snapshot.generatedAt}
   :request.path==='/api/camera-health/summary-v3'?{evidenceVersion:2,rows:[],totalDevices:0,online:0,offline:0,review:0,shopRoot:0,healthRows:0,fieldDevices:0,refreshedAt:f.snapshot.generatedAt,inventory:{allRecords:0,activeFieldRecords:0,activeShopRecords:0,inactiveRecords:0,unknownScopeRecords:0}}
   :request.path==='/api/equipment'?{items:[],models:[],trackerUnits:state.snapshot.items}:{items:[]};
  await route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
  if(heldMap)state.heldMapFinished++;
 });
 // Synthetic unknown-health rows are deliberately reviewed through the existing All health filter.
 await page.addInitScript(()=>{if(parent!==window)history.replaceState({...history.state,cosFieldMapView:{...history.state?.cosFieldMapView,health:'all'}},'');});
 await page.goto('/owner-preparation-fixture');const frame=page.frameLocator('iframe');
 if(role!=='Service'){await expect(frame.locator('.cos-fleet-unit-row')).toHaveCount(2);await openLocationUnit(frame,'SYNTHETIC BOUNDARY 900');}
 return {frame,state};
}
const prepare=frame=>frame.getByRole('button',{name:'Prepare approved lookup',exact:true});
const proof=frame=>frame.getByLabel('Read-only preparation receipt',{exact:true});
test('explicit preparation displays two complete review digests and server time with no allowance or provider action, including 390px wrapping',async({page})=>{
 const {frame,state}=await mount(page),before=structuredClone(state.snapshot);
 await expect(prepare(frame)).toBeVisible();await prepare(frame).click();
 await expect(proof(frame)).toBeVisible();
 for(const value of [receipt().nativeGuardSha256,receipt().nativeSourceSha256,receipt().preparedAt])await expect(proof(frame).getByText(value,{exact:true})).toBeVisible();
 await expect(frame.getByRole('region',{name:'Approved lookup preparation'})).toContainText('No lookup was started and no allowance was enrolled');
 await expect(frame.getByRole('button',{name:'Run approved Census lookup',exact:true})).toHaveCount(0);
 expect(state.posts).toHaveLength(1);expect(state.posts[0].path).toBe('/api/field-map/'+id+'/owner-census-prepare');
 expect(Object.keys(state.posts[0].body).sort()).toEqual(['addressSha256','auditId','unitKey']);expect(state.snapshot).toEqual(before);
 const overflow=await proof(frame).evaluate(el=>({self:el.scrollWidth-el.clientWidth,page:document.documentElement.scrollWidth-document.documentElement.clientWidth,hashes:[...el.querySelectorAll('dd')].map(node=>node.scrollWidth-node.clientWidth)}));
 expect(overflow.self).toBeLessThanOrEqual(1);expect(overflow.page).toBeLessThanOrEqual(1);for(const width of overflow.hashes)expect(width).toBeLessThanOrEqual(1);
 await frame.getByRole('button',{name:'Refresh installation evidence',exact:true}).click();await expect(proof(frame)).toHaveCount(0);expect(state.posts).toHaveLength(1);
});
for(const role of ['IT','Service'])test(role+' cannot see or invoke Owner preparation',async({page})=>{
 const {frame,state}=await mount(page,{role});await expect(prepare(frame)).toHaveCount(0);await expect(proof(frame)).toHaveCount(0);expect(state.posts).toHaveLength(0);
});
test('missing private marker never enables preparation',async({page})=>{
 const {frame,state}=await mount(page,{marker:false});await expect(prepare(frame)).toHaveCount(0);expect(state.posts).toHaveLength(0);
});
test('duplicate clicks prepare once and selection away and back clears the visible receipt',async({page})=>{
 const {frame,state}=await mount(page,{holdPost:true});await expect(prepare(frame)).toBeVisible();await prepare(frame).evaluate(el=>{el.click();el.click();});await expect.poll(()=>state.posts.length).toBe(1);
 state.postGate.resolve();await expect(proof(frame)).toBeVisible();
 await openLocationUnit(frame,'SYNTHETIC OTHER 901');await expect(proof(frame)).toHaveCount(0);
 await openLocationUnit(frame,'SYNTHETIC BOUNDARY 900');await expect(proof(frame)).toHaveCount(0);expect(state.posts).toHaveLength(1);
});
test('changed source before preparation sends no proof request',async({page})=>{
 const {frame,state}=await mount(page);await expect(prepare(frame)).toBeVisible();state.snapshot=structuredClone(state.snapshot);state.snapshot.items[0].historicalRecordedAt='2026-10-09T00:00:00Z';
 await prepare(frame).click();await expect(frame.getByRole('region',{name:'Approved lookup preparation'})).toContainText('installation changed');await expect(proof(frame)).toHaveCount(0);expect(state.posts).toHaveLength(0);
});
test('later source change rejects a proof receipt and does not start a lookup',async({page})=>{
 const {frame,state}=await mount(page,{holdPost:true});await prepare(frame).click();await expect.poll(()=>state.posts.length).toBe(1);
 state.afterPost=snapshot=>{snapshot.items[0].locationNote='Synthetic new manual history note';};state.postGate.resolve();
 await expect(frame.getByRole('region',{name:'Approved lookup preparation'})).toContainText('changed during preparation');await expect(proof(frame)).toHaveCount(0);expect(state.posts).toHaveLength(1);
});
test('selection away and back during preparation preflight sends zero preparation requests',async({page})=>{
 const {frame,state}=await mount(page),gate=deferred();state.mapGate=gate;
 await page.clock.pauseAt(new Date(now+60000));const workspace=await frame.locator('.cos-fleet-dashboard').elementHandle();
 await prepare(frame).click();await expect.poll(()=>state.mapGate===null).toBe(true);
 for(const unitId of [otherId,id]){
  await frame.locator('body').evaluate((_body,value)=>{location.hash='#field-map?unit='+value;},unitId);
  await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#fleet-dashboard?unit='+unitId);
  await expect(frame.locator('.cos-fleet-unit-row.selected')).toHaveAttribute('data-unit-id',unitId);
  expect(state.writes?.length||state.posts?.length||0).toBeLessThanOrEqual(1);
  expect(await workspace.evaluate(node=>node.isConnected&&node===document.querySelector('.cos-fleet-dashboard'))).toBe(true);
 }
 await expect(proof(frame)).toHaveCount(0);gate.resolve();await expect.poll(()=>state.heldMapFinished).toBe(1);
 await expect(frame.locator('.cos-fleet-unit-list')).toHaveAttribute('aria-busy','false');
 expect(state.posts).toHaveLength(0);await expect(proof(frame)).toHaveCount(0);await expect(prepare(frame)).toBeEnabled();
});
test('selection away and back during preparation cannot admit a late receipt',async({page})=>{
 const {frame,state}=await mount(page,{holdPost:true});await page.clock.pauseAt(new Date(now+60000));
 const workspace=await frame.locator('.cos-fleet-dashboard').elementHandle();await prepare(frame).click();await expect.poll(()=>state.posts.length).toBe(1);
 expect(state.writes?.length||state.posts?.length||0).toBeLessThanOrEqual(1);
 for(const unitId of [otherId,id]){
  await frame.locator('body').evaluate((_body,value)=>{location.hash='#field-map?unit='+value;},unitId);
  await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#fleet-dashboard?unit='+unitId);
  await expect(frame.locator('.cos-fleet-unit-row.selected')).toHaveAttribute('data-unit-id',unitId);
  expect(await workspace.evaluate(node=>node.isConnected&&node===document.querySelector('.cos-fleet-dashboard'))).toBe(true);
 }
 state.postGate.resolve();await expect.poll(()=>state.postResponses).toBe(1);
 await expect(frame.locator('.cos-fleet-unit-list')).toHaveAttribute('aria-busy','false');await expect(proof(frame)).toHaveCount(0);expect(state.posts).toHaveLength(1);
});
test('session-role invalidation clears preparation and rejects a late receipt',async({page})=>{
 const {frame,state}=await mount(page,{holdPost:true});await prepare(frame).click();await expect.poll(()=>state.posts.length).toBe(1);
 state.session={...preparationOwner,role:'IT',legacyOwner:false};await frame.locator('body').evaluate(()=>window.dispatchEvent(new Event('cos-private-data-invalidated')));
 state.postGate.resolve();await expect.poll(()=>state.postResponses).toBe(1);await expect(prepare(frame)).toHaveCount(0);await expect(proof(frame)).toHaveCount(0);expect(state.posts).toHaveLength(1);
});
for(const [label,response] of [['duplicate receipt',[receipt(),receipt()]],['extra raw data',{...receipt(),history:[]}],['malformed time',{...receipt(),preparedAt:'2026-02-30T12:00:00Z'}]])test(label+' cannot appear as reviewed proof',async({page})=>{
 const {frame,state}=await mount(page,{response});await prepare(frame).click();await expect(frame.getByRole('region',{name:'Approved lookup preparation'})).toContainText('incomplete or unsupported proof');await expect(proof(frame)).toHaveCount(0);expect(state.posts).toHaveLength(1);
});
test('preparation timeout is read-only and requires a new deliberate preparation after refresh',async({page})=>{
 const {frame,state}=await mount(page,{holdPost:true});await prepare(frame).click();await expect.poll(()=>state.posts.length).toBe(1);
 await page.clock.runFor(31000);await expect(frame.getByRole('region',{name:'Approved lookup preparation'})).toContainText('could not be confirmed');await expect(proof(frame)).toHaveCount(0);expect(state.posts).toHaveLength(1);
 state.postGate.resolve();await expect.poll(()=>state.postResponses).toBe(1);await frame.getByRole('button',{name:'Refresh installation evidence',exact:true}).click();await expect(prepare(frame)).toBeVisible();expect(state.posts).toHaveLength(1);
 state.holdPost=false;state.response={...receipt(),preparedAt:new Date(now+31000).toISOString()};await prepare(frame).click();await expect(proof(frame)).toBeVisible();expect(state.posts).toHaveLength(2);
 for(const post of state.posts)expect(post.path).toMatch(/\/owner-census-prepare$/);
});

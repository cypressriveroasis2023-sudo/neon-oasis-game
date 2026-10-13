import {test,expect} from '@playwright/test';
import {fixture,consumed,id,otherId,owner,now} from './owner-census-once-fixtures.mjs';
const origin=process.env.COS_MAP_TEST_ORIGIN||'http://127.0.0.1:4173';
const deferred=()=>{let resolve;const promise=new Promise(y=>{resolve=y;});return {promise,resolve};};
async function mount(page,{role='Owner',proof=true,outcome='success',holdPost=false,policyState=null,initialOutcome=null}={}){
 const f=fixture();if(!proof)delete f.snapshot.ownerCensusProofs;
 if(policyState==='draining'){f.row.locationGeocode.censusOnlyState='draining';f.row.locationGeocode.censusOnlyNotBefore='2020-01-01T00:00:00Z';}
 if(policyState==='held'){f.row.locationGeocode.status='held';delete f.row.locationGeocode.censusOnlyGuard;}
 const other={id:otherId,unitNumber:'SYNTHETIC OTHER 901',status:'field',currentLocationType:'field',readOnly:false,address:'300 Other Fixture Road, Testville, TX 77003',latitude:32,longitude:-97,coordinateSource:'manual',locationVerification:'owner_verified',gpsRecordedAt:'2026-10-11T00:00:00Z',locationVerifiedAt:'2026-10-11T00:00:00Z'};
 f.snapshot.items.push(other);Object.assign(f.snapshot.summary,{fieldUnits:2,mappedUnits:1,missingGps:1});
 const state={snapshot:initialOutcome?consumed(f.snapshot,initialOutcome):f.snapshot,session:role==='Owner'?owner:{...owner,role,legacyOwner:false,features:{fleetAccess:true,fieldLocationVerification:false}},writes:[],postGate:deferred(),postResponses:0,afterPost:null,mapGate:null,heldMapFinished:0,outcome,holdPost};
 await page.clock.install({time:new Date(now)});
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url===origin+'/owner-once-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe src="/${role==='IT'?'?mode=fleet':''}#field-map"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'${role.toLowerCase()}',accessToken:'synthetic-only'},location.origin)})</script>`});
  if(url.startsWith(origin+'/'))return route.continue();
  if(/^https:\/\/[abc]\.tile\.openstreetmap\.org\//.test(url))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#34495b"/></svg>'});
  if(!url.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();
  if(request.method!=='GET'){
   state.writes.push(request);
   if(request.path!=='/api/field-map/'+id+'/owner-census-once')return route.fulfill({status:400,headers,body:'{}'});
   if(state.holdPost)await state.postGate.promise;
   state.snapshot=consumed(state.snapshot,state.outcome);
   state.afterPost?.(state.snapshot);state.postResponses++;
   return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({ok:true,results:[{auditId:'9001',status:state.outcome,censusOnly:true,allowance:'consumed'}],censusOnly:true,allowance:'consumed'})}).catch(()=>{/* Session invalidation may already have aborted this synthetic request. */});
  }
  let heldMap=false;
  if(request.path==='/api/field-map'&&state.mapGate){const gate=state.mapGate;state.mapGate=null;heldMap=true;await gate.promise;}
  const data=request.path==='/api/session'?state.session:request.path==='/api/field-map'?state.snapshot
   :request.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:f.snapshot.generatedAt}
   :request.path==='/api/camera-health/summary-v3'?{evidenceVersion:2,rows:[],totalDevices:0,refreshedAt:f.snapshot.generatedAt}
   :request.path==='/api/equipment'?{items:[],models:[],trackerUnits:state.snapshot.items}:{items:[]};
  await route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
  if(heldMap)state.heldMapFinished++;
 });
 await page.goto('/owner-once-fixture');const frame=page.frameLocator('iframe');
 if(role!=='Service'){await expect(frame.locator('.field-map-list>button')).toHaveCount(2);await frame.locator('.field-map-list>button').filter({hasText:'SYNTHETIC BOUNDARY 900'}).click();}
 return {frame,state};
}
test('complete enrolled Owner proof enables one deliberate lookup, duplicate clicks send once, reload reads consumed result',async({page})=>{
 const {frame,state}=await mount(page,{holdPost:true}),before=structuredClone(state.snapshot.items[0]);
 const button=frame.getByRole('button',{name:'Run approved Census lookup',exact:true});await expect(button).toBeVisible();
 await button.evaluate(el=>{el.click();el.click();});await expect.poll(()=>state.writes.length).toBe(1);
 expect(Object.keys(state.writes[0].body).sort()).toEqual(['addressSha256','auditId','nativeGuardSha256','unitKey']);
 state.postGate.resolve();await expect(frame.getByRole('region',{name:'Address estimate'})).toContainText('suite and installed unit position remain unverified');
 await expect(button).toHaveCount(0);await expect(frame.getByLabel('Nearby unit center').locator('option[value="'+id+'"]')).toHaveCount(0);
 expect(state.snapshot.items[0].hasUnitGps).toBe(before.hasUnitGps);expect(state.snapshot.items[0].historicalRecordedAt).toBe(before.historicalRecordedAt);expect(state.snapshot.items[0].locationNote).toBe(before.locationNote);
 await page.reload();await frame.locator('.field-map-list>button').filter({hasText:'SYNTHETIC BOUNDARY 900'}).click();
 await expect(button).toHaveCount(0);await expect(frame.getByRole('region',{name:'Approved Census lookup'})).toContainText('already used');expect(state.writes).toHaveLength(1);
});
for(const role of ['IT','Service'])test(role+' cannot see or dispatch the Owner-only lookup',async({page})=>{
 const {frame,state}=await mount(page,{role});await expect(frame.getByRole('button',{name:'Run approved Census lookup',exact:true})).toHaveCount(0);expect(state.writes).toHaveLength(0);
});
test('existing IT map readers see a server-admitted building estimate without an execution action',async({page})=>{
 const {frame,state}=await mount(page,{role:'IT',initialOutcome:'success'});
 await expect(frame.getByRole('region',{name:'Address estimate'})).toContainText('suite and installed unit position remain unverified');
 await expect(frame.getByRole('button',{name:'Run approved Census lookup',exact:true})).toHaveCount(0);
 await expect(frame.getByRole('region',{name:'Approved Census lookup'})).toHaveCount(0);
 await expect(frame.getByLabel('Nearby unit center').locator('option[value="'+id+'"]')).toHaveCount(0);
 expect(state.writes).toHaveLength(0);
});
test('ready marker without complete native proof never exposes an action',async({page})=>{
 const {frame,state}=await mount(page,{proof:false});await expect(frame.getByRole('button',{name:'Run approved Census lookup',exact:true})).toHaveCount(0);expect(state.writes).toHaveLength(0);
});
for(const policyState of ['draining','held'])test(policyState+' explains safe hold and never starts or exposes a lookup',async({page})=>{
 const {frame,state}=await mount(page,{policyState});
 await expect(frame.getByRole('region',{name:'Approved Census lookup'})).toContainText(policyState==='draining'?'waiting for earlier address work':'on hold');
 await expect(frame.getByRole('button',{name:'Run approved Census lookup',exact:true})).toHaveCount(0);
 await page.clock.runFor(480001);await expect(frame.getByRole('button',{name:'Run approved Census lookup',exact:true})).toHaveCount(0);expect(state.writes).toHaveLength(0);
});
test('fresh changed suite preflight sends no lookup and requires review',async({page})=>{
 const {frame,state}=await mount(page);const button=frame.getByRole('button',{name:'Run approved Census lookup',exact:true});await expect(button).toBeVisible();
 state.snapshot=structuredClone(state.snapshot);state.snapshot.items[0].address=state.snapshot.items[0].address.replace('700','701');
 await button.click();await expect(frame.getByRole('region',{name:'Approved Census lookup'})).toContainText('no lookup was sent');expect(state.writes).toHaveLength(0);
});
test('selection change during fresh preflight cannot send the prior unit lookup',async({page})=>{
 const {frame,state}=await mount(page),gate=deferred();state.mapGate=gate;
 // Keep the API deadline frozen: disabled list clicks must not wait out the preflight.
 await page.clock.pauseAt(new Date(now+60000));
 const workspace=await frame.locator('.field-map-workspace').elementHandle();
 const button=frame.getByRole('button',{name:'Run approved Census lookup',exact:true});await expect(button).toBeVisible();await button.click();
 await expect.poll(()=>state.mapGate===null).toBe(true);
 await expect(frame.locator('.field-map-list')).toHaveAttribute('aria-busy','true');
 await frame.locator('body').evaluate((_body,unitId)=>{location.hash='#field-map?unit='+unitId;},otherId);
 await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#field-map?unit='+otherId);
 await expect(frame.locator('.field-map-list>button.selected')).toHaveAttribute('data-unit-id',otherId);
 await expect(frame.locator('.field-map-list')).toHaveAttribute('aria-busy','true');
 expect(await workspace.evaluate(node=>node.isConnected&&node===document.querySelector('.field-map-workspace'))).toBe(true);
 gate.resolve();await expect.poll(()=>state.heldMapFinished).toBe(1);
 // Busy clears only after the action's finally block has settled.
 await expect(frame.locator('.field-map-list')).toHaveAttribute('aria-busy','false');
 expect(state.writes).toHaveLength(0);await expect(frame.getByRole('region',{name:'Approved Census lookup'})).toHaveCount(0);
});
test('session-role change clears pending action and rejects a late response',async({page})=>{
 const {frame,state}=await mount(page,{holdPost:true});await frame.getByRole('button',{name:'Run approved Census lookup',exact:true}).click();await expect.poll(()=>state.writes.length).toBe(1);
 state.session={...owner,legacyOwner:false,role:'IT'};
 await frame.locator('body').evaluate(()=>window.dispatchEvent(new Event('cos-private-data-invalidated')));
 await expect(frame.getByRole('button',{name:'Run approved Census lookup',exact:true})).toHaveCount(0);
 state.postGate.resolve();await expect.poll(()=>state.postResponses).toBe(1);await page.clock.runFor(1000);await expect(frame.getByRole('region',{name:'Address estimate'})).toHaveCount(0);expect(state.writes).toHaveLength(1);
});
test('later Owner-verified GPS wins when a one-shot result arrives',async({page})=>{
 const {frame,state}=await mount(page,{holdPost:true});await frame.getByRole('button',{name:'Run approved Census lookup',exact:true}).click();await expect.poll(()=>state.writes.length).toBe(1);
 state.afterPost=snapshot=>Object.assign(snapshot.items[0],{latitude:32.5,longitude:-97.5,coordinateSource:'manual',locationVerification:'owner_verified',gpsRecordedAt:'2026-10-11T01:00:00Z',locationVerifiedAt:'2026-10-11T01:00:00Z',locationHistoryId:'33333333-3333-4333-8333-333333333333'});
 state.postGate.resolve();await expect(frame.getByRole('region',{name:'Approved Census lookup'})).toContainText('remains authoritative');
 await expect(frame.getByRole('region',{name:'Address estimate'})).toHaveCount(0);await expect(frame.getByLabel('Nearby unit center').locator('option[value="'+id+'"]')).toHaveCount(1);
 expect(state.writes).toHaveLength(1);expect(state.writes[0].path).not.toMatch(/\/gps$/);
});
test('one-shot no match shows stopped outcome and never enables a second lookup',async({page})=>{
 const {frame,state}=await mount(page,{outcome:'no_match'});await frame.getByRole('button',{name:'Run approved Census lookup',exact:true}).click();
 await expect(frame.getByRole('region',{name:'Approved Census lookup'})).toContainText('no usable building estimate');await expect(frame.getByRole('region',{name:'Address estimate'})).toHaveCount(0);
 await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect(frame.getByRole('button',{name:'Run approved Census lookup',exact:true})).toHaveCount(0);expect(state.writes).toHaveLength(1);
});
test('refresh after a successful lookup replaces its message with the latest held policy',async({page})=>{
 const {frame,state}=await mount(page);await frame.getByRole('button',{name:'Run approved Census lookup',exact:true}).click();
 const region=frame.getByRole('region',{name:'Approved Census lookup'});await expect(region).toContainText('building estimate is available');
 state.snapshot=structuredClone(state.snapshot);state.snapshot.items[0].locationGeocode.status='held';delete state.snapshot.items[0].locationGeocode.censusOnlyGuard;delete state.snapshot.ownerCensusProofs;
 await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect(region).toContainText('on hold');await expect(region).not.toContainText('building estimate is available');
 await expect(frame.getByRole('region',{name:'Address estimate'})).toHaveCount(0);expect(state.writes).toHaveLength(1);
});
test('selection away and back during Run preflight invalidates the old action without a POST',async({page})=>{
 const {frame,state}=await mount(page),gate=deferred();state.mapGate=gate;
 await page.clock.pauseAt(new Date(now+60000));
 const workspace=await frame.locator('.field-map-workspace').elementHandle();
 await frame.getByRole('button',{name:'Run approved Census lookup',exact:true}).click();await expect.poll(()=>state.mapGate===null).toBe(true);
 // Hash-route unit selection is supported while busy; unlike list clicks it does not wait for a timeout.
 for(const unitId of [otherId,id]){
  await frame.locator('body').evaluate((_body,value)=>{location.hash='#field-map?unit='+value;},unitId);
  await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#field-map?unit='+unitId);
  await expect(frame.locator('.field-map-list>button.selected')).toHaveAttribute('data-unit-id',unitId);
  await expect(frame.locator('.field-map-list')).toHaveAttribute('aria-busy','true');
  expect(await workspace.evaluate(node=>node.isConnected&&node===document.querySelector('.field-map-workspace'))).toBe(true);
 }
 // The same component is back at the original unit, so selection equality alone would admit the stale action.
 await expect(frame.getByRole('button',{name:'Run approved Census lookup',exact:true})).toBeDisabled();
 gate.resolve();await expect.poll(()=>state.heldMapFinished).toBe(1);
 await expect(frame.locator('.field-map-list')).toHaveAttribute('aria-busy','false');
 expect(state.writes).toHaveLength(0);
 await expect(frame.getByRole('button',{name:'Run approved Census lookup',exact:true})).toBeEnabled();
});

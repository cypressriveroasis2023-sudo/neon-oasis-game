import {revealMapFilters,revealMapInfo} from './field-map-controls.mjs';
import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {port,snapshot,resource} from './fixtures/camera-evidence-fixtures.mjs';
const origin=process.env.COS_MAP_TEST_ORIGIN||'http://127.0.0.1:4173',now='2026-10-06T18:00:00Z',fresh='2026-10-06T17:55:00Z';
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
const source='us_census_address_range_estimate',prefix='COS_ADDRESS_ESTIMATE_V1|',address='100 Example Road, Test City, TX 77001';
function estimate(id,number,patch={}){
 const marker={schemaVersion:1,trackerId:id,unitNumber:'Sniper '+number,addressSha256:createHash('sha256').update(address.toLowerCase()).digest('hex'),latitude:30,longitude:-95,provider:'us_census_address_range',benchmark:'Public_AR_Current',providerMatchQuality:'Exact',matchedAddress:'100 EXAMPLE RD, TEST CITY, TX, 77001',geocodedAt:fresh,confidence:'address_range_interpolation',verified:false,liveGps:false,requiresOwnerConfirmation:true,batchId:'synthetic-batch',approvalReference:'synthetic-approval',appliedByDatabaseRole:'synthetic-role',appliedAt:fresh};
 return {id,unitNumber:'Sniper '+number,modelName:'SNIPERS',status:'field',currentLocationType:'field',address,readOnly:true,hasUnitGps:false,locationVerification:'coordinates_unverified',latitude:null,longitude:null,historicalLatitude:30,historicalLongitude:-95,historicalCoordinateSource:source,locationNote:prefix+JSON.stringify(marker),...patch};
}
async function mount(page,{holdHashes=false,restored=false,noEstimates=false,registered=false,noCameras=false}={}){
 const state={units:[estimate(ids[0],901),estimate(ids[1],902),estimate(ids[2],903,{latitude:30.1,longitude:-95.1,coordinateSource:'site',locationVerification:'owner_verified',gpsRecordedAt:fresh,locationVerifiedAt:fresh}),estimate(ids[3],904,{historicalLatitude:31,historicalCoordinateSource:'legacy_tracker',locationNote:'Old location only'})],writes:[],reads:0,offline:false,mapFailure:false};
 if(registered)state.units[0]={...state.units[0],id:'99999999-9999-4999-8999-999999999999',readOnly:false,currentLocationType:null,addressEstimateTrackerId:ids[0],addressEstimateUnitNumber:'Sniper 901'};
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
  if(request.path==='/api/field-map'&&state.mapFailure)return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:'Imported address lookup results are unavailable. The map could not be refreshed.'})});
  const health=snapshot((noCameras?[]:state.units).map((u,i)=>resource(i+1,u.unitNumber,{name:'Synthetic service '+i,type:'Sniper',evidence:undefined,serviceEvidence:port((i===1||state.offline)?{status:'offline',reachable:false,confirmedOutage:true}:{})})));
  const data=request.path==='/api/session'?{authorized:true,name:'Synthetic Owner',role:'Owner',features:{fieldLocationVerification:true}}
   :request.path==='/api/field-map'?{items:state.units,summary:{fieldUnits:state.units.length,mappedUnits:1,unitGps:0,missingGps:state.units.length-1},generatedAt:now}
   :request.path==='/api/camera-health/summary-v3'?health
   :request.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:now}
   :request.path==='/api/equipment'?{items:[],models:[],trackerUnits:state.units}
   :request.path==='/api/daily-board'?{jobs:[],tasks:[],readiness:[],asOf:now}:{items:[]};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/address-estimate-fixture');const frame=page.frameLocator('iframe');await expect(frame.locator('.field-map-list>button')).toHaveCount(4);return {frame,state};
}
// Expanded markers represent their units; only collapsed summaries add member identities.
// Fail on duplicates rather than hiding them with a Set or changing expected counts.
const renderedUnitCount=(frame,estimated=false)=>frame.locator('.field-map-canvas').evaluate((el,estimated)=>{
 const pins=[...el.querySelectorAll('.cos-field-pin-wrap')].filter(node=>!estimated||node.querySelector('.cos-field-pin-estimate'));
 const ids=pins.map(node=>node.dataset.unitId);
 for(const node of el.querySelectorAll('.cos-field-cluster-wrap:not(.cos-field-cluster-expanded)')){const raw=node.getAttribute(estimated?'data-estimate-unit-ids':'data-unit-ids');if(raw===null)throw Error('Missing rendered cluster identities');const members=JSON.parse(raw);if(!Array.isArray(members)||members.some(id=>typeof id!=='string'||!id.trim()))throw Error('Malformed rendered cluster identities');ids.push(...members);}
 if(ids.some(id=>!id)||new Set(ids).size!==ids.length)throw Error('Missing or duplicate rendered unit identity');
 return ids.length;
},estimated);
const mappedCount=frame=>renderedUnitCount(frame);
const estimatedCount=frame=>renderedUnitCount(frame,true);
test('failed imported lookup refresh retains labeled last-good estimates and recovers without bypassing a new address guard',async({page})=>{
 const {frame,state}=await mount(page,{registered:true}),row=state.units[0];
 const binding={schemaVersion:1,organizationId:'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',sourceSystem:'mhelpdesk_product_import',entityKind:'equipment_unit',nativeUnitId:row.id,productId:'12345',unitNumber:row.unitNumber,family:'SNIPER',variant:null,sourceRevision:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sourceFileSha256:'a'.repeat(64),sourceRowSha256:'b'.repeat(64),addressSha256:createHash('sha256').update(address.toLowerCase()).digest('hex'),nativeGuardSha256:'c'.repeat(64),installation:{street:'100 Example Road',city:'Test City',state:'TX',zip:'77001'},suppliedComponents:{street:true,city:true,state:true,zip:true},eligibility:'FIELD',eventId:'1'};
 state.units[0]={...row,currentLocationType:'field',locationVerification:'address_only',importedInstallation:binding,importedPlacement:'FIELD',locationImportedGeocode:{jobKind:'native_import',binding,legacyGuardSha256:'d'.repeat(64),status:'success',provider:'geocodio',verified:false,liveGps:false,latitude:30,longitude:-95,matchedAddress:address,geocodedAt:fresh,accuracyType:'rooftop',accuracy:1,matchType:null}};
 await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect.poll(()=>estimatedCount(frame)).toBe(2);
 await frame.locator('.field-map-list>button').filter({hasText:'Sniper 901'}).click();await expect(frame.getByRole('region',{name:'Address estimate'})).toContainText('Geocodio');
 const before=state.reads;state.mapFailure=true;await frame.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(frame.getByRole('alert')).toContainText('Showing the last successfully loaded units');await expect(frame.getByRole('alert')).toContainText('Imported address lookup results are unavailable');
 await expect.poll(()=>estimatedCount(frame)).toBe(2);await expect.poll(()=>mappedCount(frame)).toBe(3);await expect(frame.locator('.field-map-list>button')).toHaveCount(4);
 await page.clock.runFor(1000);expect(state.reads).toBe(before+1);
 state.mapFailure=false;state.units[0].locationImportedGeocode={...state.units[0].locationImportedGeocode,latitude:30.2,longitude:-95.2};
 await frame.getByRole('button',{name:'Retry map load'}).click();await expect(frame.locator('.field-map-error')).toHaveCount(0);await expect(frame.getByRole('region',{name:'Address estimate'})).toContainText('30.2, -95.2');
 state.units[0]={...state.units[0],address:'101 Example Road, Test City, TX 77001'};await frame.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect.poll(()=>estimatedCount(frame)).toBe(1);await expect(frame.getByRole('region',{name:'Address estimate'})).toHaveCount(0);expect(state.writes).toHaveLength(0);
});
test('initial imported lookup failure is visibly unavailable and explicit retry restores eligible points',async({page})=>{
 const {frame,state}=await mount(page);await expect.poll(()=>estimatedCount(frame)).toBe(2);state.mapFailure=true;await page.reload();
 await expect(frame.getByRole('alert')).toContainText('This does not mean the fleet is empty');await expect(frame.getByRole('alert')).toContainText('Imported address lookup results are unavailable');
 await expect(frame.locator('.field-map-layout')).toHaveCount(0);await expect(frame.getByText('No units match this filter.',{exact:true})).toHaveCount(0);
 const before=state.reads;await page.clock.runFor(1000);expect(state.reads).toBe(before);
 state.mapFailure=false;await frame.getByRole('button',{name:'Retry map load'}).click();await expect.poll(()=>estimatedCount(frame)).toBe(2);await expect.poll(()=>mappedCount(frame)).toBe(3);expect(state.writes).toHaveLength(0);
});
test('exact address estimates are visible by default, separate from health and verified pins',async({page},info)=>{
 const {frame,state}=await mount(page);
 await expect.poll(()=>mappedCount(frame)).toBe(3);await expect.poll(()=>estimatedCount(frame)).toBe(2);await expect(frame.locator('.cos-field-pin-historical')).toHaveCount(0);
 const cluster=frame.locator('.cos-field-cluster');await expect(cluster.locator('b')).toHaveText('2');await expect(cluster.locator('.cos-cluster-location')).toHaveText('EST');await expect(cluster).toHaveAttribute('data-health','mixed');
 await frame.locator('.cos-field-cluster-wrap').click();await expect(frame.locator('.field-cluster-list button').filter({hasText:'Sniper 901'})).toContainText('IP / PORT ONLINE');await expect(frame.locator('.field-cluster-list button').filter({hasText:'Sniper 902'})).toContainText('IP / PORT OFFLINE');await expect(frame.locator('.field-cluster-list')).toContainText('ADDRESS ESTIMATE');
 await expect(frame.getByLabel('Nearby unit center').locator('option[value="'+ids[0]+'"]')).toHaveCount(0);await expect(frame.getByLabel('Nearby unit center').locator('option[value="'+ids[2]+'"]')).toHaveCount(1);
 await frame.locator('.field-map-list>button').filter({hasText:'Sniper 901'}).click();await expect(frame.getByRole('region',{name:'Address estimate'})).toContainText('not a verified unit position');await expect(frame.locator('.field-map-detail')).toContainText('U.S. Census address-range estimate');await expect(frame.getByRole('button',{name:'Save verified location',exact:true})).toHaveCount(0);
 await revealMapInfo(frame);await expect(frame.locator('.field-map-info')).toContainText('1 verified map pins');
 await frame.locator('.field-map-center').scrollIntoViewIfNeeded();await frame.locator('.field-map-center').screenshot({path:info.outputPath('address-estimate-pins.png')});
 await revealMapFilters(frame); await frame.getByLabel('Nearby unit center').selectOption(ids[2]);await expect.poll(()=>estimatedCount(frame)).toBe(0);await revealMapFilters(frame); await frame.getByLabel('Nearby unit center').selectOption('');await expect.poll(()=>estimatedCount(frame)).toBe(2);
 state.offline=true;await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect(cluster).toHaveAttribute('data-health','offline');await expect.poll(()=>estimatedCount(frame)).toBe(2);expect(state.writes).toHaveLength(0);
});
test('new address snapshot removes stale estimate and pending validation cannot restore it',async({page})=>{
 const {frame,state}=await mount(page,{holdHashes:true});
 await expect.poll(()=>frame.locator('body').evaluate(()=>window.__hashResolvers.length)).toBe(2);
 state.units=state.units.map((u,i)=>{if(i>=2)return u;const marker=JSON.parse(u.locationNote.slice(prefix.length));marker.matchedAddress='101 EXAMPLE RD, TEST CITY, TX, 77001';return {...u,address:'101 Example Road, Test City, TX 77001',locationNote:prefix+JSON.stringify(marker)};});
 await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect.poll(()=>state.reads).toBe(2);
 await expect.poll(()=>frame.locator('body').evaluate(()=>window.__hashResolvers.length)).toBe(4);
 await frame.locator('body').evaluate(()=>window.__hashResolvers.splice(0).reverse().forEach(resolve=>resolve()));
 await expect.poll(()=>estimatedCount(frame)).toBe(0);await expect(frame.locator('.cos-field-pin')).toHaveCount(1);expect(state.writes).toHaveLength(0);
});
for(const noEstimates of [false,true])test('restored map viewport survives asynchronous validation '+(noEstimates?'without estimates':'with estimates'),async({page})=>{
 const {frame}=await mount(page,{restored:true,noEstimates});
 await expect.poll(()=>mappedCount(frame)).toBe(noEstimates?1:3);
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
 await expect.poll(()=>estimatedCount(frame)).toBe(2);await page.clock.runFor(1000);
 const after=await frame.locator('body').evaluate(()=>history.state.cosFieldMapView);expect(after.center).toEqual(before.center);expect(after.zoom).toBe(before.zoom);
});

test('registered unit renders its bound estimate and removes it after the installation address changes',async({page})=>{
 const {frame,state}=await mount(page,{registered:true});
 await expect.poll(()=>estimatedCount(frame)).toBe(2);
 await frame.locator('.field-map-list>button').filter({hasText:'Sniper 901'}).click();
 await expect(frame.getByRole('region',{name:'Address estimate'})).toContainText('not a verified unit position');
 await expect(frame.getByRole('button',{name:'Save verified location',exact:true})).toHaveCount(1);
 state.units[0]={...state.units[0],address:'101 Example Road, Test City, TX 77001'};
 await frame.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect.poll(()=>estimatedCount(frame)).toBe(1);
 expect(state.writes).toHaveLength(0);
});
test('automatic address lookup displays pending, approximate pin, new address invalidation and actionable failure',async({page})=>{
 const {frame,state}=await mount(page,{registered:true});
 state.units[0]={...state.units[0],currentLocationType:'field',locationVerification:'address_changed',placementAuditId:'41',placementUnitKey:'SNIPER 901',locationGeocode:{status:'pending'}};
 await frame.getByRole('button',{name:'Refresh',exact:true}).click();await frame.locator('.field-map-list>button').filter({hasText:'Sniper 901'}).click();
 await expect(frame.getByRole('region',{name:'Automatic address lookup'})).toContainText('lookup is pending');
 const geocode={status:'success',auditId:'41',unitKey:'SNIPER 901',provider:'us_census_address_range',benchmark:'Public_AR_Current',latitude:30,longitude:-95,matchedAddress:'100 EXAMPLE RD, TEST CITY, TX, 77001',geocodedAt:fresh,addressSha256:createHash('sha256').update(address.toLowerCase()).digest('hex')};
 state.units[0]={...state.units[0],locationGeocode:geocode};await frame.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(frame.getByRole('region',{name:'Address estimate'})).toContainText('30, -95');await expect.poll(()=>estimatedCount(frame)).toBe(2);
 state.units[0]={...state.units[0],address:'101 Example Road, Test City, TX 77001',placementAuditId:'42',locationGeocode:{status:'invalid_address'}};await frame.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect.poll(()=>estimatedCount(frame)).toBe(1);await expect(frame.getByRole('region',{name:'Automatic address lookup'})).toContainText('complete installation street, city, state and ZIP');expect(state.writes).toHaveLength(0);
});
test('automatic Geocodio estimates show precise provider method, EST and manual GPS priority',async({page})=>{
 const {frame,state}=await mount(page,{registered:true});
 const geocode={status:'success',auditId:'41',unitKey:'SNIPER 901',provider:'geocodio',source:'geocodio_automatic_address_estimate',confidence:'estimate',verified:false,liveGps:false,accuracyType:'range_interpolation',accuracy:1,matchType:null,latitude:30,longitude:-95,matchedAddress:address,geocodedAt:fresh,addressSha256:createHash('sha256').update(address.toLowerCase()).digest('hex')};
 state.units[0]={...state.units[0],currentLocationType:'field',placement:'FIELD',placementSource:'owner',locationVerification:'address_changed',placementAuditId:'41',placementUnitKey:'SNIPER 901',locationGeocode:geocode};
 await frame.getByRole('button',{name:'Refresh',exact:true}).click();await frame.locator('.field-map-list>button').filter({hasText:'Sniper 901'}).click();
 await expect(frame.getByRole('region',{name:'Address estimate'})).toContainText('range_interpolation');await expect(frame.locator('.field-map-detail')).toContainText('Geocodio address-range estimate');await expect.poll(()=>estimatedCount(frame)).toBe(2);
 await expect(frame.getByLabel('Nearby unit center').locator('option[value="'+state.units[0].id+'"]')).toHaveCount(0);
 state.units[0].locationGeocode={...geocode,accuracyType:'rooftop',matchType:'building_centroid'};await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect(frame.locator('.field-map-detail')).toContainText('Geocodio rooftop address estimate');await expect(frame.getByRole('region',{name:'Address estimate'})).toContainText('building_centroid');
 state.units[0]={...state.units[0],locationVerification:'owner_verified',latitude:30.5,longitude:-95.5,gpsRecordedAt:fresh,locationVerifiedAt:fresh,coordinateSource:'manual'};await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect(frame.getByRole('region',{name:'Address estimate'})).toHaveCount(0);await expect.poll(()=>estimatedCount(frame)).toBe(1);await expect(frame.getByLabel('Nearby unit center').locator('option[value="'+state.units[0].id+'"]')).toHaveCount(1);
 state.units[0]={...state.units[0],locationVerification:'address_changed',latitude:null,longitude:null,locationGeocode:{status:'deferred',provider:'geocodio'}};await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect(frame.getByRole('region',{name:'Automatic address lookup'})).toContainText('without paid lookups');expect(state.writes).toHaveLength(0);
});
test('imported partial source shows EST and inferred locality while later source revision removes old pin',async({page})=>{
 const {frame,state}=await mount(page,{registered:true});const row=state.units[0],sourceAddress='123 Main St, TX 77002';
 const binding={schemaVersion:1,organizationId:'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',sourceSystem:'mhelpdesk_product_import',entityKind:'equipment_unit',nativeUnitId:row.id,productId:'12345',unitNumber:row.unitNumber,family:'SNIPER',variant:null,sourceRevision:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sourceFileSha256:'a'.repeat(64),sourceRowSha256:'b'.repeat(64),addressSha256:createHash('sha256').update(sourceAddress.toLowerCase()).digest('hex'),nativeGuardSha256:'c'.repeat(64),installation:{street:'123 Main St',city:null,state:'TX',zip:'77002'},suppliedComponents:{street:true,city:false,state:true,zip:true},eligibility:'FIELD',eventId:'1'};
 state.units[0]={...row,address:sourceAddress,currentLocationType:'field',locationVerification:'address_only',importedInstallation:binding,importedPlacement:'FIELD',placement:null,placementSource:null,locationImportedGeocode:{jobKind:'native_import',binding,legacyGuardSha256:'d'.repeat(64),status:'success',provider:'geocodio',verified:false,liveGps:false,latitude:30,longitude:-95,matchedAddress:'123 Main St, Houston, TX 77002',geocodedAt:fresh,accuracyType:'rooftop',accuracy:1,matchType:'building_centroid'}};
 await frame.getByRole('button',{name:'Refresh',exact:true}).click();await frame.locator('.field-map-list>button').filter({hasText:'Sniper 901'}).click();
 await expect(frame.getByRole('region',{name:'Address estimate'})).toContainText('Provider supplied missing city');await expect(frame.getByRole('region',{name:'Address estimate'})).toContainText(sourceAddress);await expect(frame.locator('.field-map-detail')).toContainText('Geocodio rooftop address estimate');await expect.poll(()=>estimatedCount(frame)).toBe(2);
 await expect(frame.getByLabel('Nearby unit center').locator('option[value="'+row.id+'"]')).toHaveCount(0);
 state.units[0]={...state.units[0],importedInstallation:{...binding,sourceRevision:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',eventId:'2'}};await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect.poll(()=>estimatedCount(frame)).toBe(1);await expect(frame.getByRole('region',{name:'Address estimate'})).toHaveCount(0);expect(state.writes).toHaveLength(0);
});
test('imported offline camera and support stand stay independently colored and persist across reload',async({page})=>{
 const {frame,state}=await mount(page,{registered:true});state.offline=true;
 const sourceFor=(row,n,street)=>{const text=street+', Test City, TX 77001';return {schemaVersion:1,organizationId:'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',sourceSystem:'mhelpdesk_product_import',entityKind:row.readOnly?'tracker':'equipment_unit',nativeUnitId:row.id,productId:String(3000+n),unitNumber:row.unitNumber,family:row.modelName,variant:null,sourceRevision:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa'+n,sourceFileSha256:'a'.repeat(64),sourceRowSha256:'b'.repeat(64),addressSha256:createHash('sha256').update(text.toLowerCase()).digest('hex'),nativeGuardSha256:'c'.repeat(64),installation:{street,city:'Test City',state:'TX',zip:'77001'},suppliedComponents:{street:true,city:true,state:true,zip:true},eligibility:'FIELD',eventId:String(n)};};
 for(const n of [0,1]){let row=state.units[n];if(n===1)row={...row,unitNumber:'Solar Stand 72 002',modelName:'SOLAR STAND 72',readOnly:true};const binding=sourceFor(row,n+1,(n+1)+' Example Rd');state.units[n]={...row,address:(n+1)+' Example Rd, Test City, TX 77001',currentLocationType:'field',locationVerification:'address_only',importedInstallation:binding,importedPlacement:'FIELD',locationImportedGeocode:{jobKind:'native_import',binding,legacyGuardSha256:'d'.repeat(64),status:'success',provider:'geocodio',verified:false,liveGps:false,latitude:n===1?33:29,longitude:n===1?-99:-94,matchedAddress:(n+1)+' Example Rd, Test City, TX 77001',geocodedAt:fresh,accuracyType:'range_interpolation',accuracy:1,matchType:null}};}
 await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect.poll(()=>estimatedCount(frame)).toBe(2);
 // Inspect individual reticles after a normal user zoom; default EST counts above also include clusters.
 await frame.locator('.field-map-center').scrollIntoViewIfNeeded();for(let i=0;i<3;i++){await frame.locator('.leaflet-control-zoom-in').click();await page.clock.runFor(300);}
 await expect(frame.locator('.cos-field-pin-estimate[data-health="offline"]')).toHaveCount(1);await expect(frame.locator('.cos-field-pin-estimate[data-health="support"]')).toHaveCount(1);
 await frame.locator('.field-map-list>button').filter({hasText:'Solar Stand 72 002'}).click();await expect(frame.locator('.field-map-detail')).toContainText('SUPPORT EQUIPMENT');await expect(frame.locator('.field-map-detail')).toContainText('0 CAMERAS');
 await page.reload();await expect.poll(()=>estimatedCount(frame)).toBe(2);await expect(frame.locator('.cos-field-pin-estimate[data-health="support"]')).toHaveCount(1);expect(state.writes).toHaveLength(0);
 state.units[1]={...state.units[1],currentLocationType:'shop',status:'readiness_unverified',importedPlacement:'SHOP'};state.units=state.units.filter(unit=>unit.id!==ids[1]);await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect.poll(()=>estimatedCount(frame)).toBe(1);
});

test('eight V2 tracker poles share an EST site with distinct support identities and no cameras',async({page},info)=>{
 const {frame,state}=await mount(page,{noCameras:true});
 state.units=Array.from({length:8},(_,i)=>{
  const n=i+1,id=`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,unitNumber=`Solar Pole 72 ${String(n).padStart(3,'0')}`;
  const binding={schemaVersion:2,organizationId:'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',sourceSystem:'google_sheet_tracker',sourceRecordId:`google_sheet:synthetic_sheet_123:12:Solar Pole 72|${String(n).padStart(3,'0')}`,entityKind:'tracker',nativeUnitId:id,unitNumber,family:'Solar Pole 72',variant:null,sourceRevision:`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`,sourceFileSha256:'a'.repeat(64),sourceRowSha256:'b'.repeat(64),addressSha256:createHash('sha256').update(address.toLowerCase()).digest('hex'),nativeGuardSha256:'c'.repeat(64),installation:{street:'100 Example Road',city:'Test City',state:'TX',zip:'77001'},suppliedComponents:{street:true,city:true,state:true,zip:true},eligibility:'FIELD',eventId:String(n)};
  return {id,unitNumber,modelName:'SOLAR POLES & SKIDS',readOnly:true,hasUnitGps:false,status:'field',currentLocationType:'field',address,customer:'Synthetic customer',site:'Synthetic site',addressSource:'Tracker imported installation address',recordSource:'Tracker imported installation address',latitude:null,longitude:null,locationVerification:'address_only',importedPlacement:'FIELD',importedInstallation:binding,locationImportedGeocode:{jobKind:'native_import',binding,legacyGuardSha256:'d'.repeat(64),status:'success',provider:'us_census_address_range',benchmark:'Public_AR_Current',verified:false,liveGps:false,latitude:30,longitude:-95,matchedAddress:address,geocodedAt:fresh}};
 });
 await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect(frame.locator('.field-map-list>button')).toHaveCount(8);await expect.poll(()=>estimatedCount(frame)).toBe(8);
 await expect(frame.locator('.cos-field-cluster')).toHaveAttribute('data-health','support');await expect(frame.locator('.cos-field-cluster b')).toHaveText('8');
 await frame.locator('.field-map-list>button').filter({hasText:'Solar Pole 72 001'}).click();await expect(frame.locator('.field-map-detail')).toContainText('0 CAMERAS');await expect(frame.locator('.field-map-detail')).toContainText('SUPPORT EQUIPMENT');await expect(frame.getByRole('region',{name:'Address estimate'})).toContainText('not a verified unit position');await expect(frame.getByRole('button',{name:'Save verified location',exact:true})).toHaveCount(0);
 await page.reload();await expect.poll(()=>estimatedCount(frame)).toBe(8);
 state.units[0]={...state.units[0],importedInstallation:{...state.units[0].importedInstallation,sourceRevision:'30000000-0000-4000-8000-000000000001'}};
 await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect.poll(()=>estimatedCount(frame)).toBe(7);expect(state.writes).toHaveLength(0);
 await frame.locator('.field-map-center').scrollIntoViewIfNeeded();await frame.locator('.field-map-center').screenshot({path:info.outputPath('typed-tracker-support-estimates.png')});
});

// Synthetic authenticated native Operations transport; no live writes or geocoder calls.
import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';
import {snapshot as healthSnapshot} from './fixtures/camera-evidence-fixtures.mjs';
const origin=process.env.COS_MAP_TEST_ORIGIN||'http://127.0.0.1:4173';
const dist=resolve(process.env.COS_IMPORTED_ADDRESS_TEST_DIST||fileURLToPath(new URL('../dist',import.meta.url)));
const id='11111111-1111-4111-8111-111111111111',gpsId='22222222-2222-4222-8222-222222222222',shopId='33333333-3333-4333-8333-333333333333',source='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',revision='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',stamp='2026-10-09T02:00:00Z';
const address=installation=>[installation.street,installation.city,[installation.state,installation.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
const authority={contract:'COS_APP_UNIT_ADDRESS_V1',revision,legacyUnitKey:null,legacyIdentitySha256:'d'.repeat(64),legacyPlacementSha256:'e'.repeat(64)};
const baseRecord=(unitId=id)=>({contract:'COS_APP_UNIT_ADDRESS_V1',unitId,unitNumber:unitId===shopId?'Solar Stand 52':'Solar Stand 51',sourceIdentity:{sourceSystem:'google_sheet_tracker',sourceRecordId:'google_sheet:synthetic_sheet_123:12:Solar Stand|'+(unitId===shopId?'52':'51')},sourceRevision:source,revision:null,placementRevision:'a'.repeat(64),placement:unitId===shopId?'SHOP':'FIELD',installation:unitId===shopId?null:{street:'100 Example Road',city:'Houston',state:'TX',zip:'77001'},siteLabel:'Example yard',sourceConflict:false,history:[],editable:true});
const gps=()=>({id:gpsId,unitNumber:'Ranger 001',modelName:'Ranger',status:'field',currentLocationType:'field',address:'100 Registered Road',site:'Registered site',latitude:29.76,longitude:-95.37,hasUnitGps:true,readOnly:false,coordinateSource:'manual',locationVerification:'owner_verified',gpsRecordedAt:stamp,locationVerifiedAt:stamp});
function projected(record,estimated=false){
 const row={id:record.unitId,unitNumber:record.unitNumber,modelName:'Support equipment',category:'support',readOnly:true,hasUnitGps:false,status:record.placement.toLowerCase(),currentLocationType:record.placement.toLowerCase(),importedPlacement:record.placement,placement:null,placementSource:null,placementAuditId:null,site:record.placement==='INACTIVE'?'INACTIVE / DO NOT USE':record.siteLabel,address:record.placement==='FIELD'&&record.installation?address(record.installation):null,latitude:null,longitude:null,coordinateSource:null,locationVerification:'address_only'};
 if(record.placement!=='FIELD'){
  row.importedInstallation={entityKind:'tracker',nativeUnitId:record.unitId,...record.sourceIdentity,sourceRevision:record.revision||source,eventId:'42',nativeGuardSha256:'a'.repeat(64),sourceFileSha256:'b'.repeat(64),sourceRowSha256:'c'.repeat(64),placement:record.placement,...(record.revision?{addressAuthority:authority}:{})};
 }else if(estimated){
  const binding={schemaVersion:2,organizationId:'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',...record.sourceIdentity,entityKind:'tracker',nativeUnitId:record.unitId,unitNumber:record.unitNumber,family:null,variant:null,sourceRevision:record.revision||source,eventId:'42',nativeGuardSha256:'a'.repeat(64),sourceFileSha256:'b'.repeat(64),sourceRowSha256:'c'.repeat(64),addressSha256:createHash('sha256').update(row.address.toLowerCase()).digest('hex'),installation:record.installation,suppliedComponents:{street:true,city:record.installation.city!==null,state:true,zip:record.installation.zip!==null},eligibility:'FIELD',...(record.revision?{addressAuthority:authority}:{})};
  row.importedInstallation=binding;row.locationImportedGeocode={jobKind:'native_import',binding,legacyGuardSha256:'d'.repeat(64),status:'success',provider:'us_census_address_range',benchmark:'Public_AR_Current',verified:false,liveGps:false,latitude:31,longitude:-96,matchedAddress:row.address,geocodedAt:stamp};
 }
 return row;
}
async function mount(page,{role='owner',enabled=true,partial=false,sourceConflict=false,denied=false,malformed=false,hold=false,existingOverlay=false}={}){
 const records=new Map([[id,baseRecord()],[shopId,baseRecord(shopId)]]);
 if(partial)records.get(id).installation={street:'100 Example Road',city:null,state:null,zip:null};
 records.get(id).sourceConflict=sourceConflict;
 if(existingOverlay)records.get(id).revision=revision;
 let release;const held=new Promise(resolve=>release=resolve);
 const state={records,writes:[],reads:[],errors:[],estimated:false,denied,malformed,hold,release,failPost:'',malformedReceipt:false,noopReceipt:false,failMap:false,gps:gps()};
 await page.clock.install({time:new Date(stamp)});
 page.on('pageerror',error=>state.errors.push(error.message));
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url===origin+'/imported-address-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe src="/${role==='owner'?'':'?mode=fleet'}#field-map"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:${JSON.stringify(role)},accessToken:'synthetic-only'},location.origin)})</script>`});
  if(url.startsWith(origin+'/')){const pathname=new URL(url).pathname,path=resolve(dist,pathname==='/'?'index.html':'.'+decodeURIComponent(pathname));if(path.startsWith(dist+'/')&&existsSync(path))return route.fulfill({path,contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'}[extname(path)]||'application/octet-stream'});return route.abort();}
  if(/^https:\/\/[abc]\.tile\.openstreetmap\.org\//.test(url))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#34495b"/></svg>'});
  if(!url.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();const answer=(data,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});
  const match=/^\/api\/field-map\/([^/]+)\/address$/.exec(request.path);
  if(request.method==='POST'){
   state.writes.push(request);if(!match)return answer({error:'GPS writes are forbidden in this fixture'},403);
   if(state.failPost)return answer({error:state.failPost},409);
   const before=records.get(match[1]),body=request.body;
   const fresh={...before,placement:body.placement,installation:body.installation,siteLabel:body.siteLabel,revision,sourceConflict:false,history:[{revision,actorUserId:gpsId,actorRole:role,savedAt:stamp,placement:body.placement,installation:body.installation}]};
   records.set(match[1],fresh);state.estimated=true;
   if(state.noopReceipt){fresh.revision=null;fresh.history=[];state.estimated=false;return answer({changed:false,record:fresh});}
   return answer(state.malformedReceipt?{}:{changed:true,record:fresh});
  }
  state.reads.push(request.path);
  if(match){if(state.hold)await held;if(state.denied)return answer({error:'This imported unit is unavailable for editing.'},403);return answer(state.malformed?{...records.get(match[1]),installation:{street:'Only one field'}}:records.get(match[1]));}
  if(request.path==='/api/field-map'){
   if(state.failMap)return answer({error:'Synthetic map read failed'},503);
   const inventory=[...records.values()].map(record=>projected(record,state.estimated)),items=[...inventory.filter(row=>row.status==='field'),state.gps];
   return answer({items,inventoryItems:[...inventory,state.gps],summary:{fieldUnits:items.length,mappedUnits:1,unitGps:1,missingGps:items.length-1},generatedAt:stamp});
  }
  return answer(request.path==='/api/session'?{authorized:true,legacyOwner:role==='owner',name:'Synthetic '+role,role:role==='owner'?'Owner':'IT',features:{fleetAccess:true,fieldLocationVerification:role==='owner',importedUnitAddressEdit:enabled}}:request.path==='/api/camera-health/summary-v3'?healthSnapshot([]):request.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:stamp}:{items:[]});
 });
 await page.goto('/imported-address-fixture');const frame=page.frameLocator('iframe');
 if(role!=='service'){await expect(frame.locator('.field-map-list>button')).toHaveCount(2);await frame.locator('.field-map-list>button').filter({hasText:'Solar Stand 51'}).click();}
 return {frame,state,editor:frame.getByRole('region',{name:'Imported unit address correction',exact:true})};
}
async function edit(editor){await editor.getByRole('button',{name:'Edit unit address',exact:true}).click();}
async function confirm(editor){await editor.getByRole('checkbox',{name:/I reviewed/}).check();await editor.getByRole('button',{name:'Save address correction',exact:true}).click();}

for(const role of ['owner','it'])test(role+' edits a zero-camera stand through native UUID address transport; automatic estimate never changes GPS',async({page},info)=>{
 const {frame,state,editor}=await mount(page,{role});const original=structuredClone(state.gps);
 await edit(editor);await expect(editor.getByLabel('Installation street',{exact:true})).toHaveValue('100 Example Road');await expect(frame.locator('.field-map-detail')).toContainText('0 CAMERAS');
 await expect(editor).toContainText('US Census');await expect(editor).toContainText('free Geocodio');await expect(frame.getByRole('button',{name:'Save verified location',exact:true})).toHaveCount(0);
 await editor.getByLabel('Installation street',{exact:true}).fill('200 New Road');await expect(editor.getByRole('button',{name:'Save address correction',exact:true})).toBeDisabled();await confirm(editor);
 await expect(editor).toContainText('address correction saved and verified');await expect(frame.locator('.field-map-detail')).toContainText('200 New Road');await expect(frame.getByRole('region',{name:'Address estimate',exact:true})).toContainText('not a verified unit position');
 expect(state.writes).toHaveLength(1);expect(state.writes[0].path).toBe('/api/field-map/'+id+'/address');expect(Object.keys(state.writes[0].body).sort()).toEqual(['confirmed','expectedPlacementRevision','expectedRevision','expectedSourceRevision','installation','placement','requestId','siteLabel'].sort());expect(state.gps).toEqual(original);expect(state.errors).toEqual([]);
 if(role==='it')expect(state.reads.some(path=>path.endsWith('/history'))).toBe(false);
 await page.clock.runFor(6000);await edit(editor);await editor.getByLabel('Address placement').scrollIntoViewIfNeeded();
 const width=await editor.evaluate(node=>({width:node.clientWidth,scroll:node.scrollWidth}));expect(width.scroll).toBeLessThanOrEqual(width.width+1);
 await frame.locator('.field-map-detail').screenshot({path:info.outputPath(role+'-stand-address-editor.png')});
 await editor.getByRole('button',{name:'Save address correction',exact:true}).scrollIntoViewIfNeeded();await frame.locator('.field-map-detail').screenshot({path:info.outputPath(role+'-stand-address-actions.png')});
});
test('verified prefill no-op, canceled edits, Escape and switching units never submit',async({page})=>{
 const {frame,state,editor}=await mount(page);await edit(editor);await expect(editor).toContainText('No changes to save');await expect(editor.getByRole('button',{name:'Save address correction',exact:true})).toBeDisabled();
 await editor.getByLabel('Installation street',{exact:true}).fill('200 Canceled Road');await editor.getByRole('button',{name:'Cancel address edits',exact:true}).click();await edit(editor);await expect(editor.getByLabel('Installation street',{exact:true})).toHaveValue('100 Example Road');
 await editor.getByLabel('Installation street',{exact:true}).fill('300 Escape Road');await editor.getByLabel('Installation street',{exact:true}).press('Escape');await edit(editor);await expect(editor.getByLabel('Installation street',{exact:true})).toHaveValue('100 Example Road');
 await editor.getByLabel('Installation street',{exact:true}).fill('400 Interrupted Road');await frame.getByLabel('Imported inventory unit').selectOption(shopId);await edit(editor);await expect(editor.getByLabel('Address placement')).toHaveValue('SHOP');
 expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});
for(const existingOverlay of [false,true])test((existingOverlay?'app correction':'first source')+' case-only address edits stay no-op',async({page})=>{
 const {state,editor}=await mount(page,{existingOverlay});await edit(editor);await editor.getByLabel('Installation street',{exact:true}).fill('100 EXAMPLE road');await editor.getByLabel('Installation city',{exact:true}).fill('HOUSTON');await editor.getByLabel('Installation state',{exact:true}).fill('tx');await expect(editor).toContainText('No changes to save');await expect(editor.getByRole('button',{name:'Save address correction',exact:true})).toBeDisabled();await expect(editor.getByRole('checkbox',{name:/I reviewed/})).toBeDisabled();expect(state.writes).toEqual([]);
});
test('validated API no-op receipt can have no revision and does not trigger a retry',async({page})=>{
 const {state,editor}=await mount(page);await edit(editor);await editor.getByLabel('Installation street',{exact:true}).fill('200 New Road');state.noopReceipt=true;await confirm(editor);await expect(editor).toContainText('address unchanged; current address verified');await expect(editor.getByRole('alert')).toHaveCount(0);expect(state.writes).toHaveLength(1);await edit(editor);await expect(editor).toContainText('No changes to save');expect(state.writes).toHaveLength(1);
});
test('Shop to Field requires new address, then Field to Inactive clears address and pin',async({page})=>{
 const {frame,state,editor}=await mount(page);await frame.getByLabel('Imported inventory unit').selectOption(shopId);await edit(editor);await editor.getByLabel('Address placement').selectOption('FIELD');
 await expect(editor.getByLabel('Installation street',{exact:true})).toHaveValue('');await expect(editor.getByRole('button',{name:'Save address correction',exact:true})).toBeDisabled();
 await editor.getByLabel('Installation street',{exact:true}).fill('500 New Road');await editor.getByLabel('Installation city',{exact:true}).fill('Houston');await editor.getByLabel('Installation state',{exact:true}).fill('TX');await editor.getByLabel('Installation ZIP',{exact:true}).fill('77001');await confirm(editor);
 await expect(editor).toContainText('address correction saved and verified');await expect(frame.locator('.field-map-list>button')).toHaveCount(3);await expect(frame.locator('.field-map-detail h2')).toHaveText('Solar Stand 52');
 await edit(editor);await editor.getByLabel('Address placement').selectOption('INACTIVE');await confirm(editor);await expect(editor).toContainText('address correction saved and verified');await expect(frame.locator('.field-map-list>button')).toHaveCount(2);await expect(frame.getByRole('region',{name:'Inactive inventory'})).toContainText('Solar Stand 52');expect(state.writes.at(-1).body.installation).toBeNull();expect(state.errors).toEqual([]);
});
test('partial address repair is prefilled truthfully and source conflict remains visible until confirmed',async({page})=>{
 const {state,editor}=await mount(page,{partial:true,sourceConflict:true});await expect(editor.getByRole('alert')).toContainText('source tracker has changed');await edit(editor);await expect(editor.getByLabel('Installation street',{exact:true})).toHaveValue('100 Example Road');await expect(editor.getByLabel('Installation city',{exact:true})).toHaveValue('');await expect(editor.getByLabel('Installation state',{exact:true})).toHaveValue('');
 await editor.getByLabel('Installation state',{exact:true}).fill('TX');await editor.getByLabel('Installation ZIP',{exact:true}).fill('77001');await confirm(editor);await expect(editor).toContainText('address correction saved and verified');expect(state.writes[0].body.installation.city).toBeNull();expect(state.errors).toEqual([]);
});
for(const mode of ['denied','malformed','hold','disabled'])test(mode+' cannot open an unverified editable form or write',async({page})=>{
 const {state,editor}=await mount(page,{[mode]:true,enabled:mode!=='disabled'});
 if(mode==='hold'){await expect(editor).toContainText('Loading verified address details');state.hold=false;state.release();await expect(editor.getByRole('button',{name:'Edit unit address',exact:true})).toBeVisible();}
 else {await expect(editor.getByRole('button',{name:'Edit unit address',exact:true})).toHaveCount(0);if(mode!=='disabled')await expect(editor.getByRole('alert')).toBeVisible();}
 expect(state.writes).toEqual([]);if(mode==='disabled')expect(state.reads.some(path=>path.endsWith('/address'))).toBe(false);
});
test('Service session denial is rendered and sends no address or GPS request',async({page})=>{
 const {frame,state}=await mount(page,{role:'service'});await expect(frame.getByText('ACCESS UNAVAILABLE',{exact:true})).toBeVisible();await expect(frame.getByRole('region',{name:'Imported unit address correction',exact:true})).toHaveCount(0);expect(state.writes).toEqual([]);expect(state.reads.some(path=>path.endsWith('/address'))).toBe(false);
});
for(const mode of ['stale owner','uncertain receipt','failed map refresh'])test(mode+' freezes further saves until verified refresh without replay',async({page})=>{
 const {frame,state,editor}=await mount(page);await edit(editor);await editor.getByLabel('Installation street',{exact:true}).fill('200 New Road');if(mode==='stale owner')state.failPost='The Owner placement changed. Refresh before editing.';if(mode==='uncertain receipt')state.malformedReceipt=true;if(mode==='failed map refresh')state.failMap=true;await confirm(editor);
 await expect(editor.getByRole('alert')).toContainText('Refresh the address and Field Map');await expect(editor.getByRole('button',{name:'Save address correction',exact:true})).toBeDisabled();expect(state.writes).toHaveLength(1);
 state.failPost='';state.malformedReceipt=false;state.failMap=false;await editor.getByRole('button',{name:'Refresh address',exact:true}).click();await expect(editor.getByRole('button',{name:'Edit unit address',exact:true})).toBeEnabled();expect(state.writes).toHaveLength(1);await edit(editor);await expect(editor.getByLabel('Installation street',{exact:true})).toHaveValue(mode==='stale owner'?'100 Example Road':'200 New Road');await expect(editor).toContainText('No changes to save');expect(state.errors).toEqual([]);
});

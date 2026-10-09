import {test,expect} from '@playwright/test';
import {resource,snapshot} from './fixtures/camera-evidence-fixtures.mjs';
const now='2026-10-09T06:40:00Z',fresh='2026-10-09T06:35:00Z';
async function mount(page){
 const units=[1,2,3].map(i=>({id:`a0000000-0000-4000-8000-${String(i).padStart(12,'0')}`,unitNumber:'Spotter '+(900+i)+'HDC2',modelName:'Spotter',readOnly:false,status:'field',currentLocationType:'field',importedPlacement:'FIELD',address:'123 Synthetic Road',site:'Synthetic site',customer:'Synthetic customer',latitude:null,longitude:null,hasUnitGps:false,locationVerification:'address_only'}));
 const identities=units.map((u,i)=>({unitId:u.id,unitNumber:u.unitNumber,kind:'native_provider',deviceIds:[String(i+1)],unitKeys:['SPOTTER '+(901+i)],proof:String(i+1).repeat(64)}));
 const guards=identities.slice(0,2).map(i=>({unitId:i.unitId,unitNumber:i.unitNumber,identityProof:i.proof,deviceIds:i.deviceIds,unitKeys:i.unitKeys,checkedAt:now,providerSyncAt:fresh}));
 for(let i=0;i<2;i++){
  const binding={schemaVersion:1,organizationId:'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',sourceSystem:'mhelpdesk_product_import',entityKind:'equipment_unit',nativeUnitId:units[i].id,unitNumber:units[i].unitNumber,eligibility:'FIELD',sourceRevision:`b0000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,sourceFileSha256:'a'.repeat(64),sourceRowSha256:'b'.repeat(64),addressSha256:'c'.repeat(64),nativeGuardSha256:'d'.repeat(64),eventId:String(i+1),productId:String(i+1)};
  units[i].importedInstallation=binding;units[i].fieldRecorderAuthority={schemaVersion:1,...guards[i],...Object.fromEntries(['sourceRevision','sourceFileSha256','sourceRowSha256','addressSha256','nativeGuardSha256','eventId','productId'].map(k=>[k,binding[k]]))};
 }
 const rows=identities.map((i,n)=>resource(n+1,i.unitKeys[0],{type:n<2?'NVR':'IPC',activationState:n<2?'deactivated':'active',scope:n<2?'shop':'field',evidence:{kind:'provider',source:'Star4Live',resource:n<2?'recorder':'camera',active:n===2,status:n===0?'online':'offline',observedAt:fresh,lastOnlineAt:null}}));
 const state={units,rows,identities,guards,writes:[],errors:[]};page.on('pageerror',e=>state.errors.push(e.message));await page.clock.install({time:new Date(now)});
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/field-recorder-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe src="/#field-map"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-only'},location.origin)})</script>`});
  if(url.hostname==='127.0.0.1')return route.continue();
  if(!url.pathname.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':request.headers().origin||'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  const body=request.postDataJSON();if(body.method!=='GET'){state.writes.push(body);return route.fulfill({status:400,headers,body:'{}'});}
  const data=body.path==='/api/session'?{authorized:true,name:'Synthetic Owner',role:'Owner',features:{fleetAccess:true,fieldLocationVerification:true}}
   :body.path==='/api/field-map'?{items:state.units,inventoryItems:state.units,summary:{fieldUnits:3,mappedUnits:0,unitGps:0,missingGps:3},generatedAt:now}
   :body.path==='/api/camera-health/summary-v3'?{...snapshot(state.rows),refreshedAt:now,identityVersion:1,unitIdentities:state.identities,identityWarnings:[],fieldRecorderObservationVersion:1,fieldRecorderObservationGuards:state.guards}
   :body.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:now}:{items:[]};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/field-recorder-fixture');const frame=page.frameLocator('iframe');await expect(frame.locator('.field-map-list>button')).toHaveCount(3);return {frame,state};
}
test('Field cards and selected troubleshooting retain recorder wording and separate outage counts',async({page},info)=>{
 const {frame,state}=await mount(page);await expect(frame.locator('.field-map-kpis article b')).toHaveText(['3','1','2','0','0']);
 await expect(frame.locator('.field-map-list>button').nth(0)).toContainText('RECORDER ONLINE');await expect(frame.locator('.field-map-list>button').nth(1)).toContainText('RECORDER OFFLINE');await expect(frame.locator('.field-map-list>button').nth(2)).toContainText('CAMERA RECORDS OFFLINE');
 await frame.locator('.field-map-info>summary').click();await expect(frame.locator('.field-map-info')).toContainText('Offline observations: 1 camera / detector, 1 recorder, 0 IP / port');await expect(frame.locator('.field-map-info')).toContainText('Recorder and service outages do not establish individual camera outages.');
 await frame.locator('.field-map-list>button').nth(1).click();await expect(frame.locator('.field-camera-status')).toContainText('RECORDER OFFLINE');await expect(frame.locator('.field-camera-status')).toContainText('Individual camera channels and video are not verified');
 await frame.getByRole('button',{name:'Open Camera Health',exact:true}).click();await expect(frame.locator('.camera-unit-state')).toHaveText('RECORDER OFFLINE');await expect(frame.locator('.camera-unit-detail')).toContainText('Camera channel status unavailable');await expect(frame.locator('.camera-unit-detail')).not.toContainText('Excluded from field operational totals');await expect(frame.locator('.camera-device-cards article').first().locator('div>b')).toHaveText('RECORDER OFFLINE');
 expect(await frame.locator('body').evaluate(el=>el.scrollWidth>innerWidth+1)).toBe(false);await frame.locator('.camera-unit-detail').screenshot({path:info.outputPath('verified-field-recorder-offline.png')});expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});
test('new Owner hold removes eligibility while preserving the old map row and source observation',async({page})=>{
 const {frame,state}=await mount(page);await expect(frame.locator('.field-map-kpis article b')).toHaveText(['3','1','2','0','0']);
 state.guards=state.guards.slice(1);await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect(frame.locator('.field-map-kpis article b')).toHaveText(['3','0','2','1','0']);await expect(frame.locator('.field-map-list>button')).toHaveCount(3);await expect(frame.locator('.field-map-list>button').nth(0)).toContainText('RECORDER UNVERIFIED');expect(state.rows[0].evidence.status).toBe('online');expect(state.rows[0].activationState).toBe('deactivated');expect(state.writes).toEqual([]);
});
test('stale recorder observations remain unknown despite current installation and guard',async({page})=>{
 const {frame,state}=await mount(page);await expect(frame.locator('.field-map-kpis article b')).toHaveText(['3','1','2','0','0']);
 state.rows.slice(0,2).forEach(r=>r.evidence.observedAt='2026-10-09T06:19:59Z');await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect(frame.locator('.field-map-kpis article b')).toHaveText(['3','0','1','2','0']);await expect(frame.locator('.field-map-list>button').nth(0)).toContainText('RECORDER UNVERIFIED');await expect(frame.locator('.field-map-list>button').nth(1)).toContainText('RECORDER UNVERIFIED');expect(state.writes).toEqual([]);
});
test('failed provider sync withdraws both cached ONLINE and OFFLINE admissions without deleting observations',async({page})=>{
 const {frame,state}=await mount(page);await expect(frame.locator('.field-map-kpis article b')).toHaveText(['3','1','2','0','0']);
 state.guards=[];await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect(frame.locator('.field-map-kpis article b')).toHaveText(['3','0','1','2','0']);
 await expect(frame.locator('.field-map-list>button').nth(0)).toContainText('RECORDER UNVERIFIED');await expect(frame.locator('.field-map-list>button').nth(1)).toContainText('RECORDER UNVERIFIED');expect(state.rows.slice(0,2).map(r=>r.evidence.status)).toEqual(['online','offline']);expect(state.rows.slice(0,2).map(r=>r.evidence.observedAt)).toEqual([fresh,fresh]);expect(state.writes).toEqual([]);
});

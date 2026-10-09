import {test,expect} from '@playwright/test';
import {resource,snapshot} from './fixtures/camera-evidence-fixtures.mjs';
const startAt='2026-10-09T06:40:00Z',freshAt='2026-10-09T06:35:00Z';
const deferred=()=>{let release;const promise=new Promise(resolve=>release=resolve);return {promise,release};};
async function mount(page,view,late='map'){
 const units=[1,2,3].map(i=>({id:`a0000000-0000-4000-8000-${String(i).padStart(12,'0')}`,unitNumber:'Spotter '+(900+i)+'HDC2',modelName:'Spotter',readOnly:false,status:'field',currentLocationType:'field',importedPlacement:'FIELD',address:'123 Synthetic Road',site:'Synthetic site',customer:'Synthetic customer',latitude:null,longitude:null,hasUnitGps:false,locationVerification:'address_only'}));
 const identities=units.map((u,i)=>({unitId:u.id,unitNumber:u.unitNumber,kind:'native_provider',deviceIds:[String(i+1)],unitKeys:['SPOTTER '+(901+i)],proof:String(i+1).repeat(64)}));
 const guards=identities.slice(0,2).map(i=>({unitId:i.unitId,unitNumber:i.unitNumber,identityProof:i.proof,deviceIds:i.deviceIds,unitKeys:i.unitKeys,checkedAt:startAt,providerSyncAt:freshAt}));
 for(let i=0;i<2;i++){
  const binding={schemaVersion:1,organizationId:'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',sourceSystem:'mhelpdesk_product_import',entityKind:'equipment_unit',nativeUnitId:units[i].id,unitNumber:units[i].unitNumber,eligibility:'FIELD',sourceRevision:`b0000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,sourceFileSha256:'a'.repeat(64),sourceRowSha256:'b'.repeat(64),addressSha256:'c'.repeat(64),nativeGuardSha256:'d'.repeat(64),eventId:String(i+1),productId:String(i+1)};
  units[i].importedInstallation=binding;units[i].fieldRecorderAuthority={schemaVersion:1,...guards[i],...Object.fromEntries(['sourceRevision','sourceFileSha256','sourceRowSha256','addressSha256','nativeGuardSha256','eventId','productId'].map(k=>[k,binding[k]]))};
 }
 const rows=identities.map((i,n)=>resource(n+1,i.unitKeys[0],{type:n<2?'NVR':'IPC',activationState:n<2?'deactivated':'active',scope:n<2?'shop':'field',evidence:{kind:'provider',source:'Star4Live',resource:n<2?'recorder':'camera',active:n===2,status:n===0?'online':'offline',observedAt:freshAt,lastOnlineAt:null}}));
 const state={units,rows,guards,identities,reads:{map:0,summary:0},responses:{map:0,summary:0},gates:{map:null,summary:null},stamps:[],writes:[],errors:[],mode:'valid'};
 state.gates[late]=deferred();page.on('pageerror',e=>state.errors.push(e.message));await page.clock.install({time:new Date(startAt)});await page.clock.pauseAt(new Date(startAt));
 const hash=view==='map'?'field-map':view==='overview'?'camera-health':'camera-health?unit='+units[1].id;
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/recorder-clock-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe src="/#${hash}"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-only'},location.origin)})</script>`});
  if(url.hostname==='127.0.0.1')return route.continue();
  if(!url.pathname.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':request.headers().origin||'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  const body=request.postDataJSON();if(body.method!=='GET'){state.writes.push(body);return route.fulfill({status:400,headers,body:'{}'});}
  const kind=body.path==='/api/field-map'?'map':body.path==='/api/camera-health/summary-v3'?'summary':null;
  if(kind){state.reads[kind]++;const gate=state.gates[kind];if(gate)await gate.promise;}
  const receivedAt=await page.evaluate(()=>Date.now()),stamp=new Date(receivedAt).toISOString();let data;
  if(kind==='map'){
   const current=structuredClone(units);for(const u of current)if(u.fieldRecorderAuthority)u.fieldRecorderAuthority.checkedAt=new Date(receivedAt+(state.mode==='future-map'?60000:0)).toISOString();
   data={items:current,inventoryItems:current,summary:{fieldUnits:3,mappedUnits:0,unitGps:0,missingGps:3},generatedAt:stamp};
  }else if(kind==='summary'){
   const currentRows=structuredClone(rows),currentGuards=structuredClone(guards);
   for(const g of currentGuards)g.checkedAt=new Date(receivedAt+(state.mode==='future-guard'?60000:0)).toISOString();
   if(['stale','future-observation'].includes(state.mode)){
    const observedAt=new Date(receivedAt+(state.mode==='stale'?-20*60000-1:60000)).toISOString();
    currentRows.slice(0,2).forEach(r=>r.evidence.observedAt=observedAt);currentGuards.forEach(g=>g.providerSyncAt=observedAt);
   }
   data={...snapshot(currentRows),refreshedAt:stamp,identityVersion:1,unitIdentities:identities,identityWarnings:[],fieldRecorderObservationVersion:1,fieldRecorderObservationGuards:state.mode==='failed-sync'?[]:currentGuards};
  }else data=body.path==='/api/session'?{authorized:true,name:'Synthetic Owner',role:'Owner',features:{fleetAccess:true,fieldLocationVerification:true}}:body.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:stamp}:{items:[]};
  await route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});if(kind){state.responses[kind]++;state.stamps.push({kind,at:receivedAt});}
 });
 await page.goto('/recorder-clock-fixture');const frame=page.frameLocator('iframe');
 await expect.poll(()=>state.reads).toEqual({map:1,summary:1});await expect.poll(()=>state.responses[late==='map'?'summary':'map']).toBe(1);
 await page.clock.runFor(2000);state.gates[late].release();state.gates[late]=null;await expect.poll(()=>state.responses).toEqual({map:1,summary:1});
 if(view==='overview')await frame.getByLabel('Camera Health unit filter').selectOption('shop');
 return {frame,state};
}
async function expectLabels(frame,view,valid){
 if(view==='map'){
  await expect(frame.locator('.field-map-list>button').nth(0)).toContainText(valid?'RECORDER ONLINE':'RECORDER UNVERIFIED');await expect(frame.locator('.field-map-list>button').nth(1)).toContainText(valid?'RECORDER OFFLINE':'RECORDER UNVERIFIED');
  await expect(frame.locator('.field-map-kpis article b')).toHaveText(valid?['3','1','2','0','0']:['3','0','1','2','0']);
 }else if(view==='workspace')await expect(frame.locator('.camera-unit-state')).toHaveText(valid?'RECORDER OFFLINE':'RECORDER UNVERIFIED');
 else await expect(frame.locator('.camera-overview-card .camera-status-pill')).toHaveText(valid?['RECORDER ONLINE','RECORDER OFFLINE']:['RECORDER UNVERIFIED','RECORDER UNVERIFIED']);
}
async function delayedRefresh(page,frame,state,view){
 state.gates.map=deferred();const before={...state.reads};await frame.getByRole('button',{name:view==='map'?'Refresh':'Reload saved results',exact:true}).click();
 await expect.poll(()=>state.responses.summary).toBe(before.summary+1);await page.clock.runFor(2000);state.gates.map.release();state.gates.map=null;
 await expect.poll(()=>state.responses.map).toBe(before.map+1);
}
for(const view of ['map','overview','workspace']){
 for(const late of ['map','summary'])test(`${view}: later ${late} response uses local arrival time immediately`,async({page})=>{
  const {frame,state}=await mount(page,view,late);await expectLabels(frame,view,true);
  expect(state.stamps.filter(s=>['map','summary'].includes(s.kind)).map(s=>s.at)).toEqual([Date.parse(startAt),Date.parse(startAt)+2000]);
  expect(state.reads).toEqual({map:1,summary:1});expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
 });
 test(`${view}: repeated delayed map refresh updates the clock without extra reads`,async({page})=>{
  const {frame,state}=await mount(page,view);await expectLabels(frame,view,true);
  await delayedRefresh(page,frame,state,view);await expectLabels(frame,view,true);await delayedRefresh(page,frame,state,view);await expectLabels(frame,view,true);
  expect(state.reads).toEqual({map:3,summary:3});expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
 });
 test(`${view}: arriving data cannot legitimize future, stale or failed-sync evidence`,async({page})=>{
  const {frame,state}=await mount(page,view);await expectLabels(frame,view,true);
  for(const mode of ['future-map','future-guard','future-observation','stale','failed-sync']){state.mode=mode;await delayedRefresh(page,frame,state,view);await expectLabels(frame,view,false);}
  expect(state.reads).toEqual({map:6,summary:6});expect(state.writes).toEqual([]);expect(state.rows.slice(0,2).map(r=>r.evidence.status)).toEqual(['online','offline']);expect(state.errors).toEqual([]);
 });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const bridgeSource=readFileSync(new URL('../../avigilon-managed-bridge.js',import.meta.url),'utf8');
const list=readFileSync(new URL('../../camera-health.html',import.meta.url),'utf8');
const detail=readFileSync(new URL('../../camera-detail.html',import.meta.url),'utf8');
const boardReader=list.slice(list.indexOf('async function loadCameraHealth('),list.indexOf('function applyCameraHealthUrlSearch('));
const detailReader=detail.slice(detail.indexOf('async function load(){'),detail.indexOf('async function verifyNow(){'));
const at='2026-10-16T12:00:00Z';
function fixture(page,{reassign=false,badOwner=false,noReceipt=false,denyNative=false,badEndpoint=false,absentManaged=false,disabled=false}={}){
 let generation='1';const reads=[],renders=[],elements=new Map();
 const device={id:10,unit_key:'Sniper 1',device_name:'Sniper 1 / Camera',connection_revision:2,public_ip:'8.8.8.8',expected_ports:[443],monitoring_profile:'sniper',device_type:'Sniper',organization:'Synthetic site',activation_state:'active'};
 const legacyHealth={camera_device_id:10,checked_at:at,overall_status:'online',ip_reachable:true};
 const summary=()=>{const unit=generation==='1'?'Sniper 1':'Sniper 2',owner=generation==='1'?'native-old':'native-new';return {evidenceVersion:2,avigilonAuthority:{contract:'COS_AVIGILON_AUTHORITY_V1',tenantId:'fixture',generation,rosterRevision:'r'+generation,admitted:true},unitIdentities:[{unitId:badOwner?'wrong-owner':owner,deviceIds:['10'],unitKeys:[unit]}],rows:[{id:10,unit,scope:'field',type:'Sniper',connection:{publicIp:'8.8.8.8',ports:[443]},...(absentManaged?{}:{avigilonPublication:noReceipt?null:{receiptId:'73',unitId:owner,rosterUnitId:'roster-'+owner,endpointRevision:badEndpoint?'3':'2'}}),serviceEvidence:{observedAt:noReceipt?null:at,status:noReceipt?'unknown':'online',reachable:noReceipt?null:true,confirmedOutage:false,consecutiveFailures:0}}]};};
 const db={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-only'}}})},from(table){const query={isSingle:false,select(){return this;},order(){return this;},range(){return this;},eq(){return this;},in(){return this;},ilike(){return this;},limit(){return this;},single(){this.isSingle=true;return this;},maybeSingle(){this.isSingle=true;return this;},then(resolve,reject){reads.push(table);if(table==='camera_health_current'&&reassign)generation='2';let data=table==='camera_devices'?structuredClone(device):table==='camera_health_current'?legacyHealth:[];if(!this.isSingle&&!Array.isArray(data))data=[data];return Promise.resolve({data,error:null}).then(resolve,reject);}};return query;}};
 const element=()=>({style:{},textContent:'',classList:{add(){},remove(){},contains(){return true;}},scrollIntoView(){},focus(){}});
 const context=vm.createContext({URLSearchParams,location:{search:'?id=10'},console:{warn(){},error(){}},Date,setTimeout:()=>0,clearTimeout(){},crypto:{randomUUID:()=> 'synthetic-only'},fetch:async(url,o)=>{const request=JSON.parse(o.body);reads.push(request.path);if(denyNative)return Response.json({error:'Initiating actor revoked'},{status:403});return Response.json(request.path==='/api/session'?{features:{freshAvigilonChecks:!disabled}}:summary());},
  $:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);},document:{querySelectorAll:()=>[]},wait:async p=>p,stage(){},CameraHealthOverview:{validateSources(){}},rebuildTrackerStateIndex(){},render(){renders.push(vm.runInContext('({devices:typeof devices!=="undefined"&&devices.length?devices:[device],health:typeof health!=="undefined"&&Object.keys(health).length?health:{10:current}})',context));},refreshOpenUnitDetails(){},restoreCameraHealthReturnState(){},applyCameraHealthUrlSearch(){},renderProviderHealth(){},restoreUnitDetailsFromUrl(){},refreshEffectivePlacement(){},renderEffectivePlacement(){},loadConnectionEditor:async()=>{},cameraGroup:()=> 'Sniper'});
 vm.runInContext(bridgeSource,context);context.db=context.AvigilonManagedBridge.create(db,context.fetch).db;
 vm.runInContext('let devices=[],masterInventory=[],trackerMaster=[],integrationMeta={},health={},routers=[],boardDataReady=false,selectedUnitKey=null,detailLoadRevision=0,device=null,current={},events=[],unitRouters=[];\n'+(page==='board'?boardReader:detailReader),context);
 return {context,reads,renders,read:()=>page==='board'?context.loadCameraHealth({background:true}):context.load()};
}
for(const page of ['board','detail']){
 test(page+' rejects reassignment between the actual identity and health reads before rendering',async()=>{const f=fixture(page,{reassign:true});await assert.rejects(f.read(),/authority changed during read/i);assert.equal(f.renders.length,0);});
 test(page+' rejects a receipt whose native unit does not own the loaded device',async()=>{const f=fixture(page,{badOwner:true});await assert.rejects(f.read(),/receipt.*(owner|membership)|ownership/i);assert.equal(f.renders.length,0);});
 for(const [label,options,reason] of [['changed endpoint',{badEndpoint:true},/receipt endpoint/],['missing managed identity',{absentManaged:true},/managed identity missing/],['revoked initiating actor',{denyNative:true},/Initiating actor revoked/]])test(page+' rejects '+label+' without rendering current health',async()=>{const f=fixture(page,options);await assert.rejects(f.read(),reason);assert.equal(f.renders.length,0);});
 test(page+' clears legacy saved success when the managed source has no current receipt',async()=>{const f=fixture(page,{noReceipt:true});await f.read();const h=f.renders[0].health[10];assert.equal(h.overall_status,'unknown');assert.equal(h.checked_at,null);assert.equal(h.native_publication_receipt,null);assert.equal(Object.keys(h.port_status).length,0);assert.equal(h.native_authority.generation,'1');});
 test(page+' preserves the authorized legacy reader while the native runtime is disabled',async()=>{const f=fixture(page,{disabled:true});await f.read();assert.equal(f.renders[0].health[10].overall_status,'online');assert.equal(f.reads.filter(path=>path==='/api/camera-health/summary-v3').length,0);});
 test(page+' retains the generation and ownership of a complete saved read',async()=>{const f=fixture(page);await f.read();assert.equal(f.renders.length,1);const rendered=f.renders[0],health=rendered.health[10];assert.equal(rendered.devices[0].unit_key,'Sniper 1');assert.equal(health.native_publication_receipt,'73');assert.equal(health.native_authority.generation,'1');assert.equal(health.native_unit_id,'native-old');assert.equal(health.native_unit_key,'Sniper 1');});
}

test('actual legacy action handlers cannot create orphan tickets or write guarded health and activation tables',async()=>{
 const start=list.indexOf("document.addEventListener('click',async e=>{const prev=");
 const handler=list.slice(start,list.indexOf("});$('cameraLogin').onclick=",start)+3);
 for(const type of ['ack-unit','ticket-unit','activate-unit','activate']){
  let listener;const messages=[],button={disabled:false,title:'',matches:selector=>selector==='.'+type};
  const context=vm.createContext({document:{addEventListener:(event,callback)=>listener=callback},alert:message=>messages.push(message),db:new Proxy({},{get(){assert.fail('Unavailable action attempted a database call');}})});
  vm.runInContext(handler,context);
  const event={target:{closest:selector=>selector.split(',').includes('.'+type)?button:null},preventDefault(){}};
  await listener(event);await listener(event);
  assert.equal(button.disabled,true);assert.equal(messages.length,2);assert.match(messages[0],/unavailable/i);
  if(type==='ticket-unit')assert.match(messages[0],/No ticket was created/);
  if(type==='ack-unit')assert.match(messages[0],/No acknowledgment was saved/);
 }
});

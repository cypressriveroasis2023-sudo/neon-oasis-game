import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEquipmentCsv} from '../../supabase/functions/cos-operations-pages/mhelpEquipmentCsvPreview.ts';
import {verify2027CensusRanges} from '../../supabase/functions/cos-operations-pages/mhelp2027ProductCensus.ts';
import {verify2027ConnectionCensus} from '../../supabase/functions/cos-operations-pages/mhelp2027ConnectionCensus.ts';
import {buildExactProductConnections,TRACKER_CONNECTION_CENSUS_V2,TRACKER_IP_WORKBOOK} from '../src/exactProductConnection.ts';
const now=Date.parse('2026-10-27T12:00:00Z'),at=new Date(now).toISOString(),hash='a'.repeat(64),filename='ServiceItem_List_20261023120000.csv';
const ranges=["'UNIT OVERVIEW'!A1:E1500","'UNIT OVERVIEW'!O1:O1500","'UNIT OVERVIEW'!Q1:R1500","'MHELP MATCH INDEX'!A1:B1200","'MHELP MATCH INDEX'!D1:E1200","'MHELP MATCH INDEX'!H1:H1200","'UNIT OVERVIEW'!H1:H1500"];
function fixture(){
 const historic=parseEquipmentCsv([
  'ProductId,ProductModel,CustomerId,CustomerName,Category,Address,City,State,Zip',
  '11,Ranger 011,10,Synthetic Builders,Ranger,11 Fixture St,Houston,TX,77064',
  '12,Ranger 012,20,Cameras OnSite,Ranger,12 Fixture St,Houston,TX,77064',
  '13,Ranger 013,10,Synthetic Builders,Ranger,13 Fixture St,Houston,TX,77064',
  '14,Ranger 014,20,Cameras OnSite,Ranger,14 Fixture St,Houston,TX,77064'
 ].join('\n'));
 const current=structuredClone(historic);
 current[1].placement='FIELD';current[1].customer='Different Synthetic Builders';
 const values=[
  [['EQUIPMENT TYPE','UNIT #','PLACEMENT','LIVE STATUS','CUSTOMER'],...historic.map(x=>['RANGERS',x.unitNumber,x.placement,'UNKNOWN',x.customer])],
  [['MHELP EQUIPMENT ID'],...historic.map(x=>[x.productId])],
  [['TRACKER PLACEMENT','MHELP PLACEMENT'],...historic.map(x=>[x.placement,x.placement])],
  [['TRACKER MATCH KEY','MHELP EQUIPMENT ID'],...historic.map(x=>['RANGERS|'+x.unitNumber,x.productId])],
  [['MHELP EQUIPMENT NAME','MHELP CUSTOMER / SITE'],...historic.map(x=>[x.unitNumber,x.customer])],
  [['MHELP SOURCE EXPORT'],...historic.map(()=>[filename])],
  [['IP'],['8.8.8.8'],['1.1.1.1'],['9.9.9.9'],[]]
 ].map((v,i)=>({range:ranges[i],majorDimension:'ROWS',values:v}));
 const accepted={contract:'COS_MHELP_UPLOAD_INVENTORY_V1',countBasis:'mhelp_product_records_not_unique_physical_units',
  sourceSha256:hash,receivedAt:at,source:'mhelpdesk_api',lastApiReadAt:at,
  summary:{totalRecords:4,fieldRecords:3,shopRecords:1,unflaggedFieldRecords:3,doNotUseRecords:0,missingRecords:0},
  records:current.map(r=>({productId:r.productId,recordId:'mhelp_product:'+r.productId,placement:r.placement,uploadLifecycle:r.lifecycle}))};
 return {values,current,historic,accepted};
}
const endpoint=(id,ip,online)=>({deviceId:id,publicIp:ip,expectedPorts:[80],monitoringEnabled:true,connectionRevision:2,
 portStatus:{80:{online,attempted:true},_connection:{ip,revision:2,checkedAt:at,status:online?'online':'offline',reachable:online}}});
const devices=[endpoint(101,'8.8.8.8',true),endpoint(102,'1.1.1.1',true),endpoint(103,'9.9.9.9',false)];
const verify=f=>verify2027ConnectionCensus(f.values,ranges,f.current,hash,at);
test('complete exact-ID census isolates one conflicting placement without relocating it or blocking other products',async()=>{
 const f=fixture(),original=structuredClone(f);
 const proof=await verify(f);
 assert.equal(proof.contract,TRACKER_CONNECTION_CENSUS_V2);
 assert.equal(proof.records.length,4);assert.equal(proof.records[1].placement,'SHOP');
 assert.deepEqual(proof.records[1].reviewReasons,['placement_mismatch','customer_mismatch']);
 assert.deepEqual(proof.records[0].reviewReasons,[]);
 const result=buildExactProductConnections(f.accepted,proof,devices,now,new Map([['11',['101']],['13',['103']]]));
 assert.deepEqual(result.items.map(p=>[p.productId,p.status]),[['11','online'],['12','unknown'],['13','offline']]);
 assert.match(result.items[1].reason,/review is required/);
 assert.equal(result.items[1].resourceId,null);
 assert.equal(result.items[1].checkedAt,null);
 assert.doesNotMatch(JSON.stringify(result),/8\.8\.8\.8|1\.1\.1\.1|Different Synthetic/);
 assert.deepEqual(f,original,'source/placements and signatures were never rewritten');
});
test('the equipment import verifier remains all-or-nothing for a changed physical placement',async()=>{
 const f=fixture();
 await assert.rejects(verify2027CensusRanges(f.values.slice(0,6),ranges.slice(0,6),f.current,filename,at),/disagrees/);
});
test('held records still reserve IP ownership across Field and Shop',async()=>{
 const f=fixture();f.values[6].values[2]=['8.8.8.8'];
 const result=buildExactProductConnections(f.accepted,await verify(f),devices,now,new Map([['11',['101']],['13',['103']]]));
 assert.equal(result.items[0].status,'unknown');assert.equal(result.items[1].status,'unknown');
 assert.equal(result.items[2].status,'offline');
});
test('missing/extra/duplicate Product IDs, shifted rows/columns and inconsistent source index fail the entire source',async()=>{
 const mutations=[
  f=>f.values[1].values[2][0]='99',
  f=>f.values[1].values[2][0]='11',
  f=>f.values[3].values.pop(),
  f=>f.values[3].values[2][1]='99',
  f=>f.values[3].values[1][0]='RANGERS|Wrong 999',
  f=>f.values[5].values[2][0]='ServiceItem_List_20261024120000.csv',
  f=>f.values[6].values.splice(1,0,[]),
  f=>f.values[6].range="'UNIT OVERVIEW'!I1:I1500",
  f=>f.values[6].range="'UNIT OVERVIEW'!H2:H1500",
  f=>f.values[0].values[1][4]='',
  f=>f.current.push({...f.current[0]}),
  f=>f.values[6].values[1].push('extra column')
 ];
 for(const mutate of mutations){const f=fixture();mutate(f);await assert.rejects(verify(f),/evidence is unavailable/,String(mutate));}
});
test('source identity/customer/restriction changes hold that exact Product ID',async()=>{
 for(const [mutate,reason] of [
  [f=>f.current[0].unitNumber='Ranger 099','identity_mismatch'],
  [f=>f.current[0].customer='Changed Synthetic Customer','customer_mismatch'],
  [f=>f.values[2].values[1][0]='RETIRED','tracker_restriction'],
  [f=>f.values[2].values[1][1]='SHOP','tracker_restriction']
 ]){
  const f=fixture();mutate(f);const proof=await verify(f);
  assert.ok(proof.records[0].reviewReasons.includes(reason));
  const result=buildExactProductConnections(f.accepted,proof,devices,now,new Map([['11',['101']],['13',['103']]]));
  assert.equal(result.items[0].status,'unknown');assert.equal(result.items[2].status,'offline');
 }
});
test('safe A1 quoting and trailing empty cells are allowed, row indices remain stable',async()=>{
 const f=fixture();
 for(const r of f.values)r.range=r.range.replaceAll("'",'');
 f.values[6].values[4]=[null];
 const result=await verify(f);
 assert.equal(result.records[3].publicIp,null);assert.equal(result.records[0].publicIp,'8.8.8.8');
 assert.equal(result.records[1].productId,'12');
});
test('a malformed V2 hold cannot permit status under an unmatched placement or checksum',async()=>{
 const f=fixture(),proof=await verify(f);
 const unheld=structuredClone(proof);unheld.records[1].reviewReasons=[];
 assert.equal(buildExactProductConnections(f.accepted,unheld,devices,now,new Map([['11',['101']],['13',['103']]])),null);
 const repeated=structuredClone(proof);repeated.records[1].sourceRow=repeated.records[0].sourceRow;
 assert.equal(buildExactProductConnections(f.accepted,repeated,devices,now,new Map([['11',['101']],['13',['103']]])),null);
 const forged=structuredClone(proof);forged.records[0].reviewReasons=['made_up'];
 assert.equal(buildExactProductConnections(f.accepted,forged,devices,now,new Map([['11',['101']],['13',['103']]])),null);
 const stale=structuredClone(proof);stale.expectedMhelpSourceSha256='b'.repeat(64);
 assert.equal(buildExactProductConnections(f.accepted,stale,devices,now,new Map([['11',['101']],['13',['103']]])),null);
});

import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
const actors={
 owner:{id:'e4abc521-1ef3-45a6-9829-b87faff78210',actor:'3f073784-96e7-43d8-b9e0-33ab31c3c8b1',role:'owner',name:'Owner',code:'owner'},
 it:{id:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',actor:'d0757b64-9623-4adc-afff-21cc7853e88a',role:'it',name:'Teddy Hopper',code:'it_technician'},
 service:{id:'78e54fbd-c2db-4d18-8e3d-a9740adcf285',actor:'7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8',role:'service',name:'Abel Cervantes',code:'service_technician'}
};
function routeFixture(role='owner',active=true,options={}){
 const f=fixture(),user=actors[role],calls=[],stamp=new Date().toISOString();
 const secret=JSON.stringify({type:'service_account',client_email:'synthetic@testing-project.iam.gserviceaccount.com',
  private_key_id:'synthetickey123',private_key:'-----BEGIN PRIVATE KEY-----\nfake-synthetic-only-not-a-key\n-----END PRIVATE KEY-----\n',token_uri:'https://oauth2.googleapis.com/token'});
 const snapshot={contract:'COS_MHELP_API_V1',origin:'mhelpdesk_api',portalId:'224643',reviewed:true,complete:true,
  sourceSha256:hash,payloadSha256:'b'.repeat(64),recordCount:4,receivedAt:stamp,receivedAtPrecision:'second',exportAsOf:null,records:f.current,apiMissingRecords:[],apiSync:{lastSuccessAt:stamp}};
 const devicesCurrent=devices.map(d=>({...d,portStatus:{...d.portStatus,_connection:{...d.portStatus._connection,checkedAt:stamp}}}));
 const handler=createOperationsHandler({...options,platformUrl:'https://platform.example',serviceKey:'synthetic-service',
  googleSheets:{getServiceAccountJson:()=>secret,signAssertion:async()=> 'synthetic.header.signature'},fetch:async(url,init={})=>{
   calls.push({url,init});
   if(options.testPendingPath&&url.includes(options.testPendingPath)){options.onPending?.();return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));}
   if(options.testFailurePath&&url.includes(options.testFailurePath))return Response.json({message:'SECRET_RAW_SOURCE_ERROR',error:'<script>SECRET</script>'},{status:options.testFailureStatus||503});
   if(url.includes('/auth/v1/user'))return Response.json({id:user.id});
   if(url.includes('/profiles?'))return Response.json([{user_id:user.id,full_name:user.name,role:user.role,active,archived_at:null}]);
   if(url.includes('/user_profiles?'))return Response.json([{user_id:user.actor,display_name:user.name,department:user.role,active:true}]);
   if(url.includes('/user_roles?'))return Response.json([{roles:{code:user.code,organization_id:'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'}}]);
   if(url.endsWith('/rpc/cos_mhelp_placement_snapshot')){if(options.testUploadError)return {ok:true,json:async()=>({get upload(){throw options.testUploadError;}})};return Response.json({upload:snapshot});}
   if(url.endsWith('/rpc/cos_owner_identity_snapshot'))return Response.json({revision:'f'.repeat(64),claims:[],nativeEpochs:[]});
   if(url.endsWith('/rpc/appdeploy_field_map_snapshot'))return Response.json({items:[],inventoryItems:[]});
   if(url.includes('cos_camera_identity_epochs_v1')||url.includes('equipment_units?')||url.includes('vision_vigilant_')||url.includes('placement_audits')||url.includes('cos_fleet_placement_evidence_v1'))return Response.json([]);
   if(url.includes('/camera_devices?'))return Response.json(devicesCurrent.map(d=>({id:d.deviceId,public_ip:d.publicIp,expected_ports:d.expectedPorts,connection_revision:d.connectionRevision,monitoring_enabled:d.monitoringEnabled})));
   if(url.includes('/camera_health_current?'))return Response.json(devicesCurrent.map(d=>({camera_device_id:d.deviceId,port_status:d.portStatus})));
   if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-access-token',token_type:'Bearer'});
   if(url.includes('sheets.googleapis.com')&&url.includes('/values:batchGet'))return Response.json({valueRanges:f.values});
   if(url.startsWith('https://sheets.googleapis.com/'))return Response.json({spreadsheetId:TRACKER_IP_WORKBOOK,properties:{title:'2027 UNIT TRACKER'},sheets:[
    {properties:{sheetId:1132540236,title:'UNIT OVERVIEW',sheetType:'GRID',hidden:false,gridProperties:{rowCount:1500,columnCount:23}}},
    {properties:{sheetId:1900169011,title:'MHELP MATCH INDEX',sheetType:'GRID',hidden:false,gridProperties:{rowCount:1200,columnCount:9}}}
   ]});
   throw Error('Unmocked transport forbidden');
  }});
 const request=(method='GET',body=null)=>new Request('https://platform.example/functions/v1/cos-operations-pages',{
  method:'POST',headers:{Authorization:'Bearer synthetic-user','Content-Type':'application/json'},
  body:JSON.stringify({method,path:'/api/product-connections',body})});
 return {handler,request,calls,snapshot,values:f.values};
}
for(const role of ['owner','it'])test(`protected ${role} route returns current exact-ID statuses while holding mismatched product`,async()=>{
 const f=routeFixture(role),response=await f.handler(f.request()),text=await response.text();
 assert.equal(response.status,200,text);
 const result=JSON.parse(text);
 assert.deepEqual(result.items.map(p=>[p.productId,p.status]),[['11','unknown'],['12','unknown'],['13','unknown']]);
 assert.doesNotMatch(text,/8\.8\.8\.8|1\.1\.1\.1|private_key|Bearer|Different Synthetic/);
 assert.equal(f.calls.some(c=>c.url.includes('/camera-health-check')||c.url.includes('/camera-health-sweep')),false,'saved checks only, no live probes');
 assert.equal(f.calls.filter(c=>c.url.includes('/rest/v1/')).every(c=>!c.init.method||c.init.method==='GET'||['cos_mhelp_placement_snapshot','cos_owner_identity_snapshot','appdeploy_field_map_snapshot','cos_camera_identity_epochs_v1','cos_fleet_placement_evidence_v1'].some(n=>c.url.endsWith('/'+n))),true);
});
for(const [role,active] of [['service',true],['owner',false],['it',false]])test(`unauthorized ${role} active=${active} cannot read source or endpoint configuration`,async()=>{
 const f=routeFixture(role,active),response=await f.handler(f.request());
 assert.equal(response.status,403);
 assert.equal(f.calls.some(c=>c.url.includes('sheets.googleapis.com')||c.url.includes('/camera_devices?')||c.url.includes('/cos_mhelp_placement_snapshot')),false);
});
test('corrupted full source remains unavailable through the authenticated route, never partly certified',async()=>{
 const f=routeFixture();f.values[1].values[1][0]='99';
 const response=await f.handler(f.request()),text=await response.text();
 assert.equal(response.status,503,text);assert.doesNotMatch(text,/synthetic-access-token|PRIVATE KEY|8\.8\.8\.8/);
});

test('full 1,001-ID membership stays intact while only three assignment conflicts are held',async()=>{
 const f=fixture(),current=[];
 const headers=f.values.map(v=>structuredClone(v.values[0]));
 const data=headers.map(h=>[h]);
 for(let i=1;i<=1001;i++){
  const id=String(100000+i),name='Ranger '+String(i).padStart(4,'0');
  const placed=i<=287?'FIELD':'SHOP',oldPlacement=i>=285&&i<=287?'SHOP':placed;
  const customer=placed==='FIELD'?'Synthetic Builders':'Cameras OnSite';
  const oldCustomer=oldPlacement==='FIELD'?'Synthetic Builders':'Cameras OnSite';
  current.push({...f.historic[0],productId:id,unitNumber:name,placement:placed,customer});
  data[0].push(['RANGERS',name,oldPlacement,'UNKNOWN',oldCustomer]);data[1].push([id]);
  data[2].push([oldPlacement,oldPlacement]);data[3].push(['RANGERS|'+name,id]);
  data[4].push([name,oldCustomer]);data[5].push([filename]);data[6].push([]);
 }
 const proof=await verify2027ConnectionCensus(data.map((values,i)=>({range:ranges[i],majorDimension:'ROWS',values})),ranges,current,hash,at);
 assert.equal(proof.records.length,1001);
 assert.equal(new Set(proof.records.map(r=>r.productId)).size,1001);
 assert.equal(proof.records.filter(r=>r.reviewReasons.length).length,3);
 assert.deepEqual(proof.records.filter(r=>r.reviewReasons.length).map(r=>r.productId),['100285','100286','100287']);
 assert.equal(proof.records.filter(r=>r.placement==='FIELD').length,284);
 assert.equal(current.filter(r=>r.placement==='FIELD').length,287,'current mHelp assignment is never rewritten');
});

test('mounted native proof route remains disabled after existing Owner/IT authentication and denies service accounts',async()=>{
 for(const role of ['owner','it','service']){
  const f=routeFixture(role);const response=await f.handler(new Request('https://platform.example/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer synthetic-user','Content-Type':'application/json'},body:JSON.stringify({method:'POST',path:'/api/product-tcp-proof',body:{productIds:['11']}})}));
  assert.equal(response.status,role==='service'?403:503);
  assert.equal(f.calls.some(c=>c.url.endsWith('/rpc/cos_mhelp_placement_snapshot')||c.url.includes('sheets.googleapis.com')),false);
 }
});
test('preview flag is independent of proof/overlay and preserves existing Owner/IT/service gates',async()=>{
 const origin='https://cypressriveroasis2023-sudo.github.io';
 const req=(path,ids=['11'])=>new Request('https://platform.example/functions/v1/cos-operations-pages',{method:'POST',headers:{Origin:origin,Authorization:'Bearer synthetic-user','Content-Type':'application/json'},body:JSON.stringify({method:'POST',path,body:{productIds:ids}})});
 for(const role of ['owner','it','service']){
  const f=routeFixture(role,true,{productTcpPreviewEnabled:true});
  const r=await f.handler(req('/api/product-tcp-preview',Array.from({length:9},(_,i)=>String(i+1))));assert.equal(r.status,role==='service'?403:409);assert.equal(f.calls.some(c=>c.url.includes('cos_mhelp_placement_snapshot')||c.url.includes('cos_owner_identity_snapshot')||c.url.includes('sheets.googleapis.com')),false);
  const proof=await f.handler(req('/api/product-tcp-proof'));assert.equal(proof.status,role==='service'?403:503);
  for(const response of [r,proof]){assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);assert.equal(response.headers.get('Vary'),'Origin');assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');}
 }
 const f=routeFixture('owner',true,{scopedProductTcpEnabled:true});assert.equal((await f.handler(req('/api/product-tcp-preview'))).status,503);
 const preview=routeFixture('owner',true,{productTcpPreviewEnabled:true});const r=await preview.handler(preview.request());assert.equal(r.status,200);assert.deepEqual((await r.json()).items.map(p=>p.status),['unknown','unknown','unknown']);assert.equal(preview.calls.some(c=>c.url.includes('cos-exact-product-tcp')),false);
});
test('existing connection route reports only bounded failed stage without extra reads or raw errors',async()=>{
 for(const [path,stage] of [['/rpc/cos_mhelp_placement_snapshot','mhelp_census'],['sheets.googleapis.com','tracker_census'],['/camera_devices?','saved_endpoints'],['/camera_health_current?','saved_checks']]){
  const f=routeFixture('owner',true,{testFailurePath:path}),r=await f.handler(f.request());assert.equal(r.status,503);const body=await r.json();
  assert.deepEqual(body,{error:'Saved connection source could not be verified.',diagnostic:{stage,code:'source_unavailable'}});assert.doesNotMatch(JSON.stringify(body),/SECRET|script/);
  assert.equal(f.calls.filter(c=>c.url.includes(path)).length,1);
 }
 const f=routeFixture();f.snapshot.apiSync.lastSuccessAt='2020-01-01T00:00:00Z';const r=await f.handler(f.request());assert.equal(r.status,503);assert.equal((await r.json()).diagnostic.stage,'endpoint_evaluation');
});

import {PrivateEvidenceError} from '../../supabase/functions/cos-operations-pages/privateEvidence.ts';
import {SheetsConnectionError} from '../../supabase/functions/cos-operations-pages/googleSheets.ts';
import {UnitTrackerError} from '../../supabase/functions/cos-operations-pages/unitTracker.ts';
import {OwnerIdentityError} from '../../supabase/functions/cos-operations-pages/ownerIdentityCrosswalk.ts';
import {InhandPilotError} from '../../supabase/functions/cos-operations-pages/inhandPilot.ts';
import {MhelpImportError} from '../../supabase/functions/cos-operations-pages/mhelpImport.ts';
import {MhelpPartnerError} from '../../supabase/functions/cos-operations-pages/mhelpPartner.ts';
import {MhelpTicketError} from '../../supabase/functions/cos-operations-pages/mhelpTickets.ts';
test('exact connection route preserves every recognized exception status while hiding its raw message',async()=>{
 const pilot=new InhandPilotError('unavailable');pilot.status=429;
 const cases=[[new PrivateEvidenceError('SECRET',404),404],[new SheetsConnectionError('SECRET',401),401],[new UnitTrackerError('SECRET',400),400],[new OwnerIdentityError('SECRET',409),409],[pilot,429],[new MhelpImportError('SECRET',422),422],[new MhelpPartnerError('SECRET',403),403],[new MhelpTicketError('SECRET',502),502],[Object.assign(new Error('SECRET'),{status:418}),503]];
 for(const [error,status] of cases){const f=routeFixture('owner',true,{testUploadError:error}),response=await f.handler(f.request());assert.equal(response.status,status,error.constructor.name);assert.deepEqual(await response.json(),{error:'Saved connection source could not be verified.',diagnostic:{stage:'mhelp_census',code:'source_unavailable'}});}
});

test('identity RPC denial is a failed source, never IP-only status fallback',async()=>{
 for(const role of ['owner','it']){const f=routeFixture(role,true,{testFailurePath:'/rpc/cos_owner_identity_snapshot',testFailureStatus:403}),r=await f.handler(f.request());assert.equal(r.status,403);const body=await r.json();assert.equal(body.items,undefined);assert.equal(body.diagnostic.stage,'endpoint_evaluation');}
});
test('incoming status cancellation aborts guarded source transport and cannot return late status',async()=>{
 let started;const ready=new Promise(r=>started=r),c=new AbortController();
 const f=routeFixture('owner',true,{testPendingPath:'/rpc/cos_owner_identity_snapshot',onPending:started});
 const pending=f.handler(new Request(f.request(),{signal:c.signal}));await ready;c.abort();const r=await pending;assert.equal(r.status,503);assert.equal((await r.json()).items,undefined);
 const call=f.calls.find(c=>c.url.includes('/rpc/cos_owner_identity_snapshot'));assert.equal(call.init.signal.aborted,true);
});

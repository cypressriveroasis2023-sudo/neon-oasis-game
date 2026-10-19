import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationalSheetSyncRuntime} from '../../supabase/functions/cos-operational-sheets-sync/runtime.ts';
import {OPERATIONAL_SHEETS_TABS,COS_2027_WORKBOOK} from '../../supabase/functions/cos-sheets-placement-publish/operationalSyncModel.ts';
const SHA='a'.repeat(64),BOOK=COS_2027_WORKBOOK,ORG_URL='https://tughscoxralhofrckvxy.supabase.co';
const text=v=>({userEnteredValue:{stringValue:v}});
const standard=['UNIT #','PLACEMENT','CUSTOMER','SITE / PROJECT','PHYSICAL ADDRESS'];
const special=['Unit','Status','Customer','Site Name / Project','Location / Address'];
const operational=['FIELD','Builder','Site Alpha','400 Builder St, Houston TX'];
function fixtures(){
 const tabs=OPERATIONAL_SHEETS_TABS.map((t,i)=>{
  const label=t.title==='SOLAR POLES & SKIDS'?'Solar Pole 72 001':t.title+' 001';
  const properties={sheetId:t.id,title:t.title,sheetType:'GRID',hidden:false,gridProperties:{rowCount:8,columnCount:80}};
  const head=t.title==='SOLAR POLES & SKIDS'?special:standard;
  return {label,properties,data:t.columns.map((column,j)=>({startRow:0,startColumn:column,rowData:[
   {values:[text(head[j])]},{values:[text(j===0?label:operational[j-1])]}
  ]}))};
 });
 const index={properties:{sheetId:1900169011,title:'MHELP MATCH INDEX',sheetType:'GRID',hidden:false,gridProperties:{rowCount:20,columnCount:8}},data:[
  {startRow:0,startColumn:0,rowData:[{values:[text('TRACKER MATCH KEY')]},...tabs.map(s=>({values:[text(s.properties.title+'|'+s.label)]}))]},
  {startRow:0,startColumn:1,rowData:[{values:[text('MHELP EQUIPMENT ID')]},...tabs.map((_,i)=>({values:[text(String(i+101))]}))]}
 ]};
 return {
  metadata:{spreadsheetId:BOOK,properties:{title:'2027 UNIT TRACKER'},sheets:[...tabs,index].map(x=>({properties:x.properties}))},
  grid:{spreadsheetId:BOOK,properties:{title:'2027 UNIT TRACKER'},sheets:[...tabs,index]}
 };
}
const key=JSON.stringify({type:'service_account',client_email:'cos-unit-tracker@causal-jigsaw-511211-k9.iam.gserviceaccount.com',private_key_id:'abcdefghij',token_uri:'https://oauth2.googleapis.com/token',private_key:'-----BEGIN PRIVATE KEY-----\nQUJD\n-----END PRIVATE KEY-----\n'});
const schedule=()=>new Request('https://cos.example.test/functions/v1/cos-operational-sheets-sync',{
 method:'POST',headers:{'Content-Type':'application/json','x-camera-cron-secret':'fake-cron-secret'},body:'{"action":"run"}'});
test('operational worker defaults OFF and neither reads nor writes any production source',async()=>{
 const calls=[],handler=createOperationalSheetSyncRuntime({getEnv:()=>undefined,fetch:async request=>{calls.push(request);throw Error('Unexpected network call');},signAssertion:async()=>''});
 const resp=await handler(schedule());
 assert.equal(resp.status,202);
 assert.equal((await resp.json()).state,'disabled');
 assert.equal(calls.length,0);
});
test('protected worker authenticates, double-reads exact 12-tab workbook and only bootstraps mirror; no Sheet mutations or COS unit moves',async()=>{
 const {metadata,grid}=fixtures(),calls=[];
 let bootstrap=null;
 const environment={COS_OPERATIONAL_SHEETS_WORKER_ENABLED:'true',SUPABASE_URL:ORG_URL,SUPABASE_SERVICE_ROLE_KEY:'fake-service-secret',COS_GOOGLE_SERVICE_ACCOUNT_JSON:key};
 const handler=createOperationalSheetSyncRuntime({
  getEnv:name=>environment[name],
  signAssertion:async()=> 'fake.signature.not-used-in-synthetic-transport',
  fetch:async(url,init)=>{
   url=String(url);calls.push({url,method:init?.method,body:init?.body});
   const json=(data,status=200)=>Response.json(data,{status});
   if(url.includes('/camera-mhelp-readiness'))return json({authenticated:true});
   if(url.includes('/rpc/cos_operational_sheet_sync_begin'))
    return json({contract:'COS_OPERATIONAL_SHEETS_LEASE_V1',leaseId:'11111111-1111-4111-8111-111111111111',
     sourceSha256:SHA,mirrors:[],outbox:[]});
   if(url.includes('/rpc/cos_operational_sheet_sync_bootstrap')){
    bootstrap=JSON.parse(init.body);
    return json({committed:true,bootstrapped:bootstrap.p_rows.length});
   }
   if(url.includes('/rpc/cos_operational_sheet_sync_finish'))return json({committed:true});
   if(url.includes('/rpc/cos_operational_sheet_sync_fail'))return json({});
   if(url==='https://oauth2.googleapis.com/token')return json({access_token:'fake',token_type:'Bearer',expires_in:3600});
   if(url.includes('/spreadsheets/'+BOOK)&&url.includes('ranges='))return json(grid);
   if(url.includes('/spreadsheets/'+BOOK))return json(metadata);
   return json({error:'unexpected synthetic endpoint'},404);
  }
 });
 const response=await handler(schedule());
 const body=await response.json();
 assert.equal(response.status,200,JSON.stringify(body));
 assert.equal(body.state,'baseline_verified');
 assert.equal(body.equipment,12);
 assert.equal(body.changesApplied,0);
 assert.equal(bootstrap?.p_rows.length,12);
 assert.ok(bootstrap.p_rows.every(r=>r.matchKey.includes('|')&&r.productId));
 assert.equal(calls.filter(c=>c.url.includes('/spreadsheets/'+BOOK)&&c.method==='GET').length,3);
 assert.equal(calls.filter(c=>c.url.includes('/spreadsheets/'+BOOK)&&c.method==='POST').length,0);
 assert.ok(calls.every(c=>!c.url.includes('/rpc/cos_operational_transfer_apply')));
});
test('feature flag enabled but missing shared cron authentication cannot read Google or Supabase',async()=>{
 let calls=0;
 const handler=createOperationalSheetSyncRuntime({
  getEnv:name=>name==='COS_OPERATIONAL_SHEETS_WORKER_ENABLED'?'true':name==='SUPABASE_URL'?ORG_URL:undefined,
  signAssertion:async()=>'',fetch:async()=>{calls++;throw Error('Unexpected transport')}
 });
 const request=new Request('https://cos.example.test/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"run"}'});
 const response=await handler(request);
 assert.equal(response.status,403);
 assert.equal(calls,0);
});

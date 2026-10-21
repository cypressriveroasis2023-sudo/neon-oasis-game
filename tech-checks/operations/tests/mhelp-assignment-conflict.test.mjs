import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
import {parseEquipmentCsv} from '../../supabase/functions/cos-operations-pages/mhelpEquipmentCsvPreview.ts';
import {UNIT_TRACKER_WORKBOOK} from '../../supabase/functions/cos-operations-pages/unitTracker.ts';
const owner='e4abc521-1ef3-45a6-9829-b87faff78210',actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',stage='11111111-1111-4111-8111-111111111111';
const filename='ServiceItem_List_20261020172623.csv',csv='ProductId,ProductModel,CustomerId,CustomerName,Category,Address,City,State,Zip\n11,Ranger 007,100,Domain Builders,Ranger,113 Main St,Houston,TX,77064';
const source={sourceFilename:filename,bytesBase64:Buffer.from(csv).toString('base64')},previous={contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:'a'.repeat(64),records:parseEquipmentCsv(csv)};
const account=JSON.stringify({type:'service_account',client_email:'fixture@synthetic.iam.gserviceaccount.com',private_key_id:'synthetic-key-id',private_key:'-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----\n',token_uri:'https://oauth2.googleapis.com/token'});
const rangeValues=[
 [['EQUIPMENT TYPE','UNIT #','PLACEMENT','','CUSTOMER'],['Ranger','007','FIELD','','Domain Builders']],
 [['MHELP EQUIPMENT ID'],['11']],[['TRACKER PLACEMENT','MHELP PLACEMENT'],['FIELD','FIELD']],
 [['TRACKER MATCH KEY','MHELP EQUIPMENT ID'],['Ranger|007','11']],
 [['MHELP EQUIPMENT NAME','MHELP CUSTOMER / SITE'],['Ranger 007','Domain Builders']],
 [['MHELP SOURCE EXPORT'],[filename]]
];
function fixture(status=409){
 let mutations=0;
 const handler=createOperationsHandler({platformUrl:'https://native.example',serviceKey:'synthetic-service',ownerEquipmentImportEnabled:true,mhelpPlacementEnabled:true,googleSheets:{getServiceAccountJson:()=>account,signAssertion:async()=> 'synthetic.assertion.signature'},fetch:async(url,init={})=>{
  if(url.includes('/auth/v1/user'))return Response.json({id:owner});
  if(url.includes('/profiles?'))return Response.json([{user_id:owner,full_name:'Owner',role:'owner',active:true,archived_at:null}]);
  if(url.includes('/user_profiles?'))return Response.json([{user_id:actor,display_name:'Owner',department:'owner',active:true}]);
  if(url.includes('/user_roles?'))return Response.json([{role_id:stage,roles:{code:'owner',organization_id:org}}]);
  if(url.endsWith('/cos_mhelp_placement_snapshot'))return Response.json({upload:previous});
  if(url.endsWith('/cos_mhelp_location_snapshot'))return Response.json({});
  if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-only',token_type:'Bearer'});
  if(url.startsWith('https://sheets.googleapis.com/')){
   if(url.includes('/values:batchGet'))return Response.json({valueRanges:new URL(url).searchParams.getAll('ranges').map((range,i)=>({range,majorDimension:'ROWS',values:rangeValues[i]}))});
   return Response.json({spreadsheetId:UNIT_TRACKER_WORKBOOK,properties:{title:'2027 UNIT TRACKER'},sheets:[{properties:{sheetId:1132540236,title:'UNIT OVERVIEW',sheetType:'GRID',hidden:false,gridProperties:{rowCount:1002,columnCount:18}}},{properties:{sheetId:1900169011,title:'MHELP MATCH INDEX',sheetType:'GRID',hidden:false,gridProperties:{rowCount:1002,columnCount:9}}}]});
  }
  if(/\/cos_owner_mhelp_(equipment_stage|equipment_commit|assignment_review)_v1$/.test(url)){
   mutations++;const payload=JSON.parse(init.body);assert.equal(payload.p_actor_user_id,actor);assert.equal(payload.p_organization_id,org);
   return Response.json({code:status===409?'PT409':'40001',message:'private database detail must not reach the UI'},{status});
  }
  throw Error('Unexpected fixture request '+url);
 }});
 return {calls:()=>mutations,request:(path,extra)=>handler(new Request('https://native.example/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer synthetic-owner','Content-Type':'application/json',Origin:'https://cypressriveroasis2023-sudo.github.io'},body:JSON.stringify({path:'/api/mhelpdesk/equipment/'+path,method:'POST',body:{...source,...extra}})}))};
}
test('Owner stage, assignment read/approval, and commit surface one definite 409 without retrying or leaking SQL details',async()=>{
 for(const [path,body]of [['stage',{requestId:stage}],['assignments',{stageId:stage,action:'read'}],['assignments',{stageId:stage,action:'approve',reviewDigest:'d'.repeat(64),confirmationText:'I reviewed these exact current assignments.'}],['commit',{stageId:stage,confirmationText:'I approve this complete current source file.'}]]){
  const f=fixture(),response=await f.request(path,body);assert.equal(response.status,409,await response.clone().text());assert.deepEqual(await response.json(),{error:'The equipment source or assignment evidence changed. Refresh the Owner review before continuing.'});assert.equal(f.calls(),1);
 }
});
test('an unavailable equipment RPC stays 503 and does not expose SQLSTATE or private errors',async()=>{
 const f=fixture(500),response=await f.request('stage',{requestId:stage});assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/40001|private database detail/);assert.equal(f.calls(),1);
});

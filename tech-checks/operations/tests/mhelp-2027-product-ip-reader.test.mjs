import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {parseEquipmentCsv} from '../../supabase/functions/cos-operations-pages/mhelpEquipmentCsvPreview.ts';
import {read2027ProductIpsFromGoogle} from '../../supabase/functions/cos-operations-pages/mhelp2027ProductIpReader.ts';
import {buildExactProductConnections,TRACKER_IP_WORKBOOK,TRACKER_CONNECTION_CENSUS_V2} from '../src/exactProductConnection.ts';
globalThis.crypto??=webcrypto;

const records=()=>parseEquipmentCsv([
 'ProductId,ProductModel,CustomerId,CustomerName,Category,Address,City,State,Zip',
 '11,Ranger 007,10,Domain Builders,Ranger,113 Main St,Houston,TX,77064',
 '12,Ranger 024,20,Cameras OnSite,Ranger,9949 W Sam Houston,Houston,TX,77064'
].join('\n'));
const fullRanges=["'UNIT OVERVIEW'!A1:E1500","'UNIT OVERVIEW'!O1:O1500","'UNIT OVERVIEW'!Q1:R1500",
 "'MHELP MATCH INDEX'!A1:B1200","'MHELP MATCH INDEX'!D1:E1200","'MHELP MATCH INDEX'!H1:H1200",
 "'UNIT OVERVIEW'!H1:H1500"];
const filename='ServiceItem_List_20261016131754.csv',sourceHash='a'.repeat(64),at=Date.parse('2026-10-26T21:00:00Z');
const credentials=JSON.stringify({type:'service_account',token_uri:'https://oauth2.googleapis.com/token',
 client_email:'synthetic@testing-project.iam.gserviceaccount.com',private_key_id:'synthetickey123',
 private_key:'-----BEGIN PRIVATE KEY-----\nfake-synthetic-only-not-a-key\n-----END PRIVATE KEY-----\n'});
const ranges=(items=records())=>[
 [['EQUIPMENT TYPE','UNIT #','PLACEMENT','LIVE STATUS','CUSTOMER'],...items.map(x=>['CAM V & RSU',x.unitNumber,x.placement,'UNKNOWN',x.customer])],
 [['MHELP EQUIPMENT ID'],...items.map(x=>[x.productId])],
 [['TRACKER PLACEMENT','MHELP PLACEMENT'],...items.map(x=>[x.placement,x.placement])],
 [['TRACKER MATCH KEY','MHELP EQUIPMENT ID'],...items.map(x=>['CAM V & RSU|'+x.unitNumber,x.productId])],
 [['MHELP EQUIPMENT NAME','MHELP CUSTOMER / SITE'],...items.map(x=>[x.unitNumber,x.customer])],
 [['MHELP SOURCE EXPORT'],...items.map(()=>[filename])],
 [['IP'],['8.8.8.8'],['']]
].map((values,i)=>({range:fullRanges[i],majorDimension:'ROWS',values}));
function mockGoogle(override={}){
 const metadata={spreadsheetId:TRACKER_IP_WORKBOOK,properties:{title:'2027 UNIT TRACKER'},sheets:[
  {properties:{sheetId:1132540236,title:'UNIT OVERVIEW',sheetType:'GRID',hidden:false,gridProperties:{rowCount:1500,columnCount:23}}},
  {properties:{sheetId:1900169011,title:'MHELP MATCH INDEX',sheetType:'GRID',hidden:false,gridProperties:{rowCount:1200,columnCount:9}}}
 ]};
 const responses=ranges();
 if(override.badId)responses[1].values[1][0]='999';
 if(override.movedIp)responses[6].values[2]=['8.8.8.8'];
 if(override.badHeader)responses[6].values[0]=['MHELP IP ADDRESS'];
 if(override.shiftIp)responses[6].values.splice(1,0,[]);
 if(override.badMetadata)metadata.spreadsheetId='different-workbook';
 return async(url,init)=>{
  const target=String(url);
  if(target==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-access-token',token_type:'Bearer',expires_in:3600});
  if(!target.startsWith('https://sheets.googleapis.com/v4/spreadsheets/'+TRACKER_IP_WORKBOOK))throw Error('Wrong source request');
  if(init?.headers?.Authorization!=='Bearer synthetic-access-token')throw Error('Wrong authorization');
  if(target.includes('/values:batchGet'))return Response.json({valueRanges:responses});
  return Response.json(metadata);
 };
}
const read=(override={})=>read2027ProductIpsFromGoogle({
 getServiceAccountJson:()=>credentials,
 signAssertion:async()=> 'synthetic.header.signature',
 fetch:mockGoogle(override),candidate:records(),expectedMhelpSourceSha256:sourceHash,now:()=>at,
});
test('protected Google viewer loads exact 2027 Product IDs with IP and Field/Shop, never interpreting a provider name',async()=>{
 const result=await read();
 assert.equal(result.contract,TRACKER_CONNECTION_CENSUS_V2);
 assert.equal(result.records.length,2);
 assert.deepEqual(result.records[0],{productId:'11',recordId:'mhelp_product:11',placement:'FIELD',publicIp:'8.8.8.8',reviewReasons:[],sourceRow:2});
 assert.deepEqual(result.records[1],{productId:'12',recordId:'mhelp_product:12',placement:'SHOP',publicIp:null,reviewReasons:[],sourceRow:3});
 assert.equal(result.expectedMhelpSourceSha256,sourceHash);
});
test('a missing secret, inconsistent indexed Product ID, workbook, source placement or IP heading fail closed',async()=>{
 await assert.rejects(read2027ProductIpsFromGoogle({getServiceAccountJson:()=>null,candidate:records(),expectedMhelpSourceSha256:sourceHash}),/evidence is unavailable/);
 for(const option of [{badId:true},{badMetadata:true},{badHeader:true},{shiftIp:true}]){
  await assert.rejects(read(option),/evidence is unavailable/);
 }
});
test('multiple Products at one IP remain Unknown even when TCP responds and Shop stays excluded',async()=>{
 const r=await read({movedIp:true});
 const upload={contract:'COS_MHELP_UPLOAD_INVENTORY_V1',countBasis:'mhelp_product_records_not_unique_physical_units',
  sourceSha256:sourceHash,receivedAt:new Date(at).toISOString(),
  summary:{totalRecords:2,fieldRecords:1,shopRecords:1,unflaggedFieldRecords:1,doNotUseRecords:0,missingRecords:0},
  records:[{recordId:'mhelp_product:11',productId:'11',placement:'FIELD',uploadLifecycle:'UNFLAGGED'},
   {recordId:'mhelp_product:12',productId:'12',placement:'SHOP',uploadLifecycle:'UNFLAGGED'}]};
 const endpoint={deviceId:99,publicIp:'8.8.8.8',expectedPorts:[80],connectionRevision:1,monitoringEnabled:true,portStatus:{
  80:{online:true,attempted:true},_connection:{ip:'8.8.8.8',revision:1,checkedAt:new Date(at).toISOString(),status:'online',reachable:true}
 }};
 const value=buildExactProductConnections(upload,r,[endpoint],at);
 assert.equal(value.items.length,1);assert.equal(value.items[0].status,'unknown');
});

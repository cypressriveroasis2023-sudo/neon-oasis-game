import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareFleetConnectionReloadDeployment} from '../scripts/fleetConnectionReloadDeployment.mjs';
import {readProductCheckSource} from '../../supabase/functions/cos-operations-pages/productCheckSource.ts';
import {verifyProductsNow} from '../../supabase/functions/cos-operations-pages/productVerifyNow.ts';
import {buildTrackerIpReachability,readExactProductConnections,TRACKER_CONNECTION_CENSUS_V2,TRACKER_IP_WORKBOOK} from '../src/exactProductConnection.ts';
const patch=JSON.parse(readFileSync(new URL('../../docs/fleet-connection-reload-patch-20261103.json',import.meta.url),'utf8'));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
function fixture(){
 const at=new Date().toISOString(),sha='a'.repeat(64),ip='8.8.8.8';
 const records=[['1001','FIELD'],['1002','SHOP']].map(([productId,placement])=>({productId,recordId:'mhelp_product:'+productId,placement,uploadLifecycle:'UNFLAGGED',binding:{state:'unlinked',placementHeld:false,candidateUnitIds:[]}}));
 const census={contract:'COS_MHELP_UPLOAD_INVENTORY_V1',countBasis:'mhelp_product_records_not_unique_physical_units',sourceSha256:sha,receivedAt:at,summary:{totalRecords:2,fieldRecords:1,shopRecords:1,unflaggedFieldRecords:1,unflaggedShopRecords:1,doNotUseRecords:0,missingRecords:0},records};
 const tracker={contract:TRACKER_CONNECTION_CENSUS_V2,workbookId:TRACKER_IP_WORKBOOK,expectedMhelpSourceSha256:sha,trackerSourceSha256:'b'.repeat(64),sourceExport:'ServiceItem_List_20261103120000.csv',verifiedAt:at,records:records.map((r,i)=>({productId:r.productId,recordId:r.recordId,placement:r.placement,publicIp:i?null:ip,reviewReasons:[],sourceRow:i+2}))};
 const devices=[{id:41,unit_key:'HELIOS 001',public_ip:ip,expected_ports:[80],connection_revision:0,monitoring_enabled:true,activation_state:'active'}],checks=new Map(),calls=[];
 const io={receipt:async()=>({upload:census}),census:()=>({census,sourceSha256:sha,candidate:records}),tracker:async()=>tracker,devices:async()=>devices,checks:async()=>[...checks].map(([camera_device_id,port_status])=>({camera_device_id,port_status}))};
 const read=signal=>readProductCheckSource(io,signal||new AbortController().signal),classify=s=>buildTrackerIpReachability(s.census,s.tracker,s.endpoints);
 const check=async d=>{calls.push(d.id);checks.set(d.id,{80:{online:true,attempted:true},_connection:{ip:d.public_ip,revision:0,checkedAt:new Date().toISOString(),status:'online',reachable:true}});};
 const get=new AsyncFunction('CosProductTcpDisabledStage','cosProductSourceContext','context','legacyAll','readProductCheckSource','cosProductRequestStartedAt','request',patch.after+'\nreturn evaluated;');
 const reopen=()=>get({cancellableIo:()=>({request:fn=>fn(new AbortController().signal)}),currentMhelpProductConnectionCensus:io.census,buildTrackerIpReachability,createProtectedSourceReader:()=>{throw Error('Unrelated identity source was opened');}},()=>({platformRpc:io.receipt,tracker:io.tracker}),{headers:{}},path=>path.startsWith('camera_devices?')?io.devices():io.checks(),readProductCheckSource,Date.now(),{signal:new AbortController().signal});
 return {tracker,checks,calls,read,classify,check,reopen,sha};
}
test('persisted Verify evidence survives fresh Fleet GETs without browser state or unrelated identity sources',async()=>{
 const f=fixture(),verified=await verifyProductsNow({productIds:['1001']},f);
 assert.equal(verified.items[0].status,'online');assert.equal(f.calls.length,1);
 for(let i=0;i<2;i++){
  const receipt=await f.reopen(),result=readExactProductConnections(receipt,f.sha,['1001']);
  assert.equal(result.get('1001').status,'online');assert.equal(result.get('1001').checkedAt,verified.items[0].checkedAt);
  assert.equal(receipt.items.length,1);assert.equal(f.calls.length,1);
 }
 const saved=f.checks.get(41);saved[80]={online:false,attempted:true};saved._connection.status='offline';saved._connection.reachable=false;
 assert.equal((await f.reopen()).items[0].status,'offline');
 f.tracker.records[0].publicIp='9.9.9.9';assert.equal((await f.reopen()).items[0].status,'unknown');
});
test('deployment patch preserves authorization, optional adapters and every unrelated byte',()=>{
 const prefix="import {readProductCheckSource} from './productCheckSource.ts';\nprotectedOwnerItGate();",suffix='optionalAdapters();manualVerify();';
 const live={name:'cos-operations-pages',version:142,verify_jwt:false,files:[{name:'serve.ts',content:prefix+patch.before+suffix},{name:'deno.json',content:'{}'}]};
 const result=prepareFleetConnectionReloadDeployment(live);
 assert.equal(result.payload.files[0].content,prefix+patch.after+suffix);
 assert.deepEqual(result.payload.files[1],live.files[1]);assert.equal(result.payload.verify_jwt,false);
 for(const content of [prefix+suffix,prefix+patch.before+patch.before+suffix])assert.throws(()=>prepareFleetConnectionReloadDeployment({...live,files:[{name:'serve.ts',content}]}));
});

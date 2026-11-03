import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyProductsNow} from '../../supabase/functions/cos-operations-pages/productVerifyNow.ts';
import {buildTrackerIpReachability,TRACKER_CONNECTION_CENSUS_V2,TRACKER_IP_WORKBOOK} from '../src/exactProductConnection.ts';
function fixture(){
 const at=new Date().toISOString(),sha='a'.repeat(64),products=[['1001','FIELD'],['1002','FIELD'],['1003','SHOP']];
 const census={contract:'COS_MHELP_UPLOAD_INVENTORY_V1',countBasis:'mhelp_product_records_not_unique_physical_units',sourceSha256:sha,receivedAt:at,summary:{totalRecords:3,fieldRecords:2,shopRecords:1,unflaggedFieldRecords:2,unflaggedShopRecords:1,doNotUseRecords:0,missingRecords:0},records:products.map(([productId,placement])=>({productId,recordId:'mhelp_product:'+productId,unitNumber:'Helios '+productId,placement,uploadLifecycle:'UNFLAGGED',binding:{state:'unlinked',placementHeld:false,candidateUnitIds:[]}}))};
 const ips=['8.8.8.8','9.9.9.9',null],tracker={contract:TRACKER_CONNECTION_CENSUS_V2,workbookId:TRACKER_IP_WORKBOOK,expectedMhelpSourceSha256:sha,trackerSourceSha256:'b'.repeat(64),sourceExport:'ServiceItem_List_20261103120000.csv',verifiedAt:at,records:products.map(([productId,placement],i)=>({productId,recordId:'mhelp_product:'+productId,placement,publicIp:ips[i],reviewReasons:[],sourceRow:i+2}))};
 const devices=[0,1].map(i=>({id:i+41,unit_key:'HELIOS 00'+(i+1),public_ip:ips[i],expected_ports:[80,443],connection_revision:4,monitoring_enabled:true,activation_state:'active'}));
 const checks=new Map(),calls=[];let reads=0,change=false;
 const read=async()=>{reads++;return structuredClone({census,tracker,devices,endpoints:devices.map(d=>({deviceId:d.id,publicIp:d.public_ip,expectedPorts:d.expected_ports,connectionRevision:d.connection_revision,monitoringEnabled:d.monitoring_enabled,activationState:d.activation_state,portStatus:checks.get(d.id)||null}))});};
 const classify=s=>buildTrackerIpReachability(s.census,s.tracker,s.endpoints);
 const check=async d=>{calls.push(d.id);const online=d.id===41;checks.set(d.id,{80:{online,attempted:true},443:{online:false,attempted:true},_connection:{ip:d.public_ip,revision:4,checkedAt:new Date().toISOString(),status:online?'online':'offline',reachable:online,confirmedOutage:false,consecutiveFailures:1}});};
 return {read,classify,check,calls,checks,census,tracker,devices,get reads(){return reads;}};
}
test('manual check uses every saved port and confirms Online/Offline only from persisted readback',async()=>{
 const f=fixture(),r=await verifyProductsNow({productIds:['1001','1002']},f);
 assert.deepEqual(r.items.map(i=>i.status),['online','offline']);assert.deepEqual(f.calls.sort(),[41,42]);assert.equal(f.reads,2);assert.ok(r.items.every(i=>i.checkedAt));
});
test('Shop, source holds, missing tracker IP and cross-product shared IP never launch checks',async()=>{
 for(const mutate of [f=>{},f=>{f.tracker.records[0].reviewReasons=['identity_mismatch'];},f=>{f.tracker.records[0].publicIp=null;},f=>{f.tracker.records[2].publicIp='8.8.8.8';}]){
  const f=fixture();mutate(f);const id=f.tracker.records[0].publicIp==='8.8.8.8'&&!f.tracker.records[0].reviewReasons.length&&!f.tracker.records[2].publicIp?'1003':'1001';
  const r=await verifyProductsNow({productIds:[id]},f);assert.equal(r.items[0].status,'unknown');assert.equal(f.calls.length,0);
 }
});
test('source changes during checks, failed checks and partial saved observations remain Unknown',async()=>{
 for(const kind of ['changed','failed','partial']){
  const f=fixture(),check=f.check;f.check=async d=>{if(kind==='failed')throw Error('provider');await check(d);if(kind==='changed')f.tracker.records[0].publicIp='1.1.1.1';if(kind==='partial')delete f.checks.get(d.id)[443];};
  const r=await verifyProductsNow({productIds:['1001']},f);assert.equal(r.items[0].status,'unknown');
 }
});
test('browser addresses, duplicates and oversized selections are rejected before any source read',async()=>{
 for(const body of [{productIds:['1001'],publicIp:'1.1.1.1'},{productIds:['1001','1001']},{productIds:[]},{productIds:Array.from({length:17},(_,i)=>String(i+1))}]){
  const f=fixture();await assert.rejects(()=>verifyProductsNow(body,f));assert.equal(f.reads,0);assert.equal(f.calls.length,0);
 }
});
test('a missing enabled port configuration returns a correction instead of guessing ports',async()=>{
 const f=fixture();f.devices[0].expected_ports=[];const r=await verifyProductsNow({productIds:['1001']},f);assert.equal(r.items[0].status,'unknown');assert.match(r.items[0].reason,/configuration/);assert.equal(f.calls.length,0);
});
test('retained fresh observations cannot substitute for the newly requested check',async()=>{
 const f=fixture();await f.check(f.devices[0]);f.checks.get(41)._connection.checkedAt=new Date(Date.now()-5*60000).toISOString();f.calls.length=0;f.check=async()=>{};
 const r=await verifyProductsNow({productIds:['1001']},f);assert.equal(r.items[0].status,'unknown');
});
test('fresh saved checks can be revalidated without running redundant probes and retain their actual timestamps',async()=>{
 const f=fixture();await f.check(f.devices[0]);const at=f.checks.get(41)._connection.checkedAt;f.calls.length=0;
 const r=await verifyProductsNow({productIds:['1001']},{...f,reuseCurrent:true});assert.equal(r.items[0].status,'online');assert.equal(r.items[0].checkedAt,at);assert.equal(f.calls.length,0);assert.ok(r.connections);
});

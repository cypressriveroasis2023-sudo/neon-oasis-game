import test from 'node:test';
import assert from 'node:assert/strict';
import {
 buildExactProductConnections,completedSavedTcpCheck,readExactProductConnections,
 VERIFIED_TRACKER_IP_CONTRACT,TRACKER_IP_WORKBOOK,EXACT_PRODUCT_CONNECTION_CONTRACT
} from '../src/exactProductConnection.ts';

const now=Date.parse('2026-10-26T21:00:00Z');
const current=new Date(now-30_000).toISOString();
const sha='a'.repeat(64);
const accepted=()=>{
 const records=[
  {productId:'1001',placement:'FIELD',uploadLifecycle:'UNFLAGGED'},
  {productId:'1002',placement:'FIELD',uploadLifecycle:'UNFLAGGED'},
  {productId:'1003',placement:'FIELD',uploadLifecycle:'UNFLAGGED'},
  {productId:'1004',placement:'SHOP',uploadLifecycle:'UNFLAGGED'}
 ].map(row=>({...row,recordId:'mhelp_product:'+row.productId,binding:{state:'unlinked',placementHeld:false,candidateUnitIds:[]}}));
 return {contract:'COS_MHELP_UPLOAD_INVENTORY_V1',countBasis:'mhelp_product_records_not_unique_physical_units',sourceSha256:sha,receivedAt:current,
  summary:{totalRecords:4,fieldRecords:3,shopRecords:1,unflaggedFieldRecords:3,unflaggedShopRecords:1,doNotUseRecords:0,missingRecords:0},records};
};
const tracker=()=>({
 contract:VERIFIED_TRACKER_IP_CONTRACT,workbookId:TRACKER_IP_WORKBOOK,expectedMhelpSourceSha256:sha,verifiedAt:current,
 records:[
  {productId:'1001',recordId:'mhelp_product:1001',placement:'FIELD',publicIp:'8.8.8.8'},
  {productId:'1002',recordId:'mhelp_product:1002',placement:'FIELD',publicIp:'9.9.9.9'},
  {productId:'1003',recordId:'mhelp_product:1003',placement:'FIELD',publicIp:null},
  {productId:'1004',recordId:'mhelp_product:1004',placement:'SHOP',publicIp:null}
 ]
});
const endpoint=(deviceId,ip,online=true)=>({
 deviceId,publicIp:ip,connectionRevision:4,expectedPorts:[80,443],monitoringEnabled:true,
 portStatus:{
  80:{online,attempted:true},443:{online:false,attempted:true},
  _connection:{ip,revision:4,checkedAt:current,status:online?'online':'offline',reachable:online,confirmedOutage:false,consecutiveFailures:1}
 }
});
const run=(a=accepted(),t=tracker(),devices=[endpoint(41,'8.8.8.8'),endpoint(42,'9.9.9.9',false)],time=now)=>buildExactProductConnections(a,t,devices,time);

test('a verified exact Product-ID endpoint response is ONLINE without provider/channel association',()=>{
 const results=run();assert.equal(results.contract,EXACT_PRODUCT_CONNECTION_CONTRACT);
 assert.deepEqual(results.items.map(x=>x.status),['online','offline','unknown']);
 assert.equal(results.items[0].productId,'1001');assert.equal(results.items[0].resourceId,'41');
 assert.equal(results.items[0].basis,'tcp_service_port');assert.match(results.items[0].reason,/video is not verified/i);
 assert.doesNotMatch(JSON.stringify(results),/8\.8\.8\.8|9\.9\.9\.9/);
});
test('one complete valid no-response scan is OFFLINE regardless of outage/failure counter',()=>{
 const result=completedSavedTcpCheck(endpoint(42,'9.9.9.9',false),now);
 assert.equal(result.status,'offline');
 assert.equal(result.checkedAt,current);
});
test('a pending/partial/technically invalid check is UNKNOWN, never falsely OFFLINE',()=>{
 const invalid=[
  d=>{delete d.portStatus[443];},
  d=>{d.portStatus[443].attempted=false;},
  d=>{d.portStatus[443].errorCode='ETIMEDOUT';},
  d=>{d.portStatus._connection.status='unknown';},
  d=>{d.portStatus._connection.reachable=true;},
  d=>{d.portStatus._connection.error='transport';},
  d=>{d.portStatus._connection.checkedAt='2026-10-25T20:00:00Z';},
  d=>{d.portStatus._connection.checkedAt=new Date(now+1000).toISOString();},
  d=>{d.portStatus._connection.revision=3;},
  d=>{d.portStatus._connection.ip='8.8.8.8';},
  d=>{d.expectedPorts=[80,443,8080];},
  d=>{d.portStatus[22]={online:false,attempted:true};},
  d=>{d.monitoringEnabled=false;}
 ];
 for(const mutate of invalid){
  const d=endpoint(42,'9.9.9.9',false);mutate(d);
  const result=run(accepted(),tracker(),[endpoint(41,'8.8.8.8'),d]);
  assert.equal(result.items[1].status,'unknown',String(mutate));
 }
});
test('a provider name or suffix collision cannot influence independent product proof',()=>{
 const x=run();assert.equal(x.items[0].status,'online');
 // Only the same Product ID in a complete verified source census can claim it.
 const t=tracker();t.records[0].productId='1005';
 assert.equal(run(accepted(),t),null);
});
test('duplicate tracker IP claimed by Shop or another Field product is held',()=>{
 const t=tracker();t.records[3].publicIp='8.8.8.8';
 assert.equal(run(accepted(),t).items[0].status,'unknown');
 const t2=tracker();t2.records[1].publicIp='8.8.8.8';
 assert.deepEqual(run(accepted(),t2).items.slice(0,2).map(p=>p.status),['unknown','unknown']);
});
test('more than one legacy camera resource at the IP cannot claim one Product ID without a verified group',()=>{
 const d=endpoint(41,'8.8.8.8');const second=endpoint(44,'8.8.8.8');
 assert.equal(run(accepted(),tracker(),[d,second,endpoint(42,'9.9.9.9',false)]).items[0].status,'unknown');
});
test('missing tracker IP, missing saved endpoint, stale results and stale workbook are unknown or fail closed',()=>{
 assert.equal(run().items[2].status,'unknown');
 assert.equal(run(accepted(),tracker(),[]).items[0].status,'unknown');
 assert.equal(run(accepted(),tracker(),[endpoint(41,'8.8.8.8')],now+30*60*1000+1),null);
 const t=tracker();t.verifiedAt='2026-10-25T21:00:00Z';assert.equal(run(accepted(),t),null);
});
test('all 2027 product identities and placements must reconcile before using any check',()=>{
 const t=tracker();t.records.pop();assert.equal(run(accepted(),t),null);
 const d=tracker();d.records[0].productId=d.records[1].productId;assert.equal(run(accepted(),d),null);
 const p=tracker();p.records[0].placement='SHOP';assert.equal(run(accepted(),p),null);
 const r=tracker();r.records[0].recordId='mhelp_product:1002';assert.equal(run(accepted(),r),null);
 const w=tracker();w.workbookId='different';assert.equal(run(accepted(),w),null);
 const s=tracker();s.expectedMhelpSourceSha256='b'.repeat(64);assert.equal(run(accepted(),s),null);
});
test('inactive Product IDs and held placements cannot be colored by a successful saved IP check',()=>{
 const a=accepted();a.records[0].uploadLifecycle='DO_NOT_USE';a.summary.doNotUseRecords=1;a.summary.unflaggedFieldRecords=2;
 assert.equal(run(a).items[0].status,'unknown');
 const b=accepted();b.records[0].binding.state='held';assert.equal(run(b).items[0].status,'unknown');
 const c=accepted();c.records[0].binding.candidateUnitIds=['a'];assert.equal(run(c).items[0].status,'unknown');
});
test('browser-facing source receipt must cover every exact Product ID and retain the original check time',()=>{
 const value=run();const ids=['1001','1002','1003'];
 const map=readExactProductConnections(value,sha,ids,now);
 assert.deepEqual([...map.keys()],ids);
 assert.equal(map.get('1002').status,'offline');
 assert.equal(map.get('1002').checkedAt,current);
 assert.equal(readExactProductConnections(value,'b'.repeat(64),ids,now),null);
 assert.deepEqual([...readExactProductConnections(value,sha,['1001','1002'],now).keys()],['1001','1002']);
 assert.equal(readExactProductConnections(value,sha,['1001','1001','1003'],now),null);
 const changed=structuredClone(value);changed.items[0].status='offline';changed.items[0].checkedAt='stale';
 assert.equal(readExactProductConnections(changed,sha,ids,now),null);
 const future=structuredClone(value);future.trackerVerifiedAt=new Date(now+60000).toISOString();
 assert.equal(readExactProductConnections(future,sha,ids,now),null);
});

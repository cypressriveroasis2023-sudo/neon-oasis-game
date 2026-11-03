import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTrackerIpReachability,buildExactProductConnections,readExactProductConnections,TRACKER_CONNECTION_CENSUS_V2,TRACKER_IP_WORKBOOK} from '../src/exactProductConnection.ts';
const now=Date.parse('2026-11-03T00:30:00Z'),stamp=new Date(now-60000).toISOString(),hash='a'.repeat(64);
function fixture(){
 const records=[['11','FIELD'],['12','SHOP']].map(([productId,placement])=>({productId,recordId:'mhelp_product:'+productId,placement,uploadLifecycle:'UNFLAGGED',binding:{state:'unlinked',placementHeld:false,candidateUnitIds:[]}}));
 const accepted={contract:'COS_MHELP_UPLOAD_INVENTORY_V1',countBasis:'mhelp_product_records_not_unique_physical_units',source:'mhelpdesk_api',lastApiReadAt:stamp,sourceSha256:hash,receivedAt:stamp,
  summary:{totalRecords:2,fieldRecords:1,shopRecords:1,unflaggedFieldRecords:1,doNotUseRecords:0,missingRecords:0},records};
 const tracker={contract:TRACKER_CONNECTION_CENSUS_V2,workbookId:TRACKER_IP_WORKBOOK,expectedMhelpSourceSha256:hash,verifiedAt:stamp,trackerSourceSha256:'b'.repeat(64),sourceExport:'ServiceItem_List_20261023135432.csv',
  records:records.map((r,i)=>({productId:r.productId,recordId:r.recordId,placement:r.placement,publicIp:i===0?'8.8.8.8':null,sourceRow:i+2,reviewReasons:[]}))};
 return {accepted,tracker};
}
function endpoint(id=536,online=true,ip='8.8.8.8'){
 return {deviceId:id,publicIp:ip,expectedPorts:[80,443],connectionRevision:1,monitoringEnabled:true,activationState:'active',
  portStatus:{80:{online,attempted:true},443:{online:false,attempted:true,error:'timeout'},_connection:{ip,revision:1,checkedAt:stamp,status:online?'online':'offline',reachable:online}}};
}
const run=(f=fixture(),devices=[endpoint()])=>buildTrackerIpReachability(f.accepted,f.tracker,devices,now);
test('current exact Product-ID/tracker-IP reachability does not require registered equipment or resource membership',()=>{
 const f=fixture(),before=structuredClone(f),d=endpoint(),result=run(f,[d]);
 assert.equal(result.items[0].status,'online');assert.equal(result.items[0].resourceId,'536');
 assert.match(result.items[0].reason,/current tracker IP/);assert.match(result.items[0].reason,/Equipment identity, video and recording are not verified/);
 assert.equal(result.items.length,1,'Shop stays outside Field counts');assert.deepEqual(f,before);
 assert.equal(buildExactProductConnections(f.accepted,f.tracker,[d],now).items[0].status,'unknown','strict physical attribution stays strict');
 assert.equal(readExactProductConnections(result,hash,['11'],now).get('11').status,'online');
 assert.doesNotMatch(JSON.stringify(result),/8\.8\.8\.8|9\.9\.9\.9/);
});
test('a complete valid no-response check is Offline without a native UUID',()=>{
 assert.equal(run(fixture(),[endpoint(536,false)]).items[0].status,'offline');
});
test('multiple monitored endpoint records at one uniquely owned tracker IP cover the complete port profiles, not duplicate units',()=>{
 const a=endpoint(536,false),b=endpoint(537,true);b.portStatus._connection.checkedAt=new Date(now-30000).toISOString();
 let result=run(fixture(),[a,b]);assert.equal(result.items.length,1);assert.equal(result.items[0].status,'online');
 assert.equal(result.items[0].resourceId,'537');assert.equal(result.items[0].checkedAt,stamp,'oldest covered observation time is preserved');
 result=run(fixture(),[a,endpoint(537,false)]);assert.equal(result.items[0].status,'offline');
 delete b.portStatus[443];assert.equal(run(fixture(),[a,b]).items[0].status,'unknown','partial second profile is not a completed whole check');
});
test('disabled old endpoint configuration does not veto an enabled check, and is never itself usable proof',()=>{
 const old=endpoint(537);old.monitoringEnabled=false;
 assert.equal(run(fixture(),[endpoint(),old]).items[0].status,'online');
 assert.equal(run(fixture(),[old]).items[0].status,'unknown');
 const inactive=endpoint();inactive.activationState='decommissioned';assert.equal(run(fixture(),[inactive]).items[0].status,'unknown');
});
test('source, lifecycle, Shop/retired IP ownership and explicit holds remain enforced',()=>{
 for(const mutate of [
  f=>{f.tracker.records[1].publicIp='8.8.8.8';},
  f=>{f.tracker.records[0].reviewReasons=['tracker_restriction'];},
  f=>{f.tracker.records[0].reviewReasons=['customer_mismatch'];},
  f=>{f.accepted.records[0].binding.state='held';},
  f=>{f.accepted.records[0].binding.candidateUnitIds=['other'];},
  f=>{f.accepted.records[0].binding.placementHeld=true;},
  f=>{f.tracker.records[0].publicIp=null;},
  f=>{f.accepted.records[0].uploadLifecycle='DO_NOT_USE';f.accepted.summary.unflaggedFieldRecords=0;f.accepted.summary.doNotUseRecords=1;}
 ]){const f=fixture();mutate(f);assert.equal(run(f)?.items[0].status,'unknown',String(mutate));}
 for(const mutate of [
  f=>{f.tracker.expectedMhelpSourceSha256='c'.repeat(64);},
  f=>{f.tracker.records.pop();},
  f=>{f.tracker.records[1].productId='11';},
  f=>{f.tracker.contract='COS_VERIFIED_2027_PRODUCT_IPS_V1';},
  f=>{f.accepted.lastApiReadAt=new Date(now-46*60000).toISOString();},
  f=>{f.tracker.verifiedAt=new Date(now-31*60000).toISOString();}
 ]){const f=fixture();mutate(f);assert.equal(run(f),null,String(mutate));}
});
test('stale, partial, technical-error, wrong-target/revision checks remain Unknown',()=>{
 for(const mutate of [
  d=>{d.portStatus._connection.checkedAt=new Date(now-20*60000-1).toISOString();},
  d=>{d.portStatus._connection.checkedAt=new Date(now+1000).toISOString();},
  d=>{d.portStatus._connection.ip='9.9.9.9';},
  d=>{d.portStatus._connection.revision=2;},
  d=>{delete d.portStatus[443];},
  d=>{d.portStatus[443].attempted=false;},
  d=>{d.portStatus[443].error='No route to host (os error 113)';},
  d=>{d.portStatus[443].errorCode='transport';},
  d=>{d.portStatus._connection.error='transport';},
  d=>{d.publicIp='127.0.0.1';}
 ]){const d=endpoint();mutate(d);assert.equal(run(fixture(),[d])?.items[0].status,'unknown',String(mutate));}
 assert.equal(run(fixture(),[endpoint(),endpoint()]),null,'duplicate resource IDs reject the source');
});

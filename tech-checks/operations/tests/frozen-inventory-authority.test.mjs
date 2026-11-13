// Frozen-inventory rule only. A census named by an Owner-accepted freeze stays
// usable past the normal staleness window while automatic inventory changes are
// paused; its real mHelp read time is never moved. Nothing here reads or writes
// production, and the server side that would supply the freeze is not built yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readMhelpInventoryAuthority,INVENTORY_FREEZE_CONTRACT} from '../src/mhelpInventoryAuthority.ts';

const now=Date.parse('2026-11-12T12:00:00Z'),SHA='a'.repeat(64);
const row=(id,placement,life='UNFLAGGED')=>({recordId:'mhelp_product:'+id,productId:id,placement,uploadLifecycle:life});
const census=(extra={})=>{const records=[row('100','FIELD'),row('101','SHOP'),row('102','FIELD','DO_NOT_USE')];return {
 contract:'COS_MHELP_UPLOAD_INVENTORY_V1',countBasis:'mhelp_product_records_not_unique_physical_units',source:'mhelpdesk_api',
 sourceSha256:SHA,receivedAt:'2026-11-11T23:20:00Z',lastApiReadAt:'2026-11-11T23:20:00Z',records,
 summary:{totalRecords:3,fieldRecords:2,shopRecords:1,unflaggedFieldRecords:1,doNotUseRecords:1,missingRecords:0},...extra};};
const freeze=(extra={})=>({contract:INVENTORY_FREEZE_CONTRACT,sourceSha256:SHA,acceptedAt:'2026-11-11T23:40:00Z',acceptedBy:'James Martin',...extra});

test('without a freeze, a live census older than 45 minutes is still declined as stale',()=>{
 const a=readMhelpInventoryAuthority(census(),now);
 assert.equal(a.stale,true);assert.equal('frozen' in a,false);
});
test('an accepted freeze of this exact census keeps it usable and keeps its real read time',()=>{
 const a=readMhelpInventoryAuthority(census({frozen:freeze()}),now);
 assert.equal(a.stale,false);assert.deepEqual(a.frozen,{acceptedAt:'2026-11-11T23:40:00Z',acceptedBy:'James Martin'});
 assert.equal(a.receivedAt,'2026-11-11T23:20:00Z');assert.equal(a.sourceSha256,SHA);
 assert.deepEqual([a.total,a.field,a.shop,a.fieldActive,a.inactive],[3,2,1,1,1]);
 // Weeks later it is still the same census with the same date — never refreshed.
 const later=readMhelpInventoryAuthority(census({frozen:freeze()}),now+30*24*60*60*1000);
 assert.equal(later.stale,false);assert.equal(later.receivedAt,'2026-11-11T23:20:00Z');
});
test('a freeze that does not match is ignored, so the normal rule declines the census',()=>{
 for(const bad of [freeze({sourceSha256:'b'.repeat(64)}),freeze({contract:'COS_INVENTORY_FREEZE_V0'}),freeze({acceptedAt:'not a date'}),
  freeze({acceptedAt:'2099-01-01T00:00:00Z'}),freeze({acceptedAt:'2026-11-11T23:00:00Z'}),freeze({acceptedBy:' '}),freeze({acceptedBy:undefined}),
  freeze({acceptedBy:'x'.repeat(121)}),true,'frozen',[freeze()],null]){
  const a=readMhelpInventoryAuthority(census({frozen:bad}),now);
  assert.equal(a.stale,true,JSON.stringify(bad));assert.equal('frozen' in a,false);
 }
});
test('a freeze never rescues a census that fails its own checks',()=>{
 const broken=census({frozen:freeze()});broken.summary.fieldRecords=3;
 assert.equal(readMhelpInventoryAuthority(broken,now),null);
 const dup=census({frozen:freeze()});dup.records[1].productId='100';dup.records[1].recordId='mhelp_product:100';
 assert.equal(readMhelpInventoryAuthority(dup,now),null);
 assert.equal(readMhelpInventoryAuthority(census({frozen:freeze(),lastApiReadAt:'2099-01-01T00:00:00Z'}),now),null);
});
test('a fresh census with a freeze reports both: current and frozen',()=>{
 const a=readMhelpInventoryAuthority(census({frozen:freeze()}),Date.parse('2026-11-11T23:45:00Z'));
 assert.equal(a.stale,false);assert.equal(a.frozen.acceptedAt,'2026-11-11T23:40:00Z');
});

// The dependency Vision found: with the mHelp intake paused, the Product-ID
// connection source declined the census as stale and no board could be saved.
// Fixture shapes follow tests/exact-product-connection.test.mjs.
test('a frozen census lets the connection source build again, and only the inventory-age rule is relaxed',async()=>{
 const {buildExactProductConnections,VERIFIED_TRACKER_IP_CONTRACT,TRACKER_IP_WORKBOOK}=await import('../src/exactProductConnection.ts');
 const t=Date.parse('2026-10-26T21:00:00Z'),sha='a'.repeat(64),cur=new Date(t-30_000).toISOString();
 const records=[['1001','FIELD'],['1002','FIELD'],['1003','FIELD'],['1004','SHOP']]
  .map(([productId,placement])=>({productId,placement,uploadLifecycle:'UNFLAGGED',recordId:'mhelp_product:'+productId,binding:{state:'unlinked',placementHeld:false,candidateUnitIds:[]}}));
 const census=(readAt,frozen)=>({contract:'COS_MHELP_UPLOAD_INVENTORY_V1',countBasis:'mhelp_product_records_not_unique_physical_units',source:'mhelpdesk_api',sourceSha256:sha,
  receivedAt:readAt,lastApiReadAt:readAt,summary:{totalRecords:4,fieldRecords:3,shopRecords:1,unflaggedFieldRecords:3,unflaggedShopRecords:1,doNotUseRecords:0,missingRecords:0},records,...(frozen?{frozen}:{})});
 const tracker=()=>({contract:VERIFIED_TRACKER_IP_CONTRACT,workbookId:TRACKER_IP_WORKBOOK,expectedMhelpSourceSha256:sha,verifiedAt:cur,records:[
  {productId:'1001',recordId:'mhelp_product:1001',placement:'FIELD',publicIp:'8.8.8.8'},{productId:'1002',recordId:'mhelp_product:1002',placement:'FIELD',publicIp:'9.9.9.9'},
  {productId:'1003',recordId:'mhelp_product:1003',placement:'FIELD',publicIp:null},{productId:'1004',recordId:'mhelp_product:1004',placement:'SHOP',publicIp:null}]});
 const endpoint=(deviceId,ip,online=true)=>({deviceId,publicIp:ip,connectionRevision:4,expectedPorts:[80,443],monitoringEnabled:true,
  portStatus:{80:{online,attempted:true},443:{online:false,attempted:true},_connection:{ip,revision:4,checkedAt:cur,status:online?'online':'offline',reachable:online,confirmedOutage:false,consecutiveFailures:1}}});
 const run=(c,tr=tracker())=>buildExactProductConnections(c,tr,[endpoint(41,'8.8.8.8'),endpoint(42,'9.9.9.9',false)],t,new Map([['1001',['41']],['1002',['42']]]));
 const old=new Date(t-3*24*60*60*1000).toISOString();
 const fresh=run(census(cur));assert.notEqual(fresh,null,'fixture sanity: a fresh census builds');
 assert.equal(run(census(old)),null,'stale and not frozen: declined as before');
 const frozen={contract:INVENTORY_FREEZE_CONTRACT,sourceSha256:sha,acceptedAt:new Date(t-2*24*60*60*1000).toISOString(),acceptedBy:'James Martin'};
 const built=run(census(old,frozen));assert.notEqual(built,null,'frozen: builds');
 // Health results are whatever the checks say now — identical to the fresh-census build.
 assert.deepEqual(built.items,fresh.items);
 assert.equal(run(census(old,{...frozen,sourceSha256:'b'.repeat(64)})),null,'freeze of another census: declined');
 // Every other source rule still applies to a frozen census.
 // The IP list is a COS-kept copy under a freeze: its age is reported, not enforced...
 const agedTracker=tracker();agedTracker.verifiedAt=new Date(t-2*24*60*60*1000).toISOString();
 assert.equal(run(census(cur),agedTracker),null,'without a freeze, an old IP list is still declined');
 const kept=run(census(old,frozen),agedTracker);assert.notEqual(kept,null,'frozen: an old IP list tied to the same census is accepted');
 assert.equal(kept.trackerVerifiedAt,agedTracker.verifiedAt,'its real age is reported, never refreshed');
 assert.equal(kept.inventoryFrozenAt,frozen.acceptedAt);assert.equal('inventoryFrozenAt' in fresh,false);
 assert.deepEqual(kept.items,fresh.items,'health results are unchanged by the freeze');
 // ...but a future-dated list, or one for another census or with different A#s, is still declined.
 const future=tracker();future.verifiedAt=new Date(t+60*60*1000).toISOString();
 assert.equal(run(census(old,frozen),future),null);
 const fewer=tracker();fewer.records=fewer.records.slice(1);
 assert.equal(run(census(old,frozen),fewer),null,'an IP list missing an A# is still declined');
 // The screen-side reader accepts the frozen envelope and still rejects an unfrozen stale one.
 const {readExactProductConnections}=await import('../src/exactProductConnection.ts');
 const fieldIds=['1001','1002','1003'];
 assert.notEqual(readExactProductConnections(kept,sha,fieldIds,t),null);
 const {inventoryFrozenAt,...unfrozen}=kept;assert.equal(readExactProductConnections(unfrozen,sha,fieldIds,t),null);
 assert.equal(readExactProductConnections({...kept,inventoryFrozenAt:new Date(t+60000).toISOString()},sha,fieldIds,t),null);
 const otherTracker=tracker();otherTracker.expectedMhelpSourceSha256='c'.repeat(64);
 assert.equal(run(census(old,frozen),otherTracker),null,'a tracker read for a different census is still declined');
});

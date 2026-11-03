import test from 'node:test';import assert from 'node:assert/strict';
import {fleetDashboardRows} from '../src/fleetDashboardModel.ts';
import {mhelpFieldHealth} from '../src/mhelpFieldHealth.ts';
import {fieldProductFixture,fieldProductConnectionFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
test('every Field Product ID appears once in a complete partition; Shop never enters it',()=>{
 const f=fieldProductFixture(),before=structuredClone(f),view=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now);
 assert.equal(view.total,7);assert.deepEqual(view.counts,{online:1,offline:1,unverified:1,support:1,unlinked:1,review:1,inactive:1});
 assert.equal(new Set(view.items.map(item=>item.productId)).size,7);assert(!view.items.some(item=>item.productId==='1008'));assert.deepEqual(f,before);
});
test('possible candidate matches cannot inherit healthy native evidence',()=>{
 const f=fieldProductFixture();f.upload.records[0].binding.placementHeld=true;
 let view=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now);assert.equal(view.counts.online,0);assert.equal(view.counts.review,2);assert.equal(view.items[0].unitId,null);
 f.upload.records[0].binding.placementHeld=false;f.upload.records[0].binding.candidateUnitIds=[f.units[1].id];view=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now);assert.equal(view.counts.online,0);
});
test('inactive source lifecycle stays separate even when a linked service responds',()=>{
 const f=fieldProductFixture();f.upload.records[0].uploadLifecycle='MISSING';f.upload.summary.unflaggedFieldRecords--;f.upload.summary.missingRecords++;
 const view=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now);assert.equal(view.counts.online,0);assert.equal(view.counts.inactive,2);
});
test('missing, duplicate or inconsistent unit associations never assign an online product',()=>{
 for(const change of [f=>f.rows.shift(),f=>f.rows.push({...f.rows[0]}),f=>f.upload.records[0].binding.unitIds=[],f=>f.rows[0].placement='shop']){
  const f=fieldProductFixture();change(f);const view=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now);assert.equal(view.counts.online,0);assert.equal(view.counts.review,2);
 }
});
test('malformed, incomplete or duplicate-source receipts cannot produce a certified count',()=>{
 const f=fieldProductFixture();assert.equal(mhelpFieldHealth({...f.upload,records:[...f.upload.records,f.upload.records[0]]},f.roster,f.rows,f.now),null);
 assert.equal(mhelpFieldHealth(f.upload,{...f.roster,summary:{...f.roster.summary,field:99}},f.rows,f.now),null);assert.equal(mhelpFieldHealth(f.upload,null,f.rows,f.now),null);
});
test('service reachability retains its basis and never claims verified video',()=>{
 const f=fieldProductFixture();f.rows[0].camera={...f.rows[0].camera,basis:'connection',observation:undefined,reason:'A service port responded; video is unverified.'};
 const item=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now).items[0];assert.equal(item.state,'online');assert.match(item.reason,/IP \/ PORT ONLINE/);assert.match(item.reason,/video is unverified/);
});
test('all 287 Field Product IDs reconcile without importing the 714 Shop records into health',()=>{
 const f=fieldProductFixture();
 for(let i=0;i<993;i++){
  const field=i<280,id=String(2001+i),base=f.upload.records[4],item=f.roster.items[4];
  f.upload.records.push({...base,recordId:'mhelp_product:'+id,productId:id,unitNumber:'Unlinked '+id,placement:field?'FIELD':'SHOP'});
  f.roster.items.push({...item,id:'mhelp_product:'+id,unitNumber:'Unlinked '+id,productIds:[id],sourceRecordIds:['mhelp_product:'+id],placement:field?'field':'shop'});
 }
 Object.assign(f.upload.summary,{totalRecords:1001,fieldRecords:287,shopRecords:714,unflaggedFieldRecords:286,unflaggedShopRecords:714});
 Object.assign(f.roster.summary,{totalRecords:1001,activeRecords:1000,field:285,shop:714,sourceOnlyRecords:997});
 const view=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now);assert.equal(view.total,287);assert.equal(view.items.length,287);assert.equal(view.counts.unlinked,281);assert.equal(Object.values(view.counts).reduce((a,b)=>a+b),287);
});

test('obsolete IP-only contract and failed source keep inventory and support, and certify only reviewed provider health',()=>{
 const f=fieldProductFixture();
 for(const receipt of [null,{...f.connections,contract:'COS_EXACT_PRODUCT_CONNECTIONS_V1'}]){
 const view=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now,receipt);
 assert.equal(view.total,7);assert.equal(view.items.filter(i=>i.state==='support').length,1);
 // A rejected or obsolete connection source cannot certify connectivity itself.
 // It does not erase the provider's own reported health on a reviewed
 // association, which is shown labelled, with the source failure still raised.
 assert.equal(view.items[0].state,'online');
 assert.equal(view.items[1].state,'offline');
 assert.match(view.items[0].reason,/Provider-reported, not direct-connection verified/);
 assert.equal(view.items[0].evidence.followUp.category,'source_unavailable');
 // Everything without a reviewed association stays Unknown.
 assert.equal(view.items[2].state,'unverified');
 assert.equal(view.items[4].state,'unverified');
 assert.equal(Object.values(view.counts).reduce((a,b)=>a+b),7);
 }
});

// Synthetic provider evidence only; no equipment/provider requests.
for(const [name,change] of [
 ['unreviewed',f=>{f.rows[0].camera.association=null;}],
 ['mismatched native membership',f=>{f.upload.records[0].binding.unitIds=[f.units[1].id];}],
 ['stale provider observation',f=>{f.health.rows[0].evidence.observedAt=new Date(f.now-21*60000).toISOString();f.rows=fleetDashboardRows(f.units,f.health,[],null,f.now);}],
 ['ambiguous native row',f=>{f.rows.push(structuredClone(f.rows[0]));}],
])test('pending or Unknown TCP cannot admit '+name+' provider evidence',()=>{
 for(const source of ['pending','unknown']){
  const f=fieldProductFixture();change(f);
  const receipt=source==='pending'?null:fieldProductConnectionFixture(f.upload,f.fresh,{});
  const item=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now,receipt).items.find(p=>p.productId==='1001');
  assert.ok(['review','unverified'].includes(item.state),item.state);
  assert.doesNotMatch(item.reason,/Provider-reported, not direct-connection verified/);
 }
});
test('reviewed provider fallback is labelled and completed exact TCP takes precedence in both directions',()=>{
 const f=fieldProductFixture(),fallback=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now,null);
 assert.deepEqual(fallback.items.slice(0,2).map(p=>p.state),['online','offline']);
 for(const p of fallback.items.slice(0,2))assert.match(p.reason,/^Provider-reported, not direct-connection verified/);
 const receipt=fieldProductConnectionFixture(f.upload,f.fresh,{'1001':'offline','1002':'online'});
 const exact=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now,receipt);
 assert.deepEqual(exact.items.slice(0,2).map(p=>[p.productId,p.state]),[['1001','offline'],['1002','online']]);
 for(const p of exact.items.slice(0,2)){
  assert.doesNotMatch(p.reason,/Provider-reported/);assert.equal(p.evidence.association,'exact_product_id_tracker_endpoint');
  assert.equal(p.evidence.observedAt,f.fresh);assert.equal(p.evidence.video,'not_verified');
 }
 // Rejected source and expired proof do not masquerade as current direct TCP.
 for(const invalid of [{...receipt,sourceSha256:'f'.repeat(64)},fieldProductConnectionFixture(f.upload,new Date(f.now-21*60000).toISOString(),{'1001':'offline','1002':'online'})]){
  const view=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now,invalid);
  assert.deepEqual(view.items.slice(0,2).map(p=>p.state),['online','offline']);
  for(const p of view.items.slice(0,2))assert.match(p.reason,/^Provider-reported, not direct-connection verified/);
 }
});

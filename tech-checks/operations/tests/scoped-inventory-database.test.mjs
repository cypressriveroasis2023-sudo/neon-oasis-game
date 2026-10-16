import test from 'node:test';import assert from 'node:assert/strict';import {fixture,actor,org,hash,requestId,tracker} from './fixtures/scoped-inventory-fixture.mjs';
import {prepareScopedInventory,scopedExecutionRequest,scopedStatements} from '../scripts/prepare-scoped-inventory.mjs';
test('dry run, atomic apply, exact replay and revision-guarded rollback retain evidence and untouched state',async()=>{
 const f=await fixture();try{
 const before=await f.preserved(),initial=await f.snapshot();assert.equal((await f.call()).applied,false);assert.deepEqual(await f.snapshot(),initial);
 assert.equal((await f.call({apply:true})).revision,1);assert.equal((await f.call({apply:true})).idempotent,true);
 const read=await f.snapshot();assert.equal(read.receivedAt,initial.receivedAt);assert.equal(read.sourceSha256,initial.sourceSha256);assert.equal(read.payloadSha256,initial.payloadSha256);assert.equal(read.records[0].placement,'FIELD');assert.equal(read.records[0].scopedAuthority.receivedAt,f.evidence.receivedAt);assert.deepEqual(read.records[0].sourceAddress,{});assert.deepEqual(read.records.slice(1),initial.records.slice(1));assert.deepEqual(await f.preserved(),before);
 await assert.rejects(()=>f.db.query('select cos_mhelp_placement_private.rollback_scoped_inventory($1,$2,$3,0,$4,$5)',[actor,org,hash,requestId,hash]),/head changed/);
 await f.db.query('select cos_mhelp_placement_private.rollback_scoped_inventory($1,$2,$3,1,$4,$5)',[actor,org,hash,requestId,hash]);
 const rolled=await f.snapshot();assert.deepEqual(rolled.records,initial.records);assert.equal(rolled.scopedRevision,2);assert.deepEqual(await f.preserved(),before);assert.equal((await f.db.query('select count(*) n from cos_mhelp_placement_private.scoped_batches')).rows[0].n,1);
 await assert.rejects(()=>f.call({apply:true}),/head changed/);await assert.rejects(()=>f.db.exec('delete from cos_mhelp_placement_private.scoped_batches'),/append-only/);await assert.rejects(()=>f.db.exec('truncate cos_mhelp_placement_private.scoped_audit'),/append-only/);
 }finally{await f.db.close();}
});
test('source replacement retains one inventory record and never inherits endpoint identity',async()=>{
 const f=await fixture();try{
 const before=await f.preserved();const op={...f.op,mode:'replace_source_hold',after:{...f.op.after,productId:'104',customerId:'11',customer:'Company',placement:'SHOP'}};
 await f.call({operations:[op],apply:true});const read=await f.snapshot(),r=read.records[0];assert.equal(read.records.length,3);assert.equal(r.productId,'104');assert.equal(r.binding,null);assert.equal(r.supersedesProductId,'101');assert.equal(r.placementHeld,true);assert.deepEqual(r.possibleAliasUnitIds,[tracker]);assert.deepEqual(await f.preserved(),before);assert.equal(read.trackerRecords[0].matchedProductId,'104');assert.equal(read.trackerRecords[0].binding.state,'held');assert.equal(read.trackerRecords[0].binding.guardCurrent,false);
 }finally{await f.db.close();}
});
test('actor, tenant, base, record revision, family, lifecycle and ProductId collisions fail without writes',async()=>{
 const f=await fixture();try{
 const initial=await f.snapshot();
 for(const change of [{actor:tracker},{org:tracker},{base:'c'.repeat(64)},{revision:1},{evidence:{...f.evidence,receivedAt:'2099-01-01T00:00:00Z'}},
 {operations:[{...f.op,expectedRecord:{...f.op.expectedRecord,customer:'Stale'}}]},
 {operations:[f.op,f.op]},
 {operations:[{...f.op,after:{...f.op.after,lifecycle:'UNFLAGGED',unitNumber:'Renamed'}}]},
 {operations:[{...f.op,expectedRecord:f.records[1],after:{...f.target(f.records[1]),lifecycle:'UNFLAGGED'}}]},
 {operations:[{...f.op,expectedRecord:f.records[2],after:f.target(f.records[2])}]},
 {operations:[{...f.op,mode:'replace_source_hold',after:{...f.op.after,productId:'102'}}]},
 {operations:[{...f.op,after:{...f.op.after,public_ip:'203.0.113.5'}}]},
 {operations:[{...f.op,after:{...f.op.after,placement:'SHOP'}}]}])await assert.rejects(()=>f.call({...change,apply:true}));
 assert.deepEqual(await f.snapshot(),initial);assert.equal((await f.db.query('select count(*) n from cos_mhelp_placement_private.scoped_batches')).rows[0].n,0);
 for(const role of ['anon','authenticated','service_role']){await f.db.exec('set role '+role);await assert.rejects(()=>f.call({apply:true}));await assert.rejects(()=>f.db.query('select * from cos_mhelp_placement_private.scoped_batches'));await f.db.exec('reset role');}
 }finally{await f.db.close();}
});
test('binding changes reject admission and subsequent drift holds reads; request reuse cannot change payload',async()=>{
 const f=await fixture();try{
 await f.call({apply:true});await assert.rejects(()=>f.call({apply:true,operations:[{...f.op,after:{...f.op.after,customer:'Different'}}]}),/reused/);
 await f.db.exec("update app_private.vision_tracker_locations set customer='Newer Owner edit'");assert.equal((await f.snapshot()).records[0].binding.guardCurrent,false);
 const old=(await f.db.query('select records from cos_mhelp_placement_private.scoped_batches')).rows[0].records[0];
 await assert.rejects(()=>f.call({revision:1,requestId:'44444444-4444-4444-8444-444444444444',operations:[{...f.op,expectedRecord:old}]}),/graph changed/);
 }finally{await f.db.close();}
});
test('generated private SQL round-trips quoted customer text, dry runs and rolls back without external execution',async()=>{
 const f=await fixture();try{
 const source=[{...f.op.after,customer:"Builder's synthetic yard"},f.target(f.records[1])];
 const plan=prepareScopedInventory({activeSha256:hash,before:f.records,source,sourceEvidence:{libraryFileId:f.evidence.libraryFileId,receivedAt:f.evidence.receivedAt}});
 const request=scopedExecutionRequest({plan,before:f.records,source,actorId:actor,organizationId:org,revision:0,requestId,evidence:f.evidence}),sql=scopedStatements(request),before=await f.snapshot();
 await f.db.exec(sql['dry-run.sql']);assert.deepEqual(await f.snapshot(),before);await f.db.exec(sql['apply.sql']);assert.equal((await f.snapshot()).records[0].customer,"Builder's synthetic yard");await f.db.exec(sql['rollback.sql']);assert.deepEqual((await f.snapshot()).records,before.records);
 assert.throws(()=>scopedExecutionRequest({plan,before:f.records,source,actorId:actor,organizationId:org,revision:0,requestId,evidence:{...f.evidence,kind:'original_csv'}}),/Derived/);
 }finally{await f.db.close();}
});

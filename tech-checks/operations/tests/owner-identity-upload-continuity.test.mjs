import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,native,tracker,actor,it,org,requestId,hash} from './fixtures/owner-identity-upload-fixture.mjs';

test('existing Owner confirmation invalidates the otherwise-current reviewed inventory binding',async()=>{
 const f=await fixture({install:false});try{
  assert.equal((await f.snapshot()).records[0].binding.guardCurrent,true);
  await f.confirm();
  assert.equal((await f.snapshot()).records[0].binding.guardCurrent,false);
 }finally{await f.db.close();}
});

test('atomic Owner identity confirmation preserves all 1001 source records, 287/714 counts and protected data',async()=>{
 const f=await fixture({recordCount:1001});try{
  const before=await f.preserved(),snapshot=await f.snapshot();
  const receipt=await f.confirm();assert.equal(receipt.replayed,false);
  const after=await f.snapshot();assert.deepEqual(after,snapshot);
  assert.equal(after.records.length,1001);
  assert.equal(after.records.filter(r=>r.placement==='FIELD').length,287);
  assert.equal(after.records.filter(r=>r.placement==='SHOP').length,714);
  assert.deepEqual(await f.preserved(),before);
  assert.equal((await f.state()).claims[0].provenance,'owner_confirmation');
  assert.equal((await f.db.query('select count(*) n from cos_mhelp_placement_private.identity_binding_receipts')).rows[0].n,1);
  const second=await f.confirm();assert.equal(second.replayed,true);
  assert.deepEqual(await f.snapshot(),snapshot);
  assert.equal((await f.db.query('select count(*) n from cos_mhelp_placement_private.identity_binding_receipts')).rows[0].n,1);
 }finally{await f.db.close();}
});

for(const [name,change] of [
 ['verified GPS',`update equipment_units set gps_latitude=31 where id='${native}'`],
 ['tracker placement',`update app_private.vision_tracker_locations set placement='SHOP' where id='${tracker}'`],
 ['location history',`insert into equipment_unit_location_history values('${native}')`],
 ['geocode sources',`insert into app_private.cos_geocode_sources(tracker_id,native_unit_id,active) values('${tracker}','${native}',true)`],
 ['archive commitments',`insert into app_private.cos_archived_representations(archived_native_id,canonical_native_id) values('${native}','${native}')`],
])test(`later ${name} changes still hold the binding; retry never re-baselines evidence`,async()=>{
 const f=await fixture();try{
  await f.confirm();await f.db.exec(change);
  assert.equal((await f.snapshot()).records[0].binding.guardCurrent,false);
  await f.confirm();assert.equal((await f.snapshot()).records[0].binding.guardCurrent,false);
 }finally{await f.db.close();}
});

test('stale graph, protected lifecycle and existing source holds deny the claim without writes',async()=>{
 for(const change of [
  `update equipment_units set gps_longitude=-96 where id='${native}'`,
  `update cos_mhelp_placement_private.upload_batches set records=jsonb_set(records,'{0,lifecycle}','"DO_NOT_USE"')`,
  `update cos_mhelp_placement_private.upload_batches set records=jsonb_set(records,'{0,placementHeld}','true')`,
  `update cos_mhelp_placement_private.upload_batches set records=jsonb_set(records,'{0,holdReason}','"existing identity hold"')`,
 ]){const f=await fixture();try{
   await f.db.exec(change);const before=await f.preserved();
   await assert.rejects(()=>f.confirm(),/inventory binding|graph changed/i);
   assert.deepEqual(await f.preserved(),before);assert.equal((await f.state()).claims.length,0);
   assert.equal((await f.db.query('select count(*) n from cos_mhelp_placement_private.identity_binding_receipts')).rows[0].n,0);
  }finally{await f.db.close();}}
});

test('protected graph drift during admission rolls back both the claim and receipt',async()=>{
 const f=await fixture();try{
  const before=await f.preserved();
  await f.db.exec(`create function app_private.synthetic_identity_race() returns trigger language plpgsql as $$begin update app_private.vision_tracker_locations set customer='Concurrent correction' where id='${tracker}';return new;end$$;
   create trigger synthetic_identity_race after insert on app_private.cos_owner_identity_claims for each row execute function app_private.synthetic_identity_race();`);
  await assert.rejects(()=>f.confirm(),/protected evidence changed/);
  assert.deepEqual(await f.preserved(),before);assert.equal((await f.state()).claims.length,0);
  assert.equal((await f.db.query('select count(*) n from cos_mhelp_placement_private.identity_binding_receipts')).rows[0].n,0);
 }finally{await f.db.close();}
});

test('revocation and native identity change-restore cannot revive the preserved binding',async()=>{
 const f=await fixture();try{
  const c=await f.confirm();
  await f.db.query('select public.cos_owner_identity_revoke($1,$2,$3,$4,$5,$6)',[actor,org,c.claimId,'1','66666666-6666-4666-8666-666666666666','Synthetic revocation']);
  assert.equal((await f.snapshot()).records[0].binding.guardCurrent,false);
 }finally{await f.db.close();}
 const g=await fixture();try{
  await g.confirm();await g.db.exec(`update equipment_units set unit_number='Changed identity' where id='${native}';update equipment_units set unit_number='Solar Spotter 008HDC4' where id='${native}';`);
  assert.equal((await g.snapshot()).records[0].binding.guardCurrent,false);
 }finally{await g.db.close();}
});

test('a changed source row or different complete file cannot inherit a prior receipt',async()=>{
 const f=await fixture();try{
  await f.confirm();await f.db.exec(`update cos_mhelp_placement_private.upload_batches set records=jsonb_set(records,'{0,customer}','"New source customer"')`);
  assert.equal((await f.snapshot()).records[0].binding.guardCurrent,false);
 }finally{await f.db.close();}
 const g=await fixture();try{
  await g.confirm();
  await g.db.query(`insert into cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records) select $1::text,payload_sha256,receipt||jsonb_build_object('sourceSha256',$1::text),records from cos_mhelp_placement_private.upload_batches where source_sha256=$2`,['d'.repeat(64),hash]);
  await g.db.query('update cos_mhelp_placement_private.upload_control set active_sha256=$1',['d'.repeat(64)]);
  assert.equal((await g.snapshot()).records[0].binding.guardCurrent,false);
 }finally{await g.db.close();}
});

test('Owner-only admission, service-only RPC and private append-only receipt ACLs remain enforced',async()=>{
 const f=await fixture();try{
  await assert.rejects(()=>f.confirm({actor:it}),/Owner/);
  for(const role of ['anon','authenticated','service_role']){
   await f.db.exec('set role '+role);
   await assert.rejects(()=>f.db.query('select * from cos_mhelp_placement_private.identity_binding_receipts'));
   await assert.rejects(()=>f.db.query('select cos_mhelp_placement_private.identity_binding_base_upload_snapshot()'));
   await assert.rejects(()=>f.db.query('select app_private.cos_owner_identity_confirm_base($1,$2,$3,$4,$5)',[actor,org,f.revision,requestId,f.claim]));
   if(role!=='service_role')await assert.rejects(()=>f.confirm());
   await f.db.exec('reset role');
  }
  await f.db.exec('set role service_role');await f.confirm();await f.db.exec('reset role');
  await assert.rejects(()=>f.db.exec('delete from cos_mhelp_placement_private.identity_binding_receipts'),/immutable/);
  await assert.rejects(()=>f.db.exec('truncate cos_mhelp_placement_private.identity_binding_receipts'),/immutable/);
  const kernel=(await f.db.query("select pg_get_functiondef('app_private.cos_owner_identity_confirm_base(uuid,uuid,text,uuid,jsonb)'::regprocedure) v")).rows[0].v;
  assert.equal(kernel.replace('FUNCTION app_private.cos_owner_identity_confirm_base','FUNCTION public.cos_owner_identity_confirm'),f.beforeKernel);
  const reader=(await f.db.query("select pg_get_functiondef('cos_mhelp_placement_private.identity_binding_base_upload_snapshot()'::regprocedure) v")).rows[0].v;
  assert.equal(reader.replace('FUNCTION cos_mhelp_placement_private.identity_binding_base_upload_snapshot','FUNCTION cos_mhelp_placement_private.upload_snapshot'),f.beforeReader);
 }finally{await f.db.close();}
});

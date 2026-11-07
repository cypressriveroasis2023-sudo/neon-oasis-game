import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {restorationFixture,org} from './fixtures/canonical-restoration-fixture.mjs';

async function replaceHistory(f) {
 await f.db.query(`update cos_mhelp_placement_private.upload_batches set records=$2,
 payload_sha256=encode(sha256(convert_to(jsonb_build_object('receipt',receipt,'records',$2::jsonb)::text,'UTF8')),'hex') where source_sha256=$1`,[f.historySha,JSON.stringify(f.historical)]);
}
async function ownerAlias(f) {
 const b=f.historical[0].binding;
 b.matchMethod='owner_confirmed_alias';
 b.reviewEvidence={contract:'COS_OWNER_CONFIRMED_ALIAS_V1',productId:b.productId,sourceLabel:b.fullLabel,
  trackerId:b.trackerId,nativeUnitId:b.nativeUnitId,approval:{messageId:'synthetic-owner-message',ownerQuote:'Synthetic exact alias confirmation'}};
 await replaceHistory(f);
}
async function archiveAlias(f) {
 const target=f.targets.find(t=>t.productId==='2336149'),b=f.historical.find(r=>r.productId===target.productId).binding;
 const oldNative=randomUUID(),oldTracker=randomUUID(),model=randomUUID();
 await f.db.query("insert into public.equipment_models values($1,'Synthetic model','camera_system')",[model]);
 await f.db.query('update public.equipment_units set model_id=$1 where id=$2',[model,target.native]);
 await f.db.query("insert into public.equipment_units(id,organization_id,unit_number,model_id,status) values($1,$2,'Spotter 182',$3,'available')",[oldNative,org,model]);
 await f.db.query("insert into app_private.vision_tracker_locations(id,organization_id,unit_number) values($1,$2,'Spotter 182')",[oldTracker,org]);
 await f.db.query(`insert into app_private.cos_archived_representations(archived_native_id,canonical_native_id,archived_tracker_id,canonical_tracker_id,organization_id,reviewed_before)
 values($1,$2,$3,$4,$5,app_private.cos_archive_before($1,$2,$3,$4))`,[oldNative,target.native,oldTracker,target.tracker,org]);
 b.matchMethod='archived_alias';
 b.expectedGuard=(await f.db.query('select cos_mhelp_placement_private.upload_binding_guard($1,$2) g',[target.tracker,target.native])).rows[0].g;
 await replaceHistory(f);
}

test('historical Owner alias is restored without rewriting its proof or operational data',async()=>{
 const f=await restorationFixture({beforeInstall:ownerAlias});try{
  const before=await f.preserved(),s=await f.call('stage');await f.call('commit',s.digest);
  assert.deepEqual((await f.stored())[0].binding,f.historical[0].binding);assert.deepEqual(await f.preserved(),before);
 }finally{await f.db.close();}
});
test('Owner alias rejects missing approval and wrong exact Product, source or UUID',async()=>{
 for(const key of ['approval','productId','sourceLabel','trackerId','nativeUnitId']){
  const f=await restorationFixture({beforeInstall:async x=>{await ownerAlias(x);delete x.historical[0].binding.reviewEvidence[key];await replaceHistory(x);}});
  try{await assert.rejects(f.call('stage'),/Alias or archive/);assert.deepEqual(await f.stored(),f.rows);}finally{await f.db.close();}
 }
});
test('archive alias keeps predecessor and history, projects current proof and permits exact replay',async()=>{
 const f=await restorationFixture({beforeInstall:archiveAlias});try{
  const before=await f.preserved(),s=await f.call('stage');await f.call('commit',s.digest);
  assert.deepEqual(await f.preserved(),before);assert.equal((await f.call('commit',s.digest)).replayed,true);
  const view=(await f.db.query('select cos_mhelp_placement_private.upload_snapshot() v')).rows[0].v;
  assert.equal(view.records.find(r=>r.productId==='2336149').binding.guardCurrent,true);
 }finally{await f.db.close();}
});
test('archive revocation after stage rejects commit even though original binding guard is unchanged',async()=>{
 const f=await restorationFixture({beforeInstall:archiveAlias});try{
  const s=await f.call('stage');
  await f.db.exec('insert into app_private.cos_archived_representation_revocations select id from app_private.cos_archived_representations');
  await assert.rejects(f.call('commit',s.digest),/Alias or archive/);assert.deepEqual(await f.stored(),f.rows);
 }finally{await f.db.close();}
});
test('archive revocation after commit invalidates saved projection and rejects replay',async()=>{
 const f=await restorationFixture({beforeInstall:archiveAlias});try{
  const s=await f.call('stage');await f.call('commit',s.digest);
  await f.db.exec('insert into app_private.cos_archived_representation_revocations select id from app_private.cos_archived_representations');
  await assert.rejects(f.call('commit',s.digest),/changed/);
  const view=(await f.db.query('select cos_mhelp_placement_private.upload_snapshot() v')).rows[0].v;
  assert.equal(view.records.find(r=>r.productId==='2336149').binding.guardCurrent,false);
 }finally{await f.db.close();}
});
test('archive predecessor activity, missing proof, and changed validator reject admission',async()=>{
 for(const change of [
  db=>db.exec('insert into public.equipment_unit_location_history select archived_native_id from app_private.cos_archived_representations'),
  db=>db.exec('delete from app_private.cos_archived_representations'),
  db=>db.exec("create or replace function app_private.cos_archive_family_base(p_label text) returns text language sql immutable as $$select 'changed'::text$$"),
 ]){
  const f=await restorationFixture({beforeInstall:archiveAlias});try{await change(f.db);await assert.rejects(f.call('stage'));assert.deepEqual(await f.stored(),f.rows);}finally{await f.db.close();}
 }
});
test('next full import retains alias proof and holds; a later archive revocation remains non-current',async()=>{
 for(const setup of [ownerAlias,archiveAlias]){
  const f=await restorationFixture({beforeInstall:setup});try{
   const s=await f.call('stage');await f.call('commit',s.digest);
   const incoming=f.rows.map((row,i)=>i<7?Object.fromEntries(Object.entries(row).filter(([k])=>!['binding','placementHeld','holdReason'].includes(k))):{...f.rows[0],productId:row.productId,unitNumber:row.unitNumber,binding:null,sourceRow:i+2});
   for(const row of incoming){delete row.placementHeld;delete row.holdReason;}
   const result=(await f.db.query("select public.cos_mhelp_live_inventory_session('run',$1) v",[JSON.stringify({portalId:'224643',complete:true,baselineSourceSha256:f.base,readAt:new Date().toISOString(),records:incoming})])).rows[0].v;
   const rows=(await f.db.query('select records from cos_mhelp_placement_private.upload_batches where source_sha256=$1',[result.sourceSha256])).rows[0].records;
   for(const original of f.historical){const row=rows.find(r=>r.productId===original.productId);assert.deepEqual(row.binding,original.binding);assert.equal(row.placementHeld,true);}
   if(setup===archiveAlias){
    await f.db.exec('insert into app_private.cos_archived_representation_revocations select id from app_private.cos_archived_representations');
    const view=(await f.db.query('select cos_mhelp_placement_private.upload_snapshot() v')).rows[0].v;
    assert.equal(view.records.find(r=>r.productId==='2336149').binding.guardCurrent,false);
   }
  }finally{await f.db.close();}
 }
});
test('re-admission under a later exact source never duplicates inventory rows from multiple receipts',async()=>{
 const f=await restorationFixture({beforeInstall:archiveAlias});try{
  const first=await f.call('stage');await f.call('commit',first.digest);
  const base='f'.repeat(64),request=randomUUID(),rows=f.rows.map(r=>({...r,customer:'Later source customer'}));
  await f.db.query(`insert into cos_mhelp_placement_private.upload_batches(source_sha256,receipt,records,payload_sha256)
   select $1,receipt,records,encode(sha256(convert_to(jsonb_build_object('receipt',receipt,'records',records)::text,'UTF8')),'hex')
   from (select jsonb_set(receipt,'{sourceSha256}',to_jsonb($1::text)) receipt,$2::jsonb records from cos_mhelp_placement_private.upload_batches where source_sha256=$3) x`,[base,JSON.stringify(rows),f.base]);
  await f.db.query('update cos_mhelp_placement_private.upload_control set active_sha256=$1',[base]);
  await f.db.query('update cos_mhelp_placement_private.live_inventory_control set active_source_sha256=$1,last_success_at=clock_timestamp()',[base]);
  const expected=(await f.db.query(`select jsonb_build_object('sourceSha256',source_sha256,'payloadSha256',payload_sha256,'scopedRevision',0,'scopedSha256',cos_binding_restoration_private.digest(records)) v from cos_mhelp_placement_private.upload_batches where source_sha256=$1`,[base])).rows[0].v;
  const stage=await f.call('stage',null,{request,expected});await f.call('commit',stage.digest,{request,expected});
  const view=(await f.db.query('select cos_mhelp_placement_private.upload_snapshot() v')).rows[0].v;
  assert.equal(view.records.length,rows.length);
  assert.equal(view.records.filter(r=>r.productId==='2336149').length,1);
  assert.equal(view.records.find(r=>r.productId==='2336149').binding.guardCurrent,true);
  assert.equal(view.records.find(r=>r.productId==='2336149').customer,'Later source customer');
 }finally{await f.db.close();}
});

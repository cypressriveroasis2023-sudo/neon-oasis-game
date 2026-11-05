import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {restorationFixture} from './fixtures/canonical-restoration-fixture.mjs';

test('real SQL stages, restores seven bindings, projects readback, preserves protected state and replays once',async()=>{
 const f=await restorationFixture();try{
  const before=await f.preserved(),stage=await f.call('stage');assert.equal(stage.applied,false);assert.equal(stage.items.length,7);
  assert.deepEqual(await f.stored(),f.rows);
  const receipt=await f.call('commit',stage.digest);assert.equal(receipt.applied,true);assert.equal(receipt.revision,1);
  const after=await f.stored();for(let i=0;i<7;i++){assert.deepEqual(after[i],{...f.rows[i],binding:f.historical[i].binding});}
  assert.deepEqual(after.slice(7),f.rows.slice(7));assert.deepEqual(await f.preserved(),before);
  const view=(await f.db.query('select cos_mhelp_placement_private.upload_snapshot() v')).rows[0].v;
  assert.equal(view.records[0].binding.guardCurrent,true);assert.equal(view.records[0].binding.reviewEvidence,undefined);
  assert.equal(view.records[0].placementHeld,true);assert.equal(view.records[0].holdReason,f.rows[0].holdReason);
  assert.equal((await f.call('commit',stage.digest)).replayed,true);
  assert.equal((await f.db.query('select count(*)::int n from cos_binding_restoration_private.receipts')).rows[0].n,1);
  await assert.rejects(f.call('commit',stage.digest,{confirmation:'I approve a different change to this equipment.'}),/changed/);
 }finally{await f.db.close();}
});
test('real importer preserves restored identity, private proof and placement hold on the next complete source',async()=>{
 const f=await restorationFixture();try{
  const stage=await f.call('stage');await f.call('commit',stage.digest);
  // All input rows follow the existing API shape; no invented receipt.
  const incoming=f.rows.map((row,i)=>i<7?Object.fromEntries(Object.entries(row).filter(([k])=>!['binding','placementHeld','holdReason'].includes(k))):
   {...f.rows[0],productId:row.productId,unitNumber:row.unitNumber,binding:null,sourceRow:i+2});
  for(const r of incoming){delete r.placementHeld;delete r.holdReason;}
  const result=(await f.db.query("select public.cos_mhelp_live_inventory_session('run',$1) v",[JSON.stringify({portalId:'224643',complete:true,baselineSourceSha256:f.base,readAt:new Date().toISOString(),records:incoming})])).rows[0].v;
  const rows=(await f.db.query('select records from cos_mhelp_placement_private.upload_batches where source_sha256=$1',[result.sourceSha256])).rows[0].records;
  for(const original of f.historical){const r=rows.find(r=>r.productId===original.productId);assert.deepEqual(r.binding,original.binding);assert.equal(r.placementHeld,true);assert.equal(r.holdReason,original.holdReason);}
  await assert.rejects(f.call('commit',stage.digest),/changed/);
 }finally{await f.db.close();}
});
test('Owner role, tenant and private table/function ACLs are enforced',async()=>{
 const f=await restorationFixture();try{
  await assert.rejects(f.call('stage',null,{actor:randomUUID()}),/actor/);
  await assert.rejects(f.call('stage',null,{org:randomUUID()}),/Invalid/);
  await f.db.exec("update public.user_profiles set department='it'");await assert.rejects(f.call('stage'),/Owner/);
  await f.db.exec("update public.user_profiles set department='owner'");
  for(const role of ['anon','authenticated']){
   await f.db.exec('set role '+role);await assert.rejects(f.call('stage'),/permission denied/);await f.db.exec('reset role');
  }
  await f.db.exec('set role service_role');await assert.rejects(f.db.query('select * from cos_binding_restoration_private.stages'),/permission denied/);await f.db.exec('reset role');
  await f.db.exec('set role service_role');assert.equal((await f.call('stage')).applied,false);await f.db.exec('reset role');
 }finally{await f.db.close();}
});
test('source, scope, graph, camera and role changes reject staged commits without partial writes',async()=>{
 for(const change of [
  f=>f.db.query("update cos_mhelp_placement_private.live_inventory_control set last_success_at=clock_timestamp()-interval '20 minutes'"),
  f=>f.db.query("insert into cos_mhelp_placement_private.scoped_control values($1,1,null)",[f.base]),
  f=>f.db.query("update app_private.vision_tracker_locations set ip='192.0.2.99' where id=$1",[f.targets[0].tracker]),
  f=>f.db.query("update public.vision_vigilant_devices set external_device_id='changed' where id=$1",[f.targets[0].native]),
  f=>f.db.query("update public.user_profiles set active=false"),
 ]){
  const f=await restorationFixture();try{const stage=await f.call('stage');await change(f);await assert.rejects(f.call('commit',stage.digest));assert.deepEqual(await f.stored(),f.rows);assert.equal((await f.db.query('select count(*)::int n from cos_binding_restoration_private.receipts')).rows[0].n,0);}finally{await f.db.close();}
 }
});
test('immutable history, stages and receipts reject update/delete/truncate; disabled guards block commit',async()=>{
 const f=await restorationFixture();try{
  const stage=await f.call('stage');
  for(const table of ['cos_mhelp_placement_private.upload_batches','cos_binding_restoration_private.stages','cos_binding_restoration_private.receipts']){
   await assert.rejects(f.db.exec('delete from '+table),/append-only/);await assert.rejects(f.db.exec('truncate '+table+' cascade'),/append-only/);
  }
  await assert.rejects(f.db.exec("update cos_binding_restoration_private.stages set expires_at=clock_timestamp()"),/append-only/);
  await f.db.exec('alter table cos_mhelp_placement_private.upload_batches disable trigger canonical_history_immutable');
  await assert.rejects(f.call('commit',stage.digest),/Immutable historical/);
 }finally{await f.db.close();}
});
test('history ambiguity and checksum corruption fail before staging',async()=>{
 for(const corrupt of [false,true]){
  const f=await restorationFixture({beforeInstall:async({db,historical,histReceipt,saveBatch})=>{
   const rows=structuredClone(historical);rows[0].binding.reviewEvidence={different:true};
   await saveBatch('c'.repeat(64),{...histReceipt,sourceSha256:'c'.repeat(64)},rows);
   if(corrupt)await db.exec("update cos_mhelp_placement_private.upload_batches set payload_sha256=repeat('0',64) where source_sha256=repeat('b',64)");
  }});try{await assert.rejects(f.call('stage'),/historical/);assert.equal((await f.db.query('select count(*)::int n from cos_binding_restoration_private.stages')).rows[0].n,0);}finally{await f.db.close();}
 }
});
test('active PR358 override blocks restoration without modifying editor data',async()=>{
 const f=await restorationFixture();try{
  await f.db.exec("create schema cos_owner_equipment_private;create table cos_owner_equipment_private.settings(product_id text,active boolean,settings jsonb);insert into cos_owner_equipment_private.settings values('1910800',true,'{\"publicIp\":\"192.0.2.10\"}')");
  await assert.rejects(f.call('stage'),/override/);
  assert.equal((await f.db.query('select settings from cos_owner_equipment_private.settings')).rows[0].settings.publicIp,'192.0.2.10');
 }finally{await f.db.close();}
});
test('late receipt failure rolls scoped batch, pointer and audit back atomically',async()=>{
 const f=await restorationFixture();try{
  const stage=await f.call('stage');
  await f.db.exec("create function public.fail_test_receipt() returns trigger language plpgsql as $$begin raise exception 'synthetic receipt failure';end$$;create trigger fail_test_receipt before insert on cos_binding_restoration_private.receipts for each statement execute function public.fail_test_receipt()");
  await assert.rejects(f.call('commit',stage.digest),/receipt failure/);
  assert.deepEqual(await f.stored(),f.rows);assert.equal((await f.db.query('select count(*)::int n from cos_mhelp_placement_private.scoped_audit')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('expired stage and dependency-definition drift reject commit',async()=>{
 for(const change of [
  f=>f.db.exec("alter table cos_binding_restoration_private.stages disable trigger stages_immutable;update cos_binding_restoration_private.stages set expires_at=clock_timestamp()-interval '1 minute';alter table cos_binding_restoration_private.stages enable trigger stages_immutable"),
  f=>f.db.exec("create or replace function app_private.has_permission(uuid,text) returns boolean language sql as $$select false$$"),
 ]){
  const f=await restorationFixture();try{const s=await f.call('stage');await change(f);await assert.rejects(f.call('commit',s.digest));assert.deepEqual(await f.stored(),f.rows);}finally{await f.db.close();}
 }
});
test('NULL representation, unreviewed history and differing historical target fail closed',async()=>{
 for(const change of [
  p=>{p.records[0].binding.representedUnitIds=[null];},
  p=>{p.receipt.reviewed='true';},
  p=>{p.records[0].binding.nativeUnitId=randomUUID();},
 ]){
  const f=await restorationFixture({beforeInstall:async({db,historySha})=>{
   const p=(await db.query('select receipt,records from cos_mhelp_placement_private.upload_batches where source_sha256=$1',[historySha])).rows[0];change(p);
   await db.query("update cos_mhelp_placement_private.upload_batches set receipt=$2,records=$3,payload_sha256=encode(sha256(convert_to(jsonb_build_object('receipt',$2::jsonb,'records',$3::jsonb)::text,'UTF8')),'hex') where source_sha256=$1",[historySha,JSON.stringify(p.receipt),JSON.stringify(p.records)]);
  }});try{await assert.rejects(f.call('stage'));assert.deepEqual(await f.stored(),f.rows);}finally{await f.db.close();}
 }
});
test('competing Owner Product ID claim outside the target guard blocks restoration',async()=>{
 const f=await restorationFixture();try{
  const s=await f.call('stage');await f.db.exec('alter table app_private.cos_owner_identity_claims add column product_association jsonb');
  await f.db.query('insert into app_private.cos_owner_identity_claims values($1,$2)',[randomUUID(),JSON.stringify({productId:'1910800'})]);
  await assert.rejects(f.call('commit',s.digest),/Competing Owner/);assert.deepEqual(await f.stored(),f.rows);
 }finally{await f.db.close();}
});
test('camera and link drift after commit mark projection non-current and reject replay',async()=>{
 for(const change of [
  f=>f.db.exec("update public.vision_vigilant_devices set external_device_id='later-camera-change'"),
  f=>f.db.query("insert into cos_mhelp_placement_private.links(equipment_id,tracker_id,tracker_label,full_label,source_revision,baseline_guard,baseline_customer_id,authorization_sha256) values('888',$1,'synthetic','synthetic',$2,repeat('a',64),'11',repeat('b',64))",[randomUUID(),randomUUID()]),
 ]){
  const f=await restorationFixture();try{const s=await f.call('stage');await f.call('commit',s.digest);await change(f);
   const view=(await f.db.query('select cos_mhelp_placement_private.upload_snapshot() v')).rows[0].v;
   assert.equal(view.records[0].binding.guardCurrent,false);await assert.rejects(f.call('commit',s.digest),/changed/);
  }finally{await f.db.close();}
 }
});
test('later unrelated scoped revision retains the restored binding projection',async()=>{
 const f=await restorationFixture();try{
  const s=await f.call('stage');await f.call('commit',s.digest);const next=randomUUID();
  await f.db.query('insert into cos_mhelp_placement_private.scoped_batches(id,base_sha256,previous_id,organization_id,actor_id,request,records) select $1,base_sha256,id,organization_id,actor_id,request,records from cos_mhelp_placement_private.scoped_batches where id=$2',[next,f.request]);
  await f.db.query('update cos_mhelp_placement_private.scoped_control set revision=revision+1,active_id=$1 where base_sha256=$2',[next,f.base]);
  const view=(await f.db.query('select cos_mhelp_placement_private.upload_snapshot() v')).rows[0].v;
  assert.equal(view.records[0].binding.nativeUnitId,f.historical[0].binding.nativeUnitId);assert.equal(view.records[0].binding.guardCurrent,true);
  await assert.rejects(f.call('commit',s.digest),/changed/);
 }finally{await f.db.close();}
});
test('installer refuses a dependency edited after candidate generation',async()=>{
 await assert.rejects(restorationFixture({beforeApply:async({db})=>db.exec("create or replace function app_private.has_permission(uuid,text) returns boolean language sql as $$select false$$")}),/dependency changed/);
});

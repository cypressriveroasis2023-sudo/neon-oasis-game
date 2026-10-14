import test from 'node:test';import assert from 'node:assert/strict';
import {fixture,org,sha,auth,request,t,n} from './fixtures/source-admission-continuity.mjs';
const withFixture=(name,fn)=>test(name,async()=>{let f=await fixture();try{await fn(f);}finally{await f.db.close();}});
const immutable=async db=>(await db.query('select jsonb_agg(to_jsonb(x) order by source_sha256)::text value from cos_mhelp_placement_private.upload_batches x')).rows[0].value;
const allCurrent=s=>[...s.records.filter(r=>r.binding).map(r=>r.binding.guardCurrent),...s.trackerRecords.map(r=>r.binding.guardCurrent)].every(x=>x===true);
withFixture('real full digest changes; both immutable memberships remain current; all source and upload history survives rollback',async f=>{
 const original=await immutable(f.db);const guards=f.expected.map(x=>x.currentGuard);assert.equal(allCurrent(await f.snapshot()),true);
 assert.deepEqual(await f.call(),{applied:true,sources:2,requestId:request,idempotent:false,memberships:4});
 const after=(await f.db.query('select cos_mhelp_placement_private.continuity_bindings($1) b',[f.admissions])).rows[0].b;
 assert.ok(after.every((x,i)=>x.currentGuard!==guards[i]));assert.equal(allCurrent(await f.snapshot()),true);assert.equal(await immutable(f.db),original);
 assert.equal((await f.call()).idempotent,true);assert.deepEqual(await f.counts(),{sources:2,events:2,admissions:1,transitions:2});
 assert.equal((await f.rollback()).rolledBack,true);assert.equal(allCurrent(await f.snapshot()),true);assert.equal(await immutable(f.db),original);
 assert.deepEqual(await f.counts(),{sources:2,events:4,admissions:1,transitions:4});assert.equal((await f.rollback()).idempotent,true);
 assert.equal((await f.db.query("select bool_and(not active and eligibility='tombstone') ok from app_private.cos_geocode_sources")).rows[0].ok,true);
 await assert.rejects(f.call,/rolled back/);
});
withFixture('partial membership list is rejected before any write',async f=>{await assert.rejects(()=>f.call(f.admissions,f.expected.slice(0,1)),/membership/);assert.equal((await f.counts()).sources,0);});
withFixture('stale graph is rejected and cannot be refreshed by submitting its new digest',async f=>{
 await f.db.query("insert into public.equipment_unit_location_history values($1,'New Owner move')",[n(1)]);
 await assert.rejects(f.call,/membership or graph changed/);
 const newExpected=(await f.db.query('select cos_mhelp_placement_private.continuity_bindings($1) b',[f.admissions])).rows[0].b;
 await assert.rejects(()=>f.call(f.admissions,newExpected),/Held upload binding/);assert.equal((await f.counts()).sources,0);
});
withFixture('source import failure halfway through atomically rolls back sources/events/continuity',async f=>{
 const bad=structuredClone(f.admissions);bad[1].nativeGuardSha256='c'.repeat(64);
 await assert.rejects(()=>f.call(bad),/Native placement or GPS changed/);assert.deepEqual(await f.counts(),{sources:0,events:0,admissions:0,transitions:0});assert.equal(allCurrent(await f.snapshot()),true);
});
withFixture('different query address cannot replace the uploaded file address',async f=>{
 const bad=structuredClone(f.admissions);bad[0].installation.street='909 Different Road';await assert.rejects(()=>f.call(bad),/address differs/);assert.equal((await f.counts()).sources,0);
});
withFixture('trackerless target is rejected without weakening existing importer',async f=>{
 const bad=structuredClone(f.admissions);bad[0].trackerId=null;const e=(await f.db.query('select cos_mhelp_placement_private.continuity_bindings($1) b',[bad])).rows[0].b;
 await assert.rejects(()=>f.call(bad,e),/exact eligible uploaded identity/);assert.equal((await f.counts()).sources,0);
});
withFixture('same request ID cannot change reviewed input',async f=>{await f.call();const bad=structuredClone(f.admissions);bad[0].nativeGuardSha256='c'.repeat(64);await assert.rejects(()=>f.call(bad),/request changed/);});
withFixture('existing API placement link blocks source admission even when upload identity is exact',async f=>{
 await f.db.query(`insert into cos_mhelp_placement_private.links(equipment_id,tracker_id,native_unit_id,tracker_label,native_label,full_label,source_revision,baseline_guard,baseline_customer_id,authorization_sha256) values('101',$1,$2,'Spotter 001','Spotter 001','Spotter 001',$3,$4,'12',$4)`,[t(1),n(1),request,sha]);
 await assert.rejects(f.call,/API placement link/);assert.equal((await f.counts()).sources,0);
});
withFixture('later Owner/history change invalidates both readers and refuses rollback',async f=>{
 await f.call();await f.db.query("insert into app_private.cos_owner_identity_claims values($1,'Later Owner claim')",[n(1)]);
 const s=await f.snapshot();assert.equal(s.records[0].binding.guardCurrent,false);assert.equal(s.trackerRecords[0].binding.guardCurrent,false);await assert.rejects(f.rollback,/graph head changed/);
});
withFixture('restoring original pre-admission graph cannot bypass latest continuity head',async f=>{
 await f.call();await f.db.exec('delete from app_private.cos_geocode_sources');const s=await f.snapshot();assert.equal(s.records[0].binding.guardCurrent,false);assert.equal(s.trackerRecords[0].binding.guardCurrent,false);
});
withFixture('rollback refuses changed source revision or complete postimage',async f=>{
 await f.call();await f.db.query("update app_private.cos_geocode_sources set street='909 New Road' where native_unit_id=$1",[n(1)]);await assert.rejects(f.rollback,/source head changed/);
});
withFixture('rollback no-op refuses later unrelated graph drift for its target',async f=>{
 await f.call();await f.rollback();await f.db.query("insert into public.equipment_unit_location_history values($1,'Later history')",[n(1)]);await assert.rejects(f.rollback,/graph head changed/);
});
withFixture('transaction snapshot older than table locks is not accepted',async f=>{
 await f.db.exec('begin isolation level repeatable read');try{await assert.rejects(f.call,/Read committed/);}finally{await f.db.exec('rollback');}assert.equal((await f.counts()).sources,0);
});
withFixture('same-transaction phantom history triggered during source write is caught atomically',async f=>{
 await f.db.exec(`create function public.inject_phantom() returns trigger language plpgsql as $$begin insert into public.equipment_unit_location_history values(new.native_unit_id,'unexpected phantom');return new;end$$;create trigger inject_phantom after insert on app_private.cos_geocode_sources for each row execute function public.inject_phantom();`);
 await assert.rejects(f.call,/Unapproved graph/);assert.equal((await f.counts()).sources,0);assert.equal((await f.db.query('select count(*)::int n from public.equipment_unit_location_history')).rows[0].n,0);
});
withFixture('unexpected address postimage from source trigger is rejected atomically',async f=>{
 await f.db.exec(`create function public.mutate_postimage() returns trigger language plpgsql as $$begin new.street:='909 Unexpected Road';return new;end$$;create trigger z_mutate_postimage before insert on app_private.cos_geocode_sources for each row execute function public.mutate_postimage();`);
 await assert.rejects(f.call,/Unexpected admitted source postimage/);assert.equal((await f.counts()).sources,0);
});
withFixture('unexpected affected source event is rejected atomically',async f=>{
 await f.db.exec(`create function public.mutate_event() returns trigger language plpgsql as $$begin update app_private.cos_geocode_source_events set kind='tombstone' where event_id=new.event_id;return new;end$$;create trigger mutate_event after insert on app_private.cos_geocode_sources for each row execute function public.mutate_event();`);
 await assert.rejects(f.call,/affected event delta/);assert.equal((await f.counts()).events,0);
});
withFixture('all graph tables have non-phantom lock modes during admission',async f=>{
 await f.db.exec('begin');try{await f.call();const locks=(await f.db.query(`select c.relname,l.mode from pg_locks l join pg_class c on c.oid=l.relation where l.granted and c.relname in('cos_geocode_sources','cos_geocode_source_events','equipment_unit_location_history','cos_owner_identity_claims','vision_tracker_locations','equipment_units','cos_archived_representations','upload_batches','links','cos_archived_representation_revocations','cos_source_recorded_coordinates')`)).rows;
 for(const name of ['cos_geocode_sources','cos_geocode_source_events'])assert.ok(locks.some(x=>x.relname===name&&x.mode==='ShareRowExclusiveLock'));
 for(const name of ['equipment_unit_location_history','cos_owner_identity_claims','vision_tracker_locations','equipment_units','cos_archived_representations','upload_batches','links','cos_archived_representation_revocations','cos_source_recorded_coordinates'])assert.ok(locks.some(x=>x.relname===name&&x.mode==='ShareLock'));
 }finally{await f.db.exec('rollback');}
});
withFixture('new private tables and functions are denied to all API roles; audit history is append only',async f=>{
 await f.call();for(const role of ['anon','authenticated','service_role']){await f.db.exec('set role '+role);await assert.rejects(f.call);await assert.rejects(f.rollback);await assert.rejects(()=>f.db.exec('select * from cos_mhelp_placement_private.source_continuity'));await f.db.exec('reset role');}
 await assert.rejects(()=>f.db.exec('delete from cos_mhelp_placement_private.source_continuity'),/append-only/);await assert.rejects(()=>f.db.exec("update cos_mhelp_placement_private.source_admissions set authorization_sha256='x'"),/append-only/);
 await assert.rejects(()=>f.db.exec('truncate cos_mhelp_placement_private.source_admissions,cos_mhelp_placement_private.source_continuity,cos_mhelp_placement_private.source_rollbacks'),/append-only/);
});
withFixture('changed active upload or payload precondition is rejected',async f=>{
 await assert.rejects(()=>f.db.query('select cos_mhelp_placement_private.admit_sources_continuity($1,$2,$3,$4,$5,$6,$7)',[request,org,sha,'c'.repeat(64),f.admissions,f.expected,auth]),/Active upload changed/);
 await f.db.exec('update cos_mhelp_placement_private.upload_control set active_sha256=null');await assert.rejects(f.call,/Active upload changed/);assert.equal((await f.counts()).sources,0);
});
withFixture('SHOP, lifecycle-excluded and placement-held upload records cannot be admitted',async f=>{
 for(const [path,value] of [[['placement'],'SHOP'],[['lifecycle'],'DO_NOT_USE'],[['placementHeld'],true],[['binding','placementHeld'],true],[['binding','state'],'held']]){
  await f.db.query('update cos_mhelp_placement_private.upload_batches set records=jsonb_set(records,$1,$2)',[['0',...path],JSON.stringify(value)]);
  await assert.rejects(f.call,/exact eligible uploaded identity/);
  await f.db.query('update cos_mhelp_placement_private.upload_batches set records=$1',[f.records]);
 }
 assert.equal((await f.counts()).sources,0);
});
withFixture('existing source for a target cannot be overwritten or used to refresh the upload root',async f=>{
 await f.db.query('select app_private.cos_geocode_sources_admin_import_reviewed($1,$2)',[org,[f.admissions[0]]]);
 const e=(await f.db.query('select cos_mhelp_placement_private.continuity_bindings($1) b',[f.admissions])).rows[0].b;
 await assert.rejects(()=>f.call(f.admissions,e),/Held upload binding/);assert.equal((await f.counts()).admissions,0);
});
withFixture('malformed null original guard fails closed even with refreshed expected membership',async f=>{
 await f.db.exec("update cos_mhelp_placement_private.upload_batches set records=jsonb_set(records,'{0,binding,expectedGuard}','null')");
 const e=(await f.db.query('select cos_mhelp_placement_private.continuity_bindings($1) b',[f.admissions])).rows[0].b;
 await assert.rejects(()=>f.call(f.admissions,e),/Held upload binding/);assert.equal((await f.counts()).sources,0);
});
withFixture('all prior affected events survive; tampering with one is rejected',async f=>{
 await f.db.query(`insert into app_private.cos_geocode_source_events(event_id,organization_id,entity_kind,native_unit_id,product_id,source_revision,kind) values(900,$1,'equipment_unit',$2,'101',$3,'tombstone')`,[org,n(1),request]);
 await f.db.exec(`create function public.rewrite_old_event() returns trigger language plpgsql as $$begin update app_private.cos_geocode_source_events set kind='upsert' where event_id=900;return new;end$$;create trigger rewrite_old_event after insert on app_private.cos_geocode_sources for each row execute function public.rewrite_old_event();`);
 await assert.rejects(f.call,/affected event delta/);assert.equal((await f.counts()).sources,0);assert.equal((await f.db.query('select kind from app_private.cos_geocode_source_events where event_id=900')).rows[0].kind,'tombstone');
});
test('actual archive source trigger cannot revoke an existing representation during admission',async()=>{
 const f=await fixture(2,null,{archive:true});try{const before=await immutable(f.db);await assert.rejects(f.call,/Unapproved graph or source delta/);assert.equal((await f.counts()).sources,0);assert.equal((await f.db.query('select count(*)::int n from app_private.cos_archived_representation_revocations')).rows[0].n,0);assert.equal(await immutable(f.db),before);assert.equal(allCurrent(await f.snapshot()),true);}finally{await f.db.close();}
});
test('actual source-coordinate trigger cannot deactivate a preserved recorded point',async()=>{
 const f=await fixture(2,null,{coordinates:true});try{await assert.rejects(f.call,/Unapproved graph or source delta/);assert.equal((await f.counts()).sources,0);assert.equal((await f.db.query('select bool_and(active) ok from app_private.cos_source_recorded_coordinates')).rows[0].ok,true);assert.equal(allCurrent(await f.snapshot()),true);}finally{await f.db.close();}
});

withFixture('admission is bounded to eight source rows',async f=>{await assert.rejects(()=>f.call(Array.from({length:9},()=>f.admissions[0])),/Invalid bounded admission/);assert.equal((await f.counts()).sources,0);});

withFixture('source complete assignment label must match the active uploaded customer exactly',async f=>{const changed=structuredClone(f.admissions);changed[0].siteLabel='Different synthetic customer: Different site';await assert.rejects(()=>f.call(changed),/exact eligible uploaded identity/);assert.equal((await f.counts()).sources,0);});

import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
import {shopFixture} from './helpers/shop-attestation-fixture.mjs';
import {placementIdentityConcernKey} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';
let f;before(async()=>{f=await shopFixture();});after(async()=>{await f?.close();});
async function rollback(fn){await f.db.exec('begin');try{await fn();}finally{await f.db.exec('rollback');}}

test('service-only attestation runs in a read-only transaction, returns exact scope and changes no relation',async()=>{
 const before=await f.snapshot(),p=f.args();
 await f.db.exec('begin read only;set local role service_role');
 let r;try{r=await f.attest(p);}finally{await f.db.exec('rollback');}
 assert.deepEqual(Object.keys(r).sort(),['contract','organization_id','legacy_actor_id','request_id','purpose','checked_at','valid_until','items'].sort());
 assert.equal(r.request_id,p.p_request_id);assert.equal(r.legacy_actor_id,p.p_legacy_actor_id);assert.equal(r.items.length,1);
 assert.deepEqual(Object.keys(r.items[0]).sort(),['equipment_key','family','unit_tag','representation_id','representation_kind','native_unit_id','tracker_id','placement','observed_at','source_success_at','authority_sha256'].sort());
 assert.equal(r.items[0].native_unit_id,f.unit.nativeId);assert.equal(r.items[0].placement,'SHOP');assert.match(r.items[0].authority_sha256,/^[a-f0-9]{64}$/);
 assert.ok(Date.parse(r.valid_until)-Date.parse(r.checked_at)<=30000);
 assert.deepEqual(await f.snapshot(),before);
});
test('effective ACLs deny public/browser roles, private helpers and table reads; revoke rolls back only this boundary',async()=>{
 const acl=(await f.db.query("select has_function_privilege('anon',oid,'EXECUTE') anon,has_function_privilege('authenticated',oid,'EXECUTE') authenticated,has_function_privilege('service_role',oid,'EXECUTE') service,provolatile,prosecdef,proconfig from pg_proc where oid='public.cos_techcheck_shop_attestation_v1(uuid,uuid,text,jsonb)'::regprocedure")).rows[0];
 assert.deepEqual(acl,{anon:false,authenticated:false,service:true,provolatile:'s',prosecdef:true,proconfig:['search_path=""','jit=off']});
 for(const role of ['anon','authenticated'])await rollback(async()=>{await f.db.exec('set local role '+role);await assert.rejects(f.attest(),/permission denied/);});
 await rollback(async()=>{await f.db.exec('set local role service_role');await assert.rejects(f.db.exec('select * from cos_mhelp_placement_private.links'),/permission denied/);});
 await rollback(async()=>{await f.db.exec("set local role service_role");await assert.rejects(f.db.query('select cos_mhelp_placement_private.techcheck_identity_concern_v1($1)',['Sniper 001']),/permission denied/);});
 await rollback(async()=>{await f.db.exec('revoke execute on function public.cos_techcheck_shop_attestation_v1(uuid,uuid,text,jsonb) from service_role;set local role service_role');await assert.rejects(f.attest(),/permission denied/);});
 assert.equal((await f.attest()).items.length,1);
});
test('existing authority reader definitions and actor-gated snapshot signatures are preserved',async()=>{
 const after=(await f.db.query(f.functionCatalog)).rows.filter(r=>!['cos_techcheck_shop_attestation_v1','techcheck_identity_concern_v1'].includes(r.proname));assert.deepEqual(after,f.beforeFunctions);
 for(const old of f.readers.filter(r=>r.schema==='cos_mhelp_placement_private')){
  const r=(await f.db.query('select pg_get_functiondef(p.oid) v from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2 and pg_get_function_identity_arguments(p.oid)=$3',[old.schema,old.proname,old.arguments])).rows[0];assert.equal(r.v,old.definition);
 }
 await assert.rejects(f.db.exec(f.migration),/Fresh attestation install/);await f.db.exec('rollback');
});
test('denial-only concern keys match existing placement rules, including numbered families and suffixes',async()=>{
 for(const label of ['Sniper 001','Sniper 4 001','Sniper 2 001','Recon II 001','RI 001','Solar Pole 72 002','Solar Spotter 008HDC4','Spotter 8.1','Sniper 000','Unknown exact label','AXIS SPOTTER 001']){
  assert.equal((await f.db.query('select cos_mhelp_placement_private.techcheck_identity_concern_v1($1) v',[label])).rows[0].v,placementIdentityConcernKey(label),label);
 }
});
test('invalid, extra, duplicate and cross-request scope is denied without partial results',async()=>{
 for(const p of [f.args([],{}),f.args(Array(21).fill(f.unit.item)),f.args([f.unit.item,f.unit.item]),f.args([{...f.unit.item,organization_id:randomUUID()}]),f.args([{...f.unit.item,family:1}]),f.args([{...f.unit.item,unit_tag:' 001'}]),f.args(undefined,{p_purpose:'list_all'}),f.args(undefined,{p_request_id:null}),f.args(undefined,{p_legacy_actor_id:null})])await assert.rejects(f.attest(p),/scope/);
 await assert.rejects(f.attest(f.args([f.unit.item,{equipment_key:'unknown',family:'Sniper',unit_tag:'999'}])),/Current Shop/);
 const p=f.args(),a=await f.attest(p),b=await f.attest({...p,p_request_id:randomUUID()});assert.notEqual(a.request_id,b.request_id);assert.equal(a.items[0].authority_sha256,b.items[0].authority_sha256);
});
for(const [name,sql,args] of [
 ['disabled source','update cos_mhelp_placement_private.control set enabled=false',[]],
 ['source error',"update cos_mhelp_placement_private.control set error_code='unavailable'",[]],
 ['stale observation',"update cos_mhelp_placement_private.links set observed_at=now()-interval '41 minutes' where equipment_id=$1",()=>[f.unit.product]],
 ['future observation',"update cos_mhelp_placement_private.links set observed_at=now()+interval '1 minute' where equipment_id=$1",()=>[f.unit.product]],
 ['held current observation despite prior Shop',"update cos_mhelp_placement_private.links set observation=jsonb_build_object('state','held','reason','equipment_missing') where equipment_id=$1",()=>[f.unit.product]],
 ['missing observed equipment identity',"update cos_mhelp_placement_private.links set observation=observation-'equipmentId' where equipment_id=$1",()=>[f.unit.product]],
 ['missing observed site',"update cos_mhelp_placement_private.links set observation=observation-'siteLabel' where equipment_id=$1",()=>[f.unit.product]],
 ['changed customer',"update cos_mhelp_placement_private.links set observation=jsonb_set(observation,'{customerId}','\"12\"') where equipment_id=$1",()=>[f.unit.product]],
 ['changed service location',"update cos_mhelp_placement_private.links set observation=jsonb_set(observation,'{serviceLocationId}','\"12\"') where equipment_id=$1",()=>[f.unit.product]],
 ['Field observation',"update cos_mhelp_placement_private.links set observation=jsonb_set(observation,'{placement}','\"FIELD\"') where equipment_id=$1",()=>[f.unit.product]],
 ['native GPS','update equipment_units set gps_latitude=30 where id=$1',()=>[f.unit.nativeId]],
 ['installed site','update equipment_units set installed_site_id=$2 where id=$1',()=>[f.unit.nativeId,randomUUID()]],
 ['native status',"update equipment_units set status='repair' where id=$1",()=>[f.unit.nativeId]],
 ['native retirement','update equipment_units set retired_at=now() where id=$1',()=>[f.unit.nativeId]],
 ['tracker mutation',"update app_private.vision_tracker_locations set site='changed' where id=$1",()=>[f.unit.tracker]],
 ['deactivated imported source','update app_private.cos_geocode_sources set active=false where tracker_id=$1',()=>[f.unit.tracker]],
 ['changed source revision','update app_private.cos_geocode_sources set source_revision=$2 where tracker_id=$1',()=>[f.unit.tracker,randomUUID()]],
 ['archived representation','insert into app_private.cos_archived_representations(archived_native_id) values($1)',()=>[f.unit.nativeId]],
 ['native placement history','insert into equipment_unit_location_history values($1)',()=>[f.unit.nativeId]],
 ['no current upload','update cos_mhelp_placement_private.upload_control set active_sha256=null',[]],
])test(name+' denies the entire attestation',async()=>rollback(async()=>{await f.db.query(sql,typeof args==='function'?args():args);await assert.rejects(f.attest(),/Current Shop/);}));
test('native label variants and conflicting provider membership veto a second identity',async()=>{
 await rollback(async()=>{await f.db.query("insert into equipment_units(id,organization_id,unit_number,status) values($1,'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5','Sniper 1','available')",[randomUUID()]);await assert.rejects(f.attest(),/Current Shop/);});
 await rollback(async()=>{const device=randomUUID();await f.db.query('insert into vision_vigilant_unit_matches(id,equipment_unit_id,vigilant_device_id) values($1,$2,$3),($4,$5,$3)',[randomUUID(),f.unit.nativeId,device,randomUUID(),randomUUID()]);await assert.rejects(f.attest(),/Current Shop/);});
});
test('scoped source holds, lifecycle, wrong binding and stale continuity cannot be bypassed by a current MHelp link',async()=>{
 for(const change of [r=>r.placement='FIELD',r=>r.lifecycle='DO_NOT_USE',r=>r.holdReason='review',r=>r.placementHeld=true,r=>r.possibleAliasUnitIds=[f.unit.nativeId]])await rollback(async()=>{
  const source=(await f.db.query('select active_sha256 v from cos_mhelp_placement_private.upload_control')).rows[0].v;
  const records=(await f.db.query('select cos_mhelp_placement_private.scoped_records($1) v',[source])).rows[0].v;const record=records.find(r=>r.productId===f.unit.product);change(record);record.scopedAuthority={};
  const id=randomUUID();await f.db.query('insert into cos_mhelp_placement_private.scoped_batches(id,base_sha256,organization_id,actor_id,request,records) values($1,$2,$3,$4,$5,$6)',[id,source,'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',randomUUID(),{},records]);
  await f.db.query('insert into cos_mhelp_placement_private.scoped_control values($1,1,$2)',[source,id]);await assert.rejects(f.attest(),/Current Shop/);
 });
 for(const change of [r=>r.binding.expectedGuard='0'.repeat(64),r=>r.binding.nativeUnitId=randomUUID()])await rollback(async()=>{
  const records=structuredClone(f.records);const record=structuredClone(f.unit.record);change(record);records.push(record);const sha='f'.repeat(64);
  await f.db.query('insert into cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records) values($1,$1,$2,$3)',[sha,{...f.receipt,sourceSha256:sha,recordCount:records.length},records]);await f.db.query('update cos_mhelp_placement_private.upload_control set active_sha256=$1',[sha]);await assert.rejects(f.attest(),/Current Shop/);
 });
});
test('valid scoped authority can corroborate Shop; malformed or future scoped metadata denies',async()=>{
 for(const mutation of [null,a=>a.receivedAt=new Date(Date.now()+60000).toISOString(),a=>a.evidenceKind='unreviewed',a=>a.revisionId='unknown'])await rollback(async()=>{
  const source=(await f.db.query('select active_sha256 v from cos_mhelp_placement_private.upload_control')).rows[0].v;
  const records=(await f.db.query('select cos_mhelp_placement_private.scoped_records($1) v',[source])).rows[0].v;
  const record=records.find(r=>r.productId===f.unit.product),id=randomUUID();
  record.scopedAuthority={contract:'COS_SCOPED_INVENTORY_AUTHORITY_V1',evidenceKind:'derived_mapping',revisionId:id,evidenceSha256:'a'.repeat(64),receivedAt:new Date(Date.now()-1000).toISOString()};
  mutation?.(record.scopedAuthority);
  await f.db.query('insert into cos_mhelp_placement_private.scoped_batches(id,base_sha256,organization_id,actor_id,request,records) values($1,$2,$3,$4,$5,$6)',[id,source,'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',randomUUID(),{},records]);
  await f.db.query('insert into cos_mhelp_placement_private.scoped_control values($1,1,$2)',[source,id]);
  if(mutation)await assert.rejects(f.attest(),/Current Shop/);else assert.equal((await f.attest()).items[0].placement,'SHOP');
 });
});
test('related tracker evidence must be current active Shop, including candidate-only identity holds',async()=>{
 for(const mutation of [null,r=>r.lifecycle='RETIRED',r=>r.placement='FIELD',r=>r.binding.placementHeld=true,r=>{r.unitNumber='Unrelated 900';r.matchedProductId='unrelated';r.binding={state:'held',candidateUnitIds:[f.unit.nativeId]};}])await rollback(async()=>{
  const source=(await f.db.query('select active_sha256 v from cos_mhelp_placement_private.upload_control')).rows[0].v;
  const batch=(await f.db.query('select * from cos_mhelp_placement_private.upload_batches where source_sha256=$1',[source])).rows[0];
  const record={recordId:randomUUID(),unitNumber:'Sniper 001',matchedProductId:f.unit.product,placement:'SHOP',lifecycle:'ACTIVE',binding:{...f.unit.record.binding,state:'linked',unitIds:[f.unit.nativeId]}};
  mutation?.(record);const sha='d'.repeat(64);
  await f.db.query('insert into cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records) values($1,$1,$2,$3)',[sha,{...batch.receipt,sourceSha256:sha,trackerRecords:[record]},batch.records]);
  await f.db.query('update cos_mhelp_placement_private.upload_control set active_sha256=$1',[sha]);
  if(mutation)await assert.rejects(f.attest(),/Current Shop/);else assert.equal((await f.attest()).items[0].placement,'SHOP');
 });
});
test('tracker-only identity is supported and multiple exact requested units return bytewise order only',async()=>rollback(async()=>{
 const second=await f.addUnit({family:'Ranger',tag:'502',native:false});const r=await f.attest(f.args([f.unit.item,second.item]));
 assert.equal(r.items.length,2);assert.deepEqual(r.items.map(x=>x.equipment_key),[second.item.equipment_key,f.unit.item.equipment_key]);assert.equal(r.items[0].native_unit_id,null);assert.equal(r.items[0].representation_id,second.tracker);
}));

test('Owner identity claims including revoked history remain a hold; native epoch detects change and restore',async()=>rollback(async()=>{
 const before=(await f.attest()).items[0].authority_sha256;
 await f.db.query("update equipment_units set serial_number='changed' where id=$1",[f.unit.nativeId]);await f.db.query('update equipment_units set serial_number=null where id=$1',[f.unit.nativeId]);
 assert.notEqual((await f.attest()).items[0].authority_sha256,before);
 const request=randomUUID(),claim=(await f.db.query("insert into app_private.cos_owner_identity_claims(organization_id,native_unit_id,native_unit_label,legacy_unit_key,device_ids,resource_epoch,source_epoch,physical_digest,provenance,confirmation_text,evidence_ref,confirmed_by,request_id,request_payload) values('ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',$1,'Sniper 001','SNIPER 001',array['1'],$2,$2,$2,'owner_confirmation','Synthetic reviewed identity','synthetic',$3,$4,'{}') returning id",[f.unit.nativeId,'a'.repeat(64),randomUUID(),request])).rows[0].id;
 await f.db.exec('savepoint claim_hold');await assert.rejects(f.attest(),/Current Shop/);await f.db.exec('rollback to savepoint claim_hold');
 await f.db.query("insert into app_private.cos_owner_identity_revocations(claim_id,revoked_by,reason,request_id,cause) values($1,$2,'Synthetic revoked identity',$3,'owner_revocation')",[claim,randomUUID(),randomUUID()]);await assert.rejects(f.attest(),/Current Shop/);
}));
test('real concurrent native mutation is seen by the next statement and denial has no write footprint',{skip:!process.env.COS_HANDOFF_TEST_DATABASE_URL},async()=>{
 const a=new f.pg.Client({connectionString:f.connection}),b=new f.pg.Client({connectionString:f.connection});await a.connect();await b.connect();
 try{
  const p=f.args(),sql='select public.cos_techcheck_shop_attestation_v1($1,$2,$3,$4) v',args=Object.values(p).map(x=>Array.isArray(x)?JSON.stringify(x):x);
  await a.query('begin read only');await a.query('set local role service_role');const before=(await a.query(sql,args)).rows[0].v;
  await b.query("update equipment_units set status='installed' where id=$1",[f.unit.nativeId]);
  await assert.rejects(a.query(sql,args),/Current Shop/);await a.query('rollback');assert.equal(before.items[0].placement,'SHOP');
 }finally{await a.query('rollback').catch(()=>{});await b.query("update equipment_units set status='available' where id=$1",[f.unit.nativeId]);await Promise.all([a.end(),b.end()]);}
});
test('one native statement keeps a consistent snapshot during a concurrent status commit',{skip:!process.env.COS_HANDOFF_TEST_DATABASE_URL},async()=>{
 const a=new f.pg.Client({connectionString:f.connection}),b=new f.pg.Client({connectionString:f.connection});await a.connect();await b.connect();
 try{
  await b.query('begin');await b.query('select pg_advisory_xact_lock(61017001)');
  const pid=(await a.query('select pg_backend_pid() pid')).rows[0].pid,p=f.args();
  await a.query('set role service_role');
  const read=a.query('with barrier as materialized(select pg_advisory_xact_lock(61017001)) select public.cos_techcheck_shop_attestation_v1($1,$2,$3,$4) v from barrier',Object.values(p).map(x=>Array.isArray(x)?JSON.stringify(x):x));
  const outcome=read.then(value=>({value}),error=>({error}));let waiting=false;
  for(let i=0;i<100;i++){const w=(await f.db.query("select wait_event='advisory' waiting from pg_stat_activity where pid=$1",[pid])).rows[0];if(w?.waiting){waiting=true;break;}await setTimeout(10);}
  assert.equal(waiting,true);await b.query("update equipment_units set status='installed' where id=$1",[f.unit.nativeId]);await b.query('commit');
  const result=await outcome;assert.equal(result.error,undefined);assert.equal(result.value.rows[0].v.items[0].placement,'SHOP');
  await assert.rejects(f.attest(),/Current Shop/);
 }finally{await b.query('rollback').catch(()=>{});await b.query("update equipment_units set status='available' where id=$1",[f.unit.nativeId]);await Promise.all([a.end(),b.end()]);}
});

test('1001 source records stay private and 20 requested units remain bounded',async()=>rollback(async()=>{
 const units=[f.unit];for(let n=2;n<=20;n++)units.push(await f.addUnit({tag:String(n).padStart(3,'0')}));
 const base=(await f.db.query('select active_sha256 v from cos_mhelp_placement_private.upload_control')).rows[0].v;
 const records=(await f.db.query('select records from cos_mhelp_placement_private.upload_batches where source_sha256=$1',[base])).rows[0].records;
 while(records.length<1001){const n=records.length;records.push({productId:String(900000+n),unitNumber:'Unrelated source '+n,category:'Other',customerId:'11',customer:'Private synthetic customer',placement:'SHOP',lifecycle:'UNFLAGGED',sourceAddress:{street:'Private synthetic address'},sourceRow:n+1000,binding:null});}
 const sha='e'.repeat(64);await f.db.query('insert into cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records) values($1,$1,$2,$3)',[sha,{...f.receipt,sourceSha256:sha,recordCount:1001},records]);await f.db.query('update cos_mhelp_placement_private.upload_control set active_sha256=$1',[sha]);
 const start=performance.now(),result=await f.attest(f.args(units.map(u=>u.item))),duration=performance.now()-start;
 assert.equal(result.items.length,20);assert.doesNotMatch(JSON.stringify(result),/Unrelated|Private synthetic|90000/);
 assert.ok(duration<2000,'Synthetic maximum item read exceeded 2-second test budget: '+duration);console.log('native attestation: 20 requested / 1001 source rows, '+Math.round(duration)+' ms');
}));

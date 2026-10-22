import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {correctionActors,correctionActorNames,correctionMigrationNames,correctionFixtureSchema,correctionLegacyReadySql} from './helpers/correction-schema-fixture.mjs';

// Synthetic local PostgreSQL only. Never calls a live project or production handoff.
const {it,svc,other,unverified,owner,secondIT}=correctionActors;
const names=correctionActorNames;
let db,contract,correctionSql;
before(async()=>{
 db=new PGlite();contract=JSON.parse(await readFile(new URL('../../transfers/checklist-contract.json',import.meta.url),'utf8'));
 await db.exec(correctionFixtureSchema);
 correctionSql=await readFile(new URL('../../database-maintenance/techcheck-handoff-corrections-v1.sql',import.meta.url),'utf8');
 for(const name of correctionMigrationNames.filter(name=>name!=='techcheck-handoff-corrections-v1.sql')){
  await db.exec(await readFile(new URL('../../database-maintenance/'+name,import.meta.url),'utf8'));
 }
 await db.exec(correctionLegacyReadySql);
});
after(async()=>db?.close());
async function as(who,fn,role='authenticated'){
 await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[who??'']);await db.query("select set_config('test.jwt_role',$1,false)",[role]);
 await db.exec('set role '+role);try{return await fn();}finally{await db.exec('reset role');}
}
const call=(name,r={},who=it,role='authenticated')=>as(who,async()=>{
 const args=Object.keys(r).map((k,n)=>k+'=> $'+(n+1)).join(',');
 return (await db.query(`select public.${name}(${args}) as result`,Object.values(r))).rows[0].result;
},role);
const submit=(r,who=it)=>call('submit_techcheck_transfer_v2',r,who);
const classify=(r,who=it)=>call('classify_techcheck_transfer_purpose_v1',r,who);
// Fixture-only legacy seeding runs as the local database owner. The production
// public legacy wrapper still rejects fresh unclassified checkout and receipts.
async function legacySubmit(r,who=it){
 await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[who]);
 const args=Object.keys(r).map((k,n)=>k+'=> $'+(n+1)).join(',');
 return(await db.query(`select app_private.submit_techcheck_transfer_pre_purpose_v1(${args}) result`,Object.values(r))).rows[0].result;
}
const correct=(r,who=it)=>call('submit_techcheck_transfer_correction_v1',r,who);
const context=(id,who=it)=>call('techcheck_transfer_correction_context_v1',{p_transfer_id:id},who);
const queue=(r)=>call('techcheck_correction_delivery_v1',r,null,'service_role');
const count=async(table)=>(await db.query('select count(*)::int n from app_private.'+table)).rows[0].n;
const state=async(id)=>(await db.query('select * from app_private.techcheck_transfers where id=$1',[id])).rows[0];
const reservations=async(id)=>(await db.query('select equipment_key from app_private.techcheck_transfer_reservations where transfer_id=$1 order by equipment_key',[id])).rows.map(r=>r.equipment_key);
const originalFingerprint=async(id)=>(await db.query(`select md5((to_jsonb(e)||jsonb_build_object('original_archive',o.drive_manifest))::text) hash from app_private.techcheck_transfer_events e join app_private.techcheck_transfer_outbox o on o.event_id=e.id where e.id=$1`,[id])).rows[0].hash;
const plans={Sniper:['sniper_2x_12v_35ah',2],Ranger:['lifepo4_1x',1],Spotter:['none',0],'Solar Spotter':['agm_4x_12v_110ah',4],Helios:['helios_battery_box',1],'Recon 2':['recon_configured',3]};
async function equipment(family='Solar Spotter',purpose='truck_replenishment'){
 const id=randomUUID(),key=family+':TEST-'+id,tag='TEST-'+id.slice(0,10);
 await db.query('insert into equipment_master(equipment_key,unit_tag,source_family,canonical_family,workflow_type,source_label,tracker_state) values($1,$2,$3,$3,$3,$4,\'shop\')',[key,tag,family,family+' '+tag]);
 const item={equipment_key:key,family,unit_tag:tag,sims:[],battery_count:1,parts:[]};
 if(purpose==='truck_replenishment')Object.assign(item,{battery_count:null,battery_configuration:null,required_battery_count:null});
 if(purpose==='installation')Object.assign(item,{battery_count:plans[family][1],battery_configuration:plans[family][0],required_battery_count:plans[family][1]});
 return item;
}
async function upload(r,who=it){
 for(const path of [...new Set(r.p_photos.map(p=>p.path))]){
  await as(who,()=>db.query("insert into storage.objects values('techcheck-transfer-evidence',$1,'{\"mimetype\":\"image/jpeg\",\"size\":1234}')",[path]));
 }
}
function photos(items,id,who=it,both=false){return items.flatMap(i=>(both?['unit','tag']:['unit']).map(kind=>({equipment_key:i.equipment_key,kind,path:who+'/'+id+'/'+createHash('sha256').update(i.equipment_key).digest('hex')+'.jpg'})));}
async function issue(items,who=it,{purpose='truck_replenishment',legacy=false}={}){
 items??=[await equipment('Solar Spotter',legacy?'legacy':purpose)];const id=randomUUID();
 const r={p_request_id:id,p_transfer_id:id,p_kind:'checkout',p_expected_revision:0,p_service_actor:svc,p_items:items,
  p_checks:Object.fromEntries(items.map(i=>[i.equipment_key,Object.fromEntries(contract.families[i.family].bool_fields.map(f=>[f,true]))])),
  p_signature:{method:'typed',name:names[who],confirmed:true},p_photos:photos(items,id,who),p_notes:'Synthetic original signed submission'};
 if(!legacy){r.p_purpose=purpose;if(purpose==='installation')for(const item of items)for(const field of ['delivery_monitoring_ok','delivery_ticket_count_ok','delivery_customer_email_app_ok'])if(item.family!=='Helios'||field!=='delivery_ticket_count_ok')r.p_checks[item.equipment_key][field]=true;}
 await upload(r,who);await(legacy?legacySubmit(r,who):submit(r,who));return r;
}
async function correction(original,{who=it,items,revision=1,mode='self'}={}){
 const id=randomUUID();items??=[await equipment('Solar Spotter',original.p_purpose||'truck_replenishment')];
 const confirmation={mode,confirmed:true,technician_id:it};
 if(mode==='cited')Object.assign(confirmation,{technician_confirmed_at:new Date().toISOString(),technician_reply:'The corrected unit and the attached matching tag photo are confirmed by Synthetic IT.',evidence_reference:'https://drive.google.com/file/d/synthetic-confirmation/view'});
 return {p_request_id:id,p_transfer_id:original.p_transfer_id,p_expected_revision:revision,p_items:items,p_photos:photos(items,id,who,true),p_reason:'Correct the recorded unit identity after physically verifying its tag.',p_confirmation:confirmation};
}
function receipt(original,items=original.p_items,revision=1){const id=randomUUID();return {...original,p_request_id:id,p_kind:'receipt',p_expected_revision:revision,p_items:items,p_checks:{},p_signature:{method:'typed',name:names[svc],confirmed:true},p_photos:photos(items,id,svc)};}

test('correction install rejects prerequisite drift before replacing evidence authorization or creating tables',async()=>{
 for(const [change,message] of [
  ["alter function app_private.techcheck_transfer_file(text,boolean) set search_path='public'",/function drift/],
  ["alter function app_private.techcheck_transfer_manifest_v2(jsonb,text,boolean,boolean) rename to unavailable_manifest_v2",/purpose v2 is required/],
  ["alter table app_private.techcheck_transfer_events disable trigger techcheck_transfer_event_immutable_v2",/immutable signed handoff event guard/]
 ]){
  await db.exec('begin;'+change+';');
  try{await assert.rejects(db.exec(correctionSql),message);}finally{await db.exec('rollback');}
  assert.equal((await db.query("select to_regclass('app_private.techcheck_transfer_corrections') existing")).rows[0].existing,null);
 }
 await db.exec(correctionSql);
});

test('review migration is disabled by default; clients cannot enable or write private tables',async()=>{
 const o=await issue(),r=await correction(o),c=await context(o.p_transfer_id,owner);
 assert.equal(c.role,'owner');assert.equal(c.ready,false);assert.deepEqual(c.gates,{enabled:false,reports_ready:false});
 assert.equal(c.transfers[0].can_apply_cited,false);await assert.rejects(correct(r),/awaiting release approval/);
 for(const table of ['techcheck_transfer_correction_settings','techcheck_transfer_corrections','techcheck_transfer_correction_audit','techcheck_transfer_correction_outbox']){
  await as(owner,()=>assert.rejects(db.query('select * from app_private.'+table),/permission denied/));
 }
 await as(owner,()=>assert.rejects(db.exec('update app_private.techcheck_transfer_correction_settings set enabled=true'),/permission denied/));
 await db.exec('update app_private.techcheck_transfer_correction_settings set enabled=true,reports_ready=true');
});

test('original technician corrects pending manifest and reservations without rewriting signed originals or accepting stock',async()=>{
 const o=await issue(),r=await correction(o),hash=await originalFingerprint(o.p_request_id),events=await count('techcheck_transfer_events');
 await db.query("insert into service_truck_units values($1,'Synthetic old equipment','TEST-OLD','assigned')",[svc]);
 await upload(r);const saved=await correct(r),fresh=await context(o.p_transfer_id,svc),t=fresh.transfers[0];
 assert.equal(saved.revision,2);assert.equal(saved.state,'awaiting_service');assert.equal(saved.applied_by.id,it);assert.equal(saved.confirmed_by.mode,'self');
 assert.equal(saved.purpose,'truck_replenishment');assert.equal(saved.purpose_revision,1);
 assert.deepEqual(saved.before,o.p_items);assert.deepEqual(saved.after,r.p_items);assert.equal(saved.original_snapshot.signature.signed_by,it);
 assert.equal(await originalFingerprint(o.p_request_id),hash);assert.equal(await count('techcheck_transfer_events'),events);
 assert.deepEqual(await reservations(o.p_transfer_id),r.p_items.map(i=>i.equipment_key));assert.deepEqual(t.manifest,r.p_items);
 assert.equal(t.original.event_id,o.p_request_id);assert.equal(t.original.snapshot.signature.name,names[it]);assert.equal(t.corrections.length,1);
 assert.equal(t.corrections[0].correction_id,r.p_request_id);assert.equal(t.can_correct_self,false);assert.equal(t.can_apply_cited,false);
 assert.equal((await db.query('select count(*)::int n from service_truck_units where service_tech_id=$1',[svc])).rows[0].n,1);
 assert.equal((await state(o.p_transfer_id)).service_actor,svc);
 assert.equal(t.purpose,'truck_replenishment');assert.equal(t.purpose_revision,1);
 assert.equal(t.manifest[0].battery_count,null);assert.equal(t.manifest[0].battery_configuration,null);assert.equal(t.manifest[0].required_battery_count,null);
});

test('cited Owner and other verified IT preserve technician attribution and actual acting user separately',async()=>{
 for(const who of [owner,secondIT]){
  const o=await issue(),r=await correction(o,{who,mode:'cited'});await upload(r,who);const saved=await correct(r,who);
  assert.equal(saved.applied_by.id,who);assert.equal(saved.applied_by.name,names[who]);assert.equal(saved.applied_by.role,who===owner?'owner':'it');
  assert.equal(saved.original_technician.id,it);assert.equal(saved.confirmed_by.id,it);assert.equal(saved.confirmed_by.mode,'cited');
  assert.equal(saved.confirmation_recorded_by,who);assert.equal(saved.confirmation.recorded_by,who);
  assert.equal(saved.original_snapshot.signature.name,names[it]);assert.equal(saved.original_snapshot.signature.signed_by,it);
  assert.equal(saved.confirmation.technician_reply,r.p_confirmation.technician_reply);
  assert.ok(Date.parse(saved.created_at)>=Date.parse(saved.confirmed_by.confirmed_at));
 }
});

test('role, ownership, archived account and recipient boundaries reject impersonation',async()=>{
 const o=await issue(),r=await correction(o);await upload(r);
 for(const who of [svc,other,unverified])await assert.rejects(correct(r,who),/Active Owner or verified IT/);
 await assert.rejects(correct(r,owner),/original submitting technician/);
 await assert.rejects(correct({...r,p_confirmation:{...r.p_confirmation,technician_id:owner}}),/original submitting technician/);
 await assert.rejects(correct({...r,p_confirmation:{...r.p_confirmation,technician_confirmed_at:new Date().toISOString()}}),/server time/);
 assert.deepEqual((await context(o.p_transfer_id,other)).transfers,[]);
 await db.query('update profiles set archived_at=now() where user_id=$1',[it]);
 try{await assert.rejects(correct(r),/Active Owner/);}finally{await db.query('update profiles set archived_at=null where user_id=$1',[it]);}
 await db.query('update profiles set active=false where user_id=$1',[it]);
 try{await assert.rejects(correct(r),/Active Owner/);}finally{await db.query('update profiles set active=true where user_id=$1',[it]);}
 await as(null,()=>assert.rejects(db.query('select public.techcheck_transfer_correction_context_v1()'),/Active Owner/));
 await assert.rejects(correct(r,null),/Active Owner/);
 await as(null,()=>assert.rejects(db.query('select public.techcheck_transfer_correction_context_v1()'),/permission denied/),'anon');
});

test('cited confirmation cannot omit reply, trusted reference or actual technician confirmation time',async()=>{
 const o=await issue(),r=await correction(o,{who:owner,mode:'cited'});await upload(r,owner);
 for(const patch of [{technician_reply:''},{evidence_reference:'http://drive.google.com/file/test'},{evidence_reference:'https://drive.google.com.attacker.invalid/file/test'},{evidence_reference:'https://owner@drive.google.com/file/test'},{evidence_reference:'https://example.com/unverified'},{technician_confirmed_at:'tomorrow'},{technician_confirmed_at:'2000-01-01T00:00:00Z'},{technician_confirmed_at:'2099-01-01T00:00:00Z'},{confirmed:false}]){
  await assert.rejects(correct({...r,p_confirmation:{...r.p_confirmation,...patch}},owner));
 }
 assert.equal((await state(o.p_transfer_id)).revision,1);assert.equal((await context(o.p_transfer_id)).transfers[0].corrections.length,0);
});

test('lost response replays exactly one correction, audit and queue; changed or stale retries cannot commit',async()=>{
 const o=await issue(),r=await correction(o);await upload(r);const first=await correct(r),counts=await Promise.all(['techcheck_transfer_corrections','techcheck_transfer_correction_audit','techcheck_transfer_correction_outbox'].map(count));
 const replay=await correct(r);assert.equal(replay.replayed,true);assert.equal(replay.correction_id,first.correction_id);
 assert.deepEqual(await Promise.all(['techcheck_transfer_corrections','techcheck_transfer_correction_audit','techcheck_transfer_correction_outbox'].map(count)),counts);
 await assert.rejects(correct({...r,p_reason:'Different reason using the same request ID'}),/already used/);
 const stale=await correction(o);await upload(stale);await assert.rejects(correct(stale),/Handoff changed/);
 const noOp=await correction(o,{items:r.p_items,revision:2});await upload(noOp);await assert.rejects(correct(noOp),/No changed/);
 await db.exec('update app_private.techcheck_transfer_correction_settings set enabled=false');
 try{assert.equal((await correct(r)).replayed,true);}finally{await db.exec('update app_private.techcheck_transfer_correction_settings set enabled=true');}
});

test('a saved correction cannot be overwritten, deleted, reused as a signed event or expanded with photos',async()=>{
 const o=await issue(),r=await correction(o);await upload(r);await correct(r);
 await assert.rejects(db.query('update app_private.techcheck_transfer_corrections set reason=$1 where id=$2',['rewrite',r.p_request_id]),/immutable/);
 await assert.rejects(db.query('delete from app_private.techcheck_transfer_correction_audit where correction_id=$1',[r.p_request_id]),/immutable/);
 await assert.rejects(db.query(`insert into app_private.techcheck_transfer_events select $1,transfer_id,actor_id,actor_name,kind,request,snapshot,photos,signed_at from app_private.techcheck_transfer_events where id=$2`,[r.p_request_id,o.p_request_id]),/already used by a correction/);
 assert.equal(await as(it,async()=>(await db.query('select app_private.techcheck_transfer_file($1,true) ok',[r.p_photos[0].path])).rows[0].ok),false);
 const extra=r.p_photos[0].path.replace(/[a-f0-9]{64}\.jpg$/,'b'.repeat(64)+'.jpg');
 await as(it,()=>assert.rejects(db.query("insert into storage.objects values('techcheck-transfer-evidence',$1,'{\"mimetype\":\"image/jpeg\",\"size\":12}')",[extra]),/row-level security/));
 await as(it,async()=>{assert.equal((await db.query("update storage.objects set metadata='{}' where name=$1 returning *",[r.p_photos[0].path])).rows.length,0);assert.equal((await db.query('delete from storage.objects where name=$1 returning *',[r.p_photos[0].path])).rows.length,0);});
});

test('exact canonical identity, missing/forged evidence and invalid MIME reject atomically',async()=>{
 const o=await issue(),r=await correction(o),old=await reservations(o.p_transfer_id);await upload(r);
 const bad=structuredClone(r);bad.p_items[0].unit_tag='TEST-WRONG';await assert.rejects(correct(bad),/identity changed/);
 const family=structuredClone(r);family.p_items[0].family='Spotter';await assert.rejects(correct(family),/identity changed/);
 const duplicate=await equipment();await db.query('update equipment_master set unit_tag=$1 where equipment_key=$2',[r.p_items[0].unit_tag,duplicate.equipment_key]);
 await assert.rejects(correct(r),/identity is ambiguous/);await db.query('update equipment_master set unit_tag=$1 where equipment_key=$2',[duplicate.unit_tag,duplicate.equipment_key]);
 await assert.rejects(correct({...r,p_photos:[]}),/matching unit/);
 await assert.rejects(correct({...r,p_photos:[r.p_photos[0],{...r.p_photos[1],equipment_key:o.p_items[0].equipment_key,path:r.p_photos[1].path.replace(/[a-f0-9]{64}\.jpg$/,'b'.repeat(64)+'.jpg')}]}),/exact corrected/);
 await assert.rejects(correct({...r,p_photos:r.p_photos.map(p=>({...p,path:p.path.replace(it,owner)}))}),/evidence identity/);
 await db.query("update storage.objects set metadata='{\"mimetype\":\"image/png\",\"size\":12}' where name=$1",[r.p_photos[0].path]);await assert.rejects(correct(r),/Upload every/);
 assert.equal((await state(o.p_transfer_id)).revision,1);assert.deepEqual(await reservations(o.p_transfer_id),old);
});

test('intersecting reservations and legacy custody holds prevent reassignment, preserving both handoffs',async()=>{
 const a=await issue(),b=await issue(),r=await correction(a,{items:b.p_items});await upload(r);
 await assert.rejects(correct(r),/another unresolved handoff/);assert.deepEqual(await reservations(a.p_transfer_id),a.p_items.map(i=>i.equipment_key));assert.deepEqual(await reservations(b.p_transfer_id),b.p_items.map(i=>i.equipment_key));
 const held=await equipment(),rh=await correction(a,{items:[held]});await upload(rh);
 await db.query("insert into unit_returns values($1,$2,$3,'pending',$4)",[randomUUID(),held.family,held.unit_tag,svc]);
 await assert.rejects(correct(rh),/Unresolved equipment return/);assert.equal((await state(a.p_transfer_id)).revision,1);
});

test('inconsistent old reservations fail closed instead of silently repairing custody',async()=>{
 const o=await issue(),r=await correction(o);await upload(r);await db.query('delete from app_private.techcheck_transfer_reservations where transfer_id=$1',[o.p_transfer_id]);
 await assert.rejects(correct(r),/reservations changed/);assert.equal((await state(o.p_transfer_id)).revision,1);
});

test('receipt ordering: correction rejects stale acceptance; current actual equipment remains Service-controlled',async()=>{
 const o=await issue(),r=await correction(o),oldReceipt=receipt(o);await upload(oldReceipt,svc);await upload(r);await correct(r);
 await assert.rejects(submit(oldReceipt,svc),/Handoff changed/);
 const freshReceipt=receipt(o,r.p_items,2);await upload(freshReceipt,svc);const accepted=await submit(freshReceipt,svc);
 assert.equal(accepted.state,'accepted');assert.equal(accepted.revision,3);
 const after=await correction(o,{revision:3});await upload(after);await assert.rejects(correct(after),/receipt or custody change/);
 assert.equal((await context(o.p_transfer_id)).transfers[0].can_correct_self,false);
});

test('acceptance or discrepancy arriving first blocks subsequent correction without replacing signed receipt',async()=>{
 for(const discrepancy of [false,true]){
  const o=await issue(),rec=receipt(o);if(discrepancy)rec.p_items=rec.p_items.map(i=>({...i,sims:['0099']}));await upload(rec,svc);await submit(rec,svc);
  const r=await correction(o,{revision:2});await upload(r);await assert.rejects(correct(r),/receipt or custody change/);
  assert.equal((await state(o.p_transfer_id)).state,discrepancy?'discrepancy':'accepted');
 }
});

test('empty SIMs remain valid; later revisions retain each before/after and original signature',async()=>{
 const o=await issue(),items=structuredClone(o.p_items);items[0].parts=[{name:'Synthetic cable',quantity:1}];const r=await correction(o,{items});await upload(r);await correct(r);
 const nextItems=structuredClone(items);nextItems[0].parts[0].quantity=2;const next=await correction(o,{items:nextItems,revision:2});await upload(next);await correct(next);
 const t=(await context(o.p_transfer_id,svc)).transfers[0];assert.equal(t.revision,3);assert.equal(t.corrections.length,2);assert.deepEqual(t.manifest[0].sims,[]);
 assert.deepEqual(t.corrections[1].before,t.corrections[0].after);assert.equal(t.original.snapshot.signature.name,names[it]);
});

test('purpose-aware correction retains all approved installation configurations and rejects invalid packages',async()=>{
 for(const family of Object.keys(plans)){
  const o=await issue([await equipment(family,'installation')],it,{purpose:'installation'});
  const replacement=await equipment(family,'installation'),r=await correction(o,{items:[replacement]}),original=await originalFingerprint(o.p_request_id);
  await upload(r);
  const noPlan=structuredClone(r);delete noPlan.p_items[0].battery_configuration;
  await assert.rejects(correct(noPlan),/approved installation battery configuration/);
  const badCount=structuredClone(r);badCount.p_items[0].battery_count=family==='Recon 2'?0:replacement.battery_count+1;
  await assert.rejects(correct(badCount),/battery quantity/);
  const saved=await correct(r),t=await state(o.p_transfer_id);
  assert.equal(saved.purpose,'installation');assert.equal(saved.purpose_revision,1);
  assert.deepEqual(saved.before,o.p_items);assert.deepEqual(saved.after,r.p_items);
  assert.deepEqual(t.manifest,r.p_items);assert.equal(t.purpose,'installation');assert.equal(t.purpose_revision,1);
  assert.equal(await originalFingerprint(o.p_request_id),original);
  const audit=(await db.query('select provenance from app_private.techcheck_transfer_correction_audit where correction_id=$1',[r.p_request_id])).rows[0].provenance;
  assert.equal(audit.purpose,'installation');assert.equal(audit.purpose_revision,1);
 }
 const o=await issue(),r=await correction(o);await upload(r);
 const invented=structuredClone(r);invented.p_items[0].battery_count=0;
 await assert.rejects(correct(invented),/does not include a battery quantity/);
 const plan=structuredClone(r);plan.p_items[0].battery_configuration='agm_4x_12v_110ah';
 await assert.rejects(correct(plan),/does not include a battery quantity/);
 assert.equal((await state(o.p_transfer_id)).revision,1);
});

test('legacy purpose classification permits a pending correction without changing its purpose revision or signed original',async()=>{
 const o=await issue(undefined,it,{legacy:true}),r=await correction(o),hash=await originalFingerprint(o.p_request_id);
 await upload(r);let t=(await context(o.p_transfer_id)).transfers[0];
 assert.equal(t.purpose,null);assert.equal(t.can_correct_self,false);assert.match(t.correction_block_reason,/confirm the handoff purpose/);
 await assert.rejects(correct(r),/confirm the handoff purpose/);
 const a={p_request_id:randomUUID(),p_transfer_id:o.p_transfer_id,p_expected_revision:1,p_purpose:'truck_replenishment',
  p_items:o.p_items.map(i=>({...i,battery_count:null,battery_configuration:null,required_battery_count:null})),p_reason:'Owner verified the original handoff replenishes truck spares.'};
 await classify(a,owner);t=(await context(o.p_transfer_id)).transfers[0];
 assert.equal(t.revision,2);assert.equal(t.purpose_revision,2);assert.equal(t.can_correct_self,true);
 await assert.rejects(correct(r),/Handoff changed/);
 const saved=await correct({...r,p_expected_revision:2});
 assert.equal(saved.revision,3);assert.equal(saved.purpose,'truck_replenishment');assert.equal(saved.purpose_revision,2);
 assert.equal(saved.original_snapshot.purpose,undefined);assert.equal(await originalFingerprint(o.p_request_id),hash);
 assert.equal((await state(o.p_transfer_id)).purpose_revision,2);
 assert.equal((await db.query("select count(*)::int n from app_private.techcheck_transfer_events where transfer_id=$1 and kind='receipt'",[o.p_transfer_id])).rows[0].n,0);
});

test('four historical discrepancy receipts block correction at revision five and remain blocked after purpose classification',async()=>{
 const o=await issue(undefined,it,{legacy:true});
 for(let revision=1;revision<=4;revision++){
  const rec=receipt(o,o.p_items.map(i=>({...i,family:'Solar spotter',battery_count:revision})),revision);
  await upload(rec,svc);assert.equal((await legacySubmit(rec,svc)).state,'discrepancy');
 }
 const events=async()=> (await db.query('select id,actor_id,kind,request,snapshot,photos,signed_at from app_private.techcheck_transfer_events where transfer_id=$1 order by signed_at,id',[o.p_transfer_id])).rows;
 const originalEvents=await events(),r=await correction(o,{revision:5});await upload(r);
 assert.equal((await state(o.p_transfer_id)).revision,5);assert.equal(originalEvents.filter(e=>e.kind==='receipt').length,4);
 assert.ok(originalEvents.filter(e=>e.kind==='receipt').every(e=>e.actor_id===svc));
 await assert.rejects(correct(r),/receipt or custody change/);
 const a={p_request_id:randomUUID(),p_transfer_id:o.p_transfer_id,p_expected_revision:5,p_purpose:'truck_replenishment',
  p_items:o.p_items.map(i=>({...i,battery_count:null,battery_configuration:null,required_battery_count:null})),p_reason:'Synthetic Owner classifies an unresolved historical handoff.'};
 await classify(a,owner);const t=(await context(o.p_transfer_id)).transfers[0];
 assert.equal(t.state,'awaiting_service');assert.equal(t.purpose_revision,6);assert.equal(t.can_correct_self,false);assert.equal(t.can_apply_cited,false);
 assert.match(t.correction_block_reason,/receipt or custody change/);
 await assert.rejects(correct({...r,p_expected_revision:6}),/receipt or custody change/);
 assert.deepEqual((await events()).filter(e=>originalEvents.some(original=>original.id===e.id)),originalEvents);
 assert.equal((await state(o.p_transfer_id)).revision,6);assert.equal(t.corrections.length,0);
});

test('removal-only correction needs one retained equipment photo pair and releases only the removed reservation',async()=>{
 const units=[await equipment(),await equipment(),await equipment()],o=await issue(units),keep=[units[0],units[1]],r=await correction(o,{items:keep});
 r.p_photos=photos([keep[1]],r.p_request_id,it,true);await upload(r);await correct(r);
 assert.deepEqual(await reservations(o.p_transfer_id),keep.map(i=>i.equipment_key).sort());
 assert.equal((await state(o.p_transfer_id)).state,'awaiting_service');
});

test('named Service recipient reads correction evidence but unrelated technicians cannot',async()=>{
 const o=await issue(),r=await correction(o);await upload(r);await correct(r);const path=r.p_photos[0].path;
 for(const who of [it,owner,svc])assert.equal(await as(who,async()=>(await db.query('select app_private.techcheck_transfer_file($1,false) ok',[path])).rows[0].ok),true);
 assert.equal(await as(other,async()=>(await db.query('select app_private.techcheck_transfer_file($1,false) ok',[path])).rows[0].ok),false);
});

test('delivery waits for the original verified package, leases one job and never mutates original archive',async()=>{
 const o=await issue(),r=await correction(o);await upload(r);await correct(r);
 assert.equal(await queue({p_action:'claim',p_id:r.p_request_id}),null);
 const manifest={complete:true,folder:{id:'synthetic-original-folder',done:true},summary_pdf_v1:{id:'synthetic-original-pdf',done:true}};
 await db.query('update app_private.techcheck_transfer_outbox set drive_manifest=$1 where event_id=$2',[manifest,o.p_request_id]);
 const original=await originalFingerprint(o.p_request_id);
 assert.equal(await queue({p_action:'claim',p_id:r.p_request_id,p_actor:svc}),null);
 const job=await queue({p_action:'claim',p_id:r.p_request_id,p_actor:owner});assert.equal(job.id,r.p_request_id);assert.equal(job.original_event_id,o.p_request_id);assert.deepEqual(job.original_drive_manifest,manifest);assert.equal(job.actor_id,it);
 assert.equal(await queue({p_action:'claim',p_id:r.p_request_id}),null);
 await assert.rejects(queue({p_action:'finish',p_id:r.p_request_id,p_lease:randomUUID(),p_data:{status:'sent'}}),/lease expired/);
 await assert.rejects(queue({p_action:'finish',p_id:r.p_request_id,p_lease:job.lease_token,p_data:{status:'sent'}}),/archive and email/);
 const correctionArchive={complete:true,folder:{id:'synthetic-correction-folder',done:true},summary_pdf_v1:{id:'synthetic-correction-pdf',done:true}};
 await queue({p_action:'checkpoint',p_id:r.p_request_id,p_lease:job.lease_token,p_data:{drive_manifest:correctionArchive,email_state:'sent',email_id:'synthetic-email-id'}});
 await assert.rejects(queue({p_action:'checkpoint',p_id:r.p_request_id,p_lease:job.lease_token,p_data:{email_state:'sending'}}),/Confirmed email/);
 await queue({p_action:'finish',p_id:r.p_request_id,p_lease:job.lease_token,p_data:{status:'sent'}});
 assert.equal(await originalFingerprint(o.p_request_id),original);
 const t=(await context(o.p_transfer_id)).transfers[0];assert.match(t.original.report_url,/synthetic-original-pdf/);assert.match(t.corrections[0].report_url,/synthetic-correction-pdf/);assert.equal(t.corrections[0].delivery,'sent');
 await assert.rejects(call('techcheck_correction_delivery_v1',{p_action:'claim'},owner),/permission denied/);
});

test('candidate contains no equipment-master, truck-stock or acceptance writes and public functions are invokers',async()=>{
 const sql=await readFile(new URL('../../database-maintenance/techcheck-handoff-corrections-v1.sql',import.meta.url),'utf8');
 assert.doesNotMatch(sql,/(?:update|insert into|delete from)\s+public\.(?:equipment_master|service_truck_units|unit_registry|unit_returns|prep_items|prep_tickets)/i);
 const publicFns=(await db.query("select proname,prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('techcheck_transfer_correction_context_v1','submit_techcheck_transfer_correction_v1','techcheck_correction_delivery_v1')")).rows;
 assert.equal(publicFns.length,3);assert.ok(publicFns.every(f=>f.prosecdef===false));
 const privateFns=(await db.query(`select p.proname,p.proconfig,coalesce(p.proacl::text,'') acl,
  has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') client_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') server_execute
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.prosecdef
   and p.proname in ('techcheck_correction_ready_v1','techcheck_correction_event_request_guard_v1','techcheck_transfer_file',
    'techcheck_transfer_correction_context_v1','submit_techcheck_transfer_correction_v1','techcheck_correction_delivery_v1')`)).rows;
 assert.equal(privateFns.length,6);
 for(const f of privateFns){
  assert.ok(f.proconfig.includes('search_path=""'),f.proname+' has an empty fixed search_path');
  assert.equal(f.anon_execute,false,f.proname+' denies anon/PUBLIC');assert.ok(f.acl,f.proname+' has explicit ACL');
  assert.equal(f.client_execute,['techcheck_transfer_file','techcheck_transfer_correction_context_v1','submit_techcheck_transfer_correction_v1'].includes(f.proname),f.proname+' has narrow client EXECUTE');
  assert.equal(f.server_execute,f.proname==='techcheck_correction_delivery_v1',f.proname+' has narrow server EXECUTE');
 }
});

test('a single evidence image cannot be bound to different corrected units',async()=>{
 const o=await issue(),r=await correction(o,{items:[await equipment(),await equipment()]});
 const same=r.p_photos[0].path;r.p_photos=r.p_photos.map(p=>({...p,path:same}));await upload(r);
 await assert.rejects(correct(r),/cannot identify more than one/);assert.equal((await state(o.p_transfer_id)).revision,1);
});

import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const it='00000000-0000-4000-8000-000000000001',svc='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003',unverified='00000000-0000-4000-8000-000000000004';
const owner='00000000-0000-4000-8000-000000000005';
let db,contract;
before(async()=>{
 db=new PGlite();contract=JSON.parse(await readFile(new URL('../../transfers/checklist-contract.json',import.meta.url),'utf8'));
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema app_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('role',current_setting('test.jwt_role',true))$$;
 create table prep_tickets(id uuid primary key,status text,is_test boolean default false);
 create table prep_items(id uuid primary key,prep_ticket_id uuid,equipment_type text,unit_tag text);
 create table service_truck_units(service_tech_id uuid,equipment_type text,unit_tag text,status text);
 create table unit_returns(id uuid,equipment_type text,unit_tag text,status text,service_tech_id uuid);
 create table unit_registry(equipment_type text,unit_tag text,lifecycle_status text,current_holder_id uuid);
 create table app_private.service_daily_reports(id uuid,service_tech_id uuid,check_date date,submitted_at timestamptz default now(),snapshot jsonb);
 create table profiles(user_id uuid primary key,role text,active boolean,archived_at timestamptz,full_name text,username text);
 create table equipment_master(equipment_key text primary key,unit_tag text,source_family text,canonical_family text,workflow_type text,source_label text,tracker_state text,updated_at timestamptz default now());
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text,metadata jsonb);
 alter table storage.objects enable row level security;
 create function app_private.cos_verified_fleet_actor(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where user_id=p_id and active and archived_at is null and (role='owner' or role='it' and user_id='${it}'))$$;
 insert into profiles values('${it}','it',true,null,'Synthetic IT','it'),('${svc}','service',true,null,'Synthetic Service','service'),('${other}','service',true,null,'Other Service','other'),('${unverified}','it',true,null,'Unverified IT','unknown');
 grant usage on schema auth,app_private,storage to authenticated;grant execute on function auth.uid() to authenticated;grant select,insert,update,delete on storage.objects to authenticated;
 `);
 await db.query("insert into profiles values($1,'owner',true,null,'Synthetic Owner','owner')",[owner]);
 for(const name of ['techcheck-named-handoffs-v1.sql','techcheck-transfer-rollout-v2.sql','techcheck-transfer-integration-v3.sql','techcheck-transfer-purpose-v2.sql','techcheck-owner-handoff-resolution-v1.sql'])await db.exec(await readFile(new URL('../../database-maintenance/'+name,import.meta.url),'utf8'));
 await db.exec('update app_private.techcheck_transfer_settings set enabled=true,reports_ready=true,receipt_link_ready=true,custody_ready=true');
});
after(async()=>db?.close());
async function as(who,fn){await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[who]);await db.exec('set role authenticated');try{return await fn();}finally{await db.exec('reset role');}}
const submit=(r,who=it)=>as(who,async()=>(await db.query(`select public.submit_techcheck_transfer_v2(${Object.keys(r).map((k,n)=>k+'=> $'+(n+1)).join(',')}) as result`,Object.values(r))).rows[0].result);
const context=who=>as(who,async()=>(await db.query('select public.techcheck_transfer_context_v1() as result')).rows[0].result);
const total=async table=>(await db.query('select count(*)::int n from app_private.'+table)).rows[0].n;
async function baseRequest(){
 const id=randomUUID(),key='Sniper:'+id,tag='S-'+id.slice(0,8);
 await db.query("insert into equipment_master(equipment_key,unit_tag,source_family,canonical_family,workflow_type,source_label,tracker_state) values($1,$2,'Sniper','Sniper','Sniper',$3,'shop')",[key,tag,'Sniper '+tag]);
 const checks=Object.fromEntries(contract.families.Sniper.bool_fields.map(field=>[field,true]));
 return {p_request_id:id,p_transfer_id:id,p_kind:'checkout',p_expected_revision:0,p_service_actor:svc,p_items:[{equipment_key:key,family:'Sniper',unit_tag:tag,sims:['00123456789012345670'],battery_count:2,parts:[{name:'SD card',quantity:1}]}],p_checks:{[key]:checks},p_signature:{method:'typed',name:'Synthetic IT',confirmed:true},p_photos:[{equipment_key:key,kind:'unit',path:it+'/'+id+'/'+'a'.repeat(64)+'.jpg'}],p_notes:'Synthetic only'};
}
async function seed(r){for(const p of r.p_photos)await db.query("insert into storage.objects values('techcheck-transfer-evidence',$1,'{\"mimetype\":\"image/jpeg\",\"size\":1234}')",[p.path]);}

const plans={Sniper:['sniper_2x_12v_35ah',2],Ranger:['lifepo4_1x',1],Spotter:['none',0],'Solar Spotter':['agm_4x_12v_110ah',4],Helios:['helios_battery_box',1],'Recon 2':['recon_configured',3]};
async function request({family='Sniper',purpose='truck_replenishment',legacy=false}={}){
 const r=await baseRequest(),item=r.p_items[0];item.family=family;await db.query('update equipment_master set source_family=$2,canonical_family=$2,workflow_type=$2 where equipment_key=$1',[item.equipment_key,family]);
 const fields=contract.families[family].bool_fields.filter(f=>legacy||purpose==='installation'||!['delivery_batteries_charged_ok','helios_battery_box_installed_ok','helios_battery_120v_charged_ok'].includes(f));
 if(!legacy&&purpose==='installation')fields.push(...['delivery_monitoring_ok','delivery_ticket_count_ok','delivery_customer_email_app_ok'].filter(f=>family!=='Helios'||f!=='delivery_ticket_count_ok'));
 r.p_checks={[item.equipment_key]:Object.fromEntries(fields.map(f=>[f,true]))};
 item.battery_count=legacy?Math.max(1,contract.families[family].minimum_batteries):purpose==='truck_replenishment'?null:plans[family][1];
 if(!legacy){item.battery_configuration=purpose==='truck_replenishment'?null:plans[family][0];r.p_purpose=purpose;}return r;
}
const rpc=(name,r,who=it)=>as(who,async()=>(await db.query(`select ${name}(${Object.keys(r).map((k,n)=>k+'=> $'+(n+1)).join(',')}) result`,Object.values(r))).rows[0].result);
const classify=(r,who=it)=>rpc('public.classify_techcheck_transfer_purpose_v1',r,who);
const ownerResolve=(r,who=owner)=>rpc('public.owner_resolve_techcheck_transfer_v1',r,who);
async function legacy(r,who=it){await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[who]);return(await db.query(`select app_private.submit_techcheck_transfer_pre_purpose_v1(${Object.keys(r).map((k,n)=>k+'=> $'+(n+1)).join(',')}) result`,Object.values(r))).rows[0].result;}
const row=async id=>(await db.query('select * from app_private.techcheck_transfers where id=$1',[id])).rows[0];
const events=async id=>(await db.query('select id,actor_id,kind,request,snapshot,photos from app_private.techcheck_transfer_events where transfer_id=$1 order by signed_at,id',[id])).rows;
const count=async id=>(await db.query('select count(*)::int n from app_private.techcheck_transfer_outbox where transfer_id=$1',[id])).rows[0].n;
async function issue(options){const r=await request(options);await seed(r);await submit(r);return r;}
function receipt(r,{photos=false,revision=1}={}){const id=randomUUID();return {...structuredClone(r),p_request_id:id,p_kind:'receipt',p_expected_revision:revision,p_checks:{},p_signature:{method:'typed',name:'Synthetic Service',confirmed:true},p_photos:photos?r.p_items.map(i=>({equipment_key:i.equipment_key,kind:'unit',path:svc+'/'+id+'/'+'b'.repeat(64)+'.jpg'})):[]};}
async function legacyIssue(){const r=await request({family:'Solar Spotter',legacy:true});await seed(r);await legacy(r);return r;}
const purposeArgs=(r,revision,purpose='truck_replenishment')=>({p_request_id:randomUUID(),p_transfer_id:r.p_transfer_id,p_expected_revision:revision,p_purpose:purpose,p_items:r.p_items.map(i=>({...i,battery_count:purpose==='truck_replenishment'?null:4,battery_configuration:purpose==='truck_replenishment'?null:'agm_4x_12v_110ah'})),p_reason:'Owner verified this equipment replenishes the technician truck.'});

test('replenishment checkout records purpose and no battery quantity or fabricated check attestation',async()=>{
 for(const family of ['Sniper','Helios','Solar Spotter']){const r=await issue({family}),t=await row(r.p_transfer_id),saved=(await events(t.id))[0];assert.equal(t.purpose,'truck_replenishment');assert.equal(t.purpose_revision,1);assert.equal(t.manifest[0].battery_count,null);assert.equal(t.manifest[0].battery_configuration,null);assert.equal(saved.snapshot.purpose,'truck_replenishment');assert.ok(!('delivery_batteries_charged_ok' in saved.snapshot.checks[t.manifest[0].equipment_key]));}
});
test('matched replenishment receipt uses original IT photo and actual Service signature; family casing is no discrepancy',async()=>{
 const r=await issue({family:'Solar Spotter'}),s=receipt(r);s.p_items[0].family='Solar spotter';const result=await submit(s,svc);
 assert.equal(result.state,'accepted');assert.deepEqual(result.differences,[]);assert.equal(result.signature.signed_by,svc);assert.deepEqual((await events(r.p_transfer_id)).find(e=>e.id===s.p_request_id).photos,[]);assert.equal(result.original_evidence[0].source_actor_id,it);assert.equal(result.original_evidence[0].source_event_id,r.p_request_id);assert.equal(result.original_evidence[0].path,r.p_photos[0].path);assert.equal(result.actual[0].family,'Solar spotter');assert.equal((await context(svc)).transfers.find(t=>t.id===r.p_transfer_id).receipt_required,false);
 const n=await count(r.p_transfer_id);assert.equal((await submit(s,svc)).replayed,true);assert.equal(await count(r.p_transfer_id),n);await assert.rejects(submit(receipt(r,{revision:2}),svc),/already saved/);await assert.rejects(submit({...s,p_notes:'Changed after signing'},svc),/already used/);assert.equal(await count(r.p_transfer_id),2);
});
test('real SIM discrepancy requires current photo and cannot create repeated receipts with fresh UUIDs',async()=>{
 const r=await issue(),s=receipt(r);s.p_items[0].sims=['0099'];await assert.rejects(submit(s,svc),/Photograph/);assert.equal((await row(r.p_transfer_id)).revision,1);s.p_photos=[{equipment_key:r.p_items[0].equipment_key,kind:'unit',path:svc+'/'+s.p_request_id+'/'+'b'.repeat(64)+'.jpg'}];await seed(s);const result=await submit(s,svc);assert.equal(result.state,'discrepancy');assert.deepEqual(result.differences.map(d=>d.field),['sims']);assert.deepEqual(result.original_evidence,[]);await assert.rejects(submit(receipt(r,{revision:2}),svc),/already saved/);const old={...s,p_request_id:randomUUID(),p_expected_revision:2};delete old.p_purpose;await assert.rejects(rpc('public.submit_techcheck_transfer_v1',old,svc),/already be saved/);assert.equal(await count(r.p_transfer_id),2);
});
test('missing unit stays a discrepancy while unchanged units reuse their original photos',async()=>{
 const a=await request(),b=await request({family:'Ranger'});b.p_items[0].sims=['0099'];a.p_items.push(b.p_items[0]);Object.assign(a.p_checks,b.p_checks);a.p_photos.push({...b.p_photos[0],path:b.p_photos[0].path.replace(b.p_request_id,a.p_request_id)});await seed(a);await submit(a);const s=receipt(a);s.p_items=s.p_items.slice(0,1);const result=await submit(s,svc);assert.equal(result.state,'discrepancy');assert.equal(result.differences.length,1);assert.equal(result.differences[0].actual,'Missing');assert.equal(result.original_evidence.length,1);
});
test('installation validates six family configurations and preserves a real battery discrepancy',async()=>{
 for(const family of Object.keys(plans)){const r=await request({family,purpose:'installation'});await seed(r);const bad=structuredClone(r);bad.p_items[0].battery_count=family==='Recon 2'?0:r.p_items[0].battery_count+1;await assert.rejects(submit(bad),/battery quantity/);assert.equal((await submit(r)).state,'awaiting_service');}
 const r=await issue({family:'Solar Spotter',purpose:'installation'}),s=receipt(r,{photos:true});s.p_items[0].family='solar spotter';s.p_items[0].battery_count=1;await seed(s);const result=await submit(s,svc);assert.equal(result.state,'discrepancy');assert.deepEqual(result.differences.map(d=>d.field),['battery_count']);assert.equal(result.differences[0].expected,4);assert.equal(result.differences[0].actual,1);
 const alt=await request({family:'Solar Spotter',purpose:'installation'});alt.p_items[0].battery_configuration='single_12v_350ah';alt.p_items[0].battery_count=1;await seed(alt);await assert.rejects(submit(alt),/approved installation battery configuration/);
});
test('installation readiness remains mandatory and spare hardware safety is not bypassed',async()=>{
 const install=await request({purpose:'installation'});await seed(install);delete install.p_checks[install.p_items[0].equipment_key].delivery_monitoring_ok;await assert.rejects(submit(install),/installation readiness/);
 const spare=await request();await seed(spare);delete spare.p_checks[spare.p_items[0].equipment_key].safe_ok;await assert.rejects(submit(spare),/required IT/);
 const wrong=await request();wrong.p_items[0].battery_count=0;await assert.rejects(submit(wrong),/does not include/);
});
test('installation receipts preserve wrong-family and unknown-package evidence as discrepancies',async()=>{
 const cases=[
  {family:'Ranger',unit_tag:'WRONG-RANGER',battery_configuration:'lifepo4_1x',battery_count:1},
  {family:'Unlisted field unit',unit_tag:'UNKNOWN-UNIT',battery_configuration:'unidentified package',battery_count:0},
  {battery_configuration:null,battery_count:2}
 ];
 for(const actual of cases){
  const r=await issue({purpose:'installation'}),s=receipt(r,{photos:true});Object.assign(s.p_items[0],actual);await seed(s);
  const result=await submit(s,svc);assert.equal(result.state,'discrepancy');assert.ok(result.differences.some(d=>d.field==='battery_configuration'));
  for(const [field,value]of Object.entries(actual))assert.deepEqual(result.actual[0][field],value);
  assert.equal(result.expected[0].family,'Sniper');assert.equal(result.expected[0].battery_configuration,'sniper_2x_12v_35ah');
  assert.deepEqual(result.original_evidence,[]);assert.equal(await count(r.p_transfer_id),2);assert.equal((await submit(s,svc)).replayed,true);
  await assert.rejects(submit({...s,p_request_id:randomUUID(),p_expected_revision:2},svc),/already saved/);
 }
});
test('four legacy receipts remain immutable; Owner purpose audit permits exactly one fresh Service confirmation',async()=>{
 const r=await legacyIssue();for(let n=1;n<=4;n++){const s=receipt(r,{photos:true,revision:n});s.p_items[0].family='Solar spotter';s.p_items[0].battery_count=n===4?4:0;await seed(s);assert.equal((await legacy(s,svc)).state,'discrepancy');}
 const original=await events(r.p_transfer_id),a=purposeArgs(r,5),legacyView=(await context(svc)).transfers.find(t=>t.id===r.p_transfer_id);assert.equal(legacyView.purpose,null);assert.equal(legacyView.receipt_required,false);await assert.rejects(classify(a,svc),/Owner or original/);
 const classified=await classify(a,owner);assert.equal(classified.state,'awaiting_service');assert.equal(classified.revision,6);assert.equal(classified.purpose_revision,6);assert.equal(classified.applied_by.id,owner);assert.equal(classified.applied_by.role,'owner');assert.ok(!('signature' in classified));assert.equal((await classify(a,owner)).replayed,true);assert.equal(await count(r.p_transfer_id),6);assert.deepEqual((await events(r.p_transfer_id)).filter(e=>original.some(o=>o.id===e.id)),original);
 const t=(await context(svc)).transfers.find(t=>t.id===r.p_transfer_id);assert.equal(t.receipt_required,true);assert.equal(t.can_classify_purpose,false);const fresh=receipt({...r,p_purpose:'truck_replenishment',p_items:a.p_items},{revision:6});assert.equal((await submit(fresh,svc)).state,'accepted');assert.equal(await count(r.p_transfer_id),7);await assert.rejects(classify({...a,p_request_id:randomUUID(),p_expected_revision:7},owner),/already has a recorded purpose/);await assert.rejects(submit(receipt({...r,p_purpose:'truck_replenishment',p_items:a.p_items},{revision:7}),svc),/already saved/);assert.deepEqual((await events(r.p_transfer_id)).filter(e=>original.some(o=>o.id===e.id)),original);
});
test('Owner can complete the four-receipt replenishment case without replacing signatures or sending another handoff email',async()=>{
 const r=await legacyIssue(),original=[];
 for(let n=1;n<=4;n++){const s=receipt(r,{photos:true,revision:n});s.p_items[0].family='Solar spotter';s.p_items[0].battery_count=n===4?4:0;await seed(s);await legacy(s,svc);}
 original.push(...await events(r.p_transfer_id));const latest=original.filter(e=>e.kind==='receipt').at(-1),beforeOutbox=await count(r.p_transfer_id);
 const args={p_request_id:randomUUID(),p_transfer_id:r.p_transfer_id,p_expected_revision:5,p_purpose:'truck_replenishment',p_receipt_event_id:latest.id,p_identity_confirmed:true,p_reason:'Owner reviewed the saved Service photo and confirms this is the exact replenishment unit.'};
 await assert.rejects(ownerResolve({...args,p_identity_confirmed:false}),/confirm the exact unit identity/);
 await assert.rejects(ownerResolve(args,it),/Owner account required/);
 const result=await ownerResolve(args);assert.equal(result.state,'accepted');assert.equal(result.revision,6);assert.equal(result.purpose,'truck_replenishment');assert.equal(result.purpose_revision,6);assert.equal(result.owner_resolution.applied_by,owner);assert.equal(result.selected_receipt_event_id,latest.id);assert.equal(result.actual[0].battery_count,null);assert.equal(result.actual[0].family,'Solar Spotter');
 assert.equal(await count(r.p_transfer_id),beforeOutbox,'Owner resolution must not queue another transfer email');
 const saved=await events(r.p_transfer_id);assert.deepEqual(saved.filter(e=>original.some(o=>o.id===e.id)),original);assert.equal(saved.at(-1).kind,'owner_resolution');assert.equal(saved.at(-1).actor_id,owner);assert.equal((await ownerResolve(args)).replayed,true);
 const view=(await context(svc)).transfers.find(t=>t.id===r.p_transfer_id);assert.equal(view.state,'accepted');assert.equal(view.receipt_required,false);
});

test('legacy classification cannot change unit identity, SIMs, or create an installation without its readiness checks',async()=>{
 const r=await legacyIssue(),a=purposeArgs(r,1),wrong=structuredClone(a);wrong.p_items[0].unit_tag='WRONG';await assert.rejects(classify(wrong),/cannot change/);const sim=structuredClone(a);sim.p_items[0].sims=[];await assert.rejects(classify(sim),/cannot change/);await assert.rejects(classify({...a,p_expected_revision:0}),/changed/);await assert.rejects(classify(purposeArgs(r,1,'installation')),/lacks installation readiness/);assert.equal((await row(r.p_transfer_id)).purpose,null);
 const s=receipt(r,{photos:true});await seed(s);await legacy(s,svc);await assert.rejects(classify({...a,p_expected_revision:2}),/unaccepted/);
});
test('frozen legacy request remains replayable with original payload after purpose classification',async()=>{
 const r=await legacyIssue();await classify(purposeArgs(r,1));const n=await count(r.p_transfer_id);assert.equal((await rpc('public.submit_techcheck_transfer_v1',r)).replayed,true);assert.equal(await count(r.p_transfer_id),n);await assert.rejects(rpc('public.submit_techcheck_transfer_v1',{...r,p_notes:'Altered'}),/already used/);await assert.rejects(rpc('public.submit_techcheck_transfer_v1',await request({legacy:true})),/choose Truck replenishment/);
});
test('wrong actor, purpose forgery, stale revision and fabricated photo are rejected atomically',async()=>{
 const r=await issue(),s=receipt(r);await assert.rejects(submit({...s,p_signature:{...s.p_signature,name:'Other Service'}},other),/unavailable/);await assert.rejects(submit({...s,p_purpose:'installation',p_items:r.p_items.map(i=>({...i,battery_count:2,battery_configuration:'sniper_2x_12v_35ah'}))},svc),/saved handoff purpose/);await assert.rejects(submit({...s,p_expected_revision:0},svc),/changed/);await assert.rejects(submit({...s,p_signature:{...s.p_signature,name:'Synthetic IT'}},svc),/own technician/);await assert.rejects(submit({...s,p_photos:r.p_photos},svc),/Invalid evidence identity/);assert.equal(await count(r.p_transfer_id),1);assert.equal((await row(r.p_transfer_id)).state,'awaiting_service');
});
test('original-photo reuse requires an existing readable JPEG',async()=>{
 const r=await issue();await db.query('delete from storage.objects where name=$1',[r.p_photos[0].path]);await assert.rejects(submit(receipt(r),svc),/original equipment photo is unavailable/);assert.equal(await count(r.p_transfer_id),1);
});
test('spare return omits battery check and remains held for inventory review',async()=>{
 const r=await issue();await submit(receipt(r),svc);const id=randomUUID(),back={...r,p_request_id:id,p_kind:'return',p_expected_revision:2,p_checks:{[r.p_items[0].equipment_key]:Object.fromEntries(['physical_condition_ok','accessories_ok','sd_cards_ok','electronics_ok','power_functions_ok'].map(f=>[f,true]))},p_photos:r.p_items.map(i=>({equipment_key:i.equipment_key,kind:'unit',path:it+'/'+id+'/'+'c'.repeat(64)+'.jpg'}))};await seed(back);assert.equal((await submit(back)).state,'returned_review');assert.equal((await db.query('select count(*)::int n from app_private.techcheck_transfer_reservations where transfer_id=$1',[r.p_transfer_id])).rows[0].n,1);
});
test('signed events are immutable; private historical submit cannot be called by technicians; no inventory writes',async()=>{
 const r=await issue();await assert.rejects(db.query('update app_private.techcheck_transfer_events set actor_name=$1 where id=$2',['Someone else',r.p_request_id]),/immutable/);await assert.rejects(db.query('delete from app_private.techcheck_transfer_events where id=$1',[r.p_request_id]),/immutable/);await as(svc,()=>assert.rejects(db.query('select * from app_private.techcheck_transfer_events'),/permission denied/));await as(svc,()=>assert.rejects(db.query('select app_private.submit_techcheck_transfer_pre_purpose_v1(null,null,null,null,null,null,null,null,null,null)'),/permission denied/));const source=await readFile(new URL('../../database-maintenance/techcheck-transfer-purpose-v2.sql',import.meta.url),'utf8');assert.doesNotMatch(source,/(?:update|insert into|delete from)\s+public\.(?:equipment_master|camera_devices|service_truck|morning_checks|unit_registry|unit_returns|prep_items)/i);assert.equal((await db.query('select count(*)::int n from public.service_truck_units')).rows[0].n,0);
});

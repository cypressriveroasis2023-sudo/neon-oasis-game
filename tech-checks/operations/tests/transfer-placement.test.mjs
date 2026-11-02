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
 await db.exec(await readFile(new URL('../transfer-placement-review/install.sql',import.meta.url),'utf8'));
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

import {projectTransferPlacement,publishTransferPlacement} from '../transfer-placement-review/projectPlacement.mjs';
let generation=0;
function source(r,{placement='SHOP',bound=true}={}){
 const item=r.p_items[0],native='00000000-0000-4000-8000-000000000099';
 return {baseline:{contract:'COS_MHELP_API_V1',origin:'mhelpdesk_api',complete:true,reviewed:true,sourceSha256:'a'.repeat(64),apiSync:{enabled:true,lastSuccessAt:new Date().toISOString()},records:[{productId:'1001',placement,lifecycle:'UNFLAGGED',binding:bound?{productId:'1001',nativeUnitId:native,guardCurrent:true,expectedGuard:'b'.repeat(64)}:null}]},crosswalk:{reviewed:true,revision:'c'.repeat(64),records:[{productId:'1001',equipmentKey:item.equipment_key,nativeUnitId:native,family:item.family,unitTag:item.unit_tag}]}};
}
async function admit(packet,expected=generation){
 await db.exec('reset role');await db.query("select set_config('test.jwt_role','service_role',false)");await db.exec('set role service_role');
 try{generation=(await db.query('select public.cos_admit_transfer_placement_v1($1,$2) g',[expected,packet])).rows[0].g;return generation;}finally{await db.exec('reset role');await db.query("select set_config('test.jwt_role','',false)");}
}
async function prepare(options={}){
 const r=await request({family:'Solar Spotter',purpose:'installation'});await seed(r);
 await db.query("update equipment_master set tracker_state='field_or_unknown' where equipment_key=$1",[r.p_items[0].equipment_key]);
 const s=source(r,options);await publishTransferPlacement({readBaseline:async()=>s.baseline,readCrosswalk:async()=>s.crosswalk,expectedGeneration:generation,publish:args=>admit(args.p_packet,args.p_expected_generation)});
 const e=(await context(it)).equipment.find(e=>e.equipment_key===r.p_items[0].equipment_key);
 r.p_items[0].placement_evidence=e.placement_evidence;return {r,e,s};
}
test('actual projection, service admission, IT context and signed submit preserve source proof',async()=>{
 const {r,e}=await prepare();assert.equal(e.tracker_state,'shop');assert.equal(e.reserved,false);assert.equal(e.placement_evidence.product_id,'1001');
 assert.equal((await db.query('select tracker_state from equipment_master where equipment_key=$1',[e.equipment_key])).rows[0].tracker_state,'field_or_unknown');
 const result=await submit(r);assert.equal(result.state,'awaiting_service');assert.equal(result.placement_evidence[0].source_sha,'a'.repeat(64));assert.equal(result.signature.signed_by,it);assert.equal(result.purpose,'installation');
 const s=source(r,{placement:'FIELD'});await admit(projectTransferPlacement(s.baseline,s.crosswalk));
 assert.equal((await submit(r)).replayed,true);assert.equal((await events(r.p_transfer_id)).length,1);
});
test('Field and missing binding held despite legacy Shop value',async()=>{
 for(const options of [{placement:'FIELD'},{bound:false}]){const {r,e}=await prepare(options);await db.query("update equipment_master set tracker_state='shop' where equipment_key=$1",[e.equipment_key]);assert.equal(e.reserved,true);assert.match(e.hold_reason,options.placement==='FIELD'?/In Field/:/identity or placement evidence held/);assert.equal(e.placement_evidence,null);await assert.rejects(submit(r),/verified Shop/);}
});
test('source revision changes, forged and absent proof reject without events',async()=>{
 const {r,s}=await prepare();const forged=structuredClone(r);forged.p_items[0].placement_evidence.product_id='1002';await assert.rejects(submit(forged),/Placement changed/);
 const absent=structuredClone(r);delete absent.p_items[0].placement_evidence;await assert.rejects(submit(absent),/Placement changed/);
 await admit({...projectTransferPlacement(s.baseline,s.crosswalk),crosswalk_sha:'d'.repeat(64)});await assert.rejects(submit(r),/Placement changed/);assert.equal((await events(r.p_transfer_id)).length,0);
});
test('custody and reservation guards retained',async()=>{
 const {r,e}=await prepare();await db.query("insert into unit_registry values('Solar Spotter',$1,'maintenance',null)",[e.unit_tag]);
 assert.match((await context(it)).equipment.find(x=>x.equipment_key===e.equipment_key).hold_reason,/custody/);await assert.rejects(submit(r),/custody/);
 await db.query('delete from unit_registry where unit_tag=$1',[e.unit_tag]);await submit(r);
 const other=structuredClone(r);other.p_request_id=randomUUID();other.p_transfer_id=other.p_request_id;await assert.rejects(submit(other),/unresolved handoff/);
});
test('backend-only admission, CAS and immutable history',async()=>{
 const {r,s}=await prepare(),packet=projectTransferPlacement(s.baseline,s.crosswalk);
 await assert.rejects(as(it,()=>db.query('select public.cos_admit_transfer_placement_v1($1,$2)',[generation,packet])),/permission denied/);
 await assert.rejects(admit(packet,generation-1),/publication changed/);
 await assert.rejects(db.query('update app_private.techcheck_placement_batches_v1 set packet=$1 where generation=$2',[packet,generation]),/immutable/);
 await assert.rejects(submit(r,svc),/not allowed/);
});
test('stale, incomplete, duplicate or changing source rejected and identity holds preserved',async()=>{
 const r=await request({family:'Solar Spotter',purpose:'installation'}),s=source(r);
 for(const change of [b=>b.complete=false,b=>b.records.push(b.records[0]),b=>b.apiSync.lastSuccessAt=new Date(Date.now()-2700001).toISOString()]){const b=structuredClone(s.baseline);change(b);assert.throws(()=>projectTransferPlacement(b,s.crosswalk));}
 for(const change of [b=>b.records[0].binding.guardCurrent=false,b=>b.records[0].holdReason='review',b=>b.records[0].possibleAliasUnitIds=['other']]){const b=structuredClone(s.baseline);change(b);assert.equal(projectTransferPlacement(b,s.crosswalk).rows[0].eligible,false);}
 let reads=0,writes=0;await assert.rejects(publishTransferPlacement({readBaseline:async()=>({...s.baseline,sourceSha256:(reads++?'d':'a').repeat(64)}),readCrosswalk:async()=>s.crosswalk,publish:async()=>writes++,expectedGeneration:generation}),/changed/);assert.equal(writes,0);
 const p=projectTransferPlacement(s.baseline,s.crosswalk);p.saved_at=new Date(Date.now()-2700001).toISOString();await assert.rejects(admit(p),/Invalid placement/);
 const dup=projectTransferPlacement(s.baseline,s.crosswalk);dup.rows.push(dup.rows[0]);await assert.rejects(admit(dup),/Ambiguous/);
});
test('missing census rows invalidate prior eligibility',async()=>{
 const {r,s}=await prepare();await admit({...projectTransferPlacement(s.baseline,s.crosswalk),rows:[]});
 await assert.rejects(submit(r),/verified Shop/);
});
test('automatic encoding bridge uses existing native source and real service RPC through signed submission',async()=>{
 const {createTransferPlacementPublisher}=await import('../transfer-placement-review/publisherAdapter.mjs');
 const r=await request({family:'Solar Spotter',purpose:'installation'}),oldKey=r.p_items[0].equipment_key;
 await db.query("update equipment_master set equipment_key='solar_spotter:53',unit_tag='53' where equipment_key=$1",[oldKey]);
 r.p_items[0].equipment_key='solar_spotter:53';r.p_items[0].unit_tag='53';r.p_checks={'solar_spotter:53':r.p_checks[oldKey]};r.p_photos[0].equipment_key='solar_spotter:53';
 await db.exec("insert into equipment_master(equipment_key,unit_tag,source_family,canonical_family,workflow_type,source_label,tracker_state) values('solar_spotter:54','54','Solar Spotter','Solar Spotter','Solar Spotter','Synthetic unmapped 54','shop')");
 const s=source(r);Object.assign(s.baseline.records[0].binding,{canonicalKey:'SOLAR SPOTTER:53',matchMethod:'reviewed_product_id',evidenceSha256:'e'.repeat(64)});await seed(r);
 let reads=0,writes=0;
 const client={rpc:async(name,args)=>{assert.equal(name,'cos_admit_transfer_placement_v1');if(args.p_packet!==null)writes++;
  await db.exec('reset role');await db.query("select set_config('test.jwt_role','service_role',false)");await db.exec('set role service_role');
  try{return {data:(await db.query('select public.cos_admit_transfer_placement_v1($1,$2) g',[args.p_expected_generation,args.p_packet])).rows[0].g};}finally{await db.exec('reset role');await db.query("select set_config('test.jwt_role','',false)");}},
  from:table=>{assert.equal(table,'equipment_master');const q={select:()=>q,order:()=>q,range:async(a,b)=>({data:(await db.query('select equipment_key,canonical_family,source_family,workflow_type,unit_tag,updated_at from equipment_master order by equipment_key offset $1 limit $2',[a,b-a+1])).rows})};return q;}};
 const publisher=createTransferPlacementPublisher({db:client,readNative:async()=>{reads++;return {contract:'COS_CAMERA_SNAPSHOT_SOURCE_V1',complete:true,baseline:s.baseline};},scopeKeys:['solar_spotter:53','solar_spotter:54']});
 const first=await publisher.run();generation=first.generation;assert.equal(writes,1);assert.equal(reads,2);
 assert.equal((await context(it)).equipment.find(e=>e.equipment_key==='solar_spotter:54').reserved,true);
 const second=await publisher.run();assert.equal(second.generation,first.generation,'restart reads stored generation; identical admission is idempotent');
 r.p_items[0].placement_evidence=(await context(it)).equipment.find(e=>e.equipment_key===r.p_items[0].equipment_key).placement_evidence;assert.equal((await submit(r)).state,'awaiting_service');
 const noApproval=createTransferPlacementPublisher({db:client,readNative:async()=>({contract:'COS_CAMERA_SNAPSHOT_SOURCE_V1',complete:true,baseline:s.baseline}),readReviewedCrosswalk:async()=>({...s.crosswalk,reviewed:false})});
 const before=writes;await assert.rejects(noApproval.run(),/Reviewed crosswalk/);assert.equal(writes,before);
});
test('bounded scope preserves unrelated eligibility and missing scoped evidence never falls back to old Shop',async()=>{
 const unrelated=await request({family:'Ranger',purpose:'installation'});await seed(unrelated);
 const scoped=await request({family:'Solar Spotter',purpose:'installation'});await seed(scoped);
 const key=scoped.p_items[0].equipment_key;
 const s=source(scoped);await admit({...projectTransferPlacement(s.baseline,s.crosswalk),scope_keys:[key],rows:[]});
 let list=(await context(it)).equipment;assert.equal(list.find(e=>e.equipment_key===key).reserved,true);assert.match(list.find(e=>e.equipment_key===key).hold_reason,/binding unavailable/);
 assert.equal(list.find(e=>e.equipment_key===unrelated.p_items[0].equipment_key).tracker_state,'shop');
 assert.equal((await submit(unrelated)).state,'awaiting_service');await assert.rejects(submit(scoped),/verified Shop/);
 await admit({...projectTransferPlacement(s.baseline,s.crosswalk),scope_keys:[],rows:[]});
 list=(await context(it)).equipment;assert.equal(list.find(e=>e.equipment_key===key).reserved,true,'historically managed keys never fall back');
 await assert.rejects(admit({...projectTransferPlacement(s.baseline,s.crosswalk),scope_keys:[]}),/outside scope/);
});
test('guarded rollback restores old behavior and disables admission while retaining signed history',async()=>{
 await db.exec(await readFile(new URL('../transfer-placement-review/rollback.sql',import.meta.url),'utf8'));
 await db.exec('set role service_role');try{await assert.rejects(db.query('select public.cos_admit_transfer_placement_v1(0,$1)',[{}]),/permission denied/);}finally{await db.exec('reset role');}
 assert.ok((await db.query('select count(*)::int n from app_private.techcheck_placement_batches_v1')).rows[0].n>0);
 assert.ok((await db.query('select count(*)::int n from app_private.techcheck_transfer_events')).rows[0].n>0);
});

test('server clock expires previously admitted Shop evidence without a browser refresh',async()=>{
 const isolated=new PGlite();try{
  await isolated.exec(`create role anon;create role authenticated;create role service_role;create schema app_private;create schema auth;
   create function auth.jwt() returns jsonb language sql as $$select '{"role":"service_role"}'::jsonb$$;
   create function app_private.techcheck_transfer_event_immutable_v2() returns trigger language plpgsql as $$begin raise exception 'immutable';end$$;
   create table equipment_master(equipment_key text,canonical_family text,unit_tag text);
   insert into equipment_master values('solar_spotter:53','Solar Spotter','53');`);
  await isolated.exec(await readFile(new URL('../transfer-placement-review/storage.sql',import.meta.url),'utf8'));
  const packet={source_sha:'a'.repeat(64),crosswalk_sha:'b'.repeat(64),saved_at:new Date(Date.now()-2700000+1000).toISOString(),rows:[{equipment_key:'solar_spotter:53',family:'Solar Spotter',unit_tag:'53',product_id:'9001',native_unit_id:'synthetic-native',placement:'SHOP',eligible:true,binding_guard:'c'.repeat(64)}]};
  await isolated.query('select public.cos_admit_transfer_placement_v1(0,$1)',[packet]);
  assert.ok((await isolated.query("select app_private.techcheck_placement_evidence_v1('solar_spotter:53') proof")).rows[0].proof);
  await new Promise(r=>setTimeout(r,1100));
  assert.equal((await isolated.query("select app_private.techcheck_placement_evidence_v1('solar_spotter:53') proof")).rows[0].proof,null);
 }finally{await isolated.close();}
});

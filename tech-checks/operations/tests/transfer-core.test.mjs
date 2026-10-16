import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {normalizeManifest,receiptDifferences,TRANSFER_STATEMENT} from '../../transfers/model.js';
const it='00000000-0000-4000-8000-000000000001',svc='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003',unverified='00000000-0000-4000-8000-000000000004';
let db,contract;
before(async()=>{
 db=new PGlite();contract=JSON.parse(await readFile(new URL('../../transfers/checklist-contract.json',import.meta.url),'utf8'));
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema app_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table profiles(user_id uuid primary key,role text,active boolean,archived_at timestamptz,full_name text,username text);
 create table equipment_master(equipment_key text primary key,unit_tag text,source_family text,canonical_family text,workflow_type text,source_label text,tracker_state text,updated_at timestamptz default now());
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text,metadata jsonb);
 alter table storage.objects enable row level security;
 create function app_private.cos_verified_fleet_actor(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where user_id=p_id and active and archived_at is null and (role='owner' or role='it' and user_id='${it}'))$$;
 insert into profiles values('${it}','it',true,null,'Synthetic IT','it'),('${svc}','service',true,null,'Synthetic Service','service'),('${other}','service',true,null,'Other Service','other'),('${unverified}','it',true,null,'Unverified IT','unknown');
 grant usage on schema auth,app_private,storage to authenticated;grant execute on function auth.uid() to authenticated;grant select,insert,update,delete on storage.objects to authenticated;
 `);
 const migration=await readFile(new URL('../../database-maintenance/techcheck-named-handoffs-v1.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec('update app_private.techcheck_transfer_settings set enabled=true');
});
after(async()=>db?.close());
async function as(who,fn){await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[who]);await db.exec('set role authenticated');try{return await fn();}finally{await db.exec('reset role');}}
const submit=(r,who=it)=>as(who,async()=>(await db.query(`select public.submit_techcheck_transfer_v1(${Object.keys(r).map((k,n)=>k+'=> $'+(n+1)).join(',')}) as result`,Object.values(r))).rows[0].result);
const context=who=>as(who,async()=>(await db.query('select public.techcheck_transfer_context_v1() as result')).rows[0].result);
const total=async table=>(await db.query('select count(*)::int n from app_private.'+table)).rows[0].n;
async function request(){
 const id=randomUUID(),key='Sniper:'+id,tag='S-'+id.slice(0,8);
 await db.query("insert into equipment_master(equipment_key,unit_tag,source_family,canonical_family,workflow_type,source_label,tracker_state) values($1,$2,'Sniper','Sniper','Sniper',$3,'shop')",[key,tag,'Sniper '+tag]);
 const checks=Object.fromEntries(contract.families.Sniper.bool_fields.map(field=>[field,true]));
 return {p_request_id:id,p_transfer_id:id,p_kind:'checkout',p_expected_revision:0,p_service_actor:svc,p_items:[{equipment_key:key,family:'Sniper',unit_tag:tag,sims:['00123456789012345670'],battery_count:2,parts:[{name:'SD card',quantity:1}]}],p_checks:{[key]:checks},p_signature:{method:'typed',name:'Synthetic IT',confirmed:true},p_photos:[{equipment_key:key,kind:'unit',path:it+'/'+id+'/'+'a'.repeat(64)+'.jpg'}],p_notes:'Synthetic only'};
}
async function seed(r){for(const p of r.p_photos)await db.query("insert into storage.objects values('techcheck-transfer-evidence',$1,'{\"mimetype\":\"image/jpeg\",\"size\":1234}')",[p.path]);}
function receipt(r,items=r.p_items){const id=randomUUID();return {...r,p_request_id:id,p_kind:'receipt',p_expected_revision:1,p_items:structuredClone(items),p_checks:{},p_signature:{method:'typed',name:'Synthetic Service',confirmed:true},p_photos:items.map(i=>({equipment_key:i.equipment_key,kind:'unit',path:svc+'/'+id+'/'+'b'.repeat(64)+'.jpg'}))};}
async function issued(){const r=await request();await seed(r);await submit(r);return r;}
function returned(r){const id=randomUUID();return {...r,p_request_id:id,p_kind:'return',p_expected_revision:2,p_checks:Object.fromEntries(r.p_items.map(i=>[i.equipment_key,Object.fromEntries(['physical_condition_ok','accessories_ok','batteries_ok','sd_cards_ok','electronics_ok','power_functions_ok'].map(f=>[f,true]))])),p_photos:r.p_items.map(i=>({equipment_key:i.equipment_key,kind:'unit',path:it+'/'+id+'/'+'c'.repeat(64)+'.jpg'}))};}
test('pure manifest keeps family-qualified tags and SIM leading zeros, rejects numeric SIM and duplicate identities',()=>{
 const rows=[{equipment_key:'Sniper:001',family:'Sniper',unit_tag:'001',sims:['0012'],battery_count:2,parts:[]},{equipment_key:'Ranger:001',family:'Ranger',unit_tag:'001',sims:['0099'],battery_count:1,parts:[]}];
 assert.equal(normalizeManifest(rows).find(r=>r.family==='Sniper').sims[0],'0012');
 assert.throws(()=>normalizeManifest([{...rows[0],sims:[12]}]),/exact text/);assert.throws(()=>normalizeManifest([rows[0],rows[0]]),/identity/);
 assert.equal(receiptDifferences(rows,[]).length,2);
});
test('checklist contract matches unchanged existing IT BACKUP rules, not a shortened checklist',async()=>{
 const source=await readFile(new URL('../../tech-check-rules.js',import.meta.url),'utf8');assert.equal(createHash('sha256').update(source).digest('hex'),contract.sha256);
 const box={window:{}};vm.runInNewContext(source,box);const rules=box.window.TechCheckRules;
 for(const [type,c] of Object.entries(contract.families)){assert.deepEqual(JSON.parse(JSON.stringify(rules.itChecklist({equipment_type:type,purpose:'BACKUP',unit_tag:'{UNIT}',required_battery_count:rules.requiredBatteryCount(type)},1).filter(s=>s.kind==='bool').map(s=>s.field))),c.bool_fields);}
});
test('IT checkout is named, signed, archived to an outbox but never automatically accepted',async()=>{
 const r=await issued(),state=(await context(it)).transfers.find(t=>t.id===r.p_transfer_id);
 assert.equal(state.state,'awaiting_service');assert.equal(state.service_actor,svc);assert.equal(state.events.length,1);assert.equal(state.events[0].snapshot.signature.statement,TRANSFER_STATEMENT);
 assert.equal(state.events[0].snapshot.signature.name,'Synthetic IT');assert.ok(state.events[0].signed_at);assert.equal(state.manifest[0].sims[0],'00123456789012345670');
 assert.equal((await db.query('select status from app_private.techcheck_transfer_outbox where event_id=$1',[r.p_request_id])).rows[0].status,'awaiting_delivery_adapter');
});
test('only named recipient reads and accepts; Service cannot create handoffs; unverified IT denied',async()=>{
 const r=await issued(),s=receipt(r);await seed(s);
 assert.ok((await context(svc)).transfers.some(t=>t.id===r.p_transfer_id));assert.ok(!(await context(other)).transfers.some(t=>t.id===r.p_transfer_id));
 await assert.rejects(submit({...s,p_signature:{...s.p_signature,name:"Other Service"}},other),/unavailable/);await assert.rejects(submit(r,svc),/not allowed/);await assert.rejects(context(unverified),/verified IT/);
 const result=await submit(s,svc);assert.equal(result.state,'accepted');assert.deepEqual(result.differences,[]);
});
test('mismatched unit, SIM, battery or parts remains discrepancy, with server-computed differences',async()=>{
 const r=await issued(),s=receipt(r);s.p_items[0].unit_tag='WRONG';s.p_items[0].sims=['DIFFERENT'];s.p_items[0].battery_count=1;s.p_items[0].parts=[];await seed(s);
 const result=await submit(s,svc);assert.equal(result.state,'discrepancy');assert.equal(result.differences.length,4);assert.equal(result.revision,2);
 const corrected=receipt(r);corrected.p_expected_revision=2;await seed(corrected);assert.equal((await submit(corrected,svc)).state,'accepted');
 assert.equal((await context(svc)).transfers.find(t=>t.id===r.p_transfer_id).events.length,3);
});
test('all equipment missing can be recorded and signed without claiming receipt',async()=>{
 const r=await issued(),s=receipt(r,[]);const result=await submit(s,svc);assert.equal(result.state,'discrepancy');assert.equal(result.differences[0].actual,'Missing');
});
test('lost response retries do not create duplicate events, reservations or outbox reports',async()=>{
 const r=await issued(),before=await total('techcheck_transfer_events');assert.equal((await submit(r)).replayed,true);assert.equal(await total('techcheck_transfer_events'),before);
 await assert.rejects(submit({...r,p_notes:'changed'}),/already used/);
});
test('two outgoing handoffs cannot reserve the same equipment',async()=>{
 const r=await issued(),id=randomUUID(),another={...r,p_request_id:id,p_transfer_id:id,p_photos:r.p_photos.map(p=>({...p,path:p.path.replace(r.p_request_id,id)}))};await seed(another);
 await assert.rejects(submit(another),/unresolved handoff/);
});
test('failed checks, wrong identity, missing photo and short unit battery count roll back checkout',async()=>{
 const r=await request();await seed(r);const before=await total('techcheck_transfers');
 const c=structuredClone(r);c.p_checks[r.p_items[0].equipment_key].power_ok=false;await assert.rejects(submit(c),/every required/);
 await assert.rejects(submit({...r,p_photos:[]}),/Photograph/);
 const wrong=structuredClone(r);wrong.p_items[0].unit_tag='WRONG';await assert.rejects(submit(wrong),/identity changed/);
 const short=structuredClone(r);short.p_items[0].battery_count=1;await assert.rejects(submit(short),/battery requirement/);
 assert.equal(await total('techcheck_transfers'),before);assert.equal((await db.query('select * from app_private.techcheck_transfer_reservations where equipment_key=$1',[r.p_items[0].equipment_key])).rows.length,0);
});
test('stale receipt revision, different recipient or wrong signer cannot commit',async()=>{
 const r=await issued(),s=receipt(r);await seed(s);
 await assert.rejects(submit({...s,p_expected_revision:0},svc),/changed/);await assert.rejects(submit({...s,p_service_actor:other},svc),/cannot be changed/);
 await assert.rejects(submit({...s,p_signature:{...s.p_signature,name:'Synthetic IT'}},svc),/own technician/);
});
test('forged evidence ownership, non-JPEG or nonexistent evidence cannot commit',async()=>{
 const r=await request();await assert.rejects(submit(r),/Upload every/);
 await seed(r);await assert.rejects(submit({...r,p_photos:r.p_photos.map(p=>({...p,path:p.path.replace(it,svc)}))}),/evidence identity/);
 await db.query("update storage.objects set metadata='{}' where name=$1",[r.p_photos[0].path]);await assert.rejects(submit(r),/Upload every/);
});
test('accepted evidence is immutable and another Service cannot read a handoff photo',async()=>{
 const r=await issued();
 assert.equal(await as(it,async()=>(await db.query('select app_private.techcheck_transfer_file($1,true) ok',[r.p_photos[0].path])).rows[0].ok),false);
 assert.equal(await as(svc,async()=>(await db.query('select app_private.techcheck_transfer_file($1,false) ok',[r.p_photos[0].path])).rows[0].ok),true);
 assert.equal(await as(other,async()=>(await db.query('select app_private.techcheck_transfer_file($1,false) ok',[r.p_photos[0].path])).rows[0].ok),false);
 await as(svc,async()=>{await assert.rejects(db.query('select * from app_private.techcheck_transfer_events'),/permission denied/);const n=await db.query("update storage.objects set metadata='{}' where name=$1 returning *",[r.p_photos[0].path]);assert.equal(n.rows.length,0);});
});
test('passing check-in stays held for inventory review and failed check-in stays repair-held',async()=>{
 for(const failing of [false,true]){const r=await issued(),s=receipt(r);await seed(s);await submit(s,svc);const back=returned(r);if(failing)back.p_checks[r.p_items[0].equipment_key].electronics_ok=false;await seed(back);
  const result=await submit(back);assert.equal(result.state,failing?'returned_repair':'returned_review');
  assert.equal((await db.query('select count(*)::int n from app_private.techcheck_transfer_reservations where transfer_id=$1',[r.p_transfer_id])).rows[0].n,1);
 }
});
test('failed intake without explanation or return before acceptance is rejected',async()=>{
 const r=await issued(),back=returned(r);back.p_expected_revision=1;await seed(back);await assert.rejects(submit(back),/Only accepted/);
 const s=receipt(r);await seed(s);await submit(s,svc);back.p_expected_revision=2;back.p_checks[r.p_items[0].equipment_key].electronics_ok=false;back.p_notes='';await assert.rejects(submit(back),/Explain/);
});
test('archived Service identity is denied on read and acceptance',async()=>{
 const r=await issued(),s=receipt(r);await seed(s);await db.query('update profiles set archived_at=now() where user_id=$1',[svc]);
 try{await assert.rejects(context(svc),/Active/);await assert.rejects(submit(s,svc),/Active/);}finally{await db.query('update profiles set archived_at=null where user_id=$1',[svc]);}
});
test('no transfer action updates existing truck stock, camera, field placement or source registry',async()=>{
 const source=await readFile(new URL('../../database-maintenance/techcheck-named-handoffs-v1.sql',import.meta.url),'utf8');
 assert.doesNotMatch(source,/(?:update|insert into|delete from)\s+public\.(?:equipment_master|camera_devices|service_truck|morning_checks)/i);
 assert.doesNotMatch(source,/service_save_my_truck_inventory|submit_my_service_truck_inventory/);
});
test('unreleased feature flag fails closed and cannot be enabled by technicians',async()=>{
 await db.exec('update app_private.techcheck_transfer_settings set enabled=false');
 try{await assert.rejects(context(it),/held for release/);await as(it,()=>assert.rejects(db.exec('update app_private.techcheck_transfer_settings set enabled=true'),/permission denied/));}
 finally{await db.exec('update app_private.techcheck_transfer_settings set enabled=true');}
});

test('missing release settings also fail closed',async()=>{
 await db.exec('delete from app_private.techcheck_transfer_settings');
 try{await assert.rejects(context(it),/held for release/);await assert.rejects(submit(await request()),/held for release/);}
 finally{await db.exec('insert into app_private.techcheck_transfer_settings values(true,true)');}
});

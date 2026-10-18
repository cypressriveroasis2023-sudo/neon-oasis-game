import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {deliveryFixture,transferIds} from './helpers/transfer-delivery-fixture.mjs';
import {reportHtml} from '../../supabase/functions/service-daily-delivery/report.ts';
import {summaryPdf} from '../../supabase/functions/service-daily-delivery/summary.ts';
let db,legacyRequest;
const actor=transferIds.service,it=transferIds.it,other='00000000-0000-4000-8000-000000000003';
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema app_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
 create table profiles(user_id uuid primary key,role text,active boolean,archived_at timestamptz,full_name text,username text);
 create table equipment_master(equipment_key text primary key,unit_tag text,source_family text,canonical_family text,workflow_type text,source_label text,tracker_state text,updated_at timestamptz default now());
 create table morning_checks(id uuid default gen_random_uuid(),service_tech_id uuid,submitted_at timestamptz default now(),truck_checks jsonb,taking_trailer boolean,trailer_checks jsonb,is_test boolean default false);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text,metadata jsonb);alter table storage.objects enable row level security;
 create table writer_calls(kind text,args jsonb);
 create function public.service_save_my_truck_inventory_v3(jsonb,jsonb,integer,integer,integer,integer) returns jsonb language plpgsql as $$begin insert into public.writer_calls values('save',jsonb_build_object('units',$1,'sims',$2));return '{}';end$$;
 create function public.submit_my_service_truck_inventory_check_v3(jsonb,jsonb,integer,integer,integer,integer) returns jsonb language plpgsql as $$begin insert into public.writer_calls values('verify',jsonb_build_object('units',$1,'sims',$2));return jsonb_build_object('departure_ready',$3>=25 and $4>=4 and $5>=2 and $6>=4,'units','[]'::jsonb,'sims','[]'::jsonb,'stock','{}'::jsonb);end$$;
 create function app_private.cos_verified_fleet_actor(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where user_id=p_id and active and archived_at is null and (role='owner' or role='it' and user_id='${it}'))$$;
 insert into profiles values('${it}','it',true,null,'Synthetic IT','it'),('${actor}','service',true,null,'Synthetic Service technician','service'),('${other}','service',true,null,'Other Service','other');
 insert into morning_checks(service_tech_id,truck_checks,taking_trailer,trailer_checks)values('${actor}',(select jsonb_object_agg('truck_'||n,true) from generate_series(1,8)n),false,'{}');
 grant usage on schema auth,app_private,storage to authenticated,service_role;grant select,insert,update,delete on storage.objects to authenticated;`);
 for(const file of ['techcheck-named-handoffs-v1.sql','techcheck-transfer-rollout-v2.sql','techcheck-transfer-delivery-v3.sql','service-daily-reports-v1.sql','service-daily-individual-sim-photos-v2.sql','service-daily-battery-type-photos-v3.sql','service-daily-signoff-attachments-v4.sql'])await db.exec(await readFile(new URL('../../database-maintenance/'+file,import.meta.url),'utf8'));
 legacyRequest=await request(false);await complete(legacyRequest,actor,'complete_service_daily_report_v4');
 await db.exec(await readFile(new URL('../../database-maintenance/service-daily-receipt-links-v5.sql',import.meta.url),'utf8'));
});
after(async()=>db?.close());
async function as(who,fn){await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[who]);await db.exec('set role authenticated');try{return await fn();}finally{await db.exec('reset role');}}
const complete=(p,who=actor,endpoint='complete_service_daily_report_v5')=>as(who,async()=>(await db.query(`select public.${endpoint}(${Object.keys(p).map((k,i)=>k+'=> $'+(i+1)).join(',')}) result`,Object.values(p))).rows[0].result);
const current=(who=actor)=>as(who,async()=>(await db.query('select public.techcheck_daily_receipts_v5() result')).rows[0].result);
const refs=rows=>rows.map(r=>({event_id:r.event_id,receipt_revision:r.receipt_revision,transfer_id:r.transfer_id,transfer_revision:r.transfer_revision}));
const total=async()=>(await db.query('select count(*)::integer n from writer_calls')).rows[0].n;
async function request(linked=true){
 const id=randomUUID(),p={p_report_id:id,p_signature:{method:'typed',name:'Synthetic Service technician',confirmed:true},p_units:{Sniper:'SN-01',Ranger:'RA-02',Spotter:'SP-03','Solar Spotter':'SS-04'},p_sims:{1:'00123456789012345670',2:'00123456789012345671',3:'00123456789012345672'},p_stock:{recon_battery_qty:25,agm_12v_110ah_qty:4,litime_12v_100ah_qty:2,battery_12v_35ah_qty:4},p_photos:[...['Sniper','Ranger','Spotter','Solar Spotter'].flatMap(category=>['front','tag'].map(view=>({category,view}))),...['Recon batteries','AGM 12V 110Ah','LiTime 12V 100Ah','12V 35Ah'].map(category=>({category,view:'1'})),...[1,2,3].flatMap(n=>['front','back'].map(view=>({category:'SIM Card '+n,view})))].map((p,i)=>({...p,path:actor+'/'+id+'/'+String(i).padStart(64,'0')+'.jpg'}))};
 for(const photo of p.p_photos)await db.query("insert into storage.objects values('service-daily-evidence',$1,'{\"mimetype\":\"image/jpeg\",\"size\":1234}')",[photo.path]);
 if(linked){p.p_receipts=refs((await current()).receipts);p.p_receipts_reviewed=true;}return p;
}
async function seedReceipt(){
 const d=deliveryFixture(),id=randomUUID();d.events[0].id=id;d.transfer_id=id;d.events[1].id=randomUUID();
 await db.query('insert into app_private.techcheck_transfers(id,it_actor,service_actor,it_name,service_name,manifest,state,revision) values($1,$2,$3,$4,$5,$6,$7,2)',[id,it,actor,d.it_name,d.service_name,d.events[0].snapshot.expected,'accepted']);
 for(const e of d.events){e.snapshot.transfer_id=id;await db.query('insert into app_private.techcheck_transfer_events(id,transfer_id,actor_id,actor_name,kind,request,snapshot,photos,signed_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[e.id,id,e.actor_id,e.actor_name,e.kind,{},e.snapshot,e.photos,e.signed_at]);}
 return {id,event:d.events[1].id};
}
test('held installation preserves exact historical v4 replay, and activation rejects older new submissions',async()=>{
 const before=await total();assert.equal((await complete(legacyRequest,actor,'complete_service_daily_report_v4')).id,legacyRequest.p_report_id);assert.equal(await total(),before);
 const legacy=await request(false);await complete(legacy,actor,'complete_service_daily_report_v4');
 await db.exec('update app_private.techcheck_transfer_settings set enabled=true,reports_ready=true,receipt_link_ready=true,custody_ready=true');
 await assert.rejects(complete(await request(false),actor,'complete_service_daily_report_v4'),/review and sign/);
 await as(actor,()=>assert.rejects(db.query('select app_private.complete_service_daily_report_core_v4(null,null,null,null,null,null)'),/permission denied/));
 assert.equal((await complete(legacyRequest,actor,'complete_service_daily_report_v4')).id,legacyRequest.p_report_id);
});
test('exact receipt revisions and immutable snapshots are included in the daily signature, HTML, JSON and PDF',async()=>{
 const receipt=await seedReceipt(),p=await request(),before=await total();await complete(p);assert.equal(await total(),before+2);
 const row=(await db.query('select * from app_private.service_daily_reports where id=$1',[p.p_report_id])).rows[0];
 assert.deepEqual(row.snapshot.signature.receipt_refs,p.p_receipts);assert.equal(row.snapshot.signature.statement_version,2);assert.equal(row.snapshot.receipt_links[0].event_id,receipt.event);assert.equal(row.snapshot.receipt_links[0].remaining[0].sims[0],'00123456789012345670');
 assert.equal(row.snapshot.truck_checks.truck_8,true);assert.equal(row.photos.length,18);assert.deepEqual(row.request.units,p.p_units);
 assert.ok(reportHtml(row).includes(receipt.event));assert.ok(new TextDecoder().decode(summaryPdf(row)).includes(receipt.event));
 await db.query('update app_private.techcheck_transfers set revision=3 where id=$1',[receipt.id]);await complete(p);assert.equal(await total(),before+2);
 assert.deepEqual((await db.query('select snapshot from app_private.service_daily_reports where id=$1',[p.p_report_id])).rows[0].snapshot,row.snapshot);
});
test('omitted, duplicate, foreign, stale or unreviewed receipts reject before any inventory writer',async()=>{
 const p=await request(),before=await total();
 for(const changed of [[],[...p.p_receipts,...p.p_receipts],p.p_receipts.map(r=>({...r,event_id:randomUUID()})),p.p_receipts.map(r=>({...r,receipt_revision:r.receipt_revision+1})),p.p_receipts.map(r=>({...r,transfer_revision:r.transfer_revision-1}))])await assert.rejects(complete({...p,p_receipts:changed}),/receipts changed/);
 await assert.rejects(complete({...p,p_receipts_reviewed:false}),/Review the exact/);assert.equal(await total(),before);
 assert.deepEqual((await current(other)).receipts,[]);await assert.rejects(current(it),/Active Service/);
 await db.query('update profiles set active=false where user_id=$1',[actor]);await assert.rejects(current(),/Active Service/);await assert.rejects(complete(p),/Active Service/);await db.query('update profiles set active=true where user_id=$1',[actor]);
});
test('accepted receipts never replace the separate morning inspection and minimum truck inventory',async()=>{
 const p=await request(),before=await total();await assert.rejects(complete({...p,p_stock:{...p.p_stock,recon_battery_qty:0}}),/Truck is not ready/);assert.equal(await total(),before);
 await db.exec("update morning_checks set truck_checks=jsonb_set(truck_checks,'{truck_1}','false')");await assert.rejects(complete(p),/safety inspection/);assert.equal(await total(),before);
});

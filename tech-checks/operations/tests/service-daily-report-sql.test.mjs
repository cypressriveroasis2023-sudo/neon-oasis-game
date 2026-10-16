import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
let db;
const actor='00000000-0000-4000-8000-000000000003',other='00000000-0000-4000-8000-000000000004';
before(async()=>{
 db=new PGlite();await db.exec(`
 create role anon;create role authenticated;create role service_role;
 create schema auth;create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table profiles(user_id uuid primary key,role text,active boolean,archived_at timestamptz,full_name text,username text);
 create table morning_checks(id uuid default gen_random_uuid(),service_tech_id uuid,submitted_at timestamptz default now(),truck_checks jsonb,taking_trailer boolean,trailer_checks jsonb,is_test boolean default false);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text,metadata jsonb);
 create table writer_calls(kind text,args jsonb);
 create function public.service_save_my_truck_inventory_v3(jsonb,jsonb,integer,integer,integer,integer) returns jsonb language plpgsql as $$begin insert into public.writer_calls values('save',jsonb_build_object('units',$1,'sims',$2));return '{}';end$$;
 create function public.submit_my_service_truck_inventory_check_v3(jsonb,jsonb,integer,integer,integer,integer) returns jsonb language plpgsql as $$begin insert into public.writer_calls values('verify',jsonb_build_object('units',$1,'sims',$2));return jsonb_build_object('departure_ready',$3>=25 and $4>=4 and $5>=2 and $6>=4,'units','[]'::jsonb,'sims','[]'::jsonb,'stock','{}'::jsonb);end$$;
 insert into profiles values('${actor}','service',true,null,'Synthetic service','test'),('${other}','service',true,null,'Other','other');
 insert into morning_checks(service_tech_id,truck_checks,taking_trailer,trailer_checks)values('${actor}',(select jsonb_object_agg('truck_'||n,true) from generate_series(1,8)n),false,'{}');
 `);
 await db.exec(await readFile(new URL('../../database-maintenance/service-daily-reports-v1.sql',import.meta.url),'utf8'));
 await db.exec('grant usage on schema auth,storage to authenticated; grant execute on function auth.uid() to authenticated;');
});
after(async()=>db?.close());
function request(){const id=randomUUID();return {p_report_id:id,p_units:{Sniper:'SN-01',Ranger:'RA-02',Spotter:'SP-03','Solar Spotter':'SS-04'},p_sims:{1:'00123456789012345670',2:'00123456789012345671',3:'00123456789012345672'},p_stock:{recon_battery_qty:25,agm_12v_110ah_qty:4,litime_12v_100ah_qty:2,battery_12v_35ah_qty:4},p_photos:[...['Sniper','Ranger','Spotter','Solar Spotter'].flatMap(category=>['front','tag'].map(view=>({category,view}))),{category:'Batteries',view:'1'},{category:'SIM cards',view:'1'}].map((p,i)=>({...p,path:actor+'/'+id+'/'+String(i).padStart(64,'0')+'.jpg'}))};}
async function seed(p){await db.exec('reset role');for(const photo of p.p_photos)await db.query("insert into storage.objects values('service-daily-evidence',$1,'{\"mimetype\":\"image/jpeg\",\"size\":1234}')",[photo.path]);}
async function complete(p,who=actor){await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[who]);await db.exec('set role authenticated');try{return (await db.query(`select public.complete_service_daily_report_v1(${Object.keys(p).map((k,i)=>k+'=> $'+(i+1)).join(',')}) result`,Object.values(p))).rows[0].result;}finally{await db.exec('reset role');}}
const total=async table=>(await db.query('select count(*)::integer n from '+table)).rows[0].n;
test('atomic completion snapshots exact inspection, names, SIM strings and photos; retry is idempotent',async()=>{
 const p=request();await seed(p);const result=await complete(p);assert.equal(result.inventory_ready,true);assert.equal(result.delivery_status,'queued');
 const record=(await db.query('select * from app_private.service_daily_reports where id=$1',[p.p_report_id])).rows[0];assert.deepEqual(record.request.units,p.p_units);assert.deepEqual(record.request.sims,p.p_sims);assert.equal(Object.keys(record.snapshot.truck_checks).length,8);assert.equal(record.snapshot.taking_trailer,false);assert.equal(record.photos.length,10);
 const before=await total('writer_calls');assert.equal((await complete(p)).id,result.id);assert.equal(await total('writer_calls'),before);
 await assert.rejects(complete({...p,p_units:{...p.p_units,Sniper:'changed'}}),/already used/);
 await assert.rejects(complete(p,other),/already used/);
});
test('missing evidence, wrong owner paths, duplicate slots and fabricated files never write inventory',async()=>{
 const p=request();await seed(p);const before=await total('writer_calls');
 await assert.rejects(complete({...p,p_photos:p.p_photos.slice(1)}),/Photograph/);
 await assert.rejects(complete({...p,p_photos:p.p_photos.map((v,i)=>i? v:{...v,path:v.path.replace(actor,other)})}),/Invalid photo identity/);
 await assert.rejects(complete({...p,p_photos:p.p_photos.concat(p.p_photos[0])}),/front and rear tag|Duplicate/);
 await assert.rejects(complete({...p,p_photos:p.p_photos.map((v,i)=>i?v:{...v,path:actor+'/'+p.p_report_id+'/'+'f'.repeat(64)+'.jpg'})}),/Upload every photo/);
 assert.equal(await total('writer_calls'),before);
});
test('short stock rolls back both writers and report; archived or wrong role cannot submit',async()=>{
 const p=request();await seed(p);const before=await total('writer_calls'),reports=await total('app_private.service_daily_reports');
 await assert.rejects(complete({...p,p_stock:{...p.p_stock,recon_battery_qty:24}}),/not ready/);assert.equal(await total('writer_calls'),before);assert.equal(await total('app_private.service_daily_reports'),reports);
 await db.query('update profiles set archived_at=now() where user_id=$1',[actor]);await assert.rejects(complete(p),/Active Service/);await db.query('update profiles set archived_at=null,role=$2 where user_id=$1',[actor,'owner']);await assert.rejects(complete(p),/Active Service/);await db.query("update profiles set role='service' where user_id=$1",[actor]);
});
test('status is own-only; direct report access and overwriting completed evidence are forbidden',async()=>{
 const p=request();await seed(p);await complete(p);
 await db.query("select set_config('test.actor',$1,false)",[actor]);await db.exec('set role authenticated');
 try{
  await assert.rejects(db.query('select * from app_private.service_daily_reports'),/permission denied/);
  const result=(await db.query('select public.service_daily_report_status_v1() result')).rows[0].result;assert.ok(result.some(r=>r.id===p.p_report_id));assert.equal(result.some(r=>r.photos||r.snapshot||r.service_tech_id),false);
  assert.equal((await db.query('select app_private.service_daily_can_upload($1) ok',[p.p_photos[0].path])).rows[0].ok,false);
 }finally{await db.exec('reset role');}
 await db.query("select set_config('test.actor',$1,false)",[other]);await db.exec('set role authenticated');try{assert.deepEqual((await db.query('select public.service_daily_report_status_v1() result')).rows[0].result,[]);}finally{await db.exec('reset role');}
});

test('server queue uses leases, enforces ownership and cannot mark unsent reports delivered',async()=>{
 await db.exec(`create function auth.role() returns text language sql stable as $$select current_setting('test.jwt_role',true)$$;`);
 const source=await readFile(new URL('../../database-maintenance/service-daily-delivery-v1.sql',import.meta.url),'utf8');
 await db.exec(source.split('-- Authenticate the scheduler')[0]+'commit;');
 const server=async args=>{await db.exec('reset role');await db.query("select set_config('test.jwt_role','service_role',false)");await db.exec('set role service_role');try{return (await db.query(`select public.service_daily_delivery_v1(${Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')}) result`,Object.values(args))).rows[0].result;}finally{await db.exec('reset role');}};
 const p=request();await seed(p);await complete(p);
 assert.equal(await server({p_action:'claim',p_id:p.p_report_id,p_actor:other}),null);
 const claimed=await server({p_action:'claim',p_id:p.p_report_id,p_actor:actor});assert.equal(claimed.id,p.p_report_id);assert.ok(claimed.lease_token);assert.equal(claimed.request,undefined);
 assert.equal(await server({p_action:'claim',p_id:p.p_report_id,p_actor:actor}),null);
 await assert.rejects(server({p_action:'checkpoint',p_id:p.p_report_id,p_lease:randomUUID(),p_data:{email_state:'sent'}}),/lease expired/);
 await assert.rejects(server({p_action:'finish',p_id:p.p_report_id,p_lease:claimed.lease_token,p_data:{status:'sent'}}),/confirmation required/);
 await server({p_action:'checkpoint',p_id:p.p_report_id,p_lease:claimed.lease_token,p_data:{email_state:'sent',drive_manifest:{complete:true}}});
 await server({p_action:'finish',p_id:p.p_report_id,p_lease:claimed.lease_token,p_data:{status:'sent'}});
 assert.equal(await server({p_action:'claim',p_id:p.p_report_id,p_actor:actor}),null);
 await db.exec('set role authenticated');try{await assert.rejects(db.query("select public.service_daily_delivery_v1('claim')"),/permission denied/);}finally{await db.exec('reset role');}
});

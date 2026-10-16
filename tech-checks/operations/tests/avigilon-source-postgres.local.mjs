/** Explicit local-only test. Starts a disposable PostgreSQL container with no network or host ports. */
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
if(process.env.COS_AVIGILON_LOCAL_POSTGRES!=='1')throw Error('Set COS_AVIGILON_LOCAL_POSTGRES=1 to run isolated synthetic PostgreSQL tests.');
const name='cos-avigilon-source-test-'+process.pid,tenant='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',owner='11111111-1111-4111-8111-111111111111';
const literal=s=>"'"+String(s).replaceAll("'","''")+"'";
function session(sql,held=false,app='avigilon-test',database='cos_avigilon_test'){
 const child=spawn('docker',['exec','-i','-e','PGAPPNAME='+app,name,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],{stdio:['pipe','pipe','pipe']});
 let out='',err='',readyResolve,readyReject;const ready=new Promise((r,j)=>{readyResolve=r;readyReject=j;}),timer=setTimeout(()=>child.kill(),15000);
 const done=new Promise((resolve,reject)=>{child.stdout.on('data',d=>{out+=d;if(out.includes('HELD'))readyResolve();});child.stderr.on('data',d=>err+=d);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);if(held&&!out.includes('HELD'))readyReject(Error(err||'No held transaction'));code===0?resolve(out.trim()):reject(Error(err));});});done.catch(()=>{});
 child.stdin[held?'write':'end']("set statement_timeout='10s';\n"+sql+(held?'\n\\echo HELD\n':'\n'));
 return {done,ready,release:()=>{child.stdin.end('commit;\n');return done;}};
}
const exec=sql=>session(sql).done;
const candidate=(revision='r1')=>({id:crypto.randomUUID(),tenantId:tenant,rosterRevision:revision,startedAt:new Date().toISOString(),deadlineAt:new Date(Date.now()+45000).toISOString(),completedAt:null,state:'pending',rows:[{unitId:'u1',name:'Synthetic Sniper',outcome:'pending',reason:null,startedAt:null,completedAt:null,confirmedOutage:false,endpointRevision:'1'}]});
const call=(op,run)=>`select cos_avigilon_checks_private.${op}('${owner}','${tenant}',${literal(JSON.stringify(run))}::jsonb);`;
async function waiting(app){for(let i=0;i<100;i++){if(await exec(`select count(*) from pg_stat_activity where application_name=${literal(app)} and wait_event_type='Lock';`)==='1')return;await delay(20);}throw Error('Independent session did not demonstrate contention');}
try{
 execFileSync('docker',['run','--detach','--rm','--name',name,'--network','none','-e','POSTGRES_PASSWORD=synthetic-local-only','-e','POSTGRES_DB=cos_avigilon_test','postgres:17-alpine'],{stdio:'ignore'});
 for(let i=0;i<100;i++){try{execFileSync('docker',['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],{stdio:'ignore'});break;}catch{await delay(50);}}
 const auth=`create schema auth;create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;`;
 await exec(`create role anon;create role authenticated;create role service_role;${auth}create table user_profiles(user_id uuid,organization_id uuid,active boolean,department text);create table roles(id uuid,organization_id uuid,code text);create table user_roles(user_id uuid,role_id uuid);insert into user_profiles values('${owner}','${tenant}',true,'owner');insert into roles values('${owner}','${tenant}','owner');insert into user_roles values('${owner}','${owner}');`);
 for(const file of ['avigilon_check_runs.sql','avigilon_health_publication.sql','avigilon_source_operations.sql'])await exec(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));
 const nativeFences=await readFile(new URL('../db/avigilon_native_source_fences.sql',import.meta.url),'utf8');
 for(const match of nativeFences.matchAll(/'((?:public|app_private|cos_mhelp_placement_private|cos_sheets_placement_private)\.[a-z_]+)'/g)){const table=match[1];await exec(`create schema if not exists ${table.split('.')[0]};create table ${table}(id integer);`);}
 await exec(nativeFences);
 await exec('create database legacy_sources');
 const legacy=(sql,held=false,app='legacy-source')=>session(sql,held,app,'legacy_sources');
 await legacy(auth+`create table camera_devices(id bigint primary key,public_ip text,connection_revision bigint,monitoring_profile text);insert into camera_devices values(10,'8.8.8.8',1,'sniper');create table camera_integrations(provider text primary key,metadata jsonb);create table equipment_master(id bigint);create table camera_inventory_audit(id bigint);create table camera_integration_events(id bigint);create table camera_health_current(camera_device_id bigint);create table camera_health_history(camera_device_id bigint);`+await readFile(new URL('../db/avigilon_legacy_source_guard.sql',import.meta.url),'utf8')).done;
 const control=(action,payload)=>`select cos_avigilon_checks_private.source_control('${owner}','${tenant}',${literal(action)},${literal(JSON.stringify(payload))}::jsonb);`;
 const command={table:'camera_devices',action:'update',values:{public_ip:'8.8.4.4',connection_revision:2},eq:{id:10}};
 const start=async(commands=[command])=>{const t=JSON.parse(await exec(control('begin',{id:crypto.randomUUID(),commands})));return {id:t.id,tenantId:tenant,generation:t.generation,commands:t.commands};};
 const apply=t=>`select cos_avigilon_source_private.apply(${literal(JSON.stringify(t))}::jsonb);`;
 const cancel=t=>`set request.jwt.claims='{"role":"service_role"}';select public.cos_avigilon_source_cancel(${literal(JSON.stringify(t))}::jsonb);`;
 const finish=async(t,receipt)=>{const a=JSON.parse(await exec(control('state',{})));const row=JSON.parse(await legacy('select to_jsonb(d) from camera_devices d where id=10').done);const roster={tenantId:tenant,revision:'legacy-'+row.connection_revision,units:[]};return JSON.parse(await exec(control('finish',{id:t.id,generation:a.generation,legacyReceipt:receipt,roster})));};
 // A remote transaction still running cannot be read as sealed or cancelled early.
 const first=await start(),writer=legacy('begin;'+apply(first),true,'held-source-write');await writer.ready;
 await assert.rejects(()=>legacy("set request.jwt.claims='{\"role\":\"service_role\"}';select public.cos_avigilon_source_seal();").done,/no durable seal/);
 assert.equal(JSON.parse(await exec(control('state',{}))).admitted,false);
 const cancelling=legacy(cancel(first),false,'waiting-source-cancel');await waiting('waiting-source-cancel');await writer.release();const actual=JSON.parse(await cancelling.done);assert.equal(actual.cancelled,undefined);assert.equal((await finish(first,actual)).admitted,true);
 // Conversely a committed cancellation permanently rejects the outstanding apply.
 const second=await start(),canceller=legacy('begin;'+cancel(second),true,'held-source-cancel');await canceller.ready;
 const delayed=legacy(apply(second),false,'waiting-source-apply');await waiting('waiting-source-apply');await canceller.release();const cancelled=JSON.parse(await delayed.done);assert.equal(cancelled.cancelled,true);assert.equal((await finish(second,cancelled)).admitted,true);
 assert.equal(await legacy('select connection_revision from camera_devices where id=10').done,'2');
 await legacy(apply(first)).done;await legacy(apply(second)).done;assert.equal(await legacy('select connection_revision from camera_devices where id=10').done,'2');
 await assert.rejects(()=>legacy("update camera_devices set public_ip='1.1.1.1'").done,/native-fenced/);
 // Real native hooks (not a simulated epoch increment) queue reconciliation.
 await exec('insert into public.equipment_units values(1)');assert.equal(JSON.parse(await exec(control('state',{}))).admitted,false);
 const third=await start([]),thirdReceipt=JSON.parse(await legacy(apply(third)).done),before=JSON.parse(await exec(control('state',{})));
 const changed=session('begin;insert into public.equipment_units values(2);',true,'held-native-source');await changed.ready;
 const outdated=session(control('finish',{id:third.id,generation:before.generation,legacyReceipt:thirdReceipt,roster:{tenantId:tenant,revision:'before-native-change',units:[]}}),false,'waiting-source-admission');await waiting('waiting-source-admission');await changed.release();await assert.rejects(()=>outdated.done,/generation changed/);
 assert.equal((await finish(third,thirdReceipt)).admitted,true);
 const stable=JSON.parse(await exec(control('state',{})));await exec('begin;insert into public.equipment_units values(3);rollback;');assert.equal(JSON.parse(await exec(control('state',{}))).generation,stable.generation);
 console.log('PASS separate native/legacy PostgreSQL databases, independent sessions: outstanding write has no readable seal; cancel waits for writer and returns actual outcome; apply waits for cancellation and cannot mutate; recovery admission follows committed seal; delayed replay cannot alter admitted sources; real native source hooks queue reconciliation and defeat stale admission; source rollback preserves the admitted generation.');
}finally{execFileSync('docker',['rm','--force',name],{stdio:'ignore'});}

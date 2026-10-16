/** Explicit local-only test. Starts a disposable PostgreSQL container with no network or host ports. */
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
if(process.env.COS_AVIGILON_LOCAL_POSTGRES!=='1')throw Error('Set COS_AVIGILON_LOCAL_POSTGRES=1 to run isolated synthetic PostgreSQL tests.');
const name='cos-avigilon-test-'+process.pid,tenant='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',owner='11111111-1111-4111-8111-111111111111';
const literal=s=>"'"+String(s).replaceAll("'","''")+"'";
function session(sql,held=false,app='avigilon-test'){
 const child=spawn('docker',['exec','-i','-e','PGAPPNAME='+app,name,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','cos_avigilon_test'],{stdio:['pipe','pipe','pipe']});
 let out='',err='',readyResolve;const ready=new Promise(r=>readyResolve=r),timer=setTimeout(()=>child.kill(),15000);
 const done=new Promise((resolve,reject)=>{child.stdout.on('data',d=>{out+=d;if(out.includes('HELD'))readyResolve();});child.stderr.on('data',d=>err+=d);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);code===0?resolve(out.trim()):reject(Error(err));});});done.catch(()=>{});
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
 await exec(`create role anon;create role authenticated;create role service_role;create table user_profiles(user_id uuid,organization_id uuid,active boolean,department text);create table roles(id uuid,organization_id uuid,code text);create table user_roles(user_id uuid,role_id uuid);insert into user_profiles values('${owner}','${tenant}',true,'owner');insert into roles values('${owner}','${tenant}','owner');insert into user_roles values('${owner}','${owner}');`+await readFile(new URL('../db/avigilon_check_runs.sql',import.meta.url),'utf8'));
 const run=candidate();assert.equal(JSON.parse(await exec(call('claim',run))).claimed,true);
 // A concurrent refresh holds the same transaction lock, but does not change the lease.
 const refresh=session('begin;'+call('claim',candidate()),true);await refresh.ready;
 const save=session(call('save',run),false,'waiting-save');await waiting('waiting-save');await refresh.release();assert.equal(await save.done,'t');
 // Conversely, a claim waits for a save and then coalesces the same pending run.
 const writer=session('begin;'+call('save',run),true);await writer.ready;
 const next=session(call('claim',candidate()),false,'waiting-claim');await waiting('waiting-claim');await writer.release();assert.equal(JSON.parse(await next.done).run.id,run.id);
 // Actual supersession still rejects the old writer.
 const replacement=candidate('r2');await exec(call('claim',replacement));assert.equal(await exec(call('save',run)),'f');
 // Expiry rejects a late successful outcome at the durable boundary.
 await exec(`update cos_avigilon_checks_private.runs set deadline_at=clock_timestamp()-interval '1 second' where id='${replacement.id}';`);
 const late=structuredClone(replacement);late.rows[0].outcome='online';late.rows[0].completedAt=new Date().toISOString();
 await assert.rejects(()=>exec(call('save',late)),/Stale or invalid run outcome/);
 console.log('PASS independent PostgreSQL sessions: refresh/save contention, save/claim contention, supersession, expired success.');
}finally{execFileSync('docker',['rm','--force',name],{stdio:'ignore'});}

/** Fixed ephemeral CI PostgreSQL only; never accepts a user database URL or credentials. */
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {schema} from './fixtures/mhelp-placement-schema.mjs';
import {assertCiContext,connection} from '../legacy/tests/mhelp-postgres-concurrency.ci.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function session(sql,held=false,name='placement-ci'){
 assertCiContext();
 const child=spawn('psql',['--no-psqlrc','--quiet','--tuples-only','--no-align','--set=ON_ERROR_STOP=1','--host='+connection.host,'--port='+connection.port,'--username='+connection.user,'--dbname='+connection.database],{env:{PATH:process.env.PATH,LANG:'C.UTF-8',PGPASSWORD:'synthetic-ci-only',PGAPPNAME:name,PGCONNECT_TIMEOUT:'5',PGOPTIONS:'-c statement_timeout=15000 -c lock_timeout=10000'},stdio:['pipe','pipe','pipe']});
 let out='',err='',resolveReady,rejectReady;
 const ready=new Promise((a,b)=>{resolveReady=a;rejectReady=b;});ready.catch(()=>{});
 const timer=setTimeout(()=>child.kill('SIGKILL'),20000);
 const done=new Promise((a,b)=>{child.stdout.on('data',v=>{out+=v;if(out.includes('__PLACEMENT_HELD__'))resolveReady();});child.stderr.on('data',v=>{err+=v;});child.on('error',e=>{clearTimeout(timer);rejectReady(e);b(e);});child.on('close',code=>{clearTimeout(timer);if(code===0){resolveReady();a(out);}else{const e=Error('Synthetic placement test failed: '+err);rejectReady(e);b(e);}});});done.catch(()=>{});
 if(held)child.stdin.write(sql+'\n\\echo __PLACEMENT_HELD__\n');else child.stdin.end(sql+'\n');
 return {ready,done,release:()=>{if(!child.stdin.destroyed)child.stdin.end('COMMIT;\n');return done;},abort:()=>child.kill('SIGKILL')};
}
const exec=async sql=>session(sql).done;
const lastJson=out=>JSON.parse(out.split(/\r?\n/).filter(x=>x.startsWith('{')||x.startsWith('[')).at(-1));
async function main(){
 assertCiContext();
 const server=lastJson(await exec("select json_build_object('db',current_database(),'user',current_user,'port',inet_server_port());"));
 assert.equal(server.db,connection.database);assert.equal(server.user,'postgres');assert.equal(server.port,5432);
 await exec('drop schema if exists cos_sheets_placement_private cascade;drop schema if exists cos_mhelp_placement_private cascade;drop schema if exists app_private cascade;drop schema public cascade;create schema public;grant usage on schema public to anon,authenticated,service_role;'+schema);
 await exec(await readFile(new URL('../db/20261012173408_cos_mhelp_placement_sync.sql',import.meta.url),'utf8'));
 await exec('update cos_mhelp_placement_private.control set enabled=true;');
 const first=session('begin;set local role service_role;select public.cos_mhelp_placement_begin();',true,'placement-first');let second;
 try{
  await first.ready;second=session('begin;set local role service_role;select public.cos_mhelp_placement_begin();commit;',false,'placement-second');
  let blocked=false;
  for(let i=0;i<40&&!blocked;i++){blocked=lastJson(await exec("select json_build_object('blocked',exists(select 1 from pg_stat_activity where application_name='placement-second' and wait_event_type='Lock'));" )).blocked;if(!blocked)await sleep(50);}
  assert.equal(blocked,true,'The second real session must contend on the control row');
  const a=lastJson(await first.release()),b=lastJson(await second.done);assert(a.leaseId);assert.equal(b.leaseId,null);
  await exec("update cos_mhelp_placement_private.control set lease_until=clock_timestamp()-interval '1 second';");
  const expired=lastJson(await exec("set role service_role;select public.cos_mhelp_placement_finish('"+a.leaseId+"'::uuid,'[]'::jsonb);"));assert.equal(expired.committed,false);
  assert.equal(lastJson(await exec("reset role;select json_build_object('receipts',(select count(*) from cos_mhelp_placement_private.receipts));")).receipts,0);
 }finally{await first.release().catch(()=>first.abort());if(second)await second.done.catch(()=>second.abort());}
 await exec(await readFile(new URL('../db/20261012184453_cos_sheets_placement_publisher.sql',import.meta.url),'utf8'));
 await exec('update cos_sheets_placement_private.control set enabled=true;');
 const publisherFirst=session('begin;set local role service_role;select public.cos_sheets_placement_begin();',true,'publisher-first');let publisherSecond;
 try{
  await publisherFirst.ready;publisherSecond=session('begin;set local role service_role;select public.cos_sheets_placement_begin();commit;',false,'publisher-second');
  let blocked=false;
  for(let i=0;i<40&&!blocked;i++){blocked=lastJson(await exec("select json_build_object('blocked',exists(select 1 from pg_stat_activity where application_name='publisher-second' and wait_event_type='Lock'));" )).blocked;if(!blocked)await sleep(50);}
  assert.equal(blocked,true,'Publisher workers must contend on the real control row');
  const a=lastJson(await publisherFirst.release()),b=lastJson(await publisherSecond.done);assert(a.leaseId);assert.equal(b.leaseId,null);
  await exec("update cos_sheets_placement_private.control set lease_until=clock_timestamp()-interval '1 second';");
  assert.equal(lastJson(await exec("set role service_role;select public.cos_sheets_placement_stage('"+a.leaseId+"'::uuid,'[]'::jsonb);")).committed,false);
  assert.equal(lastJson(await exec("set role service_role;select public.cos_sheets_placement_finish('"+a.leaseId+"'::uuid,'[]'::jsonb);")).committed,false);
 }finally{await publisherFirst.release().catch(()=>publisherFirst.abort());if(publisherSecond)await publisherSecond.done.catch(()=>publisherSecond.abort());}
 console.log('Real PostgreSQL placement and Sheet publisher lease contention and expired-publication checks passed.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

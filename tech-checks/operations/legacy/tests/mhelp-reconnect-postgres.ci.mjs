/** Hosted-only, synthetic Vault pair/lease races. Never accepts a supplied database or credentials. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertCiContext,connection,validateIsolatedServer,parameters} from './mhelp-postgres-concurrency.ci.mjs';
export {assertCiContext};
const literal=x=>x===null?'NULL':"'"+String(x).replaceAll("'","''")+"'";
const rows=text=>text.split(/\r?\n/).filter(x=>/^[\[{]/.test(x.trim())).map(x=>JSON.parse(x));
function session(sql,{held=false,name='reconnect-ci'}={}){
 assertCiContext();
 const child=spawn('psql',['--no-psqlrc','--quiet','--tuples-only','--no-align','--set=ON_ERROR_STOP=1','--set=VERBOSITY=verbose','--host='+connection.host,'--port='+connection.port,'--username='+connection.user,'--dbname='+connection.database],{env:{PATH:process.env.PATH,LANG:'C.UTF-8',PGPASSWORD:'synthetic-ci-only',PGAPPNAME:name,PGCONNECT_TIMEOUT:'5',PGOPTIONS:'-c statement_timeout=15000 -c lock_timeout=3000'},stdio:['pipe','pipe','pipe']});
 let out='',err='',readyResolve,readyReject;const ready=new Promise((a,b)=>{readyResolve=a;readyReject=b;});ready.catch(()=>{});const timeout=setTimeout(()=>child.kill('SIGKILL'),20000);
 const done=new Promise((a,b)=>{child.stdout.on('data',x=>{out+=x;if(out.length>1048576)child.kill('SIGKILL');if(out.includes('__RECONNECT_HELD__'))readyResolve();});child.stderr.on('data',x=>{err+=x;if(err.length>1048576)child.kill('SIGKILL');});child.on('error',e=>{clearTimeout(timeout);readyReject(e);b(e);});child.on('close',code=>{clearTimeout(timeout);if(code===0){readyResolve();a(out);}else{const e=Object.assign(Error('Synthetic reconnect database check failed: '+err),{sqlstate:err.match(/(?:ERROR|FATAL):\s+([A-Z0-9]{5}):/)?.[1]});readyReject(e);b(e);}});});done.catch(()=>{});
 child.stdin[held?'write':'end'](sql+(held?'\n\\echo __RECONNECT_HELD__\n':'\n'));
 return {ready,done,finish:async()=>{if(held&&!child.stdin.destroyed)child.stdin.end('commit;\n\\q\n');return done;},abort:()=>child.kill('SIGKILL')};
}
const exec=async sql=>session(sql).done;
const query=async(sql,args=[])=>rows(await exec("select coalesce(json_agg(row_to_json(x)),'[]'::json) from ("+parameters(sql,args)+") x;")).at(-1);
const request='00000000-0000-4000-8000-000000000901',other='00000000-0000-4000-8000-000000000902';
function invocation(action,o={}){
 const args=[literal(action),literal(o.lease??null)+'::uuid',literal(o.access??null),literal(o.refresh??null),o.expires?"(now()+interval '1 hour')":'NULL::timestamptz',literal(o.portal??null),o.revision??'NULL',literal(o.request??null)+'::uuid'];
 return `set local role service_role;select set_config('request.jwt.claim.role','service_role',true);select public.cos_mhelp_token_session(${args.join(',')});`;
}
const call=async(action,o)=>rows(await exec('begin;'+invocation(action,o)+'commit;')).at(-1);
const snapshot=async()=>({state:(await query('select revision,lease_id,lease_kind,last_reconnect_request from public.cos_mhelp_token_state'))[0],values:await query('select name,secret from vault.secrets order by name'),updates:(await query('select count(*)::int n from vault.synthetic_updates'))[0].n});
async function waitForLock(name){for(let n=0;n<50;n++){if((await query('select wait_event_type from pg_stat_activity where application_name=$1',[name])).some(x=>x.wait_event_type==='Lock'))return;await sleep(20);}throw Error('Second native session did not demonstrate contention');}
async function setup(){
 validateIsolatedServer((await query('select current_database() database,current_user account,inet_server_port() port'))[0]);
 await exec(`drop function if exists public.cos_mhelp_token_session(text,uuid,text,text,timestamptz,text,bigint,uuid);drop table if exists public.cos_mhelp_token_state;
 create schema if not exists auth;drop schema if exists vault cascade;create schema vault;
 do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end$$;
 create or replace function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
 create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text,name text unique,description text);
 create view vault.decrypted_secrets as select id,secret as decrypted_secret from vault.secrets;
 create table vault.synthetic_updates(id uuid,secret text);create table vault.synthetic_faults(fail_refresh boolean);insert into vault.synthetic_faults values(false);
 create function vault.create_secret(secret text,name text,description text) returns uuid language plpgsql as $$declare result uuid;begin insert into vault.secrets(secret,name,description) values($1,$2,$3) returning id into result;return result;end$$;
 create function vault.update_secret(secret_id uuid,new_secret text) returns void language plpgsql as $$begin if (select fail_refresh from vault.synthetic_faults) and (select name from vault.secrets where id=$1)='cos_mhelp_refresh_token_v1' then raise exception 'Synthetic second Vault update failure';end if;update vault.secrets set secret=$2 where id=$1;if not found then raise exception 'Synthetic missing secret';end if;insert into vault.synthetic_updates values($1,$2);end$$;`);
 await exec(await readFile(new URL('../../db/cos-mhelp-token-session.sql',import.meta.url),'utf8'));
 await call('bootstrap',{access:'synthetic-old-access',refresh:'synthetic-old-refresh',portal:'17'});
}
export async function main(){
 assertCiContext();await setup();
 const first=session('begin;'+invocation('reconnect_claim',{revision:1,request}),{held:true,name:'reconnect-first'});let second;
 try{await first.ready;second=session('begin;'+invocation('reconnect_claim',{revision:1,request:other})+'commit;',{name:'reconnect-second'});await waitForLock('reconnect-second');await first.finish();await assert.rejects(second.done,e=>e.sqlstate==='55P03');}finally{await first.finish().catch(()=>first.abort());if(second)await second.done.catch(()=>second.abort());}
 const lease=(await snapshot()).state.lease_id;assert(lease);await assert.rejects(call('claim'),e=>e.sqlstate==='55P03');
 const commit={lease,revision:1,request,portal:'17',access:'synthetic-new-access',refresh:'synthetic-new-refresh',expires:true};
 const saving=session('begin;'+invocation('reconnect_commit',commit),{held:true,name:'reconnect-commit-first'});let replay;
 try{await saving.ready;replay=session('begin;'+invocation('reconnect_commit',commit)+'commit;',{name:'reconnect-commit-replay'});await waitForLock('reconnect-commit-replay');const a=rows(await saving.finish()).at(-1),b=rows(await replay.done).at(-1);assert.deepEqual(a,b);assert.equal(a.committed,true);}finally{await saving.finish().catch(()=>saving.abort());if(replay)await replay.done.catch(()=>replay.abort());}
 assert.equal((await snapshot()).updates,2);assert.equal((await snapshot()).state.revision,2);
 const renew=await call('claim');await call('commit',{lease:renew.lease_id,access:'synthetic-later-access',refresh:'synthetic-later-refresh',expires:true});const later=await snapshot();await call('reconnect_commit',commit);assert.deepEqual(await snapshot(),later);assert.equal(later.state.revision,3);
 await assert.rejects(call('reconnect_claim',{revision:1,request:other}),e=>e.sqlstate==='40001');
 const failed=await call('reconnect_claim',{revision:3,request:other});await exec('update vault.synthetic_faults set fail_refresh=true;');const before=await snapshot();await assert.rejects(call('reconnect_commit',{...commit,lease:failed.lease_id,revision:3,request:other}),e=>e.sqlstate==='P0001');assert.deepEqual(await snapshot(),before);
 for(const role of ['anon','authenticated'])await assert.rejects(exec(`begin;set local role ${role};select set_config('request.jwt.claim.role','service_role',true);select public.cos_mhelp_token_session('reconnect_status');commit;`),e=>e.sqlstate==='42501');
 console.log('PASS native reconnect claim/renew exclusion, contended exact commit replay, pair rollback, later-renewal preservation and denied browser roles');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});

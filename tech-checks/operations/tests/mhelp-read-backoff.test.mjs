import test,{after} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
import {createMhelpReadBackoff,mhelpRetryAt} from '../../supabase/functions/cos-operations-pages/mhelpReadBackoff.ts';
const url='https://connect.mhelpdesk.com/api/v1.0/users/me',lease='00000000-0000-4000-8000-000000000001';
const state=(overrides={})=>({allowed:true,retryAt:null,leaseId:null,revision:0,consecutiveLimits:0,...overrides});
test('Retry-After accepts seconds and HTTP dates without shortening the requested wait',()=>{
 const now=Date.parse('2026-10-13T12:00:00Z');assert.equal(mhelpRetryAt('7200',now),'2026-10-13T14:00:00.000Z');assert.equal(mhelpRetryAt('Tue, 13 Oct 2026 14:00:00 GMT',now),'2026-10-13T14:00:00.000Z');
 for(const v of [null,'','-5','junk','0','NaN'])assert.equal(mhelpRetryAt(v,now),null);assert.equal(mhelpRetryAt('999999999999999999999',now),null);
});
test('a 429 closes concurrent reads and a cold instance observes the durable cooldown before using vendor credentials',async()=>{
 let clock=Date.now(),stored=state(),vendorCalls=0;const bodies=[];
 const gate=async b=>{bodies.push(b);if(b.p_action==='gate_limit')stored=state({allowed:false,retryAt:b.p_expires_at,revision:1,consecutiveLimits:1});return stored;};
 const make=()=>createMhelpReadBackoff({now:()=>clock,wait:async ms=>{clock+=ms;},gate,fetch:async()=>{vendorCalls++;return new Response('synthetic-provider-secret',{status:429,headers:{'Retry-After':'7200'}});}});
 assert.equal((await make().fetch(url,{headers:{Authorization:'Bearer synthetic-token'}})).status,429);
 const cold=make();assert.equal((await cold.fetch(url)).headers.get('X-COS-Mhelp-Deferred'),'1');assert.equal((await cold.fetch(url)).status,429);assert.equal(vendorCalls,1);
 assert.equal(bodies.filter(b=>b.p_action==='gate_limit').length,1);assert(!JSON.stringify(bodies).includes('synthetic'));assert.equal(cold.snapshot().deferred,2);
});
test('pacing shares request starts across callers and does not throttle unrelated platform reads',async()=>{
 let clock=1000;const starts=[],gateCalls=[];const backoff=createMhelpReadBackoff({now:()=>clock,wait:async ms=>{clock+=ms;},gate:async b=>{gateCalls.push(b);return state();},fetch:async input=>{starts.push([String(input),clock]);return new Response('{}');}});
 await Promise.all([backoff.fetch(url),backoff.fetch(url),backoff.fetch(url)]);assert.deepEqual(starts.map(x=>x[1]),[1000,1400,1800]);assert.equal(gateCalls.length,1);
 await backoff.fetch('https://tughscoxralhofrckvxy.supabase.co/rest/v1/rpc/synthetic');assert.equal(starts.at(-1)[1],1800);assert.equal(gateCalls.length,1);
});
test('missing backoff authority fails closed; cancelled queued reads never reach the vendor',async()=>{
 let calls=0;const unavailable=createMhelpReadBackoff({gate:async()=>{throw Error('synthetic transport');},fetch:async()=>{calls++;return new Response('{}');}});await assert.rejects(unavailable.fetch(url));assert.equal(calls,0);
 const controller=new AbortController();controller.abort();const cancelled=createMhelpReadBackoff({gate:async()=>state(),fetch:async()=>{calls++;return new Response('{}');}});await assert.rejects(cancelled.fetch(url,{signal:controller.signal}));assert.equal(calls,0);
});
let database;after(async()=>database?.close());
async function fixture(){
 const db=database??=new PGlite();await db.exec(`reset role;drop schema if exists cos_mhelp_placement_private cascade;drop schema if exists public cascade;create schema public;grant usage on schema public to public;drop schema if exists auth cascade;create schema auth;drop schema if exists vault cascade;create schema vault;
 do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end$$;
 create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
 create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text,name text,description text);create view vault.decrypted_secrets as select id,secret as decrypted_secret from vault.secrets;
 create function vault.create_secret(secret text,name text,description text) returns uuid language plpgsql as $$declare v uuid;begin insert into vault.secrets(secret,name,description) values($1,$2,$3) returning id into v;return v;end$$;
 create function vault.update_secret(secret_id uuid,new_secret text) returns void language sql as $$update vault.secrets set secret=$2 where id=$1$$;
 create schema cos_mhelp_placement_private;create table cos_mhelp_placement_private.control(singleton boolean primary key,enabled boolean,last_attempt_at timestamptz,last_success_at timestamptz,error_code text,lease_id uuid,lease_until timestamptz);insert into cos_mhelp_placement_private.control values(true,true,null,null,null,null,null);create table cos_mhelp_placement_private.links(id integer);
 create function public.cos_mhelp_placement_status() returns jsonb language sql security definer as $$select '{}'::jsonb$$;create function public.cos_mhelp_placement_fail(uuid) returns void language sql security definer as $$select null::void$$;
 revoke all on function public.cos_mhelp_placement_status(),public.cos_mhelp_placement_fail(uuid) from public,anon,authenticated;grant execute on function public.cos_mhelp_placement_status(),public.cos_mhelp_placement_fail(uuid) to service_role;`);
 await db.exec(await readFile(new URL('../db/cos-mhelp-token-session.sql',import.meta.url),'utf8'));
 const acls=async()=>(await db.query("select proname,proacl::text acl from pg_proc where proname in ('cos_mhelp_token_session','cos_mhelp_placement_status','cos_mhelp_placement_fail') order by proname")).rows;
 const before=await acls();await db.exec(await readFile(new URL('../../database-maintenance/cos-mhelp-shared-read-backoff.sql',import.meta.url),'utf8'));assert.deepEqual(await acls(),before);
 const call=async(action,{session=null,expires=null,revision=null}={},role='service_role')=>db.transaction(async tx=>{await tx.exec('set local role '+role);await tx.query("select set_config('request.jwt.claim.role',$1,true)",[role]);return (await tx.query('select public.cos_mhelp_token_session($1,$2::uuid,null,null,$3::timestamptz,null,$4::bigint,null) result',[action,session,expires,revision])).rows[0].result;});
 return {db,call};
}
test('actual SQL preserves ACLs, metadata-only returns, long Retry-After and exactly one recovery probe',async()=>{
 const {db,call}=await fixture();const tokensBefore=(await db.query('select * from public.cos_mhelp_token_state')).rows;
 const far=new Date(Date.now()+7200000).toISOString(),limited=await call('gate_limit',{expires:far});assert.equal(limited.allowed,false);assert(Date.parse(limited.retryAt)>=Date.parse(far));assert.equal(limited.consecutiveLimits,1);
 assert.equal((await call('gate_admit')).allowed,false);assert.equal((await call('gate_limit')).consecutiveLimits,1,'one burst does not multiply the failure streak');
 await db.exec("update cos_mhelp_placement_private.read_backoff set blocked_until=now()-interval '1 second'");
 const first=await call('gate_admit'),second=await call('gate_admit');assert.equal(first.allowed,true);assert(first.leaseId);assert.equal(second.allowed,false);
 const recovered=await call('gate_recovered',{session:first.leaseId,revision:first.revision});assert.equal(recovered.allowed,true);assert.equal(recovered.consecutiveLimits,0);
 assert.deepEqual((await db.query('select * from public.cos_mhelp_token_state')).rows,tokensBefore);assert.deepEqual((await db.query('select * from vault.secrets')).rows,[]);assert(!JSON.stringify(limited).includes('token'));
 for(const role of ['anon','authenticated'])await assert.rejects(call('gate_read',{},role),e=>e.code==='42501');
 assert.equal((await db.query("select has_table_privilege('authenticated','cos_mhelp_placement_private.read_backoff','select') ok")).rows[0].ok,false);
});
test('actual SQL does not allow an older successful probe to clear a later 429',async()=>{
 const {db,call}=await fixture();await call('gate_limit');await db.exec("update cos_mhelp_placement_private.read_backoff set blocked_until=now()-interval '1 second'");const old=await call('gate_admit');await call('gate_limit');const stale=await call('gate_recovered',{session:old.leaseId,revision:old.revision});assert.equal(stale.allowed,false);assert.equal(stale.consecutiveLimits,1);
});

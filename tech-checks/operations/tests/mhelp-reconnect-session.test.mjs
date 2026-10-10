/** Real SQL contract; synthetic local Vault/auth only. No network or credentials.
 * PGlite queues sessions: these tests prove serialized race interleavings, not
 * multi-backend PostgreSQL lock scheduling.
 */
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const sql=await readFile(new URL('../db/cos-mhelp-token-session.sql',import.meta.url),'utf8');
const portal='224643',request='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',oldLease='00000000-0000-4000-8000-000000000003';
const expiry=()=>new Date(Date.now()+3600000).toISOString();
let database;after(async()=>database?.close());
const rpc=`select public.cos_mhelp_token_session($1::text,$2::uuid,$3::text,$4::text,$5::timestamptz,$6::text,$7::bigint,$8::uuid) result`;
async function fixture({legacy=false}={}){
 const db=database ||= new PGlite();
 await db.exec(`reset role;
 drop schema if exists public cascade;create schema public;grant usage on schema public to public;
 drop schema if exists auth cascade;create schema auth;
 drop schema if exists vault cascade;create schema vault;
 do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;
 end$$;
 create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
 create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text,name text unique,description text);
 create view vault.decrypted_secrets as select id,secret as decrypted_secret from vault.secrets;
 create table vault.synthetic_faults(fail_refresh boolean);insert into vault.synthetic_faults values(false);
 create table vault.synthetic_updates(id uuid,secret text);
 create function vault.create_secret(secret text,name text,description text) returns uuid language plpgsql as $$
 declare result uuid;begin
 insert into vault.secrets(secret,name,description) values($1,$2,$3) returning id into result;return result;end$$;
 create function vault.update_secret(secret_id uuid,new_secret text) returns void language plpgsql as $$begin
 if (select fail_refresh from vault.synthetic_faults) and (select name from vault.secrets where id=$1)='cos_mhelp_refresh_token_v1' then
 raise exception 'Synthetic second Vault update failure';end if;
 update vault.secrets set secret=$2 where id=$1;
 if not found then raise exception 'Synthetic missing Vault secret';end if;
 insert into vault.synthetic_updates values($1,$2);end$$;`);
 if(legacy){
  await db.exec(sql.slice(sql.indexOf('create table if not exists'),sql.indexOf('alter table public.cos_mhelp_token_state')));
  await db.exec(`create function public.cos_mhelp_token_session(text,uuid default null,text default null,text default null,timestamptz default null,text default null) returns jsonb language sql as $$select '{"legacy":true}'::jsonb$$;
  revoke all on function public.cos_mhelp_token_session(text,uuid,text,text,timestamptz,text) from public,anon,authenticated;
  grant execute on function public.cos_mhelp_token_session(text,uuid,text,text,timestamptz,text) to service_role;
  insert into public.cos_mhelp_token_state(singleton,portal_id,access_secret_id,refresh_secret_id,lease_id,lease_until)
  values(true,'${portal}',vault.create_secret('synthetic-old-access','cos_mhelp_access_token_v1','synthetic'),vault.create_secret('synthetic-old-refresh','cos_mhelp_refresh_token_v1','synthetic'),'${oldLease}',now()+interval '120 seconds');`);
 }
 await db.exec(sql);
 const asRole=(role,jwt,query,args=[])=>db.transaction(async tx=>{
  assert(['anon','authenticated','service_role'].includes(role));await tx.exec(`set local role ${role}`);
  await tx.query("select set_config('request.jwt.claim.role',$1,true)",[jwt]);return tx.query(query,args);
 });
 const call=async(action,o={})=>(await asRole('service_role','service_role',rpc,[action,o.session??null,o.access??null,o.refresh??null,o.expires??null,o.portal??null,o.revision??null,o.request??null])).rows[0].result;
 const bootstrap=()=>call('bootstrap',{portal,access:'synthetic-old-access',refresh:'synthetic-old-refresh'});
 const state=async()=>(await db.query('select * from public.cos_mhelp_token_state')).rows[0];
 const snapshot=async()=>({state:await state(),secrets:(await db.query('select * from vault.secrets order by name')).rows,updates:(await db.query('select * from vault.synthetic_updates order by id,secret')).rows});
 const claim=(o={})=>call('reconnect_claim',{revision:1,request,...o});
 const commit=(lease,o={})=>call('reconnect_commit',{session:lease,portal,revision:1,request,access:'synthetic-new-access',refresh:'synthetic-new-refresh',expires:expiry(),...o});
 return {db,asRole,call,bootstrap,state,snapshot,claim,commit};
}
const deny=(promise,code)=>assert.rejects(promise,error=>error.code===code);
function metadata(value,keys){assert.deepEqual(Object.keys(value).sort(),keys.sort());assert.doesNotMatch(JSON.stringify(value),/synthetic-|access_token|refresh_token|secret|client_id/i);}
async function released(f){const s=await f.state();for(const k of ['lease_id','lease_until','lease_kind','lease_revision','lease_request_id'])assert.equal(s[k],null,k);}

test('SQL transactional upgrade removes old overload and preserves in-flight renewal and six-argument clients',async()=>{
 const f=await fixture({legacy:true});assert.match(sql,/\bbegin;/);assert.match(sql,/commit;\s*$/);
 assert.match(sql,/pg_advisory_xact_lock\(hashtextextended\('cos-mhelp-token-state-v1',0\)\)/);assert.match(sql,/where singleton for update/);
 const funcs=(await f.db.query("select pronargs,pronargdefaults from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' and proname='cos_mhelp_token_session'")).rows;
 assert.deepEqual(funcs,[{pronargs:8,pronargdefaults:7}]);assert.equal((await f.state()).lease_kind,'renew');
 const result=await f.asRole('service_role','service_role','select public.cos_mhelp_token_session($1::text,$2::uuid,$3::text,$4::text,$5::timestamptz,$6::text) result',['commit',oldLease,'synthetic-renewed-access','synthetic-renewed-refresh',expiry(),null]);
 assert.deepEqual(result.rows[0].result,{committed:true});assert.equal((await f.state()).revision,2);await released(f);
 await f.db.exec(sql);assert.equal((await f.call('read')).access_token,'synthetic-renewed-access');
});
test('SQL denies browser roles all RPC and direct-table access, even with forged service claims',async()=>{
 const f=await fixture();await f.bootstrap();
 for(const role of ['anon','authenticated']){
  for(const action of ['read','bootstrap','claim','commit','release','reconnect_status','reconnect_claim','reconnect_commit'])await deny(f.asRole(role,'service_role',rpc,[action,null,null,null,null,null,1,request]),'42501');
  for(const query of ['select * from public.cos_mhelp_token_state','update public.cos_mhelp_token_state set revision=99','select * from vault.decrypted_secrets'])await deny(f.asRole(role,role,query),'42501');
 }
 await deny(f.asRole('service_role','authenticated',rpc,['reconnect_status',null,null,null,null,null,null,null]),'42501');
 await deny(f.asRole('service_role','service_role','update public.cos_mhelp_token_state set revision=99'),'42501');
 const grants=(await f.db.query(`select has_function_privilege('anon','public.cos_mhelp_token_session(text,uuid,text,text,timestamptz,text,bigint,uuid)','execute') anon,has_function_privilege('authenticated','public.cos_mhelp_token_session(text,uuid,text,text,timestamptz,text,bigint,uuid)','execute') authenticated,has_function_privilege('service_role','public.cos_mhelp_token_session(text,uuid,text,text,timestamptz,text,bigint,uuid)','execute') service,relrowsecurity from pg_class where oid='public.cos_mhelp_token_state'::regclass`)).rows[0];
 assert.deepEqual(grants,{anon:false,authenticated:false,service:true,relrowsecurity:true});
});
test('SQL reconnect status and claim are metadata-only and do not read Vault',async()=>{
 const f=await fixture();assert.deepEqual(await f.call('reconnect_status'),{configured:false,portal_id:null,revision:null});assert.deepEqual(await f.claim(),{configured:false});
 await f.bootstrap();const before=await f.snapshot();assert.deepEqual(await f.call('reconnect_status'),{configured:true,portal_id:portal,revision:1});assert.deepEqual(await f.snapshot(),before);
 await f.db.exec('drop view vault.decrypted_secrets');const claim=await f.claim();metadata(claim,['configured','portal_id','revision','lease_id']);
 const status=await f.call('reconnect_status',{revision:1,request});metadata(status,['configured','portal_id','revision','committed','in_progress']);assert.equal(status.committed,false);assert.equal(status.in_progress,true);
 for(const o of [{revision:1,request:other},{revision:2,request},{request}])assert.equal((await f.call('reconnect_status',o)).in_progress,false);
});
test('SQL claim requires request ID and positive revision; stale or cross-portal forms preserve everything',async()=>{
 const f=await fixture();for(const o of [{revision:null},{revision:0},{revision:-1},{request:null}])await deny(f.claim(o),'22023');
 await f.bootstrap();const before=await f.snapshot();await deny(f.claim({revision:2}),'40001');await deny(f.claim({portal:'999'}),'22023');assert.deepEqual(await f.snapshot(),before);
});
test('SQL duplicate and competing claims obtain only one usable lease and stale forms fail',async()=>{
 const f=await fixture();await f.bootstrap();const attempts=await Promise.allSettled([f.claim(),f.claim(),f.claim({request:other})]);
 assert.equal(attempts.filter(v=>v.status==='fulfilled').length,1);for(const v of attempts.filter(v=>v.status==='rejected'))assert.equal(v.reason.code,'55P03');
 const winner=attempts.find(v=>v.status==='fulfilled').value;assert.equal((await f.state()).lease_id,winner.lease_id);assert.equal((await f.state()).lease_request_id,request);
 const before=await f.snapshot();await deny(f.claim(),'55P03');assert.deepEqual(await f.snapshot(),before);
 const result=await f.commit(winner.lease_id);metadata(result,['committed','portal_id','revision']);assert.deepEqual(result,{committed:true,portal_id:portal,revision:2});await released(f);await deny(f.claim({request:other}),'40001');
});
test('SQL renewal and reconnect mutually exclude each other and reject each other\'s leases',async()=>{
 const f=await fixture();await f.bootstrap();const renew=await f.call('claim'),before=await f.snapshot();await deny(f.claim(),'55P03');await deny(f.commit(renew.lease_id),'22023');assert.deepEqual(await f.snapshot(),before);
 await f.call('release',{session:renew.lease_id});await released(f);const reconnect=await f.claim(),held=await f.snapshot();await deny(f.call('claim'),'55P03');
 await deny(f.call('commit',{session:reconnect.lease_id,access:'synthetic-new-access',refresh:'synthetic-new-refresh',expires:expiry()}),'22023');assert.deepEqual(await f.snapshot(),held);
 await f.call('release',{session:reconnect.lease_id});await released(f);assert.equal((await f.call('claim')).refresh_token,'synthetic-old-refresh');
});
test('SQL reconnect checks lease/request/revision/portal and token pair before any Vault writes',async()=>{
 const f=await fixture();await f.bootstrap();const claim=await f.claim(),before=await f.snapshot();
 for(const [o,code] of [[{session:null},'22023'],[{session:oldLease},'22023'],[{request:other},'22023'],[{revision:2},'40001'],[{revision:null},'22023'],[{portal:'999'},'22023'],[{portal:null},'22023'],[{access:null},'22023'],[{access:''},'22023'],[{access:'bad token'},'22023'],[{access:'x'.repeat(16385)},'22023'],[{refresh:null},'22023'],[{refresh:''},'22023'],[{refresh:'bad\nrefresh'},'22023'],[{refresh:'x'.repeat(16385)},'22023'],[{expires:null},'22023'],[{expires:new Date(Date.now()-1000).toISOString()},'22023'],[{expires:new Date(Date.now()+3*86400000).toISOString()},'22023']]){
  await deny(f.commit(claim.lease_id,o),code);assert.deepEqual(await f.snapshot(),before);
 }
});
test('SQL expired/replaced leases cannot commit or release a newer request',async()=>{
 const f=await fixture();await f.bootstrap();const first=await f.claim();await f.db.exec("update public.cos_mhelp_token_state set lease_until=now()-interval '1 second'");
 const expired=await f.snapshot();await deny(f.commit(first.lease_id),'22023');assert.deepEqual(await f.snapshot(),expired);assert.equal((await f.call('reconnect_status',{revision:1,request})).in_progress,false);
 const newer=await f.claim();assert.notEqual(newer.lease_id,first.lease_id);const before=await f.snapshot();await deny(f.commit(first.lease_id),'22023');await f.call('release',{session:first.lease_id});assert.deepEqual(await f.snapshot(),before);await f.commit(newer.lease_id);await released(f);
});
test('SQL second Vault-write failure atomically restores both secrets, revision and receipt',async()=>{
 const f=await fixture();await f.bootstrap();const claim=await f.claim();await f.db.exec('update vault.synthetic_faults set fail_refresh=true');const before=await f.snapshot();
 await assert.rejects(f.commit(claim.lease_id),/Synthetic second Vault update failure/);assert.deepEqual(await f.snapshot(),before);assert.equal((await f.call('reconnect_status',{revision:1,request})).committed,false);
 await f.db.exec('update vault.synthetic_faults set fail_refresh=false');await f.commit(claim.lease_id);assert.equal((await f.state()).revision,2);assert.deepEqual((await f.snapshot()).secrets.map(s=>s.secret),['synthetic-new-access','synthetic-new-refresh']);
});
test('SQL exact reconnect replay survives later normal renewal without reverting either value',async()=>{
 const f=await fixture();await f.bootstrap();const claim=await f.claim(),committed=await f.commit(claim.lease_id),once=await f.snapshot();
 assert.deepEqual(await f.commit(claim.lease_id),committed);assert.deepEqual(await f.claim(),committed);assert.deepEqual(await f.snapshot(),once);
 const renew=await f.call('claim');assert.equal(renew.refresh_token,'synthetic-new-refresh');await f.call('commit',{session:renew.lease_id,access:'synthetic-later-access',refresh:'synthetic-later-refresh',expires:expiry()});
 const current=await f.snapshot();assert.equal(current.state.revision,3);assert.deepEqual(await f.commit(claim.lease_id),committed);assert.deepEqual(await f.claim(),committed);assert.deepEqual(await f.snapshot(),current);
 assert.deepEqual(await f.call('reconnect_status',{revision:1,request}),{configured:true,portal_id:portal,revision:2,committed:true,in_progress:false});
 for(const o of [{revision:3,request},{request},{revision:1,request:other}])assert.equal((await f.call('reconnect_status',o)).committed,false);
 for(const o of [{session:oldLease},{portal:'999'},{revision:3},{session:null}])await deny(f.commit(claim.lease_id,o),'22023');await deny(f.claim({revision:3}),'22023');assert.deepEqual(await f.snapshot(),current);
 assert.deepEqual(await f.call('commit',{session:renew.lease_id}),{committed:true});assert.deepEqual(await f.snapshot(),current);
});
test('SQL committed reconnect replay does not disturb a later active renewal lease',async()=>{
 const f=await fixture();await f.bootstrap();const first=await f.claim(),committed=await f.commit(first.lease_id);await f.call('claim');const before=await f.snapshot();assert.deepEqual(await f.claim(),committed);assert.deepEqual(await f.commit(first.lease_id),committed);assert.deepEqual(await f.snapshot(),before);
});
test('SQL legacy read/bootstrap/renew/release behavior remains and normal renewal invalidates stale forms',async()=>{
 const f=await fixture();assert.deepEqual(await f.call('read'),{configured:false});const initial=await f.bootstrap();assert.equal(initial.access_token,'synthetic-old-access');assert.equal(initial.revision,1);const before=await f.snapshot();
 assert.deepEqual(await f.call('bootstrap',{portal:'999',access:'synthetic-unwanted',refresh:'synthetic-unwanted'}),initial);assert.deepEqual(await f.snapshot(),before);
 const renew=await f.call('claim');assert.equal(renew.access_token,'synthetic-old-access');assert.equal(renew.refresh_token,'synthetic-old-refresh');assert.deepEqual(await f.call('commit',{session:renew.lease_id,access:'synthetic-normal-access',refresh:'synthetic-normal-refresh',expires:expiry()}),{committed:true});
 await released(f);const next=await f.snapshot();await deny(f.claim(),'40001');assert.deepEqual(await f.snapshot(),next);assert.equal((await f.call('read')).access_token,'synthetic-normal-access');assert.equal((await f.claim({revision:2,request:other})).revision,2);
});

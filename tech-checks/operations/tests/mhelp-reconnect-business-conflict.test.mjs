/** Local synthetic Vault/state only. Never calls a live service or reads credentials. */
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {nativeMhelpTokens} from '../../supabase/functions/cos-operations-pages/mhelpTokenRuntime.ts';
import {MhelpReconnectError} from '../../supabase/functions/cos-operations-pages/mhelpReconnect.ts';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const migration=await read('../../database-maintenance/cos-mhelp-reconnect-business-conflict.sql');
const signature='public.cos_mhelp_token_session(text,uuid,text,text,timestamptz,text,bigint,uuid)';
const old="raise exception 'mHelp reconnect configuration changed' using errcode='40001';";
const fixed=old.replace('40001','PT409');
const request='00000000-0000-4000-8000-000000000001',lease='00000000-0000-4000-8000-000000000002';
let database;after(async()=>database?.close());
async function fixture({legacy=true,backoff=true}={}){
 const db=database??=new PGlite();
 await db.exec(`reset role;drop schema if exists cos_mhelp_placement_private cascade;drop schema if exists public cascade;create schema public;grant usage on schema public to public;drop schema if exists auth cascade;create schema auth;drop schema if exists vault cascade;create schema vault;
 do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end$$;
 create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
 create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text,name text,description text);create view vault.decrypted_secrets as select id,secret as decrypted_secret from vault.secrets;
 create function vault.create_secret(secret text,name text,description text) returns uuid language plpgsql as $$declare v uuid;begin insert into vault.secrets(secret,name,description) values($1,$2,$3) returning id into v;return v;end$$;
 create function vault.update_secret(secret_id uuid,new_secret text) returns void language sql as $$update vault.secrets set secret=$2 where id=$1$$;
 create schema cos_mhelp_placement_private;create table cos_mhelp_placement_private.control(singleton boolean primary key,enabled boolean,last_attempt_at timestamptz,last_success_at timestamptz,error_code text,lease_id uuid,lease_until timestamptz);insert into cos_mhelp_placement_private.control values(true,true,null,null,null,null,null);create table cos_mhelp_placement_private.links(id integer);
 create function public.cos_mhelp_placement_status() returns jsonb language sql security definer as $$select '{}'::jsonb$$;create function public.cos_mhelp_placement_fail(uuid) returns void language sql security definer as $$select null::void$$;
 revoke all on function public.cos_mhelp_placement_status(),public.cos_mhelp_placement_fail(uuid) from public,anon,authenticated;grant execute on function public.cos_mhelp_placement_status(),public.cos_mhelp_placement_fail(uuid) to service_role;`);
 const install=async path=>{const source=await read(path);await db.exec(legacy?source.replace(fixed,old):source);};
 await install('../db/cos-mhelp-token-session.sql');
 if(backoff)await install('../../database-maintenance/cos-mhelp-shared-read-backoff.sql');
 const call=(action,o={},role='service_role')=>db.transaction(async tx=>{
  await tx.exec('set local role '+role);await tx.query("select set_config('request.jwt.claim.role',$1,true)",[role]);
  return (await tx.query('select public.cos_mhelp_token_session($1,$2::uuid,$3,$4,$5::timestamptz,$6,$7::bigint,$8::uuid) result',
   [action,o.session??null,o.access??null,o.refresh??null,o.expires??null,o.portal??null,o.revision??null,o.request??null])).rows[0].result;
 });
 const snapshot=async()=>({state:(await db.query('select * from public.cos_mhelp_token_state')).rows,vault:(await db.query('select * from vault.secrets order by name')).rows,backoff:(await db.query("select to_regclass('cos_mhelp_placement_private.read_backoff') present")).rows[0].present?(await db.query('select * from cos_mhelp_placement_private.read_backoff')).rows:null});
 const catalog=async()=>(await db.query(`select p.oid::regprocedure::text signature,to_jsonb(p) attributes,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','vault','auth','cos_mhelp_placement_private') and p.prokind='f' order by p.oid`)).rows;
 const tables=async()=>(await db.query(`select c.oid::regclass::text relation,to_jsonb(c) attributes from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','vault','auth','cos_mhelp_placement_private') order by c.oid`)).rows;
 const bootstrap=()=>call('bootstrap',{portal:'17',access:'synthetic-old-access',refresh:'synthetic-old-refresh'});
 return {db,call,snapshot,catalog,tables,bootstrap};
}
const conflict=e=>e.code==='PT409'&&e.message==='mHelp reconnect configuration changed';
test('guarded migration changes exactly one raise and preserves all catalog metadata, tables and state',async()=>{
 const f=await fixture();await f.bootstrap();await f.call('claim');await f.call('gate_limit');
 const before=await f.catalog(),tables=await f.tables(),state=await f.snapshot();
 const target=before.find(r=>r.signature.startsWith('cos_mhelp_token_session('));assert(target.definition.includes(old));
 assert.equal((await f.db.query('select md5(pg_get_functiondef($1::regprocedure)) hash',[signature])).rows[0].hash,'e45d53dfe5e50e91a687fd44b03d4050');
 await f.db.exec(migration);
 const expected=before.map(r=>r===target?{...r,attributes:{...r.attributes,prosrc:r.attributes.prosrc.replace(old,fixed)},definition:r.definition.replace(old,fixed)}:r);
 assert.deepEqual(await f.catalog(),expected,'OID, owner, ACL, SECURITY DEFINER, defaults and search_path preserved; every other function unchanged');
 assert.deepEqual(await f.tables(),tables,'tables, RLS and grants unchanged');assert.deepEqual(await f.snapshot(),state,'in-flight renewal, revision, synthetic Vault and shared backoff unchanged');
 await f.db.exec(migration);assert.deepEqual(await f.catalog(),expected);assert.deepEqual(await f.snapshot(),state);
});
test('stale reconnect claim and commit return PT409 before writes; valid reconnect, replay and normal token reads survive',async()=>{
 const f=await fixture();await f.bootstrap();await f.db.exec(migration);
 let before=await f.snapshot();for(let i=0;i<3;i++)await assert.rejects(f.call('reconnect_claim',{revision:2,request}),conflict);assert.deepEqual(await f.snapshot(),before);
 const claimed=await f.call('reconnect_claim',{revision:1,request});before=await f.snapshot();
 await assert.rejects(f.call('reconnect_commit',{revision:2,request,session:claimed.lease_id}),conflict);assert.deepEqual(await f.snapshot(),before);
 const input={revision:1,request,session:claimed.lease_id,portal:'17',access:'synthetic-new-access',refresh:'synthetic-new-refresh',expires:new Date(Date.now()+3600000).toISOString()};
 const committed=await f.call('reconnect_commit',input);assert.deepEqual(committed,{committed:true,portal_id:'17',revision:2});before=await f.snapshot();
 assert.deepEqual(await f.call('reconnect_commit',input),committed);assert.deepEqual(await f.snapshot(),before);
 assert.equal((await f.call('read')).access_token,'synthetic-new-access');assert.equal((await f.call('claim')).refresh_token,'synthetic-new-refresh');
 for(const role of ['anon','authenticated'])await assert.rejects(f.call('reconnect_status',{},role),e=>e.code==='42501');
});
test('migration refuses definition, SECURITY DEFINER, search_path and ACL drift and missing routine',async()=>{
 for(const change of [
  `alter function ${signature} security invoker`,
  `alter function ${signature} set search_path=public`,
  `grant execute on function ${signature} to authenticated`,
  `drop function ${signature}`,
 ]){
  const f=await fixture();await f.bootstrap();await f.db.exec(change);const before=await f.catalog(),state=await f.snapshot();
  await assert.rejects(f.db.exec(migration),e=>e.code==='P0001'&&/refresh the reviewed migration/.test(e.message));await f.db.exec('rollback');
  assert.deepEqual(await f.catalog(),before);assert.deepEqual(await f.snapshot(),state);
 }
 const f=await fixture(),rows=await f.catalog(),definition=rows.find(r=>r.signature.startsWith('cos_mhelp_token_session(')).definition;
 await f.db.exec(definition.replace(old,old+' -- unreviewed change'));const before=await f.catalog();
 await assert.rejects(f.db.exec(migration),e=>e.code==='P0001');await f.db.exec('rollback');assert.deepEqual(await f.catalog(),before);
});
test('fresh canonical setup and base reapplication retain PT409; later maintenance is a no-op',async()=>{
 const f=await fixture({legacy:false,backoff:false}),base=await read('../db/cos-mhelp-token-session.sql'),backoff=await read('../../database-maintenance/cos-mhelp-shared-read-backoff.sql');
 for(const sql of [base,backoff]){assert(sql.includes(fixed));assert(!sql.includes(old));}
 await f.bootstrap();await assert.rejects(f.call('reconnect_claim',{revision:2,request}),conflict);
 const state=await f.snapshot();await f.db.exec(base);assert.deepEqual(await f.snapshot(),state);await assert.rejects(f.call('reconnect_claim',{revision:2,request}),conflict);
 assert.equal((await f.db.query('select md5(pg_get_functiondef($1::regprocedure)) hash',[signature])).rows[0].hash,'708e5a62ca5302e320cc447a0e8dc11a');
 await f.db.exec(backoff);assert.equal((await f.db.query('select md5(pg_get_functiondef($1::regprocedure)) hash',[signature])).rows[0].hash,'201eaf0fe35e26bd21f249682ff328c8');
 const catalog=await f.catalog(),tables=await f.tables(),current=await f.snapshot();await f.db.exec(migration);await f.db.exec(migration);
 assert.deepEqual(await f.catalog(),catalog);assert.deepEqual(await f.tables(),tables);assert.deepEqual(await f.snapshot(),current);
 await assert.rejects(f.call('reconnect_claim',{revision:2,request}),conflict);
 await assert.rejects(f.db.exec(backoff),e=>e.code==='40001'&&/Token control changed/.test(e.message));
 assert.deepEqual(await f.catalog(),catalog);assert.deepEqual(await f.snapshot(),current,'install-once backoff reapply fails closed before changing runtime or state');
});
test('canonical backoff definition cannot undo an existing-install PT409 repair',async()=>{
 const f=await fixture();await f.bootstrap();await f.db.exec(migration);await f.call('gate_limit');
 const source=await read('../../database-maintenance/cos-mhelp-shared-read-backoff.sql'),start=source.indexOf('CREATE OR REPLACE FUNCTION public.cos_mhelp_token_session('),end=source.indexOf('$function$;',start)+'$function$;'.length;
 assert(start>=0&&end>start);const before=await f.catalog(),state=await f.snapshot();
 await f.db.exec(source.slice(start,end));assert.deepEqual(await f.catalog(),before);assert.deepEqual(await f.snapshot(),state);
 await assert.rejects(f.call('reconnect_claim',{revision:2,request}),conflict);
});

const native='https://tughscoxralhofrckvxy.supabase.co',secret='synthetic-private-response';
const body={accessToken:'synthetic-input-access',refreshToken:'synthetic-input-refresh',expectedRevision:1,requestId:request};
function runtime({failAt='reconnect_claim',code='PT409',status=409,errorBody,failures=Infinity}={}){
 const actions=[],vendor=[];let remaining=failures;
 const env=name=>({SUPABASE_URL:native,SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',COS_MHELP_CLIENT_ID:'synthetic-client',COS_MHELP_CLIENT_SECRET:'synthetic-secret'})[name];
 const json=(v,status=200)=>Response.json(v,{status});
 const manager=nativeMhelpTokens(env,async(url,init)=>{
  if(String(url).endsWith('/rpc/cos_mhelp_request_budget')){assert.equal(typeof JSON.parse(init.body).p_essential,'boolean');return json({allowed:true,reason:null,retryAt:null});}
  if(String(url).startsWith(native)){
   const request=JSON.parse(init.body);actions.push(request.p_action);
   if(request.p_action===failAt&&remaining-->0)return errorBody===undefined?json({code,message:secret,details:secret,hint:secret},status):new Response(errorBody,{status});
   if(request.p_action==='gate_admit')return json({allowed:true,retryAt:null,leaseId:null,revision:0,consecutiveLimits:0});
   if(request.p_action==='reconnect_claim')return json({configured:true,portal_id:'17',revision:1,lease_id:lease});
   if(request.p_action==='reconnect_commit')return json({committed:true,portal_id:'17',revision:2});
   if(request.p_action==='release')return json({released:true});
   throw Error('Unexpected local action');
  }
  vendor.push(String(url));return String(url).includes('/connect/token')?json({access_token:'synthetic-issued',refresh_token:'synthetic-rotated',token_type:'Bearer',expires_in:3600}):json({portalId:17});
 });
 return {manager,actions,vendor};
}
const sanitized=(e,status)=>e instanceof MhelpReconnectError&&e.status===status&&!JSON.stringify(e).includes(secret)&&!e.message.includes(secret)&&e.cause===undefined;
test('PT409 claim fails once with sanitized reopen instruction and no vendor request',async()=>{
 const f=runtime();await assert.rejects(f.manager.reconnect.reconnect(body,async()=>{}),e=>sanitized(e,409)&&/Reopen reconnect/.test(e.message));
 assert.deepEqual(f.actions,['reconnect_claim']);assert.deepEqual(f.vendor,[]);
});
test('verified Owner reconnect route returns the mapped 409 without SQL details or retrying',async()=>{
 const f=runtime(),owner='e4abc521-1ef3-45a6-9829-b87faff78210',actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
 const handler=createOperationsHandler({platformUrl:'https://fixture.invalid',serviceKey:'synthetic-service',mhelpReconnect:f.manager.reconnect,fetch:async url=>{
  if(url.includes('/auth/v1/user'))return Response.json({id:owner});
  if(url.includes('/profiles?'))return Response.json([{user_id:owner,role:'owner',active:true,archived_at:null}]);
  if(url.includes('/user_profiles?'))return Response.json([{user_id:actor,department:'owner',active:true}]);
  if(url.includes('/user_roles?'))return Response.json([{role_id:lease,roles:{code:'owner',organization_id:org}}]);
  throw Error('Unexpected local authorization read');
 }});
 const response=await handler(new Request('https://fixture.invalid/functions/v1/cos-operations-pages',{
  method:'POST',headers:{authorization:'Bearer synthetic-owner',origin:'https://cypressriveroasis2023-sudo.github.io','content-type':'application/json'},
  body:JSON.stringify({path:'/api/mhelpdesk/partner/reconnect',method:'POST',body}),
 }));
 assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'The mHelp connection changed. Reopen reconnect before trying again.'});assert.deepEqual(f.actions,['reconnect_claim']);assert.deepEqual(f.vendor,[]);
});
test('PT409 commit is not retried, never rotates twice, and retains uncertain upstream lease',async()=>{
 const f=runtime({failAt:'reconnect_commit'});await assert.rejects(f.manager.reconnect.reconnect(body,async()=>{}),e=>sanitized(e,409));
 assert.equal(f.actions.filter(a=>a==='reconnect_commit').length,1);assert(!f.actions.includes('release'));assert.equal(f.vendor.filter(u=>u.includes('/connect/token')).length,1);
});
test('unrelated errors stay sanitized and true serialization or lost acknowledgements keep bounded retry',async()=>{
 for(const options of [{code:'40001',status:500},{code:'23505'},{code:'PT409',status:500},{errorBody:'invalid '+secret},{errorBody:'x'.repeat(65537)}]){
  const f=runtime(options);await assert.rejects(f.manager.reconnect.reconnect(body,async()=>{}),e=>sanitized(e,503));assert.deepEqual(f.actions,['reconnect_claim']);assert.deepEqual(f.vendor,[]);
 }
 const f=runtime({failAt:'reconnect_commit',code:'40001',status:500,failures:1});assert.equal((await f.manager.reconnect.reconnect(body,async()=>{})).state,'committed');assert.equal(f.actions.filter(a=>a==='reconnect_commit').length,2);assert.equal(f.vendor.filter(u=>u.includes('/connect/token')).length,1);
 const normal=runtime({failAt:'read'});await assert.rejects(normal.manager.getPartnerConfig(),e=>e.message==='Token storage unavailable');assert.deepEqual(normal.actions,['read']);
});

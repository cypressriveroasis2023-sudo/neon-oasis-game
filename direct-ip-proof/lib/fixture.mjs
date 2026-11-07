/** Disposable synthetic catalog. Local PGlite or explicitly gated hosted PostgreSQL. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {openDatabase,selectedBackend} from './database.mjs';

// Freeze one local SQL input for this Node process, including multi-fixture runs.
const draftSource=await readFile(new URL('../inputs/direct-ip-attempt-local.sql',import.meta.url),'utf8');
const draftSqlSha256=createHash('sha256').update(draftSource).digest('hex');

export const ORIGINAL_PUBLISHER_SHA256='ade4074d7fbbb2b0023a098c47cb7ff5a69ca08125d91208939615c408a2644a';
export const MINUTE=60_000;
export const TEST_START=Date.parse('2026-10-14T12:00:00.000Z');
export const attemptId=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
export const refused=(port=443)=>({port,state:'refused',latency_ms:null,reason:'connection_refused'});
export const unknown=(port=443,reason='probe_unverified')=>({port,state:'unverified',latency_ms:null,reason});
export const connected=(port=443)=>({port,state:'connected',latency_ms:1,reason:null});
const clone=value=>structuredClone(value);
const identifier=value=>{assert.match(value,/^[a-z_][a-z0-9_]*$/);return '"'+value+'"';};
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";

export async function resetFixtureCatalog(pg,expectedDatabase='direct_ip_proof') {
  assert.equal((await pg.query('select current_database() as db')).rows[0].db,expectedDatabase);
  await pg.exec(`reset role;drop schema if exists camera_direct_health_private cascade;
   drop schema if exists direct_ip_test_clock cascade;drop schema if exists auth cascade;
   drop schema if exists acl_sentinel cascade;drop schema if exists public cascade;`);
  // Test-only role/default cleanup in this disposable service, never a release
  // operation. Unknown roles fail rather than being removed.
  const fixtures=new Set(['acl_fixture_owner','acl_sentinel_reader','acl_test_superuser','acl_writer','inherited_local_writer','zz_acl_group','zz_acl_middle']);
  const roles=(await pg.query("select rolname from pg_roles where rolname !~ '^pg_' and rolname not in ('postgres','anon','authenticated','service_role')")).rows;
  for(const {rolname} of roles){assert(fixtures.has(rolname),'Unexpected role in disposable service: '+rolname);await pg.exec('drop owned by '+identifier(rolname)+' cascade;drop role '+identifier(rolname));}
  const members=(await pg.query("select r.rolname as role,m.rolname as member from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member where m.rolname in ('anon','authenticated','service_role')")).rows;
  for(const row of members)await pg.exec('revoke '+identifier(row.role)+' from '+identifier(row.member));
  const known=(await pg.query("select rolname from pg_roles where rolname in ('anon','authenticated','service_role')")).rows;
  for(const role of ['public',...known.map(r=>r.rolname)]) {
   const grantee=role==='public'?'public':identifier(role);
   await pg.exec('alter default privileges revoke all on tables from '+grantee+';alter default privileges revoke all on schemas from '+grantee);
  }
  await pg.exec('create schema public;');
}

export async function createFixture({backend=selectedBackend(),syntheticClock=false,ports=[443],install=true}={}) {
 const database=await openDatabase(backend),pg=database.pg;
 try {
 // Every call owns a disposable fixture. Hosted tests are sequential and target
 // only the fixed direct_ip_proof database, never an arbitrary connection URL.
 if(backend==='postgres')await resetFixtureCatalog(pg);
 for(const name of ['schema','baseline'])await pg.exec(await readFile(new URL('../inputs/'+name+'.sql',import.meta.url),'utf8'));
 // Fixture-only equivalent of the normal public-schema USAGE, lost on reset.
 if(backend==='postgres') {
  await pg.exec('grant usage on schema public to service_role;');
  for(const role of ['anon','authenticated','service_role']) {
   const rights=(await pg.query("select has_schema_privilege($1,'public','USAGE') as usage,has_schema_privilege($1,'public','CREATE') as create",[role])).rows[0];
   assert.deepEqual(rights,{usage:role==='service_role',create:false},'reset public-schema fixture ACL must not depend on preceding tests');
  }
 }
 const original=await pg.query("select encode(sha256(convert_to(pg_get_functiondef('public.publish_camera_connection_v1(bigint,bigint,inet,integer[],text,jsonb,text)'::regprocedure),'UTF8')),'hex') as sha");
 assert.equal(original.rows[0].sha,ORIGINAL_PUBLISHER_SHA256);
 await pg.exec('delete from camera_devices where id<>1;delete from equipment_master where id<>1;');
 await pg.query('update camera_devices set device_name=$1,expected_ports=$2::integer[] where id=1',['Sniper 001',ports]);
 const beforeRoles=await pg.query('select rolname from pg_roles order by rolname');
 const beforeOwner=await pg.query("select proowner::regrole::text as owner,proacl::text as acl from pg_proc where oid='public.publish_camera_connection_v1(bigint,bigint,inet,integer[],text,jsonb,text)'::regprocedure");
 const draft=draftSource;
 let clock=syntheticClock?TEST_START:Date.now(),clockReplacements=0;
 if(syntheticClock) {
  await pg.exec("create schema direct_ip_test_clock;create function direct_ip_test_clock.clock_timestamp() returns timestamptz language sql stable as $$select current_setting('direct_ip_test_clock.now')::timestamptz$$;");
  await pg.query("select set_config('direct_ip_test_clock.now',$1,false)",[new Date(clock).toISOString()]);
 }
 const testedDraft=syntheticClock?draft.replace(/(?:pg_catalog\.)?\bclock_timestamp\s*\(\s*\)/g,()=>{clockReplacements++;return 'direct_ip_test_clock.clock_timestamp()';}):draft;
 if(syntheticClock)assert.ok(clockReplacements>0,'Arithmetic tests must control only draft clock_timestamp calls.');
 if(install)await pg.exec(testedDraft);
 assert.deepEqual((await pg.query('select rolname from pg_roles order by rolname')).rows,beforeRoles.rows,'Local draft must not create roles.');
 const afterOwner=await pg.query("select proowner::regrole::text as owner,proacl::text as acl from pg_proc where oid='public.publish_camera_connection_v1(bigint,bigint,inet,integer[],text,jsonb,text)'::regprocedure");
 assert.deepEqual(afterOwner.rows,beforeOwner.rows,'Existing publisher owner and EXECUTE boundary must be preserved in the synthetic catalog.');
 const calls=[],ticketArgs=new WeakMap();let nextId=1;
 const queryRows=async(sql,values=[])=>{const result=await pg.query(sql,values);return result.rows;};
 const device=async()=>((await queryRows('select to_jsonb(d) as row from camera_devices d where id=1'))[0].row);
 const binding=async()=>{
  const d=await device(),m=(await queryRows('select to_jsonb(m) as row from equipment_master m where id=1'))[0].row;
  return {unit_key:d.unit_key,source:d.source,device_name:d.device_name,organization:d.organization,activation_state:d.activation_state,
   master:{canonical_family:m.canonical_family,unit_tag:m.unit_tag,source_label:m.source_label,tracker_state:m.tracker_state}};
 };
 const rpc=async args=>{
  calls.push(clone(args));
  const run=async tx=>{
   if(syntheticClock)await tx.query("select set_config('direct_ip_test_clock.now',$1,true)",[new Date(clock).toISOString()]);
   await tx.exec("set local role service_role;set local request.jwt.claim.role='service_role';");
   const result=await tx.query('select public.publish_camera_connection_v1($1::bigint,$2::bigint,$3::inet,$4::integer[],$5::text,$6::jsonb,$7::text) as value',[
    args.p_device_id,args.p_revision,args.p_public_ip,args.p_expected_ports,args.p_monitoring_profile,args.p_health,args.p_source
   ]);
   return result.rows[0].value;
  };
  if(backend==='pglite')return pg.transaction(run);
  const client=await database.newClient();
  try {await client.query('begin');const value=await run({query:(...args)=>client.query(...args),exec:sql=>client.query(sql)});await client.query('commit');return value;}
  catch(error){await client.query('rollback');throw error;}finally{await client.end();}

 };
 const baseArgs=async()=>{const d=await device();return {p_device_id:d.id,p_revision:d.connection_revision,p_public_ip:d.public_ip,p_expected_ports:d.expected_ports,p_monitoring_profile:d.monitoring_profile,p_source:'automatic_tcp_sweep'};};
 const begin=async({id=attemptId(nextId++),bindingOverride,argsOverride={},payloadOverride={}}={})=>{
  const args={...await baseArgs(),...argsOverride},bound=bindingOverride??await binding();
  args.p_health={direct_attempt:{version:1,op:'begin',attempt_id:id,binding:bound,...payloadOverride}};
  const answer=await rpc(args);
  if(answer&&typeof answer==='object')ticketArgs.set(answer,clone(args));
  return answer;
 };
 const complete=async(ticket,{completedAt=new Date(syntheticClock?clock:Date.now()).toISOString(),ports:results=ports.map(refused),payloadOverride={},argsOverride={}}={})=>{
  const args={...(ticketArgs.get(ticket)||await baseArgs()),...argsOverride};
  args.p_health={direct_attempt:{version:1,op:'complete',attempt_id:ticket.attempt_id,sequence:ticket.sequence,binding:ticket.binding,
   result:{completed_at:completedAt,ports:results},...payloadOverride}};
  return rpc(args);
 };
 const read=async ticket=>{
  const args=ticketArgs.get(ticket)||await baseArgs();
  return rpc({...args,p_health:{direct_attempt:{version:1,op:'read',attempt_id:ticket.attempt_id,sequence:ticket.sequence,binding:ticket.binding}}});
 };
 const snapshot=async()=>({
  health:(await queryRows('select to_jsonb(h) as row from camera_health_current h where camera_device_id=1'))[0]?.row??null,
  history:(await queryRows('select to_jsonb(h) as row from camera_health_history h order by id')).map(row=>row.row),
  device:await device(),
  state:(await queryRows('select to_jsonb(s) as row from camera_direct_health_private.attempt_state s')).map(row=>row.row),
  receipts:(await queryRows('select to_jsonb(r) as row from camera_direct_health_private.attempt_receipts r')).map(row=>row.row)
 });
 const facade={rpc(name,args){assert.equal(name,'publish_camera_connection_v1');const q={abortSignal(){return q;},then(resolve,reject){return rpc(args).then(data=>({data,error:null})).then(resolve,reject);}};return q;}};
 return {pg,backend,database,facade,calls,device,binding,begin,complete,read,rpc,baseArgs,snapshot,draftSource,testedDraft,
  get now(){return syntheticClock?clock:Date.now();},syntheticClock,clockReplacements,draftSqlSha256,originalPublisherSha256:ORIGINAL_PUBLISHER_SHA256,
  async setNow(value){clock=value;if(syntheticClock)await pg.query("select set_config('direct_ip_test_clock.now',$1,false)",[new Date(value).toISOString()]);},
  async advance(ms){clock+=ms;if(syntheticClock)await pg.query("select set_config('direct_ip_test_clock.now',$1,false)",[new Date(clock).toISOString()]);},
  close:()=>database.close()};
 }catch(error){await database.close();throw error;}
}

// Retained arithmetic suites opt into clock substitution explicitly.
export const createAttemptFixture=options=>createFixture({syntheticClock:true,...options});

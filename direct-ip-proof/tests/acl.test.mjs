import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createFixture} from '../lib/fixture.mjs';
import {createAttemptFixture,MINUTE,refused,unknown} from '../lib/fixture.mjs';

// Synthetic single-session ACL/rollback tests only. Roles, ACLs, event triggers,
// clocks and records are disposable harness inputs, not deployed-catalog proof.
// PostgreSQL multi-session/SET ROLE/catalog verification remains a release gate.
const draft=await readFile(new URL('../inputs/direct-ip-attempt-local.sql',import.meta.url),'utf8');
const draftSha256=createHash('sha256').update(draft).digest('hex');
const PUBLISHER='public.publish_camera_connection_v1(bigint,bigint,inet,integer[],text,jsonb,text)';
const CAPTURED_SHA='ade4074d7fbbb2b0023a098c47cb7ff5a69ca08125d91208939615c408a2644a';
const PRIVATE='camera_direct_health_private';
const TABLES=['attempt_state','attempt_receipts'];
const TABLE_PRIVILEGES=['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'];
let db,dbHandle,baseline,version;
const rows=async(sql,values=[])=>((await db.query(sql,values)).rows);
async function publisher() {
 return (await rows(`select encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') as definition_sha,
  p.proowner::regrole::text as owner,p.proacl::text as acl,p.prosecdef,p.proconfig,p.provolatile,p.proparallel
  from pg_proc p where p.oid=$1::regprocedure`,[PUBLISHER]))[0];
}
async function environment() {
 return {
  publisher:await publisher(),
  roles:await rows('select oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls from pg_roles order by oid'),
  memberships:await rows('select to_jsonb(m) as row from pg_auth_members m order by roleid,member'),
  defaults:await rows('select to_jsonb(d) as row from pg_default_acl d order by oid'),
  schemas:await rows("select oid,nspname,nspowner,nspacl::text as acl from pg_namespace where nspname in ('public','auth','acl_sentinel') order by oid"),
  tables:await rows("select c.oid,c.relname,c.relowner,c.relacl::text as acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','acl_sentinel') order by c.oid"),
 };
}
before(async()=>{
 dbHandle=await createFixture({install:false});db=dbHandle.pg;
 await db.exec(`create role acl_sentinel_reader;create schema acl_sentinel;create table acl_sentinel.retained(id integer);
  grant usage on schema acl_sentinel to acl_sentinel_reader;
  grant select on acl_sentinel.retained to acl_sentinel_reader;
  alter default privileges in schema acl_sentinel grant select on tables to acl_sentinel_reader;`);
 version=Number((await rows("select current_setting('server_version_num') as version"))[0].version);
 baseline=await environment();assert.equal(baseline.publisher.definition_sha,CAPTURED_SHA);
});
after(async()=>{await dbHandle?.close();});

// Install a grant from a synthetic CREATE TABLE event trigger, allowing each
// private table/column to be tested independently against EXACT draft bytes.
// This does not add an event trigger or any grant to the candidate.
function targetGrant(table,grant,{extra=''}={}) {
 assert.ok(TABLES.includes(table));
 return `create function public.acl_test_target_grant() returns event_trigger language plpgsql as $acl_test$
 declare command record;begin
  for command in select * from pg_event_trigger_ddl_commands() loop
   if command.object_type='table' and command.object_identity='${PRIVATE}.${table}' then
    execute '${grant.replaceAll("'","''")}';${extra}
   end if;
  end loop;
 end $acl_test$;
 create event trigger acl_test_target_grant on ddl_command_end when tag in ('CREATE TABLE')
 execute function public.acl_test_target_grant();`;
}
async function rejected(t,setup,{actor,assumedRole,object,privilege}={}) {
 await db.exec('begin;');let error;
 try {await db.exec(setup);await db.exec(draft);}catch(caught){error=caught;}
 try {
  assert.ok(error,'Unexpected effective privileges must stop the exact draft.');
  assert.equal(error.code,'42501');assert.match(error.message,/Unexpected effective private-state access:/);
  if(actor)assert.ok(error.message.includes('actor='+actor),error.message);
  if(assumedRole)assert.ok(error.message.includes('assumed_role='+assumedRole),error.message);
  if(object)assert.ok(error.message.includes('object='+object),error.message);
  if(privilege)assert.ok(error.message.includes('privilege='+privilege),error.message);
  t.diagnostic(JSON.stringify({environment:dbHandle.backend,draftSha256,serverVersion:version,rejection:error.message}));
 }finally{await db.exec('rollback;');}
 assert.equal((await rows('select to_regnamespace($1) as value',[PRIVATE]))[0].value,null);
 assert.deepEqual(await environment(),baseline,'Failed draft must leave captured publisher, roles, unrelated ACLs and defaults intact.');
}

test('exact inherited-default reproduction fails atomically before private state can be exposed',t=>rejected(t,`
 create role inherited_local_writer;
 grant inherited_local_writer to service_role;
 alter default privileges grant usage on schemas to inherited_local_writer;
 alter default privileges grant all on tables to inherited_local_writer;`,{object:PRIVATE}));

for(const table of TABLES)for(const privilege of TABLE_PRIVILEGES) {
 test(`unexpected direct ${privilege} on ${table} is rejected even without schema USAGE`,async t=>{
  if(privilege==='MAINTAIN'&&version<170000){t.skip('MAINTAIN is absent from this PostgreSQL target version.');return;}
  await rejected(t,'create role acl_writer;'+targetGrant(table,`grant ${privilege} on ${PRIVATE}.${table} to acl_writer`),
   {actor:'acl_writer',assumedRole:'acl_writer',object:PRIVATE+'.'+table,privilege});
 });
}
for(const table of TABLES) {
 test(`inherited TRUNCATE on ${table} is rejected independently`,t=>rejected(t,`
  create role zz_acl_group;grant zz_acl_group to service_role;
  ${targetGrant(table,`grant truncate on ${PRIVATE}.${table} to zz_acl_group`)}`,
  {actor:'service_role',object:PRIVATE+'.'+table,privilege:'TRUNCATE'}));
 test(`multi-hop inherited SELECT on ${table} is rejected independently`,t=>rejected(t,`
  create role zz_acl_group;create role zz_acl_middle;grant zz_acl_group to zz_acl_middle;grant zz_acl_middle to service_role;
  ${targetGrant(table,`grant select on ${PRIVATE}.${table} to zz_acl_group`)}`,
  {actor:'service_role',object:PRIVATE+'.'+table,privilege:'SELECT'}));
}
for(const privilege of ['USAGE','CREATE']) {
 test(`unexpected schema ${privilege} without table rights fails closed`,t=>rejected(t,`
  create role acl_writer;alter default privileges grant ${privilege} on schemas to acl_writer;`,
  {actor:'acl_writer',assumedRole:'acl_writer',object:PRIVATE,privilege}));
}
test('unexpected table defaults without schema defaults fail closed',t=>rejected(t,`
 create role acl_writer;alter default privileges grant truncate on tables to acl_writer;`,
 {actor:'acl_writer',assumedRole:'acl_writer',object:PRIVATE+'.attempt_receipts',privilege:'TRUNCATE'}));
test('BYPASSRLS does not exempt an ordinary role from unexpected TRUNCATE',t=>rejected(t,`
 create role acl_writer bypassrls;${targetGrant('attempt_receipts',`grant truncate on ${PRIVATE}.attempt_receipts to acl_writer`)}`,
 {actor:'acl_writer',object:PRIVATE+'.attempt_receipts',privilege:'TRUNCATE'}));
for(const privilege of ['SELECT','INSERT','UPDATE','REFERENCES']) {
 test(`column-only ${privilege} on receipts is rejected`,t=>rejected(t,`
  create role acl_writer;${targetGrant('attempt_receipts',`grant ${privilege}(attempt_sequence) on ${PRIVATE}.attempt_receipts to acl_writer`)}`,
  {actor:'acl_writer',object:PRIVATE+'.attempt_receipts',privilege}));
}

test('NOINHERIT role with SET-only access to a private writer is rejected',async t=>{
 if(version<160000){t.skip('Per-membership SET/INHERIT options require PostgreSQL 16+.');return;}
 await rejected(t,`create role zz_acl_group;alter role service_role noinherit;
  grant zz_acl_group to service_role with inherit false,set true;
  ${targetGrant('attempt_receipts',`grant truncate on ${PRIVATE}.attempt_receipts to zz_acl_group`)}`,
  {actor:'service_role',assumedRole:'zz_acl_group',object:PRIVATE+'.attempt_receipts',privilege:'TRUNCATE'});
});
test('multi-hop SET-only access to a private writer is rejected',async t=>{
 if(version<160000){t.skip('Per-membership SET/INHERIT options require PostgreSQL 16+.');return;}
 await rejected(t,`create role zz_acl_group;create role zz_acl_middle;
  grant zz_acl_group to zz_acl_middle with inherit false,set true;
  grant zz_acl_middle to service_role with inherit false,set true;
  ${targetGrant('attempt_state',`grant update on ${PRIVATE}.attempt_state to zz_acl_group`)}`,
  {actor:'service_role',assumedRole:'zz_acl_group',object:PRIVATE+'.attempt_state',privilege:'UPDATE'});
});
for(const target of ['postgres','acl_test_superuser','pg_read_all_data','pg_write_all_data','pg_maintain']) {
 test(`ordinary membership or assumption of ${target} is not an admin exclusion`,async t=>{
  if(target==='pg_maintain'&&version<170000){t.skip('pg_maintain is absent from this target version.');return;}
  const create=target==='acl_test_superuser'?'create role acl_test_superuser superuser;':'';
  await rejected(t,create+`grant ${target} to service_role;`,{actor:'service_role',object:PRIVATE});
 });
}
test('unexpected TRUNCATE granted to a builtin reader is not an inherent-privilege exclusion',t=>rejected(t,
 targetGrant('attempt_receipts',`grant truncate on ${PRIVATE}.attempt_receipts to pg_read_all_data`),
 {actor:'pg_read_all_data',assumedRole:'pg_read_all_data',object:PRIVATE+'.attempt_receipts',privilege:'TRUNCATE'}));
test('unexpected schema CREATE granted to a builtin reader is not an inherent-privilege exclusion',t=>rejected(t,
 'alter default privileges grant create on schemas to pg_read_all_data;',
 {actor:'pg_read_all_data',assumedRole:'pg_read_all_data',object:PRIVATE,privilege:'CREATE'}));
test('SET-only builtin reader assumption is rejected without inherited access',async t=>{
 if(version<160000){t.skip('Per-membership SET/INHERIT options require PostgreSQL 16+.');return;}
 await rejected(t,'grant pg_read_all_data to service_role with inherit false,set true;',
  {actor:'service_role',assumedRole:'pg_read_all_data',object:PRIVATE,privilege:'USAGE'});
});
for(const target of ['postgres','pg_read_all_data']) {
 test(`ADMIN OPTION-only path to ${target} is rejected despite SET/INHERIT false`,async t=>{
  if(version<160000){t.skip('Per-membership SET/INHERIT options require PostgreSQL 16+.');return;}
  await rejected(t,`grant ${target} to service_role with admin true,inherit false,set false;`,
   {actor:'service_role',assumedRole:target,object:PRIVATE,privilege:target==='postgres'?'CREATE':'USAGE'});
 });
}

async function supported(t,setup) {
 const handle=await createFixture({install:false});const pg=handle.pg;
 try {
  await pg.exec(setup);
  const original=await pg.query(`select proowner,proacl::text as acl,prosecdef,proconfig,provolatile,proparallel from pg_proc where oid=$1::regprocedure`,[PUBLISHER]);
  const roles=await pg.query('select oid,rolname,rolsuper,rolinherit from pg_roles order by oid');
  const members=await pg.query('select to_jsonb(m) as row from pg_auth_members m order by roleid,member');
  const defaults=await pg.query('select to_jsonb(d) as row from pg_default_acl d order by oid');
  const unrelated=await pg.query("select c.oid,c.relacl::text as acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','acl_sentinel') order by c.oid");
  const schemas=await pg.query("select oid,nspname,nspowner,nspacl::text as acl from pg_namespace where nspname in ('public','auth','acl_sentinel') order by oid");
  await pg.exec(draft);
  assert.deepEqual((await pg.query(`select proowner,proacl::text as acl,prosecdef,proconfig,provolatile,proparallel from pg_proc where oid=$1::regprocedure`,[PUBLISHER])).rows,original.rows);
  assert.deepEqual((await pg.query('select oid,rolname,rolsuper,rolinherit from pg_roles order by oid')).rows,roles.rows);
  assert.deepEqual((await pg.query('select to_jsonb(m) as row from pg_auth_members m order by roleid,member')).rows,members.rows);
  assert.deepEqual((await pg.query('select to_jsonb(d) as row from pg_default_acl d order by oid')).rows,defaults.rows);
  assert.deepEqual((await pg.query("select c.oid,c.relacl::text as acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','acl_sentinel') order by c.oid")).rows,unrelated.rows);
  assert.deepEqual((await pg.query("select oid,nspname,nspowner,nspacl::text as acl from pg_namespace where nspname in ('public','auth','acl_sentinel') order by oid")).rows,schemas.rows);
  for(const role of ['anon','authenticated','service_role']) {
   const schema=(await pg.query(`select has_schema_privilege($1,$2,'USAGE') as usage,has_schema_privilege($1,$2,'CREATE') as create`,[role,PRIVATE])).rows[0];
   assert.deepEqual(schema,{usage:false,create:false});
   for(const table of TABLES)for(const privilege of TABLE_PRIVILEGES.filter(p=>p!=='MAINTAIN'||version>=170000)) {
    assert.equal((await pg.query('select has_table_privilege($1,$2,$3) as allowed',[role,PRIVATE+'.'+table,privilege])).rows[0].allowed,false,role+' '+table+' '+privilege);
   }
  }
  for(const role of ['postgres','pg_read_all_data','pg_write_all_data',...(version>=170000?['pg_maintain']:[])]) {
   assert.equal((await pg.query('select exists(select 1 from pg_roles where rolname=$1) as present',[role])).rows[0].present,true);
  }
  for(const privilege of ['USAGE','CREATE'])assert.equal((await pg.query("select has_schema_privilege('postgres',$1,$2) as allowed",[PRIVATE,privilege])).rows[0].allowed,true);
  for(const table of TABLES) {
   assert.equal((await pg.query("select has_table_privilege('postgres',$1,'TRUNCATE') as allowed",[PRIVATE+'.'+table])).rows[0].allowed,true);
   assert.equal((await pg.query("select has_table_privilege('pg_read_all_data',$1,'SELECT') as allowed",[PRIVATE+'.'+table])).rows[0].allowed,true);
   for(const privilege of ['INSERT','UPDATE','DELETE'])assert.equal((await pg.query("select has_table_privilege('pg_write_all_data',$1,$2) as allowed",[PRIVATE+'.'+table,privilege])).rows[0].allowed,true);
   if(version>=170000)assert.equal((await pg.query("select has_table_privilege('pg_maintain',$1,'MAINTAIN') as allowed",[PRIVATE+'.'+table])).rows[0].allowed,true);
  }
  t.diagnostic(JSON.stringify({environment:dbHandle.backend,draftSha256,serverVersion:version,ownerExecuteSecurityAndUnrelatedAclsPreserved:true,builtinAdministrativeAuthority:'explicitly retained, not excluded from reality'}));
 }finally{await handle.close();}
}
test('clean supported defaults retain publisher owner/EXECUTE/security and unrelated default ACLs',t=>supported(t,`
 create role acl_sentinel_reader;create schema acl_sentinel;create table acl_sentinel.retained(id integer);
 grant usage on schema acl_sentinel to acl_sentinel_reader;grant select on acl_sentinel.retained to acl_sentinel_reader;
 alter default privileges in schema acl_sentinel grant select on tables to acl_sentinel_reader;`));
test('approved PUBLIC default cleanup removes only private-object rights',t=>supported(t,`
 alter default privileges grant usage,create on schemas to public;
 alter default privileges grant all on tables to public;`));
test('approved named-role default cleanup removes only private-object rights',t=>supported(t,`
 alter default privileges grant usage,create on schemas to anon,authenticated,service_role;
 alter default privileges grant all on tables to anon,authenticated,service_role;`));
test('standalone superuser retains inherent authority without excluding ordinary assumers',t=>supported(t,`
 create role acl_test_superuser superuser;
 alter default privileges grant usage,create on schemas to acl_test_superuser;
 alter default privileges grant all on tables to acl_test_superuser;`));
test('membership with SET/INHERIT/ADMIN all false does not invent effective builtin authority',async t=>{
 if(version<160000){t.skip('Per-membership SET/INHERIT options require PostgreSQL 16+.');return;}
 await supported(t,'grant pg_read_all_data to service_role with admin false,inherit false,set false;');
});
test('exact existing non-super publisher owner is retained as the explicit administrative boundary',t=>supported(t,`
 -- Disposable SYNTHETIC baseline establishment only. This ownership/grant setup
 -- is not part of the candidate draft or a proposed production operation.
 create role acl_fixture_owner nosuperuser;
 grant usage,create on schema public to acl_fixture_owner;
 do $fixture_owner$ begin
  execute format('grant create on database %I to acl_fixture_owner',current_database());
 end $fixture_owner$;
 alter function public.publish_camera_connection_v1(bigint,bigint,inet,integer[],text,jsonb,text) owner to acl_fixture_owner;
 set role acl_fixture_owner;`));

test('ordinary service publisher use retains IDs, counts and history while direct private mutations fail',async()=>{
 const f=await createAttemptFixture();
 try {
  const one=await f.begin();assert.equal((await f.complete(one)).consecutive_failures,1);
  await f.advance(15*MINUTE);const two=await f.begin();assert.equal((await f.complete(two)).consecutive_failures,2);
  const before=await f.snapshot();
  for(const table of TABLES)for(const statement of [`delete from ${PRIVATE}.${table}`,`truncate ${PRIVATE}.${table}`,`update ${PRIVATE}.${table} set ${table==='attempt_state'?'current_sequence':'attempt_sequence'}=0`]) {
   await assert.rejects(f.pg.transaction(async tx=>{await tx.exec('set local role service_role;');await tx.exec(statement);}),error=>error.code==='42501');
   assert.deepEqual(await f.snapshot(),before);
  }
  assert.equal((await f.complete(two)).consecutive_failures,2);assert.deepEqual(await f.snapshot(),before);
  const conflict=await f.complete(two,{ports:[unknown()]});assert.equal(conflict.reason,'attempt_conflict');assert.deepEqual(await f.snapshot(),before);
  await f.advance(MINUTE);const u=await f.begin(),unverified=await f.complete(u,{ports:[unknown()]});assert.equal(unverified.health_published,false);
  const afterU=await f.snapshot();assert.deepEqual(afterU.health,before.health);assert.deepEqual(afterU.history,before.history);assert.deepEqual(afterU.device,before.device);
  await f.advance(MINUTE);const fresh=await f.begin(),result=await f.complete(fresh,{ports:[refused()]});assert.equal(result.consecutive_failures,1);assert.equal(result.status,'verifying');
  const final=await f.snapshot();assert.equal(final.receipts.length,4);assert.equal(final.state[0].current_sequence,4);assert.equal(final.health.confirmed_outage,false);
  assert.equal((await f.read(one)).is_current,false);
 }finally{await f.close();}
});

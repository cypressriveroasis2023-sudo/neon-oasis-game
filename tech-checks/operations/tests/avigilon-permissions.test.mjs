import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const sql=name=>readFile(new URL('../db/'+name,import.meta.url),'utf8');
const nativeFiles=['avigilon_check_runs.sql','avigilon_check_run_boundary.sql','avigilon_health_publication.sql','avigilon_health_boundary.sql','avigilon_source_operations.sql'];
async function fixture(project){
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;`);
 if(project==='native'){
  await db.exec('create table user_profiles(user_id uuid,organization_id uuid,active boolean,department text);create table roles(id uuid,organization_id uuid,code text);create table user_roles(user_id uuid,role_id uuid);');
  for(const file of nativeFiles)await db.exec(await sql(file));
 }else{
  await db.exec('create table camera_devices(id bigint,monitoring_profile text);create table equipment_master(id bigint);create table camera_inventory_audit(id bigint);create table camera_health_current(camera_device_id bigint);create table camera_health_history(camera_device_id bigint);');
  await db.exec(await sql('avigilon_legacy_source_guard.sql'));
 }
 const catalog=async()=>(await db.query("select p.oid::regprocedure::text signature,p.proacl::text acl,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,has_function_privilege('service_role',p.oid,'EXECUTE') service from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'cos_avigilon_%' order by 1")).rows;
 return {db,catalog,permissions:await sql('avigilon_'+project+'_permissions.sql')};
}

test('all candidate DDL holds nine transport permissions until separate explicit scripts; guards are atomic and deny drift',async()=>{
 for(const project of ['native','legacy']){
  const f=await fixture(project);try{
   const before=await f.catalog();assert.equal(before.length,project==='native'?6:3);for(const r of before){assert.equal(r.acl,'{postgres=X/postgres}');assert.equal(r.service,false);assert.equal(r.anon,false);assert.equal(r.authenticated,false);}
   const changed=before.at(-1).signature;
   const definition=(await f.db.query('select pg_get_functiondef($1::regprocedure) value',[changed])).rows[0].value;
   await f.db.exec(definition.replace('Service transport required','Changed service transport'));
   await assert.rejects(()=>f.db.exec(f.permissions),/Reviewed boundary changed/);
   assert.deepEqual(await f.catalog(),before,'A failed approval precondition grants nothing');
   await f.db.exec(definition);
   await f.db.exec('grant execute on function public.'+changed+' to authenticated');
   await assert.rejects(()=>f.db.exec(f.permissions),/Reviewed boundary changed/);
   await f.db.exec('revoke execute on function public.'+changed+' from authenticated');
   assert.deepEqual(await f.catalog(),before);
   // This execution is confined to the synthetic database. Production scripts
   // remain separate files for the user's later action-time approval.
   await f.db.exec(f.permissions);
   const after=await f.catalog();for(const r of after){assert.equal(r.acl,'{postgres=X/postgres,service_role=X/postgres}');assert.equal(r.service,true);assert.equal(r.anon,false);assert.equal(r.authenticated,false);}
   await assert.rejects(()=>f.db.exec(f.permissions),/Reviewed boundary changed/);
   assert.deepEqual(await f.catalog(),after);
   for(const role of ['anon','authenticated','service_role']){
    await f.db.exec('set role '+role);
    await assert.rejects(()=>f.db.exec('select * from '+(project==='native'?'cos_avigilon_checks_private.runs':'cos_avigilon_source_private.control')),/permission denied/);
    await f.db.exec('reset role');
   }
  }finally{await f.db.close();}
 }
});

test('schema installation files contain no embedded GRANT statements',async()=>{
 for(const name of [...nativeFiles,'avigilon_native_source_fences.sql','avigilon_legacy_source_guard.sql'])assert.doesNotMatch((await sql(name)).replace(/--[^\n]*/g,''),/\bgrant\b/i,name);
});

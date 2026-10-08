import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture,reset,seed,rpc,ORG} from './fixtures/geocode-sources-database-fixture.mjs';
let db;
before(async()=>{
 db=await fixture();await db.exec('revoke usage on schema app_private from service_role');
 for(const file of ['cos-geocode-sources-read-access.sql','cos-geocode-sources-admin-import.sql'])await db.exec(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));
});
after(async()=>{await db?.close();});beforeEach(async()=>{await reset(db);});
const admin=async(name,records)=>(await db.query('select app_private.cos_geocode_sources_admin_'+name+'($1,$2) value',[ORG,records])).rows[0].value;
test('only the existing SQL administrator imports/revokes with all binding guards and no schema grant',async()=>{
 assert.equal((await db.query('select current_user')).rows[0].current_user,'postgres');
 const record=await seed(db);const [source]=await admin('import_reviewed',[record]);assert.equal(source.nativeUnitId,record.nativeUnitId);
 const page=await rpc(db,'list_changes',{p_organization_id:ORG,p_after_event_id:'0',p_limit:100});assert.equal(page.events.length,1);
 const identity={entityKind:source.entityKind,nativeUnitId:source.nativeUnitId,productId:source.productId,sourceRevision:source.sourceRevision};
 const [revoked]=await admin('revoke_reviewed',[identity]);assert.equal(revoked.eligibility,'tombstone');
 assert.equal((await db.query("select has_schema_privilege('service_role','app_private','USAGE') allowed")).rows[0].allowed,false);
 assert.equal((await db.query('select count(*)::integer n from app_private.cos_geocode_source_events')).rows[0].n,2);
});
test('admin import rejects stale native state, wrong address hash, revision replay and oversize batches',async()=>{
 const record=await seed(db);await assert.rejects(()=>admin('import_reviewed',[{...record,addressSha256:'0'.repeat(64)}]),/Address digest mismatch/);
 await assert.rejects(()=>admin('import_reviewed',Array(251).fill(record)),/Invalid reviewed batch/);
 const [source]=await admin('import_reviewed',[record]);await assert.rejects(()=>admin('import_reviewed',[record]),/Source revision changed/);
 await db.query("update public.equipment_units set current_location_type='shop' where id=$1",[record.nativeUnitId]);
 await assert.rejects(()=>admin('import_reviewed',[{...record,previousSourceRevision:source.sourceRevision}]),/Source revision changed|Native placement or GPS changed/);
 const count=(await db.query('select count(*)::integer n from app_private.cos_geocode_sources')).rows[0].n;assert.equal(count,1);
});
test('service/anonymous/authenticated callers get neither admin execution nor private schema usage',async()=>{
 const rows=(await db.query("select p.proname,p.prosecdef,p.proconfig,has_function_privilege('service_role',p.oid,'EXECUTE') service,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname=any($1)",[['cos_geocode_sources_admin_import_reviewed','cos_geocode_sources_admin_revoke_reviewed']])).rows;
 assert.equal(rows.length,2);for(const r of rows){assert.equal(r.prosecdef,false);assert.deepEqual(r.proconfig,['search_path=""']);assert.equal(r.service,false);assert.equal(r.anon,false);assert.equal(r.authenticated,false);}
 for(const role of ['service_role','anon','authenticated']){await db.exec('set role '+role);try{await assert.rejects(()=>admin('import_reviewed',[]),/permission denied/);}finally{await db.exec('reset role');}}
 // Even an accidental later EXECUTE grant cannot bypass the explicit admin guard.
 await db.exec('create role synthetic_unprivileged;grant usage on schema app_private to synthetic_unprivileged;grant execute on function app_private.cos_geocode_sources_admin_import_reviewed(uuid,jsonb) to synthetic_unprivileged;set role synthetic_unprivileged');
 try{await assert.rejects(()=>admin('import_reviewed',[]),/Existing SQL administrator required/);}finally{await db.exec('reset role');}
});
test('admin wrappers reject another organization and do not create Owner audits or equipment',async()=>{
 await assert.rejects(()=>db.query('select app_private.cos_geocode_sources_admin_import_reviewed($1,$2)',['00000000-0000-0000-0000-000000000000',[]]),/Existing SQL administrator required/);
 assert.equal((await db.query('select count(*)::integer n from public.equipment_units')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::integer n from app_private.cos_geocode_sources')).rows[0].n,0);
});

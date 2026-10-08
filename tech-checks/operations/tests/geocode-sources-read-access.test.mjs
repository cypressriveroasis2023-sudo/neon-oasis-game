import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture,seed,install,rpc,ORG} from './fixtures/geocode-sources-database-fixture.mjs';
let db,source,identity;
before(async()=>{
 db=await fixture();const record=await seed(db);[source]=await install(db,[record]);
 identity={entityKind:source.entityKind,nativeUnitId:source.nativeUnitId,productId:source.productId,sourceRevision:source.sourceRevision};
 // Match live native ACL: the existing generic fixture's broad schema grant hid
 // this failure. No public/private grant is silently added by the correction.
 await db.exec('revoke usage on schema app_private from service_role');
 await assert.rejects(()=>rpc(db,'list_changes',{p_organization_id:ORG,p_after_event_id:'0',p_limit:100}),/permission denied for schema app_private/);
 await db.exec(await readFile(new URL('../db/cos-geocode-sources-read-access.sql',import.meta.url),'utf8'));
});
after(async()=>{await db?.close();});
const args={p_organization_id:ORG,p_after_event_id:'0',p_limit:100};
test('all five source readers work under actual service role with private schema usage denied',async()=>{
 assert.equal((await rpc(db,'list_changes',args)).events.length,1);
 assert.equal((await rpc(db,'read_current',{p_organization_id:ORG,p_entity_kind:identity.entityKind,p_native_unit_id:identity.nativeUnitId,p_product_id:identity.productId,p_source_revision:identity.sourceRevision})).source.nativeUnitId,identity.nativeUnitId);
 assert.equal((await rpc(db,'read_current_batch',{p_organization_id:ORG,p_sources:[identity]})).sources[0].nativeUnitId,identity.nativeUnitId);
 for(const name of ['read_many','map_projection'])assert.equal((await rpc(db,name,{p_organization_id:ORG,p_identities:[{entityKind:identity.entityKind,nativeUnitId:identity.nativeUnitId}]})).length,1);
 assert.equal((await db.query("select has_schema_privilege('service_role','app_private','USAGE') allowed")).rows[0].allowed,false);
 await db.exec('set role service_role');try{await assert.rejects(()=>db.query('select * from app_private.cos_geocode_sources'),/permission denied for schema app_private/);}finally{await db.exec('reset role');}
});
test('every source reader is definer, fixed-search-path and backend-only',async()=>{
 const rows=(await db.query("select p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,has_function_privilege('service_role',p.oid,'EXECUTE') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1)",[['cos_geocode_sources_list_changes','cos_geocode_sources_read_current','cos_geocode_sources_read_many','cos_geocode_sources_read_current_batch','cos_geocode_sources_map_projection']])).rows;
 assert.equal(rows.length,5);for(const row of rows){assert.equal(row.prosecdef,true);assert.deepEqual(row.proconfig,['search_path=""']);assert.equal(row.anon,false);assert.equal(row.authenticated,false);assert.equal(row.service,true);}
 for(const role of ['anon','authenticated'])await assert.rejects(()=>rpc(db,'list_changes',args,role),/permission denied/);
});
test('read wrappers retain caller role, organization, bounds and stale revision checks',async()=>{
 await assert.rejects(()=>rpc(db,'list_changes',{...args,p_organization_id:'00000000-0000-0000-0000-000000000000'}),/Source service access required/);
 await assert.rejects(()=>db.query('select public.cos_geocode_sources_list_changes($1,$2,$3)',[ORG,'0',100]),/Source service access required/);
 await assert.rejects(()=>rpc(db,'list_changes',{...args,p_limit:101}),/Invalid bounded source cursor/);
 await assert.rejects(()=>rpc(db,'read_many',{p_organization_id:ORG,p_identities:Array(251).fill({entityKind:identity.entityKind,nativeUnitId:identity.nativeUnitId})}),/Invalid source identities/);
 const read=await rpc(db,'read_current',{p_organization_id:ORG,p_entity_kind:identity.entityKind,p_native_unit_id:identity.nativeUnitId,p_product_id:identity.productId,p_source_revision:'00000000-0000-0000-0000-000000000000'});assert.equal(read.source,null);
});
test('read correction does not change mutation RPC security or private helper access',async()=>{
 const rows=(await db.query("select proname,prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and proname=any($1)) or (n.nspname='app_private' and proname='cos_source_assert_service')",[['cos_geocode_sources_import_reviewed','cos_geocode_sources_revoke_reviewed']])).rows;
 assert.equal(rows.length,3);for(const row of rows)assert.equal(row.prosecdef,false);
 await db.exec('set role service_role');try{await assert.rejects(()=>db.query('select app_private.cos_source_assert_service($1)',[ORG]),/permission denied for schema app_private/);}finally{await db.exec('reset role');}
 assert.equal((await db.query('select count(*)::integer n from app_private.cos_geocode_sources')).rows[0].n,1);
});

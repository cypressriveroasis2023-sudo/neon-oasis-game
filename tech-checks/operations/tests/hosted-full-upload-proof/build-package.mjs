// Pure rendering and bounded read-only synthetic catalog capture. This module never applies DDL.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
export const sha256=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const expectedCandidateSha256='ce11058674c5f565e27c4bd83a651a32a031740e26ac85663ac186ee6be71c07';
export const expectedBaselineSqlSha256='59b8698fa49456942a614998cc231f2fe2e785ba368e261865cb27728a271eea';
export const signatures=[
 'cos_mhelp_placement_private.upload_snapshot()',
 'cos_mhelp_placement_private.upload_binding_guard(uuid,uuid)',
 'cos_mhelp_placement_private.continuity_current(uuid,uuid,text)',
 'cos_mhelp_placement_private.upload_tracker_snapshot(jsonb)',
 'cos_mhelp_placement_private.guard(uuid,uuid)',
 'app_private.cos_source_label(text)',
 'app_private.cos_source_native_guard(text,uuid,uuid,text,text)',
 'public.cos_mhelp_placement_snapshot(uuid,uuid)',
 'public.cos_mhelp_placement_snapshot(uuid,uuid,text)',
 'public.cos_mhelp_placement_status()'
];
export const relations=[
 'app_private.vision_tracker_locations','public.equipment_units','app_private.cos_geocode_sources',
 'app_private.cos_archived_representations','public.equipment_unit_location_history','app_private.cos_owner_identity_claims',
 'cos_mhelp_placement_private.upload_control','cos_mhelp_placement_private.upload_batches','cos_mhelp_placement_private.source_continuity'
];
const literals=values=>values.map(x=>"'"+x.replaceAll("'","''")+"'").join(',');
export const catalogQuery=`select coalesce(jsonb_agg(to_jsonb(q) order by q.signature),'[]'::jsonb) value from (
 select n.nspname||'.'||p.proname||'('||pg_catalog.oidvectortypes(p.proargtypes)||')' signature,
 pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex') definition_sha256,
 p.proowner::regrole::text owner,p.proacl::text acl,p.prosecdef security_definer,p.provolatile volatility,p.proparallel parallel,
 p.proconfig settings,p.prorettype::regtype::text returns,lan.lanname language,p.proisstrict strict,p.proleakproof leakproof,
 p.prokind kind,p.proretset returns_set,p.procost cost,p.prorows rows,p.pronargs arguments,p.pronargdefaults default_count,
 p.provariadic::regtype::text variadic,p.prosupport::regproc::text support,p.probin binary,p.proargdefaults::text default_expression,
 p.protrftypes transforms,p.prosqlbody::text sql_body,p.proargnames argument_names,p.proargmodes argument_modes,
 p.proallargtypes::regtype[]::text all_argument_types
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace join pg_catalog.pg_language lan on lan.oid=p.prolang
 where p.oid in(select pg_catalog.to_regprocedure(x) from unnest(array[${literals(signatures)}]) x)
 or (n.nspname='public' and p.proname='cos_mhelp_placement_snapshot')
 or (n.nspname='cos_mhelp_placement_private' and p.proname in ('upload_binding_guard','continuity_current'))
 ) q`;
export const schemaQuery=`select coalesce(jsonb_agg(to_jsonb(q) order by q.relation),'[]'::jsonb) value from (
 select n.nspname||'.'||c.relname relation,c.relkind kind,c.relowner::regrole::text owner,c.relacl::text acl,
 c.relrowsecurity row_security,c.relforcerowsecurity force_row_security,c.reloptions options,c.relpersistence persistence,
 (select coalesce(jsonb_agg(pn.nspname||'.'||pc.relname order by h.inhseqno),'[]'::jsonb) from pg_catalog.pg_inherits h join pg_catalog.pg_class pc on pc.oid=h.inhparent join pg_catalog.pg_namespace pn on pn.oid=pc.relnamespace where h.inhrelid=c.oid) parents,
 (select coalesce(jsonb_agg(cn.nspname||'.'||cc.relname order by cn.nspname,cc.relname),'[]'::jsonb) from pg_catalog.pg_inherits h join pg_catalog.pg_class cc on cc.oid=h.inhrelid join pg_catalog.pg_namespace cn on cn.oid=cc.relnamespace where h.inhparent=c.oid) children,
 (select coalesce(jsonb_agg(jsonb_build_object('number',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
 'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'acl',a.attacl::text,
 'collation',case when a.attcollation=0 then null else (select cn.nspname||'.'||co.collname from pg_catalog.pg_collation co join pg_catalog.pg_namespace cn on cn.oid=co.collnamespace where co.oid=a.attcollation) end,
 'default',(select pg_catalog.pg_get_expr(d.adbin,d.adrelid) from pg_catalog.pg_attrdef d where d.adrelid=a.attrelid and d.adnum=a.attnum)) order by a.attnum),'[]'::jsonb)
 from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) columns,
 (select coalesce(jsonb_agg(jsonb_build_object('name',k.conname,'type',k.contype,'definition',pg_catalog.pg_get_constraintdef(k.oid),
 'deferrable',k.condeferrable,'deferred',k.condeferred,'validated',k.convalidated,'no_inherit',k.connoinherit) order by k.conname),'[]'::jsonb)
 from pg_catalog.pg_constraint k where k.conrelid=c.oid) constraints,
 (select coalesce(jsonb_agg(jsonb_build_object('name',ic.relname,'definition',pg_catalog.pg_get_indexdef(i.indexrelid),
 'owner',ic.relowner::regrole::text,'method',am.amname,'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,
 'unique',i.indisunique,'primary',i.indisprimary,'exclusion',i.indisexclusion,'immediate',i.indimmediate,
 'key_count',i.indnkeyatts,'attribute_count',i.indnatts,'options',ic.reloptions,
 'predicate',pg_catalog.pg_get_expr(i.indpred,i.indrelid),'expression',pg_catalog.pg_get_expr(i.indexprs,i.indrelid)) order by ic.relname),'[]'::jsonb)
 from pg_catalog.pg_index i join pg_catalog.pg_class ic on ic.oid=i.indexrelid join pg_catalog.pg_am am on am.oid=ic.relam where i.indrelid=c.oid) indexes,
 (select coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'enabled',t.tgenabled) order by t.tgname),'[]'::jsonb) from pg_catalog.pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal) triggers,
 (select coalesce(jsonb_agg(to_jsonb(pol) order by pol.policyname),'[]'::jsonb) from pg_catalog.pg_policies pol where pol.schemaname=n.nspname and pol.tablename=c.relname) policies
 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where c.oid in(select pg_catalog.to_regclass(x) from unnest(array[${literals(relations)}]) x)
 ) q`;
const coreHashes={
 'cos_mhelp_placement_private.upload_snapshot()':'5eb4d6d918686a3eede3e122a4227acc5281e84f47df05c699ff4e696a56195b',
 'cos_mhelp_placement_private.upload_binding_guard(uuid, uuid)':'6c6163ee414b04a046e4e4aca49eae9a3b4d609d46dab2de6ebfeb814ec096b7',
 'cos_mhelp_placement_private.continuity_current(uuid, uuid, text)':'c6f4af6579a1dccee3c33c5b66ec04fc7db02555d2d1391298f5bf9234431ad1',
 'cos_mhelp_placement_private.guard(uuid, uuid)':'d49a368db1d4b5ce936d3f3f9636d53bbec1093b3b53c53179c3bf8c3a3f7984',
 'public.cos_mhelp_placement_snapshot(uuid, uuid)':'95a859becc87439d9fd5ab66ed238644b73193ce9fea1d25d15f594bb17d7de9',
 'public.cos_mhelp_placement_snapshot(uuid, uuid, text)':'c14b0f888d51cbeb6f322cd80df3317caafc16357812c4ee676e4111b36660dd'
};
const targetSignature='cos_mhelp_placement_private.upload_snapshot()';
const normalize=s=>s.replaceAll(', ', ',');
const body=(sql,delimiter)=>{const first=sql.indexOf(delimiter),last=sql.lastIndexOf(delimiter);assert(first>=0&&last>first);return sql.slice(first+delimiter.length,last);};
export async function captureCatalog(client){
 const catalog=(await client.query(catalogQuery)).rows[0].value;const schemaResult=(await client.query("select q.value,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(q.value::text,'UTF8')),'hex') fingerprint from ("+schemaQuery+") q")).rows[0];const schema=schemaResult.value;
 const target=(await client.query("select pg_catalog.pg_get_functiondef(p.oid) definition,p.prosrc body from pg_catalog.pg_proc p where p.oid='cos_mhelp_placement_private.upload_snapshot()'::regprocedure")).rows[0];
 return {catalog,schema,schemaFingerprint:schemaResult.fingerprint,target};
}
export function renderGuardedPackage(capture,{candidateSql,baselineSql,syntheticOnly=true}){
 assert.equal(typeof syntheticOnly,'boolean');
 assert.equal(sha256(candidateSql),expectedCandidateSha256,'Reviewed candidate SQL bytes changed');
 assert.equal(sha256(baselineSql),expectedBaselineSqlSha256,'Accepted baseline SQL bytes changed');
 assert.equal(capture.catalog.length,signatures.length,'Exact dependency signatures must exist, including both public overloads');
 assert.equal(capture.schema.length,relations.length,'All nine graph/authority relations required');
 assert.deepEqual(capture.catalog.map(x=>normalize(x.signature)).sort(),[...signatures].sort());
 assert.deepEqual(capture.schema.map(x=>x.relation).sort(),[...relations].sort());
 for(const [signature,expected] of Object.entries(coreHashes))assert.equal(capture.catalog.find(x=>x.signature===signature)?.definition_sha256,expected,'Known accepted function body drift: '+signature);
 for(const s of ['public.cos_mhelp_placement_snapshot(uuid, uuid)','public.cos_mhelp_placement_snapshot(uuid, uuid, text)']){const p=capture.catalog.find(x=>x.signature===s);assert.equal(p.owner,'postgres');assert.equal(p.acl,'{postgres=X/postgres,service_role=X/postgres}');assert.equal(p.security_definer,true);assert.equal(p.default_count,0);assert.deepEqual(p.settings,['search_path=""']);}
 const target=capture.catalog.find(x=>x.signature===targetSignature);assert.equal(target.owner,'postgres');assert.equal(target.acl,'{postgres=X/postgres}');assert.equal(target.volatility,'s');assert.equal(target.language,'sql');assert.equal(target.security_definer,false);assert.deepEqual(target.settings,['search_path=""']);
 assert.equal(capture.target.body,body(baselineSql,'$$'),'Captured baseline body is not supplied accepted source');
 assert.equal(sha256(capture.target.definition),target.definition_sha256);
 const candidateBody=body(candidateSql,'$upload$');assert.equal(candidateSql.match(/create or replace function/gi)?.length,1);assert(candidateSql.includes('create or replace function cos_mhelp_placement_private.upload_snapshot()'));
 const marker='$function$'+capture.target.body+'$function$';assert.equal(capture.target.definition.split(marker).length,2,'Canonical baseline delimiter changed');
 const candidateDefinition=capture.target.definition.replace(marker,'$function$'+candidateBody+'$function$');
 const expectedAfter=structuredClone(capture.catalog);expectedAfter.find(x=>x.signature===targetSignature).definition_sha256=sha256(candidateDefinition);
 const schemaHash=capture.schemaFingerprint;assert.match(schemaHash,/^[a-f0-9]{64}$/,'Canonical PostgreSQL schema fingerprint required');
 const nonBody=`select coalesce(jsonb_agg(to_jsonb(p)-'prosrc' order by p.oid),'[]'::jsonb) from pg_catalog.pg_proc p where p.oid in(select pg_catalog.to_regprocedure(x) from unnest(array[${literals(signatures)}]) x)`;
 const quoteJson=(x,tag)=>'$'+tag+'$'+JSON.stringify(x)+'$'+tag+'$::jsonb';
 function script(before,after,change,direction){
  const sql=`-- Exact catalog/schema-pinned ${direction}; one existing upload adapter body only.\n-- Synthetic CI approval is separate from production exact-head/fresh-catalog execution approval.\nbegin;\nset local lock_timeout='2s';\ndo $migration$\ndeclare actual jsonb; actual_schema jsonb; before_non_body jsonb; after_non_body jsonb;\nbegin\n if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('COS_UPLOAD_SETBASED_V1',0)) then\n  raise exception 'Upload adapter maintenance is already running' using errcode='55P03';\n end if;\n lock table ${relations.join(',')} in access share mode nowait;\n ${catalogQuery} into actual;\n ${schemaQuery} into actual_schema;\n if actual is not distinct from ${quoteJson(after,'after_catalog')} and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(actual_schema::text,'UTF8')),'hex')='${schemaHash}' then return; end if;\n if actual is distinct from ${quoteJson(before,'before_catalog')} or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(actual_schema::text,'UTF8')),'hex') is distinct from '${schemaHash}' then\n  raise exception '${direction} precondition: exact dependency/catalog/schema/constraint state changed' using errcode='55000';\n end if;\n ${nonBody} into before_non_body;\n execute $replace_upload$${change}$replace_upload$;\n -- POST_REPLACEMENT_TEST_MARKER: fault injection belongs only in disposable tests.\n ${catalogQuery} into actual;\n ${schemaQuery} into actual_schema;\n ${nonBody} into after_non_body;\n if actual is distinct from ${quoteJson(after,'after_catalog')} or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(actual_schema::text,'UTF8')),'hex') is distinct from '${schemaHash}' or after_non_body is distinct from before_non_body then\n  raise exception '${direction} postcondition: body/catalog/schema/permissions changed unexpectedly' using errcode='55000';\n end if;\nend $migration$;\ncommit;\n`;
  assert(!change.includes('$replace_upload$'));return sql;
 }
 const install=script(capture.catalog,expectedAfter,candidateSql,'Install'),rollback=script(expectedAfter,capture.catalog,baselineSql,'Rollback');
 return {install,rollback,manifest:{syntheticOnly,productionInstallationApproved:false,installFile:'install.sql',rollbackFile:'rollback.sql',installSha256:sha256(install),rollbackSha256:sha256(rollback),candidateFile:'db/upload-setbased.sql',candidateSha256:sha256(candidateSql),baselineUploadDefinitionSha256:target.definition_sha256,candidateUploadDefinitionSha256:sha256(candidateDefinition),fullSnapshotDefinitionSha256:coreHashes['public.cos_mhelp_placement_snapshot(uuid, uuid)'],cameraSnapshotDefinitionSha256:coreHashes['public.cos_mhelp_placement_snapshot(uuid, uuid, text)'],baselineCatalogSha256:sha256(capture.catalog),candidateCatalogSha256:sha256(expectedAfter),schemaSha256:schemaHash,dependencySignatures:signatures,relations},expectedBefore:capture.catalog,expectedAfter,schema:capture.schema};
}
export async function prepareGuardedPackage(client,{packageDir,repoRoot}){
 assert(packageDir&&repoRoot,'Explicit package and repository roots required');
 const meta=(await client.query('select current_database() database,version() version')).rows[0];
 assert(meta.database==='cos_camera_receipt_test_ci'||meta.version.includes('PGlite'),'Automatic package capture is restricted to disposable hosted/PGlite synthetic fixtures. Render reviewed production capture offline instead.');
 const candidateSql=await readFile(resolve(packageDir,'db/upload-setbased.sql'),'utf8'),baselineSql=await readFile(resolve(packageDir,'db/upload-baseline.sql'),'utf8');
 const capture=await captureCatalog(client),out=renderGuardedPackage(capture,{candidateSql,baselineSql});
 await mkdir(packageDir,{recursive:true});for(const [name,value] of [['install.sql',out.install],['rollback.sql',out.rollback],['manifest.json',out.manifest],['expected-before-catalog.json',out.expectedBefore],['expected-after-catalog.json',out.expectedAfter],['expected-schema.json',out.schema]])await writeFile(resolve(packageDir,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
 return out.manifest;
}

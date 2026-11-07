import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const restorationDependencies=Object.freeze([
 'cos_mhelp_placement_private.upload_snapshot()',
 'public.cos_mhelp_live_inventory_session(text,jsonb)',
 'cos_mhelp_placement_private.upload_binding_guard(uuid,uuid)',
 'cos_mhelp_placement_private.scoped_records(text)',
 'cos_mhelp_placement_private.recover_identity_evidence_records(jsonb)',
 'app_private.cos_owner_identity_assert_actor(uuid,uuid,boolean)',
 'app_private.appdeploy_assume_actor(uuid,uuid)',
 'app_private.has_permission(uuid,text)',
 'app_private.cos_archive_valid(app_private.cos_archived_representations)',
 'app_private.cos_archive_before(uuid,uuid,uuid,uuid)',
 'app_private.cos_archive_native_before(uuid)',
 'app_private.cos_archive_tracker_before(uuid)',
 'app_private.cos_archive_source_identities(jsonb)',
 'app_private.cos_archive_family_base(text)',
]);
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const sha=s=>createHash('sha256').update(s).digest('hex');
const once=(source,anchor,replacement)=>{
 if(source.split(anchor).length!==2)throw Error('Restoration install anchor changed: '+anchor);
 return source.replace(anchor,replacement);
};
/** Generates an explicit review candidate; never connects to a database.
 * Fetch and review fresh pg_get_functiondef values before generating for release.
 */
export async function prepareCanonicalBindingRestorationSql(installed){
 for(const sig of restorationDependencies)if(typeof installed[sig]!=='string'||!installed[sig].startsWith('CREATE OR REPLACE FUNCTION '))throw Error('Fresh installed definition required: '+sig);
 const snapshot=installed[restorationDependencies[0]],live=installed[restorationDependencies[1]];
 if(!live.includes('recover_identity_evidence_records') || !live.includes('identity_evidence'))throw Error('Private canonical proof persistence prerequisite missing');
 const base=once(snapshot,'FUNCTION cos_mhelp_placement_private.upload_snapshot()', 'FUNCTION cos_binding_restoration_private.base_snapshot()');
 const body=/AS \$function\$[\s\S]*\$function\$/g;
 if((snapshot.match(body)||[]).length!==1)throw Error('Unknown snapshot body delimiter');
 const wrapped=snapshot.replace(body,'AS $function$select cos_binding_restoration_private.project(cos_binding_restoration_private.base_snapshot())$function$');
 const patched=once(live,"r:=jsonb_set(r,'{binding}',coalesce(b,'null'::jsonb));", "r:=jsonb_set(r,'{binding}',coalesce(b,'null'::jsonb));\n  r:=cos_binding_restoration_private.retain_holds(old,r);");
 const checks=restorationDependencies.map(sig=>`if encode(sha256(convert_to(pg_get_functiondef(${quote(sig)}::regprocedure),'UTF8')),'hex')<>${quote(sha(installed[sig]))} then raise exception 'Restoration dependency changed: ${sig}';end if;`).join('\n');
 const component=await readFile(new URL('../db/canonical_binding_restoration.sql',import.meta.url),'utf8');
 return `begin;
set local lock_timeout='3s';
do $gate$begin
 if to_regnamespace('cos_binding_restoration_private') is not null then raise exception 'Restoration already installed; inspect existing release';end if;
 ${checks}
end$gate$;
${component}
${base.trim().replace(/;?$/,';')}
${wrapped.trim().replace(/;?$/,';')}
${patched.trim().replace(/;?$/,';')}
revoke all on function cos_binding_restoration_private.base_snapshot() from public,anon,authenticated,service_role;
create table cos_binding_restoration_private.definitions(signature text primary key,fingerprint text not null);
alter table cos_binding_restoration_private.definitions enable row level security;
revoke all on cos_binding_restoration_private.definitions from public,anon,authenticated,service_role;
create trigger definitions_immutable before update or delete or truncate on cos_binding_restoration_private.definitions for each statement execute function cos_binding_restoration_private.immutable();
create function cos_binding_restoration_private.assert_dependencies() returns void language plpgsql set search_path='' as $assert$
declare d record;p pg_catalog.pg_proc;
begin
 for d in select * from cos_binding_restoration_private.definitions loop
  select * into strict p from pg_catalog.pg_proc where oid=d.signature::regprocedure;
  if cos_binding_restoration_private.digest(jsonb_build_array(pg_get_functiondef(p.oid),p.proowner::text,p.proacl::text)) is distinct from d.fingerprint then raise exception 'Installed restoration dependencies changed' using errcode='40001';end if;
 end loop;
 if not exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid='cos_mhelp_placement_private.upload_batches'::regclass and t.tgname='canonical_history_immutable' and t.tgfoid='cos_binding_restoration_private.immutable()'::regprocedure and t.tgenabled in('O','A') and t.tgtype=58) then raise exception 'Immutable historical storage guard unavailable';end if;
 if exists(select 1 from unnest(array['stages','receipts','definitions']) n where not exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid=('cos_binding_restoration_private.'||n)::regclass and t.tgname=n||'_immutable' and t.tgfoid='cos_binding_restoration_private.immutable()'::regprocedure and t.tgenabled in('O','A') and t.tgtype=58)) then raise exception 'Immutable restoration storage guard unavailable';end if;
end$assert$;
revoke all on function cos_binding_restoration_private.assert_dependencies() from public,anon,authenticated,service_role;
insert into cos_binding_restoration_private.definitions
 select format('%I.%I(%s)',n.nspname,p.proname,oidvectortypes(p.proargtypes)),cos_binding_restoration_private.digest(jsonb_build_array(pg_get_functiondef(p.oid),p.proowner::text,p.proacl::text))
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname='cos_binding_restoration_private' or p.oid in (${restorationDependencies.map(s=>quote(s)+'::regprocedure').join(',')},'public.cos_owner_restore_seven_bindings_v1(uuid,uuid,uuid,text,jsonb,text,text)'::regprocedure);
commit;`;
}

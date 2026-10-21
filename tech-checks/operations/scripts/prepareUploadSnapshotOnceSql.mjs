import {createHash} from 'node:crypto';

export const uploadSnapshotSignature='cos_mhelp_placement_private.upload_snapshot()';
export const reviewedUploadSnapshotSha256='08b47f4133cbe9de810cfdfadd5e813897b4db5d2e82d70b971ead67ba57d0f9';
const hash=value=>createHash('sha256').update(value).digest('hex');
const once=(source,anchor,replacement)=>{
 if(source.split(anchor).length!==2)throw Error('Reviewed upload snapshot anchor changed');
 return source.replace(anchor,replacement);
};

/** One evaluation per SQL statement, with no saved/cross-request cache.
 * Preserve the existing projection, guards, proof redaction and authorization.
 * Refuse source drift so a different installed function requires fresh review. */
export function prepareUploadSnapshotOnceSql(installed){
 if(typeof installed!=='string'||hash(installed)!==reviewedUploadSnapshotSha256)
  throw Error('Exact reviewed upload snapshot definition required');
 let changed=once(installed,'AS $function$\n select',
  'AS $function$\n with snapshot as materialized (select cos_mhelp_placement_private.api_base_upload_snapshot() value)\n select');
 changed=once(changed,'from (select cos_mhelp_placement_private.api_base_upload_snapshot() value) b','from snapshot b');
 return `begin;
set local lock_timeout='5s';
do $cos_snapshot_guard$
declare p pg_catalog.pg_proc;
begin
 select * into strict p from pg_catalog.pg_proc where oid='${uploadSnapshotSignature}'::regprocedure;
 if encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')<>'${reviewedUploadSnapshotSha256}' then
  raise exception 'Installed upload snapshot changed; fresh review required';
 end if;
 if pg_get_userbyid(p.proowner)<>'postgres' or p.proacl::text is distinct from '{postgres=X/postgres}'
  or p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[] then
  raise exception 'Installed upload snapshot permissions or configuration changed';
 end if;
end $cos_snapshot_guard$;
${changed.trim().replace(/;?$/,';')}
commit;
`;
}

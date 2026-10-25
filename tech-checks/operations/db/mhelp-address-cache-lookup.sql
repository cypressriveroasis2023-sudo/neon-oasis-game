-- Native project only. Guarded performance delta; no data, schedule or timeout changes.
begin;
set local lock_timeout='1s';
set local statement_timeout='30s';
create function cos_mhelp_placement_private.address_cache_json_key_v1(a jsonb) returns bytea
language sql immutable set search_path='' as $jsonkey$
 select sha256(convert_to(cos_mhelp_placement_private.address_parts_v1(a)::text,'UTF8'))
$jsonkey$;
revoke all on function cos_mhelp_placement_private.address_cache_json_key_v1(jsonb) from public,anon,authenticated,service_role;
-- Pure text normalization matches address_parts_v1 exactly; hashes are not proof.
create function cos_mhelp_placement_private.address_cache_lookup_key_v1(street text,city text,state text,zip text) returns bytea
language sql immutable set search_path='' as $key$
 select sha256(convert_to(cos_mhelp_placement_private.address_parts_v1(jsonb_build_object('street',street,'city',city,'state',state,'zip',zip))::text,'UTF8'))
$key$;
revoke all on function cos_mhelp_placement_private.address_cache_lookup_key_v1(text,text,text,text) from public,anon,authenticated,service_role;
create index census_mhelp_address_exact_lookup on cos_mhelp_placement_private.census_mhelp_address
 (cos_mhelp_placement_private.address_cache_lookup_key_v1(street,city,state,zip));
create index mhelp_address_resolution_corrected_lookup on cos_mhelp_placement_private.mhelp_address_resolution
 (cos_mhelp_placement_private.address_cache_json_key_v1(evidence->'ownerCorrectedAddress'))
 where status in ('matched','address_review') and evidence->'ownerCorrectedAddress' is not null;
do $upgrade$
declare before text; after text;
begin
 before:=pg_get_functiondef('cos_mhelp_placement_private.address_automation_sync_v1()'::regprocedure);
 if md5(before)<>'01b92cbebfd923130a4985696310684e' then raise exception 'Address worker definition changed';end if;
 if length(before)-length(replace(before,$old$   select a.source_sha256,a.address_sha256,q.* from cos_mhelp_placement_private.census_mhelp_address a
   join cos_mhelp_placement_private.upload_batches old on old.source_sha256=a.source_sha256$old$,''))<>length($old$   select a.source_sha256,a.address_sha256,q.* from cos_mhelp_placement_private.census_mhelp_address a
   join cos_mhelp_placement_private.upload_batches old on old.source_sha256=a.source_sha256$old$) then raise exception 'Address lookup anchor differs';end if;
 after:=replace(before,$old$   select a.source_sha256,a.address_sha256,q.* from cos_mhelp_placement_private.census_mhelp_address a
   join cos_mhelp_placement_private.upload_batches old on old.source_sha256=a.source_sha256$old$,$new$   -- Hash indexes select candidates only. The original full normalized address
   -- predicate below still rejects collisions and unrelated corrected references.
   with candidate_addresses as materialized (
    select a.source_sha256,a.address_sha256
    from cos_mhelp_placement_private.census_mhelp_address a
    where a.source_sha256<>b.source_sha256
     and cos_mhelp_placement_private.address_cache_lookup_key_v1(a.street,a.city,a.state,a.zip)=sha256(convert_to(parts::text,'UTF8'))
    union
    select f.source_sha256,f.address_sha256
    from cos_mhelp_placement_private.mhelp_address_resolution f
    join cos_mhelp_placement_private.upload_batches old on old.source_sha256=f.source_sha256 and old.payload_sha256=f.payload_sha256
    where f.source_sha256<>b.source_sha256 and f.status in ('matched','address_review')
     and f.evidence->'ownerCorrectedAddress' is not null
     and cos_mhelp_placement_private.address_cache_json_key_v1(f.evidence->'ownerCorrectedAddress')=sha256(convert_to(parts::text,'UTF8'))
   )
   select a.source_sha256,a.address_sha256,q.* from candidate_addresses selected
   join cos_mhelp_placement_private.census_mhelp_address a using(source_sha256,address_sha256)
   join cos_mhelp_placement_private.upload_batches old on old.source_sha256=a.source_sha256$new$);
 execute after;
 if pg_get_functiondef('cos_mhelp_placement_private.address_automation_sync_v1()'::regprocedure)<>after then raise exception 'Address worker readback differs';end if;
end $upgrade$;
commit;

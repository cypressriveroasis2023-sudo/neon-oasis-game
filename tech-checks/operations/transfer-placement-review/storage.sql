-- LOCAL REVIEW CANDIDATE ONLY. Not installed or authorized for production.
begin;
create table app_private.techcheck_placement_batches_v1 (
 generation bigint primary key check(generation>0),
 packet jsonb not null,
 admitted_at timestamptz not null default clock_timestamp()
);
alter table app_private.techcheck_placement_batches_v1 enable row level security;
revoke all on app_private.techcheck_placement_batches_v1 from public,anon,authenticated,service_role;
create trigger techcheck_placement_immutable before update or delete on app_private.techcheck_placement_batches_v1
 for each row execute function app_private.techcheck_transfer_event_immutable_v2();

create function public.cos_admit_transfer_placement_v1(p_expected_generation bigint,p_packet jsonb) returns bigint
language plpgsql security definer set search_path='' as $$
declare g bigint; r jsonb; saved timestamptz;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'Backend service required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(724091,1);
 select coalesce(max(generation),0) into g from app_private.techcheck_placement_batches_v1;
 -- Same backend-only boundary provides restart-safe CAS head reads; no new
 -- principal, table read grant, or public read endpoint is required.
 if p_packet is null then
  if p_expected_generation is not null then raise exception 'Invalid head read';end if;
  return g;
 end if;
 if p_expected_generation is distinct from g then raise exception 'Placement publication changed';end if;
 saved:=(p_packet->>'saved_at')::timestamptz;
 if saved is null or saved>clock_timestamp() or saved<clock_timestamp()-interval '45 minutes'
 or coalesce(p_packet->>'source_sha','')!~'^[a-f0-9]{64}$' or coalesce(p_packet->>'crosswalk_sha','')!~'^[a-f0-9]{64}$'
 or jsonb_typeof(p_packet->'rows') is distinct from 'array' then raise exception 'Invalid placement evidence';end if;
 if jsonb_array_length(p_packet->'rows')>10000 then raise exception 'Placement census too large';end if;
 if p_packet ? 'scope_keys' then
  if jsonb_typeof(p_packet->'scope_keys') is distinct from 'array' or jsonb_array_length(p_packet->'scope_keys')>10000
   or exists(select 1 from jsonb_array_elements(p_packet->'scope_keys') k where jsonb_typeof(k)<>'string' or not exists(select 1 from public.equipment_master e where to_jsonb(e.equipment_key)=k)) then raise exception 'Invalid transfer scope';end if;
  if exists(select 1 from jsonb_array_elements(p_packet->'rows') item where not (p_packet->'scope_keys' ? (item->>'equipment_key'))) then raise exception 'Evidence outside scope';end if;
 end if;
 if exists(select 1 from app_private.techcheck_placement_batches_v1 where generation=g and (packet->>'saved_at')::timestamptz>saved) then raise exception 'Older inventory rejected';end if;
 if exists(select 1 from app_private.techcheck_placement_batches_v1 where generation=g and (packet->>'saved_at')::timestamptz=saved and packet->>'source_sha' is distinct from p_packet->>'source_sha') then raise exception 'Conflicting inventory revision';end if;
 if exists(select 1 from app_private.techcheck_placement_batches_v1 where generation=g and packet=p_packet) then return g;end if;
 if exists(select 1 from jsonb_array_elements(p_packet->'rows') entry group by entry->>'equipment_key' having count(*)>1)
 or exists(select 1 from jsonb_array_elements(p_packet->'rows') entry group by entry->>'product_id' having count(*)>1)
 or exists(select 1 from jsonb_array_elements(p_packet->'rows') entry group by entry->>'native_unit_id' having count(*)>1) then raise exception 'Ambiguous placement identity';end if;
 for r in select value from jsonb_array_elements(p_packet->'rows') loop
  if coalesce(r->>'product_id','')!~'^[1-9][0-9]*$' or nullif(r->>'native_unit_id','') is null
  or coalesce(r->>'placement','') not in ('SHOP','FIELD','UNKNOWN') or jsonb_typeof(r->'eligible') is distinct from 'boolean'
  or not exists(select 1 from public.equipment_master e where e.equipment_key=r->>'equipment_key' and e.canonical_family=r->>'family' and e.unit_tag=r->>'unit_tag')
  or ((r->>'eligible')::boolean and (r->>'placement'<>'SHOP' or coalesce(r->>'binding_guard','')!~'^[a-f0-9]{64}$')) then raise exception 'Invalid exact equipment proof';end if;
 end loop;
 insert into app_private.techcheck_placement_batches_v1 values(g+1,p_packet,clock_timestamp());
 return g+1;
end$$;
revoke all on function public.cos_admit_transfer_placement_v1(bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.cos_admit_transfer_placement_v1(bigint,jsonb) to service_role;

create function app_private.techcheck_placement_evidence_v1(p_key text) returns jsonb
language sql stable security definer set search_path='' as $$
 select r||jsonb_build_object('generation',b.generation,'source_sha',b.packet->>'source_sha','crosswalk_sha',b.packet->>'crosswalk_sha','saved_at',b.packet->>'saved_at')
 from (select * from app_private.techcheck_placement_batches_v1 order by generation desc limit 1) b
 cross join lateral jsonb_array_elements(b.packet->'rows') r
 join public.equipment_master e on e.equipment_key=r->>'equipment_key' and e.canonical_family=r->>'family' and e.unit_tag=r->>'unit_tag'
 where r->>'equipment_key'=p_key and r->'eligible'='true'::jsonb and r->>'placement'='SHOP'
 and (b.packet->>'saved_at')::timestamptz between clock_timestamp()-interval '45 minutes' and clock_timestamp()
$$;
revoke all on function app_private.techcheck_placement_evidence_v1(text) from public,anon,authenticated,service_role;
create function app_private.techcheck_placement_managed_v1(p_key text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from app_private.techcheck_placement_batches_v1 b where b.packet->'scope_keys' ? p_key
 or exists(select 1 from jsonb_array_elements(b.packet->'rows') r where r->>'equipment_key'=p_key))
$$;
revoke all on function app_private.techcheck_placement_managed_v1(text) from public,anon,authenticated,service_role;
commit;

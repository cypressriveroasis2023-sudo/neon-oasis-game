-- Three-hour resource observations are separate from fresh equipment reads.
-- Additive service-only cache; existing Vault, source CAS and roles unchanged.
begin;
create table cos_mhelp_placement_private.inventory_resource_cache(
 cache_key text primary key,payload jsonb not null,observed_at timestamptz not null,
 check(length(cache_key)<=500),check(octet_length(payload::text)<=1048576)
);
alter table cos_mhelp_placement_private.inventory_resource_cache enable row level security;
revoke all on cos_mhelp_placement_private.inventory_resource_cache from public,anon,authenticated,service_role;
create function public.cos_mhelp_inventory_cache(p_action text,p_key text,p_payload jsonb default null,p_observed_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare r cos_mhelp_placement_private.inventory_resource_cache;n timestamptz:=clock_timestamp();kind text;owner_id text;rows jsonb;allowed text[];written integer;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 if p_key is null or length(p_key)>500 then raise exception 'Invalid cache identity';end if;
 if p_key ~ '^224643:/customers/[1-9][0-9]{0,14}\?Fields=customerId,portalId,name,isServiceLocation,isActive,address1,city,state,zip,countryId$' then kind:='customer';
 elsif p_key ~ '^224643:/customers/[1-9][0-9]{0,14}/servicelocations\?pageSize=200&rowIndex=([0-9]|[1-9][0-9]{1,3})&Fields=serviceLocationId,customerId,portalId,name,isActive,address1,city,state,zip,countryId$' then kind:='services';
 elsif p_key='224643:/equipmentTypes?pageSize=200&rowIndex=0&Fields=equipmentTypeId,portalId,category' then kind:='categories';
 else raise exception 'Invalid cache identity';end if;
 owner_id:=substring(p_key from '^224643:/customers/([1-9][0-9]{0,14})');
 if p_action='read' and p_payload is null and p_observed_at is null then
  select * into r from cos_mhelp_placement_private.inventory_resource_cache where cache_key=p_key;
  if r.cache_key is null or r.observed_at>n+interval '30 seconds' or r.observed_at<=n-interval '3 hours' then return jsonb_build_object('hit',false);end if;
  return jsonb_build_object('hit',true,'payload',r.payload,'observedAt',r.observed_at);
 elsif p_action='write' and p_payload is not null and octet_length(p_payload::text)<=1048576
  and p_observed_at<=n+interval '5 seconds' and p_observed_at>n-interval '2 minutes' then
  rows:=case kind when 'customer' then jsonb_build_array(p_payload) when 'categories' then p_payload else p_payload->'results' end;
  allowed:=case when kind='categories' then array['equipmentTypeId','portalId','category'] when kind='customer' then array['customerId','portalId','name','isServiceLocation','isActive','address1','city','state','zip','countryId'] else array['serviceLocationId','customerId','portalId','name','isActive','address1','city','state','zip','countryId'] end;
  if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows)>10000
   or exists(select 1 from jsonb_array_elements(rows) item where jsonb_typeof(item) is distinct from 'object' or item->>'portalId' is distinct from '224643'
    or (kind='customer' and item->>'customerId' is distinct from owner_id)
    or (kind='services' and item->'serviceLocationId' is not null and item->'serviceLocationId'<>'null'::jsonb and item->>'customerId' is distinct from owner_id)
    or item-allowed<>'{}'::jsonb or exists(select 1 from jsonb_each(item) field where jsonb_typeof(field.value) in('object','array')))
   then raise exception 'Unverified cached resource';end if;
  insert into cos_mhelp_placement_private.inventory_resource_cache(cache_key,payload,observed_at) values(p_key,p_payload,p_observed_at)
   on conflict(cache_key) do update set payload=excluded.payload,observed_at=excluded.observed_at
    where cos_mhelp_placement_private.inventory_resource_cache.observed_at<excluded.observed_at;
  get diagnostics written=row_count;
  return jsonb_build_object('saved',written=1);
 end if;
 raise exception 'Invalid cache operation';
end$$;
revoke all on function public.cos_mhelp_inventory_cache(text,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.cos_mhelp_inventory_cache(text,text,jsonb,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;

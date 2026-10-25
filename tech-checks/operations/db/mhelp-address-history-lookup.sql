-- Normalize historical positive address evidence once per atomic import.
-- Matching, ordering, customer-context checks and completion guards are unchanged.
begin;
set local lock_timeout='1s';
set local statement_timeout='30s';
create or replace function cos_mhelp_placement_private.address_automation_sync_v1() returns jsonb
language plpgsql set search_path='' as $$
declare b cos_mhelp_placement_private.upload_batches;r jsonb;parts jsonb;digest text;existing_row cos_mhelp_placement_private.census_mhelp_product;
 cached record;history_by_address jsonb;evidence jsonb;prior_group text[];current_group text[];n integer:=0;
begin
 if current_user not in ('postgres','supabase_admin') then raise exception 'Administrator worker required' using errcode='42501';end if;
 if not pg_try_advisory_xact_lock(20261018,287) then return jsonb_build_object('state','already_running');end if;
 select ub.* into b from cos_mhelp_placement_private.upload_control c join cos_mhelp_placement_private.upload_batches ub on ub.source_sha256=c.active_sha256 where c.singleton for share of c;
 if not found then return jsonb_build_object('state','no_accepted_upload');end if;
 if exists(select 1 from cos_mhelp_placement_private.address_automation_import i where i.source_sha256=b.source_sha256 and i.payload_sha256=b.payload_sha256) then return jsonb_build_object('state','current');end if;
 if jsonb_typeof(b.records) is distinct from 'array' or jsonb_array_length(b.records) not between 1 and 10000
 or jsonb_array_length(b.records) is distinct from (b.receipt->>'recordCount')::integer
 or exists(select 1 from jsonb_array_elements(b.records) x where coalesce(x->>'productId','')!~'^[1-9][0-9]{0,14}$' or coalesce(x->>'placement','') not in('FIELD','SHOP'))
 or (select count(distinct x->>'productId') from jsonb_array_elements(b.records) x)<>jsonb_array_length(b.records)
 then raise exception 'Complete accepted upload required';end if;
 for r in select value from jsonb_array_elements(b.records) loop
  select * into existing_row from cos_mhelp_placement_private.census_mhelp_product p where p.source_sha256=b.source_sha256 and p.product_id=r->>'productId';
  if found then
   if existing_row.payload_sha256 is distinct from b.payload_sha256 or existing_row.placement is distinct from r->>'placement'
    or existing_row.source_row_sha256 is distinct from encode(sha256(convert_to(r::text,'UTF8')),'hex') then raise exception 'Existing source membership differs';end if;
   continue;
  end if;
  parts:=cos_mhelp_placement_private.address_parts_v1(r->'sourceAddress');
  digest:=encode(sha256(convert_to(parts::text,'UTF8')),'hex');
  insert into cos_mhelp_placement_private.census_mhelp_address(source_sha256,address_sha256,street,city,state,zip,status,reason)
  values(b.source_sha256,digest,parts->>'street',parts->>'city',parts->>'state',parts->>'zip',
   case when cos_mhelp_placement_private.address_sendable_v1(parts) then 'no_match' else 'invalid_address' end,
   'Automatic address processing; original source is preserved.') on conflict do nothing;
  insert into cos_mhelp_placement_private.census_mhelp_product(source_sha256,payload_sha256,product_id,source_row_sha256,unit_number,placement,address_sha256)
  values(b.source_sha256,b.payload_sha256,r->>'productId',encode(sha256(convert_to(r::text,'UTF8')),'hex'),r->>'unitNumber',r->>'placement',digest);
  n:=n+1;
 end loop;
 -- This transaction-local map is derived from the same positive candidates.
 -- Full normalized JSON text is the key: no truncated hashes or fuzzy matching.
 with candidates as materialized (
   select a.source_sha256,a.address_sha256,q.*,cos_mhelp_placement_private.address_parts_v1(jsonb_build_object('street',a.street,'city',a.city,'state',a.state,'zip',a.zip)) original_parts,case when q.corrected_address is not null then cos_mhelp_placement_private.address_parts_v1(q.corrected_address) end corrected_parts from cos_mhelp_placement_private.census_mhelp_address a
   join cos_mhelp_placement_private.upload_batches old on old.source_sha256=a.source_sha256
   cross join lateral (
    select f.provider,f.status,f.reason,f.lookup_address,f.matched_address,f.latitude,f.longitude,f.geocoded_at,1 priority,f.id,f.evidence->'ownerCorrectedAddress' corrected_address
    from cos_mhelp_placement_private.mhelp_address_resolution f where f.source_sha256=a.source_sha256 and f.payload_sha256=old.payload_sha256 and f.address_sha256=a.address_sha256 and f.status in ('matched','address_review')
    union all select 'us_census_address_range',a.status,a.reason,a.matched_address,a.matched_address,a.latitude,a.longitude,a.completed_at,0,0,null::jsonb where a.status in ('matched','address_review') and a.census_benchmark='Public_AR_Current'
   ) q where a.source_sha256<>b.source_sha256
 ), grouped as (
  select keys.address_key,jsonb_agg(to_jsonb(c)-'original_parts'-'corrected_parts' order by c.priority desc,c.geocoded_at desc,c.id desc) entries
  from candidates c cross join lateral (
   select c.original_parts::text address_key
   union select c.corrected_parts::text where c.corrected_parts is not null
  ) keys group by keys.address_key
 ) select coalesce(jsonb_object_agg(address_key,entries),'{}'::jsonb) into history_by_address from grouped;
 -- Reuse only positive evidence from an identical address. Incomplete addresses
 -- additionally require known Field Product IDs and the same customer/site context (e.g. owner Lee Rd correction).
 for existing_row in select distinct on(p.address_sha256) p.* from cos_mhelp_placement_private.census_mhelp_product p where p.source_sha256=b.source_sha256 and p.placement='FIELD' order by p.address_sha256,p.product_id loop
  if exists(select 1 from cos_mhelp_placement_private.mhelp_address_resolution f where f.source_sha256=b.source_sha256 and f.payload_sha256=b.payload_sha256 and f.address_sha256=existing_row.address_sha256 and f.status in ('matched','address_review'))
   or exists(select 1 from cos_mhelp_placement_private.census_mhelp_address a where a.source_sha256=b.source_sha256 and a.address_sha256=existing_row.address_sha256 and a.status in ('matched','address_review')) then continue;end if;
  select cos_mhelp_placement_private.address_parts_v1(jsonb_build_object('street',a.street,'city',a.city,'state',a.state,'zip',a.zip)) into parts from cos_mhelp_placement_private.census_mhelp_address a where a.source_sha256=b.source_sha256 and a.address_sha256=existing_row.address_sha256;
  for cached in
   select * from jsonb_to_recordset(coalesce(history_by_address->parts::text,'[]'::jsonb)) as c(
    source_sha256 text,address_sha256 text,provider text,status text,reason text,
    lookup_address text,matched_address text,latitude double precision,longitude double precision,
    geocoded_at timestamptz,priority integer,id bigint,corrected_address jsonb)
   order by c.priority desc,c.geocoded_at desc,c.id desc
  loop
   if not cos_mhelp_placement_private.address_sendable_v1(parts) then
    select array_agg(p.product_id order by p.product_id) into prior_group from cos_mhelp_placement_private.census_mhelp_product p where p.source_sha256=cached.source_sha256 and p.address_sha256=cached.address_sha256 and p.placement='FIELD';
    select array_agg(p.product_id order by p.product_id) into current_group from cos_mhelp_placement_private.census_mhelp_product p where p.source_sha256=b.source_sha256 and p.address_sha256=existing_row.address_sha256 and p.placement='FIELD';
    if current_group is null or prior_group is null or not current_group <@ prior_group then continue;end if;
   -- A returned-to-Shop product may leave a reviewed group. Every remaining
   -- Field product must still have the same recorded customer/site context.
   if exists(
    select 1 from jsonb_array_elements(b.records) current_record
    where current_record->>'productId'=any(current_group)
     and not exists(
      select 1 from cos_mhelp_placement_private.upload_batches prior_batch
      cross join lateral jsonb_array_elements(prior_batch.records) prior_record
      where prior_batch.source_sha256=cached.source_sha256
       and prior_record->>'productId'=current_record->>'productId'
       and prior_record->>'placement'='FIELD'
       and coalesce(current_record->>'customerId','')<>''
       and prior_record->>'customerId'=current_record->>'customerId'
       and upper(trim(regexp_replace(prior_record->>'customer','[[:space:]]+',' ','g')))
        =upper(trim(regexp_replace(current_record->>'customer','[[:space:]]+',' ','g')))
     )
   ) then continue;end if;
   end if;
   evidence:=jsonb_build_object('automation','exact_address_cache_v1','reusedFromSourceSha256',cached.source_sha256,'reusedFromAddressSha256',cached.address_sha256,'reusedFromResolutionId',cached.id,'sourceSha256',b.source_sha256,'payloadSha256',b.payload_sha256,'addressSha256',existing_row.address_sha256,'verifiedGps',false,'liveGps',false,'originalSourcePreserved',true);
   insert into cos_mhelp_placement_private.mhelp_address_resolution(source_sha256,payload_sha256,address_sha256,provider,lookup_address,status,reason,matched_address,latitude,longitude,geocoded_at,evidence,evidence_sha256)
   values(b.source_sha256,b.payload_sha256,existing_row.address_sha256,cached.provider,coalesce(cached.lookup_address,cached.matched_address),cached.status,cached.reason,cached.matched_address,cached.latitude,cached.longitude,cached.geocoded_at,evidence,encode(sha256(convert_to(evidence::text,'UTF8')),'hex'));
   exit;
  end loop;
 end loop;
 insert into cos_mhelp_placement_private.address_automation_import(source_sha256,payload_sha256,record_count) values(b.source_sha256,b.payload_sha256,jsonb_array_length(b.records));
 return jsonb_build_object('state','synced','addedProducts',n);
end$$;
revoke all on function cos_mhelp_placement_private.address_automation_sync_v1() from public,anon,authenticated,service_role;
commit;

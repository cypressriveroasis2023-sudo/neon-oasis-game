-- Exact Census provider responses, detached from native camera/GPS identity.
-- No external payload or claim can alter the immutable mHelpDesk source.
begin;
create function cos_mhelp_placement_private.census_mhelp_classify_response(
 code integer, error_text text, content text,
 source_street text, source_city text, source_state text, source_zip text)
returns jsonb language plpgsql immutable set search_path='' as $$
declare j jsonb; a jsonb; m jsonb; coords jsonb; n integer;
 latitude double precision;longitude double precision;
 matched text; review boolean:=false; zip text; city text; state text; number text;
begin
 if code is distinct from 200 or error_text is not null or content is null then
  return jsonb_build_object('status','provider_error','reason',left(coalesce(error_text,'http_'||coalesce(code::text,'unknown')),250));end if;
 begin j:=content::jsonb;exception when others then
  return jsonb_build_object('status','provider_error','reason','provider_response_invalid_json');end;
 a:=j#>'{result,addressMatches}';
 if j#>>'{result,input,benchmark,benchmarkName}' is distinct from 'Public_AR_Current'
   or jsonb_typeof(a) is distinct from 'array' then
  return jsonb_build_object('status','provider_error','reason','census_benchmark_or_response_invalid');end if;
 n:=jsonb_array_length(a);
 if n=0 then return jsonb_build_object('status','no_match','matches',0);end if;
 if n>1 then return jsonb_build_object('status','ambiguous','matches',n);end if;
 m:=a->0;coords:=m->'coordinates';matched:=m->>'matchedAddress';
 begin latitude:=(coords->>'y')::double precision;longitude:=(coords->>'x')::double precision;
 exception when others then return jsonb_build_object('status','provider_error','reason','census_coordinate_invalid');end;
 if latitude is null or longitude is null or latitude not between -90 and 90
 or longitude not between -180 and 180 or latitude=0 and longitude=0
 or matched is null or matched='' then return jsonb_build_object('status','provider_error','reason','census_match_incomplete');end if;
 city:=upper(coalesce(m#>>'{addressComponents,city}',''));
 state:=upper(coalesce(m#>>'{addressComponents,state}',''));
 zip:=coalesce(m#>>'{addressComponents,zip}','');
 number:=substring(source_street from '^[0-9]+');
 review:=state is distinct from upper(source_state) or
  (source_zip<>'' and left(zip,5) is distinct from left(source_zip,5)) or
  (source_city<>'' and city is distinct from upper(source_city)) or
  (number is null or left(matched,length(number)+1) is distinct from number||' ');
 return jsonb_build_object(
  'status',case when review then 'address_review' else 'matched' end,
  'reason',case when review then 'matched_address_components_differ_from_source' else null end,
  'matches',1,'benchmark','Public_AR_Current',
  'matchedAddress',matched,'latitude',latitude,'longitude',longitude);
end$$;
revoke all on function cos_mhelp_placement_private.census_mhelp_classify_response(integer,text,text,text,text,text,text)
 from public,anon,authenticated,service_role;
create function cos_mhelp_placement_private.census_mhelp_send(p_limit integer default 12)
returns integer language plpgsql set search_path='' as $$
declare a record; id bigint; sent integer:=0; active_source text;
begin
 if current_user<>'postgres' then raise exception 'Existing SQL administrator required' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' or p_limit not between 1 and 16
  then raise exception 'Bounded READ COMMITTED sweep required';end if;
 perform set_config('lock_timeout','2000ms',true);
 select active_sha256 into strict active_source from cos_mhelp_placement_private.upload_control where singleton for share;
 for a in select * from cos_mhelp_placement_private.census_mhelp_address
   where source_sha256=active_source and status='pending' order by address_sha256
   limit p_limit for update skip locked loop
  id:=net.http_get(
    url:='https://geocoding.geo.census.gov/geocoder/locations/address',
    params:=jsonb_build_object('street',a.street,'city',a.city,'state',a.state,
       'zip',a.zip,'benchmark','Public_AR_Current','format','json'),
    headers:='{"Accept":"application/json"}'::jsonb,timeout_milliseconds:=25000);
  update cos_mhelp_placement_private.census_mhelp_address
   set status='queued',request_id=id,requested_at=clock_timestamp()
   where source_sha256=active_source and address_sha256=a.address_sha256;
  sent:=sent+1;
 end loop;
 return sent;
end$$;
create function cos_mhelp_placement_private.census_mhelp_collect(p_limit integer default 60)
returns jsonb language plpgsql set search_path='' as $$
declare a record; proof jsonb;n integer:=0; success integer:=0; provider_errors integer:=0;
begin
 if current_user<>'postgres' then raise exception 'Existing SQL administrator required' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' or p_limit not between 1 and 100 then
  raise exception 'Bounded READ COMMITTED collection required';end if;
 perform set_config('lock_timeout','2000ms',true);
 for a in
  select l.*,r.status_code,r.error_msg,r.content from cos_mhelp_placement_private.census_mhelp_address l
  join net._http_response r on r.id=l.request_id
  join cos_mhelp_placement_private.upload_control c on c.active_sha256=l.source_sha256 and c.singleton
  where l.status='queued' order by l.requested_at limit p_limit for update of l skip locked
 loop
  proof:=cos_mhelp_placement_private.census_mhelp_classify_response(
    a.status_code,a.error_msg,a.content,a.street,a.city,a.state,a.zip);
  insert into cos_mhelp_placement_private.census_mhelp_http_receipt
   (source_sha256,address_sha256,request_id,status,status_code,error_reason,match_count,response_sha256)
  values(a.source_sha256,a.address_sha256,a.request_id,proof->>'status',a.status_code,
    proof->>'reason',(proof->>'matches')::int,
    encode(sha256(convert_to(coalesce(a.content,''),'UTF8')),'hex'));
  update cos_mhelp_placement_private.census_mhelp_address
  set status=proof->>'status',reason=proof->>'reason',http_status=a.status_code,
   census_benchmark=proof->>'benchmark',matches=(proof->>'matches')::integer,
   matched_address=proof->>'matchedAddress',
   latitude=(proof->>'latitude')::double precision,
   longitude=(proof->>'longitude')::double precision,
   completed_at=clock_timestamp()
  where source_sha256=a.source_sha256 and address_sha256=a.address_sha256 and request_id=a.request_id;
  n:=n+1; if proof->>'status' in ('matched','address_review') then success:=success+1;end if;
  if proof->>'status'='provider_error' then provider_errors:=provider_errors+1;end if;
 end loop;
 return jsonb_build_object('collected',n,'matchedOrReview',success,'providerErrors',provider_errors);
end$$;
revoke all on function cos_mhelp_placement_private.census_mhelp_send(integer),
 cos_mhelp_placement_private.census_mhelp_collect(integer) from public,anon,authenticated,service_role;
create view cos_mhelp_placement_private.census_mhelp_current_coverage
with (security_invoker=true) as
select p.product_id,p.unit_number,p.placement,p.source_sha256,p.payload_sha256,p.source_row_sha256,
 a.address_sha256,a.street,a.city,a.state,a.zip,a.status,a.reason,
 a.census_benchmark,a.matched_address,a.latitude,a.longitude,a.matches,a.http_status,a.completed_at,
 false as verified_gps,false as live_gps,'census_address_range_not_installed_equipment_location'::text as confidence
from cos_mhelp_placement_private.census_mhelp_product p
join cos_mhelp_placement_private.census_mhelp_address a
 on a.source_sha256=p.source_sha256 and a.address_sha256=p.address_sha256
join cos_mhelp_placement_private.upload_control c on c.active_sha256=p.source_sha256 and c.singleton
join cos_mhelp_placement_private.upload_batches b on b.source_sha256=p.source_sha256 and b.payload_sha256=p.payload_sha256;
revoke all on cos_mhelp_placement_private.census_mhelp_current_coverage from public,anon,authenticated,service_role;
commit;
-- NATIVE project. Autonomous address-only processing of accepted mHelp uploads.
-- Existing source/Census bytes, native inventory, identities and GPS are immutable.
-- No new API, role grant, credential or external destination is introduced.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';

create table cos_mhelp_placement_private.address_automation_import (
 source_sha256 text primary key references cos_mhelp_placement_private.upload_batches(source_sha256),
 payload_sha256 text not null,record_count integer not null,processed_at timestamptz not null default clock_timestamp()
);
create table cos_mhelp_placement_private.address_automation_job (
 source_sha256 text not null,payload_sha256 text not null,address_sha256 text not null,
 status text not null default 'queued' check(status in ('queued','reserved','matched','no_match','invalid_address','provider_error','superseded')),
 attempts integer not null default 0 check(attempts>=0),request_id bigint unique,
 requested_at timestamptz,next_attempt_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,reason text,
 primary key(source_sha256,address_sha256),
 foreign key(source_sha256,address_sha256) references cos_mhelp_placement_private.census_mhelp_address(source_sha256,address_sha256)
);
alter table cos_mhelp_placement_private.address_automation_import enable row level security;
alter table cos_mhelp_placement_private.address_automation_job enable row level security;
revoke all on cos_mhelp_placement_private.address_automation_import,cos_mhelp_placement_private.address_automation_job from public,anon,authenticated,service_role;

create function cos_mhelp_placement_private.address_parts_v1(a jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('street',upper(trim(regexp_replace(coalesce(a->>'street',''),'[[:space:]]+',' ','g'))),
 'city',upper(trim(regexp_replace(coalesce(a->>'city',''),'[[:space:]]+',' ','g'))),
 'state',upper(trim(coalesce(a->>'state',''))),'zip',left(trim(coalesce(a->>'zip','')),5))
$$;
create function cos_mhelp_placement_private.address_street_key_v1(s text) returns text
language plpgsql immutable set search_path='' as $$
declare value text:=upper(trim(regexp_replace(replace(s,'.',''),'[[:space:]]+',' ','g')));pair text[];
begin
 foreach pair slice 1 in array array[['ROAD','RD'],['STREET','ST'],['AVENUE','AVE'],['BOULEVARD','BLVD'],['DRIVE','DR'],['LANE','LN'],['COURT','CT'],['PLACE','PL'],['PARKWAY','PKWY'],['HIGHWAY','HWY'],['NORTH','N'],['SOUTH','S'],['EAST','E'],['WEST','W'],['TERRACE','TER'],['CIRCLE','CIR'],['TRAIL','TRL']] loop
  value:=regexp_replace(value,'\m'||pair[1]||'\M',pair[2],'g');
 end loop;
 return value;
end$$;
create function cos_mhelp_placement_private.address_sendable_v1(a jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(length(a->>'street') between 3 and 250 and a->>'street' ~ '^[0-9]+[A-Z]?[[:space:]]+[A-Z0-9 .''-]+$'
 and length(a->>'city')<=100 and (a->>'city'='' or a->>'city' ~ '^[A-Z .''-]+$')
 and (a->>'state'='' or a->>'state'=any(string_to_array('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP',' ')))
 and (a->>'zip'='' or a->>'zip' ~ '^[0-9]{5}$')
 and (a->>'zip'<>'' or (a->>'city'<>'' and a->>'state'<>''))
 and (a->>'street') !~* '(password|passwd|token|secret|credential|gate[ -]*code|access[ -]*code|\mpin\M|https?|suite|apartment|\mAPT\M|\mUNIT\M)',false)
$$;

create function cos_mhelp_placement_private.address_automation_sync_v1() returns jsonb
language plpgsql set search_path='' as $$
declare b cos_mhelp_placement_private.upload_batches;r jsonb;parts jsonb;digest text;existing_row cos_mhelp_placement_private.census_mhelp_product;
 cached record;evidence jsonb;prior_group text[];current_group text[];n integer:=0;
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
 -- Reuse only positive evidence from an identical address. Incomplete addresses
 -- additionally require known Field Product IDs and the same customer/site context (e.g. owner Lee Rd correction).
 for existing_row in select distinct on(p.address_sha256) p.* from cos_mhelp_placement_private.census_mhelp_product p where p.source_sha256=b.source_sha256 and p.placement='FIELD' order by p.address_sha256,p.product_id loop
  if exists(select 1 from cos_mhelp_placement_private.mhelp_address_resolution f where f.source_sha256=b.source_sha256 and f.payload_sha256=b.payload_sha256 and f.address_sha256=existing_row.address_sha256 and f.status in ('matched','address_review'))
   or exists(select 1 from cos_mhelp_placement_private.census_mhelp_address a where a.source_sha256=b.source_sha256 and a.address_sha256=existing_row.address_sha256 and a.status in ('matched','address_review')) then continue;end if;
  select cos_mhelp_placement_private.address_parts_v1(jsonb_build_object('street',a.street,'city',a.city,'state',a.state,'zip',a.zip)) into parts from cos_mhelp_placement_private.census_mhelp_address a where a.source_sha256=b.source_sha256 and a.address_sha256=existing_row.address_sha256;
  for cached in
   select a.source_sha256,a.address_sha256,q.* from cos_mhelp_placement_private.census_mhelp_address a
   join cos_mhelp_placement_private.upload_batches old on old.source_sha256=a.source_sha256
   cross join lateral (
    select f.provider,f.status,f.reason,f.lookup_address,f.matched_address,f.latitude,f.longitude,f.geocoded_at,1 priority,f.id,f.evidence->'ownerCorrectedAddress' corrected_address
    from cos_mhelp_placement_private.mhelp_address_resolution f where f.source_sha256=a.source_sha256 and f.payload_sha256=old.payload_sha256 and f.address_sha256=a.address_sha256 and f.status in ('matched','address_review')
    union all select 'us_census_address_range',a.status,a.reason,a.matched_address,a.matched_address,a.latitude,a.longitude,a.completed_at,0,0,null::jsonb where a.status in ('matched','address_review') and a.census_benchmark='Public_AR_Current'
   ) q where a.source_sha256<>b.source_sha256
    and (cos_mhelp_placement_private.address_parts_v1(jsonb_build_object('street',a.street,'city',a.city,'state',a.state,'zip',a.zip))=parts
      or q.corrected_address is not null and cos_mhelp_placement_private.address_parts_v1(q.corrected_address)=parts)
   order by q.priority desc,q.geocoded_at desc,q.id desc
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

create function cos_mhelp_placement_private.address_automation_tick_v1() returns jsonb
language plpgsql set search_path='' as $$
declare active_source text;active_payload text;j cos_mhelp_placement_private.address_automation_job;current_addr cos_mhelp_placement_private.census_mhelp_address;
 response record;data jsonb;matches jsonb;m jsonb;parts jsonb;matched_parts jsonb;lat double precision;lon double precision;v_reason text;success boolean;evidence jsonb;sync_result jsonb;sent integer:=0;settled integer:=0;
begin
 if current_user not in ('postgres','supabase_admin') then raise exception 'Administrator worker required' using errcode='42501';end if;
 if not pg_try_advisory_xact_lock(20261018,287) then return jsonb_build_object('state','already_running');end if;
 sync_result:=cos_mhelp_placement_private.address_automation_sync_v1();
 select c.active_sha256,b.payload_sha256 into active_source,active_payload from cos_mhelp_placement_private.upload_control c join cos_mhelp_placement_private.upload_batches b on b.source_sha256=c.active_sha256 where c.singleton for share of c;
 if active_source is null then return sync_result;end if;
 update cos_mhelp_placement_private.address_automation_job set status='superseded',reason='source_superseded' where source_sha256<>active_source and status<>'superseded';
 update cos_mhelp_placement_private.address_automation_job set status='queued',request_id=null,requested_at=null,next_attempt_at=clock_timestamp() where source_sha256=active_source and status='superseded';
 insert into cos_mhelp_placement_private.address_automation_job(source_sha256,payload_sha256,address_sha256)
 select distinct p.source_sha256,p.payload_sha256,p.address_sha256 from cos_mhelp_placement_private.census_mhelp_product p join cos_mhelp_placement_private.census_mhelp_address a using(source_sha256,address_sha256)
 where p.source_sha256=active_source and p.payload_sha256=active_payload and p.placement='FIELD' and a.status in ('no_match','invalid_address')
 and not exists(select 1 from cos_mhelp_placement_private.mhelp_address_resolution f where f.source_sha256=p.source_sha256 and f.payload_sha256=p.payload_sha256 and f.address_sha256=p.address_sha256 and f.status in ('matched','address_review')) on conflict do nothing;
 -- A subsequently accepted reference wins even if this job was already sent.
 update cos_mhelp_placement_private.address_automation_job jobrow set status='matched',reason='positive_address_reference_available',completed_at=clock_timestamp()
 where jobrow.source_sha256=active_source and jobrow.status<>'matched' and exists(select 1 from cos_mhelp_placement_private.mhelp_address_resolution f where f.source_sha256=jobrow.source_sha256 and f.payload_sha256=jobrow.payload_sha256 and f.address_sha256=jobrow.address_sha256 and f.status in ('matched','address_review'));
 for j in select * from cos_mhelp_placement_private.address_automation_job where source_sha256=active_source and payload_sha256=active_payload and status='reserved' order by requested_at limit 16 for update skip locked loop
  select * into response from net._http_response where id=j.request_id;
  if not found and j.requested_at>clock_timestamp()-interval '2 minutes' then continue;end if;
  v_reason:='provider_unavailable';success:=false;m:=null;
  if response.status_code=200 and response.error_msg is null and not coalesce(response.timed_out,false) and octet_length(response.content)<=262144 then
   begin
    data:=response.content::jsonb;matches:=data->'result'->'addressMatches';
    if jsonb_typeof(matches) is distinct from 'array' or jsonb_array_length(matches)>50 then raise exception 'Invalid response';end if;
    v_reason:='no_exact_address_match';
    if jsonb_array_length(matches)=1 then
     m:=matches->0;
     select * into current_addr from cos_mhelp_placement_private.census_mhelp_address where source_sha256=j.source_sha256 and address_sha256=j.address_sha256;
     parts:=cos_mhelp_placement_private.address_parts_v1(jsonb_build_object('street',current_addr.street,'city',current_addr.city,'state',current_addr.state,'zip',current_addr.zip));
     matched_parts:=cos_mhelp_placement_private.address_parts_v1(jsonb_build_object('street',split_part(m->>'matchedAddress',',',1),'city',m->'addressComponents'->>'city','state',m->'addressComponents'->>'state','zip',m->'addressComponents'->>'zip'));
     if cos_mhelp_placement_private.address_street_key_v1(parts->>'street')=cos_mhelp_placement_private.address_street_key_v1(matched_parts->>'street')
      and (parts->>'city'='' or parts->>'city'=matched_parts->>'city')
      and (parts->>'state'='' or parts->>'state'=matched_parts->>'state')
      and (parts->>'zip'='' or parts->>'zip'=matched_parts->>'zip') and length(m->>'matchedAddress') between 1 and 600 and (m->>'matchedAddress')!~'[[:cntrl:]<>]'
      and jsonb_typeof(m->'coordinates'->'x')='number' and jsonb_typeof(m->'coordinates'->'y')='number' then
      lat:=(m->'coordinates'->>'y')::double precision;lon:=(m->'coordinates'->>'x')::double precision;
      success:=lat between -90 and 90 and lon between -180 and 180 and not(lat=0 and lon=0);
     end if;
    end if;
   exception when others then v_reason:='invalid_provider_response';success:=false;end;
  end if;
  if success then
   evidence:=jsonb_build_object('automation','us_census_background_v1','sourceSha256',j.source_sha256,'payloadSha256',j.payload_sha256,'addressSha256',j.address_sha256,'requestId',j.request_id,'benchmark','Public_AR_Current','matchCount',1,'matchedAddress',m->>'matchedAddress','publishedPoint',jsonb_build_object('latitude',lat,'longitude',lon),'verifiedGps',false,'liveGps',false,'originalSourcePreserved',true);
   insert into cos_mhelp_placement_private.mhelp_address_resolution(source_sha256,payload_sha256,address_sha256,provider,lookup_address,status,reason,matched_address,latitude,longitude,geocoded_at,evidence,evidence_sha256)
   values(j.source_sha256,j.payload_sha256,j.address_sha256,'us_census_address_range',concat_ws(', ',current_addr.street,current_addr.city,current_addr.state||' '||current_addr.zip),'address_review','Automatically located customer address; approximate address range, not verified GPS.',m->>'matchedAddress',lat,lon,clock_timestamp(),evidence,encode(sha256(convert_to(evidence::text,'UTF8')),'hex'));
  end if;
  update cos_mhelp_placement_private.address_automation_job set status=case when success then 'matched' when v_reason='no_exact_address_match' then 'no_match' else 'provider_error' end,
   reason=case when success then null else v_reason end,completed_at=clock_timestamp(),request_id=null,
   next_attempt_at=clock_timestamp()+case when v_reason='no_exact_address_match' then interval '7 days' else least(interval '6 hours',interval '5 minutes'*power(2,least(j.attempts,7))) end
   where source_sha256=j.source_sha256 and address_sha256=j.address_sha256;
  settled:=settled+1;
 end loop;
 for j in select * from cos_mhelp_placement_private.address_automation_job where source_sha256=active_source and payload_sha256=active_payload and status in ('queued','no_match','invalid_address','provider_error') and next_attempt_at<=clock_timestamp() order by next_attempt_at,address_sha256 limit 8 for update skip locked loop
  select * into current_addr from cos_mhelp_placement_private.census_mhelp_address where source_sha256=j.source_sha256 and address_sha256=j.address_sha256;
  parts:=cos_mhelp_placement_private.address_parts_v1(jsonb_build_object('street',current_addr.street,'city',current_addr.city,'state',current_addr.state,'zip',current_addr.zip));
  if not cos_mhelp_placement_private.address_sendable_v1(parts) then
   update cos_mhelp_placement_private.address_automation_job set status='invalid_address',reason='insufficient_structure_address_automatically_rechecked',next_attempt_at=clock_timestamp()+interval '7 days' where source_sha256=j.source_sha256 and address_sha256=j.address_sha256;
   continue;
  end if;
  update cos_mhelp_placement_private.address_automation_job set request_id=net.http_get(
   url:='https://geocoding.geo.census.gov/geocoder/locations/address',params:=parts||jsonb_build_object('benchmark','Public_AR_Current','format','json'),headers:='{"Accept":"application/json"}'::jsonb,timeout_milliseconds:=10000),status='reserved',attempts=attempts+1,requested_at=clock_timestamp(),reason=null
   where source_sha256=j.source_sha256 and address_sha256=j.address_sha256;
  sent:=sent+1;
 end loop;
 return jsonb_build_object('state','complete','import',sync_result,'sent',sent,'settled',settled);
end$$;
revoke all on function cos_mhelp_placement_private.address_parts_v1(jsonb),cos_mhelp_placement_private.address_street_key_v1(text),cos_mhelp_placement_private.address_sendable_v1(jsonb),cos_mhelp_placement_private.address_automation_sync_v1(),cos_mhelp_placement_private.address_automation_tick_v1() from public,anon,authenticated,service_role;
-- Schedule installed separately after fixture and live preservation checks.
commit;

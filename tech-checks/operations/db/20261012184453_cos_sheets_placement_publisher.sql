-- Fixed-workbook publisher state. No operational/GPS/provider or mHelpDesk writes.
create schema cos_sheets_placement_private;
revoke all on schema cos_sheets_placement_private from public,anon,authenticated,service_role;
create table cos_sheets_placement_private.bindings(
 equipment_id text primary key references cos_mhelp_placement_private.links(equipment_id),
 sheet_id integer not null check(sheet_id in(568394918,2017346590,426115083,386511683,826256700,651684134,451969219,135363149,1975227208,828079282)),
 row_number integer not null check(row_number between 2 and 10000),sheet_label text not null unique,
 baseline_cells jsonb not null,pending_cells jsonb,reviewed_at timestamptz not null default clock_timestamp(),authorization_sha256 text not null check(authorization_sha256~'^[a-f0-9]{64}$'),
 unique(sheet_id,row_number)
);
create table cos_sheets_placement_private.control(
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 lease_id uuid,lease_until timestamptz,last_attempt_at timestamptz,last_success_at timestamptz,error_code text
);
create table cos_sheets_placement_private.receipts(
 id uuid primary key,completed_at timestamptz not null default clock_timestamp(),published integer not null,recovered integer not null,unchanged integer not null,held integer not null
);
alter table cos_sheets_placement_private.bindings enable row level security;
alter table cos_sheets_placement_private.control enable row level security;
alter table cos_sheets_placement_private.receipts enable row level security;
revoke all on all tables in schema cos_sheets_placement_private from public,anon,authenticated,service_role;
insert into cos_sheets_placement_private.control(singleton) values(true);

create function cos_sheets_placement_private.valid_cells(p_cells jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare c jsonb;v text;
begin
 if jsonb_typeof(p_cells)<>'array' or jsonb_array_length(p_cells)<>4 then return false;end if;
 for c in select value from jsonb_array_elements(p_cells) loop
  if jsonb_typeof(c)<>'object' or (c-array['entered','validation','rich'])<>'{}'::jsonb or not(c?'entered' and c?'validation' and c?'rich')
   or jsonb_typeof(c->'entered')<>'object' or ((c->'entered')-'stringValue')<>'{}'::jsonb
   or (c->'entered'?'stringValue' and jsonb_typeof(c->'entered'->'stringValue')<>'string')
   or c->'rich'<>'false'::jsonb or jsonb_typeof(c->'validation') not in('null','object') or length((c->'validation')::text)>4096 then return false;end if;
  v:=c->'entered'->>'stringValue';if length(v)>250 or v~'[[:cntrl:]]' then return false;end if;
 end loop;
 return true;
end $$;
create function cos_sheets_placement_private.admit(p_bindings jsonb,p_authorization_sha256 text) returns integer language plpgsql set search_path='' as $$
declare r jsonb;l cos_mhelp_placement_private.links;n integer:=0;
begin
 if current_user not in('postgres','supabase_admin') then raise exception 'Administrator required' using errcode='42501';end if;
 if jsonb_typeof(p_bindings)<>'array' or jsonb_array_length(p_bindings)>1000 or p_authorization_sha256!~'^[a-f0-9]{64}$' then raise exception 'Invalid publisher review';end if;
 lock table app_private.vision_tracker_locations,public.equipment_units,app_private.cos_geocode_sources,
  public.equipment_unit_location_history,app_private.cos_owner_identity_claims,app_private.cos_archived_representations in share mode nowait;
 for r in select value from jsonb_array_elements(p_bindings) loop
  if (r-array['equipmentId','sheetId','row','label','cells'])<>'{}'::jsonb or not cos_sheets_placement_private.valid_cells(r->'cells')
   or coalesce(r->>'label','')='' or r->>'label' is distinct from r->'cells'->0->'entered'->>'stringValue'
   or coalesce(r->'cells'->1->'entered'->>'stringValue','') not in('FIELD','SHOP') then raise exception 'Invalid publisher binding';end if;
  select * into strict l from cos_mhelp_placement_private.links where equipment_id=r->>'equipmentId';
  if cos_mhelp_placement_private.guard(l.tracker_id,l.native_unit_id) is distinct from l.baseline_guard then raise exception 'Source review changed';end if;
  insert into cos_sheets_placement_private.bindings(equipment_id,sheet_id,row_number,sheet_label,baseline_cells,authorization_sha256)
  values(l.equipment_id,(r->>'sheetId')::integer,(r->>'row')::integer,r->>'label',r->'cells',p_authorization_sha256);n:=n+1;
 end loop;
 return n;
end $$;
create function cos_sheets_placement_private.source_current(p_link cos_mhelp_placement_private.links) returns boolean language sql stable set search_path='' as $$
 select coalesce(p_link.observation->>'state'='confirmed' and p_link.observed_at>clock_timestamp()-interval '20 minutes'
  and cos_mhelp_placement_private.guard(p_link.tracker_id,p_link.native_unit_id)=p_link.baseline_guard
  and exists(select 1 from cos_mhelp_placement_private.control where singleton and enabled and error_code is null and last_success_at>clock_timestamp()-interval '20 minutes'),false)
$$;
create function public.cos_sheets_placement_status() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('contract','COS_SHEETS_PLACEMENT_V1','workbookId','1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA','enabled',enabled,'lastAttemptAt',last_attempt_at,'lastSuccessAt',last_success_at,'errorCode',error_code,
 'bindings',(select count(*) from cos_sheets_placement_private.bindings),'pending',(select count(*) from cos_sheets_placement_private.bindings where pending_cells is not null)) from cos_sheets_placement_private.control where singleton
$$;
create function public.cos_sheets_placement_begin() returns jsonb language plpgsql security definer set search_path='' as $$
declare s cos_sheets_placement_private.control;v uuid;items jsonb;
begin
 select * into strict s from cos_sheets_placement_private.control where singleton for update;
 if not s.enabled or s.lease_until>clock_timestamp() or s.last_attempt_at>clock_timestamp()-interval '30 seconds' then return jsonb_build_object('leaseId',null);end if;
 v:=gen_random_uuid();update cos_sheets_placement_private.control set lease_id=v,lease_until=clock_timestamp()+interval '8 minutes',last_attempt_at=clock_timestamp() where singleton;
 select coalesce(jsonb_agg(jsonb_build_object('equipmentId',b.equipment_id,'sheetId',b.sheet_id,'row',b.row_number,'label',b.sheet_label,'baseline',b.baseline_cells,'pending',b.pending_cells,
  'observation',l.observation,'sourceCurrent',cos_sheets_placement_private.source_current(l)) order by b.equipment_id),'[]') into items
 from cos_sheets_placement_private.bindings b join cos_mhelp_placement_private.links l using(equipment_id);
 return jsonb_build_object('leaseId',v,'bindings',items);
end $$;
create function public.cos_sheets_placement_stage(p_lease_id uuid,p_intents jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s cos_sheets_placement_private.control;r jsonb;b cos_sheets_placement_private.bindings;l cos_mhelp_placement_private.links;i integer;seen text[]:='{}';v text;
begin
 select * into strict s from cos_sheets_placement_private.control where singleton for update;
 if not s.enabled or s.lease_id is distinct from p_lease_id or s.lease_until<=clock_timestamp() or p_lease_id is null then return jsonb_build_object('committed',false);end if;
 if jsonb_typeof(p_intents)<>'array' or jsonb_array_length(p_intents)>60 then raise exception 'Invalid publisher intents';end if;
 for r in select value from jsonb_array_elements(p_intents) loop
  if (r-array['equipmentId','observation','cells'])<>'{}'::jsonb or r->>'equipmentId'=any(seen) or not cos_sheets_placement_private.valid_cells(r->'cells') then raise exception 'Invalid publisher intent';end if;
  seen:=array_append(seen,r->>'equipmentId');select * into strict b from cos_sheets_placement_private.bindings where equipment_id=r->>'equipmentId' for update;
  select * into strict l from cos_mhelp_placement_private.links where equipment_id=b.equipment_id;
  if not cos_sheets_placement_private.source_current(l) or l.observation is distinct from r->'observation' or (b.pending_cells is not null and b.pending_cells is distinct from r->'cells') then raise exception 'Publisher source changed' using errcode='40001';end if;
  if r->'cells'->0 is distinct from b.baseline_cells->0 then raise exception 'Identity cell changed';end if;
  for i in 1..3 loop
   if ((r->'cells'->i)-'entered') is distinct from ((b.baseline_cells->i)-'entered') then raise exception 'Cell metadata changed';end if;
  end loop;
  if r->'cells'->1->'entered'->>'stringValue' is distinct from l.observation->>'placement' then raise exception 'Invalid published placement';end if;
  v:=regexp_replace(lower(btrim(r->'cells'->2->'entered'->>'stringValue')),'\s+',' ','g');
  if v is distinct from regexp_replace(lower(btrim(l.observation->>'customerLabel')),'\s+',' ','g') and not(l.observation->>'placement'='SHOP' and v in('cameras onsite','cameras onsite llc')) then raise exception 'Invalid published customer';end if;
  v:=regexp_replace(lower(btrim(r->'cells'->3->'entered'->>'stringValue')),'\s+',' ','g');
  if v is distinct from regexp_replace(lower(btrim(l.observation->>'siteLabel')),'\s+',' ','g') and not(l.observation->>'placement'='SHOP' and v in('shop','main cos shop','cameras onsite shop')) then raise exception 'Invalid published site';end if;
  update cos_sheets_placement_private.bindings set pending_cells=r->'cells' where equipment_id=b.equipment_id;
 end loop;
 return jsonb_build_object('committed',true);
end $$;
create function public.cos_sheets_placement_finish(p_lease_id uuid,p_results jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s cos_sheets_placement_private.control;r jsonb;b cos_sheets_placement_private.bindings;seen text[]:='{}';p integer:=0;c integer:=0;u integer:=0;h integer:=0;
begin
 select * into strict s from cos_sheets_placement_private.control where singleton for update;
 if not s.enabled or p_lease_id is null or s.lease_id is distinct from p_lease_id or s.lease_until<=clock_timestamp() then return jsonb_build_object('committed',false);end if;
 if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)<>(select count(*) from cos_sheets_placement_private.bindings) then raise exception 'Incomplete publisher results';end if;
 for r in select value from jsonb_array_elements(p_results) loop
  if jsonb_typeof(r)<>'object' or (r-array['equipmentId','state','cells','reason'])<>'{}'::jsonb or r->>'equipmentId'=any(seen) then raise exception 'Invalid publisher result';end if;
  seen:=array_append(seen,r->>'equipmentId');select * into strict b from cos_sheets_placement_private.bindings where equipment_id=r->>'equipmentId' for update;
  if r->>'state' in('published','recovered') then
   if b.pending_cells is null or b.pending_cells is distinct from r->'cells' then raise exception 'Unverified publisher readback';end if;
   update cos_sheets_placement_private.bindings set baseline_cells=pending_cells,pending_cells=null where equipment_id=b.equipment_id;
   if r->>'state'='published' then p:=p+1;else c:=c+1;end if;
  elsif r->>'state'='unchanged' and r->'cells'=b.baseline_cells then u:=u+1;
  elsif r->>'state'='held' and r->>'reason' in('sheet_identity_changed','manual_sheet_change','source_unverified','unsupported_sheet_cell','pending_write_changed','sheet_validation','batch_limit','readback_mismatch') then h:=h+1;
  else raise exception 'Invalid publisher result state';end if;
 end loop;
 insert into cos_sheets_placement_private.receipts(id,published,recovered,unchanged,held) values(p_lease_id,p,c,u,h);
 update cos_sheets_placement_private.control set lease_id=null,lease_until=null,last_success_at=clock_timestamp(),error_code=null where singleton;
 return jsonb_build_object('committed',true,'published',p,'recovered',c,'unchanged',u,'held',h,'sheetsPublisher',true);
end $$;
create function public.cos_sheets_placement_fail(p_lease_id uuid) returns void language sql security definer set search_path='' as $$
 update cos_sheets_placement_private.control set lease_id=null,lease_until=null,error_code='publisher_unavailable' where singleton and lease_id=p_lease_id
$$;
revoke all on all functions in schema cos_sheets_placement_private from public,anon,authenticated,service_role;
revoke all on function public.cos_sheets_placement_status(),public.cos_sheets_placement_begin(),public.cos_sheets_placement_stage(uuid,jsonb),public.cos_sheets_placement_finish(uuid,jsonb),public.cos_sheets_placement_fail(uuid) from public,anon,authenticated;
grant execute on function public.cos_sheets_placement_status(),public.cos_sheets_placement_begin(),public.cos_sheets_placement_stage(uuid,jsonb),public.cos_sheets_placement_finish(uuid,jsonb),public.cos_sheets_placement_fail(uuid) to service_role;

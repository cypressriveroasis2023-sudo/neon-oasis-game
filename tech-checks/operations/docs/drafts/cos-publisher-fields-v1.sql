-- REVIEW ONLY. Install only with publisher disabled, no lease/pending write.
-- No binding is opted in automatically. Admission requires a fresh, explicitly
-- approved exact manifest from two identical full CellData reads. No Sheet writes.
begin;
set local lock_timeout='2s';
do $$begin
 perform 1 from cos_sheets_placement_private.control where singleton for update;
 if exists(select 1 from cos_sheets_placement_private.control where enabled or lease_until>clock_timestamp())
 or exists(select 1 from cos_sheets_placement_private.bindings where pending_cells is not null) then raise exception 'Quiescent disabled publisher required';end if;
end$$;
create table cos_sheets_placement_private.field_bindings(
 equipment_id text primary key references cos_sheets_placement_private.bindings(equipment_id),
 location_guard jsonb not null,baseline jsonb not null,pending jsonb,pending_source jsonb,
 original_note text,authorization_sha256 text not null
);
create unique index field_binding_index_row on cos_sheets_placement_private.field_bindings (((baseline->'index'->>'row')::integer));
create table cos_sheets_placement_private.field_reviews(
 authorization_sha256 text primary key check(authorization_sha256~'^[a-f0-9]{64}$'),manifest jsonb not null,at timestamptz not null default clock_timestamp()
);
create table cos_sheets_placement_private.field_audit(
 id bigint generated always as identity primary key,at timestamptz not null default clock_timestamp(),
 equipment_id text not null,lease_id uuid not null,state text not null,source jsonb not null,cells jsonb not null
);
create table cos_sheets_placement_private.field_function_backup(signature text primary key,definition text not null,installed_definition text);
alter table cos_sheets_placement_private.field_bindings enable row level security;
alter table cos_sheets_placement_private.field_reviews enable row level security;
alter table cos_sheets_placement_private.field_audit enable row level security;
alter table cos_sheets_placement_private.field_function_backup enable row level security;
revoke all on cos_sheets_placement_private.field_bindings,cos_sheets_placement_private.field_reviews,cos_sheets_placement_private.field_audit,cos_sheets_placement_private.field_function_backup from public,anon,authenticated,service_role;

create function cos_sheets_placement_private.field_location(b cos_sheets_placement_private.bindings) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('sheetId',b.sheet_id,'row',b.row_number,'label',b.sheet_label,'authorizationSha256',b.authorization_sha256)
$$;
create function cos_sheets_placement_private.valid_fields(v jsonb,b cos_sheets_placement_private.bindings) returns boolean language plpgsql immutable set search_path='' as $$
declare c jsonb;title text;
begin
 title:=case b.sheet_id when 568394918 then 'SOLAR SPOTTERS' when 2017346590 then 'SPOTTERS' when 426115083 then 'HELIOS' when 386511683 then 'RANGERS' when 826256700 then 'SNIPERS' when 651684134 then 'CAM V & RSU' when 451969219 then 'RECONS' when 135363149 then 'RECON II' when 1975227208 then 'SOLAR STANDS 72' when 828079282 then 'SOLAR POLES & SKIDS' end;
 -- Resolve exact tab names from the existing fixed workbook contract below.
 if v is null or jsonb_typeof(v)<>'object' or not(v ?& array['address','index']) or (v-array['address','index'])<>'{}'
 or jsonb_typeof(v->'index')<>'object' or ((v->'index')-array['row','cells'])<>'{}' or not(v->'index' ?& array['row','cells'])
 or coalesce(v->'index'->>'row','')!~'^[0-9]{1,5}$' or (v->'index'->>'row')::integer not between 2 and 10000
 or jsonb_typeof(v->'index'->'cells')<>'array' or jsonb_array_length(v->'index'->'cells')<>5 then return false;end if;
 if v->'index'->'cells'->0->'entered'->>'stringValue' is distinct from title||'|'||b.sheet_label
 or v->'index'->'cells'->1->'entered'->>'stringValue' is distinct from b.equipment_id
 or coalesce(v->'index'->'cells'->4->'entered'->>'stringValue','')!~'^ServiceItem_List_[0-9]{14}\.csv$' then return false;end if;
 for c in select value from jsonb_array_elements(jsonb_build_array(v->'address')||(v->'index'->'cells')) loop
  if jsonb_typeof(c)<>'object' or not(c ?& array['entered','validation','rich','note']) or (c-array['entered','validation','rich','note'])<>'{}'
  or jsonb_typeof(c->'entered')<>'object' or ((c->'entered')-'stringValue')<>'{}' or (c->'entered'?'stringValue' and jsonb_typeof(c->'entered'->'stringValue')<>'string')
  or c->'rich'<>'false'::jsonb or jsonb_typeof(c->'validation') not in('null','object') or length((c->'validation')::text)>4096
  or jsonb_typeof(c->'note') not in('null','string') or length(c->>'note')>4096
  or length(c->'entered'->>'stringValue')>600 or regexp_replace(c->'entered'->>'stringValue',E'[\t\r\n]','','g')~'[[:cntrl:]]' then return false;end if;
 end loop;
 return true;
exception when others then return false;
end$$;

-- Fail closed if source or guard cannot be proven. These are actual accepted
-- candidate timestamps, never a newly stamped freshness claim.
create function cos_sheets_placement_private.field_source(id text,prefix text default null) returns jsonb language plpgsql stable set search_path='' as $$
declare l cos_mhelp_placement_private.links;s cos_mhelp_placement_private.live_inventory_candidates;r jsonb;address text;note text;observed timestamptz;
begin
 select * into strict l from cos_mhelp_placement_private.links where equipment_id=id;
 if not cos_sheets_placement_private.source_current(l) or l.observed_at>clock_timestamp()+interval '1 minute' or exists(select 1 from cos_operational_private.current_placements where product_id=id) then return null;end if;
 select c.* into strict s from cos_mhelp_placement_private.live_inventory_candidates c
 join cos_mhelp_placement_private.live_inventory_control ctl on ctl.active_source_sha256=c.source_sha256
 join cos_mhelp_placement_private.upload_control u on u.active_sha256=c.source_sha256
 where ctl.singleton and u.singleton and ctl.enabled and ctl.error_code is null and ctl.last_success_at between clock_timestamp()-interval '20 minutes' and clock_timestamp()+interval '1 minute';
 if s.receipt->>'contract' is distinct from 'COS_MHELP_API_V1' or s.receipt->>'origin' is distinct from 'mhelpdesk_api' or s.receipt->>'portalId' is distinct from '224643'
 or s.receipt->'complete' is distinct from 'true'::jsonb or s.receipt->'reviewed' is distinct from 'true'::jsonb or s.receipt->>'sourceSha256' is distinct from s.source_sha256
 or s.payload_sha256 is distinct from encode(sha256(convert_to(jsonb_build_object('receipt',s.receipt,'records',s.records)::text,'UTF8')),'hex') then return null;end if;
 select x into strict r from jsonb_array_elements(s.records) x where x->>'productId'=id;
 if r->>'lifecycle' is distinct from 'UNFLAGGED' or nullif(r->>'holdReason','') is not null
 or r->'apiAssignment'->>'customerId' is distinct from l.observation->>'customerId'
 or r->'apiAssignment'->>'serviceLocationId' is distinct from l.observation->>'serviceLocationId'
 or r->>'placement' is distinct from l.observation->>'placement' or r->>'unitNumber' is distinct from l.full_label then return null;end if;
 observed:=(r->'sourceDates'->>'apiCustomerObservedAt')::timestamptz;
 if observed is null or observed not between clock_timestamp()-interval '20 minutes' and clock_timestamp()+interval '1 minute' then return null;end if;
 address:=null;
 if nullif(btrim(r->'sourceAddress'->>'street'),'') is not null and nullif(r->>'addressReview','') is null and r->'apiAssignment'->'placementProof'->'serviceVerified'='true'::jsonb then
  observed:=(r->'sourceDates'->>'apiAddressObservedAt')::timestamptz;
  if observed is null or observed not between clock_timestamp()-interval '20 minutes' and clock_timestamp()+interval '1 minute' then return null;end if;
  address:=concat_ws(', ',nullif(btrim(r->'sourceAddress'->>'street'),''),nullif(btrim(r->'sourceAddress'->>'city'),''),nullif(btrim(concat_ws(' ',nullif(btrim(r->'sourceAddress'->>'state'),''),nullif(btrim(r->'sourceAddress'->>'zip'),''))),''));
  address:=regexp_replace(address,'[[:space:]]+',' ','g');
 end if;
 if coalesce(r->>'unitNumber','')='' or coalesce(r->>'customer','')='' or length(r->>'unitNumber')>600 or length(r->>'customer')>600 or length(address)>600
 or (r->>'unitNumber')~'[[:cntrl:]]' or (r->>'customer')~'[[:cntrl:]]' or address~'[[:cntrl:]]' then return null;end if;
 note:=coalesce(nullif(prefix,'')||E'\n\n','')||E'COS current mHelp API snapshot\nProduct ID: '||id||E'\nSource SHA256: '||s.source_sha256||E'\nPayload SHA256: '||s.payload_sha256||E'\nAccepted snapshot: '||(s.receipt->>'receivedAt')||E'\nAddress: '||case when address is null then 'unknown (not cleared)' else 'verified service location' end;
 if note is null or length(note)>4096 then return null;end if;
 return jsonb_build_object('contract','COS_PUBLISHER_FIELDS_V1','equipmentId',id,'sourceSha256',s.source_sha256,'payloadSha256',s.payload_sha256,'equipmentName',r->>'unitNumber','customerSite',r->>'customer','address',address,'provenanceNote',note);
exception when no_data_found or too_many_rows or invalid_datetime_format or datetime_field_overflow then return null;
end$$;

create function cos_sheets_placement_private.field_envelope(id text) returns jsonb language plpgsql stable set search_path='' as $$
declare f cos_sheets_placement_private.field_bindings;b cos_sheets_placement_private.bindings;
begin
 select * into f from cos_sheets_placement_private.field_bindings where equipment_id=id;if not found then return null;end if;
 select * into strict b from cos_sheets_placement_private.bindings where equipment_id=id;
 return jsonb_build_object('contract',case when f.location_guard=cos_sheets_placement_private.field_location(b) then 'COS_PUBLISHER_FIELDS_V1' else 'COS_PUBLISHER_FIELDS_HELD' end,'baseline',f.baseline,'pending',f.pending,'source',case when f.location_guard=cos_sheets_placement_private.field_location(b) then cos_sheets_placement_private.field_source(id,f.original_note) else null end);
end$$;

create function cos_sheets_placement_private.admit_fields(manifest jsonb,p_authorization text) returns integer language plpgsql set search_path='' as $$
declare r jsonb;b cos_sheets_placement_private.bindings;seen text[]:='{}';s jsonb;f jsonb;
begin
 if current_user not in('postgres','supabase_admin') then raise exception 'Administrator required' using errcode='42501';end if;
 perform 1 from cos_sheets_placement_private.control where singleton for update;
 if exists(select 1 from cos_sheets_placement_private.control where enabled or lease_until>clock_timestamp()) or exists(select 1 from cos_sheets_placement_private.bindings where pending_cells is not null)
 or exists(select 1 from cos_sheets_placement_private.field_bindings where pending is not null) then raise exception 'Quiescent disabled publisher required';end if;
 if p_authorization is null or p_authorization!~'^[a-f0-9]{64}$' or manifest->>'contract' is distinct from 'COS_PUBLISHER_FIELDS_REVIEW_V1'
 or (manifest-array['contract','readAt','sourceSha256','items'])<>'{}' or jsonb_typeof(manifest->'items') is distinct from 'array' or jsonb_array_length(manifest->'items') not between 1 and 434
 or (manifest->>'readAt')::timestamptz not between clock_timestamp()-interval '2 minutes' and clock_timestamp() or manifest->>'readAt' is null then raise exception 'Fresh exact field manifest required';end if;
 lock table cos_sheets_placement_private.bindings,cos_mhelp_placement_private.links,cos_mhelp_placement_private.live_inventory_control,cos_mhelp_placement_private.upload_control,cos_mhelp_placement_private.live_inventory_candidates,
 app_private.vision_tracker_locations,public.equipment_units,app_private.cos_geocode_sources,public.equipment_unit_location_history,app_private.cos_owner_identity_claims,app_private.cos_archived_representations,cos_operational_private.current_placements in share mode;
 insert into cos_sheets_placement_private.field_reviews(authorization_sha256,manifest) values(p_authorization,manifest);
 for r in select value from jsonb_array_elements(manifest->'items') loop
  if r->>'equipmentId'=any(seen) or (r-array['equipmentId','location','legacyBaseline','fields','source'])<>'{}' then raise exception 'Invalid field review';end if;seen:=array_append(seen,r->>'equipmentId');
  select * into strict b from cos_sheets_placement_private.bindings where equipment_id=r->>'equipmentId';f:=r->'fields';
  if r->'location' is distinct from cos_sheets_placement_private.field_location(b) or r->'legacyBaseline' is distinct from b.baseline_cells or not cos_sheets_placement_private.valid_fields(f,b) then raise exception 'Field review changed';end if;
  -- A repair/review may move a binding, but never silently absorb a new human note.
  if exists(select 1 from cos_sheets_placement_private.field_bindings old where old.equipment_id=b.equipment_id and old.baseline->'index'->'cells'->4->'note' is distinct from f->'index'->'cells'->4->'note') then raise exception 'Reviewed provenance note changed';end if;
  -- Existing opt-ins may be re-reviewed only explicitly, retaining the original note.
  s:=cos_sheets_placement_private.field_source(b.equipment_id,case when exists(select 1 from cos_sheets_placement_private.field_bindings where equipment_id=b.equipment_id) then (select original_note from cos_sheets_placement_private.field_bindings where equipment_id=b.equipment_id) else f->'index'->'cells'->4->>'note' end);
  if s is null or s is distinct from r->'source' or s->>'sourceSha256' is distinct from manifest->>'sourceSha256' then raise exception 'Field source changed' using errcode='40001';end if;
  insert into cos_sheets_placement_private.field_bindings(equipment_id,location_guard,baseline,original_note,authorization_sha256)
  values(b.equipment_id,r->'location',f,f->'index'->'cells'->4->>'note',p_authorization)
  on conflict(equipment_id) do update set location_guard=excluded.location_guard,baseline=excluded.baseline,authorization_sha256=excluded.authorization_sha256;
 end loop;return cardinality(seen);
end$$;

create function cos_sheets_placement_private.stage_fields(id text,v jsonb,lease uuid) returns void language plpgsql set search_path='' as $$
declare f cos_sheets_placement_private.field_bindings;b cos_sheets_placement_private.bindings;s jsonb;c jsonb;old jsonb;wanted text;i integer;proposed jsonb;
begin
 select * into f from cos_sheets_placement_private.field_bindings where equipment_id=id for update;
 if not found then if v is not null then raise exception 'Fields not admitted';end if;return;end if;
 lock table cos_mhelp_placement_private.links,cos_mhelp_placement_private.live_inventory_control,cos_mhelp_placement_private.upload_control,cos_mhelp_placement_private.live_inventory_candidates,
 app_private.vision_tracker_locations,public.equipment_units,app_private.cos_geocode_sources,public.equipment_unit_location_history,app_private.cos_owner_identity_claims,app_private.cos_archived_representations,cos_operational_private.current_placements in share mode;
 select * into strict b from cos_sheets_placement_private.bindings where equipment_id=id;s:=cos_sheets_placement_private.field_source(id,f.original_note);proposed:=v->'cells';
 if v is null or (v-array['source','cells'])<>'{}' or s is null or v->'source' is distinct from s or f.location_guard is distinct from cos_sheets_placement_private.field_location(b)
 or not cos_sheets_placement_private.valid_fields(proposed,b) or (f.pending is not null and (f.pending is distinct from proposed or f.pending_source is distinct from s)) then raise exception 'Field source or pending changed' using errcode='40001';end if;
 if proposed->'index'->'row' is distinct from f.baseline->'index'->'row' or proposed->'index'->'cells'->0 is distinct from f.baseline->'index'->'cells'->0
 or proposed->'index'->'cells'->1 is distinct from f.baseline->'index'->'cells'->1
 or ((proposed->'index'->'cells'->4)-'note') is distinct from ((f.baseline->'index'->'cells'->4)-'note') or proposed->'index'->'cells'->4->>'note' is distinct from s->>'provenanceNote' then raise exception 'Protected index cell changed';end if;
 for i in 0..2 loop
  old:=case when i=0 then f.baseline->'address' else f.baseline->'index'->'cells'->(i+1) end;
  c:=case when i=0 then proposed->'address' else proposed->'index'->'cells'->(i+1) end;
  wanted:=case i when 0 then s->>'address' when 1 then s->>'equipmentName' else s->>'customerSite' end;
  if wanted is null then
   if coalesce(old->'entered'->>'stringValue','')<>'' or c is distinct from old then raise exception 'Unknown address is not erase authority';end if;
  else
   if (c-'entered') is distinct from (old-'entered') or coalesce(c->'entered'->>'stringValue','') is distinct from wanted then raise exception 'Field values changed';end if;
   if c is distinct from old and old->'validation'<>'null'::jsonb and (old->'validation'->'condition'->>'type' is distinct from 'ONE_OF_LIST' or not exists(select 1 from jsonb_array_elements(old->'validation'->'condition'->'values') x where x->>'userEnteredValue'=wanted)) then raise exception 'Field validation changed';end if;
  end if;
 end loop;
 update cos_sheets_placement_private.field_bindings set pending=proposed,pending_source=s where equipment_id=id;
 insert into cos_sheets_placement_private.field_audit(equipment_id,lease_id,state,source,cells) values(id,lease,'staged',s,proposed);
end$$;
create function cos_sheets_placement_private.finish_fields(id text,r jsonb,lease uuid) returns void language plpgsql set search_path='' as $$
declare f cos_sheets_placement_private.field_bindings;b cos_sheets_placement_private.bindings;
begin
 select * into f from cos_sheets_placement_private.field_bindings where equipment_id=id for update;
 if not found then if r?'fields' then raise exception 'Fields not admitted';end if;return;end if;
 if r->>'state' in('published','recovered') then
  select * into strict b from cos_sheets_placement_private.bindings where equipment_id=id;
  if f.location_guard is distinct from cos_sheets_placement_private.field_location(b) then raise exception 'Field binding changed';end if;
  if f.pending is null or f.pending is distinct from r->'fields' then raise exception 'Unverified field readback';end if;
  insert into cos_sheets_placement_private.field_audit(equipment_id,lease_id,state,source,cells) values(id,lease,r->>'state',f.pending_source,f.pending);
  update cos_sheets_placement_private.field_bindings set baseline=pending,pending=null,pending_source=null where equipment_id=id;
 elsif r->>'state'='unchanged' and r->'fields' is distinct from f.baseline then raise exception 'Unverified unchanged fields';end if;
end$$;

-- Surgical replacements preserve the installed customer-style, operational
-- override, evidence-refresh and receipt logic, plus existing RPC ACLs.
do $$declare sig text;def text;old text;new text;n integer;i integer;olds text[];news text[];begin
 foreach sig in array array['public.cos_sheets_placement_begin()','public.cos_sheets_placement_stage(uuid,jsonb)','public.cos_sheets_placement_finish(uuid,jsonb)'] loop
  def:=pg_get_functiondef(sig::regprocedure);insert into cos_sheets_placement_private.field_function_backup values(sig,def,null);
  if sig like '%begin%' then olds:=array['''pending'',b.pending_cells,'];news:=array['''pending'',b.pending_cells,''fields'',cos_sheets_placement_private.field_envelope(b.equipment_id),'];
  elsif sig like '%stage%' then olds:=array['array[''equipmentId'',''observation'',''cells'']','  if r->''cells''->0 is distinct from b.baseline_cells->0'];news:=array['array[''equipmentId'',''observation'',''cells'',''fields'']','  perform cos_sheets_placement_private.stage_fields(b.equipment_id,r->''fields'',p_lease_id);'||E'\n'||'  if r->''cells''->0 is distinct from b.baseline_cells->0'];
  else olds:=array['array[''equipmentId'',''state'',''cells'',''reason'']','  if r->>''state'' in(''published'',''recovered'') then'];news:=array['array[''equipmentId'',''state'',''cells'',''reason'',''fields'']','  perform cos_sheets_placement_private.finish_fields(b.equipment_id,r,p_lease_id);'||E'\n'||'  if r->>''state'' in(''published'',''recovered'') then'];end if;
  for i in 1..cardinality(olds) loop old:=olds[i];new:=news[i];n:=(length(def)-length(replace(def,old,'')))/length(old);if n<>1 then raise exception 'Installed publisher definition drift: %',sig;end if;def:=replace(def,old,new);end loop;
  execute def;update cos_sheets_placement_private.field_function_backup set installed_definition=pg_get_functiondef(sig::regprocedure) where signature=sig;
 end loop;
end$$;
revoke all on all functions in schema cos_sheets_placement_private from public,anon,authenticated,service_role;
commit;

-- Install only after review. This defines mechanisms; it never rebinds a row.
begin;
alter table cos_sheets_placement_private.bindings add column customer_style text not null default 'plain' check(customer_style in('plain','combined'));
create function cos_sheets_placement_private.customer_value(cells jsonb,o jsonb,style text) returns text language plpgsql immutable set search_path='' as $$
declare old_customer text:=cells->2->'entered'->>'stringValue';old_site text:=cells->3->'entered'->>'stringValue';n text;s text;desired text;
begin
 n:=regexp_replace(lower(btrim(coalesce(old_customer,''))),'\s+',' ','g');s:=regexp_replace(lower(btrim(coalesce(old_site,''))),'\s+',' ','g');
 desired:=o->>'customerLabel';
 if o->>'placement'='FIELD' and style='combined' then desired:=desired||': '||(o->>'siteLabel');end if;
 if n=regexp_replace(lower(btrim(desired)),'\s+',' ','g') or (o->>'placement'='SHOP' and n in('cameras onsite','cameras onsite llc')) then return old_customer;end if;
 return desired;
end $$;
do $patch$
declare original text;anchor text;next text;
begin
 original:=pg_get_functiondef('public.cos_sheets_placement_begin()'::regprocedure);
 anchor:='''baseline'',b.baseline_cells,''pending'',b.pending_cells';
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'Publisher begin changed';end if;
 execute replace(original,anchor,anchor||',''customerStyle'',b.customer_style');
 original:=pg_get_functiondef('public.cos_sheets_placement_stage(uuid,jsonb)'::regprocedure);
 anchor:=$a$regexp_replace(lower(btrim(l.observation->>'customerLabel')),'\s+',' ','g')$a$;
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'Publisher customer guard changed';end if;
 next:=replace(original,anchor,$a$regexp_replace(lower(btrim(cos_sheets_placement_private.customer_value(b.baseline_cells,l.observation,b.customer_style))),'\s+',' ','g')$a$);
 execute next;
end $patch$;
create table cos_sheets_placement_private.binding_reviews(
 authorization_sha256 text primary key check(authorization_sha256~'^[a-f0-9]{64}$'),
 reviewed_at timestamptz not null default clock_timestamp(),source_sha256 text not null,
 sheet_read_at timestamptz not null,changes jsonb not null
);
alter table cos_sheets_placement_private.binding_reviews enable row level security;
revoke all on cos_sheets_placement_private.binding_reviews from public,anon,authenticated,service_role;
-- Admin-only, atomic and one-use. No Google write or source/native mutation.
-- Caller must independently verify two identical live Sheet reads and obtain
-- explicit approval of this exact manifest before invoking this function.
create function cos_sheets_placement_private.repair_bindings(p_changes jsonb,p_source_sha256 text,p_sheet_read_at timestamptz,p_authorization_sha256 text) returns integer language plpgsql set search_path='' as $$
declare r jsonb;b cos_sheets_placement_private.bindings;l cos_mhelp_placement_private.links;s cos_sheets_placement_private.control;candidate jsonb;seen text[]:='{}';done text[]:='{}';progress boolean;n integer;style text;
begin
 if current_user not in('postgres','supabase_admin') then raise exception 'Administrator required' using errcode='42501';end if;
 if p_authorization_sha256 is null or p_authorization_sha256!~'^[a-f0-9]{64}$' or p_source_sha256 is null or p_source_sha256!~'^[a-f0-9]{64}$'
 or p_sheet_read_at is null or p_sheet_read_at>clock_timestamp() or p_sheet_read_at<clock_timestamp()-interval '2 minutes'
 or jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) not between 1 and 434 then raise exception 'Invalid or expired binding review';end if;
 select * into strict s from cos_sheets_placement_private.control where singleton for update nowait;
 if s.lease_until>clock_timestamp() or exists(select 1 from cos_sheets_placement_private.bindings where pending_cells is not null) then raise exception 'Publisher is busy or pending';end if;
 lock table cos_sheets_placement_private.bindings in exclusive mode nowait;
 lock table cos_mhelp_placement_private.live_inventory_candidates in share mode nowait;
 lock table app_private.vision_tracker_locations,public.equipment_units,app_private.cos_geocode_sources,public.equipment_unit_location_history,app_private.cos_owner_identity_claims,app_private.cos_archived_representations,cos_operational_private.current_placements in share mode nowait;
 perform 1 from cos_mhelp_placement_private.live_inventory_control where singleton and enabled and error_code is null and active_source_sha256=p_source_sha256 for share nowait;
 if not found then raise exception 'Inventory review changed';end if;
 for r in select value from jsonb_array_elements(p_changes) loop
  if jsonb_typeof(r) is distinct from 'object' or (r-array['equipmentId','before','after','observation'])<>'{}'::jsonb or not(r?'equipmentId' and r?'before' and r?'after' and r?'observation') or r->>'equipmentId'=any(seen) then raise exception 'Invalid binding review item';end if;
  seen:=array_append(seen,r->>'equipmentId');select * into strict b from cos_sheets_placement_private.bindings where equipment_id=r->>'equipmentId' for update;
  if r->'before' is distinct from jsonb_build_object('sheetId',b.sheet_id,'row',b.row_number,'label',b.sheet_label,'cells',b.baseline_cells,'customerStyle',b.customer_style) then raise exception 'Reviewed binding changed';end if;
  if jsonb_typeof(r->'after') is distinct from 'object' or ((r->'after')-array['sheetId','row','label','cells','customerStyle'])<>'{}'::jsonb or not((r->'after')?'sheetId' and (r->'after')?'row' and (r->'after')?'label' and (r->'after')?'cells' and (r->'after')?'customerStyle')
   or not cos_sheets_placement_private.valid_cells(r->'after'->'cells') or r->'after'->>'label' is distinct from r->'after'->'cells'->0->'entered'->>'stringValue' or coalesce(r->'after'->>'label','')='' then raise exception 'Invalid target binding';end if;
  if exists(select 1 from generate_series(0,3) i where ((r->'after'->'cells'->i)-'entered') is distinct from ((b.baseline_cells->i)-'entered')) then raise exception 'Target metadata changed';end if;
  select * into strict l from cos_mhelp_placement_private.links where equipment_id=b.equipment_id for share;
  if not cos_sheets_placement_private.source_current(l) or l.observation is distinct from r->'observation' or exists(select 1 from cos_operational_private.current_placements where product_id=b.equipment_id) then raise exception 'Source or native review changed';end if;
  select x into strict candidate from cos_mhelp_placement_private.live_inventory_candidates c cross join lateral jsonb_array_elements(c.records) x where c.source_sha256=p_source_sha256 and x->>'productId'=b.equipment_id;
  if coalesce(candidate->>'holdReason','')<>'' then raise exception 'Source review is held';end if;
  if r->'after'->'cells'->1->'entered'->>'stringValue' is distinct from l.observation->>'placement' then raise exception 'Target placement differs from source';end if;
  style:=r->'after'->>'customerStyle';
  if style not in('plain','combined') or (b.customer_style='combined' and style<>'combined') then raise exception 'Customer style cannot be discarded';end if;
  if cos_sheets_placement_private.customer_value(r->'after'->'cells',l.observation,style) is distinct from r->'after'->'cells'->2->'entered'->>'stringValue' then raise exception 'Target customer differs from source';end if;
  if regexp_replace(lower(btrim(r->'after'->'cells'->3->'entered'->>'stringValue')),'\s+',' ','g') is distinct from regexp_replace(lower(btrim(l.observation->>'siteLabel')),'\s+',' ','g') and not(l.observation->>'placement'='SHOP' and lower(btrim(r->'after'->'cells'->3->'entered'->>'stringValue')) in('shop','main cos shop','cameras onsite shop')) then raise exception 'Target site differs from source';end if;
 end loop;
 insert into cos_sheets_placement_private.binding_reviews(authorization_sha256,source_sha256,sheet_read_at,changes) values(p_authorization_sha256,p_source_sha256,p_sheet_read_at,p_changes);
 -- Move only into vacant positions. Retained occupants and cycles abort the
 -- whole transaction; never delete/reinsert or use temporary fake identities.
 while cardinality(done)<cardinality(seen) loop
  progress:=false;
  for r in select value from jsonb_array_elements(p_changes) where not(value->>'equipmentId'=any(done)) loop
   if exists(select 1 from cos_sheets_placement_private.bindings other where other.equipment_id<>r->>'equipmentId' and ((other.sheet_id=(r->'after'->>'sheetId')::integer and other.row_number=(r->'after'->>'row')::integer) or other.sheet_label=r->'after'->>'label')) then continue;end if;
   update cos_sheets_placement_private.bindings set sheet_id=(r->'after'->>'sheetId')::integer,row_number=(r->'after'->>'row')::integer,sheet_label=r->'after'->>'label',baseline_cells=r->'after'->'cells',customer_style=r->'after'->>'customerStyle',authorization_sha256=p_authorization_sha256,reviewed_at=clock_timestamp() where equipment_id=r->>'equipmentId';
   done:=array_append(done,r->>'equipmentId');progress:=true;
  end loop;
  if not progress then raise exception 'Destination remains occupied or cyclic';end if;
 end loop;
 return cardinality(done);
end $$;
revoke all on function cos_sheets_placement_private.customer_value(jsonb,jsonb,text),cos_sheets_placement_private.repair_bindings(jsonb,text,timestamptz,text) from public,anon,authenticated,service_role;
commit;

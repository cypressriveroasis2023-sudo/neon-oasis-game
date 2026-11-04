-- Remap publisher bindings through the exact Product ID → tracker row index.
-- This changes only COS's internal row pointers and publisher baselines. It does
-- not write to Google Sheets, alter tracker IPs, or change equipment records.
begin;

alter table cos_sheets_placement_private.bindings
  drop constraint bindings_sheet_id_row_number_key,
  drop constraint bindings_sheet_label_key;
alter table cos_sheets_placement_private.bindings
  add constraint bindings_sheet_id_row_number_key
    unique (sheet_id, row_number) deferrable initially immediate,
  add constraint bindings_sheet_label_key
    unique (sheet_label) deferrable initially immediate;

create function cos_sheets_placement_private.remap_tracker_index_rows(
  p_changes jsonb,
  p_source_sha256 text,
  p_sheet_read_at timestamptz,
  p_sheet_read_sha256 text,
  p_authorization_sha256 text
) returns integer language plpgsql set search_path = '' as $$
declare
  r jsonb;
  b cos_sheets_placement_private.bindings;
  candidate jsonb;
  seen text[] := '{}';
  target_positions text[] := '{}';
  target_labels text[] := '{}';
  pos text;
  target_tab text;
  n integer;
  applied integer := 0;
begin
  if current_user not in ('postgres','supabase_admin') then
    raise exception 'Administrator required' using errcode='42501';
  end if;
  if p_source_sha256 is null or p_source_sha256 !~ '^[a-f0-9]{64}$'
     or p_sheet_read_sha256 is null or p_sheet_read_sha256 !~ '^[a-f0-9]{64}$'
     or p_authorization_sha256 is null or p_authorization_sha256 !~ '^[a-f0-9]{64}$'
     or p_sheet_read_at is null or p_sheet_read_at > clock_timestamp()
     or p_sheet_read_at < clock_timestamp() - interval '2 minutes'
     or jsonb_typeof(p_changes) is distinct from 'array'
     or jsonb_array_length(p_changes) not between 1 and 434 then
    raise exception 'Invalid or expired tracker-index remap';
  end if;

  perform 1 from cos_sheets_placement_private.control
   where singleton for update nowait;
  if not found then raise exception 'Publisher control unavailable'; end if;
  if exists (select 1 from cos_sheets_placement_private.control
              where singleton and (lease_until > clock_timestamp()
                or exists (select 1 from cos_sheets_placement_private.bindings
                           where pending_cells is not null))) then
    raise exception 'Publisher is busy or has pending writes';
  end if;
  lock table cos_sheets_placement_private.bindings in exclusive mode nowait;
  lock table cos_mhelp_placement_private.live_inventory_candidates in share mode nowait;
  lock table cos_operational_private.current_placements in share mode nowait;
  perform 1 from cos_mhelp_placement_private.live_inventory_control
   where singleton and enabled and error_code is null
     and active_source_sha256 = p_source_sha256
     and last_success_at > clock_timestamp() - interval '20 minutes'
   for share nowait;
  if not found then raise exception 'Complete mHelp source changed or is stale'; end if;

  for r in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(r) is distinct from 'object'
       or (r - array['equipmentId','before','after']) <> '{}'::jsonb
       or not (r ? 'equipmentId' and r ? 'before' and r ? 'after')
       or coalesce(r->>'equipmentId','') = any(seen) then
      raise exception 'Invalid remap item';
    end if;
    seen := array_append(seen, r->>'equipmentId');
    select * into strict b from cos_sheets_placement_private.bindings
      where equipment_id = r->>'equipmentId' for update;
    if r->'before' is distinct from jsonb_build_object(
        'sheetId',b.sheet_id,'row',b.row_number,'label',b.sheet_label,
        'cells',b.baseline_cells,'customerStyle',b.customer_style) then
      raise exception 'Binding changed during review';
    end if;
    if jsonb_typeof(r->'after') is distinct from 'object'
       or ((r->'after') - array['sheetId','row','label','cells','customerStyle','indexKey']) <> '{}'::jsonb
       or not ((r->'after') ? 'sheetId' and (r->'after') ? 'row'
         and (r->'after') ? 'label' and (r->'after') ? 'cells'
         and (r->'after') ? 'customerStyle' and (r->'after') ? 'indexKey')
       or (r->'after'->>'sheetId')::integer <> b.sheet_id
       or (r->'after'->>'row')::integer < 2
       or not cos_sheets_placement_private.valid_cells(r->'after'->'cells')
       or r->'after'->>'label' is distinct from
          r->'after'->'cells'->0->'entered'->>'stringValue'
       or r->'after'->>'customerStyle' not in ('plain','combined') then
      raise exception 'Invalid target row evidence';
    end if;
    target_tab := case b.sheet_id
      when 386511683 then 'RANGERS'
      when 568394918 then 'SOLAR SPOTTERS'
      when 826256700 then 'SNIPERS'
      when 2017346590 then 'SPOTTERS'
      else null end;
    if target_tab is null
       or split_part(r->'after'->>'indexKey','|',1) <> target_tab
       or regexp_replace(lower(split_part(r->'after'->>'indexKey','|',2)),'[^a-z0-9]','','g')
          is distinct from regexp_replace(lower(r->'after'->>'label'),'[^a-z0-9]','','g') then
      raise exception 'Target does not match exact Product ID tracker index';
    end if;
    select x into strict candidate
      from cos_mhelp_placement_private.live_inventory_candidates c
      cross join lateral jsonb_array_elements(c.records) x
     where c.source_sha256 = p_source_sha256
       and x->>'productId' = r->>'equipmentId'
       and x->>'lifecycle' = 'UNFLAGGED';
    pos := (r->'after'->>'sheetId') || ':' || (r->'after'->>'row');
    if pos = any(target_positions)
       or (r->'after'->>'label') = any(target_labels) then
      raise exception 'Duplicate target row or label';
    end if;
    target_positions := array_append(target_positions,pos);
    target_labels := array_append(target_labels,r->'after'->>'label');
  end loop;

  if exists (
    select 1 from cos_sheets_placement_private.bindings other
    cross join jsonb_array_elements(p_changes) change
    where not (other.equipment_id = any(seen))
      and ((other.sheet_id = (change->'after'->>'sheetId')::integer
            and other.row_number = (change->'after'->>'row')::integer)
        or other.sheet_label = change->'after'->>'label')
  ) then raise exception 'Target is occupied by a binding outside this remap'; end if;

  insert into cos_sheets_placement_private.binding_reviews(
    authorization_sha256,source_sha256,sheet_read_at,changes)
  values (p_authorization_sha256,p_source_sha256,p_sheet_read_at,p_changes);

  set constraints bindings_sheet_id_row_number_key, bindings_sheet_label_key deferred;
  for r in select value from jsonb_array_elements(p_changes) loop
    update cos_sheets_placement_private.bindings set
      sheet_id = (r->'after'->>'sheetId')::integer,
      row_number = (r->'after'->>'row')::integer,
      sheet_label = r->'after'->>'label',
      baseline_cells = r->'after'->'cells',
      customer_style = r->'after'->>'customerStyle',
      authorization_sha256 = p_authorization_sha256,
      reviewed_at = clock_timestamp()
    where equipment_id = r->>'equipmentId';
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'Unexpected per-row remap count'; end if;
    applied := applied + n;
  end loop;
  if applied <> jsonb_array_length(p_changes) then raise exception 'Unexpected final remap count'; end if;
  return applied;
end $$;

revoke all on function cos_sheets_placement_private.remap_tracker_index_rows(jsonb,text,timestamptz,text,text)
  from public,anon,authenticated,service_role;
commit;

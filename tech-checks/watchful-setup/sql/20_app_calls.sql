
-- ================================================================ photos (private bucket)
-- Photos go to the private bucket 'techcheck-watchful-setup' at <user id>/<check id>/<sha256>.jpg.
-- The phone re-draws every photo on a canvas before upload (transfers/client.js transferJpeg), which
-- drops EXIF and GPS. They are read only through short signed URLs by signed-in Tech Check users.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('techcheck-watchful-setup', 'techcheck-watchful-setup', false, 15728640, array['image/jpeg'])
on conflict (id) do nothing;

create or replace function app_private.ws_file_ok(p_name text, p_writing boolean) returns boolean
language plpgsql stable security definer set search_path = app_private, public, pg_temp as $$
declare r text := app_private.ws_my_role(); chk uuid; st app_private.ws_install_status;
begin
  if r is null or p_name is null then return false; end if;
  begin chk := split_part(p_name, '/', 2)::uuid; exception when others then return false; end;
  select status into st from app_private.ws_installs where id = chk;
  if st is null then return false; end if;
  if p_writing then
    return split_part(p_name, '/', 1) = auth.uid()::text and p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}\.jpg$'
       and st not in ('live','cancelled');
  end if;
  -- reading: hidden photos only for the owner
  return not exists (select 1 from app_private.ws_evidence e where e.storage_path = p_name and e.hidden) or r = 'owner';
end $$;

drop policy if exists ws_photos_insert_v1 on storage.objects;
create policy ws_photos_insert_v1 on storage.objects for insert to authenticated
  with check (bucket_id = 'techcheck-watchful-setup' and app_private.ws_file_ok(name, true));
drop policy if exists ws_photos_read_v1 on storage.objects;
create policy ws_photos_read_v1 on storage.objects for select to authenticated
  using (bucket_id = 'techcheck-watchful-setup' and app_private.ws_file_ok(name, false));

-- register an uploaded photo; the file must really be in the bucket under the caller's own folder
create or replace function app_private.ws_photo(p_check uuid, p_path text, p_kind text,
  p_item uuid default null, p_attempt uuid default null) returns uuid
language plpgsql security definer set search_path = app_private, public, pg_temp as $$
declare me uuid := auth.uid(); sz bigint; existing uuid;
begin
  if p_path is null then return null; end if;
  if split_part(p_path, '/', 1) <> me::text or split_part(p_path, '/', 2) <> p_check::text
     or p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}\.jpg$' then
    raise exception 'That photo did not upload. Take it again.';
  end if;
  select coalesce((o.metadata->>'size')::bigint, 1) into sz from storage.objects o
   where o.bucket_id = 'techcheck-watchful-setup' and o.name = p_path;
  if sz is null then raise exception 'That photo did not finish uploading. Check your signal and tap again.'; end if;
  select id into existing from app_private.ws_evidence where storage_path = p_path and install_id = p_check
     and install_item_id is not distinct from p_item and kind = p_kind;
  if existing is not null then return existing; end if;
  return app_private.ws_add_evidence(p_check, p_kind, p_path, 'image/jpeg', greatest(sz, 1)::int, true, now(), p_item, p_attempt);
end $$;

-- ================================================================ JSON the screens read
create or replace function app_private.ws_me_json() returns jsonb
language sql security definer set search_path = app_private, public, pg_temp as $$
  select jsonb_build_object('id', auth.uid(), 'name', app_private.ws_my_name(), 'role', app_private.ws_my_role(),
    'canTech', app_private.ws_my_role() in ('service','it','owner'),
    'canOffice', app_private.ws_my_role() in ('it','owner'),
    'isOwner', app_private.ws_my_role() = 'owner')
$$;

create or replace function app_private.ws_status_text(s app_private.ws_install_status) returns text
language sql immutable as $$
  select case s when 'draft' then 'Not started' when 'in_progress' then 'In progress'
    when 'awaiting_office' then 'Waiting for office check' when 'returned' then 'Sent back to the tech'
    when 'live' then 'Done and live' else 'Cancelled' end
$$;

create or replace function app_private.ws_summary_json(i app_private.ws_installs) returns jsonb
language sql security definer set search_path = app_private, public, pg_temp as $$
  select jsonb_build_object('id', i.id, 'unitKey', i.unit_key, 'unitLabel', i.unit_label, 'site', i.site_name,
    'unitType', i.unit_type, 'status', i.status, 'statusText', app_private.ws_status_text(i.status),
    'startedBy', app_private.ws_name(i.started_by), 'startedAt', i.started_at, 'updatedAt', i.updated_at,
    'techSignedBy', app_private.ws_name(i.tech_signed_by), 'officeSignedBy', app_private.ws_name(i.office_signed_by),
    'officeSignedAt', i.office_signed_at, 'returnedReason', i.returned_reason,
    'done', (select count(*) from app_private.ws_install_items ii join app_private.ws_checklist_template_items ti on ti.id = ii.template_item_id
             where ii.install_id = i.id and ti.standard_status <> 'PLACEHOLDER' and ii.result in ('done','na','waived')),
    'total', (select count(*) from app_private.ws_install_items ii join app_private.ws_checklist_template_items ti on ti.id = ii.template_item_id
              where ii.install_id = i.id and ti.standard_status <> 'PLACEHOLDER'),
    'cameras', (select count(*) from app_private.ws_install_cameras c where c.install_id = i.id and not c.is_speaker),
    'passed', (select count(*) from app_private.ws_walk_test_status w where w.install_id = i.id and (w.passed or w.waived)))
$$;

create or replace function app_private.ws_photos_json(p_item uuid) returns jsonb
language sql security definer set search_path = app_private, public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'path', e.storage_path, 'by', app_private.ws_name(e.uploaded_by), 'at', e.uploaded_at)
         order by e.uploaded_at), '[]'::jsonb)
  from app_private.ws_evidence e where e.install_item_id = p_item and (not e.hidden or app_private.ws_my_role() = 'owner')
$$;

create or replace function app_private.ws_check_json(p_check uuid) returns jsonb
language plpgsql security definer set search_path = app_private, public, pg_temp as $$
declare i app_private.ws_installs; s app_private.ws_walk_test_sessions; out jsonb; r text := app_private.ws_my_role();
begin
  select * into i from app_private.ws_installs where id = p_check;
  if not found then raise exception 'That check was not found. Go back and open it again.'; end if;
  select * into s from app_private.ws_walk_test_sessions where install_id = p_check order by test_mode_on_at desc nulls last limit 1;
  out := app_private.ws_summary_json(i) || jsonb_build_object(
    'kind', i.kind, 'me', app_private.ws_me_json(),
    'canEdit', i.status in ('in_progress','returned') and r in ('service','it','owner'),
    'canOffice', i.status = 'awaiting_office' and r in ('it','owner'),
    'iAmTechSigner', i.tech_signed_by = auth.uid(),
    'selection', jsonb_build_object(
      'noRecorder', i.no_recorder,
      'recorder', (select jsonb_build_object('id', m.id, 'model', m.model) from app_private.ws_device_models m where m.id = i.nvr_model_id),
      'recorderNotOnFile', i.nvr_model_not_on_file_text,
      'system', (select jsonb_build_object('id', m.id, 'model', m.model, 'brand', m.brand) from app_private.ws_device_models m where m.id = i.system_model_id),
      'cameras', coalesce((select jsonb_agg(jsonb_build_object(
          'id', c.id, 'position', c.position, 'role', c.role, 'name', c.camera_name, 'isSpeaker', c.is_speaker,
          'modelId', c.device_model_id, 'model', m.model, 'notOnFile', c.model_not_on_file_text,
          'labelPhoto', (select storage_path from app_private.ws_evidence e where e.id = c.label_evidence_id),
          'walk', case when c.is_speaker then null else jsonb_build_object(
            'passed', w.passed, 'waived', w.waived, 'failed', w.failed_attempts, 'checkSettings', w.prompt_check_settings,
            'waivedReason', (select reason from app_private.ws_walk_test_waivers x where x.install_camera_id = c.id),
            'attempts', coalesce((select jsonb_agg(jsonb_build_object('no', a.attempt_no, 'received', a.event_received,
                 'eventTime', a.watchful_event_time, 'by', app_private.ws_name(a.recorded_by), 'at', a.recorded_at,
                 'photo', (select storage_path from app_private.ws_evidence e where e.id = a.evidence_id and (not e.hidden or r = 'owner')))
                 order by a.attempt_no) from app_private.ws_walk_test_attempts a where a.install_camera_id = c.id), '[]'::jsonb)) end)
        order by c.position)
        from app_private.ws_install_cameras c left join app_private.ws_device_models m on m.id = c.device_model_id
        left join app_private.ws_walk_test_status w on w.install_camera_id = c.id
        where c.install_id = p_check), '[]'::jsonb)),
    'sections', coalesce((select jsonb_agg(jsonb_build_object('title', sec.section, 'items', sec.items) order by sec.k)
      from (select ii.section, min(ii.sort_key) k, jsonb_agg(jsonb_build_object(
              'id', ii.id, 'code', ti.code, 'title', ti.title, 'standard', ti.standard, 'instructions', ti.instructions,
              'help', ti.help_text, 'standardStatus', ti.standard_status, 'evidence', ti.evidence, 'evidenceGroup', ti.evidence_group,
              'required', ti.required, 'valueType', ti.value_type, 'options', to_jsonb(ti.value_options),
              'cameraId', ii.install_camera_id, 'result', ii.result, 'value', ii.value, 'reason', ii.reason, 'note', ii.note,
              'doneBy', app_private.ws_name(ii.done_by), 'doneAt', ii.done_at, 'reopened', ii.reopened, 'returnedNote', ii.returned_note,
              'waivedReason', ii.waived_reason, 'photos', app_private.ws_photos_json(ii.id)) order by ii.sort_key) items
            from app_private.ws_install_items ii join app_private.ws_checklist_template_items ti on ti.id = ii.template_item_id
            where ii.install_id = p_check group by ii.section) sec), '[]'::jsonb),
    'testMode', jsonb_build_object('on', s.id is not null and s.test_mode_off_at is null, 'onBy', app_private.ws_name(s.test_mode_on_by),
      'onAt', s.test_mode_on_at, 'offAt', s.test_mode_off_at, 'everOn', s.id is not null),
    'blockers', coalesce((select jsonb_agg(b) from app_private.ws_submit_blockers(p_check) b), '[]'::jsonb),
    'officeEvidence', (select storage_path from app_private.ws_evidence e where e.id = i.office_evidence_id),
    'sendingX', i.watchful_sending_x, 'sendingY', i.watchful_sending_y,
    'notices', (select jsonb_object_agg(key, jsonb_build_object('title', title, 'body', body)) from app_private.ws_notices));
  return out;
end $$;

-- ================================================================ public API (what the app calls)
create or replace function public.ws_home_v1() returns jsonb
language plpgsql stable security definer set search_path = app_private, public, pg_temp as $$
declare me uuid := app_private.ws_require('service','it','owner');
begin
  return jsonb_build_object('me', app_private.ws_me_json(),
    'open', coalesce((select jsonb_agg(app_private.ws_summary_json(i) order by i.updated_at desc) from app_private.ws_installs i
                      where i.status in ('draft','in_progress','returned')), '[]'::jsonb),
    'waiting', coalesce((select jsonb_agg(app_private.ws_summary_json(i) order by i.tech_signed_at) from app_private.ws_installs i
                         where i.status = 'awaiting_office'), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(app_private.ws_summary_json(x) order by x.office_signed_at desc) from (
                         select * from app_private.ws_installs where status = 'live' order by office_signed_at desc limit 8) x), '[]'::jsonb),
    'quiet', case when app_private.ws_my_role() in ('it','owner') then (
        select jsonb_build_object('quiet', count(*) filter (where status = 'quiet'), 'neverSent', count(*) filter (where status = 'never_sent'),
          'unknown', count(*) filter (where status = 'unknown'), 'soon', count(*) filter (where going_quiet_soon))
        from app_private.ws_camera_status_at(now())) end);
end $$;

-- units COS already knows (camera_devices), with what COS has on file for their models
create or replace function public.ws_find_units_v1(p_q text) returns jsonb
language plpgsql stable security definer set search_path = app_private, public, pg_temp as $$
declare me uuid := app_private.ws_require('service','it','owner'); q text := upper(regexp_replace(coalesce(p_q, ''), '\s+', ' ', 'g'));
begin
  if length(trim(q)) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(u order by u->>'key') from (
    select jsonb_build_object(
      'key', d.unit_key,
      -- the recorder's name, or the first camera's name without its camera number ("Helios 005 - Cam 001" -> "Helios 005")
      'label', coalesce(nullif(trim(regexp_replace((array_agg(d.device_name order by (d.device_type = 'NVR') desc, d.device_name))[1],
                 '(\s*-?\s*(cam(era)?|ch|ptz)\s*\d{1,3}|_\d{1,2})$', '', 'i')), ''), d.unit_key),
      'family', max(d.tech_check_unit_type),
      'suggestedType', app_private.ws_suggest_type(max(d.tech_check_unit_type), d.unit_key),
      'recorderModel', max(d.device_model) filter (where d.device_type = 'NVR'),
      'cameras', coalesce(jsonb_agg(jsonb_build_object('name', d.device_name, 'model', d.device_model) order by d.device_name)
                    filter (where d.device_type = 'IPC'), '[]'::jsonb),
      'openCheck', (select id from app_private.ws_installs i where i.unit_key = d.unit_key and i.status in ('draft','in_progress','awaiting_office','returned') limit 1),
      'signedOff', exists (select 1 from app_private.ws_unit_setup s where s.unit_key = d.unit_key and s.live_install_id is not null)) u
    from public.camera_devices d
    where d.unit_key is not null and not coalesce(d.do_not_use, false) and coalesce(d.activation_state, '') <> 'deactivated'
      and (upper(d.unit_key) like '%' || q || '%' or upper(d.device_name) like '%' || q || '%'
           or upper(replace(d.unit_key, ' ', '')) like '%' || replace(q, ' ', '') || '%')
    group by d.unit_key limit 12) x), '[]'::jsonb);
end $$;

create or replace function app_private.ws_suggest_type(p_family text, p_key text) returns text
language sql immutable as $$
  select case
    when p_family in ('Helios') then 'Helios'
    when p_family = 'Ranger' then 'Ranger'
    when p_family like 'Sniper%' then 'Sniper'
    when p_family = 'CAMV' then 'CAM V / RSU'
    when p_family = 'Recon' then 'Recon II (Reconeyez)'
    when p_family = 'Solar Spotter' or upper(p_key) ~ '^(SS|SOLAR)' then 'Solar Spotter (SS)'
    when p_family = 'NVR' or upper(p_key) ~ '^SPOTTER' then 'Spotter (NVR trailer)'
    when upper(p_key) ~ '^WALL' then 'Wall-E'
    end
$$;

create or replace function public.ws_options_v1(p_unit_type text) returns jsonb
language plpgsql stable security definer set search_path = app_private, public, pg_temp as $$
declare me uuid := app_private.ws_require('service','it','owner');
begin
  return jsonb_build_object(
    'unitTypes', (select jsonb_agg(jsonb_build_object('name', unit_type, 'hasRecorder', has_recorder_option) order by sort_order) from app_private.ws_unit_types),
    'hasRecorder', (select has_recorder_option from app_private.ws_unit_types where unit_type = p_unit_type),
    'choices', coalesce((select jsonb_object_agg(position, models) from (
       select position, jsonb_agg(jsonb_build_object('id', device_model_id, 'model', model, 'brand', brand, 'role', device_role,
              'reference', reference_standard) order by model) models
       from app_private.ws_pick_list where unit_type = p_unit_type group by position) p), '{}'::jsonb));
end $$;

create or replace function public.ws_start_v1(p_unit text, p_label text, p_site text, p_unit_type text, p_kind text default 'new')
returns jsonb language plpgsql security definer set search_path = app_private, public, pg_temp as $$
begin
  return app_private.ws_check_json(app_private.ws_start_install(p_unit, p_label, p_site, p_kind::app_private.ws_install_kind, p_unit_type));
end $$;

create or replace function public.ws_check_v1(p_check uuid) returns jsonb
language plpgsql security definer set search_path = app_private, public, pg_temp as $$
declare me uuid := app_private.ws_require('service','it','owner');
begin return app_private.ws_check_json(p_check); end $$;

-- p_cameras: [{position, role, model_id | not_on_file, name, label_path}]
create or replace function public.ws_save_selection_v1(p_check uuid, p_no_recorder boolean, p_recorder uuid,
  p_recorder_not_on_file text, p_recorder_label_path text, p_system uuid, p_cameras jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public, pg_temp as $$
declare me uuid := app_private.ws_require('service','it','owner'); cams jsonb := '[]'::jsonb; c jsonb; ev uuid;
begin
  for c in select * from jsonb_array_elements(coalesce(p_cameras, '[]'::jsonb)) loop
    ev := null;
    if c->>'label_path' is not null then ev := app_private.ws_photo(p_check, c->>'label_path', 'label'); end if;
    cams := cams || jsonb_build_array(jsonb_build_object('position', c->'position', 'role', c->'role',
      'device_model_id', c->'model_id', 'model_not_on_file_text', c->'not_on_file', 'camera_name', c->'name', 'label_evidence_id', ev));
  end loop;
  perform app_private.ws_save_selection(p_check, p_no_recorder, p_recorder, p_recorder_not_on_file, p_system, cams);
  if p_recorder_label_path is not null then
    update app_private.ws_installs set nvr_label_evidence_id = app_private.ws_photo(p_check, p_recorder_label_path, 'label') where id = p_check;
  end if;
  return app_private.ws_check_json(p_check);
end $$;

create or replace function public.ws_set_item_v1(p_item uuid, p_result text, p_value text default null,
  p_reason text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public, pg_temp as $$
begin
  perform app_private.ws_set_item(p_item, p_result::app_private.ws_item_result, p_value, p_reason, p_note);
  return app_private.ws_check_json((select install_id from app_private.ws_install_items where id = p_item));
end $$;

create or replace function public.ws_add_photo_v1(p_item uuid, p_path text)
returns jsonb language plpgsql security definer set search_path = app_private, public, pg_temp as $$
declare me uuid := app_private.ws_require('service','it','owner'); chk uuid; st app_private.ws_install_status; ro boolean;
begin
  select ii.install_id, i.status, ii.reopened into chk, st, ro from app_private.ws_install_items ii join app_private.ws_installs i on i.id = ii.install_id where ii.id = p_item;
  if chk is null then raise exception 'That step was not found.'; end if;
  if st not in ('in_progress','returned') or (st = 'returned' and not ro) then raise exception 'This step is locked. Only steps the office sent back can change.'; end if;
  perform app_private.ws_photo(chk, p_path, 'item', p_item);
  return app_private.ws_check_json(chk);
end $$;

create or replace function public.ws_test_mode_v1(p_check uuid, p_on boolean, p_path text)
returns jsonb language plpgsql security definer set search_path = app_private, public, pg_temp as $$
declare me uuid := app_private.ws_require('service','it','owner');
begin
  perform app_private.ws_test_mode(p_check, p_on, app_private.ws_photo(p_check, p_path, 'test_mode'));
  return app_private.ws_check_json(p_check);
end $$;

create or replace function public.ws_walk_v1(p_camera uuid, p_received boolean, p_event_time timestamptz, p_path text)
returns jsonb language plpgsql security definer set search_path = app_private, public, pg_temp as $$
declare me uuid := app_private.ws_require('service','it','owner'); chk uuid; ev uuid; n int;
begin
  select install_id into chk from app_private.ws_install_cameras where id = p_camera;
  if chk is null then raise exception 'That camera was not found.'; end if;
  if p_path is not null then ev := app_private.ws_photo(chk, p_path, 'walk_test'); end if;
  n := app_private.ws_record_walk_attempt(p_camera, p_received, p_event_time, ev);
  if ev is not null then
    update app_private.ws_evidence set walk_test_attempt_id = (select id from app_private.ws_walk_test_attempts where install_camera_id = p_camera and attempt_no = n)
     where id = ev;
  end if;
  return app_private.ws_check_json(chk);
end $$;

create or replace function public.ws_submit_v1(p_check uuid) returns jsonb
language plpgsql security definer set search_path = app_private, public, pg_temp as $$
begin perform app_private.ws_submit_for_office(p_check); return app_private.ws_check_json(p_check); end $$;

create or replace function public.ws_send_back_v1(p_check uuid, p_reason text, p_items uuid[]) returns jsonb
language plpgsql security definer set search_path = app_private, public, pg_temp as $$
begin perform app_private.ws_office_send_back(p_check, p_reason, p_items); return app_private.ws_check_json(p_check); end $$;

create or replace function public.ws_sign_off_v1(p_check uuid, p_x int, p_y int, p_path text, p_override text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public, pg_temp as $$
declare me uuid := app_private.ws_require('it','owner');
begin
  perform app_private.ws_office_sign_off(p_check, p_x, p_y, app_private.ws_photo(p_check, p_path, 'office_count'), p_override);
  return app_private.ws_check_json(p_check);
end $$;

create or replace function public.ws_cancel_v1(p_check uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = app_private, public, pg_temp as $$
begin perform app_private.ws_cancel_install(p_check, p_reason); return app_private.ws_check_json(p_check); end $$;

create or replace function public.ws_waive_item_v1(p_item uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = app_private, public, pg_temp as $$
begin
  perform app_private.ws_waive_item(p_item, p_reason);
  return app_private.ws_check_json((select install_id from app_private.ws_install_items where id = p_item));
end $$;

create or replace function public.ws_waive_walk_v1(p_camera uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = app_private, public, pg_temp as $$
begin
  perform app_private.ws_waive_walk_test(p_camera, p_reason);
  return app_private.ws_check_json((select install_id from app_private.ws_install_cameras where id = p_camera));
end $$;

-- owner: a "model not on file" row (camera, or the recorder when p_camera is null) is the catalog model p_model
create or replace function public.ws_map_model_v1(p_check uuid, p_camera uuid, p_model uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = app_private, public, pg_temp as $$
begin
  if p_camera is null then perform app_private.ws_map_nvr_not_on_file(p_check, p_model, p_reason);
  else perform app_private.ws_map_not_on_file(p_camera, p_model, p_reason); end if;
  return app_private.ws_check_json(p_check);
end $$;

create or replace function public.ws_hide_photo_v1(p_evidence uuid, p_reason text) returns void
language plpgsql security definer set search_path = app_private, public, pg_temp as $$
begin perform app_private.ws_hide_evidence(p_evidence, p_reason); end $$;

-- ---------------------------------------------------------------- quiet cameras
create or replace function public.ws_quiet_v1() returns jsonb
language plpgsql stable security definer set search_path = app_private, public, pg_temp as $$
declare me uuid := app_private.ws_require('it','owner');
begin
  return jsonb_build_object(
    'me', app_private.ws_me_json(),
    'cameras', coalesce((select jsonb_agg(jsonb_build_object('id', w.unit_camera_id, 'unitKey', w.unit_key, 'unit', w.unit_name,
        'site', w.site_name, 'camera', w.camera_name, 'model', w.model, 'status', w.status, 'lastEvent', w.last_event_at,
        'readAt', w.site_read_at, 'daysQuiet', w.days_quiet, 'soon', w.going_quiet_soon, 'quietDays', w.quiet_days,
        'note', w.status_note, 'flags', w.flag_text, 'placement', w.placement, 'legacy', w.legacy,
        'alert', (select jsonb_build_object('id', a.id, 'openedAt', a.opened_at, 'ackBy', app_private.ws_name(a.acknowledged_by),
                   'ackAt', a.acknowledged_at, 'ackNote', a.ack_note)
                  from app_private.ws_quiet_camera_alerts a where a.unit_camera_id = w.unit_camera_id and a.closed_at is null))
        order by w.days_quiet desc nulls last, w.unit_name, w.camera_name)
      from app_private.ws_camera_status_at(now()) w), '[]'::jsonb),
    'unmatched', coalesce((select jsonb_agg(jsonb_build_object('site', raw_site, 'unit', raw_unit, 'camera', raw_camera,
        'lastEvent', last_event_at, 'readAt', read_at) order by raw_unit, raw_camera) from app_private.ws_unmatched_event_rows), '[]'::jsonb),
    'lastImport', (select jsonb_build_object('at', imported_at, 'readAt', read_at, 'rows', row_count, 'matched', matched_count,
        'by', app_private.ws_name(uploaded_by), 'source', source) from app_private.ws_event_imports order by imported_at desc limit 1),
    'quietDays', app_private.ws_setting_for(null, null, 'quiet_days'));
end $$;

create or replace function public.ws_import_v1(p_source text, p_read_at timestamptz, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public, pg_temp as $$
declare imp uuid;
begin
  imp := app_private.ws_import_last_events(p_source, p_read_at, p_rows);
  return (select jsonb_build_object('rows', row_count, 'matched', matched_count, 'unmatched', unmatched_count)
          from app_private.ws_event_imports where id = imp);
end $$;

create or replace function public.ws_map_name_v1(p_site text, p_unit text, p_camera text, p_unit_camera uuid, p_legacy_unit text default null)
returns uuid language plpgsql security definer set search_path = app_private, public, pg_temp as $$
begin return app_private.ws_map_camera_name(p_site, p_unit, p_camera, p_unit_camera, p_legacy_unit); end $$;

create or replace function public.ws_ack_v1(p_alert uuid, p_note text) returns void
language plpgsql security definer set search_path = app_private, public, pg_temp as $$
begin perform app_private.ws_ack_alert(p_alert, p_note); end $$;

create or replace function public.ws_placement_v1(p_unit text, p_placement text, p_reason text) returns void
language plpgsql security definer set search_path = app_private, public, pg_temp as $$
begin perform app_private.ws_set_placement(p_unit, p_placement, p_reason); end $$;

create or replace function public.ws_alert_setting_v1(p_scope text, p_scope_id text, p_quiet_days int, p_stale_hours int)
returns void language plpgsql security definer set search_path = app_private, public, pg_temp as $$
begin perform app_private.ws_set_alert_setting(p_scope, p_scope_id, p_quiet_days, p_stale_hours, null); end $$;

-- ---------------------------------------------------------------- grants
do $$ declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'ws\_%\_v1' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app_private' and p.proname like 'ws\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
-- the storage policies call this one as the signed-in user
grant execute on function app_private.ws_file_ok(text, boolean) to authenticated;
grant usage on schema app_private to authenticated;
do $$ declare t record;
begin
  for t in select c.oid::regclass as rel from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app_private' and c.relname like 'ws\_%' and c.relkind in ('r','v') loop
    execute format('revoke all on %s from public, anon, authenticated', t.rel);
  end loop;
end $$;

insert into app_private.ws_alert_settings(scope, quiet_days, stale_read_hours, digest_time) values ('global', 7, 24, '07:00')
on conflict do nothing;

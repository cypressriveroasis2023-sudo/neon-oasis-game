-- REVIEW ONLY: legacy camera project. No placement, provider or health writes.
begin;
-- Append-only IDs are not a commit-order watermark. Epoch includes COUNT plus
-- MAX, so a late commit with a smaller sequence ID still changes the epoch.
create table app_private.cos_camera_identity_events (
 id bigint generated always as identity primary key,
 unit_key text not null,
 camera_device_id bigint,
 created_at timestamptz not null default clock_timestamp()
);
create index cos_camera_identity_events_key on app_private.cos_camera_identity_events(unit_key,id);
alter table app_private.cos_camera_identity_events enable row level security;
revoke all on app_private.cos_camera_identity_events from public,anon,authenticated,service_role;
revoke all on sequence app_private.cos_camera_identity_events_id_seq from public,anon,authenticated,service_role;

create function app_private.cos_camera_identity_event_immutable()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Camera identity epochs are append-only.' using errcode='42501'; end $$;
create trigger cos_camera_identity_event_immutable before update or delete or truncate
 on app_private.cos_camera_identity_events for each statement execute function app_private.cos_camera_identity_event_immutable();
revoke all on function app_private.cos_camera_identity_event_immutable() from public,anon,authenticated,service_role;

create function app_private.cos_camera_identity_changed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and row(old.id,old.source,old.device_type,old.external_device_id,old.device_serial,old.unit_key)
  is not distinct from row(new.id,new.source,new.device_type,new.external_device_id,new.device_serial,new.unit_key) then return new; end if;
 if tg_op in ('UPDATE','DELETE') and old.unit_key is not null then
  insert into app_private.cos_camera_identity_events(unit_key,camera_device_id) values(old.unit_key,old.id);
 end if;
 if tg_op='INSERT' or (tg_op='UPDATE' and new.unit_key is distinct from old.unit_key) then
  if new.unit_key is not null then insert into app_private.cos_camera_identity_events(unit_key,camera_device_id) values(new.unit_key,new.id); end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function app_private.cos_camera_identity_changed() from public,anon,authenticated,service_role;
create trigger cos_camera_identity_changed after insert or update or delete on public.camera_devices
 for each row execute function app_private.cos_camera_identity_changed();
create function app_private.cos_camera_identity_truncated()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into app_private.cos_camera_identity_events(unit_key,camera_device_id) select unit_key,id from public.camera_devices where unit_key is not null;
 return null;
end $$;
revoke all on function app_private.cos_camera_identity_truncated() from public,anon,authenticated,service_role;
create trigger cos_camera_identity_truncated before truncate on public.camera_devices for each statement execute function app_private.cos_camera_identity_truncated();
-- Backfill only epoch events, never camera records. Group commitments survive deletion.
insert into app_private.cos_camera_identity_events(unit_key,camera_device_id)
 select unit_key,id from public.camera_devices where unit_key is not null;

create function public.cos_camera_identity_epochs_v1(p_unit_keys text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not app_private.cos_verified_fleet_actor(auth.uid()) then raise exception 'Verified fleet account required.' using errcode='42501'; end if;
 if p_unit_keys is null or cardinality(p_unit_keys)>1000 or exists(select 1 from unnest(p_unit_keys) k where k is null or length(k) not between 1 and 250 or k<>btrim(k))
  or cardinality(p_unit_keys)<>(select count(distinct k) from unnest(p_unit_keys) k) then raise exception 'Exact bounded source keys required.' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('unitKey',k,'epoch',
  encode(sha256(convert_to(jsonb_build_array('COS_CAMERA_IDENTITY_EPOCH_V1',k,
   (select count(*) from app_private.cos_camera_identity_events e where e.unit_key=k),
   (select max(id)::text from app_private.cos_camera_identity_events e where e.unit_key=k))::text,'UTF8')),'hex'),
  'deviceIds',coalesce((select jsonb_agg(d.id::text order by d.id) from public.camera_devices d where d.unit_key=k),'[]'::jsonb)) order by k),'[]'::jsonb)
 into result from unnest(p_unit_keys) k;
 return result;
end $$;
revoke all on function public.cos_camera_identity_epochs_v1(text[]) from public,anon;
-- Same narrowly verified fleet reader; no new identities, role assignments or writes.
grant execute on function public.cos_camera_identity_epochs_v1(text[]) to authenticated;
commit;

-- Hand edits to unit camera status, made by the Owner or a verified IT technician.
--
-- Star4Live stays the source of truth: the sync keeps writing what the provider
-- reports, and nothing here changes a camera_devices row. A hand edit is a
-- person's statement recorded beside the provider's, applied on top of it when
-- the board is read. Each edit records the provider value it was made against,
-- so once Star4Live agrees the edit has done its job and retires itself.
--
-- Append-only. A correction is a new row, never an update or a delete.
begin;

create table if not exists public.camera_unit_hand_edits (
  id bigint generated always as identity primary key,
  unit_key text not null check (btrim(unit_key) <> '' and length(unit_key) <= 120),
  field text not null check (field in ('placement','site','public_ip')),
  action text not null check (action in ('set','clear')),
  value text check (value is null or length(value) <= 200),
  provider_value text check (provider_value is null or length(provider_value) <= 200),
  actor_user_id uuid not null,
  actor_name text not null check (btrim(actor_name) <> '' and length(actor_name) <= 120),
  actor_role text not null check (actor_role in ('owner','it')),
  reason text check (reason is null or length(reason) <= 400),
  request_id text not null check (btrim(request_id) <> '' and length(request_id) <= 80),
  created_at timestamptz not null default now(),
  constraint camera_unit_hand_edits_value_present check ((action = 'set') = (value is not null)),
  constraint camera_unit_hand_edits_placement_value check (
    field <> 'placement' or value is null or value in ('FIELD','SHOP')),
  constraint camera_unit_hand_edits_request_unique unique (request_id)
);

comment on table public.camera_unit_hand_edits is
  'Append-only hand edits to unit camera status by the Owner or verified IT. Never updated or deleted; a correction is a new row.';

create index if not exists camera_unit_hand_edits_unit_field_idx
  on public.camera_unit_hand_edits (upper(btrim(unit_key)), field, id desc);

-- Append-only: no update, no delete, for anybody.
create or replace function public.camera_unit_hand_edits_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'camera_unit_hand_edits is append-only; record a new edit instead';
end;
$$;

drop trigger if exists camera_unit_hand_edits_no_change on public.camera_unit_hand_edits;
create trigger camera_unit_hand_edits_no_change
  before update or delete on public.camera_unit_hand_edits
  for each row execute function public.camera_unit_hand_edits_append_only();

-- The latest edit per unit and field, with the ones it replaced left in place.
create or replace view public.camera_unit_hand_edit_current as
select distinct on (upper(btrim(unit_key)), field)
  upper(btrim(unit_key)) as unit_key, field, action, value, provider_value,
  actor_name, actor_role, reason, created_at, id
from public.camera_unit_hand_edits
order by upper(btrim(unit_key)), field, id desc;

alter table public.camera_unit_hand_edits enable row level security;
revoke all on public.camera_unit_hand_edits from anon, authenticated;
revoke all on public.camera_unit_hand_edit_current from anon, authenticated;
grant select, insert on public.camera_unit_hand_edits to service_role;
grant select on public.camera_unit_hand_edit_current to service_role;

commit;

-- COS vendor emails, v3 (25 Nov 2026, James approved "do the three"):
--   1. The Eyeforce account number (EYE...) is saved on the unit, so Remove account and Swap unit fill it in.
--      app_private.vendor_unit_accounts (one row per unit) and vendor_unit_account_log (every change).
--      It is set by hand on the unit card, from Eyeforce's reply when an Add account request is marked done,
--      and it moves to the new unit when a swap email is sent. Reads fall back to camera_devices.eyeforce_id
--      (read only; this file never writes camera_devices).
--   2. "Waiting on vendor" for the Manager tab: vendor_requests gains closed_at / closed_by_name / closed_note;
--      cos_vendor_open_v1 lists what is still open, cos_vendor_close_v1 marks one done.
-- All functions are service_role only; the edge function cos-vendor-request is the only caller.
-- Rollback:
--   drop function public.cos_vendor_account_v1(text); drop function public.cos_vendor_account_set_v1(text,text,uuid,text);
--   drop function public.cos_vendor_open_v1(); drop function public.cos_vendor_close_v1(uuid,uuid,text,text);
--   (the two tables and the three columns can stay; nothing else reads them)

alter table app_private.vendor_requests
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by_name text,
  add column if not exists closed_note text;
create index if not exists vendor_requests_open on app_private.vendor_requests(created_at desc) where closed_at is null;

create table if not exists app_private.vendor_unit_accounts(
  unit_key text primary key check (unit_key ~ '^[A-Z0-9]{2,80}$'),
  unit_name text not null,
  eye text not null check (eye ~ '^EYE[0-9]{3,8}$'),
  how text not null check (how in ('hand','reply','swap')),
  set_by uuid not null, set_by_name text not null, set_at timestamptz not null default now());
create table if not exists app_private.vendor_unit_account_log(
  id bigserial primary key, unit_key text not null, unit_name text not null,
  eye text, how text not null, by_id uuid not null, by_name text not null, at timestamptz not null default now());
revoke all on app_private.vendor_unit_accounts, app_private.vendor_unit_account_log from public, anon, authenticated;

create or replace function app_private.vendor_unit_key_v1(p text) returns text language sql immutable set search_path='' as
$$ select regexp_replace(upper(coalesce(p,'')), '[^A-Z0-9]', '', 'g') $$;

-- The unit's Eyeforce account number: the saved one, else the camera records when they all agree.
create or replace function public.cos_vendor_account_v1(p_unit text) returns jsonb
language sql stable security definer set search_path='' as $$
  with k as (select app_private.vendor_unit_key_v1(p_unit) k)
  select coalesce(
    (select jsonb_build_object('eye', a.eye, 'by', a.set_by_name, 'at', a.set_at, 'how', a.how) from app_private.vendor_unit_accounts a, k where a.unit_key = k.k),
    (select jsonb_build_object('eye', min(upper(btrim(d.eyeforce_id))), 'by', null, 'at', null, 'how', 'camera_record')
       from public.camera_devices d, k
      where k.k <> '' and app_private.vendor_unit_key_v1(d.unit_key) = k.k and upper(btrim(d.eyeforce_id)) ~ '^EYE[0-9]{3,8}$'
     having count(distinct upper(btrim(d.eyeforce_id))) = 1),
    jsonb_build_object('eye', null))
$$;

-- Saves (or, with an empty number, clears) the unit's Eyeforce account number. Every change is logged.
create or replace function public.cos_vendor_account_set_v1(p_unit text, p_eye text, p_actor uuid, p_how text default 'hand') returns jsonb
language plpgsql security definer set search_path='' as $$
declare k text := app_private.vendor_unit_key_v1(p_unit); e text := upper(regexp_replace(coalesce(p_eye,''), '\s', '', 'g'));
  who text := coalesce((select coalesce(nullif(full_name,''), username) from public.profiles where user_id = p_actor), 'Unknown');
  u text := left(btrim(coalesce(p_unit,'')), 120);
begin
  if k !~ '^[A-Z0-9]{2,80}$' then raise exception 'Name the unit.'; end if;
  if p_how not in ('hand','reply','swap') then raise exception 'Unknown source.'; end if;
  if e = '' then
    delete from app_private.vendor_unit_accounts where unit_key = k;
    if found then insert into app_private.vendor_unit_account_log(unit_key, unit_name, eye, how, by_id, by_name) values (k, u, null, p_how, p_actor, who); end if;
  else
    if e !~ '^EYE[0-9]{3,8}$' then raise exception 'An Eyeforce account number looks like EYE17351.'; end if;
    insert into app_private.vendor_unit_accounts(unit_key, unit_name, eye, how, set_by, set_by_name) values (k, u, e, p_how, p_actor, who)
      on conflict (unit_key) do update set unit_name = excluded.unit_name, eye = excluded.eye, how = excluded.how,
        set_by = excluded.set_by, set_by_name = excluded.set_by_name, set_at = now()
      where app_private.vendor_unit_accounts.eye is distinct from excluded.eye;
    if found then insert into app_private.vendor_unit_account_log(unit_key, unit_name, eye, how, by_id, by_name) values (k, u, e, p_how, p_actor, who); end if;
  end if;
  return public.cos_vendor_account_v1(p_unit);
end $$;

-- What is still open with a vendor, oldest first, and the last few that were marked done.
create or replace function public.cos_vendor_open_v1() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'open', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'unit', unit_name, 'state', case when state = 'sending' then 'review' else state end,
        'by', requested_by_name, 'at', coalesce(sent_at, created_at), 'to', mail->>'to', 'subject', mail->>'subject', 'error', error) order by created_at)
      from (select * from app_private.vendor_requests where closed_at is null and (state <> 'sending' or created_at < now() - interval '5 minutes')
            order by created_at limit 200) o), '[]'::jsonb),
    'done', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'unit', unit_name, 'state', state, 'by', closed_by_name, 'at', closed_at,
        'subject', mail->>'subject', 'note', closed_note) order by closed_at desc)
      from (select * from app_private.vendor_requests where closed_at is not null order by closed_at desc limit 10) d), '[]'::jsonb))
$$;

-- Marks one request done. An Add account takes the EYE number from Eyeforce's reply and saves it on the unit;
-- a Remove account clears the unit's saved number.
create or replace function public.cos_vendor_close_v1(p_id uuid, p_actor uuid, p_note text default null, p_eye text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r app_private.vendor_requests%rowtype; e text := upper(regexp_replace(coalesce(p_eye,''), '\s', '', 'g'));
  who text := coalesce((select coalesce(nullif(full_name,''), username) from public.profiles where user_id = p_actor), 'Unknown');
begin
  select * into r from app_private.vendor_requests where id = p_id for update;
  if not found then raise exception 'That request is not on record.'; end if;
  if r.closed_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  if e <> '' and e !~ '^EYE[0-9]{3,8}$' then raise exception 'An Eyeforce account number looks like EYE17351.'; end if;
  if e <> '' and r.kind <> 'monitor_add' then raise exception 'Only a new account takes an account number here.'; end if;
  update app_private.vendor_requests set closed_at = now(), closed_by_name = who, closed_note = nullif(left(btrim(coalesce(p_note,'')), 300), '') where id = p_id;
  if r.state = 'sent' and r.kind = 'monitor_add' and e <> '' then perform public.cos_vendor_account_set_v1(r.unit_name, e, p_actor, 'reply'); end if;
  if r.state = 'sent' and r.kind = 'monitor_remove' then perform public.cos_vendor_account_set_v1(r.unit_name, '', p_actor, 'reply'); end if;
  return jsonb_build_object('ok', true, 'unit', r.unit_name, 'account', public.cos_vendor_account_v1(r.unit_name));
end $$;

do $$ declare f text; begin
  foreach f in array array['public.cos_vendor_account_v1(text)','public.cos_vendor_account_set_v1(text,text,uuid,text)',
                           'public.cos_vendor_open_v1()','public.cos_vendor_close_v1(uuid,uuid,text,text)','app_private.vendor_unit_key_v1(text)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;

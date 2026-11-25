-- COS unit card vendor emails: the record of every request, and one send per request id.
-- Used only by the edge function cos-vendor-request (service_role). Re-running is a no-op.
create table if not exists app_private.vendor_requests(
  id uuid primary key,
  kind text not null check (kind in ('sim_cancel_vendera','sim_cancel_simetry','monitor_add','monitor_remove','monitor_swap')),
  unit_name text not null,
  vals jsonb not null,
  mail jsonb not null,
  requested_by uuid not null,
  requested_by_name text not null,
  state text not null default 'sending' check (state in ('sending','sent','failed','review')),
  gmail_id text, sheet text, error text,
  created_at timestamptz not null default now(), sent_at timestamptz);
create index if not exists vendor_requests_unit on app_private.vendor_requests(lower(unit_name), created_at desc);
revoke all on app_private.vendor_requests from public, anon, authenticated;

-- Who is asking: only an active owner may send.
create or replace function public.cos_vendor_actor_v1(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('owner', coalesce(bool_or(p.role::text = 'owner' and p.active and p.archived_at is null), false),
                            'name', max(coalesce(nullif(p.full_name,''), p.username)))
  from public.profiles p where p.user_id = p_user
$$;

-- Claim a request id. 'new' means this call sends it; anything else is a replay of an earlier one.
create or replace function public.cos_vendor_claim_v1(p_id uuid, p_kind text, p_unit text, p_values jsonb, p_mail jsonb, p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r app_private.vendor_requests%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 31));
  select * into r from app_private.vendor_requests where id = p_id;
  if found then
    if r.kind <> p_kind or r.requested_by <> p_actor then raise exception 'This request id was already used for something else.'; end if;
    return jsonb_build_object('state', r.state, 'sent_at', r.sent_at, 'sheet', r.sheet, 'error', r.error);
  end if;
  insert into app_private.vendor_requests(id, kind, unit_name, vals, mail, requested_by, requested_by_name)
  values (p_id, p_kind, left(p_unit, 120), p_values, p_mail, p_actor,
          coalesce((select coalesce(nullif(full_name,''), username) from public.profiles where user_id = p_actor), 'Unknown'));
  return jsonb_build_object('state', 'new');
end $$;

create or replace function public.cos_vendor_finish_v1(p_id uuid, p_state text, p_gmail text, p_sheet text, p_error text) returns void
language sql security definer set search_path='' as $$
  update app_private.vendor_requests set state = p_state, gmail_id = p_gmail, sheet = p_sheet, error = left(p_error, 300),
         sent_at = case when p_state = 'sent' then now() else sent_at end
   where id = p_id and state = 'sending'
$$;

-- The last requests for a unit, newest first, for its card.
create or replace function public.cos_vendor_recent_v1(p_unit text) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'state', state, 'by', requested_by_name, 'at', coalesce(sent_at, created_at),
           'to', mail->>'to', 'subject', mail->>'subject', 'sheet', sheet, 'error', error) order by created_at desc), '[]'::jsonb)
  from (select * from app_private.vendor_requests where lower(unit_name) = lower(btrim(p_unit)) order by created_at desc limit 10) x
$$;

do $$ declare f text; begin
  foreach f in array array['public.cos_vendor_actor_v1(uuid)','public.cos_vendor_claim_v1(uuid,text,text,jsonb,jsonb,uuid)',
                           'public.cos_vendor_finish_v1(uuid,text,text,text,text)','public.cos_vendor_recent_v1(text)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;

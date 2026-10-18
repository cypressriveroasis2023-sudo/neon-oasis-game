-- Synthetic disposable prerequisites; no production data or credentials.
create schema app_private;create role anon;create role authenticated;create role service_role;
 create table app_private.cos_geocodio_control(singleton boolean primary key,enabled boolean,free_only boolean,daily_limit integer);
 insert into app_private.cos_geocodio_control values(true,true,true,2);
 create table app_private.cos_geocodio_account_state(singleton boolean primary key,blocked_until timestamptz,cooldown_until timestamptz);
 insert into app_private.cos_geocodio_account_state(singleton) values(true);
 create table app_private.cos_geocodio_daily_budget(budget_day date primary key,credits integer not null default 0);
 create table app_private.cos_geocodio_reservations(request_id uuid primary key,reservation_token uuid not null unique default gen_random_uuid(),organization_id uuid not null,
 audit_id text,unit_key text not null,address text not null,address_sha256 text not null,budget_day date references app_private.cos_geocodio_daily_budget,
 reserved_at timestamptz not null,lease_until timestamptz not null,send_before timestamptz not null,completed_at timestamptz,outcome jsonb,
 job_kind text default 'owner_audit' check(job_kind in ('owner_audit','native_import')),native_binding jsonb,legacy_guard_sha256 text,
 constraint cos_geocodio_reservation_job_binding check((job_kind='owner_audit' and audit_id is not null and native_binding is null and legacy_guard_sha256 is null)
 or (job_kind='native_import' and audit_id is null and native_binding is not null and legacy_guard_sha256~'^[a-f0-9]{64}$')));
 create function app_private.cos_geocodio_next_reset(timestamptz) returns timestamptz language sql as $$select date_trunc('day',$1)+interval '1 day'$$;
 create function app_private.cos_geocodio_send_before(timestamptz) returns timestamptz language sql as $$select $1+interval '10 seconds'$$;
 create table public.synthetic_equipment(id int primary key,gps text,placement text,camera_id text);insert into public.synthetic_equipment values(1,'saved-gps','SHOP','saved-camera');


do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
end $$;
create schema auth;
create function auth.role() returns text language sql stable as
 $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
create table camera_devices(
 id bigint primary key,unit_key text,source text,public_ip inet,expected_ports integer[] not null default '{}',
 monitoring_profile text,monitoring_enabled boolean default true,connection_revision bigint not null default 0,
 last_health_checked_at timestamptz,last_probe_online_at timestamptz,updated_at timestamptz,
 public_ip_source text,public_ip_mapped_at timestamptz,source_status text,source_last_seen_at timestamptz,
 source_metadata jsonb,organization text,activation_state text,device_name text);
create table camera_health_current(
 camera_device_id bigint primary key references camera_devices,overall_status text not null,
 ip_reachable boolean,port_status jsonb not null default '{}',checked_at timestamptz,
 consecutive_failures integer default 0,detail text,confirmed_outage boolean default false,
 confirmation_reason text,first_failed_at timestamptz,last_recovered_at timestamptz,
 acknowledged_at timestamptz,acknowledged_by uuid);
create table camera_health_history(
 id bigint generated always as identity primary key,camera_device_id bigint,status text,
 check_source text,observed_at timestamptz,detail jsonb);
create table equipment_master(
 id bigint primary key,canonical_family text,unit_tag text,source_label text,tracker_state text,
 tracker_public_ip inet,address text,customer text,updated_at timestamptz);
insert into camera_devices(id,unit_key,source,public_ip,expected_ports,monitoring_profile,organization,activation_state,public_ip_source,updated_at)
 values(1,'SNIPER 001','2026_unit_tracker','8.8.4.1','{443}','sniper','root','deactivated','owner_manual','2026-01-01'),
 (2,'CAMV 002','2026_unit_tracker','8.8.4.2','{443}','camv','Synthetic field site','active','tracker','2026-01-01'),
 (3,'SNIPER 2 001','2026_unit_tracker','8.8.4.3','{443}','sniper','root','deactivated','tracker','2026-01-01'),
 (4,'SNIPER 4 001','2026_unit_tracker','8.8.4.4','{443}','sniper','root','deactivated','tracker','2026-01-01');
insert into equipment_master values
 (1,'Sniper','001','Sniper 001','shop','8.8.4.1','123 Synthetic St','Synthetic Customer','2026-01-01'),
 (2,'CAMV','002','CAMV 002','field_or_unknown','8.8.4.2','456 Synthetic St','Synthetic Customer','2026-01-01'),
 (3,'Sniper 2','001','Sniper 2 001','shop','8.8.4.3',null,null,'2026-01-01'),
 (4,'Sniper 4','001','Sniper 4 001','shop','8.8.4.4',null,null,'2026-01-01');

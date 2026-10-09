#!/usr/bin/env python3
"""Original deployed publisher regression in a disposable localhost PostgreSQL DB.

No schema amendment or production connection. The publisher is copied verbatim
from the read-only Oct 9 baseline capture and its raw PostgreSQL definition hash
is checked before and after every test. Schema/rows are synthetic fixtures.
"""
import argparse
import concurrent.futures
import datetime
import json
import os
import pathlib
import subprocess
import time
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--psql', required=True)
parser.add_argument('--port', required=True, type=int)
parser.add_argument('--user', default='postgres')
parser.add_argument('--library-path', default='')
parser.add_argument('--runtime-script', type=pathlib.Path)
parser.add_argument('--tsx-loader', type=pathlib.Path, default=pathlib.Path(
    '/workspace/scratch/89acc3b21a59/cos-free-geocodio-pipeline/tech-checks/operations/node_modules/tsx/dist/loader.mjs'))
a = parser.parse_args()
DB = 'scheduled_direct_test_' + uuid.uuid4().hex[:12]
ARGS = [a.psql, '-X', '--no-password', '-h', '127.0.0.1', '-p', str(a.port), '-U', a.user,
        '-v', 'ON_ERROR_STOP=1', '-qAt']
ENV = {**os.environ, 'LD_LIBRARY_PATH': a.library_path or os.environ.get('LD_LIBRARY_PATH', ''),
       'PGPASSFILE': '/tmp/no-scheduled-direct-test-credentials'}
EXPECTED_DEFINITION = 'ade4074d7fbbb2b0023a098c47cb7ff5a69ca08125d91208939615c408a2644a'
REPORT = []


def sql(query, database=DB, ok=True, app='scheduled-direct-test'):
    result = subprocess.run(ARGS + ['-d', database], input=query, text=True, capture_output=True,
                            env={**ENV, 'PGAPPNAME': app}, timeout=20)
    if ok and result.returncode:
        raise RuntimeError(result.stderr)
    return result


def value(query, **kwargs):
    return sql(query, **kwargs).stdout.strip()


def q(text):
    return "'" + str(text).replace("'", "''") + "'"


def row(device=1):
    return json.loads(value('select to_jsonb(d) from camera_devices d where id=' + str(device)))


def health(online=True, checked=None):
    return {'checked_at': checked or datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'port_status': {'443': {'online': online}}, 'overall_status': 'online' if online else 'verifying',
            'ip_reachable': online, 'consecutive_failures': 0 if online else 1, 'confirmed_outage': False,
            'detail': 'Synthetic saved service endpoint observation'}


def command(captured=None, payload=None, source='automatic_tcp_sweep'):
    d = captured or row()
    return ('select public.publish_camera_connection_v1(' + str(d['id']) + ',' + str(d['connection_revision']) +
            ',' + q(d['public_ip']) + '::inet,' + q('{' + ','.join(map(str, d['expected_ports'])) + '}') +
            '::integer[],' + q(d['monitoring_profile']) + ',' + q(json.dumps(payload or health())) + '::jsonb,' + q(source) + ');')


def call(**kwargs):
    return json.loads(value("set role service_role;set request.jwt.claim.role='service_role';" + command(**kwargs)))


def wait_sleep(app):
    until = time.monotonic() + 5
    while time.monotonic() < until:
        if value("select count(*) from pg_stat_activity where application_name=" + q(app) + " and wait_event='PgSleep'") == '1':
            return
        time.sleep(.02)
    raise AssertionError('Controlled concurrent writer did not enter wait')


def preserved():
    return value("select jsonb_build_object('source',(select jsonb_agg(to_jsonb(e) order by id) from equipment_master e),"
                 "'placement',(select jsonb_agg(to_jsonb(d)-array['last_health_checked_at','last_probe_online_at'] order by id) from camera_devices d))")

SCHEMA = r"""
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
"""

# Original reviewed connection invalidation/proof triggers plus the exact
# read-only captured publisher definition; no proposed source-guard amendment.
BASELINE = r"""-- REVIEW CANDIDATE ONLY. Apply with both publisher candidates; no user or placement changes.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
alter table public.camera_devices add column if not exists connection_revision bigint not null default 0;

create or replace function public.camera_connection_invalidate_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if row(new.public_ip,new.expected_ports,new.monitoring_profile,new.unit_key,new.monitoring_enabled)
     is distinct from row(old.public_ip,old.expected_ports,old.monitoring_profile,old.unit_key,old.monitoring_enabled) then
    insert into public.camera_health_history(camera_device_id,status,check_source,observed_at,detail)
    values(old.id,'unknown','saved_connection_changed',clock_timestamp(),jsonb_build_object(
      'actor',auth.uid(),'previous_ip',host(old.public_ip),'new_ip',host(new.public_ip),
      'previous_ports',old.expected_ports,'new_ports',new.expected_ports,
      'previous_revision',old.connection_revision,'new_revision',old.connection_revision+1,
      'previous_last_success',old.last_probe_online_at));
    new.connection_revision:=old.connection_revision+1;
    new.last_probe_online_at:=null;
    if lower(coalesce(new.monitoring_profile,'')) in ('sniper','camv') then new.last_health_checked_at:=null; end if;
    update public.camera_health_current set port_status='{}',ip_reachable=null,
      overall_status=case when lower(coalesce(new.monitoring_profile,'')) in ('sniper','camv') then 'unknown' else overall_status end,
      checked_at=case when lower(coalesce(new.monitoring_profile,'')) in ('sniper','camv') then null else checked_at end,
      consecutive_failures=case when lower(coalesce(new.monitoring_profile,'')) in ('sniper','camv') then 0 else consecutive_failures end,
      confirmed_outage=case when lower(coalesce(new.monitoring_profile,'')) in ('sniper','camv') then false else confirmed_outage end,
      confirmation_reason=case when lower(coalesce(new.monitoring_profile,'')) in ('sniper','camv') then null else confirmation_reason end,
      detail=case when lower(coalesce(new.monitoring_profile,'')) in ('sniper','camv') then 'Saved connection changed; awaiting a check of the new endpoint.' else detail end
    where camera_device_id=new.id;
  else
    new.connection_revision:=old.connection_revision;
    -- Older publishers cannot refresh a new endpoint's last-success timestamp.
    if new.last_probe_online_at is distinct from old.last_probe_online_at
       and current_setting('cos.connection_publish_device',true) is distinct from new.id::text then
      new.last_probe_online_at:=old.last_probe_online_at;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.camera_connection_invalidate_v1() from public,anon,authenticated;
drop trigger if exists camera_connection_invalidate_v1 on public.camera_devices;
create trigger camera_connection_invalidate_v1 before update on public.camera_devices
for each row execute function public.camera_connection_invalidate_v1();

-- Legacy TCP writers without endpoint attribution fail closed during rollout.
-- Provider-only writes remain intact; provider observations never renew old TCP proof.
create or replace function public.camera_connection_proof_guard_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.camera_devices%rowtype;
begin
 select * into d from public.camera_devices where id=new.camera_device_id;
 if jsonb_typeof(new.port_status)='object' and new.port_status<>'{}'::jsonb then
   if new.port_status->'_connection'->>'revision' is distinct from d.connection_revision::text
      or new.port_status->'_connection'->>'ip' is distinct from host(d.public_ip)
 then
     new.port_status:='{}'; new.ip_reachable:=null;
     if lower(coalesce(d.monitoring_profile,'')) in ('sniper','camv') then
       new.overall_status:='unknown'; new.checked_at:=null;new.confirmed_outage:=false;new.consecutive_failures:=0;
       new.confirmation_reason:=null;new.detail:='Connection check discarded because endpoint evidence was not current.';
     end if;
   end if;
 end if;
 return new;
end $$;
revoke all on function public.camera_connection_proof_guard_v1() from public,anon,authenticated;
drop trigger if exists camera_connection_proof_guard_v1 on public.camera_health_current;
create trigger camera_connection_proof_guard_v1 before insert or update on public.camera_health_current
for each row execute function public.camera_connection_proof_guard_v1();

CREATE OR REPLACE FUNCTION public.publish_camera_connection_v1(p_device_id bigint, p_revision bigint, p_public_ip inet, p_expected_ports integer[], p_monitoring_profile text, p_health jsonb, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare d public.camera_devices%rowtype; h public.camera_health_current%rowtype; at_time timestamptz; ports jsonb; status_value text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required';end if;
 select * into d from public.camera_devices where id=p_device_id for update;
 if not found or d.connection_revision is distinct from p_revision or d.public_ip is distinct from p_public_ip
   or d.expected_ports is distinct from p_expected_ports or d.monitoring_profile is distinct from p_monitoring_profile
   or not d.monitoring_enabled then return jsonb_build_object('ok',false,'reason','connection_changed');end if;
 if p_source not in ('manual_tcp_check','automatic_tcp_sweep') then raise exception 'Invalid check source';end if;
 at_time:=(p_health->>'checked_at')::timestamptz;
 if at_time is null or at_time>clock_timestamp()+interval '30 seconds' or at_time<clock_timestamp()-interval '5 minutes' then raise exception 'Invalid observation time';end if;
 ports:=p_health->'port_status';status_value:=p_health->>'overall_status';
 if jsonb_typeof(ports)<>'object' or ports='{}'::jsonb or status_value not in ('online','offline','unknown','verifying') then raise exception 'Invalid connection observation';end if;
 if exists(select 1 from jsonb_each(ports) e where e.key!~'^[0-9]{1,5}$' or (case when e.key~'^[0-9]{1,5}$' then e.key::int not between 1 and 65535 else true end) or jsonb_typeof(e.value->'online') is distinct from 'boolean') then raise exception 'Invalid port results';end if;
 select * into h from public.camera_health_current where camera_device_id=d.id for update;
 if (h.port_status->'_connection'->>'checkedAt')::timestamptz>at_time then return jsonb_build_object('ok',false,'reason','newer_observation');end if;
 ports:=ports||jsonb_build_object('_connection',jsonb_build_object('revision',d.connection_revision::text,'checkedAt',to_jsonb(at_time),'ip',host(d.public_ip),'status',status_value,'reachable',(p_health->>'ip_reachable')::boolean,'confirmedOutage',coalesce((p_health->>'confirmed_outage')::boolean,false),'consecutiveFailures',least(3,greatest(0,coalesce((p_health->>'consecutive_failures')::int,0)))));
 insert into public.camera_health_current(camera_device_id,overall_status,ip_reachable,port_status,checked_at,consecutive_failures,detail,confirmed_outage,confirmation_reason,first_failed_at,last_recovered_at,acknowledged_at,acknowledged_by)
 values(d.id,case when lower(d.monitoring_profile) in ('sniper','camv') then status_value else coalesce(d.source_status,'unknown') end,
 (p_health->>'ip_reachable')::boolean,ports,case when lower(d.monitoring_profile) in ('sniper','camv') then at_time else d.source_last_seen_at end,
 case when lower(d.monitoring_profile) in ('sniper','camv') then least(3,greatest(0,coalesce((p_health->>'consecutive_failures')::int,0))) else 0 end,case when lower(d.monitoring_profile) in ('sniper','camv') then left(p_health->>'detail',300) else null end,case when lower(d.monitoring_profile) in ('sniper','camv') then coalesce((p_health->>'confirmed_outage')::boolean,false) else false end,case when lower(d.monitoring_profile) in ('sniper','camv') then left(p_health->>'confirmation_reason',200) else null end,
 case when lower(d.monitoring_profile) in ('sniper','camv') then (p_health->>'first_failed_at')::timestamptz else null end,case when lower(d.monitoring_profile) in ('sniper','camv') then (p_health->>'last_recovered_at')::timestamptz else null end,case when lower(d.monitoring_profile) in ('sniper','camv') then (p_health->>'acknowledged_at')::timestamptz else null end,case when lower(d.monitoring_profile) in ('sniper','camv') then (p_health->>'acknowledged_by')::uuid else null end)
 on conflict(camera_device_id) do update set
 overall_status=case when lower(d.monitoring_profile) in ('sniper','camv') then excluded.overall_status else camera_health_current.overall_status end,
 ip_reachable=excluded.ip_reachable,port_status=excluded.port_status,
 checked_at=case when lower(d.monitoring_profile) in ('sniper','camv') then excluded.checked_at else camera_health_current.checked_at end,
 consecutive_failures=case when lower(d.monitoring_profile) in ('sniper','camv') then excluded.consecutive_failures else camera_health_current.consecutive_failures end,
 detail=case when lower(d.monitoring_profile) in ('sniper','camv') then excluded.detail else camera_health_current.detail end,
 confirmed_outage=case when lower(d.monitoring_profile) in ('sniper','camv') then excluded.confirmed_outage else camera_health_current.confirmed_outage end,
 confirmation_reason=case when lower(d.monitoring_profile) in ('sniper','camv') then excluded.confirmation_reason else camera_health_current.confirmation_reason end,
 first_failed_at=case when lower(d.monitoring_profile) in ('sniper','camv') and p_health?'first_failed_at' then excluded.first_failed_at else camera_health_current.first_failed_at end,
 last_recovered_at=case when lower(d.monitoring_profile) in ('sniper','camv') and p_health?'last_recovered_at' then excluded.last_recovered_at else camera_health_current.last_recovered_at end,
 acknowledged_at=case when lower(d.monitoring_profile) in ('sniper','camv') and p_health?'acknowledged_at' then excluded.acknowledged_at else camera_health_current.acknowledged_at end,
 acknowledged_by=case when lower(d.monitoring_profile) in ('sniper','camv') and p_health?'acknowledged_by' then excluded.acknowledged_by else camera_health_current.acknowledged_by end;
 perform set_config('cos.connection_publish_device',d.id::text,true);
 update public.camera_devices set last_health_checked_at=case when lower(d.monitoring_profile) in ('sniper','camv') then at_time else last_health_checked_at end,last_probe_online_at=case when (p_health->>'ip_reachable')::boolean then at_time else last_probe_online_at end where id=d.id;
 perform set_config('cos.connection_publish_device','',true);
 if lower(d.monitoring_profile) in ('sniper','camv') and h.overall_status is distinct from status_value then
 insert into public.camera_health_history(camera_device_id,status,check_source,observed_at,detail)
 values(d.id,status_value,p_source,at_time,jsonb_build_object('previous_status',h.overall_status,'ports',ports,'public_ip_used',host(d.public_ip),'connection_revision',d.connection_revision));end if;
 return jsonb_build_object('ok',true,'checked_at',at_time,'revision',d.connection_revision);
end $function$;
revoke all on function public.publish_camera_connection_v1(bigint,bigint,inet,integer[],text,jsonb,text) from public,anon,authenticated;
grant execute on function public.publish_camera_connection_v1(bigint,bigint,inet,integer[],text,jsonb,text) to service_role;
commit;"""

try:
    sql('create database ' + DB + " template template0 encoding 'UTF8';", database='postgres')
    sql(SCHEMA)
    sql(BASELINE)
    signature = "'public.publish_camera_connection_v1(bigint,bigint,inet,integer[],text,jsonb,text)'::regprocedure"
    metadata_query = ("select jsonb_build_object('definitionSha256',encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex'),"
                      "'owner',proowner::regrole::text,'acl',proacl,'securityDefiner',prosecdef,'searchPath',proconfig,"
                      "'argnames',proargnames,'returnType',prorettype::regtype::text,'volatility',provolatile,'parallel',proparallel) "
                      "from pg_proc where oid=" + signature)
    metadata = json.loads(value(metadata_query))
    assert metadata['definitionSha256'] == EXPECTED_DEFINITION
    assert metadata['owner'] == 'postgres' and metadata['acl'] == ['postgres=X/postgres', 'service_role=X/postgres']
    REPORT.append('exact captured original publisher raw definition, owner, ACL and execution metadata verified')

    for role in ('anon', 'authenticated'):
        result = sql('set role ' + role + ";set request.jwt.claim.role='" + role + "';" + command(), ok=False)
        assert result.returncode and 'permission denied' in result.stderr
    result = sql("set role service_role;set request.jwt.claim.role='authenticated';" + command(), ok=False)
    assert result.returncode and 'Service role required' in result.stderr
    REPORT.append('real anon/authenticated ACL and service JWT denials')

    before = preserved()
    for device in (1, 2, 3, 4):
        assert call(captured=row(device))['ok']
    assert preserved() == before
    REPORT.append('real service-role publication covers all four families without source/placement changes')

    stale = row()
    sql("update camera_devices set public_ip='8.8.4.9' where id=1")
    assert call(captured=stale)['reason'] == 'connection_changed'
    sql("update camera_devices set public_ip='8.8.4.1' where id=1")
    assert call(captured=stale)['reason'] == 'connection_changed'
    stale = row()
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        writer = pool.submit(sql, "begin;update camera_devices set expected_ports='{8443}' where id=1;select pg_sleep(.4);commit;",
                            DB, True, 'scheduled-endpoint-writer')
        wait_sleep('scheduled-endpoint-writer')
        assert call(captured=stale)['reason'] == 'connection_changed'
        writer.result()
    sql("update camera_devices set expected_ports='{443}' where id=1")
    REPORT.append('original endpoint revision/IP/ports CAS rejects edits, ABA endpoint restore and concurrent writer')

    captured = row()
    older_time = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=2)
    newer = health()
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        writer = pool.submit(sql, "begin;set role service_role;set request.jwt.claim.role='service_role';" +
                            command(captured=captured, payload=newer) + 'select pg_sleep(.4);commit;',
                            DB, True, 'scheduled-newer-publisher')
        wait_sleep('scheduled-newer-publisher')
        assert call(captured=captured, payload=health(False, older_time.isoformat()))['reason'] == 'newer_observation'
        writer.result()
    assert json.loads(value('select port_status from camera_health_current where camera_device_id=1'))['_connection']['status'] == 'online'
    REPORT.append('newer committed observation wins against an older concurrent publication')

    # Demonstrate the known remaining source race rather than claiming that
    # a pre-publication client reread adds source/lifecycle CAS to this RPC.
    captured = row()
    sql("update equipment_master set tracker_state='retired' where id=1")
    assert call(captured=captured)['ok']
    sql("update equipment_master set tracker_state='shop' where id=1")
    REPORT.append('known limitation reproduced: original RPC alone does not atomically guard source/lifecycle changes')

    runtime = []
    if a.runtime_script:
        runtime_state = preserved()
        result = subprocess.run(['node', '--import', str(a.tsx_loader.resolve()), str(a.runtime_script.resolve()),
                                 a.psql, str(a.port), DB, a.user], text=True, capture_output=True, env=ENV, timeout=160)
        if result.returncode:
            raise RuntimeError(result.stderr or result.stdout)
        runtime = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
        assert preserved() == runtime_state, 'Runtime changed original source or placement fixture'
        REPORT.append('actual scheduled handler/helper runtime verified with original publisher')

    assert json.loads(value(metadata_query)) == metadata
    REPORT.append('original publisher definition, owner, ACL and all captured execution metadata remain unchanged')
    print(json.dumps({'status': 'passed', 'database': 'disposable localhost PostgreSQL',
                      'publisherBaseline': 'exact read-only captured original publisher; no schema amendment',
                      'metadata': metadata, 'checks': REPORT, 'runtime': runtime, 'productionCalls': 0,
                      'remainingRace': 'Source/lifecycle changes after the final client reread are not guarded atomically by the unchanged publisher.'}, indent=2))
finally:
    sql('drop database if exists ' + DB + ' with (force);', database='postgres')

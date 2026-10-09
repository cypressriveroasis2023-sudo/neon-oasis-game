import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

export const registryMigration = '20261009182748_cos_vrm_fleet_registry.sql';
export const sql = name => readFile(new URL('../../db/' + name, import.meta.url), 'utf8');
// Every credential and provider identity in this fixture is synthetic. No real DB,
// network request, Vault entry, or environment variable is ever accessed.
export const syntheticSecret = 'a'.repeat(64);
export const syntheticAccount = 41001;
export const bootstrapIds = [1001,1002,1003,1004,1005,1006,1007,1008,1009];
export const installation = (installationId, name = 'Synthetic installation ' + installationId) => ({ installationId, name });

export async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema vault;
      create table vault.secrets(id uuid primary key default gen_random_uuid(), name text unique not null, secret text, description text);
      create view vault.decrypted_secrets as select id,name,secret as decrypted_secret from vault.secrets;
      revoke all on schema vault from public,anon,authenticated,service_role;
      revoke all on all tables in schema vault from public,anon,authenticated,service_role;
    `);
    // This is the complete production registry SQL, executed without replacement.
    await db.exec(await sql(registryMigration));
    const seeded = (await db.query('select count(*)::int n from cos_vrm_private.installations')).rows[0].n;
    if (seeded !== 0) throw new Error('The production registry migration must not seed fleet records');
    // Synthetic bootstrap data belongs only to this test fixture. The production
    // migration starts with an empty registry and includes no fleet records.
    for (const installationId of bootstrapIds) {
      await db.query('insert into cos_vrm_private.installations(installation_id,name) values($1,$2)',
        [installationId,'Synthetic bootstrap ' + installationId]);
    }
    return db;
  } catch (error) { await db.close(); throw error; }
}

// Call within a test transaction. Savepoints make negative privilege/input tests
// independent without swallowing the actual exception or leaving an aborted tx.
export async function asRole(db, role, statement, params = []) {
  if (!['anon','authenticated','service_role'].includes(role)) throw new Error('Unknown fixture role');
  await db.exec('savepoint role_call');
  try {
    await db.exec('set local role ' + role);
    const result = await db.query(statement, params);
    await db.exec('reset role; release savepoint role_call');
    return result;
  } catch (error) {
    await db.exec('rollback to savepoint role_call; release savepoint role_call; reset role');
    throw error;
  }
}
export async function rpc(db, name, args = {}, role = 'service_role') {
  if (!/^cos_vrm_[a-z_]+$/.test(name) || !Object.keys(args).every(key => /^p_[a-z_]+$/.test(key))) throw new Error('Invalid fixture RPC');
  const query = 'select public.' + name + '(' + Object.keys(args).map((key,i) => key + ' => $' + (i+1)).join(',') + ') value';
  return (await asRole(db, role, query, Object.values(args))).rows[0].value;
}
export const snapshot = db => rpc(db, 'cos_vrm_fleet_snapshot');
export const begin = async db => (await rpc(db, 'cos_vrm_fleet_begin')).leaseId;
export const finish = (db, lease, items, user = syntheticAccount) => rpc(db, 'cos_vrm_fleet_finish', { p_lease_id: lease, p_user_id: user, p_items: items });
export const fail = (db, lease, code = 'provider', retry = 60) => rpc(db, 'cos_vrm_fleet_fail', { p_lease_id: lease, p_error_code: code, p_retry_seconds: retry });
export const state = async db => (await db.query('select to_jsonb(s) value from cos_vrm_private.sync_state s')).rows[0].value;
export const registry = async db => (await db.query('select to_jsonb(i) value from cos_vrm_private.installations i order by installation_id')).rows.map(row => row.value);
export const allowNextAttempt = db => db.exec("update cos_vrm_private.sync_state set last_attempt_at = now() - interval '31 seconds', retry_after_at = null");
export const expireLease = db => db.exec("update cos_vrm_private.sync_state set lease_until = now() - interval '1 second', last_attempt_at = now() - interval '61 seconds'");

// PGlite does not ship pg_cron/pg_net/Vault. These explicit metadata-only stubs
// exercise the real scheduler PL/pgSQL and transaction gates. They do not prove
// extension deployment, worker timing, network transport, or live Vault crypto.
export async function installSchedulerStubs(db) {
  await db.exec(`
    create schema cron;
    create schema net;
    create schema extensions;
    create table cron.job(jobid bigint generated always as identity primary key, jobname text unique, schedule text, command text, active boolean default true);
    create table net.synthetic_requests(id bigint generated always as identity primary key, url text, headers jsonb, body jsonb, timeout_milliseconds integer);
    create function cron.schedule(job_name text, job_schedule text, job_command text) returns bigint language plpgsql as $$
      declare result bigint; begin
        insert into cron.job(jobname,schedule,command) values(job_name,job_schedule,job_command)
          on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command,active=true
          returning jobid into result;
        return result;
      end $$;
    create function cron.unschedule(job_id bigint) returns boolean language plpgsql as $$
      begin delete from cron.job where jobid=job_id; return found; end $$;
    create function vault.create_secret(new_secret text,new_name text,new_description text) returns uuid language plpgsql as $$
      declare result uuid; begin
        insert into vault.secrets(name,secret,description) values(new_name,new_secret,new_description) returning id into result;
        return result;
      end $$;
    create function extensions.gen_random_bytes(count integer) returns bytea language sql as $$ select decode(repeat('a1',count),'hex') $$;
    create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$
      declare result bigint; begin
        insert into net.synthetic_requests(url,headers,body,timeout_milliseconds) values(url,headers,body,timeout_milliseconds) returning id into result;
        return result;
      end $$;
  `);
}
export async function schedulerEnableSql() {
  const source = await sql('cos-vrm-schedule-enable.sql');
  const omitted = [
    'create extension if not exists pg_cron with schema pg_catalog;',
    'create extension if not exists pg_net with schema extensions;',
  ];
  for (const statement of omitted) if (source.split(statement).length !== 2) throw new Error('Review scheduler fixture: extension SQL changed');
  return omitted.reduce((text, statement) => text.replace(statement, '-- PGlite fixture: explicit extension stub above.'), source);
}

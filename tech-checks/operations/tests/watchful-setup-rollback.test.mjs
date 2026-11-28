import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

// The rollback removes every ws_ object, keeps a bucket that has photos, and the change applies again after it.
const file = name => readFileSync(new URL('../../database-maintenance/' + name, import.meta.url), 'utf8');
test('apply, roll back, apply again', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage; create schema app_private;
    create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
    create type public.app_role as enum ('pending','it','service','owner');
    create table public.profiles(user_id uuid primary key, role public.app_role, active boolean, archived_at timestamptz, full_name text, username text);
    create table public.camera_devices(id bigserial, unit_key text, device_name text, device_type text, device_model text, tech_check_unit_type text, do_not_use boolean, activation_state text);
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb);
    alter table storage.objects enable row level security;`);
  const left = async () => Number((await db.query(`select
      (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app_private' and c.relname like 'ws\\_%')
    + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','app_private') and p.proname like 'ws\\_%')
    + (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'app_private' and t.typname like 'ws\\_%' and t.typtype = 'e')
    + (select count(*) from pg_policies where policyname like 'ws\\_%') as n`)).rows[0].n);
  await db.exec(file('watchful-setup-check-v1.sql'));
  assert.ok(await left() > 50);
  await db.exec(file('watchful-setup-check-v1-rollback.sql'));
  assert.equal(await left(), 0);
  assert.equal((await db.query("select count(*) n from storage.buckets where id = 'techcheck-watchful-setup'")).rows[0].n, 0, 'empty bucket removed');
  await db.exec(file('watchful-setup-check-v1.sql'));
  await db.query("insert into storage.objects(bucket_id, name) values ('techcheck-watchful-setup', 'a/b/c.jpg')");
  await db.exec(file('watchful-setup-check-v1-rollback.sql'));
  assert.equal((await db.query("select count(*) n from storage.buckets where id = 'techcheck-watchful-setup'")).rows[0].n, 1, 'bucket with photos kept');
  await db.close();
});

-- Rollback for watchful-setup-check-v1.sql (Tech Check goqrnolcvqnirjmzaeyk). Removes every ws_ object it added.
-- The photo bucket is removed only when empty, so no evidence is lost.
begin;
drop policy if exists ws_photos_insert_v1 on storage.objects;
drop policy if exists ws_photos_read_v1 on storage.objects;
do $$ declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where (n.nspname = 'public' and p.proname like 'ws\_%\_v1') loop
    execute 'drop function if exists ' || f.sig || ' cascade';
  end loop;
  for f in select c.oid::regclass rel from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app_private' and c.relname like 'ws\_%' and c.relkind = 'v' loop
    execute 'drop view if exists ' || f.rel || ' cascade';
  end loop;
  -- the audit log refuses TRUNCATE by trigger; dropping the table removes the trigger with it
  for f in select c.oid::regclass rel from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app_private' and c.relname like 'ws\_%' and c.relkind = 'r' loop
    execute 'drop table if exists ' || f.rel || ' cascade';
  end loop;
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app_private' and p.proname like 'ws\_%' loop
    execute 'drop function if exists ' || f.sig || ' cascade';
  end loop;
  for f in select t.oid::regtype typ from pg_type t join pg_namespace n on n.oid = t.typnamespace
           where n.nspname = 'app_private' and t.typname like 'ws\_%' and t.typtype = 'e' loop
    execute 'drop type if exists ' || f.typ || ' cascade';
  end loop;
end $$;
delete from storage.buckets b where b.id = 'techcheck-watchful-setup'
  and not exists (select 1 from storage.objects o where o.bucket_id = 'techcheck-watchful-setup');
commit;

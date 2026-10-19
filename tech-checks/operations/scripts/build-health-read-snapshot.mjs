import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const baseline=await readFile(new URL('../tests/fixtures/health-read-upload-baseline.sql',import.meta.url),'utf8');
const candidate=await readFile(new URL('../db/mhelp-health-read-snapshot.sql',import.meta.url),'utf8');
const sha=createHash('sha256').update(baseline).digest('hex');
const guard=`do $health_read_guard$
begin
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('cos_mhelp_placement_private.upload_snapshot()')
  and p.proowner::regrole::text='postgres' and p.proacl::text='{postgres=X/postgres}' and not p.prosecdef and p.provolatile='s'
  and p.proconfig=array['search_path=""']::text[] and p.prorettype='jsonb'::regtype
  and encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='${sha}') then
  raise exception 'Saved-read adapter changed; stop and review the current definition and security catalog' using errcode='55000';
 end if;
end $health_read_guard$;
`;
const postfix=`do $health_read_security$
begin
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('cos_mhelp_placement_private.upload_snapshot()')
  and p.proowner::regrole::text='postgres' and p.proacl::text='{postgres=X/postgres}' and not p.prosecdef and p.provolatile='s'
  and p.proconfig=array['search_path=""']::text[] and p.prorettype='jsonb'::regtype) then
  raise exception 'Saved-read adapter security changed' using errcode='55000';
 end if;
end $health_read_security$;
`;
await writeFile(new URL('../db/mhelp-health-read-snapshot-install.sql',import.meta.url),'-- Exact current adapter only. No inventory, source, telemetry, credentials, cron or ACL changes.\n'+guard+candidate+';\n'+postfix);
console.log('Generated fingerprint-guarded saved-read adapter; no database contacted.');

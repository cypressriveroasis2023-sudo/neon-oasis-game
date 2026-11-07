/** Hosted-only synthetic setup. Never invoke against a supplied database URL. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createFixture} from '../lib/fixture.mjs';
import {assertHostedHttp,FIXTURE_META,publisherIdentity} from './common.mjs';

assertHostedHttp();
const fixture=await createFixture({backend:'postgres',syntheticClock:false,ports:[443]});
try {
 const pg=fixture.pg;
 const identityBefore=await publisherIdentity(pg);
 // ONLY the synthetic auth shim changes; the reviewed publisher SQL is unchanged.
 await pg.exec(`create or replace function auth.role() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;
  create role direct_ip_http_authenticator login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
   password 'synthetic-ci-only';
  grant anon,authenticated,service_role to direct_ip_http_authenticator with inherit false,set true;
  grant usage on schema public to anon,authenticated,service_role,direct_ip_http_authenticator;
  create function public.direct_ip_proof_http_context() returns jsonb language sql stable security invoker
   set search_path=pg_catalog as $$select jsonb_build_object('database_role',current_user,
    'session_role',session_user,'jwt_role',nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role',
    'legacy_jwt_role',nullif(current_setting('request.jwt.claim.role',true),''))$$;
  revoke all on function public.direct_ip_proof_http_context() from public;
  grant execute on function public.direct_ip_proof_http_context() to anon,authenticated,service_role;
  create function camera_direct_health_private.direct_ip_proof_abort_completion() returns trigger
   language plpgsql security invoker set search_path=pg_catalog as $$
   begin
    if new.completion_receipt is not null and
      nullif(current_setting('request.headers',true),'')::jsonb->>'x-direct-ip-proof-fault'='abort-completion' then
     raise exception 'synthetic HTTP completion rollback' using errcode='P0001';
    end if;
    return new;
   end $$;
  revoke all on function camera_direct_health_private.direct_ip_proof_abort_completion()
   from public,anon,authenticated,service_role,direct_ip_http_authenticator;
  create trigger direct_ip_proof_abort_completion before update on camera_direct_health_private.attempt_receipts
   for each row execute function camera_direct_health_private.direct_ip_proof_abort_completion();`);
 assert.deepEqual(await publisherIdentity(pg),identityBefore,'HTTP fixture must not change publisher definition, ownership or EXECUTE ACL.');
 const roles=(await pg.query(`select rolname,rolsuper,rolcreaterole,rolcreatedb,rolinherit,rolbypassrls
  from pg_roles where rolname in ('direct_ip_http_authenticator','anon','authenticated','service_role') order by rolname`)).rows;
 for(const role of roles)assert.equal(role.rolsuper,false);
 assert.equal(roles.find(r=>r.rolname==='direct_ip_http_authenticator').rolinherit,false);
 for(const role of ['anon','authenticated','service_role','direct_ip_http_authenticator']){
  const rights=(await pg.query(`select has_schema_privilege($1,'camera_direct_health_private','USAGE') as schema_usage,
   has_table_privilege($1,'camera_direct_health_private.attempt_receipts','SELECT') as receipt_select,
   has_table_privilege($1,'camera_direct_health_private.attempt_receipts','TRUNCATE') as receipt_truncate`,[role])).rows[0];
  assert.deepEqual(rights,{schema_usage:false,receipt_select:false,receipt_truncate:false});
 }
 const metadata={kind:'synthetic-hosted-postgrest-fixture',createdAt:new Date().toISOString(),
  candidateSqlSha256:fixture.draftSqlSha256,publisher:identityBefore,baseArgs:await fixture.baseArgs(),binding:await fixture.binding(),roles,
  serverVersion:(await pg.query('show server_version')).rows[0].server_version,
  fixtureOnlyChanges:['auth.role reads request.jwt.claims JSON','restricted HTTP authenticator role and public schema usage',
   'invoker request-role inspection RPC','private completion fault trigger'],
  clock:'native PostgreSQL clock_timestamp; no SQL clock replacement',productionCalls:0,providerCalls:0};
 await writeFile(FIXTURE_META,JSON.stringify(metadata,null,2)+'\n');
 console.log('Prepared synthetic hosted PostgreSQL fixture for real PostgREST HTTP requests.');
}finally{await fixture.close();}

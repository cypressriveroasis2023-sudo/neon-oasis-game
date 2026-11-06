import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createFixture,resetFixtureCatalog} from '../lib/fixture.mjs';
test('fixture reset SQL removes prior default ACLs before public recreation and preserves a minimal public boundary',async()=>{
 const f=await createFixture({backend:'pglite',install:false});
 try {
  await f.pg.exec(`create role acl_fixture_owner;grant pg_read_all_data to service_role with admin false,inherit false,set false;
   grant create on database postgres to acl_fixture_owner;
   alter default privileges grant usage,create on schemas to public,anon,authenticated,service_role;
   alter default privileges grant all on tables to public,anon,authenticated,service_role;`);
  const db=(await f.pg.query('select current_database() as db')).rows[0].db;
  await resetFixtureCatalog(f.pg,db);
  assert.equal((await f.pg.query("select exists(select 1 from pg_roles where rolname='acl_fixture_owner') as found")).rows[0].found,false);
  assert.equal((await f.pg.query("select pg_has_role('service_role','pg_read_all_data','MEMBER') as member")).rows[0].member,false);
  for(const role of ['anon','authenticated','service_role'])assert.deepEqual((await f.pg.query("select has_schema_privilege($1,'public','USAGE') as usage,has_schema_privilege($1,'public','CREATE') as create",[role])).rows[0],{usage:false,create:false});
  await f.pg.exec('grant usage on schema public to service_role');
  assert.deepEqual((await f.pg.query("select has_schema_privilege('service_role','public','USAGE') as usage,has_schema_privilege('service_role','public','CREATE') as create")).rows[0],{usage:true,create:false});
 }finally{await f.close();}
});


test('hosted launcher verifies the pinned amd64 CMD and passes the executable to the version probe',async()=>{
 const text=await readFile(new URL('../http/run-hosted-stage.sh',import.meta.url),'utf8');
 assert.match(text,/\[\[ "\$\{GITHUB_ACTIONS:-\}" == true \]\]/);
 assert.match(text,/assert\.equal\(image\.Architecture,"amd64"\)/);
 assert.match(text,/assert\.deepEqual\(image\.Config\.Cmd,\["\/bin\/postgrest"\]\)/);
 assert.match(text,/assert\.equal\(\(image\.Config\.Entrypoint\|\|\[\]\)\.length,0\)/);
 assert.match(text,/docker run --rm --network none "\$image" \/bin\/postgrest --version/);
 assert.doesNotMatch(text,/docker run --rm --network none "\$image" --version/);
 assert(text.indexOf('docker image inspect')<text.indexOf('docker run --rm'));
});

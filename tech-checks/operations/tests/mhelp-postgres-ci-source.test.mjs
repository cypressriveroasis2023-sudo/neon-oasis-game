import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from '../legacy/mhelp-intake-fixture.mjs';
import {assertCiContext,connection,parameters,validateIsolatedServer} from '../legacy/tests/mhelp-postgres-concurrency.ci.mjs';
test('real PostgreSQL harness is opt-in hosted CI only with hardcoded ephemeral localhost target',()=>{
 for(const env of [{},{GITHUB_ACTIONS:'true'},{COS_MHELP_POSTGRES_CI:'1'},{GITHUB_ACTIONS:'false',COS_MHELP_POSTGRES_CI:'1'}])assert.throws(()=>assertCiContext(env),/no local database was contacted/);
 assert.doesNotThrow(()=>assertCiContext({GITHUB_ACTIONS:'true',COS_MHELP_POSTGRES_CI:'1'}));assert.deepEqual(connection,{host:'127.0.0.1',port:'5432',database:'cos_mhelp_intake_ci',user:'postgres'});
 assert.equal(parameters('select $1,$2,$3',["O'Brien",true,3]),"select 'O''Brien',true,3");assert.throws(()=>parameters('select $2',[1]));
});
test('PostgreSQL and PGlite reuse exact common fixture and actual scheduler SQL rather than a concurrency reimplementation',async()=>{
 const statements=[];await fixture({database:{exec:async sql=>statements.push(sql),query:async(sql,values)=>{statements.push(sql);return {rows:[]};}},realScheduler:true});
 const proposal=await readFile(new URL('../legacy/mhelp-intake-proposal.sql',import.meta.url),'utf8'),scheduler=await readFile(new URL('../intake/mhelp-intake-scheduler-proposal.sql',import.meta.url),'utf8'),contracts=await readFile(new URL('../legacy/tests/contracts/legacy-workflow-contract.sql',import.meta.url),'utf8');
 assert(statements.includes(proposal));assert(statements.includes(scheduler));assert(statements.includes(contracts));assert(!statements.some(sql=>sql.includes('2026-10-09T00:00:00Z')&&sql.includes('validate_intake_lease_v1(uuid)')));
});
test('CI adds official postgres and mandatory concurrency step without dropping existing verification/publish guards',async()=>{
 const yaml=await readFile(new URL('../../../.github/workflows/cos-operations.yml',import.meta.url),'utf8');assert.match(yaml,/image: postgres:17\.11/);assert.match(yaml,/POSTGRES_DB: cos_mhelp_intake_ci/);assert.match(yaml,/COS_MHELP_POSTGRES_CI: '1'/);assert.match(yaml,/node --import tsx legacy\/tests\/mhelp-postgres-concurrency\.ci\.mjs/);
 for(const text of ['Confirm existing technician workflows are unchanged','npm test','npm run typecheck','npm run build','npm run test:browser','Publishing branch advanced','cos-mhelp-ticket-source/**','camera-mhelp-ticket-intake/**','database.types.ts'])assert(yaml.includes(text),text);
 assert(!yaml.includes('continue-on-error: true'));
});

test('PostgreSQL isolation validates fixed database/user/port without assuming a Docker bridge subnet',()=>{
 const valid={database:'cos_mhelp_intake_ci',account:'postgres',port:5432};assert.doesNotThrow(()=>validateIsolatedServer(valid));
 for(const change of [{database:'postgres'},{account:'other'},{port:6543},{port:'5432'}])assert.throws(()=>validateIsolatedServer({...valid,...change}));
 for(const address of ['172.19.0.2','192.168.1.2','10.10.0.2','::ffff:172.18.0.2'])assert.doesNotThrow(()=>validateIsolatedServer({...valid,address}));
 assert.equal(connection.host,'127.0.0.1');
});

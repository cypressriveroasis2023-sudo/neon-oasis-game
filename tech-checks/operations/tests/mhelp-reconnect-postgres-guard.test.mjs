import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {assertCiContext} from '../legacy/tests/mhelp-reconnect-postgres.ci.mjs';
test('reconnect real PostgreSQL gate refuses local calls and runs only in fixed ephemeral CI service',async()=>{
 assert.throws(()=>assertCiContext({}),/no local database was contacted/);assert.throws(()=>assertCiContext({GITHUB_ACTIONS:'true'}),/no local database was contacted/);
 const source=await readFile(new URL('../legacy/tests/mhelp-reconnect-postgres.ci.mjs',import.meta.url),'utf8');for(const evidence of ['validateIsolatedServer','await waitForLock(\'reconnect-second\')','await waitForLock(\'reconnect-commit-replay\')',"e.sqlstate==='55P03'","e.sqlstate==='40001'","e.sqlstate==='42501'",'assert.deepEqual(await snapshot(),before)','assert.deepEqual(await snapshot(),later)'])assert(source.includes(evidence),evidence);
 const workflow=await readFile(new URL('../../../.github/workflows/cos-operations.yml',import.meta.url),'utf8');assert(workflow.includes('node --import tsx legacy/tests/mhelp-reconnect-postgres.ci.mjs'));assert(!workflow.includes('continue-on-error: true'));
});

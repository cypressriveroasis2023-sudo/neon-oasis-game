// Node-only offline checks. Does not create a connection, service, container or browser.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {config,assertHostedExecution} from './bootstrap.mjs';
const base=dirname(fileURLToPath(import.meta.url));
const files=['bootstrap.mjs','hosted-runner.mjs','fixture-state.mjs','workload-fixtures.mjs','overload-fixture.mjs','local-fixture-check.mjs','static-check.mjs'];
for(const file of files){const result=spawnSync(process.execPath,['--check',resolve(base,file)],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
const workflow=await readFile(resolve(base,'cos-full-upload-hosted-proof.yml'),'utf8');
assert.match(workflow,/postgres:17\.6/);assert.match(workflow,/postgrest\/postgrest:v14\.5 \/bin\/postgrest --version/);
assert.match(workflow,/persist-credentials: false/);assert.match(workflow,/contents: read/);
assert(!/secrets\./.test(workflow),'No credentials or production secrets in synthetic workflow');
assert(!/pull_request_target|self-hosted/.test(workflow),'No privileged event or self-hosted execution');
assert(!/not installed under \.github\/workflows/.test(workflow),'No stale copy-only claim about authorized later CI publication');
assert.equal(config.databaseUrl,'postgresql://postgres:synthetic-ci-only@127.0.0.1:55432/cos_camera_receipt_test_ci');
assert.equal(config.apiUrl,'http://127.0.0.1:53000');
assert.equal(config.statementTimeout,'8s');assert.equal(config.workMem,'2184kB');
const source=await readFile(resolve(base,'hosted-runner.mjs'),'utf8');
for(const required of ['await loadPackage()','install:rollback','pg_advisory_xact_lock_shared','await waitForReaders()','actualPostgrest:true','runtime fallback:','allFunctions','representative-width-with-continuity','materialPerformanceGate'])assert(source.includes(required),required);
assert(!source.includes('createServer('));assert(!source.includes('execSync('));
// Only test the guard in a genuinely non-CI local process. Never turn a hosted
// run into a local impersonation by synthesizing platform environment flags.
if(process.env.GITHUB_ACTIONS!=='true')await assert.rejects(assertHostedExecution,/Explicit scoped hosted-execution opt-in required|CI=true required|GitHub Actions only|Self-hosted\/local execution is forbidden|Prepare-only barrier is closed/);
const barrier=JSON.parse(await readFile(resolve(base,'PREPARE-ONLY.json'),'utf8'));
assert(['private-draft','authorized-hosted-synthetic-proof'].includes(barrier.mode));
if(barrier.mode==='private-draft'){assert.equal(barrier.publicationAuthorized,false);assert.equal(barrier.executionAuthorized,false);}
console.log(JSON.stringify({passed:true,kind:'offline-static-only',nativePostgresExecuted:false,postgrestExecuted:false,files:Object.fromEntries(await Promise.all([...files,'bootstrap-roles.sql','cos-full-upload-hosted-proof.yml','PREPARE-ONLY.json'].map(async file=>[file,createHash('sha256').update(await readFile(resolve(base,file))).digest('hex')])))},null,2));

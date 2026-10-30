#!/usr/bin/env node
// Drift detection for hand-deployed edge functions. READ-ONLY: this script never
// deploys, writes, or mutates anything. It asks the platform what is currently
// ACTIVE and compares that against the reviewed record in version control.
//
// Exists because cos-operations-pages v134 was published by hand and its source was
// not in version control, so production could drift from this repository with no
// signal. This check is that signal. It does not replace publishing the source.
//
// Skips cleanly (exit 0) when no token is configured, so it can be added before the
// secret exists and can never block unrelated work.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const RECORD='tech-checks/docs/deployed-cos-operations-pages-v134/manifest.json';
const token=process.env.SUPABASE_ACCESS_TOKEN;
const project=process.env.SUPABASE_PROJECT_REF||'tughscoxralhofrckvxy';

if(!token){
  console.log('SKIP: SUPABASE_ACCESS_TOKEN is not set. Drift was not checked.');
  console.log('      Add a read-only personal access token as that secret to enable this check.');
  process.exit(0);
}

const record=JSON.parse(readFileSync(RECORD,'utf8'));
assert.equal(record.slug,'cos-operations-pages');
const expectedVersion=record.version, expectedArchive=record.ezbr_sha256;

const response=await fetch(`https://api.supabase.com/v1/projects/${project}/functions/${record.slug}`,
  {headers:{Authorization:`Bearer ${token}`}});
if(!response.ok){
  console.error(`FAIL: could not read the deployed function (HTTP ${response.status}).`);
  process.exit(2);
}
const live=await response.json();

const drifted=[];
if(live.version!==expectedVersion) drifted.push(`version: record ${expectedVersion}, deployed ${live.version}`);
if(live.ezbr_sha256!==expectedArchive) drifted.push(`archive sha256: record ${expectedArchive}, deployed ${live.ezbr_sha256}`);

if(drifted.length===0){
  console.log(`OK: deployed ${record.slug} matches the reviewed record (v${expectedVersion}, ${expectedArchive.slice(0,12)}...).`);
  process.exit(0);
}

console.error(`DRIFT: the deployed ${record.slug} no longer matches the reviewed record.`);
for(const line of drifted) console.error(`  - ${line}`);
console.error('');
console.error('Someone deployed this function without updating the record in version control.');
console.error('That is how the v134 source came to exist only inside the running function.');
console.error(`Re-record the deployed source and update ${RECORD}, then re-run.`);
process.exit(1);

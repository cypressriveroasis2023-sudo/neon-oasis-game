#!/usr/bin/env node
// Drift detection for hand-deployed edge functions. READ-ONLY: never deploys,
// writes or mutates anything. Asks the platform what is currently deployed and
// compares it against the reviewed record in version control.
//
// Exists because cos-operations-pages v134 was published by hand and its source was
// not in version control, so production could drift with no signal. This is that
// signal. It is NOT a reproducible-build check: it verifies that what is deployed
// matches what was recorded, not that the recorded source rebuilds to it.
//
// Exit codes are distinct on purpose, because "no credentials" is not "verified":
//   0  VERIFIED        deployed state matches the record
//   1  DRIFT           deployed state differs from the record
//   2  INCONCLUSIVE    could not read the platform
//   3  SKIPPED         no credentials configured; nothing was checked
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const RECORD='tech-checks/docs/deployed-cos-operations-pages-v134/manifest.json';
const token=process.env.SUPABASE_ACCESS_TOKEN;
const project=process.env.SUPABASE_PROJECT_REF||'tughscoxralhofrckvxy';
const record=JSON.parse(readFileSync(RECORD,'utf8'));
const api=`https://api.supabase.com/v1/projects/${project}/functions/${record.slug}`;
const auth={Authorization:`Bearer ${token}`};
const sha256=buffer=>createHash('sha256').update(buffer).digest('hex');

if(!token){
  console.log('SKIPPED: SUPABASE_ACCESS_TOKEN is not set, so nothing was verified.');
  console.log('         This is not a passing check. Add a read-only personal access');
  console.log('         token as that secret to enable it.');
  process.exit(3);
}

const metadata=await fetch(api,{headers:auth}).catch(cause=>({ok:false,status:String(cause)}));
if(!metadata.ok){
  console.error(`INCONCLUSIVE: could not read the deployed function (HTTP ${metadata.status}).`);
  process.exit(2);
}
const live=await metadata.json();

const drift=[];
// A matching digest on a function that is no longer serving traffic is not a
// match worth reporting as one, so status is checked before anything else.
if(live.status!=='ACTIVE') drift.push(`status: expected ACTIVE, deployed ${live.status}`);
if(live.version!==record.version) drift.push(`version: record ${record.version}, deployed ${live.version}`);
if(live.ezbr_sha256!==record.ezbr_sha256) drift.push(`archive sha256: record ${record.ezbr_sha256}, deployed ${live.ezbr_sha256}`);

// File-level verification. The archive digest above is platform-generated; this
// hashes the served source itself against the per-file digests in the record.
// If the body endpoint is unavailable the run says so rather than reporting a
// file-level match it never performed.
let fileLevel='not performed';
const body=await fetch(`${api}/body`,{headers:auth}).catch(()=>({ok:false,status:'unreachable'}));
if(body.ok){
  const served=await body.json().catch(()=>null);
  const files=Array.isArray(served?.files)?served.files:null;
  if(!files){fileLevel='unavailable (body returned no file list)';}
  else{
    fileLevel='performed';
    const byName=new Map(files.map(file=>[file.name?.replace(/^.*\//,''),file.content]));
    for(const expected of record.files){
      const content=byName.get(expected.name.replace(/^.*\//,''));
      if(content===undefined){drift.push(`file missing from deployment: ${expected.name}`);continue;}
      const actual=sha256(Buffer.from(content,'utf8'));
      if(actual!==expected.sha256) drift.push(`file sha256 differs: ${expected.name} (record ${expected.sha256.slice(0,12)}..., deployed ${actual.slice(0,12)}...)`);
    }
    for(const name of byName.keys()) if(!record.files.some(f=>f.name.replace(/^.*\//,'')===name)) drift.push(`file present in deployment but not in record: ${name}`);
  }
}else{
  fileLevel=`unavailable (HTTP ${body.status})`;
}

if(drift.length===0){
  console.log(`VERIFIED: deployed ${record.slug} matches the record (ACTIVE, v${record.version}, ${record.ezbr_sha256.slice(0,12)}...).`);
  console.log(`          File-level source verification: ${fileLevel}.`);
  if(fileLevel!=='performed') console.log('          Metadata matched, but the served source itself was not hashed.');
  process.exit(0);
}

console.error(`DRIFT: deployed ${record.slug} no longer matches the record.`);
for(const line of drift) console.error(`  - ${line}`);
console.error(`  file-level source verification: ${fileLevel}`);
console.error('');
console.error('Someone deployed this function without updating the record in version control.');
console.error('That is how the v134 source came to exist only inside the running function.');
console.error(`Re-record the deployed source and update ${RECORD}, then re-run.`);
process.exit(1);

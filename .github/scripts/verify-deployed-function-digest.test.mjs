// Exercises the drift check against stubbed platform responses. No network, no
// credentials, no deployment. Run: node .github/scripts/verify-deployed-function-digest.test.mjs
import {spawnSync} from 'node:child_process';
import {writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir=mkdtempSync(join(tmpdir(),'drift-'));
const stubPath=join(dir,'stub.mjs');
const record=JSON.parse(await import('node:fs').then(fs=>fs.readFileSync('tech-checks/docs/deployed-cos-operations-pages-v134/manifest.json','utf8')));
const {version,ezbr_sha256}=record;

const cases=[
  ['matches record',         {version,ezbr_sha256},                    0],
  ['version drifted',        {version:version+1,ezbr_sha256},          1],
  ['archive digest drifted', {version,ezbr_sha256:'0'.repeat(64)},      1],
  ['both drifted',           {version:version+6,ezbr_sha256:'a'.repeat(64)}, 1],
  ['platform unreadable',    null,                                     2],
];

let failures=0;
for(const [name,body,expected] of cases){
  writeFileSync(stubPath,`globalThis.fetch=async()=>(${JSON.stringify(body)}===null`
    +`?{ok:false,status:403}:{ok:true,json:async()=>(${JSON.stringify(body)})});`);
  const run=spawnSync('node',['--import',stubPath,'.github/scripts/verify-deployed-function-digest.mjs'],
    {env:{...process.env,SUPABASE_ACCESS_TOKEN:'stub-token'},encoding:'utf8'});
  const ok=run.status===expected;
  if(!ok){failures++;console.error(run.stdout,run.stderr);}
  console.log(`${ok?'PASS':'FAIL'}  ${name.padEnd(24)} exit=${run.status} (expected ${expected})`);
}
// The no-token path must skip rather than fail, so the check can land before the secret.
const skip=spawnSync('node',['.github/scripts/verify-deployed-function-digest.mjs'],
  {env:Object.fromEntries(Object.entries(process.env).filter(([k])=>k!=='SUPABASE_ACCESS_TOKEN')),encoding:'utf8'});
const skipOk=skip.status===0&&skip.stdout.startsWith('SKIP:');
if(!skipOk) failures++;
console.log(`${skipOk?'PASS':'FAIL'}  ${'no token skips cleanly'.padEnd(24)} exit=${skip.status}`);

console.log(failures===0?'\nall drift-check paths behave correctly':`\n${failures} FAILED`);
process.exit(failures?1:0);

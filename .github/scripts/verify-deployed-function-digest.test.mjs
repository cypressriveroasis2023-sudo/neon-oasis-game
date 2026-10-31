// Exercises the drift check against stubbed platform responses. No network, no
// credentials, no deployment. Run: node .github/scripts/verify-deployed-function-digest.test.mjs
import {spawnSync} from 'node:child_process';
import {writeFileSync,mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const record=JSON.parse(readFileSync('tech-checks/docs/deployed-cos-operations-pages-v134/manifest.json','utf8'));
const {version,ezbr_sha256}=record;
const dir=mkdtempSync(join(tmpdir(),'drift-'));
const stub=join(dir,'stub.mjs');
const good={status:'ACTIVE',version,ezbr_sha256};

// Real file contents, so a correct run hashes to the recorded digests.
const realFiles=record.files.map(f=>({name:'cos-operations-pages/'+f.name,
  content:readFileSync('tech-checks/docs/deployed-cos-operations-pages-v134/source/'+f.name,'utf8')}));

const run=(meta,body)=>{
  writeFileSync(stub,`globalThis.fetch=async(url)=>{
    const meta=${JSON.stringify(meta)}, body=${JSON.stringify(body)};
    if(String(url).endsWith('/body')) return body===null?{ok:false,status:404}:{ok:true,json:async()=>body};
    return meta===null?{ok:false,status:403}:{ok:true,json:async()=>meta};
  };`);
  return spawnSync('node',['--import',stub,'.github/scripts/verify-deployed-function-digest.mjs'],
    {env:{...process.env,SUPABASE_ACCESS_TOKEN:'stub-token'},encoding:'utf8'});
};

const cases=[
  ['metadata match, body unavailable', good, null, 0, /File-level source verification: unavailable/],
  ['metadata + every file hash match', good, {files:realFiles}, 0, /File-level source verification: performed/],
  ['NOT ACTIVE is drift',            {...good,status:'REMOVED'}, null, 1, /expected ACTIVE/],
  ['version drift',                  {...good,version:version+1}, null, 1, /version: record/],
  ['archive digest drift',           {...good,ezbr_sha256:'0'.repeat(64)}, null, 1, /archive sha256/],
  ['served file content tampered',   good, {files:realFiles.map((f,i)=>i===0?{...f,content:f.content+'\n// injected'}:f)}, 1, /file sha256 differs/],
  ['file missing from deployment',   good, {files:realFiles.slice(1)}, 1, /file missing from deployment/],
  ['extra file in deployment',       good, {files:[...realFiles,{name:'x/rogue.ts',content:'export{}'}]}, 1, /present in deployment but not in record/],
  ['platform unreadable',            null, null, 2, /INCONCLUSIVE/],
];

let failures=0;
for(const [name,meta,body,expected,pattern] of cases){
  const r=run(meta,body);
  const out=(r.stdout||'')+(r.stderr||'');
  const ok=r.status===expected&&pattern.test(out);
  if(!ok){failures++;console.error(out);}
  console.log(`${ok?'PASS':'FAIL'}  ${name.padEnd(34)} exit=${r.status} (expected ${expected})`);
}
// SKIPPED must be its own state, never a silent pass.
const skip=spawnSync('node',['.github/scripts/verify-deployed-function-digest.mjs'],
  {env:Object.fromEntries(Object.entries(process.env).filter(([k])=>k!=='SUPABASE_ACCESS_TOKEN')),encoding:'utf8'});
const skipOk=skip.status===3&&/SKIPPED/.test(skip.stdout)&&/not a passing check/.test(skip.stdout);
if(!skipOk) failures++;
console.log(`${skipOk?'PASS':'FAIL'}  ${'no token is SKIPPED not pass'.padEnd(34)} exit=${skip.status} (expected 3)`);

console.log(failures===0?'\nall drift-check states behave correctly':`\n${failures} FAILED`);
process.exit(failures?1:0);

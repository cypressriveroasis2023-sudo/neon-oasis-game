/** Synthetic temporary Git repositories only. No SQL, server, provider or install. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,mkdir,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('../',import.meta.url));
const allowlist=JSON.parse(await readFile(join(source,'SCOPE.json'),'utf8')).include;
const environment={...process.env,GITHUB_ACTIONS:'false'};
for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR'])delete environment[key];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(root,...args)=>execFileSync('git',args,{cwd:root,env:environment,stdio:['ignore','pipe','pipe']});
const put=async(root,path,text)=>{await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),text);};
function verify(root,mode='index',extra={}){return spawnSync(process.execPath,[join(root,'ci/verify.mjs'),...(mode?[`--mode=${mode}`]:[])],{cwd:root,env:{...environment,...extra},encoding:'utf8'});}
const pass=result=>assert.equal(result.status,0,result.stderr||result.stdout);
const fail=(result,pattern)=>{assert.notEqual(result.status,0,'verifier unexpectedly passed');assert.match(result.stderr,pattern);};
async function fixture(nested,run){
 const repo=await mkdtemp(join(tmpdir(),'direct-ip-verifier-'));
 const root=nested?join(repo,'proof/direct-ip-generic'):repo;
 try {
  for(const path of allowlist){await put(root,path,await readFile(join(source,path)));await chmod(join(root,path),0o644);}
  git(repo,'init','--quiet');
  if(nested)await put(repo,'unrelated.txt','synthetic unrelated repository file\n');
  git(repo,'add','--all');await run({repo,root,commit:()=>git(repo,'-c','user.name=Synthetic Proof','-c','user.email=proof@example.invalid','commit','--quiet','-m','Synthetic verifier fixture')});
 }finally{await rm(repo,{recursive:true,force:true});}
}
for(const nested of [false,true]){
 const context=nested?'nested subtree':'standalone';
 test(context+': exact staged allowlist passes explicit index mode',()=>fixture(nested,async({root})=>pass(verify(root))));
 test(context+': only untracked runtime evidence/generated/dependency output is allowed',()=>fixture(nested,async({root})=>{
  await put(root,'evidence/sentinel.txt','synthetic runtime evidence\n');await put(root,'http/sentinel.generated.txt','synthetic generated result\n');
  await put(root,'node_modules/synthetic-dependency.txt','synthetic generated dependency output\n');pass(verify(root));
 }));
 for(const path of ['evidence/sentinel.txt','http/sentinel.generated.txt','inputs/MANIFEST.json']){
  test(context+': force-tracked '+path+' fails',()=>fixture(nested,async({root})=>{
   await put(root,path,'synthetic unlisted sentinel\n');git(root,'add','-f','--',path);fail(verify(root),/Git index paths must exactly match/);
  }));
 }
 test(context+': staged wrong bytes cannot hide behind restored working bytes',()=>fixture(nested,async({root})=>{
  const path='inputs/client/directAttemptClient.ts',original=await readFile(join(root,path));await put(root,path,Buffer.concat([original,Buffer.from('\n// staged-only synthetic sentinel\n')]));
  git(root,'add','--',path);await put(root,path,original);fail(verify(root),/indexed and working bytes differ/);
 }));
 test(context+': missing indexed allowlisted file fails',()=>fixture(nested,async({root})=>{
  git(root,'rm','--cached','--force','--','inputs/schema.sql');fail(verify(root),/Git index paths must exactly match/);
 }));
 test(context+': committed mode passes exact HEAD and rejects an otherwise valid changed index',()=>fixture(nested,async({root,commit})=>{
  commit();pass(verify(root,'committed'));pass(verify(root,null));
  await put(root,'README.md',(await readFile(join(root,'README.md'),'utf8'))+'\nSynthetic updated revision.\n');
  const m=JSON.parse(await readFile(join(root,'MANIFEST.json'),'utf8')),bytes=await readFile(join(root,'README.md'));
  m.files['README.md']={bytes:bytes.length,sha256:hash(bytes)};await put(root,'MANIFEST.json',JSON.stringify(m,null,2)+'\n');git(root,'add','--','README.md','MANIFEST.json');
  pass(verify(root));fail(verify(root,'committed'),/Git source gate failed: git diff --cached --quiet HEAD/);
 }));
 test(context+': absent HEAD never silently falls back from committed mode',()=>fixture(nested,async({root})=>fail(verify(root,null),/Git source gate failed: git rev-parse --verify HEAD/)));
 test(context+': hosted verification cannot opt into index-only mode',()=>fixture(nested,async({root,commit})=>{
  commit();fail(verify(root,'index',{GITHUB_ACTIONS:'true'}),/Hosted verification requires committed mode/);pass(verify(root,'committed',{GITHUB_ACTIONS:'true'}));
 }));
 test(context+': untracked nongenerated source and nested metadata names fail',()=>fixture(nested,async({root})=>{
  await put(root,'inputs/MANIFEST.json','synthetic untracked source\n');fail(verify(root),/unexpected or missing worktree source file/);
 }));
 test(context+': direct blob comparison defeats assume-unchanged worktree changes',()=>fixture(nested,async({root})=>{
  git(root,'update-index','--assume-unchanged','--','README.md');await put(root,'README.md','synthetic wrong working bytes\n');fail(verify(root),/indexed and working bytes differ/);
 }));
}
test('nested committed proof ignores unrelated staged and untracked repository files',()=>fixture(true,async({repo,root,commit})=>{
 commit();await put(repo,'unrelated.txt','synthetic changed outside proof\n');await put(repo,'outside-untracked.txt','synthetic untracked outside proof\n');git(repo,'add','--','unrelated.txt');pass(verify(root,'committed'));
}));

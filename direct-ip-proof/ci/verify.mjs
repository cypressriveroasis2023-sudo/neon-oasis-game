/** Source-only integrity/privacy check. Does not execute SQL, handlers or HTTP. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,readdir,lstat} from 'node:fs/promises';
import {join,relative,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
const options=process.argv.slice(2);
assert(options.length<=1&&options.every(v=>/^--mode=(index|committed)$/.test(v)),'Use --mode=index or --mode=committed');
// Committed mode is the safe default. Staged-only preparation must opt in;
// hosted execution can never request the weaker index-only mode.
const mode=options[0]?.slice('--mode='.length)||'committed';
if(process.env.GITHUB_ACTIONS==='true')assert.equal(mode,'committed','Hosted verification requires committed mode');
const git=args=>{
 try{return execFileSync('git',args,{cwd:root,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']});}
 catch(error){assert.fail('Git source gate failed: git '+args.join(' ')+' (exit '+error.status+'): '+String(error.stderr||''));}
};
const nul=buffer=>{const text=buffer.toString('utf8');assert(text===''||text.endsWith('\0'));return text===''?[]:text.slice(0,-1).split('\0');};
const manifest=JSON.parse(await readFile(join(root,'MANIFEST.json'),'utf8'));
const scope=JSON.parse(await readFile(join(root,'SCOPE.json'),'utf8'));
const expected=[...Object.keys(manifest.files),'MANIFEST.json'].sort();
assert.deepEqual(expected,[...scope.include].sort(),'scope must explicitly allow every portable file');
assert.equal(new Set(expected).size,expected.length,'duplicate allowlist path');
for(const path of expected)assert(path&&relative(root,resolve(root,path))===path,'unsafe manifest path');

// Full-name output plus the exact prefix handles both a standalone repository
// and a nested proof subtree. No tracked filename is excluded as runtime output.
const prefix=git(['rev-parse','--show-prefix']).toString('utf8').replace(/\n$/,'');
const local=path=>{assert(path.startsWith(prefix),'Git returned a path outside the proof subtree');return path.slice(prefix.length);};
const indexed=nul(git(['ls-files','--cached','--full-name','-z','--','.'])).map(local).sort();
assert.deepEqual(indexed,expected,'Git index paths must exactly match the proof allowlist');
const stages=nul(git(['ls-files','--stage','--full-name','-z','--','.']));
assert.equal(stages.length,expected.length,'unexpected index stage count');
for(const entry of stages){
 const match=entry.match(/^(\d{6}) ([0-9a-f]{40,64}) ([0-3])\t([\s\S]+)$/);assert(match,'invalid Git index entry');
 const [,fileMode,oid,stage,fullPath]=match,path=local(fullPath);
 assert.equal(stage,'0','unmerged index entry: '+path);assert.equal(fileMode,'100644','unsupported index file mode: '+path);
 const stat=await lstat(join(root,path));assert(stat.isFile()&&!stat.isSymbolicLink(),'allowlisted source must be a regular file: '+path);
 // Read the actual indexed blob. This also defeats assume-unchanged flags and
 // staging wrong bytes followed by restoring only the reviewed working bytes.
 const working=await readFile(join(root,path)),staged=git(['cat-file','blob',oid]);
 assert(working.equals(staged),'indexed and working bytes differ: '+path);
}
if(mode==='committed'){
 git(['rev-parse','--verify','HEAD^{commit}']);
 git(['diff','--cached','--quiet','HEAD','--','.']);
}

// These exceptions apply only after proving that no such path is in the index.
// Dependency output and root Git metadata are not source; generated regular
// files remain usable without letting nested MANIFEST.json/source files hide.
const runtimeFile=path=>path.startsWith('evidence/')||basename(path).includes('.generated.');
async function list(dir=''){
 const paths=[];for(const name of await readdir(join(root,dir))){
  if(dir===''&&['.git','node_modules'].includes(name))continue;
  const rel=join(dir,name),stat=await lstat(join(root,rel));
  assert(!stat.isSymbolicLink(),'symlink is not a portable reviewed input: '+rel);
  if(stat.isDirectory())paths.push(...await list(rel));
  else {assert(stat.isFile());if(!runtimeFile(rel))paths.push(rel);}
 }return paths.sort();
}
assert.deepEqual(await list(),expected,'unexpected or missing worktree source file');
for(const [path,entry] of Object.entries(manifest.files)){
 const data=await readFile(join(root,path));
 assert.equal(data.length,entry.bytes,path+' length');assert.equal(sha(data),entry.sha256,path+' SHA256');
}
assert.equal(sha(await readFile(join(root,'inputs/direct-ip-attempt-local.sql'))),'1516724eadca4b38a4b7c670de3a349413d58d0b206946adbc9b0123f4460c0c');
for(const path of expected)assert(!/camera-provider-reconcile|reconProviderInventory|star-resource-identity|unmapped-resource-diagnostics|reviewed-contract|handler\.test/.test(path),'excluded capture/handler path');
const launcher=await readFile(join(root,'http/run-hosted-stage.sh'),'utf8');assert(launcher.includes('postgrest/postgrest:v14.5'));assert(!launcher.includes('13.0.8'));
console.log(JSON.stringify({integrity:'pass',files:expected.length,mode,gitSubtree:prefix||'.',scope:'generic SQL/client and synthetic fixtures only',postgrestTarget:'14.5',runtime:'not established by this check'},null,2));

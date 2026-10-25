import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

// Run after the existing build. Read-only comparison with the reviewed commit;
// write evidence outside the published tree. No deployment or provider calls.
const root=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
const prefix='tech-checks/operations/dist/';
const digest=b=>createHash('sha256').update(b).digest('hex');
const tracked=execFileSync('git',['ls-tree','-r','--name-only','HEAD','--',prefix],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean).sort();
const walk=dir=>readdirSync(root+'/'+dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+e.name+'/'):[dir+e.name]).sort();
const actual=walk(prefix);
assert.deepEqual(actual,tracked,'Built file set differs from reviewed committed artifact');
const manifest=actual.map(path=>{
 const built=readFileSync(root+'/'+path),committed=execFileSync('git',['show','HEAD:'+path],{cwd:root,maxBuffer:32*1024*1024});
 assert.equal(digest(built),digest(committed),'Built bytes differ: '+path);
 return {path,bytes:built.length,sha256:digest(built)};
});
execFileSync('git',['diff','--exit-code','HEAD','--','tech-checks/operations/package-lock.json'],{cwd:root,stdio:'inherit'});
const evidence={commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),lockfileUnchanged:true,lockfileSha256:digest(readFileSync(root+'/tech-checks/operations/package-lock.json')),files:manifest};
mkdirSync(root+'/cos-build-evidence',{recursive:true});
writeFileSync(root+'/cos-build-evidence/manifest.json',JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence));

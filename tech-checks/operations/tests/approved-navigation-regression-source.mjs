import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import assert from 'node:assert/strict';
const root=dirname(fileURLToPath(import.meta.url));
const manifest=JSON.parse(readFileSync(resolve(root,'fleet-view-navigation-preservation.json'),'utf8'));
const hash=text=>{const b=Buffer.from(text);return createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');};
const mode=process.argv[2];assert.ok(['original','apply','check'].includes(mode),'Use original, apply or check');
for(const item of manifest){
 assert.match(item.path,/^[a-z0-9-]+\.browser\.spec\.mjs$/);
 const path=resolve(root,item.path);let source=readFileSync(path,'utf8');
 if(mode==='original'){assert.equal(hash(source),item.originalBlob,item.path);continue;}
 if(mode==='apply'&&hash(source)===item.originalBlob){
  for(const edit of item.replacements){assert.equal(source.split(edit.from).length-1,edit.count,item.path);source=source.replaceAll(edit.from,edit.to);}
  source=item.addedImport+source;assert.equal(hash(source),item.candidateBlob,item.path);writeFileSync(path,source);
 }
 assert.equal(hash(source),item.candidateBlob,item.path);
 assert.ok(source.startsWith(item.addedImport));source=source.slice(item.addedImport.length);
 for(const edit of [...item.replacements].reverse()){
  assert.equal(source.split(edit.to).length-1,edit.count,item.path);source=source.replaceAll(edit.to,edit.from);
 }
 assert.equal(hash(source),item.originalBlob,item.path);
}
console.log(JSON.stringify({mode,files:manifest.length,originalNonpresentationAssertionsPreserved:true}));

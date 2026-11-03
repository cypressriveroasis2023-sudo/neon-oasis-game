import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const path=new URL('../src/approvedFleetViews.css',import.meta.url);
const addition=readFileSync(new URL('./fixtures/approved-fleet-landscape.css',import.meta.url),'utf8');
const hash=text=>createHash('sha1').update('blob '+Buffer.byteLength(text)+'\0').update(text).digest('hex');
const original='da2e8fc419cd658be614bb2b5adb4b1e6101fa58',candidate='c8be85ebbcf88ede981bb63dde6e3b727a3da7b3';
const mode=process.argv[2];assert.ok(['original','apply','check'].includes(mode));
let source=readFileSync(path,'utf8');
if(mode==='original')assert.equal(hash(source),original);
else {
 if(mode==='apply'&&hash(source)===original){source+=addition;assert.equal(hash(source),candidate);writeFileSync(path,source);}
 assert.equal(hash(source),candidate);assert.ok(source.endsWith(addition));assert.equal(hash(source.slice(0,-addition.length)),original);
}
console.log(JSON.stringify({mode,source:'src/approvedFleetViews.css',onlyScopedLandscapeNavigation:true}));

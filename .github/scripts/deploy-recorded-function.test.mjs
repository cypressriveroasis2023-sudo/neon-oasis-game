// Tests for the fail-closed stages of deploy-recorded-function.mjs. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {preparePayload, countOccurrences, replaceAll, liveMatchesPrecondition, compareServedFiles, sha256} from './deploy-recorded-function.mjs';

const ROOT=new URL('../../',import.meta.url).pathname;
const PATCHES=join(ROOT,'.github/function-patches/cos-operations-pages');
const cors=JSON.parse(readFileSync(join(PATCHES,'exact-origin-cors-a711192b.json'),'utf8'));
const rollback=JSON.parse(readFileSync(join(PATCHES,'rollback-original-v134.json'),'utf8'));
const readRecorded=patch=>name=>readFileSync(join(ROOT,patch.sourceDir,name));

const fixture=()=>{
  const serve=Buffer.from('head;ALLOWED=new Set(["a","b"]);tail');
  const other=Buffer.from('unchanged');
  const patched=Buffer.from('head;ALLOWED=new Set(["a","b","c"]);tail');
  return {
    patch:{
      deployedFileNames:{'serve.ts':'fn/serve.ts','other.ts':'fn/other.ts'},
      edits:[{file:'serve.ts',needle:'ALLOWED=new Set(["a","b"])',replacement:'ALLOWED=new Set(["a","b","c"])',occurrences:1}],
      expectedBefore:{'serve.ts':sha256(serve),'other.ts':sha256(other)},
      expectedAfter:{'serve.ts':sha256(patched),'other.ts':sha256(other)},
    },
    bytes:{'serve.ts':serve,'other.ts':other},
    patched,
  };
};

test('applies exactly one edit and returns bytes matching expectedAfter',()=>{
  const {patch,bytes,patched}=fixture();
  const files=preparePayload(patch,name=>bytes[name]);
  assert.equal(files.length,2);
  const serve=files.find(f=>f.recordName==='serve.ts');
  assert.equal(serve.name,'fn/serve.ts');
  assert.ok(serve.content.equals(patched));
  assert.equal(serve.sha256,patch.expectedAfter['serve.ts']);
  assert.equal(files.find(f=>f.recordName==='other.ts').sha256,patch.expectedAfter['other.ts']);
});

test('refuses when a source file does not match expectedBefore (the extra-LF case)',()=>{
  const {patch,bytes}=fixture();
  const withLf={...bytes,'serve.ts':Buffer.concat([bytes['serve.ts'],Buffer.from('\n')])};
  assert.throws(()=>preparePayload(patch,name=>withLf[name]),/before hash mismatch for serve\.ts/);
});

test('refuses when the needle occurs zero or more than the stated times',()=>{
  const {patch,bytes}=fixture();
  const twice={...bytes,'serve.ts':Buffer.concat([bytes['serve.ts'],bytes['serve.ts']])};
  const p2={...patch,expectedBefore:{...patch.expectedBefore,'serve.ts':sha256(twice['serve.ts'])}};
  assert.throws(()=>preparePayload(p2,name=>twice[name]),/occurs 2 times, expected 1/);
  const none={...bytes,'serve.ts':Buffer.from('nothing here')};
  const p0={...patch,expectedBefore:{...patch.expectedBefore,'serve.ts':sha256(none['serve.ts'])}};
  assert.throws(()=>preparePayload(p0,name=>none[name]),/occurs 0 times, expected 1/);
});

test('refuses when the patched result does not match expectedAfter',()=>{
  const {patch,bytes}=fixture();
  const wrong={...patch,expectedAfter:{...patch.expectedAfter,'serve.ts':'0'.repeat(64)}};
  assert.throws(()=>preparePayload(wrong,name=>bytes[name]),/after hash mismatch for serve\.ts/);
});

test('refuses malformed patch definitions before reading any bytes',()=>{
  const {patch,bytes}=fixture();
  let reads=0;const reader=name=>{reads+=1;return bytes[name];};
  assert.throws(()=>preparePayload({...patch,expectedAfter:{'serve.ts':patch.expectedAfter['serve.ts']}},reader),/expectedBefore but not expectedAfter/);
  assert.throws(()=>preparePayload({...patch,edits:[{...patch.edits[0],file:'ghost.ts'}]},reader),/not a recorded file/);
  assert.throws(()=>preparePayload({...patch,edits:[{...patch.edits[0],occurrences:0}]},reader),/positive occurrence count/);
  assert.throws(()=>preparePayload({...patch,edits:[{...patch.edits[0],needle:''}]},reader),/empty needle/);
  assert.equal(reads,0);
});

test('byte helpers do not treat $ sequences specially and preserve surrounding bytes',()=>{
  const hay=Buffer.from('x$&y NEEDLE z NEEDLE $1');
  assert.equal(countOccurrences(hay,Buffer.from('NEEDLE')),2);
  assert.equal(replaceAll(hay,Buffer.from('NEEDLE'),Buffer.from('$&$1')).toString(),'x$&y $&$1 z $&$1 $1');
  assert.equal(countOccurrences(Buffer.from('aaaa'),Buffer.from('aa')),2);
});

test('live precondition compares only the fields the patch requires',()=>{
  const live={status:'ACTIVE',version:134,ezbr_sha256:'abc'};
  assert.deepEqual(liveMatchesPrecondition(live,{status:'ACTIVE',version:134,ezbr_sha256:'abc'}),[]);
  assert.deepEqual(liveMatchesPrecondition(live,{status:'ACTIVE'}),[]);
  assert.equal(liveMatchesPrecondition({...live,version:135},{version:134}).length,1);
  assert.equal(liveMatchesPrecondition({...live,ezbr_sha256:'zzz'},{ezbr_sha256:'abc'}).length,1);
  assert.equal(liveMatchesPrecondition({...live,status:'REMOVED'},{status:'ACTIVE'}).length,1);
});

test('served-file comparison fails on missing, extra, ambiguous and differing files',()=>{
  const expected=[{name:'fn/serve.ts',sha256:sha256(Buffer.from('A'))},{name:'fn/deno.json',sha256:sha256(Buffer.from('B'))}];
  assert.deepEqual(compareServedFiles([{name:'fn/serve.ts',content:'A'},{name:'fn/deno.json',content:'B'}],expected),[]);
  assert.deepEqual(compareServedFiles([{name:'serve.ts',content:'A'},{name:'deno.json',content:'B'}],expected),[]);
  assert.match(compareServedFiles([{name:'fn/serve.ts',content:'A'}],expected).join('\n'),/missing from deployment: fn\/deno\.json/);
  assert.match(compareServedFiles([{name:'fn/serve.ts',content:'A'},{name:'fn/deno.json',content:'B'},{name:'fn/extra.ts',content:'C'}],expected).join('\n'),/serves 3 files, expected 2/);
  assert.match(compareServedFiles([{name:'fn/serve.ts',content:'A'},{name:'fn/deno.json',content:'X'}],expected).join('\n'),/served sha256 differs for fn\/deno\.json/);
  assert.match(compareServedFiles([{name:'a/serve.ts',content:'A'},{name:'b/serve.ts',content:'A'},{name:'fn/deno.json',content:'B'}],expected).join('\n'),/ambiguous/);
});

test('the committed CORS patch reproduces Vision\'s expected hashes from the recorded v134 bytes',()=>{
  const files=preparePayload(cors,readRecorded(cors));
  const serve=files.find(f=>f.recordName==='serve.ts');
  assert.equal(serve.sha256,'b3e625b5358c06ddf272f6e38ddc5b5d9e57cfc781c91d58c0351abb73bb906c');
  assert.equal(serve.bytes,1028055);
  assert.equal(files.find(f=>f.recordName==='productTcpRuntime.ts').sha256,'613fc3dc4ea79f8072b5f4aa295af870ebfc743920bb0f6f9700f3e08384b2db');
  assert.equal(files.find(f=>f.recordName==='deno.json').sha256,'c9c2133a7e174b1092ba12c48275ffebf3f904562cb057072fb01f359e9ca1be');
  assert.equal(countOccurrences(serve.content,Buffer.from('a711192b.cos-vision-integration-preview.pages.dev')),1);
  assert.equal(countOccurrences(serve.content,Buffer.from('preview-vision-command-james')),0,'branch alias must not be allowed');
});

test('the committed rollback patch reproduces the original v134 bytes unchanged',()=>{
  const files=preparePayload(rollback,readRecorded(rollback));
  assert.equal(files.find(f=>f.recordName==='serve.ts').sha256,'d946e036682663566766314a7bea423ea43921ca33b253134adc62d5f78d4e12');
  assert.equal(files.find(f=>f.recordName==='serve.ts').bytes,1027995);
});

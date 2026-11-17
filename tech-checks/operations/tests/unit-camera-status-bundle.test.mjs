import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

// Live v15 index.ts sha256 9aab92e98e05eaa4ec6b047f3199f34e6e089cdf05efdbb909a36ed396e09401
// is reproduced by node build.mjs at 95e3e5a4f81f0f823e7e646a01a8235da7c5f425 with
// esbuild 0.28.2. Current main's operations handler has moved since that commit,
// so build.mjs on this branch is not the deploy artifact. dist/index.ts is the
// v15 body plus the #405 Recon lastReportedStatus block from d793f91e.
const dir=new URL('../../supabase/functions/cos-unit-camera-status/dist/',import.meta.url);
const sha256=name=>createHash('sha256').update(readFileSync(new URL(name,dir))).digest('hex');

test('reviewed camera bundle is the pinned v15-plus-#405 artifact',()=>{
 const bundle=readFileSync(new URL('index.ts',dir),'utf8');
 assert.equal(sha256('index.ts'),'f8de9ac5df1955803d6f37d5fbccfbdf3bce5e68079670f48418c414978830c9');
 assert.equal(sha256('deno.json'),'c9c2133a7e174b1092ba12c48275ffebf3f904562cb057072fb01f359e9ca1be');
 assert.equal(bundle.includes('95e3e5a4f81f0f823e7e646a01a8235da7c5f425'),true);
 assert.equal(bundle.includes('d793f91e'),true);
 assert.equal(bundle.split('lastReportedStatus').length-1,1);
 assert.equal(bundle.includes('WORKING TREE NOT CLEAN'),false);
});

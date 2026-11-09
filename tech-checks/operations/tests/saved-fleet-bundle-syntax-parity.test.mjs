import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const deployed=resolve(here,'../../supabase/functions/cos-operations-pages/savedFleetBoard.mjs');
const reviewed=resolve(here,'../../docs/vision-native-preview-20261107/source/savedFleetBoard.mjs');
const manifest=resolve(here,'../../docs/vision-native-preview-20261107/manifest.json');

test('checked-in saved Fleet backend and reviewed mirror have valid JS syntax',()=>{
 for(const file of [deployed,reviewed]){
  assert.doesNotThrow(()=>execFileSync(process.execPath,['--check',file],{timeout:10000,stdio:'pipe'}),file+' must parse before shipping');
 }
});

test('reviewed native saved Fleet board matches backend bytes and pinned source hash',()=>{
 const deployedBytes=readFileSync(deployed);
 const reviewedBytes=readFileSync(reviewed);
 assert.deepEqual(reviewedBytes,deployedBytes,'Native review must use exact backend source bytes');
 const expected=JSON.parse(readFileSync(manifest,'utf8')).sourceHashes['savedFleetBoard.mjs'];
 assert.match(expected,/^[a-f0-9]{64}$/,'Native preview must pin a full SHA-256');
 assert.equal(createHash('sha256').update(deployedBytes).digest('hex'),expected,'Native preview hash must match executable backend bytes');
});

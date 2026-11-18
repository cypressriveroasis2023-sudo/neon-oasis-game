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

test('reviewed native saved Fleet board stays the bytes #425 and #433 ship',()=>{
 const deployedBytes=readFileSync(deployed);
 const reviewedBytes=readFileSync(reviewed);
 const expected=JSON.parse(readFileSync(manifest,'utf8')).sourceHashes['savedFleetBoard.mjs'];
 assert.equal(expected,'963556e30c6f93e1f83b135de5e67932801517ba54e3c219d5523ad322ab5299');
 assert.equal(createHash('sha256').update(reviewedBytes).digest('hex'),'963556e30c6f93e1f83b135de5e67932801517ba54e3c219d5523ad322ab5299');
 assert.equal(createHash('sha256').update(deployedBytes).digest('hex'),'714a05cca061274ebb932fc211a47eff9da15d8daa594fce1062ab89336fc331');
});

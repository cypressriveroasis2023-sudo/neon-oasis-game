import test from 'node:test';import assert from 'node:assert/strict';
import {prepareScopedInventory} from '../scripts/prepare-scoped-inventory.mjs';
const sha='a'.repeat(64),sourceEvidence={libraryFileId:'libfile_synthetic',receivedAt:'2026-10-15T23:38:25Z',kind:'derived_mapping'};
const row=(productId,extra={})=>({productId,unitNumber:'Sniper '+productId,category:'Sniper 2',customerId:'1',customer:'Company',placement:'SHOP',lifecycle:'UNFLAGGED',binding:null,...extra});
test('scoped plan changes only assignment and preserves full before state without refreshing other records',()=>{
 const before=[row('1',{binding:{expectedGuard:sha},endpoint:'untouched',observedAt:'older'}),row('2'),row('3',{category:'Helios'})],original=structuredClone(before);
 const source=[row('1',{customerId:'2',customer:'Client',placement:'FIELD'}),row('2')];
 const plan=prepareScopedInventory({activeSha256:sha,before,source,sourceEvidence});assert.equal(plan.executable,false);assert.equal(plan.operations.length,1);assert.deepEqual(Object.keys(plan.operations[0].changes),['customerId','customer','placement']);assert.deepEqual(plan.operations[0].expectedRecord,before[0]);assert.deepEqual(before,original);assert.equal(plan.operations[0].expectedBindingGuard,sha);assert.equal(plan.invariants.globalReceiptUnchanged,true);
});
test('same name with a new ProductId never adopts a binding or deletes history',()=>{
 const before=[row('1',{unitNumber:'Sniper 80',binding:{expectedGuard:sha}})],source=[row('2',{unitNumber:'Sniper 80'})];
 const plan=prepareScopedInventory({activeSha256:sha,before,source,sourceEvidence});assert.equal(plan.operations.length,0);assert.deepEqual(plan.review.map(r=>r.reason),['new_product_identity_requires_review','absent_source_product_retain_history']);
});
test('DNU remains Field and restrictions cannot be relaxed by assignment preparation',()=>{
 const before=[row('1',{unitNumber:'Sniper 80 - DO NOT USE',lifecycle:'DO_NOT_USE',placement:'FIELD'})];
 assert.equal(prepareScopedInventory({activeSha256:sha,before,source:structuredClone(before),sourceEvidence}).operations.length,0);
 const source=[{...before[0],lifecycle:'UNFLAGGED'}],plan=prepareScopedInventory({activeSha256:sha,before,source,sourceEvidence});assert.equal(plan.operations.length,0);assert.equal(plan.review[0].reason,'label_family_or_restriction_changed');
});
test('invalid revisions, collisions and unrelated source families fail closed',()=>{
 const args={activeSha256:sha,before:[row('1')],source:[row('1')],sourceEvidence};
 assert.throws(()=>prepareScopedInventory({...args,activeSha256:'stale'}));assert.throws(()=>prepareScopedInventory({...args,source:[row('1'),row('1')]}));assert.throws(()=>prepareScopedInventory({...args,source:[row('1',{category:'Recon 2'})]}));
});

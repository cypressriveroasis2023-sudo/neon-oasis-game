// Run: node --experimental-strip-types --test tech-checks/supabase/functions/cos-router-details/rules_test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { allowed, readRequest } from './rules.ts';

test('only active Owner and IT', () => {
  assert.equal(allowed({ id: 'x', name: '', role: 'owner', active: true }), true);
  assert.equal(allowed({ id: 'x', name: '', role: 'it', active: true }), true);
  assert.equal(allowed({ id: 'x', name: '', role: 'service', active: true }), false);
  assert.equal(allowed({ id: 'x', name: '', role: 'it', active: false }), false);
  assert.equal(allowed(null), false);
});

test('requests are exact', () => {
  assert.deepEqual(readRequest({ action: 'read' }), { action: 'read' });
  assert.equal(readRequest({ action: 'read', extra: 1 }), null);
  assert.deepEqual(readRequest({ action: 'link', unit: ' SPOTTER 200 ', serial: 'rf3022408344081' }), { action: 'link', unit: 'SPOTTER 200', serial: 'RF3022408344081' });
  assert.equal(readRequest({ action: 'link', unit: '', serial: 'RF3022408344081' }), null);
  assert.equal(readRequest({ action: 'link', unit: 'X', serial: "RF'; drop" }), null);
  assert.equal(readRequest({ action: 'delete' }), null);
  assert.equal(readRequest([]), null);
});

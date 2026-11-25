import test from 'node:test';
import assert from 'node:assert/strict';
import {readSingleVerification} from '../src/fleetVerificationRun.ts';

const ok = (items) => ({contract: 'COS_VERIFY_PRODUCTS_NOW_V1', items});

test('a single-unit check returns what the cameras said for that A#', () => {
  const item = readSingleVerification(ok([{productId: '2285846', status: 'offline', reason: 'Port 1401 did not answer.', checkedAt: '2026-11-25T15:40:00Z'}]), '2285846');
  assert.equal(item.status, 'offline');
  assert.equal(item.reason, 'Port 1401 did not answer.');
});

test('an answer about another unit, or no answer, is refused rather than shown as checked', () => {
  assert.throws(() => readSingleVerification(ok([{productId: '999', status: 'online', reason: '', checkedAt: '2026-11-25T15:40:00Z'}]), '2285846'));
  assert.throws(() => readSingleVerification(ok([]), '2285846'));
  assert.throws(() => readSingleVerification({}, '2285846'));
  assert.throws(() => readSingleVerification(null, '2285846'));
});

test('unknown carries no time, so it cannot pass for a finished check', () => {
  const item = readSingleVerification(ok([{productId: '1', status: 'unknown', reason: 'No verified public tracker IP is available.', checkedAt: null}]), '1');
  assert.equal(item.status, 'unknown');
  assert.throws(() => readSingleVerification(ok([{productId: '1', status: 'online', reason: '', checkedAt: null}]), '1'));
});

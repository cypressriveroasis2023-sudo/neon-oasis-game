import {test} from 'node:test';
import assert from 'node:assert/strict';
import {acceptedInventoryFreeze, INVENTORY_FREEZE_CONTRACT} from '../../supabase/functions/cos-operations-pages/mhelpUploadPlacement.ts';

const SHA = 'a'.repeat(64), OTHER = 'b'.repeat(64);
const READ_AT = '2026-11-12T18:36:00Z';
const NOW = Date.parse('2026-11-12T21:00:00Z');
const state = (over = {}, freeze = {}) => ({
  contract: 'COS_INVENTORY_FREEZE_STATE_V1', state: 'frozen',
  freeze: {contract: INVENTORY_FREEZE_CONTRACT, sourceSha256: SHA, acceptedAt: '2026-11-12T19:00:00Z', acceptedBy: 'James Martin', ...freeze},
  ...over,
});
const accepted = (over, freeze) => acceptedInventoryFreeze(state(over, freeze), SHA, READ_AT, NOW);

test('a freeze naming this census is accepted, and keeps who accepted it', () => {
  assert.deepEqual(accepted(), {contract: INVENTORY_FREEZE_CONTRACT, sourceSha256: SHA, acceptedAt: '2026-11-12T19:00:00Z', acceptedBy: 'James Martin'});
  assert.deepEqual(accepted({}, {acceptedBy: '  James Martin  '}).acceptedBy, 'James Martin');
});

test('a freeze for another census is ignored', () => {
  assert.equal(accepted({}, {sourceSha256: OTHER}), null);
  assert.equal(acceptedInventoryFreeze(state(), OTHER, READ_AT, NOW), null);
});

test('no freeze, a released list, or a wrong contract is ignored', () => {
  assert.equal(accepted({state: 'none'}), null);
  assert.equal(accepted({state: 'frozen', freeze: null}), null);
  assert.equal(accepted({contract: 'SOMETHING_ELSE'}), null);
  assert.equal(accepted({}, {contract: 'OTHER_V1'}), null);
  for (const value of [null, undefined, 'frozen', 42, []]) assert.equal(acceptedInventoryFreeze(value, SHA, READ_AT, NOW), null);
});

test('a freeze accepted before the census was read is ignored', () => {
  assert.equal(accepted({}, {acceptedAt: '2026-11-12T18:00:00Z'}), null);
  assert.ok(accepted({}, {acceptedAt: READ_AT}), 'accepting at the moment of the read is allowed');
});

test('a freeze from the future is ignored, with a minute of clock tolerance', () => {
  assert.equal(accepted({}, {acceptedAt: '2026-11-12T21:05:00Z'}), null);
  assert.ok(accepted({}, {acceptedAt: '2026-11-12T21:00:30Z'}));
});

test('a freeze with no name, a blank name or an absurd name is ignored', () => {
  for (const acceptedBy of ['', '   ', null, 42, 'x'.repeat(121)]) assert.equal(accepted({}, {acceptedBy}), null);
});

test('a freeze with an unusable time is ignored', () => {
  for (const acceptedAt of ['', 'yesterday', null, 42]) assert.equal(accepted({}, {acceptedAt}), null);
});

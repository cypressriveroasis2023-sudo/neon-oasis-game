import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIELD_LIST_CONTRACT, createMhelpFieldListHandler, projectFieldList, projectFieldListRecord, readListAction,
} from '../../supabase/functions/cos-mhelp-field-list/index.ts';

const post = (body = '{"action":"list"}') => new Request('https://example.test/cos-mhelp-field-list', {
  method: 'POST', headers: {'Content-Type': 'application/json'}, body,
});

// Shaped like the records cos_mhelp_inventory_baseline() actually returns.
const baselineRecord = (productId, unitNumber, overrides = {}) => ({
  productId, unitNumber, placement: 'FIELD', lifecycle: 'UNFLAGGED',
  category: 'Camera Unit', customer: 'A Customer', sourceAddress: '1 Example Rd',
  holdReason: null, binding: {}, apiAssignment: {}, addressReview: {},
  possibleAliasUnitIds: [], sourceRow: 1, customerId: '99',
  sourceDates: {apiCategoryObservedAt: '2026-11-24T13:35:36.912Z', apiUpdatedAt: '2026-11-20T01:02:03.000Z'},
  ...overrides,
});

const baseline = (records) => ({
  portalId: '224643', complete: true, sourceSha256: 'b'.repeat(64), records,
});

test('a record is projected to what a link and the retirement rule need', () => {
  const projected = projectFieldListRecord(baselineRecord('1982800', 'Spotter 236HDC2'));
  assert.deepEqual(projected, {
    productId: '1982800', unitNumber: 'Spotter 236HDC2', placement: 'FIELD', lifecycle: 'UNFLAGGED',
    category: 'Camera Unit', customer: 'A Customer', sourceAddress: '1 Example Rd', holdReason: null,
    placementObservedAt: '2026-11-24T13:35:36.912Z',
  });
});

test('a missing observed time is null, never a guess', () => {
  assert.equal(projectFieldListRecord(baselineRecord('1', 'Spotter 1', {sourceDates: {}})).placementObservedAt, null);
  assert.equal(projectFieldListRecord(baselineRecord('1', 'Spotter 1', {sourceDates: null})).placementObservedAt, null);
});

test('an unreadable observed time is refused rather than dropped', () => {
  assert.throws(() => projectFieldListRecord(baselineRecord('1', 'Spotter 1', {sourceDates: {apiCategoryObservedAt: 'yesterday'}})));
});

test('an A# that is not a plain equipment id is refused', () => {
  for (const bad of ['', '0', '012', 'A#12', '12.5', 12, null]) {
    assert.throws(() => projectFieldListRecord(baselineRecord(bad, 'Spotter 1')), undefined, 'accepted ' + String(bad));
  }
});

test('a name with control characters or no name at all is refused', () => {
  assert.throws(() => projectFieldListRecord(baselineRecord('1', 'Spotter\u00001')));
  assert.throws(() => projectFieldListRecord(baselineRecord('1', '')));
});

test('the whole list carries the contract and the source fingerprint', () => {
  const projected = projectFieldList(baseline([baselineRecord('1982800', 'Spotter 236HDC2')]));
  assert.equal(projected.contract, FIELD_LIST_CONTRACT);
  assert.equal(projected.sourceSha256, 'b'.repeat(64));
  assert.equal(projected.complete, true);
  assert.equal(projected.recordCount, 1);
});

test('a duplicated A# in the baseline is refused outright', () => {
  assert.throws(() => projectFieldList(baseline([
    baselineRecord('1982800', 'Spotter 236HDC2'), baselineRecord('1982800', 'Spotter 237HD'),
  ])));
});

test('only an exact list action is accepted', async () => {
  assert.equal(await readListAction(post()), 'list');
  for (const body of ['{"action":"write"}', '{"action":"list","all":true}', '{}', '[]']) {
    await assert.rejects(() => readListAction(post(body)));
  }
});

test('a caller that does not authenticate reads nothing', async () => {
  let read = false;
  const handler = createMhelpFieldListHandler({
    authenticate: () => false,
    readBaseline: async () => { read = true; return baseline([]); },
  });
  assert.equal((await handler(post())).status, 403);
  assert.equal(read, false);
});

test('a baseline that cannot be read is reported, not served empty', async () => {
  const handler = createMhelpFieldListHandler({
    authenticate: () => true, readBaseline: async () => { throw Error('down'); },
  });
  const response = await handler(post());
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /unavailable/);
});

test('one unreadable record serves nothing rather than a list with a hole in it', async () => {
  const handler = createMhelpFieldListHandler({
    authenticate: () => true,
    readBaseline: async () => baseline([baselineRecord('1982800', 'Spotter 236HDC2'), baselineRecord('0', 'Spotter 9')]),
  });
  const response = await handler(post());
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.records, undefined);
});

test('a good list is served with a read time', async () => {
  const handler = createMhelpFieldListHandler({
    authenticate: () => true,
    readBaseline: async () => baseline([baselineRecord('1982800', 'Spotter 236HDC2')]),
  });
  const body = await (await handler(post())).json();
  assert.equal(body.recordCount, 1);
  assert.equal(body.records[0].productId, '1982800');
  assert.ok(Number.isFinite(Date.parse(body.readAt)));
});

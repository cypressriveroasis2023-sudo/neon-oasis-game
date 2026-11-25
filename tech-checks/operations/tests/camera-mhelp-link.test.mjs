import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPLY_LIMIT, createCameraMhelpLinkHandler, projectPlan, readLinkAction, readServedList,
} from '../../supabase/functions/camera-mhelp-link/index.ts';
import {planUnitAttachments} from '../shared/mhelpUnitAttach.ts';

const post = (body, secret = 'a-secret') => new Request('https://example.test/camera-mhelp-link', {
  method: 'POST', headers: {'Content-Type': 'application/json', 'x-camera-cron-secret': secret}, body,
});

const servedList = (records, extra = {}) => ({
  contract: 'cos-mhelp-field-list-v1', portalId: '224643',
  sourceSha256: 'a'.repeat(64), complete: true,
  recordCount: records.length, records, ...extra,
});

const record = (productId, unitNumber, placement = 'FIELD') => ({
  productId, unitNumber, placement, lifecycle: 'UNFLAGGED', category: null,
  customer: null, sourceAddress: null, holdReason: null,
  placementObservedAt: '2026-11-24T13:35:36.912Z',
});

const harness = (overrides = {}) => {
  const calls = {saved: [], applied: []};
  const handler = createCameraMhelpLinkHandler({
    verifyCron: async candidate => candidate === 'a-secret',
    readServed: async () => servedList([record('1982800', 'Spotter 236HDC2')]),
    saveFieldList: async (records, sha) => { calls.saved.push({records, sha}); return records.length; },
    readCosUnits: async () => [{id: 'SPOTTER 236', name: 'SPOTTER 236'}],
    readExistingLinks: async () => ({unitKeys: [], productIds: []}),
    applyLinks: async links => { calls.applied.push(links); return {unitsLinked: links.length, cameraRowsWritten: links.length * 4}; },
    ...overrides,
  });
  return {handler, calls};
};

test('only an exact plan or apply action is accepted', async () => {
  assert.equal(await readLinkAction(post('{"action":"plan"}')), 'plan');
  assert.equal(await readLinkAction(post('{"action":"apply"}')), 'apply');
  for (const body of ['{"action":"wipe"}', '{"action":"plan","force":true}', '{}', '[]', 'null']) {
    await assert.rejects(() => readLinkAction(post(body)));
  }
});

test('a wrong or missing secret is refused and nothing is read', async () => {
  let read = false;
  const {handler} = harness({readServed: async () => { read = true; return servedList([]); }});
  assert.equal((await handler(post('{"action":"apply"}', 'wrong'))).status, 403);
  const noSecret = new Request('https://example.test/x', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{"action":"apply"}',
  });
  assert.equal((await handler(noSecret)).status, 403);
  assert.equal(read, false);
});

test('plan refreshes this project\'s copy of the list but applies nothing', async () => {
  const {handler, calls} = harness();
  const body = await (await handler(post('{"action":"plan"}'))).json();
  assert.equal(body.applied, false);
  assert.equal(body.listed, 1);
  assert.equal(body.links, 1);
  assert.deepEqual(body.wouldLink, [{unitKey: 'SPOTTER 236', productId: '1982800', mhelpName: 'Spotter 236HDC2', suffixDiffers: true}]);
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.applied.length, 0);
});

test('apply writes the links and reports the camera rows touched', async () => {
  const {handler, calls} = harness();
  const body = await (await handler(post('{"action":"apply"}'))).json();
  assert.equal(body.applied, true);
  assert.equal(body.unitsLinked, 1);
  assert.equal(body.cameraRowsWritten, 4);
  assert.equal(calls.applied[0][0].productId, '1982800');
});

test('an incomplete list changes nothing', async () => {
  let applied = false;
  const {handler} = harness({
    readServed: async () => servedList([record('1982800', 'Spotter 236HDC2')], {complete: false}),
    applyLinks: async () => { applied = true; return {unitsLinked: 0, cameraRowsWritten: 0}; },
  });
  const response = await handler(post('{"action":"apply"}'));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /incomplete/);
  assert.equal(applied, false);
});

test('a list that cannot be read changes nothing', async () => {
  let saved = false;
  const {handler} = harness({
    readServed: async () => ({contract: 'something-else', records: []}),
    saveFieldList: async () => { saved = true; return 0; },
  });
  assert.equal((await handler(post('{"action":"apply"}'))).status, 503);
  assert.equal(saved, false);
});

test('a served list with a duplicate A# is refused outright', () => {
  assert.throws(() => readServedList(servedList([record('1982800', 'Spotter 236HDC2'), record('1982800', 'Spotter 237HD')])));
});

test('a served record with a bad A# is refused outright', () => {
  assert.throws(() => readServedList(servedList([record('0012800', 'Spotter 236HDC2')])));
  assert.throws(() => readServedList(servedList([record('A#1982800', 'Spotter 236HDC2')])));
});

test('a unit that already has a link is not rewritten', async () => {
  const {handler, calls} = harness({
    readExistingLinks: async () => ({unitKeys: ['SPOTTER 236'], productIds: ['1982800']}),
  });
  const body = await (await handler(post('{"action":"apply"}'))).json();
  assert.equal(body.links, 0);
  assert.equal(body.alreadyLinked, 1);
  assert.deepEqual(calls.applied, [[]]);
});

test('more links than one run writes stops for a person', async () => {
  const units = [], records = [];
  for (let n = 1; n <= APPLY_LIMIT + 1; n += 1) {
    units.push({id: 'SPOTTER ' + n, name: 'SPOTTER ' + n});
    records.push(record(String(1000000 + n), 'Spotter ' + n + 'HD'));
  }
  let applied = false;
  const {handler} = harness({
    readServed: async () => servedList(records),
    readCosUnits: async () => units,
    applyLinks: async () => { applied = true; return {unitsLinked: 0, cameraRowsWritten: 0}; },
  });
  const response = await handler(post('{"action":"apply"}'));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.applied, false);
  assert.equal(body.links, APPLY_LIMIT + 1);
  assert.equal(applied, false);
});

test('a plan is trimmed to what fits in one answer, and says so', () => {
  const units = [], records = [];
  for (let n = 1; n <= 450; n += 1) {
    units.push({id: 'SPOTTER ' + n, name: 'SPOTTER ' + n});
    records.push({id: String(1000000 + n), name: 'Spotter ' + n + 'HD', productId: String(1000000 + n), lifecycle: 'UNFLAGGED'});
  }
  const projected = projectPlan(planUnitAttachments(units, records));
  assert.equal(projected.links, 450);
  assert.equal(projected.wouldLink.length, 400);
  assert.equal(projected.truncated, true);
});

test('a failed write is reported without claiming the links went in', async () => {
  const {handler} = harness({applyLinks: async () => { throw Error('no'); }});
  const response = await handler(post('{"action":"apply"}'));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.applied, false);
  assert.match(body.error, /could not be written/);
});

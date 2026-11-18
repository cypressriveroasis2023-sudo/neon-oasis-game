import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTodayDashboard, summarizeTodayDashboard, dashboardSources } from '../src/todayDashboardData.ts';
import { createBoardReader, createBoardAssignmentSaver, hasConfirmedAssignment } from '../src/boardPersistence.ts';
import { dailyBoardCards, chicagoDay, readinessSummary } from '../src/dailyBoardData.ts';
import { createGpsSaver, checkedFieldMap, GpsSaveUnverifiedError } from '../src/gpsPersistence.ts';
import { gpsCoordinates, gpsWrite, gpsMatches } from '../shared/gpsValidation.ts';
import { validateLocalSchedule } from '../shared/scheduleValidation.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const stamp = '2026-10-04T15:00:00.000Z';
const id = '11111111-1111-4111-8111-111111111111';
const visitId = '22222222-2222-4222-8222-222222222222';
const unitId = '33333333-3333-4333-8333-333333333333';
const board = (jobs = []) => ({ jobs, tasks: [], readiness: [], asOf: stamp });
const job = { id, visitId, technician: 'Casey Service', status: 'scheduled', scheduled: '2026-10-04 08:00', scheduledEnd: '2026-10-04 10:00' };
const expectation = { jobId: id, visitId, technician: 'Casey Service', start: job.scheduled, end: job.scheduledEnd };

test('Today loads independent sources and never invents zero for unavailable information', async t => {
  for (const [failedKey, failedPath] of dashboardSources) {
    await t.test(failedKey + ' failure leaves other sources visible', async () => {
      const seen = [];
      const api = { get: async path => { seen.push(path); if (path === failedPath) throw new Error('Offline'); return { data: { items: [{ id: path, status: 'scheduled' }] } }; } };
      const result = await loadTodayDashboard(api);
      assert.equal(result[failedKey], null);
      assert.equal(Object.keys(result.errors).length, 1);
      assert.equal(seen.length, dashboardSources.length);
      for (const [key] of dashboardSources) if (key !== failedKey) assert.equal(result[key].length, 1);
      const summary = summarizeTodayDashboard(result);
      if (failedKey === 'jobs') { assert.equal(summary.activeJobs, null); assert.equal(summary.inField, null); assert.equal(summary.unscheduled, null); }
      if (failedKey === 'tasks') assert.equal(summary.openTasks, null);
      assert.equal(summary.attention, failedKey === 'tasks' ? 0 : null);
    });
  }
});

test('Today distinguishes malformed records and access failure from an empty verified list', async () => {
  const result = await loadTodayDashboard({ get: async path => {
    if (path === '/api/jobs') return { data: { items: [null] } };
    if (path === '/api/owner-tasks') throw { response: { status: 403 } };
    return { data: { items: [] } };
  } });
  assert.equal(result.jobs, null);
  assert.match(result.errors.tasks, /Owner access/);
  assert.deepEqual(result.quotes, []);
  assert.equal(summarizeTodayDashboard(result).attention, null);
});

test('board reader coalesces background requests and queues a new snapshot after a pending read', async () => {
  const first = defer(), second = defer();
  const reads = [];
  const reader = createBoardReader({ get: path => { reads.push(path); return reads.length === 1 ? first.promise : second.promise; } });
  const background = reader();
  assert.equal(reader(), background);
  const fresh = reader(true);
  await tick();
  assert.equal(reads.length, 1);
  const old = board([{ ...job, technician: 'Previous Service' }]);
  first.resolve({ data: old });
  assert.equal(await background, old);
  await tick();
  assert.equal(reads.length, 2);
  const current = board([job]);
  second.resolve({ data: current });
  assert.equal(await fresh, current);
  assert.equal(hasConfirmedAssignment(await fresh, expectation), true);
  assert.equal(hasConfirmedAssignment(old, expectation), false);
});

test('a rejected background snapshot cannot block the next fresh read', async () => {
  let count = 0;
  const reader = createBoardReader({ get: async () => { if (++count === 1) throw new Error('Read failed'); return { data: board([job]) }; } });
  const old = reader();
  const fresh = reader(true);
  await assert.rejects(old, /Read failed/);
  assert.equal(hasConfirmedAssignment(await fresh, expectation), true);
  assert.equal(count, 2);
});

test('board snapshots require jobs, tasks, readiness and a valid as-of timestamp', async t => {
  for (const bad of [null, {}, { ...board(), asOf: 'not-a-date' }, { ...board(), readiness: null }, { ...board(), jobs: {} }]) {
    await t.test(JSON.stringify(bad), async () => {
      await assert.rejects(createBoardReader({ get: async () => ({ data: bad }) })(), /incomplete response/);
    });
  }
});

test('assignment confirmation checks identity, uniqueness, visit, status, technician and both local times', () => {
  assert.equal(hasConfirmedAssignment(board([job]), expectation), true);
  assert.equal(hasConfirmedAssignment(board([{ ...job, scheduled: '2026-10-04T08:00', scheduledEnd: '2026-10-04T10:00' }]), expectation), true);
  for (const change of [{ id: visitId }, { technician: 'Other Service' }, { visitId: unitId }, { status: 'closed' }, { scheduled: '2026-10-04 09:00' }, { scheduledEnd: '2026-10-04 11:00' }, { completionKind: 'visit' }]) {
    assert.equal(hasConfirmedAssignment(board([{ ...job, ...change }]), expectation), false, JSON.stringify(change));
  }
  assert.equal(hasConfirmedAssignment(board([job, job]), expectation), false);
});

test('assignment writes are exclusive, read back before confirmation, and release the lock', async () => {
  const gate = defer();
  let writes = 0, reads = 0;
  const saver = createBoardAssignmentSaver({ post: async () => { writes++; await gate.promise; } }, async () => { reads++; return board([job]); });
  const pending = saver.save('/api/jobs/' + id + '/schedule', {}, expectation);
  assert.equal(saver.busy, true);
  assert.deepEqual(await saver.save('/api/jobs/' + id + '/schedule', {}, expectation), { status: 'busy' });
  assert.equal(writes, 1); assert.equal(reads, 0);
  gate.resolve();
  assert.equal((await pending).status, 'confirmed');
  assert.equal(reads, 1); assert.equal(saver.busy, false);
});

test('uncertain assignment write is not replayed and is never reported as confirmed', async () => {
  let writes = 0, reads = 0;
  const saver = createBoardAssignmentSaver({ post: async () => { writes++; throw new Error('Connection lost after request'); } }, async () => { reads++; return board([job]); });
  const result = await saver.save('/api/jobs/' + id + '/schedule', {}, expectation);
  assert.equal(result.status, 'unconfirmed');
  assert.match(result.message, /Refresh the board/);
  assert.equal(writes, 1); assert.equal(reads, 0); assert.equal(saver.busy, false);
  assert.equal(saver.needsRefresh, true);
  assert.deepEqual(await saver.save('/api/jobs/' + id + '/schedule', {}, expectation), { status: 'refresh_required' });
  assert.throws(() => saver.acknowledgeRefresh({}), /incomplete response/);
  assert.equal(saver.needsRefresh, true);
  assert.equal(writes, 1);
  saver.acknowledgeRefresh(board([job]));
  assert.equal(saver.needsRefresh, false);
  await saver.save('/api/jobs/' + id + '/schedule', {}, expectation);
  assert.equal(writes, 2);
});

test('accepted assignment with failed or mismatched readback remains accepted but unverified', async t => {
  for (const readFresh of [async () => { throw new Error('Offline'); }, async () => board([{ ...job, technician: 'Other Service' }])]) {
    await t.test('unverified readback', async () => {
      let writes = 0;
      const saver = createBoardAssignmentSaver({ post: async () => { writes++; } }, readFresh);
      const result = await saver.save('/api/jobs/' + id + '/schedule', {}, expectation);
      assert.equal(result.status, 'accepted_unverified'); assert.equal(writes, 1); assert.equal(saver.busy, false);
      assert.equal(saver.needsRefresh, true);
      assert.deepEqual(await saver.save('/api/jobs/' + id + '/schedule', {}, expectation), { status: 'refresh_required' });
      assert.equal(writes, 1);
    });
  }
});

test('schedule validation handles calendar bounds and keeps DST wall-clock values unchanged', () => {
  for (const [start, end] of [
    ['2026-02-29 08:00', '2026-02-29 10:00'],
    ['2026-04-31 08:00', '2026-05-01 10:00'],
    ['2026-10-04 24:00', '2026-10-05 01:00'],
    ['2026-10-04 08:60', '2026-10-04 10:00'],
    ['2026-10-04 10:00', '2026-10-04 10:00'],
    ['2026-10-04 12:00', '2026-10-04 10:00'],
    ['2026-10-04T08:00Z', '2026-10-04T10:00Z'],
  ]) assert.equal(validateLocalSchedule(start, end).valid, false);
  for (const [start, end] of [
    ['2028-02-29T08:00', '2028-02-29T10:00'],
    ['2026-03-08 01:30', '2026-03-08 03:30'],
    ['2026-11-01 01:30', '2026-11-01 02:30'],
    ['2026-12-31 23:00', '2027-01-01 01:00'],
  ]) assert.deepEqual(validateLocalSchedule(start, end), { valid: true, start: start.replace('T', ' '), end: end.replace('T', ' ') });
  assert.deepEqual(validateLocalSchedule('', null, true), { valid: true, start: null, end: null });
  assert.equal(validateLocalSchedule('', '2026-10-04 10:00', true).valid, false);
});

test('Chicago board day respects the local boundary on both sides of DST', () => {
  assert.equal(chicagoDay('2026-03-08T05:59:00Z'), '2026-03-07');
  assert.equal(chicagoDay('2026-03-08T06:00:00Z'), '2026-03-08');
  assert.equal(chicagoDay('2026-11-01T04:59:00Z'), '2026-10-31');
  assert.equal(chicagoDay('2026-11-01T05:00:00Z'), '2026-11-01');
  const records = [
    { id: 'overdue', customer: 'North Site', status: 'scheduled', scheduled: '2026-10-03 08:00' },
    { id: 'tomorrow', customer: 'West Site', status: 'scheduled', scheduled: '2026-10-05 08:00' },
    { id: 'closed-yesterday', customer: 'East Site', status: 'closed', closedAt: '2026-10-03T18:00:00Z' },
    { id: 'closed-today', customer: 'South Site', status: 'closed', closedAt: stamp },
  ];
  const day = dailyBoardCards(records, [], new Date(stamp));
  assert.deepEqual(day.map(row => row.id).sort(), ['job:closed-today', 'job:overdue']);
  assert.equal(day.find(row => row.id === 'job:overdue').lane, 'attention');
  assert.equal(dailyBoardCards(records, [], new Date(stamp), 'week').some(row => row.id === 'job:tomorrow'), true);
});

test('readiness distinguishes missing and incomplete records from verified truck inventory', () => {
  assert.equal(readinessSummary({ userId: id, name: 'Casey Service', department: 'service', status: '', result: {} }).inventory.state, 'pending');
  assert.equal(readinessSummary({ userId: id, name: 'Casey Service', department: 'service', checkId: visitId, status: 'completed', result: {} }).inventory.state, 'attention');
  assert.equal(readinessSummary({ userId: id, name: 'Casey Service', department: 'service', checkId: visitId, status: 'completed', result: { truck_12v_110ah_qty: 4, truck_litime_12v_100ah_qty: 2, truck_12v_110ah_charged: true, truck_litime_12v_100ah_charged: true, backup_unit_type: 'Sniper', taking_trailer: false } }).inventory.state, 'good');
});

const gps = { latitude: 29.7604, longitude: -95.3698, accuracyM: null, source: 'manual', note: 'Gate' };
const fieldSnapshot = (change = {}) => ({
  items: [{ id: unitId, unitNumber: 'UI-SN-001', status: 'installed', latitude: gps.latitude, longitude: gps.longitude, gpsAccuracyM: gps.accuracyM, coordinateSource: gps.source, gpsRecordedAt: stamp, hasUnitGps: true, ...change }],
  summary: { fieldUnits: 1, mappedUnits: 1, unitGps: 1, missingGps: 0 }, generatedAt: stamp,
});

test('GPS validates bounds, numeric body types, optional accuracy, source and unsupported keys', () => {
  assert.deepEqual(gpsCoordinates({ latitude: -90, longitude: 180 }), { latitude: -90, longitude: 180, accuracyM: null });
  assert.throws(() => gpsCoordinates({ latitude: '29.7604', longitude: '-95.3698' }), /finite number/);
  assert.deepEqual(gpsWrite({ latitude: '29.7604', longitude: '-95.3698', accuracyM: '', source: ' MANUAL ' }, 'owner', true), { ...gps, note: null });
  for (const input of [{ ...gps, latitude: 90.1 }, { ...gps, longitude: -180.1 }, { ...gps, accuracyM: -1 }, { ...gps, latitude: Infinity }, { ...gps, source: 'unknown' }, { ...gps, status: 'installed' }, { ...gps, note: 'x'.repeat(4001) }]) assert.throws(() => gpsWrite(input, 'owner'));
  assert.throws(() => gpsWrite(gps, 'technician'), /unsupported fields/);
  assert.equal(gpsMatches({ ...gps, latitude: gps.latitude + 0.0000004 }, gps), true);
  assert.equal(gpsMatches({ ...gps, latitude: gps.latitude + 0.000001 }, gps), false);
});

test('Field Map rejects inconsistent identity, counts and timestamps before display', () => {
  assert.equal(checkedFieldMap(fieldSnapshot()).items.length, 1);
  for (const bad of [{ ...fieldSnapshot(), generatedAt: 'bad' }, { ...fieldSnapshot(), summary: { fieldUnits: 2, mappedUnits: 1, unitGps: 1, missingGps: 0 } }, { ...fieldSnapshot(), items: [fieldSnapshot().items[0], fieldSnapshot().items[0]] }, fieldSnapshot({ id: 'not-a-uuid' })]) assert.throws(() => checkedFieldMap(bad));
});

test('owner GPS sends one write, verifies persisted coordinates and rejects concurrent writes', async () => {
  const gate = defer();
  let writes = 0, reads = 0;
  const saver = createGpsSaver({ post: async (path, body) => { writes++; assert.equal(path, '/api/field-map/' + unitId + '/gps'); assert.deepEqual(body, gps); await gate.promise; return { data: { id: unitId, ...gps, recordedAt: stamp } }; }, get: async () => { reads++; return { data: fieldSnapshot() }; } });
  const pending = saver.owner(unitId, gps);
  await assert.rejects(saver.owner(unitId, gps), /already in progress/);
  assert.equal(writes, 1);
  saver.acknowledgeRefresh(fieldSnapshot());
  gate.resolve();
  assert.equal((await pending).items[0].id, unitId);
  assert.equal(reads, 1); assert.equal(writes, 1);
});

test('owner GPS never retries writes when outcome or readback is uncertain', async t => {
  const variants = [
    { post: async () => { throw new Error('Network failed'); }, get: async () => ({ data: fieldSnapshot() }) },
    { post: async () => ({ data: { id: unitId, ...gps, recordedAt: stamp } }), get: async () => { throw new Error('Read failed'); } },
    { post: async () => ({ data: { id: unitId, ...gps, recordedAt: stamp } }), get: async () => ({ data: fieldSnapshot({ latitude: 30 }) }) },
    { post: async () => ({ data: { id: unitId, ...gps, recordedAt: stamp } }), get: async () => ({ data: fieldSnapshot({ coordinateSource: 'site' }) }) },
  ];
  for (const variant of variants) await t.test('unverified save', async () => {
    let writes = 0;
    const saver = createGpsSaver({ ...variant, post: async (...args) => { writes++; return variant.post(...args); } });
    await assert.rejects(saver.owner(unitId, gps), error => error instanceof GpsSaveUnverifiedError && error.mayHaveSaved === true);
    assert.equal(writes, 1);
    assert.equal(saver.needsRefresh, true);
    await assert.rejects(saver.owner(unitId, gps), /Refresh the Field Map/);
    assert.equal(writes, 1);
    assert.throws(() => saver.acknowledgeRefresh({}), /incomplete response/);
    assert.equal(saver.needsRefresh, true);
    saver.acknowledgeRefresh(fieldSnapshot());
    assert.equal(saver.needsRefresh, false);
    await assert.rejects(saver.owner(unitId, gps), GpsSaveUnverifiedError);
    assert.equal(writes, 2);
  });
});

test('invalid owner GPS is rejected before the API is called', async () => {
  let writes = 0;
  const saver = createGpsSaver({ post: async () => { writes++; return { data: {} }; }, get: async () => ({ data: fieldSnapshot() }) });
  await assert.rejects(saver.owner('not-a-uuid', gps), /valid unit/);
  await assert.rejects(saver.owner(unitId, { ...gps, latitude: 91 }), /between/);
  assert.equal(writes, 0);
  assert.equal(saver.needsRefresh, false);
});

test('technician GPS confirms assigned job and visit and never accepts another visit readback', async () => {
  const input = { latitude: gps.latitude, longitude: gps.longitude, accuracyM: 5, note: 'Phone reading' };
  const result = { ...input, jobId: id, unitId, visitId, source: 'phone_gps', recordedAt: stamp, saved: true, dispatchStatus: 'accepted' };
  let writes = 0;
  const saver = createGpsSaver({ post: async (_path, body) => { writes++; assert.deepEqual(body, input); return { data: result }; }, get: async () => ({ data: { ...result, visitId: unitId } }) });
  await assert.rejects(saver.technician(id, unitId, visitId, input), GpsSaveUnverifiedError);
  assert.equal(writes, 1);
});

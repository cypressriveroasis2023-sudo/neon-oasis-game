import test from 'node:test';
import assert from 'node:assert/strict';
import {readPlacementCustomer, customerRetryDelay, waitForCustomerRetry, createCustomerReadDiagnostics, createCustomerReadGate} from '../../supabase/functions/cos-mhelp-placement-sync/customerRead.ts';
import {collectPlacementObservations} from '../../supabase/functions/cos-mhelp-placement-sync/index.ts';

const record = {customerId: '2', portalId: '224643', name: 'Example Builder', isServiceLocation: false};
const ok = (row = record) => Response.json(row);
function reader(sequence, overrides = {}) {
  const calls = [], delays = [];
  const options = {
    accessToken: 'synthetic-token', portalId: '224643', signal: new AbortController().signal,
    readJson: response => response.json(), pause: async delay => { delays.push(delay); return true; },
    fetch: async (url, init) => {
      calls.push({url, init});
      const value = sequence.shift();
      if (value instanceof Error) throw value;
      if (!value) throw new Error('Unexpected third attempt');
      return value;
    }, ...overrides,
  };
  return {calls, delays, read: () => readPlacementCustomer('2', options)};
}

test('a transient customer failure retries one fixed GET and projects only verified fields', async () => {
  const r = reader([new Response('private provider error', {status: 503}), ok()]);
  assert.deepEqual(await r.read(), {customerId: '2', name: 'Example Builder', isServiceLocation: false, placement: 'FIELD'});
  assert.equal(r.calls.length, 2); assert.deepEqual(r.delays, [500]);
  for (const {url, init} of r.calls) {
    assert.equal(url, 'https://connect.mhelpdesk.com/api/v1.0/portal/224643/customers/2?fields=customerId,portalId,name,isServiceLocation');
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    assert.equal(init.headers.Authorization, 'Bearer synthetic-token'); assert.ok(init.signal instanceof AbortSignal);
  }
});

test('a transport failure can recover, while repeated failures stop after two attempts', async () => {
  const recovered = reader([new Error('private transport detail'), ok()]);
  assert.equal((await recovered.read()).customerId, '2'); assert.equal(recovered.calls.length, 2);
  for (const status of [408, 429, 500, 502, 503, 504]) {
    const held = reader([new Response(null, {status}), new Response(null, {status}), ok()]);
    assert.equal(await held.read(), null); assert.equal(held.calls.length, 2); assert.deepEqual(held.delays, [500]);
  }
});

test('batch diagnostics distinguish failures and recovery without retaining provider secrets or record data', async () => {
  const diagnostics = createCustomerReadDiagnostics();
  const overrides = {onAttempt: diagnostics.record};
  await reader([new Response('private provider body', {status: 429}), ok()], overrides).read();
  await reader([new Error('private exception with bearer token'), new Response(null, {status: 401})], overrides).read();
  await reader([new Response('private malformed body')], overrides).read();
  await reader([ok({...record, portalId: '9'})], overrides).read();
  assert.deepEqual(diagnostics.snapshot(), {attempts: 6, verified: 1, failures: {
    http_429: 1, transport: 1, http_401: 1, response_unreadable: 1, identity_unverified: 1,
  }, rateLimitDelays: {unspecified: 1}});
  const snapshot = diagnostics.snapshot(); snapshot.failures.http_401 = 999;
  assert.equal(diagnostics.snapshot().failures.http_401, 1);
  assert.doesNotMatch(JSON.stringify(diagnostics.snapshot()), /private|synthetic-token|Example Builder|customerId/);
});

test('authorization, missing records and unsupported responses are held without retries', async () => {
  for (const status of [400, 401, 403, 404, 422, 501]) {
    const r = reader([new Response(null, {status}), ok()]);
    assert.equal(await r.read(), null); assert.equal(r.calls.length, 1); assert.deepEqual(r.delays, []);
  }
  for (const row of [{...record, customerId: '3'}, {...record, portalId: '1'}, {...record, isServiceLocation: null}]) {
    const r = reader([ok(row), ok()]); assert.equal(await r.read(), null); assert.equal(r.calls.length, 1);
  }
  const malformed = reader([new Response('{bad json'), ok()]);
  assert.equal(await malformed.read(), null); assert.equal(malformed.calls.length, 1);
  const wrongPortal = reader([ok()], {portalId: '1'});
  assert.equal(await wrongPortal.read(), null); assert.equal(wrongPortal.calls.length, 0);
});

test('Retry-After is honored and longer vendor cooldowns hold for a later run', async () => {
  const now = Date.parse('2026-10-12T21:00:00Z');
  assert.equal(customerRetryDelay('1', now), 1000);
  assert.equal(customerRetryDelay('Mon, 12 Oct 2026 21:00:02 GMT', now), 2000);
  assert.equal(customerRetryDelay('60', now), null); assert.equal(customerRetryDelay('invalid', now), 500);
  const r = reader([new Response(null, {status: 429, headers: {'Retry-After': '1'}}), ok()]);
  assert.ok(await r.read()); assert.deepEqual(r.delays, [1000]);
  const cooldown = reader([new Response(null, {status: 429, headers: {'Retry-After': '60'}}), ok()]);
  assert.equal(await cooldown.read(), null); assert.equal(cooldown.calls.length, 1); assert.deepEqual(cooldown.delays, []);
});

test('the shared run deadline stops reads and retry waits, including an abort during readback', async () => {
  const controller = new AbortController(); controller.abort();
  const stopped = reader([ok()], {signal: controller.signal});
  assert.equal(await stopped.read(), null); assert.equal(stopped.calls.length, 0);
  const waiting = new AbortController();
  const r = reader([new Response(null, {status: 503}), ok()], {
    signal: waiting.signal, pause: async () => {waiting.abort(); return false;},
  });
  assert.equal(await r.read(), null); assert.equal(r.calls.length, 1);
  const reading = new AbortController();
  const late = reader([ok()], {signal: reading.signal, readJson: async response => {reading.abort(); return response.json();}});
  assert.equal(await late.read(), null); assert.equal(late.calls.length, 1);
  const delay = new AbortController(), wait = waitForCustomerRetry(10000, delay.signal);
  delay.abort(); assert.equal(await wait, false);
  assert.equal(await waitForCustomerRetry(0, new AbortController().signal), true);
});

test('retries stay inside three source workers and cannot verify a field assignment without a service location', async () => {
  let active = 0, maximum = 0; const attempts = new Map();
  const links = Array.from({length: 8}, (_, i) => ({equipmentId: String(i + 1), fullLabel: 'Unit ' + i, model: null}));
  const equipment = links.map((l, i) => ({...l, name: l.fullLabel, active: null, customerId: String(100 + i), serviceLocationId: String(200 + i)}));
  const observations = await collectPlacementObservations(links, equipment, id => readPlacementCustomer(id, {
    accessToken: 'synthetic-token', portalId: '224643', signal: new AbortController().signal,
    readJson: response => response.json(), pause: async () => true,
    fetch: async () => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      const count = (attempts.get(id) ?? 0) + 1; attempts.set(id, count);
      if (count === 1 || id === '200') return new Response(null, {status: 503});
      return ok({...record, customerId: id, name: 'Synthetic ' + id, isServiceLocation: Number(id) >= 200});
    },
  }));
  assert.ok(maximum <= 3); assert.ok([...attempts.values()].every(value => value === 2));
  assert.equal(observations.filter(o => o.state === 'confirmed').length, 7);
  assert.equal(observations.find(o => o.equipmentId === '1').reason, 'service_location_unverified');
});

test('all batch workers and retries share spaced starts and a rate-limit cooldown', async () => {
  let time = 0, tickScheduled = false;
  const waits = [], starts = [], attempts = new Map(), diagnostics = createCustomerReadDiagnostics();
  const pause = milliseconds => new Promise(resolve => {
    waits.push({at: time + milliseconds, resolve});
    if (!tickScheduled) {
      tickScheduled = true;
      setImmediate(() => {
        tickScheduled = false;
        time = Math.min(...waits.map(w => w.at));
        for (let i = waits.length - 1; i >= 0; i--) if (waits[i].at <= time) waits.splice(i, 1)[0].resolve(true);
      });
    }
  });
  const signal = new AbortController().signal, gate = createCustomerReadGate({signal, now: () => time, pause});
  const links = Array.from({length: 6}, (_, i) => ({equipmentId: String(i + 1), fullLabel: 'Synthetic Unit ' + i, model: null}));
  const equipment = links.map((l, i) => ({...l, name: l.fullLabel, active: true, customerId: String(100 + i), serviceLocationId: String(200 + i)}));
  const observations = await collectPlacementObservations(links, equipment, id => readPlacementCustomer(id, {
    accessToken: 'synthetic-token', portalId: '224643', signal, pause, now: () => time,
    readJson: response => response.json(), beforeAttempt: gate.acquire, onRateLimit: gate.rateLimited, onAttempt: diagnostics.record,
    fetch: async () => {
      starts.push(time); const count = (attempts.get(id) ?? 0) + 1; attempts.set(id, count);
      if (starts.length === 1) return new Response(null, {status: 429, headers: {'Retry-After': '1'}});
      return ok({...record, customerId: id, isServiceLocation: Number(id) >= 200});
    },
  }));
  assert.equal(observations.filter(o => o.state === 'confirmed').length, 6);
  assert.equal(starts.length, 13); assert.ok(starts[1] >= 2000);
  assert.ok(starts.slice(1).every((start, i) => start - starts[i] >= 400));
  assert.deepEqual(diagnostics.snapshot(), {attempts: 13, verified: 12, failures: {http_429: 1}, rateLimitDelays: {'1000': 1}});
});

test('a long vendor cooldown stops fresh workers, and abort stops queued starts', async () => {
  const signal = new AbortController().signal, gate = createCustomerReadGate({signal});
  const r = reader([new Response(null, {status: 429, headers: {'Retry-After': '60'}}), ok()], {
    beforeAttempt: gate.acquire, onRateLimit: gate.rateLimited,
  });
  assert.equal(await r.read(), null); assert.equal(r.calls.length, 1); assert.equal(await gate.acquire(), false);
  const controller = new AbortController(), stopped = createCustomerReadGate({signal: controller.signal});
  assert.equal(await stopped.acquire(), true);
  const waiting = stopped.acquire(); controller.abort();
  assert.equal(await waiting, false); assert.equal(await stopped.acquire(), false);
});

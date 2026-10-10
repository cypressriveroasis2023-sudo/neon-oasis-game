import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the exact production module in an isolated browser-shaped context.
// All tokens, responses and timers are synthetic; no network is available here.
const source = ts.transpileModule(readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const flush = () => setImmediate();
const status = expected => error => error?.response?.status === expected;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture({ mode = '', role = 'owner', token = 'synthetic-session-a', autoReply = true } = {}) {
  const invalidations=[], listeners = new Set(), timers = new Map(), requests = [], handshakes = [];
  const location = { origin: 'https://synthetic.example', search: mode ? '?mode=' + mode : '' };
  let timerId = 0, requestId = 0;
  const state = { role, token, autoReply };
  const parent = { postMessage(message, origin) {
    assert.equal(origin, location.origin);
    handshakes.push(message);
    if (state.autoReply) {
      const credentials = { role: state.role, accessToken: state.token };
      queueMicrotask(() => reply(message, credentials));
    }
  } };
  const window = {
    parent,
    dispatchEvent(event){invalidations.push(event.type);return true;},
    addEventListener(type, fn) { assert.equal(type, 'message'); listeners.add(fn); },
    removeEventListener(type, fn) { assert.equal(type, 'message'); listeners.delete(fn); },
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  function reply(message = handshakes.at(-1), credentials = { role: state.role, accessToken: state.token }, event = {}) {
    for (const listener of [...listeners]) listener({
      origin: location.origin, source: parent,
      data: { type: 'COS_OPERATIONS_TOKEN_RESPONSE', requestId: message.requestId, ...credentials },
      ...event,
    });
  }
  const exports = {};
  vm.runInNewContext(source, {
    exports, window, location, URLSearchParams, AbortController, Event,
    crypto: { randomUUID: () => 'synthetic-request-' + ++requestId },
    fetch(url, init) {
      assert.equal(url, 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages');
      const result = deferred();
      init.signal.addEventListener('abort', () => result.reject(new Error('Synthetic aborted request')), { once: true });
      requests.push({ url, init, envelope: JSON.parse(init.body), result });
      return result.promise;
    },
  }, { filename: 'api.ts' });
  return {
    api: exports.api, invalidations, requests, handshakes, state, location, window, timers, listeners, reply,
    answer(index, data = { items: [] }, responseStatus = 200) {
      requests[index].result.resolve(new Response(JSON.stringify(data), { status: responseStatus }));
    },
    expire(delay) {
      for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.fn(); }
    },
  };
}

test('identical safe reads share only their complete in-flight response, then refresh freshly', async () => {
  const f = fixture();
  const first = f.api.get('/api/jobs'), second = f.api.get('/api/jobs');
  await flush();
  assert.equal(f.requests.length, 1);
  assert.equal(f.handshakes.length, 1, 'only the already-pending parent handshake is shared');
  const parse = deferred();
  f.requests[0].result.resolve({ ok: true, status: 200, json: () => parse.promise });
  await flush();
  const third = f.api.get('/api/jobs');
  await flush();
  assert.equal(f.handshakes.length, 2, 'a later caller rechecks the current parent session');
  assert.equal(f.requests.length, 1, 'the read stays pending through JSON parsing');
  parse.resolve({ items: [{ id: 'synthetic-job-a' }] });
  const results = await Promise.all([first, second, third]);
  for (const result of results) assert.deepEqual(result.data, { items: [{ id: 'synthetic-job-a' }] });
  assert.equal(f.timers.size, 0);
  const refresh = f.api.get('/api/jobs');
  await flush();
  assert.equal(f.handshakes.length, 3);
  assert.equal(f.requests.length, 2, 'settled values are never cached');
  f.answer(1, { items: [{ id: 'synthetic-job-b' }] });
  assert.equal((await refresh).data.items[0].id, 'synthetic-job-b');
  for (const { init, envelope } of f.requests) {
    assert.equal(init.method, 'POST');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.headers.Authorization, 'Bearer synthetic-session-a');
    assert.deepEqual(envelope, { path: '/api/jobs', method: 'GET', body: null });
  }
});

test('different paths stay independent while repeated health snapshots coalesce', async () => {
  const f = fixture();
  const reads = ['/api/camera-health/summary-v3', '/api/routers', '/api/camera-health/summary-v3'].map(path => f.api.get(path));
  await flush();
  assert.deepEqual(f.requests.map(r => r.envelope.path), ['/api/camera-health/summary-v3', '/api/routers']);
  f.answer(0, { source: 'synthetic-cameras' });
  f.answer(1, { source: 'synthetic-routers' });
  assert.deepEqual((await Promise.all(reads)).map(r => r.data.source), ['synthetic-cameras', 'synthetic-routers', 'synthetic-cameras']);
});

test('bearer rollover never shares the preceding account or session response', async () => {
  const f = fixture();
  const oldRead = f.api.get('/api/jobs');
  await flush();
  f.state.token = 'synthetic-session-b';
  const newRead = f.api.get('/api/jobs');
  await flush();
  assert.equal(f.handshakes.length, 2);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].init.headers.Authorization, 'Bearer synthetic-session-b');
  f.answer(1, { actor: 'synthetic-new-account' });
  f.answer(0, { actor: 'synthetic-old-account' });
  assert.equal((await newRead).data.actor, 'synthetic-new-account');
  assert.equal((await oldRead).data.actor, 'synthetic-old-account');
});

test('technician reads and claim writes retain independent request execution', async () => {
  const f = fixture({ mode: 'production-assignments', role: 'it' });
  const reads = [f.api.get('/api/tech/tasks'), f.api.get('/api/tech/tasks')];
  await flush();
  assert.equal(f.requests.length, 2, 'technician routes are outside the snapshot allowlist');
  f.state.role = 'service';
  reads.push(f.api.get('/api/tech/tasks'));
  await flush();
  assert.equal(f.requests.length, 3, 'a different valid technician role is also independent');
  f.answer(0); f.answer(1); f.answer(2);
  await Promise.all(reads);
  f.state.role = 'it';
  const claim = '/api/tech/it-queue/11111111-1111-4111-8111-111111111111/claim';
  const claims = [f.api.post(claim, {}), f.api.post(claim, {})];
  await flush();
  assert.equal(f.requests.length, 5);
  for (const index of [3, 4]) {
    assert.deepEqual(f.requests[index].envelope, { path: claim, method: 'POST', body: {} });
    f.answer(index);
  }
  await Promise.all(claims);
});

test('mode is part of read identity even with the same valid role, bearer and path', async () => {
  const f = fixture();
  const initial = f.api.get('/api/field-map');
  await flush();
  f.location.search = '?mode=owner';
  const changed = f.api.get('/api/field-map');
  await flush();
  assert.equal(f.requests.length, 2);
  f.answer(0, { view: 'initial' });
  f.answer(1, { view: 'changed' });
  assert.equal((await initial).data.view, 'initial');
  assert.equal((await changed).data.view, 'changed');
});

test('a mode change while parent authorization is pending fails closed', async () => {
  const f = fixture({ autoReply: false });
  const denied = assert.rejects(f.api.get('/api/jobs'), status(401));
  f.location.search = '?mode=production-assignments';
  f.reply(undefined, { role: 'it', accessToken: 'synthetic-it-session' });
  await denied;
  assert.equal(f.requests.length, 0);
  assert.equal(f.timers.size, 0);
});

test('an in-flight read cannot bypass a newly unavailable parent session', async () => {
  const f = fixture();
  const first = f.api.get('/api/jobs');
  await flush();
  for (const [role, token] of [['service', 'synthetic-service'], ['owner', ''], ['owner', '   '], ['owner', null]]) {
    Object.assign(f.state, { role, token });
    await assert.rejects(f.api.get('/api/jobs'), status(401));
    assert.equal(f.requests.length, 1);
  }
  assert.equal(f.handshakes.length, 5);
  f.answer(0);
  await first;
});

test('parent origin, source and request identity are still required before any shared read', async () => {
  const f = fixture();
  const first = f.api.get('/api/jobs');
  await flush();
  f.state.autoReply = false;
  const second = f.api.get('/api/jobs');
  await flush();
  f.reply(undefined, undefined, { origin: 'https://untrusted.example' });
  f.reply(undefined, undefined, { source: {} });
  f.reply({ requestId: 'synthetic-wrong-request' });
  await flush();
  assert.equal(f.listeners.size, 1, 'untrusted responses did not complete authorization');
  assert.equal(f.requests.length, 1);
  f.reply();
  await flush();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.requests.length, 1);
  f.answer(0);
  await Promise.all([first, second]);
});

test('parent timeout is not bypassed by a pending read, and later authorization can retry', async () => {
  const f = fixture();
  const first = f.api.get('/api/jobs');
  await flush();
  f.state.autoReply = false;
  const denied = assert.rejects(f.api.get('/api/jobs'), status(401));
  f.expire(10000);
  await denied;
  assert.equal(f.requests.length, 1);
  f.state.autoReply = true;
  const retry = f.api.get('/api/jobs');
  await flush();
  assert.equal(f.handshakes.length, 3);
  assert.equal(f.requests.length, 1, 'freshly authorized retry can join a still-pending safe read');
  f.answer(0);
  await Promise.all([first, retry]);
});

test('standalone and opaque-origin callers cannot join an authenticated read', async () => {
  const f = fixture();
  const first = f.api.get('/api/jobs');
  await flush();
  const parent = f.window.parent;
  f.window.parent = f.window;
  await assert.rejects(f.api.get('/api/jobs'), status(401));
  f.window.parent = parent;
  f.location.origin = 'null';
  await assert.rejects(f.api.get('/api/jobs'), status(401));
  assert.equal(f.requests.length, 1);
  f.answer(0);
  await first;
});

test('path and assignment-mode guards run before deduplication or network access', async () => {
  const f = fixture({ mode: 'production-assignments', role: 'service' });
  for (const path of ['/api/jobs?actor=other', '/api/jobs#other', '/api/../jobs', 'https://untrusted.example/api/jobs']) {
    await assert.rejects(f.api.get(path), status(400));
  }
  await assert.rejects(f.api.get('/api/jobs'), status(403));
  const claim = '/api/tech/it-queue/11111111-1111-4111-8111-111111111111/claim';
  await assert.rejects(f.api.post(claim, { actorId: 'other' }), status(403));
  assert.equal(f.handshakes.length, 0);
  await assert.rejects(f.api.post(claim, {}), status(403));
  assert.equal(f.handshakes.length, 1);
  assert.equal(f.requests.length, 0);
});

test('unknown and non-opted-in GET routes never acquire deduplication by method alone', async () => {
  const f = fixture();
  const paths = ['/api/new-action', '/api/new-action', '/api/tech/my-day', '/api/tech/my-day', '/api/jobs/', '/api/jobs/'];
  const reads = paths.map(path => f.api.get(path));
  await flush();
  assert.equal(f.requests.length, paths.length);
  f.requests.forEach((_, index) => f.answer(index, { request: index }));
  assert.deepEqual((await Promise.all(reads)).map(r => r.data.request), paths.map((_, index) => index));
});

for (const failure of ['HTTP authorization', 'HTTP unavailable', 'network', 'incomplete JSON', 'timeout']) {
  test(`${failure} failures reject all shared callers, evict the entry, and never replay automatically`, async () => {
    const f = fixture();
    const readA = f.api.get('/api/jobs'), readB = f.api.get('/api/jobs');
    const rejected = Promise.all([readA, readB].map(read => assert.rejects(read, status(failure === 'HTTP authorization' ? 403 : failure === 'incomplete JSON' ? 200 : 503))));
    await flush();
    assert.equal(f.requests.length, 1);
    if (failure === 'HTTP authorization') f.answer(0, { error: 'Synthetic access revoked' }, 403);
    if (failure === 'HTTP unavailable') f.answer(0, { error: 'Synthetic source unavailable' }, 503);
    if (failure === 'network') f.requests[0].result.reject(new Error('Synthetic connection failure'));
    if (failure === 'incomplete JSON') f.requests[0].result.resolve(new Response('{incomplete', { status: 200 }));
    if (failure === 'timeout') f.expire(30000);
    await rejected;
    await flush();
    assert.equal(f.requests.length, 1, 'no automatic request replay');
    assert.equal(f.timers.size, 0);
    const retry = f.api.get('/api/jobs');
    await flush();
    assert.equal(f.requests.length, 2);
    f.answer(1, { items: [{ id: 'synthetic-recovered-job' }] });
    assert.equal((await retry).data.items[0].id, 'synthetic-recovered-job');
  });
}

test('POST operations remain independent, preserve their bodies, and never replay on uncertainty', async () => {
  const f = fixture();
  const body = { title: 'Synthetic owner task', assignedDepartment: 'it' };
  const saves = [f.api.post('/api/owner-tasks', body), f.api.post('/api/owner-tasks', body)];
  const denied = Promise.all(saves.map(save => assert.rejects(save, /save could not be confirmed/)));
  await flush();
  assert.equal(f.requests.length, 2);
  for (const request of f.requests) {
    assert.deepEqual(request.envelope, { path: '/api/owner-tasks', method: 'POST', body });
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.cache, 'no-store');
    request.result.reject(new Error('Synthetic uncertain save'));
  }
  await denied;
  await flush();
  assert.equal(f.requests.length, 2);
  assert.equal(f.timers.size, 0);
});

for (const saveFails of [false, true]) {
  test(`reads before or during a ${saveFails ? 'failed' : 'successful'} save cannot satisfy its fresh readback`, async () => {
    const f = fixture();
    const before = f.api.get('/api/owner-tasks');
    await flush();
    const save = f.api.post('/api/owner-tasks', { title: 'Synthetic task' });
    const saveResult = saveFails ? assert.rejects(save, status(503)) : save;
    await flush();
    const during = f.api.get('/api/owner-tasks');
    await flush();
    assert.equal(f.requests.length, 3, 'save start removes pre-save reads from the lookup');
    if (saveFails) f.requests[1].result.reject(new Error('Synthetic uncertain save'));
    else f.answer(1, { saved: true });
    await saveResult;
    const after = f.api.get('/api/owner-tasks');
    await flush();
    assert.equal(f.requests.length, 4, 'save settlement also removes reads started during the save');
    f.answer(0, { stage: 'before' });
    f.answer(2, { stage: 'during' });
    await Promise.all([before, during]);
    const afterAgain = f.api.get('/api/owner-tasks');
    await flush();
    assert.equal(f.requests.length, 4, 'old read cleanup cannot remove a newer pending entry');
    f.answer(3, { stage: 'after' });
    assert.equal((await after).data.stage, 'after');
    assert.equal((await afterAgain).data.stage, 'after');
  });
}

test('dynamic Victron snapshots share pending reads but explicit fleet discovery never does', async () => {
 const f=fixture();
 const cached=[f.api.get('/api/vrm-fleet'),f.api.get('/api/vrm-fleet')];
 await flush();assert.equal(f.requests.length,1);
 const discovery=[f.api.get('/api/vrm-fleet/refresh'),f.api.get('/api/vrm-fleet/refresh')];
 await flush();
 assert.deepEqual(f.requests.map(request=>request.envelope.path),['/api/vrm-fleet','/api/vrm-fleet/refresh','/api/vrm-fleet/refresh']);
 f.requests.forEach((_,index)=>f.answer(index,{synthetic:index}));
 assert.deepEqual((await Promise.all([...cached,...discovery])).map(result=>result.data.synthetic),[0,0,1,2]);
 const later=f.api.get('/api/vrm-fleet');await flush();assert.equal(f.requests.length,4);f.answer(3);await later;
});


test('legacy Victron snapshots retain separate same-session deduplication', async () => {
 const f=fixture();
 const reads=[f.api.get('/api/vrm-portal'),f.api.get('/api/vrm-portal'),f.api.get('/api/vrm-fleet')];
 await flush();assert.deepEqual(f.requests.map(request=>request.envelope.path),['/api/vrm-portal','/api/vrm-fleet']);
 f.answer(0,{source:'legacy'});f.answer(1,{source:'dynamic'});
 assert.deepEqual((await Promise.all(reads)).map(result=>result.data.source),['legacy','legacy','dynamic']);
});


test('pending schedule opt-in is the only allowed query path and never shares status reads',async()=>{
 const path='/api/mhelpdesk/intake/status?capability=pending_schedule_v1',f=fixture();
 const first=f.api.get(path),second=f.api.get(path);await flush();assert.equal(f.requests.length,2);
 for(const entry of f.requests)assert.deepEqual(entry.envelope,{path,method:'GET',body:null});
 f.answer(0,{saved:true});f.answer(1,{saved:true});await Promise.all([first,second]);
 for(const invalid of ['/api/jobs?capability=pending_schedule_v1','/api/mhelpdesk/intake/status?capability=other',path+'&portalId=17',path+'&capability=pending_schedule_v1',path+'#ignored','/api/mhelpdesk/intake/status?evidenceCapability=pending_schedule_v1'])await assert.rejects(f.api.get(invalid),status(400));
 await assert.rejects(f.api.post(path,{}),status(400));assert.equal(f.requests.length,2);
 const tech=fixture({mode:'production-assignments',role:'it'});await assert.rejects(tech.api.get(path),status(403));assert.equal(tech.requests.length,0);assert.equal(tech.handshakes.length,0);
});

test('explicit private read cancellation prevents a late handshake from starting transport',async()=>{
 const f=fixture({autoReply:false}),controller=new AbortController();
 const pending=f.api.post('/api/mhelpdesk/partner/tickets/preview',{evidence:'ticket_private_sample_v1'}, {signal:controller.signal});
 const rejected=assert.rejects(pending,status(499));controller.abort();f.reply();await rejected;assert.equal(f.requests.length,0);
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(f.api.post('/api/mhelpdesk/partner/tickets/preview',{}, {signal:cancelled.signal}),status(499));assert.equal(f.handshakes.length,1);
});
test('private read abort cancels only its own transport and does not share or replay results',async()=>{
 const f=fixture(),controller=new AbortController(),pending=f.api.post('/api/mhelpdesk/partner/tickets/preview',{}, {signal:controller.signal});await flush();
 const other=f.api.get('/api/jobs');await flush();assert.equal(f.requests.length,2);
 const rejected=assert.rejects(pending,status(503));controller.abort();await rejected;assert(f.requests[0].init.signal.aborted);assert(!f.requests[1].init.signal.aborted);
 f.answer(1);await other;assert.equal(f.requests.length,2);assert.equal(f.timers.size,0);
});

test('observed session and HTTP auth failures invalidate private views without source data',async()=>{
 const denied=fixture(),read=denied.api.get('/api/jobs');await flush();denied.answer(0,{error:'private'},403);await assert.rejects(read,status(403));assert.deepEqual(denied.invalidations,['cos-private-data-invalidated']);
 const expired=fixture({role:'it'});await assert.rejects(expired.api.post('/api/mhelpdesk/partner/tickets/preview',{}),status(401));assert.deepEqual(expired.invalidations,['cos-private-data-invalidated']);assert.equal(expired.requests.length,0);
});
test('verified parent credential changes and malformed auth responses still invalidate private data',async()=>{
 const f=fixture(),first=f.api.get('/api/jobs');await flush();f.answer(0);await first;assert.deepEqual(f.invalidations,[]);
 f.state.token='synthetic-session-b';const second=f.api.get('/api/jobs');await flush();assert.deepEqual(f.invalidations,['cos-private-data-invalidated']);f.answer(1);await second;
 const third=f.api.get('/api/jobs');await flush();f.requests[2].result.resolve({ok:false,status:401,json:async()=>{throw Error('synthetic malformed response');}});await assert.rejects(third,status(401));assert.deepEqual(f.invalidations,['cos-private-data-invalidated','cos-private-data-invalidated']);
});

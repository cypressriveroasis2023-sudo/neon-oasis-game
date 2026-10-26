import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {reconcileFleetSnapshot} from '../src/fleetSnapshot.ts';
import {validateCameraHealth} from '../src/fieldCameraHealth.ts';
import {checkedFieldMap} from '../src/gpsPersistence.ts';
import {createOperationsSessionRecovery} from '../src/operationsSessionRecovery.ts';
import {CAMERA_AUTO_REFRESH_MS} from '../src/refreshCadence.ts';
import {checkedOwnerCensusPreparationBinding} from '../src/ownerCensusPreparation.ts';
import {fixture as preparationSnapshot,id as preparationId} from './owner-census-preparation-fixtures.mjs';

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
  const invalidations=[], listeners = new Set(), otherListeners=new Map(), timers = new Map(), requests = [], handshakes = [];
  const location = { origin: 'https://synthetic.example', search: mode ? '?mode=' + mode : '' };
  let timerId = 0, requestId = 0, clock = 0;
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
    dispatchEvent(event){invalidations.push(event.type);for(const fn of otherListeners.get(event.type)||[])fn(event);return true;},
    addEventListener(type,fn){if(type==='message')listeners.add(fn);else{if(!otherListeners.has(type))otherListeners.set(type,new Set());otherListeners.get(type).add(fn);}},
    removeEventListener(type,fn){if(type==='message')listeners.delete(fn);else otherListeners.get(type)?.delete(fn);},
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay, at: clock + delay }); return timerId; },
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
    Date: class extends Date { static now() { return clock; } },
    require:name=>name==='./fleetSnapshot'?{reconcileFleetSnapshot}:name==='./fieldCameraHealth'?{validateCameraHealth}:name==='./gpsPersistence'?{checkedFieldMap}:name==='./refreshCadence'?{CAMERA_AUTO_REFRESH_MS}:name==='../../it-feature-availability'?{IT_DAILY_ONLY:true}:(()=>{throw Error('Unexpected module '+name);})(),
    crypto: { randomUUID: () => 'synthetic-request-' + ++requestId },
    fetch(url, init) {
      assert.equal(url, 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages');
      const result = deferred();
      init.signal.addEventListener('abort', () => { const error = new Error('Synthetic aborted request'); error.name = 'AbortError'; result.reject(error); }, { once: true });
      requests.push({ url, init, envelope: JSON.parse(init.body), result });
      return result.promise;
    },
  }, { filename: 'api.ts' });
  return {
    api: exports.api, invalidations, requests, handshakes, state, location, window, timers, listeners, reply,
    answer(index, data = { items: [] }, responseStatus = 200) {
      requests[index].result.resolve(new Response(JSON.stringify(data), { status: responseStatus }));
    },
    get elapsed() { return clock; },
    advance(milliseconds) {
      const end = clock + milliseconds;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next; timers.delete(id); clock = timer.at; timer.fn();
      }
      clock = end;
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
  await assert.rejects(oldRead, status(409));
});

test('paused IT assignment reads and claim writes never reach transport; Service reads remain independent', async () => {
  const f = fixture({ mode: 'production-assignments', role: 'it' });
  const claim = '/api/tech/it-queue/11111111-1111-4111-8111-111111111111/claim';
  await Promise.all([assert.rejects(f.api.get('/api/tech/tasks'),status(403)), assert.rejects(f.api.post(claim,{}),status(403))]);
  assert.equal(f.requests.length,0);
  const session=f.api.get('/api/tech/session'); await flush(); f.answer(0); await session;
  f.state.role='service';
  const reads=[f.api.get('/api/tech/tasks'),f.api.get('/api/tech/tasks')]; await flush();
  assert.equal(f.requests.length,3);
  f.answer(1);f.answer(2);await Promise.all(reads);
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
  await assert.rejects(initial, status(409));
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
  await assert.rejects(first,status(409));
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
  assert.equal(f.listeners.size, 2, 'untrusted responses did not complete authorization');
  assert.equal(f.requests.length, 1);
  f.reply();
  await flush();
  assert.equal(f.listeners.size, 1);
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
  assert.equal(f.requests.length, 2, 'authorization interruption invalidates earlier shared entries');
  f.answer(0);f.answer(1);
  await Promise.all([assert.rejects(first,status(409)), retry]);
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
  await assert.rejects(first,status(409));
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

const fleetHealth={totalDevices:0,online:0,offline:0,review:0,shopRoot:0,healthRows:0,fieldDevices:0,refreshedAt:'2026-10-12T18:00:00Z',rows:[],evidenceVersion:2,inventory:{allRecords:0,activeFieldRecords:0,activeShopRecords:0,inactiveRecords:0,unknownScopeRecords:0}};
const fleetMap={items:[],summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0},generatedAt:'2026-10-12T18:00:00Z'};
for(const failedSource of ['health','fieldMap'])for(const peerFails of [false,true])test(`${failedSource} failure is prompt but retains the shared fleet barrier until its peer ${peerFails?'fails':'succeeds'}`,async()=>{
 const f=fixture(),first=f.api.fleet();let pairedError;
 const failed=first.catch(error=>{pairedError=error;});
 await flush();assert.equal(f.requests.length,2);
 const failedIndex=failedSource==='health'?0:1,peerIndex=1-failedIndex,peerSource=failedSource==='health'?'fieldMap':'health';
 f.answer(failedIndex,{error:'Synthetic first source unavailable'},503);await flush();
 assert.equal(pairedError?.response?.status,503,'the pair rejects before the other HTTP response settles');await failed;
 assert.equal(f.requests[peerIndex].init.signal.aborted,false,'a failed pair does not cancel its independently useful peer');
 assert.equal(f.timers.size,1,'the other source remains in flight');
 assert.deepEqual(f.invalidations,['cos-fleet-snapshot-failed']);
 const normal=assert.rejects(f.api.fleet(),status(503)),forced=assert.rejects(f.api.fleet(true),status(503));
 const failedRead=assert.rejects(f.api.fleetSource(failedSource),status(503));
 const peers=[f.api.fleetSource(peerSource),f.api.fleetSource(peerSource,true)];
 let settledPeers=0;
 const outcomes=peers.map(promise=>promise.then(value=>{settledPeers++;return {value};},error=>{settledPeers++;return {error};}));
 await flush();
 assert.equal(settledPeers,0,'source-only callers still await the original peer');
 assert.equal(f.requests.length,2,'normal, forced and source-only reentry must not start another pair');
 await Promise.all([normal,forced,failedRead]);
 assert.equal(f.handshakes.length,2,'later callers still verify the current parent session');
 assert.deepEqual(f.invalidations,['cos-fleet-snapshot-failed'],'reentry does not publish a repeated failure or current snapshot');
 const peerValue=peerSource==='fieldMap'?fleetMap:fleetHealth;
 f.answer(peerIndex,peerFails?{error:'Synthetic peer unavailable'}:peerValue,peerFails?503:200);
 for(const outcome of await Promise.all(outcomes)){
  if(peerFails)assert.equal(outcome.error?.response?.status,503);
  else assert.deepEqual(outcome.value,peerValue,'a valid source-only result survives the paired non-auth failure');
 }
 assert.equal(f.timers.size,0);assert(!f.invalidations.includes('cos-fleet-snapshot-updated'));
 const next=f.api.fleet(),nextPeer=f.api.fleetSource(peerSource,true);await flush();
 assert.equal(f.requests.length,4,'only full settlement releases the barrier, and a failed pair was not cached');
 f.answer(2,fleetHealth);f.answer(3,fleetMap);const current=await next;
 assert.deepEqual(await nextPeer,peerValue);assert.equal(await f.api.fleet(),current);
 assert.equal(f.requests.length,4);assert.equal(f.invalidations.filter(type=>type==='cos-fleet-snapshot-updated').length,1);
});
test('a health timeout keeps a slow map body shared through parsing without caching the partial pair',async()=>{
 const f=fixture(),first=f.api.fleet(),failed=assert.rejects(first,status(503));await flush();
 const body=deferred();f.requests[1].result.resolve({ok:true,status:200,json:()=>body.promise});await flush();
 f.advance(30000);await failed;
 const peer=f.api.fleetSource('fieldMap',true),again=assert.rejects(f.api.fleet(true),status(503));await flush();
 assert.equal(f.requests.length,2,'a timeout must not release a peer whose JSON body is still loading');
 await again;
 assert.equal(f.requests[1].init.signal.aborted,false);f.advance(32000);body.resolve(fleetMap);
 assert.deepEqual(await peer,fleetMap);assert.equal(f.elapsed,62000);assert.equal(f.timers.size,0);
 assert.deepEqual(f.invalidations,['cos-fleet-snapshot-failed']);
 const fresh=f.api.fleet();await flush();assert.equal(f.requests.length,4);f.answer(2,fleetHealth);f.answer(3,fleetMap);await fresh;
});
for(const invalidation of ['private-data','pagehide','parent-hide','save','account','mode'])test(`${invalidation} during a failed fleet pair's peer wait rejects the old source without clearing a newer pending entry`,async()=>{
 const f=fixture(),first=f.api.fleet(),failed=assert.rejects(first,status(503));await flush();
 f.answer(0,{error:'Synthetic first source unavailable'},503);await failed;
 const oldPeer=f.api.fleetSource('fieldMap'),oldRejected=assert.rejects(oldPeer,status(409));await flush();
 assert.equal(f.requests.length,2);
 if(invalidation==='private-data')f.window.dispatchEvent(new Event('cos-private-data-invalidated'));
 else if(invalidation==='pagehide')f.window.dispatchEvent(new Event('pagehide'));
 else if(invalidation==='parent-hide')for(const listener of [...f.listeners])listener({origin:f.location.origin,source:f.window.parent,data:{type:'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'}});
 else if(invalidation==='account')f.state.token='synthetic-session-b';
 else if(invalidation==='mode')f.location.search='?mode=synthetic-other-owner-view';
 else {const save=f.api.post('/api/owner-tasks',{});await flush();f.answer(2,{saved:true});await save;}
 const offset=f.requests.length,next=f.api.fleet();await flush();assert.equal(f.requests.length,offset+2);
 const beforeOldSettlement=[...f.invalidations];f.answer(1,fleetMap);await oldRejected;await flush();
 assert.deepEqual(f.invalidations,beforeOldSettlement,'old cleanup cannot signal a current success or failure');
 const forced=f.api.fleet(true),source=f.api.fleetSource('fieldMap');await flush();
 assert.equal(f.requests.length,offset+2,'the old pair cleanup cannot remove the newer pending entry');
 f.answer(offset,fleetHealth);f.answer(offset+1,fleetMap);
 const current=await next;assert.equal(await forced,current);assert.deepEqual(await source,current.fieldMap);
 assert.equal(await f.api.fleet(),current);assert.equal(f.requests.length,offset+2);
});
test('a verified dashboard source arrives before its slow peer and survives its non-auth failure',async()=>{
 const f=fixture(),field=f.api.fleetSource('fieldMap'),health=f.api.fleetSource('health');const failed=assert.rejects(health,status(503));
 await flush();assert.equal(f.requests.length,2);f.answer(1,fleetMap);assert.deepEqual(await field,fleetMap);
 f.answer(0,{error:'Camera source unavailable'},503);await failed;
 const fresh=f.api.fleet();await flush();assert.equal(f.requests.length,4,'a partial source did not enter the paired cache');
 f.answer(2,fleetHealth);f.answer(3,fleetMap);await fresh;
});
test('source-only fleet completions cannot cross an account change or a save invalidation',async()=>{
 for(const action of ['account','save']){
  const f=fixture(),source=f.api.fleetSource('fieldMap');const denied=assert.rejects(source,status(409));await flush();
  let other;
  if(action==='account'){f.state.token='synthetic-session-b';other=f.api.get('/api/jobs');}
  else other=f.api.post('/api/owner-tasks',{});
  await flush();f.answer(2,{saved:true});await other;f.answer(1,fleetMap);f.answer(0,fleetHealth);await denied;
 }
});
test('fleet consumers share a complete paired snapshot and re-authorize before using its fifteen-minute cache',async()=>{
 const f=fixture(),a=f.api.fleet(),b=f.api.fleet();await flush();assert.deepEqual(f.requests.map(r=>r.envelope.path),['/api/camera-health/summary-v3','/api/field-map']);
 f.answer(0,fleetHealth);f.answer(1,fleetMap);const values=await Promise.all([a,b]);assert.equal(values[0],values[1]);
 const cached=await f.api.fleet();assert.equal(cached,values[0]);assert.equal(f.requests.length,2);assert.equal(f.handshakes.length,2);
 const forced=f.api.fleet(true);await flush();assert.equal(f.requests.length,4);f.answer(2,fleetHealth);f.answer(3,fleetMap);await forced;
 f.state.role='service';await assert.rejects(f.api.fleet(),status(401));
});
test('paired cache expires fifteen minutes from attempt start, including delayed auth and responses',async()=>{
 const f=fixture({autoReply:false}),first=f.api.fleet();
 f.advance(2000);f.reply();await flush();assert.equal(f.requests.length,2);
 f.advance(6000);f.answer(0,fleetHealth);f.answer(1,fleetMap);const initial=await first;
 assert.equal(initial.readStartedAt,0,'client request-start metadata is distinct from response completion');
 f.state.autoReply=true;f.advance(CAMERA_AUTO_REFRESH_MS-8001);
 assert.equal(await f.api.fleet(),initial);assert.equal(f.requests.length,2,'the pair stays cached until the exact deadline');
 f.advance(1);const next=f.api.fleet(),peer=f.api.fleetSource('fieldMap');await flush();
 assert.equal(f.requests.length,4,'completion latency cannot defer the fifteen-minute read');
 f.answer(2,fleetHealth);f.answer(3,fleetMap);const refreshed=await next;assert.equal(await peer,refreshed.fieldMap);assert.notEqual(refreshed,initial);
 assert.equal(refreshed.readStartedAt,CAMERA_AUTO_REFRESH_MS);
});
test('mode and private-data invalidation cannot reuse a cached pair',async()=>{
 const f=fixture(),first=f.api.fleet();await flush();f.answer(0,fleetHealth);f.answer(1,fleetMap);await first;
 f.location.search='?mode=fleet';f.state.role='it';const switched=f.api.fleet();await flush();assert.equal(f.requests.length,4);f.answer(2,fleetHealth);f.answer(3,fleetMap);await switched;
 f.window.dispatchEvent(new Event('cos-private-data-invalidated'));const cleared=f.api.fleet();await flush();assert.equal(f.requests.length,6);f.answer(4,fleetHealth);f.answer(5,fleetMap);await cleared;
});
test('one failed source never installs a partial fleet snapshot and a POST invalidates both halves',async()=>{
 const f=fixture(),a=f.api.fleet();const checked=assert.rejects(a,status(503));await flush();f.answer(0,fleetHealth);f.answer(1,{error:'Map read unavailable'},503);await checked;assert.deepEqual(f.invalidations,['cos-fleet-snapshot-failed']);
 const fresh=f.api.fleet();await flush();assert.equal(f.requests.length,4);f.answer(2,fleetHealth);f.answer(3,fleetMap);await fresh;
 const post=f.api.post('/api/owner-tasks',{});await flush();f.answer(4,{saved:true});await post;
 const next=f.api.fleet();await flush();assert.equal(f.requests.length,7);f.answer(5,fleetHealth);f.answer(6,fleetMap);await next;
});
test('a fleet read started under a previous account is rejected after an account change',async()=>{
 const f=fixture(),old=f.api.fleet();const rejected=assert.rejects(old,status(409));await flush();f.state.token='synthetic-session-b';const current=f.api.fleet();await flush();f.answer(0,fleetHealth);f.answer(1,fleetMap);await rejected;assert(!f.invalidations.includes('cos-fleet-snapshot-failed'),'old-session failures cannot invalidate the new account');f.answer(2,fleetHealth);f.answer(3,fleetMap);await current;
});

const preparedPath='/api/field-map/11111111-1111-4111-8111-111111111111/owner-census-prepare';
for(const [method,path,deadline] of [
 ['POST',preparedPath,120000],['POST',preparedPath.replace('11111111','AAAAAAAA'),120000],
 ['POST',preparedPath.replace('prepare','once'),120000],['GET','/api/field-map',90000],
 ['GET',preparedPath,30000],['POST',preparedPath.replace('prepare','proof'),30000],
 ['POST',preparedPath.replace('prepare','prepare-extra'),30000],['POST',preparedPath+'/',30000],
 ['POST',preparedPath.replace('11111111-1111-4111-8111-111111111111','not-a-uuid'),30000],
 ['POST',preparedPath.replace('prepare','Prepare'),30000],['POST',preparedPath.replace('owner-census-prepare','gps'),30000],
 ['POST','/api/field-map',30000],['GET','/api/jobs',30000],['GET','/api/camera-health/summary-v3',30000],
])test(`bounded observation ${method} ${path} uses only ${deadline}ms`,async()=>{
 const f=fixture(),pending=method==='POST'?f.api.post(path,{}):f.api.get(path);await flush();
 assert.equal(f.requests.length,1);assert.deepEqual([...f.timers.values()].map(t=>t.delay),[deadline]);
 f.answer(0,{ok:true});await pending;assert.equal(f.timers.size,0);
});
test('read-only Prepare accepts a valid response after the old 30-second abort boundary',async()=>{
 const f=fixture(),pending=f.api.post(preparedPath,{}),settled=pending.then(value=>({value}),error=>({error}));await flush();
 const aborts=[];f.requests[0].init.signal.addEventListener('abort',()=>aborts.push(f.elapsed));
 f.advance(30000);await flush();const abortedAtFormerDeadline=f.requests[0].init.signal.aborted;
 f.advance(30000);f.answer(0,{eligible:true});const result=await settled;
 assert.equal(abortedAtFormerDeadline,false,'a valid response arriving at60s must not have been discarded at30s');
 assert.equal(result.error,undefined);assert.deepEqual(result.value.data,{eligible:true});assert.deepEqual(aborts,[]);assert.equal(f.requests.length,1);assert.equal(f.timers.size,0);
});
test('Run observation passes 30s but remains bounded at120s without replay',async()=>{
 const f=fixture(),pending=f.api.post(preparedPath.replace('prepare','once'),{}),failed=assert.rejects(pending,status(503));await flush();
 f.advance(30000);assert.equal(f.requests[0].init.signal.aborted,false);f.advance(89999);assert.equal(f.requests[0].init.signal.aborted,false);
 f.advance(1);await failed;assert.equal(f.elapsed,120000);assert.equal(f.requests.length,1);assert.equal(f.timers.size,0);
});
test('Prepare timeout is the actual120s timer-driven AbortError, not an inferred HTTP failure',async()=>{
 const f=fixture(),pending=f.api.post(preparedPath,{}),failed=assert.rejects(pending,error=>error.preparationFailure==='timeout'&&error.response.status===503);await flush();
 const aborts=[];f.requests[0].init.signal.addEventListener('abort',()=>aborts.push(f.elapsed));
 f.advance(119999);assert.equal(f.requests[0].init.signal.aborted,false);f.advance(1);await failed;
 assert.deepEqual(aborts,[120000]);assert.equal(f.requests.length,1);assert.equal(f.timers.size,0);assert.equal(f.invalidations.length,0);
 f.answer(0,{eligible:true});await flush();assert.equal(f.requests.length,1,'a late success cannot replay the request');
});
for(const [http,category] of [[401,'auth'],[403,'auth'],[409,'source_hold'],[408,'timeout'],[504,'timeout'],[503,'upstream_failure'],[429,'upstream_failure']])test(`Prepare HTTP${http} reports only ${category} and never parses raw backend errors`,async()=>{
 const f=fixture(),pending=f.api.post(preparedPath,{}),failed=assert.rejects(pending,error=>{
  assert.equal(error.preparationFailure,category);assert.equal(error.message.includes('synthetic-private-backend-detail'),false);assert.equal(JSON.stringify(error.response).includes('synthetic-private-backend-detail'),false);return true;
 });await flush();let parsed=0,cancelled=0;
 f.requests[0].result.resolve({ok:false,status:http,body:{cancel:async()=>{cancelled++;}},json:async()=>{parsed++;return {error:'synthetic-private-backend-detail'};}});
 await failed;assert.equal(parsed,0);assert.equal(cancelled,1);assert.equal(f.requests.length,1);assert.equal(f.timers.size,0);
 assert.equal(f.invalidations.length,[401,403].includes(http)?1:0);
});
test('Prepare external cancellation is immediate and distinct from timeout with no replay',async()=>{
 const f=fixture(),controller=new AbortController(),pending=f.api.post(preparedPath,{}, {signal:controller.signal}),failed=assert.rejects(pending,error=>error.preparationFailure==='cancelled');await flush();
 f.advance(47000);controller.abort();await failed;assert.equal(f.requests[0].init.signal.aborted,true);assert.equal(f.timers.size,0);assert.equal(f.requests.length,1);
 f.advance(120000);assert.equal(f.requests.length,1);
});
for(const name of ['Error','AbortError'])test('Prepare network '+name+' without local abort is upstream_failure, not timer expiry',async()=>{
 const f=fixture(),pending=f.api.post(preparedPath,{}),failed=assert.rejects(pending,error=>error.preparationFailure==='upstream_failure');await flush();
 f.requests[0].result.reject(Object.assign(new Error('synthetic-private-network-detail'),{name}));await failed;assert.equal(f.requests[0].init.signal.aborted,false);assert.equal(f.requests.length,1);assert.equal(f.timers.size,0);
});
test('Prepare response-body deadline is classified without admitting a late valid body',async()=>{
 const f=fixture(),pending=f.api.post(preparedPath,{}),failed=assert.rejects(pending,error=>error.preparationFailure==='timeout');await flush();
 const body=deferred();f.requests[0].result.resolve({ok:true,status:200,json:()=>body.promise});await flush();
 f.advance(120000);body.resolve({eligible:true});await failed;assert.equal(f.requests.length,1);assert.equal(f.timers.size,0);
});
test('slow Field Map survives independent30s health failure and arrives at62s without a paired cache',async()=>{
 const f=fixture(),saved=preparationSnapshot().snapshot,field=f.api.fleetSource('fieldMap'),health=f.api.fleetSource('health'),failed=assert.rejects(health,status(503));await flush();
 f.advance(30000);await failed;assert.equal(f.requests[1].init.signal.aborted,false);
 f.advance(32000);f.answer(1,saved);const restored=await field;assert.deepEqual(restored,saved);assert.ok(await checkedOwnerCensusPreparationBinding(restored,preparationId));assert.equal(f.elapsed,62000);assert.equal(f.timers.size,0);
 assert(!f.invalidations.includes('cos-private-data-invalidated'));assert(!f.invalidations.includes('cos-fleet-snapshot-updated'));
});

for(const reason of ['timeout','cancelled'])test('Run rejects a late parsed body after '+reason+' without replay or preparation diagnostics',async()=>{
 const f=fixture(),controller=new AbortController(),pending=f.api.post(preparedPath.replace('prepare','once'),{}, {signal:controller.signal});
 const failed=assert.rejects(pending,error=>{assert.equal(error.response.status,503);assert.match(error.message,/save could not be confirmed/);assert.equal(error.preparationFailure,undefined);return true;});await flush();
 const body=deferred();f.requests[0].result.resolve({ok:true,status:200,json:()=>body.promise});await flush();
 if(reason==='timeout')f.advance(120000);else{f.advance(47000);controller.abort();}
 assert.equal(f.requests[0].init.signal.aborted,true);body.resolve({ok:true,censusOnly:true,allowance:'consumed'});await failed;
 assert.equal(f.requests.length,1);assert.equal(f.timers.size,0);f.advance(120000);assert.equal(f.requests.length,1);
});

const recoveryOwner={authorized:true,legacyOwner:true,role:'Owner',name:'Synthetic Owner',productionOwnerUserId:'11111111-1111-4111-8111-111111111111',features:{fleetAccess:true,vrmRead:true}};
const recoveryTurn=async()=>{await new Promise(resolve=>setTimeout(resolve,5));await flush();};
async function recoveryFixture(){
 const f=fixture(),states=[],reasons=[];
 const current=createOperationsSessionRecovery({read:async()=>(await f.api.get('/api/session')).data,mode:()=>new URLSearchParams(f.location.search).get('mode')||'',changed:state=>states.push(state)});
 f.window.addEventListener('cos-private-data-invalidated',event=>{reasons.push(event.detail?.reason);current.invalidate(event.detail?.reason);});
 f.window.addEventListener('message',event=>{if(event.origin===f.location.origin&&event.source===f.window.parent&&event.data?.type==='COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE')current.hide();});
 f.window.addEventListener('pagehide',()=>current.invalidate('security-hide'));
 const boot=current.check();await flush();f.answer(0,recoveryOwner);await boot;
 return {...f,current,states,reasons,get sessionState(){return states.at(-1);}};
}
test('real API token renewal drives one same-Owner session bootstrap without replaying writes',async()=>{
 const f=await recoveryFixture();f.state.token='synthetic-session-b';const pending=f.api.get('/api/routers');await recoveryTurn();
 assert.deepEqual(f.reasons,['token-renewed']);assert.equal(f.sessionState.session,null);assert.deepEqual(f.requests.map(r=>r.envelope.path),['/api/session','/api/routers','/api/session']);
 f.answer(1);f.answer(2,recoveryOwner);await pending;await flush();assert.equal(f.sessionState.session.productionOwnerUserId,recoveryOwner.productionOwnerUserId);assert.equal(f.sessionState.reloadRequired,false);assert.ok(f.requests.every(r=>r.envelope.method==='GET'));f.current.stop();
});
test('shared parent timeout emits once and recovery waits until the failed handshake settles',async()=>{
 const f=await recoveryFixture();f.state.autoReply=false;
 const a=assert.rejects(f.api.get('/api/routers'),status(401)),b=assert.rejects(f.api.fleet(),status(401));
 f.expire(10000);f.state.autoReply=true;await Promise.all([a,b]);await recoveryTurn();
 assert.deepEqual(f.reasons,['parent-timeout']);assert.equal(f.requests.length,2);assert.equal(f.requests[1].envelope.path,'/api/session');assert.equal(f.handshakes.length,3,'failed handshake was not reused by recovery');
 f.answer(1,recoveryOwner);await flush();assert.equal(f.sessionState.reloadRequired,false);assert.ok(f.sessionState.session);f.current.stop();
});
for(const code of [401,403])test('real source HTTP '+code+' cannot become an automatic session retry',async()=>{
 const f=await recoveryFixture(),pending=assert.rejects(f.api.get('/api/routers'),status(code));await flush();f.answer(1,{error:'Synthetic denied'},code);await pending;await recoveryTurn();assert.deepEqual(f.reasons,['authentication-denied']);assert.equal(f.requests.length,2);assert.equal(f.sessionState.session,null);assert.equal(f.sessionState.reloadRequired,true);f.current.stop();
});
test('real parent role denial and empty token are hard stops, not transient timeouts',async()=>{
 for(const patch of [{role:'service'},{token:''}]){const f=await recoveryFixture();Object.assign(f.state,patch);await assert.rejects(f.api.get('/api/routers'),status(401));await recoveryTurn();assert.deepEqual(f.reasons,['authentication-denied']);assert.equal(f.requests.length,1);assert.equal(f.sessionState.reloadRequired,true);f.current.stop();}
});
test('trusted host security hide during verification rejects its late successful session body',async()=>{
 const f=await recoveryFixture();f.state.token='synthetic-session-b';const pending=f.api.get('/api/routers');await recoveryTurn();
 f.reply(undefined,undefined,{data:{type:'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'}});
 f.answer(1);f.answer(2,recoveryOwner);await assert.rejects(pending,status(409));await recoveryTurn();assert.deepEqual(f.reasons,['token-renewed']);assert.equal(f.sessionState.session,null);assert.equal(f.sessionState.reloadRequired,true);assert.equal(f.requests.length,3);f.current.stop();
});
test('wrong-origin and sibling hide messages cannot interrupt same-Owner recovery',async()=>{
 const f=await recoveryFixture();f.state.token='synthetic-session-b';const pending=f.api.get('/api/routers');await recoveryTurn();
 f.reply(undefined,undefined,{origin:'https://untrusted.example',data:{type:'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'}});f.reply(undefined,undefined,{source:{},data:{type:'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'}});
 f.answer(1);f.answer(2,recoveryOwner);await pending;await flush();assert.deepEqual(f.reasons,['token-renewed']);assert.ok(f.sessionState.session);f.current.stop();
});
test('denial from the verification request cannot recursively revalidate',async()=>{
 const f=await recoveryFixture();f.state.token='synthetic-session-b';const pending=f.api.get('/api/routers');await recoveryTurn();f.answer(1);f.answer(2,{error:'Synthetic revoked'},403);await assert.rejects(pending,status(409));await recoveryTurn();assert.deepEqual(f.reasons,['token-renewed','authentication-denied']);assert.equal(f.sessionState.reloadRequired,true);assert.equal(f.requests.length,3);f.current.stop();
});

test('an unsent POST cannot cross token renewal while parent authorization is pending',async()=>{
 const f=await recoveryFixture();f.state.autoReply=false;
 const denied=assert.rejects(f.api.post('/api/owner-tasks',{title:'Synthetic intent'}),status(401));
 f.state.token='synthetic-session-b';f.reply();f.state.autoReply=true;await denied;await recoveryTurn();
 assert.deepEqual(f.requests.map(r=>r.envelope.path),['/api/session','/api/session']);assert.ok(f.requests.every(r=>r.envelope.method==='GET'));f.answer(1,recoveryOwner);await flush();assert.ok(f.sessionState.session);f.current.stop();
});
test('an unsent POST fails on timeout and a late old parent reply cannot revive it',async()=>{
 const f=await recoveryFixture();f.state.autoReply=false;const denied=assert.rejects(f.api.post('/api/owner-tasks',{title:'Synthetic intent'}),status(401));const oldHandshake=f.handshakes.at(-1);
 f.expire(10000);f.state.autoReply=true;await denied;await recoveryTurn();f.reply(oldHandshake);await flush();assert.ok(f.requests.every(r=>r.envelope.method==='GET'));assert.equal(f.requests.length,2);f.answer(1,recoveryOwner);await flush();assert.ok(f.sessionState.session);f.current.stop();
});
test('host hide during POST parent authorization blocks transport even if its old reply succeeds',async()=>{
 const f=await recoveryFixture();f.state.autoReply=false;const denied=assert.rejects(f.api.post('/api/owner-tasks',{title:'Synthetic intent'}),status(401));const handshake=f.handshakes.at(-1);
 f.reply(undefined,undefined,{data:{type:'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'}});f.reply(handshake);await denied;await recoveryTurn();assert.equal(f.requests.length,1);assert.ok(f.sessionState.session);assert.equal(f.sessionState.reloadRequired,false);f.current.stop();
});
test('pagehide during POST parent authorization blocks transport even if its old reply succeeds',async()=>{
 const f=await recoveryFixture();f.state.autoReply=false;const denied=assert.rejects(f.api.post('/api/owner-tasks',{title:'Synthetic intent'}),status(401));const handshake=f.handshakes.at(-1);
 f.window.dispatchEvent(new Event('pagehide'));f.reply(handshake);await denied;await recoveryTurn();assert.equal(f.requests.length,1);assert.equal(f.sessionState.session,null);assert.equal(f.sessionState.reloadRequired,true);f.current.stop();
});
test('a previously submitted write is never replayed by successful revalidation',async()=>{
 const f=await recoveryFixture(),write=f.api.post('/api/owner-tasks',{title:'Synthetic submitted intent'});await flush();assert.equal(f.requests[1].envelope.method,'POST');
 f.state.token='synthetic-session-b';const read=f.api.get('/api/routers');await recoveryTurn();f.answer(2);f.answer(3,recoveryOwner);await read;await flush();f.answer(1,{saved:true});await assert.rejects(write,/save could not be confirmed/);await recoveryTurn();assert.equal(f.requests.filter(r=>r.envelope.method==='POST').length,1);assert.equal(f.requests.length,4);assert.ok(f.sessionState.session);f.current.stop();
});

test('ordinary host hide clears the paired cache and rejects late old sources without replacing a healthy Owner session',async()=>{
 const f=await recoveryFixture(),before=f.sessionState;const old=f.api.fleet(),rejected=assert.rejects(old,status(409));await flush();
 f.reply(undefined,undefined,{data:{type:'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'}});f.answer(1,fleetHealth);f.answer(2,fleetMap);await rejected;assert.equal(f.sessionState,before);assert.deepEqual(f.reasons,[]);
 const fresh=f.api.fleet();await flush();assert.equal(f.requests.length,5);f.answer(3,fleetHealth);f.answer(4,fleetMap);await fresh;assert.equal(f.sessionState.session.productionOwnerUserId,recoveryOwner.productionOwnerUserId);assert.equal(f.sessionState.reloadRequired,false);f.current.stop();
});

test('a captured draft session remains invalid after same-Owner recovery and a new draft gets a fresh fence',async()=>{
 const f=await recoveryFixture(),oldDraft=f.api.captureSession();assert.equal(oldDraft(),true);f.state.token='synthetic-session-b';const read=f.api.get('/api/routers');await recoveryTurn();assert.equal(oldDraft(),false);f.answer(1);f.answer(2,recoveryOwner);await read;await flush();assert.ok(f.sessionState.session);assert.equal(oldDraft(),false);assert.equal(f.api.captureSession()(),true);f.current.stop();
});

for(const code of [200,401,403])for(const timing of ['during','after'])test(`obsolete HTTP ${code} ${timing} same-Owner verification cannot revoke it or return data`,async()=>{
 const f=await recoveryFixture(),old=assert.rejects(f.api.get('/api/camera-health/summary-v3'),status(409));await flush();
 f.state.token='synthetic-session-b';const fresh=f.api.get('/api/routers');await recoveryTurn();
 assert.equal(f.sessionState.checking,true);assert.equal(f.sessionState.session,null);
 if(timing==='after'){f.answer(3,recoveryOwner);await flush();assert.ok(f.sessionState.session);}
 f.answer(1,{privateOldData:true},code);await old;
 assert.deepEqual(f.reasons,['token-renewed']);assert.equal(f.sessionState.reloadRequired,false);
 if(timing==='during'){assert.equal(f.sessionState.session,null);f.answer(3,recoveryOwner);}
 f.answer(2);await fresh;await flush();assert.equal(f.sessionState.session.productionOwnerUserId,recoveryOwner.productionOwnerUserId);
 assert.equal(f.requests.length,4);assert.ok(f.requests.every(r=>r.envelope.method==='GET'));f.current.stop();
});
for(const patch of [{productionOwnerUserId:'22222222-2222-4222-8222-222222222222'},{features:{fleetAccess:true,vrmRead:false}},{authorized:false}])test('obsolete denial cannot make changed identity or revoked permissions recoverable',async()=>{
 const f=await recoveryFixture(),old=assert.rejects(f.api.get('/api/routers'),status(409));await flush();
 f.state.token='synthetic-session-b';const read=f.api.get('/api/jobs');await recoveryTurn();f.answer(2);await read;
 f.answer(1,{error:'Synthetic old denial'},401);await old;f.answer(3,{...recoveryOwner,...patch});await flush();
 assert.equal(f.sessionState.session,null);assert.equal(f.sessionState.reloadRequired,true);assert.deepEqual(f.reasons,['token-renewed']);f.current.stop();
});
test('successful headers cannot admit an old body after a session boundary during parsing',async()=>{
 const f=await recoveryFixture(),old=assert.rejects(f.api.get('/api/routers'),status(409)),body=deferred();await flush();
 f.requests[1].result.resolve({ok:true,status:200,json:()=>body.promise});await flush();
 f.state.token='synthetic-session-b';const read=f.api.get('/api/jobs');await recoveryTurn();f.answer(2);f.answer(3,recoveryOwner);await read;await flush();
 body.resolve({privateOldData:true});await old;assert.ok(f.sessionState.session);assert.deepEqual(f.reasons,['token-renewed']);f.current.stop();
});
for(const code of [200,401,403])test('submitted old write HTTP '+code+' stays uncertain and is never replayed',async()=>{
 const f=await recoveryFixture(),write=assert.rejects(f.api.post('/api/owner-tasks',{title:'Synthetic intent'}),/save could not be confirmed/);await flush();
 f.state.token='synthetic-session-b';const read=f.api.get('/api/routers');await recoveryTurn();f.answer(2);f.answer(3,recoveryOwner);await read;await flush();f.answer(1,{saved:true},code);await write;
 assert.equal(f.requests.filter(r=>r.envelope.method==='POST').length,1);assert.equal(f.requests.length,4);assert.ok(f.sessionState.session);assert.deepEqual(f.reasons,['token-renewed']);f.current.stop();
});

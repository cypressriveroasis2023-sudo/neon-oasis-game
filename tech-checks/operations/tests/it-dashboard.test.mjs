import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as gps from '../src/gpsPersistence.ts';
import * as locations from '../src/fieldLocations.ts';
import * as cameras from '../src/cameraDashboardSummary.ts';
import * as tracker from '../src/unitTracker.ts';
import * as routers from '../../supabase/functions/cos-operations-pages/routers.ts';
import * as vrm from '../../supabase/functions/cos-operations-pages/vrm.ts';
import { snapshot, resource, withStatus, now, fresh } from './fixtures/camera-evidence-fixtures.mjs';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/ITDashboard.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const flush = () => setImmediate();
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const authError = status => Object.assign(new Error('Authorization unavailable'), { response: { status } });
function fixture() {
  const effects = [], readers = [], calls = [], navigation = [];
  const exported = {};
  const dependencies = {
    react: { ...React,
      useEffect(effect) { effects.push(effect); },
      useMemo(factory, deps) {
        const result = React.useMemo(factory, deps);
        if (result?.connect && result?.getSnapshot) readers.push(result);
        return result;
      },
    },
    'react/jsx-runtime': require('react/jsx-runtime'),
    './api': { api: { get(path) { const next = deferred(); calls.push({ path, ...next }); return next.promise; } } },
    './gpsPersistence': gps, './fieldLocations': locations, './cameraDashboardSummary': cameras,
    './unitTracker': tracker,
    '../../supabase/functions/cos-operations-pages/routers': routers,
    '../../supabase/functions/cos-operations-pages/vrm': vrm,
    './itMhelpBridge': { readITMhelpInfo() { const next = deferred(); calls.push({ path: 'parent:mhelp', ...next }); return next.promise; }, readITAssignments() { const next = deferred(); calls.push({ path: 'parent:assignments', ...next }); return next.promise; } },
    './itDashboard.css': {},
  };
  vm.runInNewContext(compiled, {
    exports: exported, require(name) { assert.ok(Object.hasOwn(dependencies, name), 'Unexpected dependency: ' + name); return dependencies[name]; },
    Error, Date, queueMicrotask,
    window: { setInterval() { return 1; }, clearInterval() {} },
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
  });
  let cleanups = [];
  return { ...exported, calls, readers, navigation,
    render(session = { authorized: true, role: 'IT', features: { unitTracker: true, vrmRead: true } }) {
      return renderToStaticMarkup(React.createElement(exported.default, { session, navigate(route) { navigation.push(route); } }));
    },
    connect() { cleanups = effects.map(effect => effect()).filter(Boolean); },
    cleanup() { cleanups.forEach(cleanup => cleanup()); },
  };
}
const field = () => ({ items: [
  { id: '11111111-1111-4111-8111-111111111111', unitNumber: 'HELIOS 001', status: 'field', address: 'Synthetic site', latitude: 1, longitude: 1, locationVerification: 'owner_verified', gpsRecordedAt: fresh, locationVerifiedAt: fresh },
  { id: '22222222-2222-4222-8222-222222222222', unitNumber: 'HELIOS 002', status: 'field', address: 'Synthetic second site', latitude: 2, longitude: 2, historicalLatitude: 2, historicalLongitude: 2, locationVerification: 'address_changed' },
], summary: { fieldUnits: 2, mappedUnits: 2, unitGps: 1, missingGps: 0 }, generatedAt: fresh });
const trackerSnapshot = () => ({ contract: tracker.trackerContract, workbookId: tracker.trackerWorkbookId,
  connector: { enabled: false, state: 'awaiting_sheets_connection' }, queueEnabled: true,
  availability: 'available', sources: [], requests: [], sourcesHeld: 0, sourcesTruncated: false, requestsTruncated: false });
const routerSnapshot = () => routers.routerSnapshot([
  { id: 'one', unit_key: 'HELIOS 001', current_status: 'online', last_checked_at: fresh },
  { id: 'two', unit_key: 'HELIOS 002', current_status: 'offline', last_checked_at: fresh },
], [], new Date(now));

test('six cards render immediately without reading sources during render', () => {
  const f = fixture(), html = f.render();
  assert.equal((html.match(/<article /g) || []).length, 6);
  for (const label of ['Field View', 'InHand Routers', 'Camera Health', 'Victron', 'Unit Tracker', 'MHelp information']) assert.ok(html.includes('Open ' + label));
  assert.equal((html.match(/Checking authorized records/g) || []).length, 6);
  assert.equal(f.calls.length, 0);
  assert.ok(html.indexOf('data-source="field"') < html.indexOf('data-source="cameras"'));
  assert.ok(html.indexOf('data-source="cameras"') < html.indexOf('data-source="routers"'));
  assert.match(html, /Open unit checks/);
  assert.match(html, /Your assigned work/);
  assert.match(html, /View all assignments and ticket info/);
  assert.doesNotMatch(html, /<iframe|<canvas|leaflet|\bhealthy\b/i);
  assert.doesNotMatch(source, /Promise\.all|api\.post\(|\/refresh['"]|getVrmFleet/);
});

test('enabled dashboard reads each source independently and never waits for a global gate', async () => {
  const f = fixture(); f.render(); f.connect(); await flush();
  assert.deepEqual(f.calls.map(call => call.path), ['/api/field-map', '/api/camera-health/summary-v3', '/api/routers', '/api/vrm-fleet', '/api/unit-tracker', 'parent:mhelp', 'parent:assignments']);
  f.calls[0].resolve({ data: field() });
  f.calls[2].reject(new Error('Synthetic router outage'));
  f.calls[5].resolve({ items: [], generatedAt: fresh });
  await flush();
  assert.equal(f.readers[0].getSnapshot().data.items.length, 2);
  assert.equal(f.readers[0].getSnapshot().loading, false);
  assert.match(f.readers[2].getSnapshot().error, /router outage/);
  assert.equal(f.readers[1].getSnapshot().loading, true, 'camera can remain pending while other sources display');
  assert.equal(f.readers[5].getSnapshot().loading, false, 'MHelp is independent of all remote fleet reads');
  const retry = f.readers[2].refresh(); await flush();
  assert.equal(f.calls.length, 8);
  assert.equal(f.calls[7].path, '/api/routers');
  f.calls[7].resolve({ data: routerSnapshot() }); await retry;
  assert.equal(f.readers[2].getSnapshot().error, '');
  f.cleanup();
});

test('Victron and Unit Tracker use exact existing session gates and do not read disabled sources', async () => {
  for (const features of [{}, { vrmRead: 'true', unitTracker: 'true' }, { vrmRead: false, unitTracker: false }]) {
    const f = fixture(), html = f.render({ authorized: true, role: 'IT', features });
    assert.ok(html.includes('Victron access is not enabled'));
    assert.ok(html.includes('Unit Tracker access is not enabled'));
    assert.match(html, /disabled=""[^>]*>Open Victron/);
    f.connect(); await flush();
    assert.equal(f.calls.some(call => ['/api/vrm-fleet', '/api/unit-tracker'].includes(call.path)), false);
    assert.equal(f.calls.length, 5);
    f.cleanup();
  }
});

test('StrictMode setup-cleanup-setup starts one usable read, then repeated retries stay single-flight', async () => {
  const f = fixture(), requests = [];
  const reader = f.createITSourceReader(() => { const next = deferred(); requests.push(next); return next.promise; });
  const discard = reader.connect(); discard();
  const disconnect = reader.connect(); await flush();
  assert.equal(requests.length, 1);
  void reader.refresh(); void reader.refresh();
  assert.equal(requests.length, 1);
  requests[0].reject(new Error('Initial failure')); await flush();
  assert.equal(reader.getSnapshot().loading, false);
  const retry = reader.refresh(); assert.equal(requests.length, 2);
  requests[1].resolve({ count: 7 }); await retry;
  assert.equal(reader.getSnapshot().data.count, 7);
  assert.equal(reader.getSnapshot().error, ''); disconnect();
});

test('late completions cannot replace a newer connection or unlock its pending request', async () => {
  const f = fixture(), requests = [];
  const reader = f.createITSourceReader(() => { const next = deferred(); requests.push(next); return next.promise; });
  const firstCleanup = reader.connect(); await flush(); firstCleanup();
  const secondCleanup = reader.connect(); await flush();
  assert.equal(requests.length, 2);
  requests[0].resolve({ account: 'old' }); await flush();
  assert.equal(reader.getSnapshot().data, null);
  void reader.refresh(); assert.equal(requests.length, 2, 'old finally must not unlock the new pending read');
  requests[1].resolve({ account: 'new' }); await flush();
  assert.equal(reader.getSnapshot().data.account, 'new');
  secondCleanup();
  const before = reader.getSnapshot();
  await reader.refresh();
  assert.equal(reader.getSnapshot(), before);
});

test('non-auth failures retain an explicitly stale snapshot; both auth statuses erase it', async () => {
  for (const status of [401, 403]) {
    const f = fixture(), requests = [];
    const reader = f.createITSourceReader(() => { const next = deferred(); requests.push(next); return next.promise; });
    const stop = reader.connect(); await flush();
    requests[0].resolve({ privateUnit: 'synthetic' }); await flush();
    const temporary = reader.refresh(); requests[1].reject(new Error('Temporary outage')); await temporary;
    assert.equal(reader.getSnapshot().data.privateUnit, 'synthetic');
    assert.match(reader.getSnapshot().error, /Temporary/);
    const denied = reader.refresh(); requests[2].reject(authError(status)); await denied;
    assert.equal(reader.getSnapshot().data, null);
    assert.equal(reader.getSnapshot().readAt, null);
    assert.equal(reader.getSnapshot().loading, false);
    const retry = reader.refresh(); requests[3].resolve({ privateUnit: 'newly authorized' }); await retry;
    assert.equal(reader.getSnapshot().data.privateUnit, 'newly authorized'); stop();
  }
});

test('a changed session creates fresh stores before any effect can run', () => {
  const f = fixture(); f.render({ authorized: true, role: 'IT', features: { unitTracker: true, vrmRead: true } });
  const first = f.readers.slice();
  f.render({ authorized: true, role: 'IT', features: { unitTracker: true, vrmRead: true } });
  for (let index = 0; index < 7; index++) {
    assert.notEqual(f.readers[index + 7], first[index]);
    assert.equal(f.readers[index + 7].getSnapshot().data, null);
  }
  assert.match(source, /\[source, session, enabled\]/);
});

test('Field View counts validated field rows and never calls historical coordinates verified pins', () => {
  const f = fixture(), summary = f.summarizeITFieldMap(field());
  assert.equal(summary.count, 2);
  assert.equal(summary.metrics[0].value, 2);
  assert.equal(summary.metrics[1].value, 1, 'second historical coordinate is not a verified pin');
  assert.match(summary.note, /Live router GPS is not connected/);
  assert.throws(() => f.summarizeITFieldMap({ ...field(), summary: { ...field().summary, fieldUnits: 5 } }));
});

test('router observations age without inventing a cellular outage or remaining reachable forever', () => {
  const f = fixture(), data = routerSnapshot(), current = f.summarizeITRouters(data, now);
  assert.equal(current.metrics[0].value, 1); assert.equal(current.metrics[1].value, 1);
  const old = f.summarizeITRouters(data, now + 30 * 60_000);
  assert.equal(old.metrics[0].value, 0); assert.equal(old.metrics[1].value, 0); assert.equal(old.metrics[2].value, 2);
  assert.match(old.note, /separate from cellular and cloud/);
  assert.throws(() => f.summarizeITRouters({ items: [] }));
});

test('camera metrics use source-separated coverage and old evidence becomes review rather than outage', () => {
  const f = fixture(), data = snapshot([resource(1, 'Helios 1'), withStatus(resource(2, 'Helios 2'), 'offline')]);
  const current = f.summarizeITCameras(data, now);
  assert.equal(current.count, 2); assert.equal(current.metrics[0].value, 1); assert.equal(current.metrics[1].value, 1);
  const old = f.summarizeITCameras(data, now + 60 * 60_000);
  assert.equal(old.metrics[0].value, 0); assert.equal(old.metrics[1].value, 0); assert.equal(old.metrics[2].value, 2);
  assert.throws(() => f.summarizeITCameras({ ...data, evidenceVersion: 1 }));
  const empty = f.summarizeITCameras(snapshot([]), now); assert.equal(empty.count, 0);
  assert.doesNotMatch(empty.note, /all.*healthy/i);
});

test('Victron reports installation inventory and sync limits without inferred battery or health', () => {
  const f = fixture(), data = vrm.vrmPortalConfig(undefined, [{ installationId: 123, name: 'Synthetic installation' }]);
  const summary = f.summarizeITVrm(data);
  assert.equal(summary.count, 1); assert.equal(summary.metrics[0].value, 0);
  assert.match(summary.detail, /not configured/);
  assert.doesNotMatch(JSON.stringify(summary), /\d+%|healthy|offline/);
  assert.equal(f.summarizeITVrm(vrm.vrmPortalConfig(undefined, [])).count, 0);
  assert.throws(() => f.summarizeITVrm({ items: [{ installationId: 1, name: 'Bad links' }] }));
});

test('Unit Tracker distinguishes verified empty, truncated and unavailable snapshots', () => {
  const f = fixture(), data = trackerSnapshot();
  const summary = f.summarizeITTracker(data);
  assert.equal(summary.count, 0); assert.equal(summary.metrics[0].value, 0);
  assert.match(summary.note, /have not been published/);
  const truncated = f.summarizeITTracker({ ...data, sourcesTruncated: true, requestsTruncated: true });
  assert.match(truncated.label, /shown/); assert.match(truncated.metrics[0].label, /shown/);
  assert.match(truncated.detail, /limited/);
  assert.throws(() => f.summarizeITTracker({ ...data, availability: 'unavailable' }), /unavailable/);
  assert.throws(() => f.summarizeITTracker({ ...data, sourcesHeld: -1 }));
});

test('MHelp describes only authorized Ticket Lead records returned by its bridge', () => {
  const f = fixture(), data = { items: [
    { ticketNumber: '123', site: 'Synthetic site', finished: false },
    { ticketNumber: '456', site: 'Synthetic second site', finished: true },
  ], generatedAt: fresh };
  const summary = f.summarizeITMhelp(data);
  assert.equal(summary.count, 2); assert.equal(summary.metrics[0].value, 1); assert.equal(summary.metrics[1].value, 1);
  assert.equal(summary.label, 'your Tech Check tickets');
  assert.match(summary.detail, /123 · Synthetic site/);
  assert.match(f.summarizeITMhelp({ items: [], generatedAt: fresh }).detail, /Ticket Lead account/);
});

test('malformed successful reads are failures with a per-card retry rather than zero counts', async () => {
  const f = fixture(); f.render(); f.connect(); await flush();
  f.calls[0].resolve({ data: { items: [] } }); await flush();
  assert.equal(f.readers[0].getSnapshot().data, null);
  assert.match(f.readers[0].getSnapshot().error, /incomplete/);
  assert.equal(f.readers[0].getSnapshot().loading, false);
  assert.equal(f.readers[1].getSnapshot().loading, true);
  f.cleanup();
});


test('assignment count stays distinct from Ticket Lead references and its failures are independent', async () => {
  for (const failing of ['parent:mhelp', 'parent:assignments']) {
    const f = fixture(); f.render(); f.connect(); await flush();
    const references = f.calls.find(call => call.path === 'parent:mhelp');
    const queue = f.calls.find(call => call.path === 'parent:assignments');
    const assignments = { items: [{ audience: 'mine', status: 'assigned' }, { audience: 'department', status: 'assigned' }], generatedAt: fresh };
    if (failing === 'parent:mhelp') { references.reject(new Error('References unavailable')); queue.resolve(assignments); }
    else { references.resolve({ items: [], generatedAt: fresh }); queue.reject(new Error('Queue unavailable')); }
    await flush();
    assert.equal(Boolean(f.readers[5].getSnapshot().error), failing === 'parent:mhelp');
    assert.equal(Boolean(f.readers[6].getSnapshot().error), failing === 'parent:assignments');
    if (failing === 'parent:mhelp') {
      const summary = f.summarizeITAssignments(f.readers[6].getSnapshot().data);
      assert.equal(summary.count, 2); assert.equal(summary.metrics[0].value, 1); assert.equal(summary.metrics[1].value, 1);
      assert.match(summary.label, /IT assignments/); assert.match(summary.note, /Ticket Lead is not required/);
    }
    f.cleanup();
  }
});

test('queue refresh clears stale assignments while its sibling references stay available', async () => {
  const f = fixture(); f.render(); f.connect(); await flush();
  f.calls[5].resolve({ items: [], generatedAt: fresh }); f.calls[6].resolve({ items: [{ audience: 'mine' }], generatedAt: fresh }); await flush();
  const refresh = f.readers[6].refresh();
  assert.equal(f.readers[6].getSnapshot().data, null); assert.notEqual(f.readers[5].getSnapshot().data, null);
  f.calls[7].reject(new Error('Queue unavailable')); await refresh;
  assert.equal(f.readers[6].getSnapshot().data, null); assert.equal(f.readers[6].getSnapshot().readAt, null);
  f.cleanup();
});

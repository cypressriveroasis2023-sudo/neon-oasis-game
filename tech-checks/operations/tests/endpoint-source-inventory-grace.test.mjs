import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';

// The grace source imports the live v24 helpers by pinned GitHub URL. Load it here
// with those URLs pointed at the same files in this checkout (unchanged since d962b03).
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const RAW = 'https://raw.githubusercontent.com/cypressriveroasis2023-sudo/neon-oasis-game/d962b033234d11a81ada3585725fea9f63749d86/';
const gracePath = join(repo, 'tech-checks/docs/endpoint-source-inventory-grace-20261127/source/trackerEndpointNativeSource.mjs');
const originalPath = join(repo, 'tech-checks/docs/fleet-scheduled-repair-20261104/source/trackerEndpointNativeSource.mjs');
const graceText = readFileSync(gracePath, 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'grace-'));
const local = join(dir, 'trackerEndpointNativeSource.mjs');
writeFileSync(local, graceText.split(RAW).join(pathToFileURL(repo).href));
const {readScheduledNativeEndpointSource, createScheduledNativeEndpointSourceRuntime, CURRENT_MS, GRACE_MS} = await import(pathToFileURL(local).href);

const hash = 'a'.repeat(64), trackerHash = 'b'.repeat(64), now = Date.parse('2026-11-27T22:30:00Z');
function fixture(ageMs = 60000) {
  const records = [
    {productId: '11', unitNumber: 'Sniper 1', category: 'Sniper', placement: 'FIELD', lifecycle: 'UNFLAGGED', binding: {guardCurrent: true, trackerId: 'tracker-11', nativeUnitId: null, expectedGuard: 'c'.repeat(64)}},
    {productId: '12', unitNumber: 'Stand 2', category: 'Stand', placement: 'SHOP', lifecycle: 'UNFLAGGED', binding: null},
  ];
  const source = {
    contract: 'COS_MHELP_API_V1', origin: 'mhelpdesk_api', complete: true, reviewed: true, sourceSha256: hash,
    apiSync: {enabled: true, lastSuccessAt: new Date(now - ageMs).toISOString(), errorCode: ageMs > CURRENT_MS ? 'reconnect_required' : null},
    records, apiMissingRecords: [{productId: '99'}],
    trackerEndpointMembership: {contract: 'COS_TRACKER_ENDPOINT_MEMBERSHIP_V1', sourceSha256: hash, records: records.map(r => ({productId: r.productId, trackerId: r.binding?.trackerId, bindingGuard: r.binding?.expectedGuard, readOnlyTracker: false}))},
  };
  const tracker = {expectedMhelpSourceSha256: hash, trackerSourceSha256: trackerHash, records: records.map(r => ({productId: r.productId, placement: r.placement, publicIp: r.placement === 'FIELD' ? '8.8.8.8' : null, reviewReasons: []}))};
  return {source, tracker};
}
const run = f => readScheduledNativeEndpointSource({readBaseline: async () => f.source, readTracker: async () => f.tracker, signal: new AbortController().signal, now: () => now});
const quiet = async work => {
  const warned = [], keep = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  try { return {result: await work(), warned}; } finally { console.warn = keep; }
};
const handler = (snapshotSource, src) => createScheduledNativeEndpointSourceRuntime({enabled: true, snapshotSource, now: () => now,
  getEnv: n => n === 'SUPABASE_URL' ? 'https://tughscoxralhofrckvxy.supabase.co' : 'synthetic',
  fetch: async url => String(url).endsWith('camera-mhelp-readiness') ? Response.json({authenticated: true}) : Response.json(src)});
const ask = async (snapshotSource, src) => {
  const r = await handler(snapshotSource, src)(new Request('https://example.test/x', {method: 'POST', headers: {'content-type': 'application/json', 'x-camera-cron-secret': 'synthetic'}, body: '{"action":"read"}'}));
  return {status: r.status, body: await r.json()};
};

test('limits: 45 minutes still counts as current, 24 hours is the most the checks will use', () => {
  assert.equal(CURRENT_MS, 45 * 60 * 1000);
  assert.equal(GRACE_MS, 24 * 60 * 60 * 1000);
});

test('a current inventory reads exactly as before, marked current, with nothing logged', async () => {
  const {result, warned} = await quiet(() => run(fixture(60000)));
  assert.equal(result.contract, 'COS_SCHEDULED_TRACKER_ENDPOINT_SOURCE_V1');
  assert.equal(result.inventoryCurrent, true);
  assert.equal(result.inventorySyncedAt, new Date(now - 60000).toISOString());
  assert.equal(result.products.length, 2);
  assert.deepEqual(warned, []);
});

test('mHelpDesk disconnected for hours: the checks keep the last accepted inventory and say how old it is', async () => {
  for (const age of [CURRENT_MS + 1, 2 * 3600000, 13 * 3600000, GRACE_MS]) {
    const {result, warned} = await quiet(() => run(fixture(age)));
    assert.equal(result.inventoryCurrent, false);
    assert.equal(result.inventorySyncedAt, new Date(now - age).toISOString());
    assert.deepEqual(result.products.map(p => [p.productId, p.placement, p.ip]), [['11', 'FIELD', '8.8.8.8'], ['12', 'SHOP', null]]);
    assert.equal(warned.length, 1);
    assert.match(warned[0], /using last accepted mHelp inventory/);
    assert.match(warned[0], /"errorCode":"reconnect_required"/);
  }
});

test('older than 24 hours is refused the same way as before, and retrying cannot help', async () => {
  const f = fixture(GRACE_MS + 1);
  const {result} = await quiet(() => ask(false, f.source));
  assert.deepEqual(result, {status: 503, body: {error: 'Scheduled endpoint source unavailable', code: 'inventory_not_current', retryable: false}});
});

test('every other inventory check is unchanged, however recent the sync', async () => {
  for (const mutate of [s => { s.complete = false; }, s => { s.reviewed = false; }, s => { s.apiSync.enabled = false; }, s => { s.records = []; }, s => { delete s.apiSync.lastSuccessAt; }, s => { s.apiSync.lastSuccessAt = new Date(now + 1).toISOString(); }]) {
    for (const age of [60000, 2 * 3600000]) {
      const f = fixture(age); mutate(f.source);
      const {result} = await quiet(() => ask(false, f.source));
      assert.equal(result.status, 503); assert.equal(result.body.code, 'inventory_not_current');
    }
  }
  const partial = fixture(2 * 3600000); partial.source.trackerEndpointMembership.records.pop();
  assert.equal((await quiet(() => ask(false, partial.source))).result.body.code, 'inventory_incomplete');
});

test('the camera snapshot source keeps the 45-minute rule', async () => {
  const f = fixture(CURRENT_MS + 60000);
  const {result} = await quiet(() => ask(true, f.source));
  assert.deepEqual(result, {status: 503, body: {error: 'Scheduled endpoint source unavailable', code: 'inventory_not_current', retryable: false}});
});

test('the grace source is the live v24 reader with only the recorded edits', () => {
  const original = readFileSync(originalPath, 'utf8');
  let back = graceText
    .replace(/\/\/ 2026-11-27 \(James's go\)[^\n]*\n\/\/[^\n]*\n\/\/[^\n]*\n/, '')
    .replace(RAW + 'tech-checks/docs/fleet-provenance-repair-20261104/source/productTcpRuntime.ts', '../../fleet-provenance-repair-20261104/source/productTcpRuntime.ts')
    .replace(/\/\/ CURRENT_MS:[^\n]*\n\/\/[^\n]*\n\/\/[^\n]*\nexport const CURRENT_MS=2700000,GRACE_MS=86400000;\nfunction baseline\(value,now,maxAge=CURRENT_MS\)\{/, 'function baseline(value,now){')
    .replace('>maxAge', '>2700000')
    .replace(/ const readAt=now\(\),source=baseline\(await readBaseline\(signal\),readAt,GRACE_MS\);\n const syncedAt=[^\n]*\n if\(!current\)console\.warn\([^\n]*\n/, ' const source=baseline(await readBaseline(signal),now());\n')
    .replace(',inventorySyncedAt:syncedAt,inventoryCurrent:current,products};', ',products};');
  assert.equal(back, original);
});

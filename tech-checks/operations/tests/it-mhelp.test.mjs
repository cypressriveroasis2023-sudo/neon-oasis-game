import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const { projectITMhelpTickets: project } = await import('data:text/javascript;base64,' + Buffer.from(readFileSync(new URL('../../it-mhelp-projection.js', import.meta.url), 'utf8')).toString('base64'));
const source = ts.transpileModule(readFileSync(new URL('../src/itMhelpBridge.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const plain = value => JSON.parse(JSON.stringify(value));
const raw = (extra = {}) => ({ ticket_no: '12345', site: 'Synthetic site', work_type: 'delivery', scheduled_for: '2026-10-09', scheduled_time: '08:30:00', all_finished: false, equipment_manifest: [{ label: 'Sniper', qty: 2, category: 'device' }], ...extra });
const ticket = extra => ({ ticketNumber: '12345', site: 'Synthetic site', workType: 'delivery', scheduledFor: '2026-10-09', scheduledTime: '08:30:00', finished: false, equipment: ['2 × Sniper'], ...extra });
const snapshot = (items = [ticket()]) => ({ items, generatedAt: '2026-10-09T20:00:00.000Z' });
function fixture({ standalone = false, opaque = false, sendThrows = false } = {}) {
  const handlers = new Map(), timers = new Map(), requests = [];
  let nextTimer = 0, nextRequest = 0;
  const location = { origin: opaque ? 'null' : 'https://synthetic.example' };
  const parent = { postMessage(message, origin) { assert.equal(origin, location.origin); if (sendThrows) throw new Error('Private transport failure'); requests.push(message); } };
  const window = { parent,
    addEventListener(type, callback) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(callback); },
    removeEventListener(type, callback) { handlers.get(type)?.delete(callback); },
    setTimeout(callback, delay) { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
  };
  if (standalone) window.parent = window;
  const exports = {};
  vm.runInNewContext(source, { exports, window, location, crypto: { randomUUID: () => 'synthetic-request-' + ++nextRequest } });
  const emit = (type, event) => { for (const handler of [...(handlers.get(type) || [])]) handler(event); };
  return { read: exports.readITMhelpInfo, requests, timers, countListeners: () => [...handlers.values()].reduce((sum, set) => sum + set.size, 0),
    navigate: () => emit('cos-workspace-navigation', {}),
    expire: () => { for (const [id, timer] of [...timers]) { assert.equal(timer.delay, 15000); timers.delete(id); timer.callback(); } },
    reply(payload = snapshot(), event = {}, request = requests.at(-1)) { emit('message', { source: parent, origin: location.origin, data: { type: 'COS_IT_MHELP_RESPONSE', requestId: request?.requestId, ...payload }, ...event }); },
  };
}
test('projection forwards only seven operational fields and equipment labels/quantities', () => {
  const input = raw({ customer_name: 'private customer', notes: 'private notes', total: 500, access_token: 'private token', equipment_manifest: [{ label: 'Recon 2', qty: '2', cost: 100, credentials: 'private equipment', serial: 'private serial' }] });
  const before = structuredClone(input);
  assert.deepEqual(project([input]), [ticket({ equipment: ['2 × Recon II'] })]);
  assert.deepEqual(input, before);
  assert.doesNotMatch(JSON.stringify(project([input])), /private|credentials|cost|customer_name|access_token/);
});
test('projection preserves recorded empty and finished states without inventing customer or equipment data', () => {
  assert.deepEqual(project([raw({ ticket_no: 2026, site: null, work_type: null, scheduled_for: null, scheduled_time: null, all_finished: true, equipment_manifest: null })]), [{ ticketNumber: '2026', site: '', workType: '', scheduledFor: '', scheduledTime: '', finished: true, equipment: [] }]);
  assert.deepEqual(project([]), []);
});
test('projection rejects malformed/duplicate/oversized snapshots instead of showing partial or falsely empty records', () => {
  for (const input of [null, {}, '[]', [null], [raw({ ticket_no: '' })], [raw({ all_finished: 'true' })], [raw({ all_finished: null })], [raw({ site: {} })], [raw({ site: 'a'.repeat(301) })], [raw({ scheduled_for: '2026-02-30' })], [raw({ scheduled_time: '24:01' })], [raw(), raw()], Array.from({ length: 5001 }, (_, i) => raw({ ticket_no: String(i) }))]) assert.throws(() => project(input), /unavailable/);
});
test('equipment rejects nested records, invalid quantities, links, markup and oversized payloads', () => {
  for (const equipment_manifest of [{ key: 'secret' }, [null], ['secret'], [{ label: 'Sniper', qty: 0 }], [{ label: 'Sniper', qty: -1 }], [{ label: 'Sniper', qty: 2.5 }], [{ label: 'Sniper', qty: Infinity }], [{ label: 'Sniper', qty: {} }], [{ label: 'Sniper' }], [{ label: '<img src=x>', qty: 1 }], [{ label: 'https://secret.example', qty: 1 }], [{ label: 'x'.repeat(161), qty: 1 }], Array.from({ length: 101 }, () => ({ label: 'Sniper', qty: 1 }))]) assert.throws(() => project([raw({ equipment_manifest })]), /unavailable/);
});
test('bridge matches only exact parent, origin and request ID, and reconstructs allowlisted data', async () => {
  const f = fixture(), promise = f.read();
  assert.deepEqual(plain(f.requests), [{ type: 'COS_IT_MHELP_REQUEST', requestId: 'synthetic-request-1' }]);
  f.reply(snapshot(), { origin: 'https://other.example' }); f.reply(snapshot(), { source: {} }); f.reply({ ...snapshot(), requestId: 'stale' }); f.reply({ ...snapshot(), type: 'OTHER_RESPONSE' }); f.reply({}, { data: null });
  assert.equal(f.timers.size, 1);
  f.reply({ ...snapshot([ticket({ credentials: 'private', total: 100 })]), token: 'private' });
  assert.deepEqual(plain(await promise), snapshot()); assert.equal(f.timers.size, 0); assert.equal(f.countListeners(), 0);
});
test('bridge does not cache settled data and correlates concurrent requests independently', async () => {
  const f = fixture(), first = f.read(), second = f.read();
  f.reply(snapshot([]), {}, f.requests[1]); f.reply(snapshot(), {}, f.requests[0]);
  assert.equal((await first).items.length, 1); assert.equal((await second).items.length, 0);
  const third = f.read(); assert.equal(f.requests.length, 3); f.reply(snapshot([ticket({ ticketNumber: '54321' })])); assert.equal((await third).items[0].ticketNumber, '54321'); assert.equal(f.countListeners(), 0);
});
test('timeout bounds reads at 15 seconds, clears listeners and ignores late replies', async () => {
  const f = fixture(), promise = f.read(); f.expire(); await assert.rejects(promise, /too long/); f.reply(); assert.equal(f.countListeners(), 0); assert.equal(f.timers.size, 0);
});
test('navigation cancels a pending read so late data cannot populate the next workspace', async () => {
  const f = fixture(), first = f.read(); f.navigate(); await assert.rejects(first, /workspace changed/);
  const second = f.read(); f.reply(snapshot(), {}, f.requests[0]); assert.equal(f.timers.size, 1); f.reply(snapshot([]), {}, f.requests[1]); assert.equal((await second).items.length, 0); assert.equal(f.countListeners(), 0);
});
test('malformed responses reject rather than render partial or falsely empty records', async () => {
  for (const payload of [{}, { items: null, generatedAt: snapshot().generatedAt }, { items: [], generatedAt: 'invalid' }, { items: [], generatedAt: '2026-02-30T20:00:00.000Z' }, snapshot([ticket({ equipment: ['unrestricted text'] })]), snapshot([ticket({ equipment: ['0 × Sniper'] })]), snapshot([ticket({ finished: 'true' })]), snapshot([ticket({ equipment: [{ token: 'private' }] })]), snapshot([ticket({ scheduledFor: '2026-02-30' })]), snapshot([ticket({ scheduledTime: '25:01' })]), snapshot([ticket({ site: 'control\u0000character' })]), snapshot([ticket(), ticket()])]) {
    const f = fixture(), promise = f.read(); f.reply(payload); await assert.rejects(promise, /incomplete information/); assert.equal(f.countListeners(), 0); assert.equal(f.timers.size, 0);
  }
});
test('error mapping is safe and access denial carries status 403', async () => {
  for (const [error, pattern, status] of [['forbidden', /session could not be verified/, 403], ['timeout', /too long/, 503], ['private SQL token detail', /could not be loaded/, 503], [{ token: 'private' }, /could not be loaded/, 503], ['__proto__', /could not be loaded/, 503]]) {
    const f = fixture(), promise = f.read(); f.reply({ error }); await assert.rejects(promise, value => pattern.test(value.message) && value.response.status === status); assert.equal(f.countListeners(), 0);
  }
});
test('standalone, opaque origin and failed messaging leave no listeners or timers', async () => {
  for (const options of [{ standalone: true }, { opaque: true }, { sendThrows: true }]) {
    const f = fixture(options); await assert.rejects(f.read(), /signed-in IT dashboard|could not be loaded/); assert.equal(f.requests.length, 0); assert.equal(f.countListeners(), 0); assert.equal(f.timers.size, 0);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const { projectITAssignments: project } = await import('data:text/javascript;base64,' + Buffer.from(readFileSync(new URL('../../it-mhelp-projection.js', import.meta.url), 'utf8')).toString('base64'));
const source = ts.transpileModule(readFileSync(new URL('../src/itMhelpBridge.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const subject = '4f7044b5-86b6-411f-8898-39bb64b4ddbc', id = '11111111-1111-4111-8111-111111111111', otherId = '22222222-2222-4222-8222-222222222222';
const raw = (extra = {}) => ({ id, ticket_no: 'SYN-1001', site: 'Synthetic site', work_type: 'delivery', scheduled_for: '2026-10-09', scheduled_time: '08:30:00', assigned_role: 'it', status: 'assigned', assignee_user_id: subject, assignment_scope: 'technician', job_lead_user_id: null, equipment_manifest: [], unit_summary: null, ...extra });
const item = (extra = {}) => ({ assignmentId: id, ticketNumber: 'SYN-1001', site: 'Synthetic site', workType: 'delivery', scheduledFor: '2026-10-09', scheduledTime: '08:30:00', status: 'assigned', audience: 'mine', equipment: [], unitSummary: '', ...extra });
const snapshot = (items = [item()]) => ({ items, generatedAt: '2026-10-10T12:00:00.000Z' });
const plain = value => JSON.parse(JSON.stringify(value));
function fixture({ standalone = false, opaque = false, sendThrows = false } = {}) {
  const handlers = new Map(), timers = new Map(), requests = []; let timer = 0, request = 0;
  const location = { origin: opaque ? 'null' : 'https://synthetic.example' };
  const parent = { postMessage(message, origin) { assert.equal(origin, location.origin); if (sendThrows) throw new Error('Private failure'); requests.push(message); } };
  const window = { parent, addEventListener(type, callback) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(callback); }, removeEventListener(type, callback) { handlers.get(type)?.delete(callback); }, setTimeout(callback, delay) { timers.set(++timer, { callback, delay }); return timer; }, clearTimeout(id) { timers.delete(id); } };
  if (standalone) window.parent = window;
  const exports = {}; vm.runInNewContext(source, { exports, window, location, crypto: { randomUUID: () => 'synthetic-' + ++request } });
  const emit = (type, event) => { for (const fn of [...(handlers.get(type) || [])]) fn(event); };
  return { read: exports.readITAssignments, references: exports.readITMhelpInfo, requests, timers, listeners: () => [...handlers.values()].reduce((sum, set) => sum + set.size, 0),
    navigate: () => emit('cos-workspace-navigation', {}), expire: () => { for (const [id, entry] of [...timers]) { assert.equal(entry.delay, 15000); timers.delete(id); entry.callback(); } },
    reply(payload = snapshot(), event = {}, request = requests.at(-1)) { emit('message', { source: parent, origin: location.origin, data: { type: 'COS_IT_ASSIGNMENTS_RESPONSE', requestId: request?.requestId, ...payload }, ...event }); },
  };
}
test('own and unclaimed department assignments include null-lead shells, keyed by assignment rather than ticket', () => {
  const rows = [raw(), raw({ id: otherId, assignee_user_id: null, assignment_scope: 'department' })];
  assert.deepEqual(project(rows, subject), [item(), item({ assignmentId: otherId, audience: 'department' })]);
  assert.deepEqual(project([raw({ assignment_scope: 'department', status: 'started' })], subject), [item({ status: 'started' })]);
  assert.deepEqual(project([], subject), []);
});
test('projection is bounded, immutable and forwards only ten operational fields', () => {
  const row = raw({ ticket_no: 'T'.repeat(128), site: 'S'.repeat(500), unit_summary: 'Recorded Helios 001\nKeep this line.', equipment_manifest: [{ label: 'Synthetic Sniper', qty: 2, credentials: 'PRIVATE' }], assigned_by_name: 'mHelpDesk automatic intake', job_description: 'PRIVATE', notes: 'PRIVATE', assignee_name: 'PRIVATE', access_token: 'PRIVATE' });
  const before = structuredClone(row), result = project([row], subject)[0];
  assert.deepEqual(row, before); assert.equal(result.ticketNumber.length, 128); assert.equal(result.site.length, 500);
  assert.equal(Object.keys(result).length, 10); assert.equal(result.unitSummary, 'Recorded Helios 001\nKeep this line.'); assert.deepEqual(result.equipment, ['2 × Synthetic Sniper']);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|automatic|import|job_lead|assignee_user/);
});
test('other assignees, wrong roles, completed rows and claimed/non-assigned department rows fail closed', () => {
  for (const patch of [{ assignee_user_id: otherId }, { assigned_role: 'service' }, { assigned_role: 'owner' }, { status: 'completed' }, { status: 'cancelled' }, { assignee_user_id: null, assignment_scope: 'technician' }, { assignee_user_id: null, assignment_scope: 'department', status: 'started' }, { assignee_user_id: undefined }, { assignment_scope: 'unknown' }]) assert.throws(() => project([raw(), raw({ id: otherId, ...patch })], subject), /unavailable/);
  assert.throws(() => project([raw()], null), /unavailable/);
});
test('malformed IDs, duplicate IDs, limits, dates, quantities and unexpected types reject the complete snapshot', () => {
  for (const rows of [null, {}, [null], [raw(), raw()], [raw({ id: 'invalid' })], [raw({ ticket_no: 123 })], [raw({ ticket_no: 'T'.repeat(129) })], [raw({ ticket_no: ' ' })], [raw({ site: 'S'.repeat(501) })], [raw({ site: 'control\u0000' })], [raw({ unit_summary: {} })], [raw({ unit_summary: 'S'.repeat(2001) })], [raw({ scheduled_for: '2026-02-30' })], [raw({ scheduled_time: '25:00' })], [raw({ equipment_manifest: [{ label: 'Sniper', qty: 0 }] })], [raw({ equipment_manifest: {} })], [raw({ equipment_manifest: undefined })], [raw({ site: undefined })], [raw({ scheduled_for: undefined })], Array.from({ length: 5001 }, () => raw())]) assert.throws(() => project(rows, subject), /unavailable/);
});
test('queue message has a distinct contract, exact parent/origin/request matching and no settled cache', async () => {
  const f = fixture(), read = f.read(); assert.deepEqual(plain(f.requests[0]), { type: 'COS_IT_ASSIGNMENTS_REQUEST', requestId: 'synthetic-1' });
  f.reply(snapshot(), { source: {} }); f.reply(snapshot(), { origin: 'https://other.example' }); f.reply({ ...snapshot(), requestId: 'old' }); f.reply({ ...snapshot(), type: 'COS_IT_MHELP_RESPONSE' });
  assert.equal(f.timers.size, 1); f.reply(snapshot([item({ secret: 'PRIVATE' })])); assert.deepEqual(plain(await read), snapshot()); assert.equal(f.listeners(), 0);
  const next = f.read(); f.reply(snapshot([])); assert.deepEqual(plain(await next), snapshot([])); assert.equal(f.requests.length, 2);
});
test('assignment reader accepts shell bounds and same-ticket distinct IDs but rejects invalid or mixed rows', async () => {
  const f = fixture(), good = f.read(); f.reply(snapshot([item({ ticketNumber: 'T'.repeat(128), site: 'S'.repeat(500), unitSummary: 'Original summary\nSecond line' }), item({ assignmentId: otherId, audience: 'department' })])); assert.equal((await good).items.length, 2);
  for (const payload of [{}, snapshot([item(), item()]), snapshot([item({ assignmentId: 'bad' })]), snapshot([item({ ticketNumber: 'T'.repeat(129) })]), snapshot([item({ site: 'S'.repeat(501) })]), snapshot([item({ audience: 'other' })]), snapshot([item({ status: 'completed' })]), snapshot([item({ audience: 'department', status: 'started' })]), snapshot([item({ unitSummary: null })]), snapshot([item({ equipment: ['1 × <img>'] })]), snapshot([item({ scheduledFor: '2026-02-30' })]), snapshot([item({ scheduledTime: '25:00' })]), { ...snapshot(), generatedAt: '2026-02-30T12:00:00Z' }, snapshot(Array.from({ length: 5001 }, () => item()))]) {
    const fixture = f.read(); f.reply(payload); await assert.rejects(fixture, /incomplete/); assert.equal(f.listeners(), 0);
  }
});
test('navigation and old-host timeout discard late queue replies and clean all listeners', async () => {
  const f = fixture(), old = f.read(); f.navigate(); await assert.rejects(old, /workspace changed/);
  const current = f.read(); f.reply(snapshot(), {}, f.requests[0]); assert.equal(f.timers.size, 1); f.expire(); await assert.rejects(current, /current host/); f.reply(); assert.equal(f.listeners(), 0); assert.equal(f.timers.size, 0);
});
test('reference and queue failures are independent in both directions', async () => {
  for (const failQueue of [true, false]) {
    const f = fixture(), references = f.references(), queue = f.read();
    f.reply(failQueue ? { error: 'unavailable' } : snapshot(), {}, f.requests[1]);
    f.reply(failQueue ? { type: 'COS_IT_MHELP_RESPONSE', items: [], generatedAt: snapshot().generatedAt } : { type: 'COS_IT_MHELP_RESPONSE', error: 'unavailable' }, {}, f.requests[0]);
    if (failQueue) { await assert.rejects(queue, /IT assignments could not be loaded/); assert.equal((await references).items.length, 0); }
    else { await assert.rejects(references, /MHelp references could not be loaded/); assert.equal((await queue).items.length, 1); }
    assert.equal(f.listeners(), 0);
  }
});
test('safe queue error mapping and standalone restrictions never leak raw errors or leave listeners', async () => {
  for (const error of ['forbidden', 'timeout', 'PRIVATE SQL', { secret: 'PRIVATE' }, '__proto__']) {
    const f = fixture(), read = f.read(); f.reply({ error }); await assert.rejects(read, e => !/PRIVATE|SQL|proto/.test(e.message) && e.response.status === (error === 'forbidden' ? 403 : 503)); assert.equal(f.listeners(), 0);
  }
  for (const options of [{ standalone: true }, { opaque: true }, { sendThrows: true }]) { const f = fixture(options); await assert.rejects(f.read()); assert.equal(f.listeners(), 0); assert.equal(f.timers.size, 0); }
});

test('sparse RPC and cross-frame arrays cannot fabricate rows or equipment',async()=>{
 const mixedRaw=new Array(2);mixedRaw[0]=raw();
 for(const rows of [new Array(3),mixedRaw,[raw({equipment_manifest:new Array(1)})]])assert.throws(()=>project(rows,subject),/unavailable/);
 const mixedItems=new Array(2);mixedItems[0]=item();
 for(const items of [new Array(3),mixedItems,[item({equipment:new Array(1)})]]){
  const f=fixture(),read=f.read();f.reply(snapshot(items));await assert.rejects(read,/incomplete/);assert.equal(f.listeners(),0);
 }
});

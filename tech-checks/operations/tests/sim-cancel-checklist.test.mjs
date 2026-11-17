import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessSimCancel, closeoutAllowed, recordSimCancel, simCancelForNotes, simCancelProject, simCancelTodo, simLast4} from '../src/simCancelChecklist.ts';
import * as legacy from '../../sim-cancel-checklist.mjs';
import {technicianTodos} from '../src/technicianTodos.ts';

const EXAMPLE = 'EXAMPLE-SIM-0007';
const canceled = {productId:'900014', unit:'SNIPER 014', outcome:'canceled', carrier:'Verizon', canceledOn:'2026-11-17', canceledBy:'Example IT', confirmation:'CONFIRM-EXAMPLE', simNumber:EXAMPLE};

test('a pickup or cancellation is incomplete until the step is saved', () => {
  for (const action of ['pickup', 'cancel', 'canceled', 'cancelled']) {
    const missing = closeoutAllowed({action, simCancel:null});
    assert.equal(missing.ok, false);
    assert.equal(missing.error, 'This cancellation is not complete.');
    assert.equal(JSON.stringify(missing).includes(EXAMPLE), false);
  }
  assert.equal(closeoutAllowed({action:'delivery', simCancel:null}).ok, true);
  assert.equal(closeoutAllowed({action:'pickup', simCancel:{cancellationDoc:{ticket:'1'}}}).ok, false);
});

test('the SIM number is required unless the unit has no SIM', () => {
  const missing = assessSimCancel({...canceled, simNumber:''});
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'Enter the SIM number.');
  assert.equal(JSON.stringify(missing).includes(EXAMPLE), false);
  const noSim = assessSimCancel({productId:'900014', unit:'SNIPER 014', outcome:'no_sim', canceledBy:'Example IT', noSimReason:'Example unit shipped without one.', simNumber:''});
  assert.equal(noSim.ok, true);
  assert.equal(noSim.record.simNumber, null);
  const noReason = assessSimCancel({productId:'900014', unit:'SNIPER 014', outcome:'no_sim', canceledBy:'Example IT', noSimReason:''});
  assert.equal(noReason.ok, false);
});

test('lists and the to-do show the last four digits, not the full number', () => {
  const saved = assessSimCancel(canceled);
  assert.equal(saved.ok, true);
  assert.equal(simLast4(saved.record.simNumber), '•••• 0007');
  assert.equal(simLast4(saved.record.simNumber).includes(EXAMPLE), false);
  const notes = simCancelForNotes(saved.record);
  assert.equal(notes.simNumber, null);
  assert.equal(notes.simLast4, '•••• 0007');
  const todo = simCancelTodo({unit:'SNIPER 014', productId:'900014'});
  assert.equal(todo.detail, 'Cancel SIM: SNIPER 014');
  assert.equal(JSON.stringify(todo).includes(EXAMPLE), false);
  const listed = technicianTodos({simCancels:[{unit:'SNIPER 014', productId:'900014'}]});
  assert.equal(listed[0].detail, 'Cancel SIM: SNIPER 014');
  assert.equal(JSON.stringify(listed).includes(EXAMPLE), false);
});

test('a failed save does not repeat the SIM number', async () => {
  let called = false;
  const denied = await recordSimCancel({from(){called = true; return {insert: async () => { throw new Error('db '+EXAMPLE); }};}}, canceled, null);
  assert.equal(called, false);
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'The SIM step could not be saved.');
  assert.equal(denied.error.includes(EXAMPLE), false);
  const thrown = await recordSimCancel({accessToken:'synthetic', fetch: async () => { throw new Error('db '+EXAMPLE); }}, canceled, '00000000-0000-4000-8000-000000000001');
  assert.equal(thrown.ok, false);
  assert.equal(thrown.error, 'The SIM step could not be saved.');
  assert.equal(thrown.error.includes(EXAMPLE), false);
});

test('the protected insert refuses the Cameras On Site project', async () => {
  let called = false;
  const denied = await recordSimCancel({
    url: 'https://goqrnolcvqnirjmzaeyk.supabase.co/rest/v1/cos_sim_cancel_records',
    accessToken: 'synthetic',
    fetch: async () => { called = true; return {ok: true}; },
  }, canceled, '00000000-0000-4000-8000-000000000001');
  assert.equal(simCancelProject('https://goqrnolcvqnirjmzaeyk.supabase.co/rest/v1/cos_sim_cancel_records'), 'cameras-on-site');
  assert.equal(denied.ok, false);
  assert.equal(called, false);
  assert.equal(denied.error.includes(EXAMPLE), false);
  const calls = [];
  const saved = await recordSimCancel({
    accessToken: 'synthetic',
    fetch: async (url, init) => { calls.push({url, body: init.body}); return {ok: true}; },
  }, canceled, '00000000-0000-4000-8000-000000000001');
  assert.equal(saved.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(simCancelProject(calls[0].url), 'platform');
  assert.equal(calls[0].url.includes('goqrnolcvqnirjmzaeyk'), false);
  assert.equal(calls[0].body.includes('/api/sim-cancel'), true);
  assert.equal(legacy.simCancelProject(calls[0].url), 'platform');
});

test('other identifier fields are refused', () => {
  const extra = assessSimCancel({...canceled, iccid:EXAMPLE});
  assert.equal(extra.ok, false);
  assert.equal(JSON.stringify(extra).includes(EXAMPLE), false);
});

test('the intake page uses the same completion rule', () => {
  const again = legacy.assessSimCancel({...canceled, simNumber:''});
  assert.equal(again.ok, false);
  assert.equal(again.error, 'Enter the SIM number.');
  assert.equal(legacy.closeoutAllowed({action:'pickup', simCancel:canceled}).ok, true);
  assert.equal(legacy.simLast4(EXAMPLE), '•••• 0007');
  const intake = readFileSync(new URL('../../intake-shared-v1.js', import.meta.url), 'utf8');
  assert.match(intake, /closeoutAllowed\(\{action:'pickup'/);
  assert.match(intake, /if\(!nextMeta\.cancellationDoc\)nextMeta\.cancellationDoc=documentation\(/);
  const wizard = readFileSync(new URL('../../it-intake-wizard-v1.js', import.meta.url), 'utf8');
  assert.doesNotMatch(wizard, /meta\.simCancel=result\.record/);
  assert.doesNotMatch(wizard, /simCancel:result\.record/);
  assert.match(wizard, /simNumbers\.get\(row\.id\)/);
  assert.match(wizard, /intakeFailureStep\(error\?\.message\)/);
  const sql = readFileSync(new URL('../../supabase/migrations/20261117_cos_sim_cancel_records.sql', import.meta.url), 'utf8');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.cos_sim_cancel_records from public, anon/);
  assert.doesNotMatch(sql, /iccid|imsi|imei/i);
  const writer = readFileSync(new URL('../../sim-cancel-checklist.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(writer, /from\('cos_sim_cancel_records'\)/);
  const grants = readFileSync(new URL('../../supabase/migrations/20261117_cos_sim_cancel_records_tighten_grants.sql', import.meta.url), 'utf8');
  assert.equal(grants, 'revoke update, delete, truncate, references, trigger on public.cos_sim_cancel_records from authenticated;\n');
  const policy = readFileSync(new URL('../../supabase/migrations/20261117_cos_sim_cancel_records_owner_check.sql', import.meta.url), 'utf8');
  assert.match(policy, /recorded_by = auth\.uid\(\)/);
  assert.match(policy, /unique \(product_id, return_id\)/);
});

test('damage notes and page meta keep only the last four digits', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = globalThis;
  try {
  await import('../../tech-check-rules.js');
  const wizard = await import('../../it-intake-wizard-v1.js');
  await import('../../intake-shared-v1.js');
  const page = wizard.intakeMetaForPage({simCancel: {...canceled}, answers: [true]});
  assert.equal(page.simCancel.simNumber, null);
  assert.equal(page.simCancel.simLast4, '•••• 0007');
  assert.equal(JSON.stringify(page).includes(EXAMPLE), false);
  assert.equal(globalThis.TechCheckRules.itIntakeChecklist[wizard.intakeFailureStep('Enter the SIM number.')], 'SIM card canceled');
  assert.equal(wizard.intakeFailureStep('The SIM step could not be saved.'), null);
  const updates = [];
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({url, body: init.body}); return {ok: true}; };
  globalThis.TechCheckContext = {db: {
    auth: {getSession: async () => ({data: {session: {access_token: 'synthetic'}}})},
    from(table) {
      assert.notEqual(table, 'cos_sim_cancel_records');
      return {update(payload) {updates.push(payload); return {eq() {return {select() {return {maybeSingle: async () => ({data: {status: 'pending_mhelp_inventory', it_tech_id: 'tech-1', intake_photo_paths: ['photo-1'], updated_at: '2026-11-17T18:00:00Z'}, error: null})};}};}};}};
    },
  }};
  const row = {id: '00000000-0000-4000-8000-000000000001', ticket_no: 'T-100', unit_tag: 'SNIPER 014'};
  const tech = {id: 'tech-1', name: 'Example IT'};
    await assert.rejects(globalThis.TechCheckIntake.finishIntake({row, tech, notes: 'Example notes', meta: page, intakePhotoPaths: ['photo-1'], simNumber: null}), error => error.message === 'Enter the SIM number.' && !error.message.includes(EXAMPLE));
    assert.equal(updates.length, 0);
    const saved = await globalThis.TechCheckIntake.finishIntake({row, tech, notes: 'Example notes', meta: page, intakePhotoPaths: ['photo-1'], simNumber: EXAMPLE});
    assert.equal(saved.meta.simCancel.simNumber, null);
    assert.equal(saved.meta.simCancel.simLast4, '•••• 0007');
    assert.equal(saved.meta.cancellationDoc.ticket, 'T-100');
    assert.equal(saved.meta.cancellationDoc.unit, 'SNIPER 014');
    assert.equal(saved.meta.cancellationDoc.techName, 'Example IT');
    assert.ok(saved.meta.cancellationDoc.simCanceledDate);
    assert.ok(saved.meta.cancellationDoc.techInitials);
    const notes = updates[0].damage_notes;
    const decoded = globalThis.TechCheckIntake.readRecord(notes);
    assert.equal(JSON.stringify(saved.meta).includes(EXAMPLE), false);
    assert.equal(JSON.stringify(decoded.meta).includes(EXAMPLE), false);
    assert.equal(notes.includes(EXAMPLE), false);
    assert.equal(decoded.meta.simCancel.simLast4, '•••• 0007');
    const older = globalThis.TechCheckIntake.writeRecord('Example notes', {ticket:'T-100'});
    assert.equal(globalThis.TechCheckIntake.readRecord(older).meta.ticket, 'T-100');
    const previous = 'Example notes\n[[INTAKE_META:'+btoa(JSON.stringify({ticket:'T-100'}))+']]';
    assert.equal(globalThis.TechCheckIntake.readRecord(previous).meta.ticket, 'T-100');
    assert.equal(calls.length, 1);
    assert.equal(simCancelProject(calls[0].url), 'platform');
    assert.equal(calls[0].url.includes('goqrnolcvqnirjmzaeyk'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    delete globalThis.TechCheckContext;
    delete globalThis.TechCheckRules;
    delete globalThis.TechCheckIntake;
    delete globalThis.TechCheckITIntake;
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessSimCancel, closeoutAllowed, recordSimCancel, simCancelForNotes, simCancelTodo, simLast4} from '../src/simCancelChecklist.ts';
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
  const denied = await recordSimCancel({from(){return {insert: async () => { throw new Error('db '+EXAMPLE); }};}}, canceled, null);
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'The SIM step could not be saved.');
  assert.equal(denied.error.includes(EXAMPLE), false);
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
  assert.doesNotMatch(intake, /if\(!nextMeta\.cancellationDoc\)/);
  const sql = readFileSync(new URL('../../supabase/migrations/20261117_cos_sim_cancel_records.sql', import.meta.url), 'utf8');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.cos_sim_cancel_records from public, anon/);
  assert.doesNotMatch(sql, /iccid|imsi|imei/i);
});

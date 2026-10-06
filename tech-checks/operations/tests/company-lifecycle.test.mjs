import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPANY_STAGES, companyStageCounts, deriveJobLifecycle, jobStageId } from '../src/companyLifecycle.ts';

const job = (overrides = {}) => ({ id: 'synthetic-job-a', jobNumber: 'FIX-2042', status: 'Unscheduled', stage: 'IT Prep', visitType: 'IT_PREP', visitId: 'synthetic-visit-a', technician: 'Unassigned', equipmentUnitTag: null, scheduled: 'Not scheduled', ...overrides });

test('the eight approved company stages keep their order', () => {
  assert.deepEqual(COMPANY_STAGES.map(stage => stage.label), ['Quote', 'Agreement', 'Signed', 'Schedule & Parts', 'IT Prep', 'Service Install', 'Closeout', 'Billing']);
});
test('documented current visit phases and operational statuses map to honest display lanes', () => {
  assert.equal(jobStageId(job()), 'schedule');
  assert.equal(jobStageId(job({ status: 'Scheduled' })), 'schedule');
  assert.equal(jobStageId(job({ status: 'Assigned' })), 'schedule');
  assert.equal(jobStageId(job({ status: 'Dispatched' })), 'it-prep');
  assert.equal(jobStageId(job({ status: 'Dispatched', stage: 'IT Intake', visitType: 'IT_INTAKE' })), 'it-prep');
  for (const [stage, visitType] of [['Service', 'SERVICE'], ['Service Delivery', 'DELIVERY'], ['Service Swap', 'SWAP'], ['Service Pickup', 'PICKUP']]) assert.equal(jobStageId(job({ status: 'Dispatched', stage, visitType })), 'service-install');
  assert.equal(jobStageId(job({ status: 'Owner Review' })), 'closeout');
  assert.equal(jobStageId(job({ status: 'Billing Ready' })), 'billing');
});
test('unknown, blank and terminal statuses never infer progress from type or billing fields', () => {
  for (const status of ['', null, 'Unrecognized', 'Closed', 'Cancelled', 'Deleted']) assert.equal(jobStageId(job({ status, jobType: 'DELIVERY', billingReady: true })), null);
  assert.equal(jobStageId(job({ status: 'Dispatched', stage: 'Production workflow', visitType: null, jobType: 'DELIVERY' })), null);
  assert.equal(jobStageId(job({ status: 'Unrecognized', stage: 'Billing' })), null);
});
test('a later-stage status does not complete any earlier stage or imply accepted documents', () => {
  const result = deriveJobLifecycle(job({ status: 'Billing Ready', stage: 'Billing', visitId: null, quoteNumber: 'FIX-Q001', invoiceNumber: 'FIX-I001', billingReady: true, signatures: [{ name: 'Synthetic signer', signedAt: '2026-10-06T08:00:00Z' }] }));
  assert.equal(result.stages.filter(stage => stage.state === 'complete').length, 0);
  assert.equal(result.stages.find(stage => stage.id === 'signed').state, 'unavailable');
  assert.equal(result.missing.some(item => item.id === 'schedule'), false);
  assert.match(result.completed.find(item => item.id === 'quote').detail, /acceptance not supplied/);
  assert.match(result.completed.find(item => item.id === 'invoice').detail, /payment status not supplied/);
  assert.match(result.completed.find(item => item.id === 'billing-ready').detail, /does not confirm invoicing or payment/);
});
test('unknown parts, agreements, source and placeholder evidence stay unavailable, never missing', () => {
  const result = deriveJobLifecycle(job({ photos: [], techCheckHistory: [], parts: [], agreementSigned: true }));
  for (const id of ['parts', 'agreement', 'source']) assert.ok(result.unavailable.some(item => item.id === id));
  assert.equal(result.missing.some(item => ['parts', 'agreement', 'photos', 'checks'].includes(item.id)), false);
  assert.equal(result.completed.some(item => item.id.startsWith('check-')), false);
});
test('only explicit assignments, usable dates and actual completed-at evidence create facts', () => {
  const result = deriveJobLifecycle(job({ scheduled: '2026-10-06 08:00', scheduledEnd: '2026-10-06 09:30', technician: 'Fixture IT', equipmentUnitTag: 'FIX-07', techCheckHistory: [{ stage: 'IT Prep', completedAt: '2026-10-05T17:00:00Z' }, { stage: 'Service', completedAt: null }, { stage: 'Service', completedAt: 'invalid' }] }));
  for (const id of ['schedule', 'technician', 'unit', 'check-0']) assert.ok(result.completed.some(item => item.id === id));
  assert.equal(result.completed.filter(item => item.id.startsWith('check-')).length, 1);
  assert.equal(result.stages.some(stage => stage.state === 'complete'), false);
});
test('missing schedule, unassigned current visit and explicit attention stay distinct', () => {
  const result = deriveJobLifecycle(job({ needsAttention: true, damageReported: true }));
  assert.deepEqual(result.missing.map(item => item.id), ['schedule', 'technician', 'unit', 'attention', 'damage']);
  assert.equal(result.responsibleTeam, 'Operations');
  assert.equal(deriveJobLifecycle(job({ status: 'Owner Review' })).responsibleTeam, 'Owner');
});
test('unavailable source counts are null; unknown stages are explicit; duplicate and terminal identities excluded', () => {
  const empty = companyStageCounts([]);
  assert.equal(empty.quote, null); assert.equal(empty.agreement, null); assert.equal(empty.signed, null);
  assert.equal(empty.schedule, 0); assert.equal(empty.unknown, 0);
  assert.ok(Object.values(companyStageCounts(null)).every(value => value === null));
  const counts = companyStageCounts([job(), job({ id: 'synthetic-b', status: 'Owner Review' }), job({ id: 'synthetic-c', status: 'unknown' }), job({ id: 'synthetic-d', status: 'Closed' }), job({ id: 'duplicate' }), job({ id: 'duplicate' })]);
  assert.equal(counts.schedule, 1); assert.equal(counts.closeout, 1); assert.equal(counts.unknown, 1);
});

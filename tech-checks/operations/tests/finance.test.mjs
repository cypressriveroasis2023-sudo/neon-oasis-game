import test from 'node:test';
import assert from 'node:assert/strict';
import { availableFinanceDecisions, checkedFinanceDetail, checkedFinanceList, createFinanceDecisionSaver, financeDecisionRequest, financeDetailMatchesRow, financeMoney, hasConfirmedFinanceDecision } from '../src/financePersistence.ts';
const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const quote = { id, status: 'Pending Owner Approval', locked: true, revision: 3 };
const invoice = { id, status: 'Pending Owner Approval' };
const po = { id, status: 'Pending Owner PO Approval', poApproved: false, approved: false, paid: false, match: 'Pending' };
const ap = { id, status: 'Ready for AP Approval', poApproved: true, approved: false, paid: false, match: 'Matched' };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

test('finance lists reject incomplete, duplicate, untrusted IDs and absent statuses', () => {
  assert.deepEqual(checkedFinanceList({ items: [] }), []);
  assert.deepEqual(checkedFinanceList({ items: [quote] }), [quote]);
  for (const data of [null, {}, { items: [null] }, { items: [quote, quote] }, { items: [{ ...quote, id: '../jobs' }] }, { items: [{ id }] }]) assert.throws(() => checkedFinanceList(data));
});
test('details require the selected identity and valid arrays before owners can review', () => {
  assert.equal(checkedFinanceDetail({ ...quote, lines: [] }, id).id, id);
  for (const data of [{ ...quote, id: otherId }, { ...quote, lines: null }, { ...quote, lines: [null] }, { ...quote, payments: {} }, { ...quote, status: '' }]) assert.throws(() => checkedFinanceDetail(data, id));
});
test('unavailable financial amounts remain unverified rather than becoming zero', () => {
  assert.equal(financeMoney(0), '$0.00');
  assert.equal(financeMoney('$1,234.56'), '$1,234.56');
  for (const value of [undefined, null, '', 'Awaiting invoice', Infinity, 'NaN', false]) assert.equal(financeMoney(value), '—');
});
test('only exact native states expose quote, invoice, PO and AP decisions', () => {
  assert.deepEqual(availableFinanceDecisions('quotes', quote), ['approve_quote', 'return_quote']);
  assert.deepEqual(availableFinanceDecisions('quotes', { ...quote, status: 'Owner Approved' }), []);
  assert.deepEqual(availableFinanceDecisions('invoices', invoice), ['approve_invoice']);
  assert.deepEqual(availableFinanceDecisions('invoices', { ...invoice, status: 'Approved' }), ['issue_invoice']);
  assert.deepEqual(availableFinanceDecisions('invoices', { ...invoice, status: 'Issued' }), []);
  assert.deepEqual(availableFinanceDecisions('purchasing', po), ['approve_po', 'return_po']);
  assert.deepEqual(availableFinanceDecisions('purchasing', ap), ['approve_ap', 'return_ap']);
  assert.deepEqual(availableFinanceDecisions('purchasing', { ...ap, status: 'Open PO' }), ['return_ap']);
  assert.deepEqual(availableFinanceDecisions('purchasing', { ...ap, paid: true }), []);
  assert.deepEqual(availableFinanceDecisions('purchasing', { ...ap, match: 'Exception' }), []);
});
test('quote, invoice and purchasing decisions are not reachable', () => {
  assert.throws(() => financeDecisionRequest('quotes', quote, 'return_quote', 'Clarify scope'), /not available/);
  assert.throws(() => financeDecisionRequest('invoices', { ...invoice, status: 'Approved' }, 'issue_invoice'), /not available/);
  assert.throws(() => financeDecisionRequest('purchasing', po, 'approve_po'), /not available/);
  assert.throws(() => financeDecisionRequest('purchasing', ap, 'approve_ap'), /not available/);
});
test('readback confirms native transitions including quote return creating exactly one Draft revision', () => {
  const cases = [
    [quote, 'approve_quote', { ...quote, status: 'Owner Approved' }],
    [quote, 'return_quote', { ...quote, status: 'Draft', locked: false, revision: 4 }],
    [invoice, 'approve_invoice', { ...invoice, status: 'Approved' }],
    [{ ...invoice, status: 'Approved' }, 'issue_invoice', { ...invoice, status: 'Issued' }],
    [po, 'approve_po', { ...po, status: 'Open PO', poApproved: true }],
    [po, 'return_po', { ...po, status: 'Purchase Request Returned' }],
    [ap, 'approve_ap', { ...ap, status: 'Approved for Payment', approved: true }],
    [ap, 'return_ap', { ...ap, status: 'Needs Review', approved: false, match: 'Exception' }],
  ];
  for (const [before, decision, after] of cases) {
    assert.equal(hasConfirmedFinanceDecision([after], before, decision), true, decision);
    assert.equal(hasConfirmedFinanceDecision([before], before, decision), false, decision);
    assert.equal(hasConfirmedFinanceDecision([{ ...after, id: otherId }], before, decision), false, decision);
    assert.equal(hasConfirmedFinanceDecision([after, after], before, decision), false, decision);
  }
  assert.equal(hasConfirmedFinanceDecision([{ ...quote, status: 'Draft', locked: false, revision: 3 }], quote, 'return_quote'), false);
  assert.equal(hasConfirmedFinanceDecision([{ ...quote, status: 'Draft', locked: false, revision: 5 }], quote, 'return_quote'), false);
  assert.equal(hasConfirmedFinanceDecision([{ ...ap, status: 'Needs Review', match: 'Matched' }], ap, 'return_ap'), false);
});
test('finance saves are not reachable and do not post', async () => {
  let writes = 0;
  const saver = createFinanceDecisionSaver({ post: async () => { writes++; return { data: {} }; }, get: async () => ({ data: {} }) });
  await assert.rejects(saver.save('quotes', quote, 'approve_quote'), /not available/);
  await assert.rejects(saver.save('invoices', invoice, 'approve_invoice'), /not available/);
  await assert.rejects(saver.save('purchasing', ap, 'approve_ap'), /not available/);
  assert.equal(writes, 0);
});

test('a stale list cannot authorize review of a changed detail or another quote revision', () => {
  assert.equal(financeDetailMatchesRow('quotes', quote, { ...quote, status: 'review' }), true);
  assert.equal(financeDetailMatchesRow('quotes', quote, { ...quote, revision: 4 }), false);
  assert.equal(financeDetailMatchesRow('quotes', quote, { ...quote, status: 'draft' }), false);
  assert.equal(financeDetailMatchesRow('invoices', invoice, { ...invoice, status: 'approved' }), false);
  assert.equal(financeDetailMatchesRow('purchasing', ap, { ...ap, id: otherId }), false);
});

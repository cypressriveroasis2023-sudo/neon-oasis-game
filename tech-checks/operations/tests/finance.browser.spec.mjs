import { test, expect } from '@playwright/test';
// Finance fixture data is test-only. The route guard prevents all remote
// requests from reaching an actual service, including financial writes.
const origin = 'http://127.0.0.1:4173';
const edge = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const quoteId = '11111111-1111-4111-8111-111111111111';
const invoiceId = '22222222-2222-4222-8222-222222222222';
const poId = '33333333-3333-4333-8333-333333333333';
const apId = '44444444-4444-4444-8444-444444444444';
const harness = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0}</style></head><body><iframe id="operations" src="/?theme=classic" title="Finance fixture"></iframe><script>addEventListener("message",function(event){var frame=document.getElementById("operations");if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data.type!=="COS_OPERATIONS_TOKEN_REQUEST")return;event.source.postMessage({type:"COS_OPERATIONS_TOKEN_RESPONSE",requestId:event.data.requestId,accessToken:"synthetic-owner-session",role:"owner"},location.origin)});</script></body></html>';
const makeState = () => ({
  quotes: [{ id: quoteId, quoteNumber: 'FIX-Q-101', customer: 'Fixture North Yard', site: 'North Gate', title: 'Fixture security proposal', status: 'Pending Owner Approval', locked: true, revision: 3, amount: 1200 }],
  invoices: [{ id: invoiceId, invoiceNumber: 'FIX-I-101', customer: 'Fixture North Yard', jobNumber: 'FIX-J-101', status: 'Pending Owner Approval', amount: '$1,200.00' }],
  purchasing: [
    { id: poId, po: 'FIX-PO-101', vendor: 'Fixture Vendor', job: 'FIX-J-101', status: 'Pending Owner PO Approval', poApproved: false, approved: false, paid: false, match: 'Pending', amount: '$600.00' },
    { id: apId, po: 'FIX-PO-102', vendor: 'Fixture Supply', job: 'Shop Inventory', status: 'Ready for AP Approval', poApproved: true, approved: false, paid: false, match: 'Matched', amount: '$800.00', receipt: 'Received in full', invoice: 'FIX-VI-101', invoiceAmount: '$800.00' },
  ], requests: [], writes: [], failed: new Set(), mismatch: false,
});
const paths = { quotes: '/api/quotes', invoices: '/api/ar', purchasing: '/api/purchasing' };
function details(kind, row) {
  return { ...row, customerName: row.customer, siteName: row.site, vendorName: row.vendor, total: kind === 'quotes' ? 1200 : 800, amountDue: 1200, scope: 'Synthetic scope for owner review', notes: 'Synthetic record notes', lines: [{ id: 'fixture-line', description: 'Fixture equipment readiness', quantity: 1, unit: 'each', unitPrice: 800, total: 800 }], activity: ['Synthetic record loaded'] };
}
async function start(page) {
  const state = makeState();
  await page.route('**/*', async route => {
    const request = route.request(), url = request.url();
    if (url === origin + '/finance-harness') return route.fulfill({ status: 200, contentType: 'text/html', body: harness });
    if (url.startsWith(origin + '/')) return route.continue();
    if (url !== edge) return route.abort('blockedbyclient');
    const headers = { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    expect(request.method()).toBe('POST');
    expect(await request.headerValue('authorization')).toBe('Bearer synthetic-owner-session');
    const envelope = request.postDataJSON();
    const { path, method, body } = envelope;
    state.requests.push(envelope);
    if (state.failed.has(path)) return route.fulfill({ status: 503, contentType: 'application/json', headers, body: JSON.stringify({ error: 'Synthetic financial source unavailable' }) });
    let data;
    if (method === 'GET' && path === '/api/routers') data = { items: [], source: 'camera_health', gpsAvailable: false, generatedAt: new Date().toISOString() };
    else if (method === 'GET' && path === '/api/session') data = { authorized: true, name: 'Fixture Owner', role: 'Owner' };
    else if (method === 'GET' && ['/api/jobs', '/api/owner-tasks'].includes(path)) data = { items: [] };
    else {
      const kind = Object.keys(paths).find(key => path === paths[key] || path.startsWith(paths[key] + '/'));
      if (!kind) throw new Error('Unexpected finance fixture path: ' + path);
      const suffix = path.slice(paths[kind].length), id = suffix.split('/')[1];
      const row = state[kind].find(record => record.id === id);
      if (method === 'GET') {
        if (!suffix) data = { items: state[kind] };
        else if (row) data = details(kind, state.mismatch ? { ...row, status: 'Unexpected state' } : row);
        else throw new Error('Unknown finance fixture record');
      } else if (method === 'POST' && row) {
        state.writes.push(envelope);
        if (kind === 'quotes' && path.endsWith('/action')) {
          row.status = body.action === 'approve' ? 'Owner Approved' : 'Draft';
          row.locked = body.action === 'approve';
          if (body.action === 'return') row.revision += 1;
          data = { quote_id: row.id, status: body.action === 'approve' ? 'approved' : 'draft', returned: body.action === 'return' };
        } else if (kind === 'invoices' && path.endsWith('/action')) {
          row.status = body.action === 'approve' ? 'Approved' : 'Issued'; data = { invoice_id: row.id };
        } else if (kind === 'purchasing' && path.endsWith('/po-review')) {
          row.status = body.action === 'approve' ? 'Open PO' : 'Purchase Request Returned';
          row.poApproved = body.action === 'approve'; data = { purchase_order_id: row.id };
        } else if (kind === 'purchasing' && path.endsWith('/approve')) {
          row.status = 'Approved for Payment'; row.approved = true; data = { purchase_order_id: row.id };
        } else if (kind === 'purchasing' && path.endsWith('/return')) {
          row.status = 'Needs Review'; row.approved = false; row.match = 'Exception'; data = { purchase_order_id: row.id };
        } else throw new Error('Unexpected finance fixture write: ' + path);
      } else throw new Error('Unexpected finance fixture method');
    }
    return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(data) });
  });
  await page.goto('/finance-harness');
  const frame = page.frameLocator('#operations');
  await expect(frame.getByRole('button', { name: 'Today', exact: true })).toBeVisible();
  return { frame, state };
}
async function navigate(frame, name) {
  const more = frame.getByRole('button', { name: 'More', exact: true });
  if (await more.isVisible()) await more.click();
  await frame.getByRole('navigation', { name: 'COS Operations', exact: true }).getByRole('button', { name, exact: true }).click();
  await expect(frame.getByRole('region', { name: name + ' review', exact: true })).toBeVisible();
}
async function noOverflow(page) {
  const frame = page.frames().find(item => item.parentFrame());
  const size = await frame.evaluate(() => ({
    width: innerWidth,
    content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    overflow: Array.from(document.querySelectorAll('body *')).filter(element => {
      const bounds = element.getBoundingClientRect(), style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.right > innerWidth + 1;
    }).map(element => {
      const bounds = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { tag: element.tagName, className: element.className, text: element.textContent?.trim().slice(0, 70), left: bounds.left, right: bounds.right, width: bounds.width, display: style.display, position: style.position, minWidth: style.minWidth, maxWidth: style.maxWidth, grid: style.gridTemplateColumns, flex: style.flex, whiteSpace: style.whiteSpace };
    }).sort((a, b) => b.right - a.right).slice(0, 25),
  }));
  expect(size.content, JSON.stringify(size)).toBeLessThanOrEqual(size.width + 1);
}
test('native Quotes show real detail and require a return reason; one decision persists after reload', async ({ page }) => {
  const { frame, state } = await start(page);
  await navigate(frame, 'Quotes');
  await frame.getByRole('button', { name: 'Return to Sales', exact: true }).click();
  const dialog = frame.getByRole('dialog', { name: 'Quotes record', exact: true });
  await expect(dialog.getByText('Fixture equipment readiness', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Return to Sales', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('A return reason is required.');
  expect(state.writes).toHaveLength(0);
  await dialog.getByLabel('Return reason').fill('Synthetic scope needs clarification');
  await dialog.getByRole('button', { name: 'Return to Sales', exact: true }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Return to Sales saved and verified.' })).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].body).toEqual({ action: 'return', reason: 'Synthetic scope needs clarification' });
  expect(state.quotes[0].revision).toBe(4);
  await noOverflow(page);
  await page.reload();
  await navigate(frame, 'Quotes');
  await expect(frame.locator('.finance-records .record').filter({ hasText: 'FIX-Q-101' })).toContainText('Draft');
  expect(state.writes).toHaveLength(1);
  await expect(frame.getByRole('link', { name: 'Quote builder ↗', exact: true })).toBeVisible();
});
test('Invoices approve and issue with fresh list/detail confirmation at both viewport sizes', async ({ page }) => {
  const { frame, state } = await start(page);
  await navigate(frame, 'Invoices');
  await frame.getByRole('button', { name: 'Approve Invoice', exact: true }).click();
  const dialog = frame.getByRole('dialog', { name: 'Invoices record', exact: true });
  await expect(dialog.getByText('Fixture equipment readiness', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Approve Invoice', exact: true }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Approve Invoice saved and verified.' })).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Owner decision', exact: true }).selectOption('issue_invoice');
  await dialog.getByRole('button', { name: 'Issue Invoice', exact: true }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Issue Invoice saved and verified.' })).toBeVisible();
  expect(state.writes).toHaveLength(2);
  expect(state.writes.map(write => write.body.action)).toEqual(['approve', 'issue']);
  await noOverflow(page);
  await page.reload();
  await navigate(frame, 'Invoices');
  await expect(frame.locator('.finance-records .record')).toContainText('Issued');
  await expect(frame.getByRole('link', { name: 'Customer payments ↗', exact: true })).toBeVisible();
});
test('Purchasing preserves native PO and AP decision paths and three-way match details', async ({ page }) => {
  const { frame, state } = await start(page);
  await navigate(frame, 'Purchasing');
  await frame.getByRole('button', { name: 'Owner Approve PO', exact: true }).click();
  let dialog = frame.getByRole('dialog', { name: 'Purchasing record', exact: true });
  await expect(dialog.getByText('Fixture equipment readiness', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Owner Approve PO', exact: true }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Owner Approve PO saved and verified.' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close record', exact: true }).click();
  await frame.getByRole('button', { name: 'AP Approvals', exact: true }).click();
  await frame.getByRole('button', { name: 'Approve for Payment', exact: true }).click();
  dialog = frame.getByRole('dialog', { name: 'Purchasing record', exact: true });
  await expect(dialog.getByText('Fixture equipment readiness', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Approve for Payment', exact: true }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Approve for Payment saved and verified.' })).toBeVisible();
  expect(state.writes.map(write => write.path)).toEqual(['/api/purchasing/' + poId + '/po-review', '/api/purchasing/' + apId + '/approve']);
  await noOverflow(page);
  await dialog.getByRole('button', { name: 'Close record', exact: true }).click();
  await frame.getByRole('button', { name: '3-Way Match', exact: true }).click();
  await expect(frame.locator('.finance-match').filter({ hasText: 'FIX-VI-101' })).toContainText('Received in full');
  await expect(frame.getByRole('link', { name: 'Vendor payments and documents ↗', exact: true })).toBeVisible();
});
test('unverified finance save blocks repeat writes until a successful explicit refresh', async ({ page }) => {
  const { frame, state } = await start(page);
  await navigate(frame, 'Invoices');
  await frame.getByRole('button', { name: 'Approve Invoice', exact: true }).click();
  const dialog = frame.getByRole('dialog', { name: 'Invoices record', exact: true });
  await expect(dialog.getByText('Fixture equipment readiness', { exact: true })).toBeVisible();
  state.mismatch = true;
  await dialog.getByRole('button', { name: 'Approve Invoice', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Decision accepted, but the saved record could not be verified.');
  await expect(dialog.getByRole('button', { name: 'Approve Invoice', exact: true })).toBeDisabled();
  expect(state.writes).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Close record', exact: true }).click();
  state.mismatch = false;
  await frame.getByRole('button', { name: 'Refresh Invoices', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Issue Invoice', exact: true })).toBeEnabled();
  expect(state.writes).toHaveLength(1);
  await noOverflow(page);
});

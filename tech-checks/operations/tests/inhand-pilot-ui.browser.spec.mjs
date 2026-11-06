import { test, expect } from '@playwright/test';
import { mountInhandPilot, pilotRequests, runRequests, deferred } from './fixtures/inhand-pilot-browser.mjs';
import { pilotControl, pilotSnapshot, pilotDevice } from './fixtures/inhand-pilot.mjs';
const panel = frame => frame.getByRole('region', { name: 'One-run InHand connection test', exact: true });
const run = frame => panel(frame).getByRole('button', { name: 'Test InHand connection', exact: true });
const check = frame => panel(frame).getByRole('button', { name: 'Check test status', exact: true });
const result = frame => frame.getByRole('region', { name: 'InHand test result', exact: true });
async function leaveAndReturn(frame) {
  await frame.getByRole('button', { name: 'Leave router workspace', exact: true }).click();
  await expect(panel(frame)).toHaveCount(0);
  await frame.getByRole('button', { name: 'Return to router workspace', exact: true }).click();
  await expect(panel(frame)).toBeVisible();
}
test('no pilot request on load, idle time or navigation; manual status is metadata only', async ({ page }) => {
  await page.clock.install();
  const { frame, state } = await mountInhandPilot(page);
  await expect(run(frame)).toBeEnabled();
  expect(pilotRequests(state)).toHaveLength(0);
  await expect(panel(frame)).not.toContainText(pilotDevice.serialNumber);
  await page.clock.fastForward(180000);
  await leaveAndReturn(frame);
  expect(pilotRequests(state)).toHaveLength(0);
  await check(frame).click();
  await expect(panel(frame)).toContainText('Ready at last check');
  await expect(panel(frame)).toContainText(pilotDevice.serialNumber);
  expect(pilotRequests(state).map(request => [request.method, request.path])).toEqual([['GET', '/api/inhand-pilot/status']]);
  await page.clock.fastForward(180000);
  expect(pilotRequests(state)).toHaveLength(1);
});
test('single explicit test survives repeated clicks; result is truthful and layouts fit phone and desktop', async ({ page }, info) => {
  const hold = deferred();
  const { frame, state } = await mountInhandPilot(page, { runHold: hold.promise });
  await run(frame).evaluate(button => { button.click(); button.click(); button.click(); });
  await expect.poll(() => runRequests(state).length).toBe(1);
  await expect(run(frame)).toBeDisabled(); await expect(check(frame)).toBeDisabled();
  expect(runRequests(state)[0].body).toEqual({});
  hold.release();
  await expect(result(frame)).toBeVisible();
  await expect(result(frame)).toContainText('Unknown · not independently probed');
  await expect(result(frame)).toContainText('cellTower (cell-tower estimate)');
  await expect(result(frame)).toContainText('Stale · more than 10 minutes old');
  await expect(result(frame)).toContainText('192.0.2.44'); await expect(result(frame)).toContainText('10.0.0.8');
  await expect(result(frame)).toContainText('no map pin was moved');
  expect(state.requests.every(request => request.method === 'GET' || request.path === '/api/inhand-pilot/run')).toBe(true);
  for (const width of [320, page.viewportSize().width]) {
    await page.setViewportSize({ width, height: 900 });
    const size = await frame.locator('body').evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
    expect(size.content).toBeLessThanOrEqual(size.width + 1);
  }
  await page.screenshot({ path: info.outputPath('inhand-pilot-result.png'), fullPage: true });
  await leaveAndReturn(frame);
  await expect(result(frame)).toHaveCount(0); await expect(run(frame)).toBeDisabled();
  await check(frame).click();
  await expect(panel(frame)).toContainText('It remains locked; no new test was run');
  await run(frame).evaluate(button => button.click());
  expect(runRequests(state)).toHaveLength(1);
});
for (const stateName of ['unarmed', 'expired', 'consumed']) test(`${stateName} blocks provider test with an explanation`, async ({ page }) => {
  const { frame, state } = await mountInhandPilot(page, { control: pilotControl(stateName) });
  await run(frame).click();
  await expect(panel(frame)).toContainText(stateName === 'unarmed' ? 'not armed yet' : stateName === 'expired' ? 'window has expired' : 'already been used');
  expect(runRequests(state)).toHaveLength(0);
  if (stateName === 'consumed') { await leaveAndReturn(frame); await expect(run(frame)).toBeDisabled(); state.control = pilotControl(); await check(frame).click(); await expect(run(frame)).toBeDisabled(); }
});
test('future test window is shown as unarmed without a provider request', async ({ page }) => {
  const control = { ...pilotControl(), state: 'unarmed', armedAt: '2026-10-06T16:05:00Z', expiresAt: '2026-10-06T16:10:00Z' };
  const { frame, state } = await mountInhandPilot(page, { control });
  await run(frame).click(); await expect(panel(frame)).toContainText('not armed yet'); expect(runRequests(state)).toHaveLength(0);
});
test('result accepts only the exact device identity obtained from authenticated status', async ({ page }) => {
  const control = pilotControl(); control.device.id = '222222222222222222222222'; control.device.serialNumber = 'SYNTHETIC000002';
  const snapshot = pilotSnapshot(); snapshot.identity.deviceId = control.device.id; snapshot.identity.serialNumber = control.device.serialNumber;
  const { frame, state } = await mountInhandPilot(page, { control, result: snapshot });
  await expect(panel(frame)).not.toContainText(control.device.serialNumber);
  await run(frame).click(); await expect(result(frame)).toContainText(control.device.serialNumber);
  expect(runRequests(state)).toHaveLength(1);
});
test('a well-shaped result identity from another status device is rejected and locked', async ({ page }) => {
  const control = pilotControl(); control.device.id = '222222222222222222222222'; control.device.serialNumber = 'SYNTHETIC000002';
  const { frame, state } = await mountInhandPilot(page, { control });
  await run(frame).click(); await expect(panel(frame).getByRole('alert')).toContainText('remains locked');
  await expect(result(frame)).toHaveCount(0); await expect(run(frame)).toBeDisabled(); expect(runRequests(state)).toHaveLength(1);
});
test('expiry during the GET response cannot spend a stale ready window', async ({ page }) => {
  const control = { ...pilotControl(), expiresAt: '2026-10-06T16:00:00.050Z' };
  const { frame, state } = await mountInhandPilot(page, { control, statusDelay: 100 });
  await run(frame).click();
  await expect(panel(frame)).toContainText('window has expired'); expect(runRequests(state)).toHaveLength(0);
});
for (const statusError of [401, 403, 503]) test(`status HTTP ${statusError} never sends a run and safely redacts the error`, async ({ page }) => {
  const { frame, state } = await mountInhandPilot(page, { statusError });
  await run(frame).click();
  await expect(panel(frame).getByRole('alert')).toBeVisible();
  await expect(panel(frame)).not.toContainText('DO_NOT_DISPLAY'); expect(runRequests(state)).toHaveLength(0);
  await expect(run(frame)).toBeEnabled();
});
test('unexpected control identity is rejected before the POST', async ({ page }) => {
  const control = pilotControl(); control.device.id = 'unexpected';
  const { frame, state } = await mountInhandPilot(page, { control });
  await run(frame).click(); await expect(panel(frame)).toContainText('Test status could not be verified'); expect(runRequests(state)).toHaveLength(0);
});
for (const failure of ['transport', 'malformed', 'wrong-device', 401, 403, 503]) test(`uncertain POST ${failure} stays locked across navigation and ready metadata`, async ({ page }) => {
  const snapshot = pilotSnapshot(); if (failure === 'wrong-device') snapshot.identity.deviceId = 'wrong';
  const { frame, state } = await mountInhandPilot(page, { abortRun: failure === 'transport', result: failure === 'malformed' ? { error: 'DO_NOT_DISPLAY' } : snapshot, runError: typeof failure === 'number' ? failure : 0 });
  await run(frame).click();
  await expect(panel(frame).getByRole('alert')).toContainText('remains locked');
  await expect(panel(frame)).not.toContainText('DO_NOT_DISPLAY'); await expect(result(frame)).toHaveCount(0);
  await leaveAndReturn(frame); await expect(run(frame)).toBeDisabled();
  await check(frame).click(); await expect(panel(frame)).toContainText('It remains locked');
  await expect(run(frame)).toBeDisabled(); expect(runRequests(state)).toHaveLength(1);
});
test('leaving during preflight discards it, does not POST, and prevents remount overlap', async ({ page }) => {
  const hold = deferred(); const { frame, state } = await mountInhandPilot(page, { statusHold: hold.promise });
  await run(frame).click(); await expect.poll(() => pilotRequests(state).length).toBe(1);
  await leaveAndReturn(frame); await expect(run(frame)).toBeDisabled();
  hold.release(); await expect(run(frame)).toBeEnabled();
  expect(runRequests(state)).toHaveLength(0); await expect(result(frame)).toHaveCount(0);
});
test('leaving during the POST preserves its lock and discards late telemetry', async ({ page }) => {
  const hold = deferred(); const { frame, state } = await mountInhandPilot(page, { runHold: hold.promise });
  await run(frame).click(); await expect.poll(() => runRequests(state).length).toBe(1);
  await leaveAndReturn(frame); hold.release();
  await expect(check(frame)).toBeEnabled(); await expect(run(frame)).toBeDisabled(); await expect(result(frame)).toHaveCount(0);
  expect(runRequests(state)).toHaveLength(1);
});
test('trusted host hide clears telemetry; untrusted self-message cannot clear it or unlock', async ({ page }) => {
  const { frame, state } = await mountInhandPilot(page); await run(frame).click(); await expect(result(frame)).toBeVisible();
  await frame.locator('body').evaluate(() => window.postMessage({ type: 'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE' }, location.origin));
  await expect(result(frame)).toBeVisible();
  await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ type: 'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE' }, location.origin));
  await expect(result(frame)).toHaveCount(0); await expect(run(frame)).toBeDisabled(); expect(runRequests(state)).toHaveLength(1);
});
test('auth change destroys the iframe; the next account cannot see previous telemetry', async ({ page }) => {
  const { frame, state } = await mountInhandPilot(page); await run(frame).click(); await expect(result(frame)).toBeVisible();
  await page.evaluate(() => { window.fixtureRole = 'service'; const old = document.querySelector('iframe'); const fresh = old.cloneNode(); old.remove(); document.body.append(fresh); });
  await expect(result(frame)).toHaveCount(0); await expect(run(frame)).toBeEnabled();
  await run(frame).click(); await expect(panel(frame).getByRole('alert')).toContainText('Owner sign-in could not be verified');
  expect(runRequests(state)).toHaveLength(1);
  const persisted = await frame.locator('body').evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(persisted).not.toContain('192.0.2.44'); expect(persisted).not.toContain('Synthetic tower location');
});
test('missing data and absent location are explicit without invented telemetry', async ({ page }) => {
  const snapshot = pilotSnapshot(); snapshot.network.publicIp = null; snapshot.network.wanIp = null; snapshot.identity.name = null; snapshot.location = null; snapshot.locationUnavailableReason = 'missing'; snapshot.connection.reportedStatus = 'unknown';
  const { frame } = await mountInhandPilot(page, { result: snapshot }); await run(frame).click();
  await expect(result(frame)).toContainText('InHand did not return a location');
  await expect(result(frame).getByText('Not reported', { exact: true })).toHaveCount(3);
  await expect(result(frame)).not.toContainText('Synthetic tower location');
});

test('POST timeout is uncertain, stays locked, and ignores a late response', async ({ page }) => {
  await page.clock.install();
  const hold = deferred(); const { frame, state } = await mountInhandPilot(page, { runHold: hold.promise });
  await run(frame).click(); await expect.poll(() => runRequests(state).length).toBe(1);
  await page.clock.fastForward(30001);
  await expect(panel(frame).getByRole('alert')).toContainText('remains locked');
  hold.release();
  await expect(run(frame)).toBeDisabled(); await expect(result(frame)).toHaveCount(0);
  await check(frame).click(); await expect(panel(frame)).toContainText('It remains locked');
  expect(runRequests(state)).toHaveLength(1);
});
for (const event of ['pagehide', 'visibilitychange']) test(`${event} clears private result without resetting the run lock`, async ({ page }) => {
  const { frame, state } = await mountInhandPilot(page); await run(frame).click(); await expect(result(frame)).toBeVisible();
  await frame.locator('body').evaluate((_, event) => {
    if (event === 'visibilitychange') { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event(event)); }
    else window.dispatchEvent(new Event(event));
  }, event);
  await expect(result(frame)).toHaveCount(0); await expect(run(frame)).toBeDisabled(); expect(runRequests(state)).toHaveLength(1);
});
test('authorization denial on a later metadata check clears previous telemetry', async ({ page }) => {
  const { frame, state } = await mountInhandPilot(page); await run(frame).click(); await expect(result(frame)).toBeVisible();
  state.statusError = 403; await check(frame).click();
  await expect(panel(frame).getByRole('alert')).toContainText('does not have permission');
  await expect(result(frame)).toHaveCount(0); await expect(run(frame)).toBeDisabled(); expect(runRequests(state)).toHaveLength(1);
});

import {test, expect} from '@playwright/test';
import {mountFleet, units, fresh, now} from './fleet-dashboard-fixtures.mjs';
import {mountServiceBasics} from './helpers/service-basics-fixture.mjs';

const router = {
  id: 'synthetic-router',
  unitKey: 'Helios 1',
  name: 'Fixture InHand',
  model: 'IR615',
  publicIp: '203.0.113.10',
  unitIp: null,
  port: 443,
  protocol: 'https',
  probeStatus: 'online',
  checkedAt: fresh,
  lastRecoveredAt: fresh,
  reportedStatus: 'Online',
  reportedAt: fresh,
  reportedSource: 'Synthetic fixture',
  savedLatencyMs: 23,
  match: 'exact_name',
  candidateUnit: {id: units[0].id, unitNumber: 'Helios 1'},
  gps: null,
  boardStatus: 'Online',
  boardCheckedAt: fresh,
  boardOutage: false,
  doNotUse: true,
};

for (const it of [false, true]) {
  test(`${it ? 'IT' : 'Owner'} sees router status and the do-not-use badge`, async ({page}, info) => {
    const {app} = await mountFleet(page, it, {routers: [router]});
    const row = app.locator('.cos-fleet-unit-row').filter({hasText: 'Helios 1'});
    await expect(row).toContainText('Online');
    await expect(row).toContainText('DO NOT USE');
    await row.click();
    const drawer = app.getByRole('dialog');
    await expect(drawer).toContainText('DO NOT USE');
    await expect(drawer).toContainText('Online');
    await expect(drawer).toContainText('203.0.113.10');
    await page.screenshot({path: info.outputPath(`${it ? 'it' : 'owner'}-${info.project.name}.png`), fullPage: true});
  });
}

test('a router label becomes Unknown after 3 hours when refreshes stop', async ({page}) => {
  const {app} = await mountFleet(page, false, {routers: [router], advancingClock: true});
  const row = app.locator('.cos-fleet-unit-row').filter({hasText: 'Helios 1'});
  await expect(row.locator('.cos-fleet-router-text')).toContainText('Online');
  await app.locator('body').evaluate(() => {
    Object.defineProperty(document, 'hidden', {configurable: true, get: () => true});
  });
  await page.clock.fastForward(3 * 60 * 60 * 1000 + 60 * 1000);
  await expect(row.locator('.cos-fleet-router-text')).toContainText('Unknown');
  await expect(row.locator('.cos-fleet-router-text')).not.toContainText('Online');
});

test('a Shop unit says In Shop on the fleet card, details, equipment cards and routers page', async ({page}) => {
  const shop = {...router, id: 'shop-router', unitKey: 'Sniper 44', boardStatus: 'In Shop', probeStatus: 'offline', doNotUse: false, candidateUnit: {id: units[3].id, unitNumber: 'Sniper 44'}};
  const {app} = await mountFleet(page, false, {routers: [shop]});
  await app.getByLabel('Fleet placement').selectOption('shop');
  const row = app.locator('.cos-fleet-unit-row').filter({hasText: 'Sniper 44'});
  await expect(row.locator('.cos-fleet-router-text')).toContainText('In Shop');
  await expect(row.locator('.cos-fleet-router-text')).not.toContainText('Offline');
  const marks = row.locator('.cos-signal-shop');
  await expect(marks).toHaveCount(2);
  for (const mark of await marks.all()) expect(await mark.evaluate(node => getComputedStyle(node).color)).toBe('rgb(100, 116, 139)');
  await row.click();
  const card = app.locator('.cos-fleet-router-card');
  await expect(card.locator('.cos-signal-shop')).toContainText('In Shop');
  await expect(card).not.toContainText('Offline');
  await app.getByRole('button', {name: 'Close unit details'}).click();
  await app.getByRole('button', {name: 'Fleet health'}).click();
  await expect(app.locator('.cos-equipment-card').filter({hasText: 'Sniper 44'})).toContainText('In Shop');
  await expect(app.locator('.cos-equipment-card').filter({hasText: 'Sniper 44'})).not.toContainText('Offline');
  await page.locator('iframe').evaluate(frame => { frame.contentWindow.location.hash = '#inhand-routers'; });
  const routers = app.getByRole('region', {name: 'InHand Routers workspace'});
  await expect(routers.locator('.router-list .router-shop')).toHaveText('In Shop');
  await expect(routers.locator('.router-detail .router-shop')).toHaveText('In Shop');
  await expect(routers.locator('.router-list')).not.toContainText('Offline');
});

test('a false do-not-use flag renders no badge on the router card', async ({page}) => {
  const {app} = await mountFleet(page, false, {routers: [{...router, doNotUse: false}]});
  const row = app.locator('.cos-fleet-unit-row').filter({hasText: 'Helios 1'});
  await expect(row.locator('.cos-do-not-use-badge')).toHaveCount(0);
  await row.click();
  await expect(app.locator('.cos-fleet-router-card .cos-do-not-use-badge')).toHaveCount(0);
});

test('the do-not-use badge keeps readable text on the router card', async ({page}) => {
  const {app} = await mountFleet(page, false, {routers: [router]});
  await app.locator('.cos-fleet-unit-row').filter({hasText: 'Helios 1'}).click();
  const badge = app.locator('.cos-fleet-router-card .cos-do-not-use-badge');
  await expect(badge).toHaveText('DO NOT USE');
  expect(await badge.evaluate(node => getComputedStyle(node).color)).toBe('rgb(154, 52, 18)');
});

test('a reading older than 3 hours shows Unknown on the fleet card, unit details, and routers page', async ({page}) => {
  const old = new Date(now - 4 * 60 * 60 * 1000).toISOString();
  const stale = {...router, doNotUse: false, boardStatus: 'Online', boardCheckedAt: old, checkedAt: old, reportedAt: old};
  const {app} = await mountFleet(page, false, {routers: [stale]});
  const row = app.locator('.cos-fleet-unit-row').filter({hasText: 'Helios 1'});
  await expect(row.locator('.cos-fleet-router-text')).toContainText('Unknown');
  await expect(row.locator('.cos-fleet-router-text')).not.toContainText('Online');
  await row.click();
  const card = app.locator('.cos-fleet-router-card');
  await expect(card.locator('.cos-fleet-badge')).toContainText('Unknown');
  await expect(card.locator('.cos-do-not-use-badge')).toHaveCount(0);
  await page.locator('iframe').evaluate(frame => { frame.contentWindow.location.hash = '#inhand-routers'; });
  const routers = app.getByRole('region', {name: 'InHand Routers workspace'});
  await expect(routers).toBeVisible();
  await expect(routers.locator('.router-list .router-badge')).toHaveText('Unknown');
  await expect(routers.locator('.router-detail .router-badge')).toHaveText('Unknown');
});

test('Service inventory does not gain a router address', async ({page}, info) => {
  await mountServiceBasics(page);
  await expect(page.locator('body')).not.toContainText('203.0.113.10');
  await page.screenshot({path: info.outputPath(`service-${info.project.name}.png`), fullPage: true});
  await page.evaluate(() => window.setIdentity(null));
  await expect(page.locator('body')).not.toContainText('203.0.113.10');
  await page.screenshot({path: info.outputPath(`signed-out-${info.project.name}.png`), fullPage: true});
});

import {test, expect} from '@playwright/test';
import {mountFleet, units, fresh} from './fleet-dashboard-fixtures.mjs';
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

test('Service inventory does not gain a router address', async ({page}, info) => {
  await mountServiceBasics(page);
  await expect(page.locator('body')).not.toContainText('203.0.113.10');
  await page.screenshot({path: info.outputPath(`service-${info.project.name}.png`), fullPage: true});
  await page.evaluate(() => window.setIdentity(null));
  await expect(page.locator('body')).not.toContainText('203.0.113.10');
  await page.screenshot({path: info.outputPath(`signed-out-${info.project.name}.png`), fullPage: true});
});

import {test, expect} from '@playwright/test';
import {mountFleet, fresh, vrm} from './fleet-dashboard-fixtures.mjs';
import {openFleetView} from './fleet-view-navigation-helper.mjs';
import {countUnits} from '../shared/starUnitStatus.ts';

const helios = {
  unit: 'HELIOS 001',
  placement: 'FIELD',
  site: 'Fixture yard',
  siteNamePending: false,
  state: 'GREEN',
  cameras: 1,
  online: 1,
  offline: 0,
  unknown: 0,
  down: [],
  onlineInShop: false,
  publicIp: null,
  observedAt: fresh,
  cameraList: [{name: 'HELIOS 001 / Cam 1', status: 'online', atSite: true}],
  source: 'star4live',
};
const shopSniper = {
  ...helios,
  unit: 'SNIPER 4-100',
  placement: 'SHOP',
  state: 'RED',
  online: 0,
  offline: 1,
  cameraList: [{name: 'SNIPER 4-100 / Cam 1', status: 'offline', atSite: true}],
  source: 'ip_check',
};
const units = [helios, shopSniper];
const report = {
  contract: 'COS_STAR_UNIT_STATUS_V1',
  units,
  counts: countUnits(units),
  feed: {provider: 'star4live', syncedAt: fresh, status: 'ok', enabled: true, fresh: true, ageMs: 1000},
  handEditsRead: true,
  otherSourcesRead: true,
  canEdit: true,
  refreshedAt: fresh,
  source: 'Star4Live',
};

test('Camera status, Fleet and the phone landing show the same battery-alarm count', async ({page}) => {
  const power = structuredClone(vrm);
  power.power[0].measurements.push({metric: 'battery_voltage', unit: 'V', value: 10, instance: 512, source: 'battery', observedAt: fresh});
  await page.addInitScript(() => {
    localStorage.setItem('cos-power-alarm-settings-v1', JSON.stringify({lowVoltageV: 12, lowSocPercent: null, silentHours: null}));
  });
  const {app} = await mountFleet(page, false, {vrm: power, cameraStatus: report});
  const fleet = app.locator('.cos-fleet-dashboard');
  const phone = app.locator('.cos-phone-landing');
  await expect(fleet).toHaveAttribute('data-shared-problem-count', '1');
  await expect(phone).toHaveAttribute('data-problem-count', '1');
  await expect(phone.locator('.cos-todo-card')).toHaveCount(1);
  await expect(phone).toContainText('HELIOS 001');
  await expect(phone).toContainText('voltage alarm');
  await expect(phone).not.toContainText('Power readings have been silent');
  await expect(phone).not.toContainText('SNIPER 4-100');
  await openFleetView(app, /Camera status/);
  const camera = app.locator('.cos-camera-status');
  await expect(camera).toHaveAttribute('data-problem-count', '1');
  await expect(camera.locator('.cos-todo-card')).toHaveCount(1);
  await expect(camera).toContainText('HELIOS 001');
  await expect(camera).toContainText('voltage alarm');
  await expect(fleet).toHaveAttribute('data-shared-problem-count', '1');
});

const oldAt = '2026-10-01T00:00:00Z';

async function expectNoPowerProblem(page, power) {
  await page.addInitScript(() => {
    localStorage.setItem('cos-power-alarm-settings-v1', JSON.stringify({lowVoltageV: 12, lowSocPercent: 20, silentHours: 1}));
  });
  const {app} = await mountFleet(page, false, {vrm: power, cameraStatus: report});
  const fleet = app.locator('.cos-fleet-dashboard');
  const phone = app.locator('.cos-phone-landing');
  await expect(fleet).toHaveAttribute('data-shared-problem-count', '0');
  await expect(phone).toHaveAttribute('data-problem-count', '0');
  const phoneTodos = phone.locator('.cos-tech-todos');
  await expect(phone.locator('.cos-todo-card')).toHaveCount(0);
  await expect(phoneTodos).not.toContainText('Power readings have been silent');
  await expect(phoneTodos).not.toContainText('voltage alarm');
  await openFleetView(app, /Camera status/);
  const camera = app.locator('.cos-camera-status');
  const cameraTodos = camera.locator('.cos-tech-todos');
  await expect(camera).toHaveAttribute('data-problem-count', '0');
  await expect(camera.locator('.cos-todo-card')).toHaveCount(0);
  await expect(cameraTodos).not.toContainText('Power readings have been silent');
  await expect(cameraTodos).not.toContainText('voltage alarm');
  await expect(cameraTodos).toContainText('No evidence-backed jobs');
  await expect(fleet).toHaveAttribute('data-shared-problem-count', '0');
}

test('an old Victron read shows no power Problem', async ({page}, info) => {
  test.skip(![390, 1440].includes(info.project.use.viewport?.width), 'covered at 390 and 1440');
  const power = structuredClone(vrm);
  for (const row of power.power) for (const sample of row.measurements) sample.observedAt = oldAt;
  power.power[0].measurements.push({metric: 'battery_voltage', unit: 'V', value: 10, instance: 512, source: 'battery', observedAt: oldAt});
  await expectNoPowerProblem(page, power);
});

test('a stalled Victron read shows no power Problem', async ({page}, info) => {
  test.skip(![390, 1440].includes(info.project.use.viewport?.width), 'covered at 390 and 1440');
  const power = structuredClone(vrm);
  power.sync = {error: 'Synthetic Victron sync stalled', state: 'error', lastAttemptAt: oldAt, lastSuccessAt: oldAt};
  power.power[0].measurements.push({metric: 'battery_voltage', unit: 'V', value: 10, instance: 512, source: 'battery', observedAt: fresh});
  await expectNoPowerProblem(page, power);
});

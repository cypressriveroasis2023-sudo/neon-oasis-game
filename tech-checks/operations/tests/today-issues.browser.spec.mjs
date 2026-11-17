import {test, expect} from '@playwright/test';
import {mountFleet, field as baseField} from './fleet-dashboard-fixtures.mjs';

function withRecon() {
  const custom = structuredClone(baseField);
  const sample = custom.items[0];
  const recon = {...sample, id: '00000000-0000-4000-8000-000000000099', unitNumber: 'RECON 9', modelName: 'Recon', currentLocationType: 'field', placement: 'FIELD', status: 'field'};
  custom.items = [...custom.items, recon];
  custom.inventoryItems = [...(custom.inventoryItems || []), recon];
  custom.summary = {...custom.summary, fieldUnits: custom.items.length};
  return custom;
}

test('today issues lead the board on phone, desktop, and TV-sized viewports', async ({page}, testInfo) => {
  const {app, state} = await mountFleet(page, false, {field: withRecon(), skipInitialFieldCount: true});
  const hub = app.getByRole('region', {name: "Today's issues"});
  await expect(hub).toBeVisible();
  await expect(hub.getByRole('heading', {name: "Today's issues"})).toBeVisible();
  const about = app.locator('.cos-phone-board-info > summary');
  await expect(about).toBeVisible();
  await expect(app.getByRole('heading', {name: 'Fleet inventory and saved health snapshot'})).toBeHidden();
  await about.click();
  await expect(app.getByText('This board is inventory, not live health.')).toBeVisible();
  const spotter = hub.getByRole('button', {name: /spotter 1/i});
  await expect(spotter).toBeVisible();
  await spotter.click();
  const guide = hub.getByRole('region', {name: /troubleshooting spotter 1/i});
  await expect(guide).toBeVisible();
  await guide.getByRole('button', {name: 'Refresh reading'}).click();
  await guide.getByLabel('Notes').fill('Camera still dark.');
  await guide.getByRole('button', {name: 'Still broken'}).click();
  await expect(guide).toContainText('Recorded: still broken.');
  const recon = app.getByRole('region', {name: 'Recon field cameras'});
  await expect(recon).toBeVisible();
  await expect(recon).toContainText('unknown');
  await expect(guide).toContainText('Recorded: still broken.');
  if (testInfo.project.name === 'desktop-1024') await expect(app.locator('.tech-check-tv')).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

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
  await expect(hub.getByRole('heading', {name: 'To do'})).toBeVisible();
  await expect(app.getByRole('heading', {name: 'Fleet inventory and saved health snapshot'})).toBeHidden();
  const spotter = hub.getByRole('button', {name: 'Open unit'}).first();
  await expect(spotter).toBeVisible();
  await hub.getByRole('button', {name: 'Check off'}).first().click();
  await app.getByText('Details', {exact: true}).click();
  await app.getByText('About this board', {exact: true}).click();
  await expect(app.getByText('This board is inventory, not live health.')).toBeVisible();
  const recon = app.getByRole('region', {name: 'Recon field cameras'});
  await expect(recon).toBeVisible();
  await expect(recon).toContainText('unknown');
  if (testInfo.project.name === 'desktop-1024') await expect(app.locator('.tech-check-tv')).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

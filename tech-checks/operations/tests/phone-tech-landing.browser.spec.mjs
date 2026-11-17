import {test, expect} from '@playwright/test';
import {mountFleet, now} from './fleet-dashboard-fixtures.mjs';

const owner = '11111111-1111-4111-8111-111111111111';
const features = {fleetAccess: false, vrmRead: true, unitTracker: true};
const readingKey = 'cos-saved-fleet-reading-v1:' + JSON.stringify([
  owner, true, 'Owner', '',
  Object.keys(features).sort().map(key => [key, features[key]]),
]);
const saved = {checkedAt: now - 2 * 60 * 60 * 1000, field: 20, shop: 9, online: 7, offline: 1, unverified: 3};

test('phone first screen, desktop inventory card, and TV-sized inventory card', async ({page}, testInfo) => {
  const project = testInfo.project.name;
  const phone = project === 'mobile-390';
  await page.addInitScript(({key, value}) => localStorage.setItem(key, JSON.stringify(value)), {key: readingKey, value: saved});
  const {app, state} = await mountFleet(page, false, {
    productionOwnerUserId: owner,
    skipInitialFieldCount: phone,
    holdField: phone,
  });
  const landing = app.getByRole('region', {name: 'Phone technician landing'});
  const about = app.getByRole('group', {name: 'About this board'}).or(app.locator('.cos-phone-board-info'));
  const identity = app.getByRole('heading', {name: 'Fleet inventory and saved health snapshot'});
  const sentence = app.getByText('This board is inventory, not live health.');
  if (phone) {
    await expect(landing).toBeVisible();
    await expect(landing.getByRole('group', {name: 'Field units up, down and unknown'})).toBeVisible();
    await expect(landing.locator('.cos-phone-counts b')).toHaveText(['7', '1', '3']);
    await expect(landing).toContainText('not current');
    await expect(landing).toContainText('Unknown is not offline');
    await expect(landing.getByRole('region', {name: 'Technician to-do'})).toBeVisible();
    await expect(identity).toBeHidden();
    await expect(app.getByText('About this board')).toBeVisible();
    await app.getByText('About this board').click();
    await expect(identity).toBeVisible();
    await expect(sentence).toBeVisible();
    state.releaseField();
    await expect(landing.locator('.cos-phone-counts b')).toHaveText(['1', '1', '1']);
    await expect(landing).not.toContainText('not current');
    await expect(landing.getByRole('listitem')).toContainText(['Spotter 1']);
    await expect(landing).not.toContainText('Sniper 44');
  } else {
    await expect(landing).toBeHidden();
    await expect(identity).toBeHidden();
    await expect(app.getByText('About this board')).toBeVisible();
    await app.getByText('About this board').click();
    await expect(identity).toBeVisible();
    await expect(sentence).toBeVisible();
    if (project === 'desktop-1024') await expect(app.locator('.tech-check-tv')).toHaveCount(0);
  }
  expect(state.errors).toEqual([]);
});

import {test, expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';

test('service sees only the checklist', async ({page}) => {
  const {app} = await mountFleet(page, false, {staff: 'service', skipInitialFieldCount: true});
  const board = app.getByRole('region', {name: 'COS Fleet Dashboard'});
  await expect(board.getByRole('heading', {name: 'To do'})).toBeVisible();
  await expect(board.getByText('Details', {exact: true})).toHaveCount(0);
  await expect(board.getByRole('navigation', {name: 'Fleet dashboard views'})).toHaveCount(0);
  await expect(board.getByRole('button', {name: 'Account and password'})).toHaveCount(0);
  await expect(app.getByRole('navigation', {name: 'COS Operations'})).toHaveCount(0);
  await expect(app.getByRole('navigation', {name: 'Mobile Operations navigation'})).toHaveCount(0);
});

test('IT is blocked from account and password changes', async ({page}) => {
  const {app} = await mountFleet(page, true, {skipInitialFieldCount: true});
  await app.getByText('Details', {exact: true}).click();
  await app.getByRole('button', {name: 'Account and password'}).click();
  await expect(app.getByRole('alert')).toContainText('Account, password, and security changes stay with the owner.');
});

test('the owner can open account settings', async ({page}) => {
  const {app} = await mountFleet(page, false, {skipInitialFieldCount: true});
  await app.getByText('Details', {exact: true}).click();
  await app.getByRole('button', {name: 'Account and password'}).click();
  await expect(app.getByText('Owner account settings.')).toBeVisible();
  await expect(app.getByRole('alert')).toHaveCount(0);
});

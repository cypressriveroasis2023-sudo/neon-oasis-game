import {test, expect} from '@playwright/test';

const EXAMPLE = 'EXAMPLE-SIM-0007';

test('the cancellation stays blocked until the SIM step is saved, and lists keep the last four', async ({page}) => {
  await page.goto('/?simCancelPreview=1');
  const step = page.getByRole('main', {name: 'SIM card canceled'});
  await expect(step.getByRole('button', {name: 'Mark cancellation complete'})).toBeDisabled();
  await expect(step.getByRole('button', {name: 'Cancel SIM: SNIPER 014'})).toBeVisible();
  await expect(step).toContainText('This cancellation is not complete.');
  await expect(step.getByText(EXAMPLE)).toHaveCount(0);
  await step.locator('select').selectOption('Verizon');
  await step.locator('input[type="date"]').fill('2026-11-17');
  await step.getByLabel('Who canceled it').fill('Example IT');
  await step.getByLabel('SIM number').fill(EXAMPLE);
  await step.getByRole('button', {name: 'Save this step'}).click();
  await expect(step.getByRole('button', {name: 'Mark cancellation complete'})).toBeEnabled();
  await expect(step.getByText('•••• 0007')).toBeVisible();
  await expect(step.getByLabel('SIM number')).toHaveValue(EXAMPLE);
  const board = step.locator('.cos-sim-board');
  await expect(board).toContainText('•••• 0007');
  await expect(board).not.toContainText(EXAMPLE);
  await step.getByRole('button', {name: 'Mark cancellation complete'}).click();
  await expect(step.getByRole('button', {name: 'Cancel SIM: SNIPER 014'})).toHaveCount(0);
  await expect(step).toContainText('Cancellation complete.');
});

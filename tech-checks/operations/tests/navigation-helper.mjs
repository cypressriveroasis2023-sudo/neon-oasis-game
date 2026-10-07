import { expect } from '@playwright/test';
const labels = { Today: 'Dashboard', 'Camera Health': 'Camera Health', 'InHand Routers': 'InHand Routers', 'Victron VRM': 'Victron Power', 'Units On Hand': 'Units On Hand', 'Field Map': 'Field View', Team: 'Team', Operations: 'Operations' };
const directoryLabels = { 'Tech Check':'Tech Checks', Jobs: 'Job flow', Billing: 'Billing & Invoices', Invoices: 'Billing & Invoices', 'Daily Board': 'Dispatch Board' };

export async function openWorkspace(frame, workspace) {
  const label = labels[workspace];
  const menu = frame.getByRole('dialog', { name: 'Operations navigation' });
  if (!(await menu.count())) await frame.getByRole('button', { name: 'More', exact: true }).click();
  await expect(menu).toBeVisible();
  const nav = menu.getByRole('navigation', { name: 'COS Operations', exact: true });
  await nav.getByRole('button', { name: label || 'Operations', exact: true }).click();
  if (!label) {
    const directory = frame.getByRole('region', { name: 'Operations workspaces', exact: true });
    await expect(directory).toBeVisible();
    await directory.getByRole('button', { name: directoryLabels[workspace] || workspace, exact: true }).first().click();
  }
  await expect(menu).toHaveCount(0);
}

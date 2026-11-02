import { expect } from '@playwright/test';

// Display names are explicit test expectations, not imports from the implementation.
// Always use the visible UI: no hash injection, forced clicks or role overrides.
const primaryLabels = {
  'Fleet Dashboard': 'Fleet', 'Field Map': 'Fleet', 'Field View': 'Fleet',
  'Daily Board': 'Boards', 'Tech Check': 'Tech Check', Team: 'Team', Operations: 'More',
};
const toolLabels = {
  Today: 'Overview', 'Units On Hand': 'Shop inventory', 'Victron VRM': 'Victron Power',
  Jobs: 'Job flow', Billing: 'Billing & Invoices', Invoices: 'Billing & Invoices',
};
const restrictedLabels = {
  'Field Map': 'Fleet Dashboard', 'Field View': 'Fleet Dashboard',
  'IT Dashboard': 'IT Dashboard', 'Tech Check': 'Tech Checks',
  'Victron VRM': 'Victron Power', Today: 'Overview',
};

export async function openWorkspace(frame, workspace) {
  await expect(frame.locator('.company-connection')).toHaveText('OPERATIONS CONNECTED');
  const menu = frame.getByRole('dialog', { name: 'Operations navigation', exact: true });
  const mobile = frame.getByRole('navigation', { name: 'Mobile Operations navigation', exact: true });
  const sidebar = frame.getByRole('navigation', { name: 'COS Operations', exact: true });
  const nav = await menu.isVisible() ? menu.getByRole('navigation', { name: 'COS Operations', exact: true })
    : await mobile.isVisible() ? mobile : sidebar;

  if (!(await frame.locator('.cos-approved-shell').count())) {
    // Keep IT's existing restricted destinations. Missing entries must fail;
    // this helper never mounts an Owner tool to get around a denied route.
    const label = restrictedLabels[workspace] || workspace;
    const direct = nav.getByRole('button', { name: label, exact: true });
    if (await direct.isVisible()) await direct.click();
    else {
      if (!(await menu.isVisible())) await nav.getByRole('button', { name: 'More', exact: true }).click();
      await expect(menu).toBeVisible();
      await menu.getByRole('navigation', { name: 'COS Operations', exact: true })
        .getByRole('button', { name: label, exact: true }).click();
    }
  } else if (primaryLabels[workspace] && workspace !== 'Operations') {
    await nav.getByRole('button', { name: primaryLabels[workspace], exact: true }).click();
  } else {
    if (!(await menu.isVisible())) await nav.getByRole('button', { name: 'More', exact: true }).click();
    if (workspace === 'Operations') {
      // On a phone the bottom More opens a drawer; its primary More opens
      // the actual More page. Desktop More already opens that page.
      if (await menu.isVisible()) await menu.getByRole('navigation', { name: 'COS Operations', exact: true })
        .getByRole('button', { name: 'More', exact: true }).click();
      await expect(frame.locator('main').getByRole('region', { name: 'Operations workspaces', exact: true })).toBeVisible();
    } else {
      const container = await menu.isVisible() ? menu : frame.locator('main');
      const directory = container.getByRole('region', { name: 'Operations workspaces', exact: true });
      await expect(directory).toBeVisible();
      const label = toolLabels[workspace] || workspace;
      await directory.getByRole('searchbox', { name: 'Find a tool', exact: true }).fill(label);
      const destination = directory.getByRole('button', { name: label, exact: true });
      await expect(destination).toHaveCount(1);
      await destination.click();
    }
  }
  await expect(menu).toHaveCount(0);
}

import { expect } from '@playwright/test';
// Mirrors RETIRED_WORKSPACES in src/approvedCosNavigation.ts; a node test keeps them equal.
export const RETIRED_WORKSPACES = ['Jobs','Dispatch','Unscheduled','Work Requests','Quotes','CRM',
  'Billing','Invoices','Payments','Collections','Accounting','Purchasing','Reports',
  'Daily Board','Owner Review','Owner Tasks','Handoffs','Needs Attention'];

// Display names are explicit test expectations, not imports from the implementation.
// Always use the visible UI: no hash injection, forced clicks or role overrides.
// One exception: a retired workspace has no visible way in, so it is opened by
// its own link (see below). Nothing else may use that path.
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
  const approved = Boolean(await frame.locator('.cos-approved-shell').count());
  // Owner phone More contains secondary tools only. Close it before using a
  // primary bottom-bar destination; do not click a hidden duplicate menu.
  if (approved && primaryLabels[workspace] && workspace !== 'Operations' && await menu.isVisible())
    await menu.getByRole('button', { name: /Close menu/ }).click();
  const nav = !approved && await menu.isVisible() ? menu.getByRole('navigation', { name: 'COS Operations', exact: true })
    : await mobile.isVisible() ? mobile : sidebar;
  if (!approved) await expect(frame.getByRole('navigation', { name: 'COS Operations', exact: true, includeHidden: true })
    .getByRole('button', { name: restrictedLabels[workspace] || workspace, exact: true, includeHidden: true })).toHaveCount(1);

  // A caller may already have opened this workspace through its bookmark.
  // Do not leave it for More and remount it: that adds an artificial saved read
  // and resets selection. Read the URL only; never assign or inject a hash.
  const routeAliases = {
    Today: ['today', 'overview', 'dashboard'],
    'Field Map': ['fleet-dashboard', 'field-map', 'field-view', ''],
    'Field View': ['fleet-dashboard', 'field-map', 'field-view', ''],
    'Fleet Dashboard': ['fleet-dashboard', 'field-map', 'field-view', ''],
    'Daily Board': ['daily-board', 'dispatch-board'],
    'Victron VRM': ['victron-vrm', 'victron-power'],
    Invoices: ['invoices', 'billing'], Billing: ['billing', 'invoices'],
  };
  const keys = routeAliases[workspace] || [workspace.toLowerCase().replaceAll(' ', '-')];
  const currentKey = await frame.locator('body').evaluate(() => location.hash.replace(/^#/, '').split('?')[0]);
  if (keys.includes(currentKey)) {
    if (await menu.isVisible()) await menu.getByRole('button', { name: /Close menu/ }).click();
    await expect(frame.locator('main')).toBeVisible();
    return;
  }

  // Retired workspaces (RETIRED_WORKSPACES in src/approvedCosNavigation.ts) are no
  // longer offered in any menu, but their routes are kept. Reach them by their own
  // link, as a bookmark would; the spec still checks the screen itself.
  if (RETIRED_WORKSPACES.includes(workspace)) {
    if (await menu.isVisible()) await menu.getByRole('button', { name: /Close menu/ }).click();
    // One navigation, as the app sees a single route change. Assigning
    // location.hash fires popstate AND hashchange, and the app answers both, so
    // a spec that counts reads would see the screen load twice.
    await frame.locator('body').evaluate((_, hash) => { history.replaceState(history.state, '', '#' + hash); dispatchEvent(new HashChangeEvent('hashchange')); }, keys[0]);
    await expect.poll(() => frame.locator('body').evaluate(() => location.hash.replace(/^#/, '').split('?')[0])).toBe(keys[0]);
    await expect(frame.locator('main')).toBeVisible();
    return;
  }

  if (!approved) {
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
      // More is the existing drawer on phones and the tools page on desktop.
      // Neither route injection nor a duplicate primary row is needed.
      const container = await menu.isVisible() ? menu : frame.locator('main');
      await expect(container.getByRole('region', { name: 'Operations workspaces', exact: true })).toBeVisible();
      return;
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

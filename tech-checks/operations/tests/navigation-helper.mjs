import { expect } from '@playwright/test';
import { primaryAreas } from '../src/visionAreas.ts';
import { workspaceLabel } from '../src/workspaceNavigation.ts';

export async function openWorkspace(frame, workspace) {
  const primary = primaryAreas.find(area => area.workspace === workspace);
  const menu = frame.getByRole('dialog', { name: 'Operations navigation' });
  if (!(await menu.count())) await frame.getByRole('button', { name: 'More', exact: true }).click();
  await expect(menu).toBeVisible();
  const nav = menu.getByRole('navigation', { name: 'COS Operations', exact: true });
  await nav.getByRole('button', { name: primary?.label || 'Operations', exact: true }).click();
  if (!primary) {
    const directory = frame.getByRole('region', { name: 'Operations workspaces', exact: true });
    await expect(directory).toBeVisible();
    await directory.getByRole('button', { name: workspaceLabel(workspace), exact: true }).first().click();
  }
  await expect(menu).toHaveCount(0);
}

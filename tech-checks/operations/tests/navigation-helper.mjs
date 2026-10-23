import { expect } from '@playwright/test';
const labels = { 'COS Overview':'Overview', 'Camera Health': 'Camera Health', 'InHand Routers': 'Power & Routers', 'Victron VRM': 'Power & Routers', 'Units On Hand': 'Inventory & Transfers', 'Field Map': 'Fleet Map', 'Fleet Dashboard':'Fleet Map', 'Unit Tracker': 'Unit Tracker', Team: 'Team & Tech Check', 'Tech Check':'Team & Tech Check', Calendar:'Calendar' };
const advancedLabels = {Today:'Legacy daily and job overview',Operations:'Existing Operations tools','Daily Board':'Existing TV and daily board controls','Owner Tasks':'Owner assignments',Equipment:'Equipment administration'};
const directoryLabels = { 'Tech Check':'Tech Checks', Jobs: 'Job flow', Billing: 'Billing & Invoices', Invoices: 'Billing & Invoices', 'Daily Board': 'Dispatch Board' };

export async function openWorkspace(frame, workspace) {
  const label = labels[workspace];
  const menu = frame.getByRole('dialog', { name: 'Operations navigation' });
  if (!(await menu.count())) await frame.getByRole('button', { name: 'More', exact: true }).click();
  await expect(menu).toBeVisible();
  const nav = menu.getByRole('navigation', { name: 'COS Operations', exact: true });
  if(label) await nav.getByRole('button', { name: label, exact: true }).click();
  else {
    const advanced=menu.locator('details.cos-owner-advanced');
    await expect(advanced).toBeVisible();
    if(await advanced.getAttribute('open')===null) await advanced.locator('summary').click();
    await advanced.getByRole('button',{name:advancedLabels[workspace]||'Existing Operations tools',exact:true}).click();
  }
  if (!label && !advancedLabels[workspace]) {
    const directory = frame.getByRole('region', { name: 'Operations workspaces', exact: true });
    await expect(directory).toBeVisible();
    await directory.getByRole('button', { name: directoryLabels[workspace] || workspace, exact: true }).first().click();
  }
  await expect(menu).toHaveCount(0);
  if(workspace==='InHand Routers') await frame.getByRole('navigation',{name:'Power and router tabs'}).getByRole('button',{name:'InHand Routers',exact:true}).click();
  if(workspace==='Tech Check') await frame.getByRole('navigation',{name:'Technician views'}).getByRole('button',{name:'Tech Checks & transfers',exact:true}).click();
}

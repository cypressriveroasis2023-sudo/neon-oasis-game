import {test,expect} from '@playwright/test';
import {mountFleet,now} from './fleet-dashboard-fixtures.mjs';
import {statusPinsFixture} from './fixtures/fleet-status-pins-fixture.mjs';
import {openWorkspace} from './navigation-helper.mjs';
test('saved inventory remains usable when the independent health read fails',async({page})=>{
 const {app,state}=await mountFleet(page,false,{field:statusPinsFixture().field});
 const savedLabel=app.locator('.cos-fleet-heading > div:last-child > small');await expect(savedLabel).toBeVisible();await expect(savedLabel).toContainText('Saved health ');const label=await savedLabel.innerText();
 await expect(app.getByRole('button',{name:'↻ Refresh data',exact:true})).toBeEnabled();await expect(app.locator('.cos-fleet-stat-field strong')).toHaveText('287');await expect(app.locator('.cos-fleet-stats')).not.toContainText('…');const counts=await app.locator('.cos-fleet-stats button strong').allTextContents();
 await page.clock.setFixedTime(new Date(now+60000));
 state.fail=true;await app.getByRole('button',{name:/Refresh data/}).click();
 const warning=app.getByRole('alert').filter({hasText:'Last completed results remain displayed with their original check times.'});
 await expect(warning).toBeVisible();await expect(warning.getByText('Last completed results remain displayed with their original check times. The next successful update will replace them.',{exact:true})).toBeVisible();
 await warning.locator('summary').click();await expect(warning.getByText('Synthetic saved camera read unavailable',{exact:true})).toBeVisible();
 await expect(savedLabel).toHaveText(label);await expect(app.locator('.cos-fleet-stats button strong')).toHaveText(counts);
 await openWorkspace(app,'Today');const inventory=app.getByRole('region',{name:'Shared equipment inventory'});
 await expect(inventory.getByRole('button',{name:'287 Field equipment'})).toBeVisible();
 await expect(inventory.getByRole('button',{name:'714 Shop / ROOT'})).toBeVisible();
 expect(state.calls.every(c=>c.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});
test('malformed refresh retains the last reviewed inventory with an explicit failure',async({page})=>{
 const {app,state}=await mountFleet(page,false,{field:statusPinsFixture().field});await openWorkspace(app,'Today');
 const inventory=app.getByRole('region',{name:'Shared equipment inventory'});
 await expect(inventory.getByRole('button',{name:'287 Field equipment'})).toBeVisible();
 state.field.uploadInventory.summary.fieldRecords=99;
 await inventory.getByRole('button',{name:'Refresh inventory',exact:true}).click();
 await expect(inventory.getByRole('alert')).toContainText('Showing the last successful inventory');
 await expect(inventory.getByRole('button',{name:'287 Field equipment'})).toBeVisible();
 await expect(inventory.getByRole('button',{name:'714 Shop / ROOT'})).toBeVisible();
 expect(state.errors).toEqual([]);
});
test('private inventory clears immediately on session invalidation',async({page})=>{
 const {app}=await mountFleet(page,false,{field:statusPinsFixture().field});await openWorkspace(app,'Today');
 await expect(app.getByRole('region',{name:'Shared equipment inventory'}).getByRole('button',{name:'287 Field equipment'})).toBeVisible();
 await app.locator('body').evaluate(()=>window.dispatchEvent(new Event('cos-private-data-invalidated')));
 await expect(app.getByRole('region',{name:'Shared equipment inventory'})).toHaveCount(0);
 await expect(app.getByRole('heading',{name:'Operations access needs attention'})).toBeVisible();
});

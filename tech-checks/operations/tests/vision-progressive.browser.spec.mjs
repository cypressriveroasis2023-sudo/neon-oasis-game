import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {statusPinsFixture} from './fixtures/fleet-status-pins-fixture.mjs';
import {openWorkspace} from './navigation-helper.mjs';
test('saved inventory remains usable when the independent health read fails',async({page})=>{
 const {app,state}=await mountFleet(page,false,{field:statusPinsFixture().field});
 state.fail=true;await app.getByRole('button',{name:/Refresh data/}).click();
 await expect(app.getByRole('alert').filter({hasText:'Health refresh unavailable'})).toBeVisible();
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

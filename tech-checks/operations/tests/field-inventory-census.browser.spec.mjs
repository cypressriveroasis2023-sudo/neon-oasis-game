import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';

for(const it of [false,true])test((it?'IT':'Owner')+' retains every recorded Field product when saved camera health fails',async({page})=>{
 const f=fieldProductFixture(),{app,state}=await mountFleet(page,it,{field:f.field,health:f.health});
 const list=app.getByRole('region',{name:'Field inventory health breakdown'});
 await expect(list).toBeVisible();await expect(list.locator('li')).toHaveCount(7);await expect(list).not.toContainText('Product 1008');
 await expect(list.locator('li').filter({hasText:'Product 1006'})).toContainText('FIELD');
 state.fail=true;await app.locator('.cos-fleet-refresh').click();
 await expect(app.getByText('Synthetic saved camera read unavailable',{exact:false}).first()).toBeVisible();
 await expect(list).toBeVisible();await expect(list.locator('li')).toHaveCount(7);await expect(list).toContainText('Connectivity is unavailable');
 await expect(app.locator('.cos-fleet-stat-field strong')).toHaveText('7');
 for(const id of ['1001','1002','1003','1004','1005','1006','1007'])await expect(list.locator('li').filter({hasText:'Product '+id})).toContainText('FIELD');
 expect(state.field).toEqual(f.field);expect(state.calls.every(c=>c.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});

test('accepted Product-ID census remains visible without a COS identity roster',async({page})=>{
 const f=fieldProductFixture();delete f.field.fleetRoster;
 // Keep a valid but empty legacy representation layer. It is not the census.
 f.field.items=[];f.field.inventoryItems=[];f.field.summary={fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0};
 const {app,state}=await mountFleet(page,false,{field:f.field,health:f.health,skipInitialFieldCount:true});
 await expect(app.locator('.cos-fleet-stat-field strong')).toHaveText('7');
 const list=app.getByRole('region',{name:'Field inventory health breakdown'});await expect(list).toBeVisible();await expect(list.locator('li')).toHaveCount(7);
 expect(state.calls.every(c=>c.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});

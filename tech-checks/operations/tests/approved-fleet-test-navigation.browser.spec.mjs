import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {openFleetView,fleetViewButton} from './fleet-view-navigation-helper.mjs';

for(const it of [false,true])test((it?'IT':'Owner')+' test navigation uses visible permitted Fleet controls and preserves source evidence',async({page})=>{
 const {app,state}=await mountFleet(page,it);
 const before=structuredClone(state.field);
 const nav=app.getByRole('navigation',{name:'Fleet dashboard views',exact:true});
 for(const name of [/Data sources/,/Location verification/,/Fleet health/,/^.*Map$/]){
  await openFleetView(app,name);
  await expect(nav.getByRole('button',{name,includeHidden:true})).toHaveAttribute('aria-current','page');
  await expect(nav.locator('details.cos-approved-fleet-tools[open]')).toHaveCount(0);
 }
 if(it){
  await expect(nav.getByRole('button',{name:/Needs setup/,includeHidden:true})).toHaveCount(0);
  await expect(nav.locator('details.cos-approved-fleet-tools')).toHaveCount(1);
  await nav.locator('summary[aria-label="More fleet tools"]').click();
  await expect(nav.getByRole('button',{name:/Location verification/})).toBeVisible();
  await expect(nav.getByRole('button',{name:/^Data sources$/})).toBeVisible();
 }else{
  const setup=await fleetViewButton(app,/Needs setup/);
  await expect(setup).toBeVisible();
  await expect(nav.locator('details.cos-approved-fleet-tools')).toHaveAttribute('open');
  await setup.click();
  await expect(nav.locator('summary[aria-label="More fleet tools"]')).toBeFocused();
 }
 expect(state.field).toEqual(before);
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);
 expect(state.errors).toEqual([]);
});

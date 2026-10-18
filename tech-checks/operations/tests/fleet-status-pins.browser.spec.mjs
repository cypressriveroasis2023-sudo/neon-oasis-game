import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {statusPinsFixture} from './fixtures/fleet-status-pins-fixture.mjs';
for(const it of [false,true])test(`Fleet status pin colors, mixed selection and failed reads ${it?'IT':'Owner'}`,async({page},testInfo)=>{
 const {app,state}=await mountFleet(page,it,{field:statusPinsFixture().field});
 const marker=id=>app.locator(`.cos-mhelp-address-marker[data-mhelp-product-ids='["${id}"]']`);
 for(const [id,status,color] of [['1001','online','rgb(43, 255, 53)'],['1002','offline','rgb(255, 39, 52)'],['1003','unknown','rgb(148, 163, 184)'],['1004','support','rgb(21, 168, 255)'],['1005','unknown','rgb(148, 163, 184)'],['1006','unknown','rgb(148, 163, 184)'],['1007','unknown','rgb(148, 163, 184)']]){
  await expect(marker(id)).toHaveAttribute('data-health',status);
  await expect(marker(id).locator('path')).toHaveCSS('fill',color);
 }
 await expect(marker('1001').locator('.cos-address-review-flag')).toHaveText('!');
 await expect(app.locator('.cos-dashboard-marker .cos-status-pin-art path')).toHaveCount(1);
 await marker('1001').click({force:true});
 await expect(app.getByRole('dialog')).toBeVisible();
 await page.keyboard.press('Escape');
 await app.locator('.cos-fleet-map-panel').screenshot({path:testInfo.outputPath('status-pins.png')});
 state.field.mhelpAddressMap.items[1].latitude=state.field.mhelpAddressMap.items[0].latitude;
 await app.getByRole('button',{name:/Refresh data/}).click();
 const group=app.locator(`.cos-mhelp-address-marker[data-mhelp-product-ids='["1001","1002"]']`);
 await expect(group).toHaveAttribute('data-health','mixed');
 await expect(group).toHaveAttribute('aria-label',/1 online, 1 offline/);
 await expect(group.locator('.cos-address-status-dots i')).toHaveCount(2);
 await group.click({force:true});
 await expect(app.getByRole('dialog')).toBeVisible();
 await expect(app.getByRole('dialog').getByRole('button')).toHaveCount(3);
 await page.keyboard.press('Escape');
 state.fail=true;
 await app.getByRole('button',{name:/Refresh data/}).click();
 await expect(app.getByRole('alert')).toBeVisible();
 await expect(app.locator('.cos-mhelp-address-marker[data-health="online"]')).toHaveCount(0);
 expect(state.calls.every(r=>r.method==='GET')).toBeTruthy();
 expect(state.errors).toEqual([]);
});

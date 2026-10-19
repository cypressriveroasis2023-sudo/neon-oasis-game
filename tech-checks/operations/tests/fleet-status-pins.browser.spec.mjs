import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {statusPinsFixture} from './fixtures/fleet-status-pins-fixture.mjs';
for(const it of [false,true])test(`Fleet status pin colors, mixed selection and failed reads ${it?'IT':'Owner'}`,async({page},testInfo)=>{
 const {app,state}=await mountFleet(page,it,{field:statusPinsFixture().field});
 await expect(app.locator('.cos-fleet-map-panel')).toHaveAttribute('aria-busy','false');
 await expect.poll(()=>app.locator('.cos-mhelp-address-marker').first().evaluate(n=>n.getBoundingClientRect().width)).toBe(44);
 await expect(app.locator('.cos-fleet-map-canvas')).not.toHaveClass(/leaflet-zoom-anim/);
 await app.locator('.cos-fleet-map-panel').scrollIntoViewIfNeeded();
 await app.locator('.leaflet-control-zoom-in').click(); // Separate nearby sites before checking individual artwork.
 const marker=id=>app.locator(`.cos-mhelp-address-marker[data-mhelp-product-ids='["${id}"]']`);
 for(const [id,status,color] of [['1001','online','rgb(43, 255, 53)'],['1002','offline','rgb(255, 39, 52)'],['1003','unknown','rgb(148, 163, 184)'],['1004','support','rgb(21, 168, 255)'],['1005','unknown','rgb(148, 163, 184)'],['1006','unknown','rgb(148, 163, 184)'],['1007','unknown','rgb(148, 163, 184)']]){
  await expect(marker(id)).toHaveAttribute('data-health',status);
  await expect(marker(id).locator('.cos-unit-pin-drop path')).toHaveCSS('fill',color);
 }
 await expect(app.locator('.cos-address-review-flag')).toHaveCount(0);
 await expect(marker('1001').locator('.cos-unit-pin-drop')).toHaveCSS('width','28px');
 await expect(marker('1001').locator('.cos-unit-pin-drop path')).toHaveAttribute('d',/^M15 1/);
 await expect(app.locator('.cos-dashboard-marker .cos-status-pin-art path')).toHaveCount(0); // Unique Product-ID address replaces its duplicate map reference.
 const canvas=await app.locator('.cos-fleet-map-canvas').boundingBox(),pin=await marker('1001').boundingBox();
 const from={x:canvas.x+canvas.width*.7,y:canvas.y+canvas.height*.5};
 await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(from.x+canvas.x+canvas.width/2-pin.x-pin.width/2,from.y+canvas.y+canvas.height/2-pin.y-pin.height/2,{steps:10});await page.mouse.up();
 await marker('1001').click();
 await expect(app.getByRole('dialog')).toBeVisible();
 await page.keyboard.press('Escape');
 await app.locator('.cos-fleet-map-panel').screenshot({path:testInfo.outputPath('status-pins.png')});
 state.field.mhelpAddressMap.items[1].latitude=state.field.mhelpAddressMap.items[0].latitude;
 state.field.mhelpAddressMap.items[1].longitude=state.field.mhelpAddressMap.items[0].longitude;
 await app.getByRole('button',{name:/Refresh data/}).click();
 await expect(marker('1001')).toHaveAttribute('data-health','online');await expect(marker('1002')).toHaveAttribute('data-health','offline');
 await expect(app.locator('.cos-status-group-ring,.cos-map-group')).toHaveCount(0);
 for(const id of ['1001','1002']){await marker(id).click();await expect(app.getByRole('dialog')).toContainText('Product '+id);await page.keyboard.press('Escape');}
 state.fail=true;
 await app.getByRole('button',{name:/Refresh data/}).click();
 await expect(app.getByRole('alert')).toBeVisible();
 await expect(app.locator('.cos-mhelp-address-marker[data-health="online"]')).toHaveCount(0);
 expect(state.calls.every(r=>r.method==='GET')).toBeTruthy();
 expect(state.errors).toEqual([]);
});

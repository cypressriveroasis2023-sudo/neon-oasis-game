import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {statusPinsFixture} from './fixtures/fleet-status-pins-fixture.mjs';
for(const it of [false,true])test(`Fleet status pin colors, mixed selection and failed reads ${it?'IT':'Owner'}`,async({page},testInfo)=>{
 const fixture=statusPinsFixture();const {app,state}=await mountFleet(page,it,{field:fixture.field,health:fixture.health,productConnections:fixture.connections});
 await expect(app.locator('.cos-fleet-map-panel')).toHaveAttribute('aria-busy','false');
 await expect.poll(()=>app.locator('.cos-mhelp-address-marker').first().evaluate(n=>n.getBoundingClientRect().width)).toBe(44);
 await expect(app.locator('.cos-fleet-map-canvas')).not.toHaveClass(/leaflet-zoom-anim/);
 await app.locator('.cos-fleet-map-panel').scrollIntoViewIfNeeded();
 await app.locator('.leaflet-control-zoom-in').click(); // Separate nearby sites before checking individual artwork.
 const marker=id=>app.locator(`.cos-mhelp-address-marker[data-mhelp-product-ids='["${id}"]']`);
 for(const [id,status,color] of [['1001','online','rgb(43, 255, 53)'],['1002','offline','rgb(255, 39, 52)'],['1003','unknown','rgb(148, 163, 184)'],['1004','support','rgb(21, 168, 255)'],['1005','unknown','rgb(148, 163, 184)'],['1006','unknown','rgb(148, 163, 184)'],['1007','unknown','rgb(148, 163, 184)']]){
  await expect(marker(id)).toHaveAttribute('data-health',status);
  await expect(marker(id).locator('.cos-unit-pin-drop circle')).toHaveCSS('fill',color);
 }
 await expect(app.locator('.cos-address-review-flag')).toHaveCount(0);
 await expect(marker('1001').locator('.cos-unit-pin-drop')).toHaveCSS('width','28px');
 await expect(marker('1001').locator('.cos-unit-pin-drop circle')).toHaveAttribute('r','13');
 await expect(app.locator('.cos-dashboard-marker .cos-status-pin-art circle')).toHaveCount(0); // Unique Product-ID address replaces its duplicate map reference.
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


test('Offline Fleet filter hides unrelated saved address pins without dropping the red unit',async({page})=>{
 const fixture=statusPinsFixture();const {app,state}=await mountFleet(page,false,{field:fixture.field,health:fixture.health,productConnections:fixture.connections});
 await expect(app.locator('.cos-mhelp-address-marker')).toHaveCount(7);
 await app.getByLabel('Field inventory status').selectOption('offline');
 const markers=app.locator('.cos-mhelp-address-marker');
 await expect(markers).toHaveCount(1);
 await expect(markers.first()).toHaveAttribute('data-mhelp-product-id','1002');
 await expect(markers.first()).toHaveAttribute('data-health','offline');
 await expect(app.locator('.cos-compact-group-marker')).toHaveCount(0);
 await app.getByLabel('Field inventory status').selectOption('all');
 await expect(markers).toHaveCount(7);
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);
 expect(state.errors).toEqual([]);
});

for(const it of [false,true])test(`simple card retains real evidence and labeled tools for ${it?'IT':'Owner'}`,async({page})=>{
 const {app,state}=await mountFleet(page,it);
 await app.locator('.cos-fleet-unit-row').filter({hasText:'Helios 1'}).click();
 const card=app.getByRole('dialog',{name:'Helios 1 unit intelligence'});
 await expect(card.getByRole('heading',{name:'Router & connection'})).toBeVisible();
 await expect(card.getByText('Router not linked.',{exact:false})).toBeVisible();
 const vrm=card.getByRole('link',{name:'Open Victron'});
 await expect(vrm).toHaveAttribute('href','https://vrm.victronenergy.com/installation/1001/dashboard');
 await expect(card.getByRole('heading',{name:'Quick troubleshooting'})).toBeVisible();
 await expect(card.getByText('No saved public camera connection is linked', {exact:false})).toBeVisible();
 await expect(card.getByText('Battery voltage',{exact:true})).toBeVisible();
 expect(state.calls.every(c=>c.method==='GET')).toBeTruthy();
 await card.locator('.cos-fleet-troubleshooting>summary').click();
 await expect(card.getByRole('heading',{name:'Advanced settings'})).toBeVisible();
 await expect(card.locator('.cos-fleet-troubleshooting')).toHaveAttribute('open','');
 expect(state.errors).toEqual([]);
});

for(const it of [false,true])test(`circle center marks the recorded location for ${it?'IT':'Owner'}`,async({page})=>{
 const {app}=await mountFleet(page,it);
 await expect(app.locator('.cos-fleet-map-panel')).toHaveAttribute('aria-busy','false');
 await app.getByRole('button',{name:'Fit pins',exact:true}).click();
 const pin=app.locator('.cos-dashboard-marker[data-display-offset="false"] .cos-status-pin-art');
 await expect(pin).toHaveCount(1);
 await expect.poll(async()=>{
  const canvas=await app.locator('.cos-fleet-map-canvas').boundingBox(),circle=await pin.boundingBox();
  return Math.max(Math.abs(circle.x+circle.width/2-canvas.x-canvas.width/2),Math.abs(circle.y+circle.height/2-canvas.y-canvas.height/2));
 }).toBeLessThanOrEqual(2);
});

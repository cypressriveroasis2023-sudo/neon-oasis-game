import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
for(const it of [false,true])test(`Fleet opens first with compact summary design for ${it?'IT':'Owner'}`,async({page},testInfo)=>{
 const f=fieldProductFixture();
 const {app,state}=await mountFleet(page,it,{hash:(it?'&':'?')+'fleetView=helios#fleet-dashboard',field:f.field,health:f.health,productConnections:f.connections,skipInitialFieldCount:true});
 const board=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});
 await expect(board).toHaveAttribute('data-fleet-view','map');
 const nav=app.getByRole('navigation',{name:'Fleet dashboard views',exact:true});
 await expect(nav.getByRole('button',{name:/Helios|Stands/})).toHaveCount(0);
 await expect(board.getByRole('region',{name:'Equipment family totals'})).toBeVisible();
 await expect(board.locator('.cos-equipment-total-helios .cos-equipment-total-number strong')).toHaveText('1');
 await expect(board.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('1');
 await expect(board.locator('.cos-field-product-cards')).toBeVisible();
 await expect(board.locator('.cos-field-product-cards article').first().locator('details').first()).not.toHaveAttribute('open','');
 expect(await board.evaluate(n=>n.scrollWidth<=n.clientWidth+2)).toBe(true);
 if(testInfo.project.name!=='mobile-390'){
  const mapTab=await nav.getByRole('button',{name:/Map/}).boundingBox(),fleetTab=await nav.getByRole('button',{name:/Fleet health/}).boundingBox();
  expect(Math.abs(mapTab.y-fleetTab.y)).toBeLessThan(3);
 }
 if(it)await expect(board.locator('.cos-fleet-refresh')).toHaveCount(0);
 else await expect(board.locator('.cos-fleet-refresh')).toHaveCSS('color','rgb(18, 26, 38)');
 await expect(board.locator('.cos-equipment-total-helios .cos-total-status-online')).toHaveCSS('color','rgb(43, 255, 53)');
 await page.screenshot({path:testInfo.outputPath('fleet-dashboard-default.png'),fullPage:true});
 await board.locator('.cos-fleet-map-panel').scrollIntoViewIfNeeded();
 await page.screenshot({path:testInfo.outputPath('fleet-map-cards.png'),fullPage:true});
 await board.getByRole('button',{name:'View helios →',exact:true}).click();
 await expect(board).toHaveAttribute('data-fleet-view','helios');
 await expect(board.locator('.cos-equipment-grid')).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('helios-unit-power.png'),fullPage:true});
 await nav.getByRole('button',{name:/Map/}).click();
 await expect(board).toHaveAttribute('data-fleet-view','map');
 await board.locator('.cos-equipment-total-helios .cos-total-status-online').click();
 await expect(board.getByRole('region',{name:'Helios online Field units'})).toContainText('Helios 1');
 await page.reload();
 await expect(app.locator('.cos-fleet-board')).toHaveAttribute('data-fleet-view','map');
 expect(state.calls.every(c=>c.method==='GET')).toBe(true);
 expect(state.errors).toEqual([]);
});

import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {statusPinsFixture} from './fixtures/fleet-status-pins-fixture.mjs';
for(const it of [false,true])test(`main Fleet board is map-first and source-labeled for ${it?'IT':'Owner'}`,async({page},testInfo)=>{
 const f=statusPinsFixture();const {app,state}=await mountFleet(page,it,{field:f.field,health:f.health});
 const board=app.locator('.cos-fleet-board');
 await expect(board).toBeVisible();
 const stats=board.locator('.cos-fleet-stats');
 await expect(stats.locator('.cos-fleet-stat-field strong')).toHaveText('287');
 await expect(stats.locator('.cos-fleet-stat-shop strong')).toHaveText('714');
 await expect(stats.locator('.cos-fleet-stat-total strong')).toHaveText('1001');
 await expect(stats.locator('.cos-fleet-stat-unknown strong')).toHaveText('284');
 await expect(stats.locator('button:visible')).toHaveCount(6);
 await expect(board.locator('.cos-fleet-command')).toHaveCount(0);
 await expect(board.locator('.cos-fleet-map-panel')).toHaveAttribute('aria-busy','false');
 await board.getByRole('searchbox',{name:'Search units, customers, sites or addresses'}).fill('Helios');
 // Search scopes the diagnostic representations; the accepted source census is unchanged.
 await expect(stats.locator('.cos-fleet-stat-field')).toContainText('COMBINED FIELD');
 await expect(stats.locator('.cos-fleet-stat-field strong')).toHaveText('1');
 await expect(stats.locator('.cos-fleet-stat-unknown strong')).toHaveText('0');
 await expect(board.getByRole('region',{name:'mHelpDesk equipment Product-ID inventory'})).toContainText('287 Field');
 await board.getByRole('searchbox',{name:'Search units, customers, sites or addresses'}).fill('');
 const map=await board.locator('.cos-fleet-map-panel').boundingBox();
 const units=await board.locator('.cos-fleet-unit-panel').boundingBox();
 await expect(board.locator('.cos-board-system-note')).toContainText('mHelp inventory saved');
 await expect(board.locator('.cos-board-system-note')).toBeVisible();
 const small=testInfo.project.name==='mobile-390';
 if(small){
  expect(map.y).toBeLessThan(630);
  expect(map.y).toBeLessThan(units.y);
  await expect(board.locator('.cos-board-systems')).not.toHaveAttribute('open','');
  await page.screenshot({path:testInfo.outputPath('fleet-board-phone-default.png')});
  await board.locator('.cos-board-systems>summary').click();
 }else{expect(map.x).toBeGreaterThan(units.x+units.width-2);}
 await expect(board.getByRole('button',{name:'View Avigilon details',exact:true})).toBeVisible();
 expect(await board.evaluate(n=>n.scrollWidth<=n.clientWidth+2)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('fleet-board.png')});
 await board.getByRole('button',{name:'View Avigilon details',exact:true}).click();
 await expect(app.getByRole('region',{name:'Complete mHelpDesk Fleet command center'})).toBeVisible();
 await expect(app.getByLabel('Filter all Field products by monitoring system')).toHaveValue('avigilon');
 expect(state.calls.every(c=>c.method==='GET')).toBe(true);
 expect(state.errors).toEqual([]);
});

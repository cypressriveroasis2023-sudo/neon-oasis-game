import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {statusPinsFixture} from './fixtures/fleet-status-pins-fixture.mjs';
import {openFleetView} from './fleet-view-navigation-helper.mjs';
for(const it of [false,true])test(`main Fleet board is map-first and source-labeled for ${it?'IT':'Owner'}`,async({page},testInfo)=>{
 const f=statusPinsFixture();const {app,state}=await mountFleet(page,it,{field:f.field,health:f.health,productConnections:f.connections});
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
 const inventory=board.getByRole('region',{name:'mHelpDesk equipment Product-ID inventory',exact:true}),sourceTime=inventory.locator('.cos-fleet-source-age');
 await expect(sourceTime).toBeVisible();await expect(sourceTime).toContainText('Saved reviewed mHelp source received');
 const savedTime=await sourceTime.evaluate((_,stamp)=>new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(new Date(stamp)),f.upload.receivedAt);
 await expect(sourceTime).toContainText(savedTime);await expect(sourceTime).toContainText('This is a saved copy of the unit list, not a live read.');
 const small=testInfo.project.name==='mobile-390';
 if(small){
  expect(map.y).toBeLessThan(units.y);
  const jump=board.getByRole('button',{name:'Jump to Fleet map',exact:true});await expect(jump).toBeVisible();await jump.click();
  await expect.poll(()=>board.locator('.cos-fleet-map-panel').evaluate(el=>el.getBoundingClientRect().top)).toBeLessThan(220);
  await expect(board.locator('.cos-fleet-map-canvas')).toBeInViewport();
  await page.screenshot({path:testInfo.outputPath('fleet-board-phone-default.png')});
 }else{expect(map.x).toBeGreaterThan(units.x+units.width-2);}
 await expect(board.getByRole('region',{name:'Equipment family totals',exact:true})).toBeVisible();
 expect(await board.evaluate(n=>n.scrollWidth<=n.clientWidth+2)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('fleet-board.png')});
 await openFleetView(app,'Data sources');
 await expect(app.getByRole('region',{name:'Complete mHelpDesk Fleet command center'})).toBeVisible();
 await app.getByLabel('Filter all Field products by monitoring system').selectOption('avigilon');
 await expect(app.getByLabel('Filter all Field products by monitoring system')).toHaveValue('avigilon');
 expect(state.calls.every(c=>c.method==='GET')).toBe(true);
 expect(state.errors).toEqual([]);
});

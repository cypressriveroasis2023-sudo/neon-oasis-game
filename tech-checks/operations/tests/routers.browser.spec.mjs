import {expectOperationsReloadRequired} from './helpers/operationsAccess.mjs';
import { openWorkspace } from './navigation-helper.mjs';
import {revealMapFilters} from './field-map-controls.mjs';
import {test,expect} from '@playwright/test';
import {mountRouterFixture} from './fixtures/routers.mjs';
const records=frame=>frame.getByLabel('Router records',{exact:true});
const openRouters=frame=>frame.getByRole('navigation',{name:'Equipment systems'}).getByRole('button',{name:'Router connections',exact:true}).click();
async function openMap(frame){await openWorkspace(frame,'Field Map');await revealMapFilters(frame);await frame.getByLabel('Fleet status').selectOption('all');await frame.locator('.cos-fleet-unit-row').first().click();await frame.getByRole('button',{name:'Edit / verify installation →'}).click();}
test('router overview, filtering, IP drilldown and stored map context remain read-only',async({page})=>{
 const {frame,state}=await mountRouterFixture(page);
 await openRouters(frame);
 await expect(frame.locator('.router-workspace .panelhead')).toContainText('4 Camera Health router records');
 await expect(frame.getByText('InHand GPS feed not connected',{exact:true})).toBeVisible();
 await expect(frame.getByRole('heading',{name:'Router inventory & reachability'})).toBeVisible();
 await expect(records(frame).getByRole('button')).toHaveCount(4);
 await frame.getByRole('textbox',{name:'Search routers'}).fill('192.0.2.3');
 await expect(records(frame).getByRole('button')).toHaveCount(1);
 await expect(frame.getByLabel('Selected router details')).toContainText('This name is duplicated');
 await expect(frame.getByRole('button',{name:'View same-name COS unit'})).toHaveCount(0);
 await frame.getByRole('textbox',{name:'Search routers'}).fill('');
 await frame.getByRole('combobox',{name:'Router status filter'}).selectOption('stale');
 await expect(records(frame).getByRole('button')).toHaveCount(1);
 await expect(records(frame)).toContainText('SS 039');
 await frame.getByRole('combobox',{name:'Router status filter'}).selectOption('reachable');
 await expect(frame.getByLabel('Selected router details')).toContainText('192.0.2.1/32');
 await expect(frame.getByLabel('Selected router details')).toContainText('Last recorded recovery');
 await frame.getByRole('button',{name:'View same-name COS unit'}).click();
 await frame.getByRole('button',{name:'Edit / verify installation →'}).click();
 await expect(frame.getByLabel('Router context for selected unit')).toContainText('Same-name match only');
 await expect(frame.locator('.cos-fleet-drawer')).toContainText('Manual');
 await expect(frame.locator('.cos-field-pin')).toHaveCount(1);
 await expect(frame.getByLabel('Latitude',{exact:true})).toHaveValue('30');
 await expect(frame.getByLabel('Router context for selected unit')).toContainText('Router checks do not supply live locations.');
 const size=await frame.locator('body').evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth}));expect(size.content).toBeLessThanOrEqual(size.width);
 expect(state.requests.every(r=>r.method==='GET')).toBeTruthy();
 await frame.getByRole('button',{name:'View all InHand routers'}).click();
 await frame.locator('body').evaluate(()=>history.back());
 await expect(frame.getByLabel('Interactive fleet installation map')).toBeVisible();
 await frame.locator('body').evaluate(()=>history.forward());
 await expect(frame.getByRole('heading',{name:'Router inventory & reachability'})).toBeVisible();
});
test('missing GPS remains unpinned and source failure can retry without fabricating healthy fleet',async({page})=>{
 const {frame,state}=await mountRouterFixture(page,{fail:true,gps:false});
 await openRouters(frame);
 await expect(frame.getByRole('alert')).toContainText('Router fixture unavailable');
 await expect(records(frame)).toHaveCount(0);
 await expect(frame.getByLabel('Selected router details')).toHaveCount(0);
 state.fail=false;await frame.getByRole('button',{name:'Refresh routers',exact:true}).click();
 await expect(records(frame).getByRole('button')).toHaveCount(4);
 await expect(frame.locator('.router-workspace .panelhead')).toContainText('4 Camera Health router records');
 await openMap(frame);
 await expect(frame.getByLabel('Router context for selected unit')).toContainText('No router GPS');
 await expect(frame.locator('.cos-field-pin')).toHaveCount(0);
 await expect(frame.getByLabel('Latitude',{exact:true})).toHaveValue('');
 expect(state.requests.every(r=>r.method==='GET')).toBeTruthy();
});
test('refresh retains clearly marked old inventory on outage and clears it when authorization is denied',async({page})=>{
 const {frame,state}=await mountRouterFixture(page);
 await openRouters(frame);
 await expect(records(frame).getByRole('button')).toHaveCount(4);
 state.fail=true;await frame.getByRole('button',{name:'Refresh routers',exact:true}).click();
 await expect(frame.getByRole('alert')).toContainText('Showing the last successful inventory');
 await expect(records(frame).getByRole('button')).toHaveCount(4);
 state.fail=403;await frame.getByRole('button',{name:'Refresh routers',exact:true}).click();
 await expectOperationsReloadRequired(frame);
 await expect(frame.getByRole('heading',{name:'Router inventory & reachability'})).toHaveCount(0);
 await expect(frame.getByRole('button',{name:'Refresh routers',exact:true})).toHaveCount(0);
 await expect(records(frame)).toHaveCount(0);
 await expect(frame.getByText('192.0.2.1/32',{exact:true})).toHaveCount(0);
 expect(state.requests.every(r=>r.method==='GET')).toBeTruthy();
});

test('fifteen-minute router polling preserves the map viewport and cannot supply camera colors',async({page})=>{
 await page.clock.install({time:new Date()});
 const {frame,state}=await mountRouterFixture(page);
 await openMap(frame);
 await expect(frame.getByLabel('Router context for selected unit')).toContainText('Same-name match only');
 await expect(frame.locator('.cos-field-pin-wrap')).toHaveCount(1);
 await expect(frame.locator('.cos-field-pin')).toHaveAttribute('data-health','unknown');await expect(frame.locator('.cos-reticle-artwork')).toHaveCSS('color','rgb(148, 163, 184)');await expect(frame.locator('.cos-map-status-dot')).toHaveCount(1);await expect(frame.locator('.cos-reticle-approved-eye')).toHaveCount(0);
 await frame.getByRole('button',{name:'Close unit details'}).click();
 await frame.getByLabel('Interactive fleet installation map').scrollIntoViewIfNeeded();
 const canvas=await frame.getByLabel('Interactive fleet installation map').boundingBox();
 await page.mouse.move(canvas.x+canvas.width/2,canvas.y+canvas.height/2);
 // Give each drag step elapsed fake time so Leaflet calculates realistic inertia.
 await page.mouse.down();
 for(let step=1;step<=8;step++){
  await page.clock.runFor(25);
  await page.mouse.move(canvas.x+canvas.width/2+step*15,canvas.y+canvas.height/2);
 }
 await page.mouse.up();
 await page.clock.runFor(1000);
 await expect(frame.locator('.leaflet-pan-anim')).toHaveCount(0);
 // Judge geographic continuity from a unit marker's screen position. Leaflet
 // may legitimately normalize its internal map-pane transform on resize.
 const before=await frame.locator('.cos-field-pin-wrap').first().boundingBox();
 expect(before).not.toBeNull();
 const readsBefore=state.requests.filter(r=>r.path==='/api/routers').length;
 await page.clock.fastForward(61000);
 expect(state.requests.filter(r=>r.path==='/api/routers').length).toBe(readsBefore);
 await page.clock.fastForward(15*60*1000);
 await expect.poll(()=>state.requests.filter(r=>r.path==='/api/routers').length).toBeGreaterThan(readsBefore);
 const after=await frame.locator('.cos-field-pin-wrap').first().boundingBox();
 expect(after).not.toBeNull();
 expect(Math.abs(after.x-before.x)).toBeLessThanOrEqual(2);
 expect(Math.abs(after.y-before.y)).toBeLessThanOrEqual(2);
 await frame.locator('.cos-fleet-unit-row').first().click();await frame.getByRole('button',{name:'Edit / verify installation →'}).click();
 await expect(frame.getByLabel('Router context for selected unit')).toContainText('Same-name match only');
 await expect(frame.locator('.cos-field-pin')).toHaveAttribute('data-health','unknown');await expect(frame.locator('.cos-reticle-artwork')).toHaveCSS('color','rgb(148, 163, 184)');await expect(frame.locator('.cos-map-status-dot')).toHaveCount(1);await expect(frame.locator('.cos-reticle-approved-eye')).toHaveCount(0);
});

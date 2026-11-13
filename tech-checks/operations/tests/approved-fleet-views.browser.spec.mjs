import {test,expect} from '@playwright/test';
import {mountFleet,units} from './fleet-dashboard-fixtures.mjs';
const safe=state=>{expect(state.errors).toEqual([]);expect(state.calls.every(call=>call.method==='GET')).toBe(true);};
const nav=app=>app.getByRole('navigation',{name:'Fleet dashboard views',exact:true});
const toggle=app=>nav(app).locator('summary[aria-label="More fleet tools"]');
async function labelSynthetic(page){await page.evaluate(()=>{const banner=document.createElement('header');banner.textContent='SYNTHETIC TEST — NOT LIVE OPERATIONS';banner.style.cssText='height:24px;font:12px/24px sans-serif;background:white;color:#111;text-align:center';document.body.prepend(banner);document.querySelector('iframe').style.cssText='display:block;width:100%;height:calc(100vh - 24px);border:0';});}
async function fits(app){
 const geometry=await nav(app).evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,viewport:innerWidth,scroll:el.scrollWidth,client:el.clientWidth,targets:[...el.querySelectorAll(':scope > button,:scope > details > summary')].map(n=>({height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width}))};});
 expect(geometry.left).toBeGreaterThanOrEqual(0);expect(geometry.right).toBeLessThanOrEqual(geometry.viewport+1);expect(geometry.scroll).toBeLessThanOrEqual(geometry.client+1);
 for(const box of geometry.targets){expect(box.height).toBeGreaterThanOrEqual(48);expect(box.width).toBeGreaterThanOrEqual(44);}
}

test('Owner Fleet exposes three primary views and all secondary tools without sideways scrolling',async({page},info)=>{
 const {app,state}=await mountFleet(page);await labelSynthetic(page);
 await expect(nav(app).locator(':scope > button')).toHaveCount(3);await expect(nav(app).getByRole('button',{name:'Camera status',exact:true})).toBeVisible();
 await expect(nav(app).getByRole('button',{name:'Map',exact:true})).toBeVisible();await expect(nav(app).getByRole('button',{name:'Fleet health',exact:true})).toBeVisible();
 await expect(nav(app).getByRole('button',{name:/Location verification/})).toBeHidden();await fits(app);
 await page.screenshot({path:info.outputPath('fleet-primary.png')});await toggle(app).click();
 for(const name of [/Location verification/,/Needs setup/,/^Data sources$/])await expect(nav(app).getByRole('button',{name})).toBeVisible();
 const menu=nav(app).locator('.cos-approved-fleet-tool-buttons');const box=await menu.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize().width+1);
 await page.screenshot({path:info.outputPath('fleet-more-tools.png')});safe(state);
});

test('original secondary destinations and count text remain reachable and close after selection',async({page})=>{
 const {app,state}=await mountFleet(page);
 for(const [name,view] of [[/Location verification/,'verify'],[/Needs setup/,'setup'],[/^Data sources$/,'sources']]){
  await toggle(app).click();const button=nav(app).getByRole('button',{name}),originalText=(await button.innerText()).trim();
  await button.click();await expect(app.locator('.cos-fleet-dashboard')).toHaveAttribute('data-fleet-view',view);
  await expect(nav(app).locator('details')).not.toHaveAttribute('open','');await expect(toggle(app)).toHaveAttribute('aria-current','page');await expect(toggle(app)).toContainText(originalText);await expect(toggle(app)).toBeFocused();
 }
 await nav(app).getByRole('button',{name:'Map',exact:true}).click();await expect(app.locator('.cos-fleet-dashboard')).toHaveAttribute('data-fleet-view','map');await expect(toggle(app)).not.toHaveAttribute('aria-current','page');safe(state);
});

test('opening and dismissing Fleet tools preserves saved data and returns keyboard focus',async({page})=>{
 const {app,state}=await mountFleet(page);await expect(app.getByRole('button',{name:'↻ Refresh data',exact:true})).toBeEnabled();
 const before=state.calls.map(c=>c.path);await toggle(app).click();await nav(app).getByRole('button',{name:/Location verification/}).focus();await page.keyboard.press('Escape');
 await expect(nav(app).locator('details')).not.toHaveAttribute('open','');await expect(toggle(app)).toBeFocused();expect(state.calls.map(c=>c.path)).toEqual(before);safe(state);
});

test('a camera outage filter opens the exact existing unit and returns to the retained list',async({page},info)=>{
 const {app,state}=await mountFleet(page);await labelSynthetic(page);
 await app.getByRole('combobox',{name:'Fleet status',exact:true}).selectOption('offline');
 const row=app.locator('.cos-fleet-unit-row');await expect(row).toHaveCount(1);await expect(row).toHaveAttribute('data-unit-id',units[1].id);await row.click();
 const drawer=app.getByRole('dialog',{name:'Spotter 1 unit intelligence',exact:true});await expect(drawer).toBeVisible();
 await expect.poll(()=>app.locator('body').evaluate(()=>new URLSearchParams(location.hash.split('?')[1]).get('unit'))).toBe(units[1].id);
 await expect(drawer.locator('.camera-unit-state')).toHaveText('Camera outage observed');await expect(drawer.getByRole('region',{name:'Unit recorded address'})).toContainText(units[1].address);
 await expect(drawer.locator('.cos-fleet-camera-card > small').first()).not.toBeEmpty();await page.screenshot({path:info.outputPath('exact-problem-unit.png')});
 await drawer.getByRole('button',{name:'Close unit details',exact:true}).click();await expect(drawer).toHaveCount(0);await expect(row).toHaveCount(1);await expect(row).toHaveAttribute('data-unit-id',units[1].id);safe(state);
});

test('restricted IT Fleet tools retain permitted destinations without Owner setup',async({page})=>{
 const {app,state}=await mountFleet(page,true);await expect(toggle(app)).toBeVisible();await fits(app);await toggle(app).click();
 await expect(nav(app).getByRole('button',{name:/Location verification/})).toBeVisible();await expect(nav(app).getByRole('button',{name:/Needs setup/})).toHaveCount(0);
 await expect(app.locator('.cos-approved-shell')).toHaveCount(0);safe(state);
});

test('Owner Fleet controls fit a narrow 320 pixel phone',async({page})=>{
 await page.setViewportSize({width:320,height:812});const {app,state}=await mountFleet(page);await fits(app);await toggle(app).click();
 const menu=await nav(app).locator('.cos-approved-fleet-tool-buttons').boundingBox();expect(menu.x).toBeGreaterThanOrEqual(0);expect(menu.x+menu.width).toBeLessThanOrEqual(321);safe(state);
});

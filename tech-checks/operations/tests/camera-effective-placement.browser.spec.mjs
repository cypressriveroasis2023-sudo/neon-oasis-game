// Actual standalone entry paths; all external traffic is intercepted or denied.
import {test,expect} from '@playwright/test';
import {existsSync} from 'node:fs';import {resolve,extname} from 'node:path';import {fileURLToPath} from 'node:url';
import {setupFixture} from './camera-effective-placement.fixture.mjs';
const repo=resolve(fileURLToPath(new URL('../../..',import.meta.url))),origin='http://127.0.0.1:4173';
async function mount(page,path='camera-health.html?q=RANGER%20022'){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(setupFixture);
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/functions/v1/cos-operations-pages'){
   const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
   const body=route.request().postDataJSON();expect(body.method).toBe('GET');expect(['/api/field-map','/api/camera-health/summary-v3']).toContain(body.path);expect(route.request().headers().authorization).toBe('Bearer synthetic-only');
   const state=await page.evaluate(path=>{readRequests.push({path});if(window.denyPlacement)return {deny:true};return {data:path==='/api/field-map'?snapshotFixture():healthFixture()};},body.path);
   if(state.deny)return route.fulfill({status:403,headers,contentType:'application/json',body:'{"error":"Synthetic denied"}'});
   return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(state.data)});
  }
  if(url.origin!==origin)return route.abort('blockedbyclient');
  const file=resolve(repo,'.'+decodeURIComponent(url.pathname));if(file.startsWith(repo+'/')&&existsSync(file))return route.fulfill({path:file,contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'}[extname(file)]||'application/octet-stream'});
  return route.abort('blockedbyclient');
 });
 await page.goto(origin+'/tech-checks/'+path);return errors;
}
test('real cards, modal and resource page use effective source FIELD/SHOP, preserve health and reload reads',async({page},info)=>{
 const errors=await mount(page),card=page.locator('.compact-unit[data-unit="RANGER 022"]');
 await expect(card.locator('[data-placement-status="ready"]')).toContainText('mHelpDesk equipment document');await expect(card.locator('.compact-unit-site')).toContainText('FIELD · Approved mHelp job site · 10 Source Road');
 await expect(card.locator('.statuspill')).toContainText('OFFLINE');
 await expect(card.locator('a[href="http://192.0.2.11"]')).toHaveAttribute('href','http://192.0.2.11');
 await card.getByRole('button',{name:'Open RANGER 022 unit details'}).click();
 await expect(page.locator('#unitDetailSubtitle')).toContainText('10 Source Road');
 await expect(page.locator('#unitDetailMain .effective-placement')).toContainText('Activation: active');
 await page.locator('#unitDetailMain a[href="./camera-detail.html?id=11"]').click();
 await expect(page.locator('#effectivePlacement [data-placement-status="ready"]')).toBeVisible();await expect(page.locator('#organization')).toContainText('10 Source Road');await expect(page.locator('#statusPill')).toHaveText('OFFLINE');
 const before=await page.evaluate(()=>JSON.stringify(fixtureDevices));
 await page.screenshot({path:info.outputPath('effective-field-detail.png'),fullPage:true});
 await page.evaluate(()=>window.holdPlacementState=true);await page.locator('#editFieldBtn').click();
 await expect(page.getByLabel('Current installation address (street, city, state and ZIP)')).toBeDisabled();
 await page.evaluate(()=>{window.holdPlacementState=false;window.releasePlacementState?.();});
 await expect(page.getByLabel('Current job / site')).toHaveValue('Approved mHelp job site');await expect(page.getByLabel('Current installation address (street, city, state and ZIP)')).toHaveValue('10 Source Road, Testville, TX 75001');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.evaluate(async()=>{fixtureMode='shop';await refreshEffectivePlacement();});
 await expect(page.locator('#organization')).toHaveText('SHOP / ROOT');await expect(page.locator('#moveShopBtn')).toHaveText('Move to Field');await expect(page.locator('#statusPill')).toHaveText('OFFLINE');await expect(page.locator('#interfaceActions a').first()).toBeVisible();
 await page.evaluate(async()=>{fixtureMode='owner';await refreshEffectivePlacement();});await expect(page.locator('#organization')).toContainText('99 Owner Road');await expect(page.locator('#effectivePlacement')).toContainText('Owner-confirmed placement');
 expect(await page.evaluate(()=>CameraEffectivePlacement.get(device).row.latitude)).toBe(32.123);expect(await page.evaluate(()=>JSON.stringify(fixtureDevices))).toBe(before);
 await page.evaluate(()=>sessionStorage.setItem('syntheticSourcePlacement','owner'));await page.reload();await expect(page.locator('#effectivePlacement [data-placement-status="ready"]')).toBeVisible();await expect(page.locator('#organization')).toContainText('99 Owner Road');expect(await page.evaluate(()=>writes)).toEqual([]);expect(errors).toEqual([]);
});
test('Shop stays searchable and linked; approved alias keeps full variant; unresolved support stays separate',async({page},info)=>{
 const errors=await mount(page);await page.evaluate(async()=>{fixtureMode='shop';await refreshEffectivePlacement();});
 const search=page.getByLabel('Search units',{exact:true}),card=page.locator('.compact-unit[data-unit="RANGER 022"]');
 await expect(card).toContainText('SHOP / ROOT');await expect(card.getByRole('button',{name:'Troubleshoot'})).toBeVisible();await expect(card.locator('.unit-field-map-link')).toBeVisible();
 await search.fill('Alias verified site');const alias=page.locator('.compact-unit[data-unit="SNIPER 00312.2"]');await expect(alias).toBeVisible();await expect(alias.locator('.unit-field-map-link')).toHaveAttribute('href','./?fieldUnit=SNIPER%20312.2');await expect(alias.locator('.statuspill')).toHaveText('IP / PORT OFFLINE');
 await search.fill('SOLAR STAND');await expect(page.locator('.compact-unit')).toContainText('No verified equipment link. Source group remains separate.');await expect(page.locator('.compact-unit .statuspill')).not.toContainText('CAMERA OFFLINE');
 await search.fill('RANGER');await page.screenshot({path:info.outputPath('effective-shop-searchable.png'),fullPage:true});
 const bounds=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));expect(bounds.scroll).toBeLessThanOrEqual(bounds.width+1);expect(errors).toEqual([]);
});
test('warning, denied refresh, and source revisions cannot falsely confirm placement or clear saved fields',async({page},info)=>{
 const errors=await mount(page,'camera-detail.html?id=11');await expect(page.locator('#effectivePlacement [data-placement-status="ready"]')).toBeVisible();
 await page.evaluate(async()=>{window.denyPlacement=true;await refreshEffectivePlacement();});await expect(page.locator('#organization')).toContainText('Last read: FIELD');await expect(page.locator('#effectivePlacement')).toContainText('current placement is unavailable');await expect(page.locator('#statusPill')).toHaveText('OFFLINE');
 await page.screenshot({path:info.outputPath('placement-denied-preserves-last-read.png'),fullPage:true});
 await page.evaluate(async()=>{window.denyPlacement=false;fixtureMode='warning';await refreshEffectivePlacement();});await expect(page.locator('#effectivePlacement [data-placement-status="unresolved"]')).toContainText('Source revision changed');await expect(page.locator('#organization')).not.toContainText('10 Source Road');
 await page.evaluate(async()=>{fixtureMode='field';const old=healthFixture;window.healthFixture=()=>{const h=old();h.unitIdentities.push({...h.unitIdentities[0]});return h};await refreshEffectivePlacement();});await expect(page.locator('#effectivePlacement')).toContainText('Conflicting equipment links');expect(await page.evaluate(()=>writes)).toEqual([]);expect(errors).toEqual([]);
});
test('navigation and late response cannot repaint the previously selected resource',async({page})=>{
 const errors=await mount(page,'camera-detail.html?id=11');await expect(page.locator('#effectivePlacement [data-placement-status="ready"]')).toBeVisible();
 await page.evaluate(()=>{const real=window.fetch;let first=true;window.fetch=async(...args)=>{if(first&&JSON.parse(args[1].body).path==='/api/field-map'){first=false;await new Promise(r=>window.releasePlacement=r);}return real(...args);};window.oldPlacementRead=refreshEffectivePlacement();history.replaceState({},'','?id=12');});
 await page.evaluate(()=>load());await expect(page.locator('#cameraName')).toContainText('SNIPER 00312.2');await expect(page.locator('#effectivePlacement [data-placement-status="ready"]')).toBeVisible();await expect(page.locator('#organization')).toContainText('22 Alias Road');
 await page.evaluate(async()=>{window.releasePlacement?.();await window.oldPlacementRead;});await expect(page.locator('#organization')).not.toContainText('10 Source Road');await expect(page.locator('#organization')).toContainText('22 Alias Road');expect(errors).toEqual([]);
});

test('initial network denial preserves source context and camera-opening links with an explicit unavailable state',async({page})=>{
 await page.addInitScript(()=>window.denyPlacement=true);const errors=await mount(page,'camera-detail.html?id=11');
 await expect(page.locator('#effectivePlacement [data-placement-status="unavailable"]')).toContainText('unavailable');await expect(page.locator('#organization')).toContainText('source organization: ROOT');await expect(page.locator('#moveShopBtn')).toHaveText('Move to Field');await expect(page.locator('#interfaceActions a').first()).toBeVisible();await expect(page.locator('#statusPill')).toHaveText('OFFLINE');expect(errors).toEqual([]);
});

test('existing unique full-family fallback remains available without claiming an Owner or provider identity proof',async({page})=>{
 const errors=await mount(page);await page.evaluate(async()=>{const old=healthFixture;window.healthFixture=()=>({...old(),unitIdentities:[],ownerConfirmedUnitIdentities:[]});await refreshEffectivePlacement();});
 const card=page.locator('.compact-unit[data-unit="RANGER 022"]');await expect(card.locator('[data-placement-status="ready"]')).toContainText('Exact full unit identifier');await expect(card.locator('.compact-unit-site')).toContainText('10 Source Road');
 await page.evaluate(async()=>{const old=healthFixture;window.healthFixture=()=>{const h=old();h.rows.push({id:99,unit:'RANGER 22'});return h};await refreshEffectivePlacement();});await expect(card.locator('[data-placement-status="unresolved"]')).toContainText('Source group remains separate');await expect(card.locator('.compact-unit-site')).not.toContainText('10 Source Road');expect(errors).toEqual([]);
});

test('inactive source stays searchable with camera links and intentional deployment while raw activation and health remain unchanged',async({page})=>{
 const errors=await mount(page),before=await page.evaluate(()=>JSON.stringify(fixtureDevices));await page.evaluate(async()=>{fixtureMode='inactive';await refreshEffectivePlacement();});
 const search=page.getByLabel('Search units',{exact:true}),card=page.locator('.compact-unit[data-unit="RANGER 022"]');await search.fill('INACTIVE / DO NOT USE');
 await expect(card.locator('.compact-unit-site')).toHaveText('INACTIVE / DO NOT USE');await expect(card.locator('.statuspill')).toHaveText('INACTIVE');await expect(card).toContainText('Activation: active');await expect(card).not.toContainText('Deactivated or retired');
 await expect(card.locator('a[href="http://192.0.2.11"]')).toBeVisible();await card.getByRole('button',{name:'Move to Field',exact:true}).click();
 await expect(page.getByLabel('Current job / site')).toHaveValue('');await expect(page.getByLabel('Current installation address (street, city, state and ZIP)')).toHaveValue('');await expect(page.getByRole('button',{name:'Save placement',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);expect(await page.evaluate(()=>JSON.stringify(fixtureDevices))).toBe(before);expect(await page.evaluate(()=>writes)).toEqual([]);expect(errors).toEqual([]);
});

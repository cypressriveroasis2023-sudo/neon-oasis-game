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
   const body=route.request().postDataJSON();expect(route.request().method()).toBe('POST');expect(body.method).toBe('GET');expect(['/api/session','/api/field-map','/api/camera-health/summary-v3']).toContain(body.path);expect(route.request().headers().authorization).toBe('Bearer synthetic-only');
   if(body.path==='/api/session')return route.fulfill({headers,json:{features:{freshAvigilonChecks:false,avigilonSourceWrites:false}}});
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
 await expect(page.locator('#organization')).toHaveText('SHOP / ROOT');await expect(page.locator('#moveShopBtn')).toHaveText('Move to Field');await expect(page.locator('#statusPill')).toHaveText('OFFLINE');await expect(page.locator('#interfaceActions a').first()).toBeVisible();expect(await page.evaluate(()=>current.native_publication_receipt)).toBeUndefined();
 await page.evaluate(async()=>{fixtureMode='owner';await refreshEffectivePlacement();});await expect(page.locator('#organization')).toContainText('99 Owner Road');await expect(page.locator('#effectivePlacement')).toContainText('Owner-confirmed placement');
 expect(await page.evaluate(()=>CameraEffectivePlacement.get(device).row.latitude)).toBe(32.123);expect(await page.evaluate(()=>JSON.stringify(fixtureDevices))).toBe(before);
 await page.evaluate(()=>sessionStorage.setItem('syntheticSourcePlacement','owner'));await page.reload();await expect(page.locator('#effectivePlacement [data-placement-status="ready"]')).toBeVisible();await expect(page.locator('#organization')).toContainText('99 Owner Road');expect(await page.evaluate(()=>writes)).toEqual([]);expect(errors).toEqual([]);
});
test('Shop stays searchable and linked; approved alias keeps full variant; unresolved support stays separate',async({page},info)=>{
 const errors=await mount(page),search=page.getByLabel('Search units',{exact:true}),card=page.locator('.compact-unit[data-unit="RANGER 022"]');
 await expect(card.locator('[data-placement-status="ready"]')).toBeVisible();await expect.poll(()=>page.evaluate(()=>boardDataReady===true&&cameraLoadPromise===null)).toBe(true);
 await expect(card.locator('.statuspill')).toHaveText('OFFLINE');
 await page.evaluate(async()=>{fixtureMode='shop';await refreshEffectivePlacement();});
 await expect(card.locator('.statuspill')).not.toHaveText('OFFLINE');await expect(page.locator('#allOffline')).toHaveText('0');expect(await page.evaluate(()=>Object.values(health||{}).every(row=>!row.native_publication_receipt))).toBe(true);
 const before=await page.evaluate(()=>readRequests.filter(r=>r.path).length);
 await page.evaluate(async()=>{fixtureMode='shop';await refreshEffectivePlacement();});
 expect(await page.evaluate(start=>readRequests.filter(r=>r.path).slice(start).map(r=>r.path).sort(),before)).toEqual(['/api/camera-health/summary-v3','/api/field-map']);
 await expect(card.locator('[data-placement-status="ready"]')).toBeVisible();expect(await page.evaluate(()=>CameraEffectivePlacement.get(fixtureDevices[0]).scope)).toBe('shop');
 await expect(card).toContainText('SHOP / ROOT');await expect(card.getByRole('button',{name:'Troubleshoot'})).toBeVisible();await expect(card.locator('.unit-field-map-link')).toBeVisible();
 await search.fill('Alias verified site');const alias=page.locator('.compact-unit[data-unit="SNIPER 00312.2"]');await expect(alias).toBeVisible();await expect(alias.locator('.unit-field-map-link')).toHaveAttribute('href','./?fieldUnit=SNIPER%20312.2');await expect(alias.locator('.statuspill')).toHaveText('IP / PORT OFFLINE');
 await search.fill('SOLAR STAND');await expect(page.locator('.compact-unit')).toContainText('No verified equipment link. Source group remains separate.');await expect(page.locator('.compact-unit .statuspill')).not.toContainText('CAMERA OFFLINE');
 await search.fill('RANGER');await page.screenshot({path:info.outputPath('effective-shop-searchable.png'),fullPage:true});
 const bounds=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));expect(bounds.scroll).toBeLessThanOrEqual(bounds.width+1);expect(errors).toEqual([]);
});
test('warning, denied refresh, and source revisions cannot falsely confirm placement or clear saved fields',async({page},info)=>{
 const errors=await mount(page,'camera-detail.html?id=11');await expect(page.locator('#effectivePlacement [data-placement-status="ready"]')).toBeVisible();
 await page.evaluate(async()=>{window.denyPlacement=true;await refreshEffectivePlacement();});await expect(page.locator('#organization')).toContainText('Last read: FIELD');await expect(page.locator('#effectivePlacement')).toContainText('current placement is unavailable');await expect(page.locator('#statusPill')).toHaveText('UNVERIFIED');expect(await page.evaluate(()=>current)).toEqual({});
 await page.screenshot({path:info.outputPath('placement-denied-preserves-last-read.png'),fullPage:true});
 await page.evaluate(async()=>{window.denyPlacement=false;fixtureMode='warning';await refreshEffectivePlacement();});await expect(page.locator('#effectivePlacement [data-placement-status="unresolved"]')).toContainText('Source revision changed');await expect(page.locator('#organization')).not.toContainText('10 Source Road');
 await page.evaluate(async()=>{fixtureMode='field';const old=healthFixture;window.healthFixture=()=>{const h=old();h.unitIdentities.push({...h.unitIdentities[0]});return h};await refreshEffectivePlacement();});await expect(page.locator('#effectivePlacement')).toContainText('Conflicting equipment links');expect(await page.evaluate(()=>writes)).toEqual([]);expect(errors).toEqual([]);
});
test('abort-honoring same-document supersession fences the old resource and recovers after drain',async({page})=>{
 const errors=await mount(page,'camera-detail.html?id=11');await expect(page.locator('#effectivePlacement [data-placement-status="ready"]')).toBeVisible();
 await page.evaluate(()=>{const real=window.fetch;let first=true;window.placementTransportStarts=[];window.activePlacementTransports=0;window.maxPlacementTransports=0;window.fetch=async(...args)=>{const path=JSON.parse(args[1].body).path;window.placementTransportStarts.push(path);window.activePlacementTransports++;window.maxPlacementTransports=Math.max(window.maxPlacementTransports,window.activePlacementTransports);let settled=false;const settle=()=>{if(!settled){settled=true;window.activePlacementTransports--;}};try{if(first&&path==='/api/field-map'){first=false;window.heldPlacementStarted=true;const signal=args[1].signal;await new Promise((resolve,reject)=>{const abort=()=>{window.placementAbortObserved=true;reject(new DOMException('Synthetic cancelled transport','AbortError'));};window.releasePlacement=()=>{signal.removeEventListener('abort',abort);resolve();};if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});}const response=await real(...args),json=response.json.bind(response);response.json=async()=>{try{return await json();}finally{settle();}};return response;}catch(error){settle();throw error;}};window.oldPlacementRead=refreshEffectivePlacement();});
 await expect.poll(()=>page.evaluate(()=>window.heldPlacementStarted===true)).toBe(true);
 await page.evaluate(()=>{history.replaceState({},'','?id=12');return load().catch(()=>{});});
 await expect.poll(()=>page.evaluate(()=>window.placementAbortObserved===true)).toBe(true);
 await expect(page.locator('#cameraName')).toContainText('SNIPER 00312.2');await expect(page.locator('#organization')).not.toContainText('10 Source Road');
 await expect.poll(()=>page.evaluate(()=>window.activePlacementTransports)).toBe(0);
 const before=await page.evaluate(()=>placementTransportStarts.length);expect([2,4,6,8]).toContain(before);expect(await page.evaluate(()=>maxPlacementTransports)).toBeLessThanOrEqual(2);
 // Supersession may observe the draining barrier before abort cleanup finishes. An explicit post-drain retry is supported.
 await page.evaluate(async()=>{window.releasePlacement?.();await window.oldPlacementRead;await refreshEffectivePlacement();});
 await expect(page.locator('#effectivePlacement [data-placement-status="ready"]')).toBeVisible();await expect(page.locator('#organization')).toContainText('22 Alias Road');await expect(page.locator('#organization')).not.toContainText('10 Source Road');expect(await page.evaluate(()=>device.id)).toBe(12);
 expect(await page.evaluate(()=>placementTransportStarts.length)).toBe(before+2);expect(await page.evaluate(()=>maxPlacementTransports)).toBeLessThanOrEqual(2);expect(await page.evaluate(()=>writes)).toEqual([]);expect(errors).toEqual([]);
});

test('actual resource-link navigation opens the new document while the old placement transport is held',async({page})=>{
 const errors=await mount(page),search=page.getByLabel('Search units',{exact:true});
 await expect(page.locator('.compact-unit[data-unit="RANGER 022"] [data-placement-status="ready"]')).toBeVisible();
 await search.fill('SNIPER');const card=page.locator('.compact-unit[data-unit="SNIPER 00312.2"]');await card.getByRole('button',{name:'Open SNIPER 00312.2 unit details'}).click();
 await page.evaluate(()=>{const real=window.fetch;let first=true;window.fetch=async(...args)=>{if(first&&JSON.parse(args[1].body).path==='/api/field-map'){first=false;window.heldPlacementStarted=true;const signal=args[1].signal;await new Promise((resolve,reject)=>{const abort=()=>reject(new DOMException('Synthetic cancelled transport','AbortError'));if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});}const response=await real(...args);if(JSON.parse(args[1].body).path==='/api/camera-health/summary-v3'){const json=response.json.bind(response);response.json=async()=>{const value=await json();window.oldSummaryBodySettled=true;return value;};}return response;};window.oldPlacementRead=refreshEffectivePlacement();});
 await expect.poll(()=>page.evaluate(()=>window.heldPlacementStarted===true)).toBe(true);expect(await page.evaluate(()=>writes)).toEqual([]);
 // Settle the old summary's page-backed route before navigation; the old map remains held.
 await expect.poll(()=>page.evaluate(()=>window.oldSummaryBodySettled===true)).toBe(true);
 await page.locator('#unitDetailMain a[href="./camera-detail.html?id=12"]').click();await expect(page).toHaveURL(origin+'/tech-checks/camera-detail.html?id=12');
 await expect(page.locator('#effectivePlacement [data-placement-status="ready"]')).toBeVisible();await expect(page.locator('#cameraName')).toContainText('SNIPER 00312.2');await expect(page.locator('#organization')).toContainText('22 Alias Road');await expect(page.locator('#organization')).not.toContainText('10 Source Road');
 expect(await page.evaluate(()=>window.heldPlacementStarted)).toBeUndefined();expect(await page.evaluate(()=>device.id)).toBe(12);expect(await page.evaluate(()=>readRequests.filter(r=>r.path).map(r=>r.path).sort())).toEqual(['/api/camera-health/summary-v3','/api/camera-health/summary-v3','/api/camera-health/summary-v3','/api/field-map','/api/field-map','/api/field-map']);expect(await page.evaluate(()=>writes)).toEqual([]);expect(errors).toEqual([]);
});

test('an unabortable old body allows bounded independent fences and cannot repaint the new resource',async({page})=>{
 const errors=await mount(page,'camera-detail.html?id=11');await expect(page.locator('#effectivePlacement [data-placement-status="ready"]')).toBeVisible();
 await page.evaluate(()=>{const real=window.fetch;let first=true;window.placementTransportStarts=[];window.fetch=async(...args)=>{const path=JSON.parse(args[1].body).path;window.placementTransportStarts.push(path);if(first&&path==='/api/field-map'){first=false;const body=JSON.stringify(snapshotFixture());window.heldPlacementStarted=true;await new Promise(resolve=>window.releasePlacement=resolve);const response=new Response(body,{status:200,headers:{'Content-Type':'application/json'}}),json=response.json.bind(response);response.json=async()=>{try{return await json();}finally{window.heldPlacementBodySettled=true;}};return response;}return real(...args);};window.oldPlacementRead=refreshEffectivePlacement();});
 await expect.poll(()=>page.evaluate(()=>window.heldPlacementStarted===true)).toBe(true);
 await page.evaluate(()=>{history.replaceState({},'','?id=12');return load().catch(()=>{});});await expect(page.locator('#cameraName')).toContainText('SNIPER 00312.2');
 await expect(page.locator('#effectivePlacement')).toContainText('Current physical placement unavailable');await expect(page.locator('#effectivePlacement [data-placement-status="ready"]')).toHaveCount(0);await expect(page.locator('#organization')).not.toContainText('10 Source Road');
 expect(await page.evaluate(()=>placementTransportStarts)).toEqual(Array.from({length:7},()=>['/api/field-map','/api/camera-health/summary-v3']).flat());expect(await page.evaluate(()=>current)).toEqual({});expect(await page.evaluate(()=>writes)).toEqual([]);
 await page.evaluate(()=>window.releasePlacement());await expect.poll(()=>page.evaluate(()=>window.heldPlacementBodySettled===true)).toBe(true);
 // The cancelled consumer settles before the producer; observe the body drain in a later browser turn before retrying.
 await page.evaluate(async()=>{await window.oldPlacementRead;await Promise.resolve();await refreshEffectivePlacement();});
 await expect(page.locator('#effectivePlacement [data-placement-status="ready"]')).toBeVisible();await expect(page.locator('#organization')).toContainText('22 Alias Road');await expect(page.locator('#organization')).not.toContainText('10 Source Road');expect(await page.evaluate(()=>device.id)).toBe(12);
 expect(await page.evaluate(()=>placementTransportStarts)).toEqual(Array.from({length:8},()=>['/api/field-map','/api/camera-health/summary-v3']).flat());expect(await page.evaluate(()=>writes)).toEqual([]);expect(errors).toEqual([]);
});

test('initial network denial preserves source context and camera-opening links with an explicit unavailable state',async({page})=>{
 await page.addInitScript(()=>window.denyPlacement=true);const errors=await mount(page,'camera-detail.html?id=11');
 await expect(page.locator('#error')).toBeVisible();await expect(page.locator('#organization')).toContainText('ROOT');await expect(page.locator('#moveShopBtn')).toHaveText('Move to Field');await expect(page.locator('#interfaceActions a').first()).toBeVisible();await expect(page.locator('#statusPill')).not.toHaveText('OFFLINE');expect(await page.evaluate(()=>current)).toEqual({});expect(errors).toEqual([]);
});

test('existing unique full-family fallback remains available without claiming an Owner or provider identity proof',async({page})=>{
 const errors=await mount(page),card=page.locator('.compact-unit[data-unit="RANGER 022"]');
 await expect(card.locator('[data-placement-status="ready"]')).toBeVisible();await expect.poll(()=>page.evaluate(()=>boardDataReady===true&&cameraLoadPromise===null)).toBe(true);
 const before=await page.evaluate(()=>readRequests.filter(r=>r.path).length);
 await page.evaluate(async()=>{const old=healthFixture;window.healthFixture=()=>({...old(),unitIdentities:[],ownerConfirmedUnitIdentities:[]});await refreshEffectivePlacement();});
 expect(await page.evaluate(()=>readRequests.filter(r=>r.path).length)).toBe(before+2);
 await expect(card.locator('[data-placement-status="ready"]')).toContainText('Exact full unit identifier');await expect(card.locator('.compact-unit-site')).toContainText('10 Source Road');
 await page.evaluate(async()=>{const old=healthFixture;window.healthFixture=()=>{const h=old();h.rows.push({id:99,unit:'RANGER 22'});return h};await refreshEffectivePlacement();});await expect(card.locator('[data-placement-status="unresolved"]')).toContainText('Source group remains separate');await expect(card.locator('.compact-unit-site')).not.toContainText('10 Source Road');expect(errors).toEqual([]);
});

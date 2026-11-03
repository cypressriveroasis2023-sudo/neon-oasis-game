import {test,expect} from '@playwright/test';
import {mountFleet,fresh} from './fleet-dashboard-fixtures.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
for(const it of [false,true])test(`Verify now confirms saved Helios status for ${it?'IT':'Owner'}`,async({page},testInfo)=>{
 const f=fieldProductFixture();f.health.rows[0].evidence.observedAt='2026-10-01T00:00:00Z';Object.assign(f.connections.items.find(i=>i.productId==='1001'),{status:'unknown',checkedAt:null,resourceId:null,reason:'No fresh completed saved check.'});
 const {app,state}=await mountFleet(page,it,{field:f.field,health:f.health,productConnections:f.connections,skipInitialFieldCount:true});
 const posts=[];let release;const gate=new Promise(r=>{release=r;});
 await page.route('**/functions/v1/cos-operations-pages',async route=>{
  if(route.request().method()==='OPTIONS')return route.fallback();const req=route.request().postDataJSON();if(req.path!=='/api/product-connections/verify')return route.fallback();
  posts.push(req);await gate;
  const item=state.productConnections.items.find(i=>i.productId==='1001');Object.assign(item,{status:'online',checkedAt:fresh,resourceId:'10001',reason:'Fresh completed saved TCP/service-port response.'});
  await route.fulfill({headers:{'access-control-allow-origin':'http://127.0.0.1:4173'},json:{contract:'COS_VERIFY_PRODUCTS_NOW_V1',connections:state.productConnections,items:[{productId:'1001',status:'online',checkedAt:fresh,reason:item.reason}]}});
 });
 const board=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});
 await expect(board.locator('.cos-field-product-cards').getByRole('button',{name:'Verify now',exact:true}).first()).toBeVisible();
 await board.locator('.cos-equipment-total-helios .cos-total-status-unverified').click();
 const list=board.getByRole('region',{name:'Helios unverified Field units'});
 await expect(list.getByRole('button',{name:'Verify now',exact:true})).toBeVisible();
 await list.getByRole('button',{name:'Verify all 1 now',exact:true}).click();
 await expect(list.getByRole('button',{name:'Verify now',exact:true})).toBeDisabled();
 await expect(board.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('0');
 state.fail=true;release();await expect(board.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('1');
 await expect(board.locator('.cos-equipment-total-helios .cos-total-status-unverified b')).toHaveText('0');
 expect(state.calls.filter(c=>c.path==='/api/camera-health/summary-v3')).toHaveLength(1);
 expect(posts).toHaveLength(1);expect(posts[0].body).toEqual({productIds:['1001']});
 await expect(list).toContainText('Helios 1: Online');
 await expect(board.locator('.cos-helios-count-equation')).toContainText('1 inventory = 1 Field + 0 Shop');
 await list.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('verify-now-saved-result.png'),fullPage:true});
 // A full reload destroys the manual overlay and every browser cache. The
 // normal saved GET must recover the verified result without another POST.
 state.fail=false;const beforeReload=state.calls.length;await page.reload();
 await expect(board.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('1');
 await expect(board.locator('.cos-equipment-total-helios .cos-total-status-unverified b')).toHaveText('0');
 expect(state.calls.slice(beforeReload).some(c=>c.path==='/api/product-connections')).toBe(true);
 expect(posts).toHaveLength(1);
 expect(state.errors).toEqual([]);
});
test('a held check shows the correction and never fabricates an Online count',async({page})=>{
 const f=fieldProductFixture();f.health.rows[0].evidence.observedAt='2026-10-01T00:00:00Z';Object.assign(f.connections.items[0],{status:'unknown',checkedAt:null,resourceId:null});
 const {app}=await mountFleet(page,false,{field:f.field,health:f.health,productConnections:f.connections,skipInitialFieldCount:true});
 await page.route('**/functions/v1/cos-operations-pages',async route=>{if(route.request().method()==='OPTIONS')return route.fallback();const req=route.request().postDataJSON();if(req.path!=='/api/product-connections/verify')return route.fallback();return route.fulfill({headers:{'access-control-allow-origin':'http://127.0.0.1:4173'},json:{contract:'COS_VERIFY_PRODUCTS_NOW_V1',items:[{productId:'1001',status:'unknown',checkedAt:null,reason:'No verified public tracker IP is available. Open the record to correct it.'}]}});});
 const board=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});await board.locator('.cos-equipment-total-helios .cos-total-status-unverified').click();
 const list=board.getByRole('region',{name:'Helios unverified Field units'});await list.getByRole('button',{name:'Verify now',exact:true}).click();
 await expect(list).toContainText('Needs correction');await expect(board.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('0');
});
test('failed verification unlocks immediately and keeps prior counts without a full dashboard refresh',async({page})=>{
 const f=fieldProductFixture();const {app,state}=await mountFleet(page,false,{field:f.field,health:f.health,productConnections:f.connections,skipInitialFieldCount:true});
 const board=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});await expect(board.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('1');
 await board.locator('.cos-equipment-total-cameras .cos-total-status-unverified').click();
 const list=board.getByRole('region',{name:'Camera units unverified Field units'});await expect(list.getByRole('button',{name:/Verify all/})).toBeEnabled();
 await page.route('**/functions/v1/cos-operations-pages',async route=>{if(route.request().method()==='OPTIONS')return route.fallback();const req=route.request().postDataJSON();if(req.path!=='/api/product-connections/verify')return route.fallback();return route.fulfill({status:503,headers:{'access-control-allow-origin':'http://127.0.0.1:4173'},json:{error:'Verification source temporarily unavailable.'}});});
 const before=state.calls.length;await list.getByRole('button',{name:/Verify all/}).click();await expect(list).toContainText('Verification source temporarily unavailable.');
 await expect(list.getByRole('button',{name:/Verify all/})).toBeEnabled();await expect(board.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('1');
 expect(state.calls.slice(before).filter(c=>['/api/field-map','/api/camera-health/summary-v3'].includes(c.path))).toHaveLength(0);
});

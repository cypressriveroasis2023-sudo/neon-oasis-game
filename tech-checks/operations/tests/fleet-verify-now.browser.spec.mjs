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
 // Keep provider health failing through the cold reload. TCP is independent.
 const beforeReload=state.calls.length;await page.reload();
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

test('40 mixed units retain 26 Online and 14 Offline after a cold reload with failed provider health',async({page})=>{
 const f=fieldProductFixture(),families=['Spotter','Ranger','Helios','Sniper','CAM-V'];
 const template=f.roster.items.find(r=>r.kind==='source_equipment');
 const records=Array.from({length:40},(_,i)=>({productId:String(1001+i),recordId:'mhelp_product:'+String(1001+i),unitNumber:families[i%5]+' '+String(1+Math.floor(i/5)),category:families[i%5],placement:'FIELD',uploadLifecycle:'UNFLAGGED',binding:{state:'unlinked',unitIds:[],candidateUnitIds:[],placementHeld:false}}));
 f.upload.records=records;f.upload.summary={totalRecords:40,fieldRecords:40,shopRecords:0,unflaggedFieldRecords:40,unflaggedShopRecords:0,doNotUseRecords:0,missingRecords:0};
 f.roster.items=records.map(p=>({...template,id:p.recordId,kind:'source_equipment',unitId:null,unit:null,unitNumber:p.unitNumber,placement:'field',lifecycle:'active',active:true,productIds:[p.productId],sourceRecordIds:[p.recordId],representedUnitIds:[]}));
 f.roster.summary={totalRecords:40,activeRecords:40,field:40,shop:0,review:0,excludedLifecycle:0,sourceOnlyRecords:40,linkedUnitRecords:0};
 f.field.items=[];f.field.inventoryItems=[];f.field.summary={fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0};
 f.connections.items=records.map(p=>({productId:p.productId,status:'unknown',basis:'tcp_service_port',checkedAt:null,resourceId:null,reason:'No completed saved check.'}));
 const {app,state}=await mountFleet(page,false,{field:f.field,health:f.health,productConnections:f.connections,skipInitialFieldCount:true});let posts=0;
 await page.route('**/functions/v1/cos-operations-pages',async route=>{
  if(route.request().method()==='OPTIONS')return route.fallback();const req=route.request().postDataJSON();if(req.path!=='/api/product-connections/verify')return route.fallback();posts++;
  const items=req.body.productIds.map(id=>{const row=state.productConnections.items.find(r=>r.productId===id),offline=Number(id)<1015;Object.assign(row,{status:offline?'offline':'online',checkedAt:fresh,resourceId:String(9000+Number(id)),reason:'Completed saved TCP check.'});return {...row};});
  await route.fulfill({headers:{'access-control-allow-origin':'http://127.0.0.1:4173'},json:{contract:'COS_VERIFY_PRODUCTS_NOW_V1',connections:state.productConnections,items}});
 });
 const board=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});await board.locator('.cos-equipment-total-cameras .cos-total-status-unverified').click();
 const list=board.getByRole('region',{name:'Camera units unverified Field units'});await list.getByRole('button',{name:'Verify all 40 now',exact:true}).click();
 await expect(board.locator('.cos-equipment-total-cameras .cos-total-status-online b')).toHaveText('26');
 await expect(board.locator('.cos-equipment-total-cameras .cos-total-status-offline b')).toHaveText('14');
 state.fail=true;await page.reload();
 await expect(board.locator('.cos-equipment-total-cameras .cos-total-status-online b')).toHaveText('26');
 await expect(board.locator('.cos-equipment-total-cameras .cos-total-status-offline b')).toHaveText('14');
 await expect(board.locator('.cos-equipment-total-cameras .cos-total-status-unverified b')).toHaveText('0');
 expect(posts).toBe(10);expect(state.errors).toEqual([]);
});

test('saved connection refresh runs before the provider cache expires and never triggers probes',async({page})=>{
 const f=fieldProductFixture(),{app,state}=await mountFleet(page,false,{field:f.field,health:f.health,productConnections:f.connections,skipInitialFieldCount:true,advancingClock:true});
 const board=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});
 await expect(board.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('1');
 const reads=state.calls.filter(c=>c.path==='/api/product-connections').length,health=state.calls.filter(c=>c.path==='/api/camera-health/summary-v3').length;
 Object.assign(state.productConnections.items.find(i=>i.productId==='1001'),{status:'offline',reason:'Completed saved nonresponse.'});
 await page.clock.fastForward(2*60*1000);
 await expect(board.locator('.cos-equipment-total-helios .cos-total-status-offline b')).toHaveText('1');
 expect(state.calls.filter(c=>c.path==='/api/product-connections').length).toBeGreaterThan(reads);
 expect(state.calls.filter(c=>c.path==='/api/camera-health/summary-v3')).toHaveLength(health);
 expect(state.calls.every(c=>c.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});

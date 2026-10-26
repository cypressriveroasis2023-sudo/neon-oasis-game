import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';

for(const it of [false,true])test((it?'IT':'Owner')+' retains every recorded Field product when saved camera health fails',async({page})=>{
 const f=fieldProductFixture(),{app,state}=await mountFleet(page,it,{field:f.field,health:f.health});
 const list=app.getByRole('region',{name:'Field inventory health breakdown'});
 await expect(list).toBeVisible();await expect(list.locator('details > ul > li')).toHaveCount(7);await expect(list).not.toContainText('Product 1008');
 await expect(list.locator('details > ul > li').filter({hasText:'Product 1006'})).toContainText('FIELD');
 state.fail=true;await app.locator('.cos-fleet-refresh').click();
 await expect(app.getByText('Health refresh unavailable · saved equipment remains visible',{exact:true})).toBeVisible();
 await app.getByText('Refresh details',{exact:true}).click();
 await expect(app.getByText('Synthetic saved camera read unavailable',{exact:true})).toBeVisible();
 await expect(list).toBeVisible();await expect(list.locator('details > ul > li')).toHaveCount(7);await expect(list).toContainText('Connectivity is unavailable');
 await expect(app.locator('.cos-fleet-stat-field strong')).toHaveText('7');
 for(const id of ['1001','1002','1003','1004','1005','1006','1007'])await expect(list.locator('details > ul > li').filter({hasText:'Product '+id})).toContainText('FIELD');
 expect(state.field).toEqual(f.field);expect(state.calls.every(c=>c.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});

test('accepted Product-ID census remains visible without a COS identity roster',async({page})=>{
 const f=fieldProductFixture();delete f.field.fleetRoster;
 // Keep a valid but empty legacy representation layer. It is not the census.
 f.field.items=[];f.field.inventoryItems=[];f.field.summary={fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0};
 const {app,state}=await mountFleet(page,false,{field:f.field,health:f.health,skipInitialFieldCount:true});
 await expect(app.locator('.cos-fleet-stat-field strong')).toHaveText('7');
 const list=app.getByRole('region',{name:'Field inventory health breakdown'});await expect(list).toBeVisible();await expect(list.locator('details > ul > li')).toHaveCount(7);
 await expect(app.locator('.cos-fleet-source-age')).toBeVisible();
 expect(state.calls.every(c=>c.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});

for(const unavailable of [false,true])test('successive accepted Shop Field Shop snapshots update the census with '+(unavailable?'no health':'offline recorder evidence')+' and no GPS',async({page})=>{
 const f=fieldProductFixture(),{app,state}=await mountFleet(page,false,{field:f.field,health:f.health});
 const nativeBefore=structuredClone(state.field.inventoryItems),history=[];
 state.fail=unavailable;
 for(const [i,placement] of ['SHOP','FIELD','SHOP'].entries()){
  const next=structuredClone(state.field),upload=next.uploadInventory;
  upload.sourceSha256=String(i+2).repeat(64);
  const product=upload.records.find(p=>p.productId==='1002');product.placement=placement;product.customer=placement==='SHOP'?'Cameras Onsite LLC':'Current customer: Current site';product.sourceAddress={street:placement==='FIELD'?'123 Current Service St':'',city:'',state:'',zip:''};
  const field=placement==='FIELD'?7:6;Object.assign(upload.summary,{fieldRecords:field,shopRecords:8-field,unflaggedFieldRecords:field-1,unflaggedShopRecords:8-field});
  // Native identity/location and health records remain untouched; only the
  // complete accepted source changes. No health admission can veto the census.
  state.field=next;history.push(structuredClone(upload));
  await app.locator('.cos-fleet-refresh').click();
  await expect(app.locator('.cos-fleet-stat-field strong')).toHaveText(String(field));
  await expect(app.locator('.cos-fleet-stat-shop strong')).toHaveText(String(8-field));
  await expect(app.locator('.cos-fleet-stat-total strong')).toHaveText('8');
  const list=app.getByRole('region',{name:'Field inventory health breakdown'}),products=list.locator('details > ul > li');
  await expect(products).toHaveCount(field);await expect(products.filter({hasText:'Product 1002'})).toHaveCount(placement==='FIELD'?1:0);
  if(placement==='FIELD'){
   await expect(products.filter({hasText:'Product 1002'})).toContainText('Current customer: Current site');
   await expect(products.filter({hasText:'Product 1002'})).toContainText('123 Current Service St');
  }else{
   await app.locator('.cos-fleet-stat-shop').click();
   const shop=app.getByRole('region',{name:'Shop Product-ID inventory'});
   await expect(shop).toBeVisible();await expect(shop.locator('ul > li').filter({hasText:'Product 1002'})).toContainText('Cameras Onsite LLC');
   await expect(shop.locator('ul > li').filter({hasText:'Product 1002'})).toContainText('SHOP / ROOT');
   await app.getByText('Fleet totals & quick filters',{exact:true}).click();
   await app.locator('.cos-fleet-stat-field').click();
  }
  expect(state.field.inventoryItems).toEqual(nativeBefore);
 }
 expect(history.map(h=>h.records.find(p=>p.productId==='1002').placement)).toEqual(['SHOP','FIELD','SHOP']);
 expect(history.every(h=>h.records.length===8)).toBe(true);expect(state.calls.every(c=>c.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});

test('delayed automatic mHelp source shows its original successful time and failure independently of identity roster',async({page})=>{
 const f=fieldProductFixture();delete f.field.fleetRoster;
 f.field.items=[];f.field.inventoryItems=[];f.field.summary={fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0};
 Object.assign(f.field.uploadInventory,{source:'mhelpdesk_api',lastApiReadAt:new Date(f.now-46*60000).toISOString()});
 f.field.mhelpPlacementSync={contract:'COS_MHELP_PLACEMENT_V1',inventoryEnabled:true,lastInventorySuccessAt:f.field.uploadInventory.lastApiReadAt,errorCode:'inventory_source_unavailable'};
 const {app,state}=await mountFleet(page,false,{field:f.field,health:f.health,skipInitialFieldCount:true});
 const inventory=app.getByRole('region',{name:'mHelpDesk equipment Product-ID inventory'});
 await expect(inventory).toBeVisible();await expect(inventory).toContainText('Automatic inventory updates are delayed.');
 await expect(inventory.locator('.cos-fleet-source-age')).toBeVisible();await expect(inventory).toContainText('Last complete mHelpDesk API read');await expect(inventory).toContainText('scheduled every 30 minutes');
 await expect(inventory.getByText('Inventory refresh unavailable; the last successful source remains shown.')).toBeVisible();
 await expect(app.locator('.cos-fleet-stat-field strong')).toHaveText('7');expect(state.field.uploadInventory.lastApiReadAt).toBe(f.field.uploadInventory.lastApiReadAt);
 expect(state.calls.every(c=>c.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});

for(const it of [false,true])test((it?'IT':'Owner')+' opens the complete Field Product-ID list before optional connection diagnostics',async({page})=>{
 const f=fieldProductFixture(),before=structuredClone(f.field),{app,state}=await mountFleet(page,it,{field:f.field,health:f.health});
 const primary=app.getByRole('region',{name:'Fleet units in view'}),products=primary.locator('[data-product-id]');
 await expect(primary.getByRole('heading',{name:'Field equipment 7',exact:true})).toBeVisible();
 await expect(products).toHaveCount(7);
 expect(await products.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-product-id')).sort())).toEqual(['1001','1002','1003','1004','1005','1006','1007']);
 await expect(app.locator('[data-product-id]')).toHaveCount(7);
 for(const id of ['1001','1002','1003','1004','1005','1006','1007'])await expect(primary.locator('[data-product-id="'+id+'"]')).toBeVisible();
 await expect(primary.locator('[data-product-id="1006"]')).toContainText('Identity / placement review');
 await expect(primary.locator('[data-product-id="1007"]')).toContainText('Do Not Use');
 const diagnostics=primary.locator('.cos-fleet-diagnostic-records');
 await expect(diagnostics).not.toHaveAttribute('open','');
 await expect(diagnostics.locator(':scope > summary')).toHaveText('Connection / map records (5)');
 await expect(primary.locator('[data-product-id="1006"]').getByRole('button',{name:'Unit details and troubleshooting'})).toHaveCount(0);
 // Field is an explicit return to the complete inventory, including after local list filters.
 await primary.getByLabel('Search Field inventory',{exact:true}).fill('1002');
 await primary.getByLabel('Field inventory status',{exact:true}).selectOption('offline');
 await expect(products).toHaveCount(1);
 await app.locator('.cos-fleet-stat-field').click();
 await expect(primary.getByLabel('Search Field inventory',{exact:true})).toHaveValue('');
 await expect(primary.getByLabel('Field inventory status',{exact:true})).toHaveValue('all');
 await expect(products).toHaveCount(7);
 await app.locator('.cos-fleet-stat-shop').click();
 const shop=app.getByRole('region',{name:'Shop Product-ID inventory'});
 await expect(shop).toBeVisible();await expect(shop).toContainText('Product 1008');await expect(shop).not.toContainText('Product 1001');
 await app.getByText('Fleet totals & quick filters',{exact:true}).click();
 await app.locator('.cos-fleet-stat-field').click();
 await expect(primary.getByRole('heading',{name:'Field equipment 7',exact:true})).toBeVisible();await expect(products).toHaveCount(7);
 expect(await app.locator('body').evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 expect(state.field).toEqual(before);expect(state.calls.every(call=>call.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});

test('every accepted Field Product ID is reachable through bounded primary-list pagination',async({page})=>{
 const f=fieldProductFixture();
 for(let i=0;i<277;i++){
  const productId=String(10000+i);
  f.upload.records.push({...structuredClone(f.upload.records[4]),productId,recordId:'mhelp_product:'+productId,unitNumber:'ST '+productId,category:'STANDS'});
 }
 Object.assign(f.upload.summary,{totalRecords:285,fieldRecords:284,shopRecords:1,unflaggedFieldRecords:283,unflaggedShopRecords:1});
 const before=structuredClone(f.field),{app,state}=await mountFleet(page,false,{field:f.field,health:f.health});
 const primary=app.getByRole('region',{name:'Fleet units in view'}),products=primary.locator('[data-product-id]');
 await expect(primary.getByRole('heading',{name:'Field equipment 284',exact:true})).toBeVisible();
 await expect(products).toHaveCount(40);
 for(const count of [80,120,160,200,240,280,284]){
  await primary.getByRole('button',{name:/^Show more Field products/}).click();await expect(products).toHaveCount(count);
 }
 const ids=await products.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-product-id')));
 expect(new Set(ids).size).toBe(284);expect(ids.sort()).toEqual(f.upload.records.filter(p=>p.placement==='FIELD').map(p=>p.productId).sort());
 await expect(primary.getByRole('button',{name:/^Show more Field products/})).toHaveCount(0);
 expect(ids).not.toContain('1008');expect(state.field).toEqual(before);expect(state.calls.every(call=>call.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});

for(const it of [false,true])test((it?'IT':'Owner')+' health headline selections show exactly their Field Product IDs',async({page})=>{
 const f=fieldProductFixture(),before=structuredClone(f.field),{app,state}=await mountFleet(page,it,{field:f.field,health:f.health});
 const primary=app.getByRole('region',{name:'Fleet units in view'}),products=primary.locator('[data-product-id]');
 for(const [status,expected] of [['online',['1001']],['offline',['1002']],['unknown',['1003','1005','1006','1007']]]){
  await app.locator('.cos-fleet-stat-'+status).click();await expect(products).toHaveCount(expected.length);
  expect(await products.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-product-id')).sort())).toEqual(expected);
  await expect(app.locator('.cos-fleet-stat-'+status+' strong')).toHaveText(String(expected.length));
 }
 await app.locator('.cos-fleet-stat-field').click();await expect(products).toHaveCount(7);
 await primary.getByLabel('Field inventory status',{exact:true}).selectOption('support');
 await expect(products).toHaveCount(1);await expect(primary.locator('[data-product-id="1004"]')).toBeVisible();
 await app.locator('.cos-fleet-stat-field').click();await expect(products).toHaveCount(7);
 expect(state.field).toEqual(before);expect(state.calls.every(call=>call.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});

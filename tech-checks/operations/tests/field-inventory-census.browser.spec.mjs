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
   await app.locator('.cos-fleet-stat-field').click();
  }
  expect(state.field.inventoryItems).toEqual(nativeBefore);
 }
 expect(history.map(h=>h.records.find(p=>p.productId==='1002').placement)).toEqual(['SHOP','FIELD','SHOP']);
 expect(history.every(h=>h.records.length===8)).toBe(true);expect(state.calls.every(c=>c.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});

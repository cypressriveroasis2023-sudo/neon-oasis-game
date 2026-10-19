import {revealMapFilters} from './field-map-controls.mjs';
import {test,expect} from '@playwright/test';
import {mountFleet,field,fresh} from './fleet-dashboard-fixtures.mjs';
const source='a'.repeat(64),payload='b'.repeat(64);
function addressFixture(){
 const value=structuredClone(field);
 value.uploadInventory={sourceSha256:source,payloadSha256:payload,contract:'COS_MHELP_UPLOAD_INVENTORY_V1',summary:{totalRecords:1001},records:Array.from({length:1001},(_,i)=>({productId:String(i+1),placement:i<287?'FIELD':'SHOP'}))};
 value.mhelpAddressMap={contract:'COS_MHELP_CENSUS_ADDRESS_MAP_V1',sourceSha256:source,payloadSha256:payload,totalProducts:1001,fieldProducts:287,shopProducts:714,verifiedGps:false,liveGps:false,confidence:'mhelpdesk_customer_address_reference_only',items:Array.from({length:287},(_,i)=>({
  productId:String(i+1),sourceRowSha256:'c'.repeat(64),unitNumber:i===0?'Solar Stand 72 001':'Field equipment '+(i+1),customer:'Synthetic service customer',category:i===0?'Solar Stand 72':'Other',placement:'FIELD',lifecycle:i===1?'DO_NOT_USE':'UNFLAGGED',placementHeld:i===2,
  sourceAddress:{street:'123 Example Rd',city:'Houston',state:'TX',zip:'77064'},
  status:i<147?'matched':i<161?'address_review':i<273?'no_match':'invalid_address',reason:i<161?null:'Confirm the service building number and street in mHelpDesk.',
  matchedAddress:i<147?'123 EXAMPLE RD, HOUSTON, TX, 77064':i<161?'123 EXAMPLE RD, HOUSTON, TX, 77065':null,
  latitude:i<161?30:null,longitude:i<161?-96:null,geocodedAt:fresh,geocodeSource:'us_census_address_range',verified:false,liveGps:false,confidence:'mhelpdesk_address_census_range_unverified'
 }))};return value;
}
for(const it of [false,true])test(`${it?'IT':'Owner'} all Field products, shared addresses, solar stands and unresolved records work independently of native GPS`,async({page},info)=>{
 const {app,state}=await mountFleet(page,it,{field:addressFixture()});
 const coverage=app.locator('.cos-mhelp-address-coverage');await coverage.locator(':scope>summary').click();await expect(coverage).toContainText('Field locations · 161 of 287 equipment located · 126 need an address pin');
 const marker=app.locator('.cos-mhelp-address-marker'),groups=app.locator('.cos-compact-group-marker');
 await expect(groups).toHaveCount(1);await expect(groups).toHaveAttribute('data-group-count','161');
 expect(await groups.evaluateAll(nodes=>nodes.flatMap(n=>JSON.parse(n.dataset.mhelpProductIds)).sort((a,b)=>Number(a)-Number(b)))).toEqual(Array.from({length:161},(_,i)=>String(i+1)));
 await groups.click();
 await expect(app.locator('.cos-compact-group-popup')).toContainText('161 equipment at nearby locations');
 await expect(app.locator('.cos-compact-group-popup')).toContainText('Solar Stand 72 001');
 await app.locator('.cos-compact-show-all').click();
 await expect(app.locator('.cos-compact-popup-member')).toHaveCount(161);
 await app.locator('.cos-fleet-map-toolbar').click();
 await expect(app.locator('.cos-fleet-map-toolbar')).toContainText('1 verified');
 await app.locator('.cos-fleet-map-panel').scrollIntoViewIfNeeded();await app.getByLabel('Fleet map details',{exact:true}).click();await app.getByLabel('Find mapped equipment').selectOption('1');
 const drawer=app.getByRole('dialog',{name:'Solar Stand 72 001 MHelp customer address'});
 await expect(drawer).toBeVisible();await expect(drawer).toContainText('FIELD · current mHelpDesk source');await expect(drawer).toContainText('Original mHelpDesk address');
 await expect(drawer.locator('input,select,textarea')).toHaveCount(0);await page.keyboard.press('Escape');await expect(drawer).toHaveCount(0);
 await app.getByLabel('Find mapped equipment').selectOption('148');await expect(app.getByRole('dialog')).toContainText('Approximate address location');await expect(app.getByRole('dialog')).toContainText('77064');await expect(app.getByRole('dialog')).toContainText('77065');await app.getByRole('button',{name:'Close MHelp address details'}).click();
 await expect(app.locator('.cos-fleet-stat-verify')).toContainText('MHELP ADDRESS QUEUE');await expect(app.locator('.cos-fleet-stat-verify strong')).toHaveText('126');
 const queue=app.locator('.cos-mhelp-address-followups');await app.locator('.cos-fleet-stat-verify').click();await expect(queue.locator('li')).toHaveCount(126);
 await queue.locator('li').filter({hasText:'Product 287 ·'}).getByRole('button',{name:'Open unit record'}).click();await expect(app.getByRole('dialog')).toContainText('Product 287');await expect(app.getByRole('dialog')).toContainText('invalid address');await app.getByRole('button',{name:'Close MHelp address details'}).click();
 await app.getByLabel('Fleet status').selectOption('offline');await expect(groups).toHaveCount(0);await expect(marker).toHaveCount(0);
 await revealMapFilters(app);await app.getByLabel('Fleet placement').selectOption('shop');await expect(groups).toHaveCount(0);await expect(marker).toHaveCount(0);await expect(queue).toHaveCount(0);
 await app.getByLabel('Fleet placement').selectOption('field');await app.getByLabel('Fleet status').selectOption('all');await expect(groups).toHaveCount(1);
 expect(await app.locator('html').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 await app.locator('.cos-fleet-map-panel').screenshot({path:info.outputPath('mhelp-address-layer.png')});
 expect(state.calls.every(c=>c.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});
test('a changed source payload hides only the address overlay and preserves existing verified pins',async({page})=>{
 const value=addressFixture();value.mhelpAddressMap.payloadSha256='f'.repeat(64);const {app,state}=await mountFleet(page,false,{field:value});
 await expect(app.locator('.cos-mhelp-address-marker')).toHaveCount(0);await expect(app.getByRole('alert')).toContainText('Field address layer could not be validated');await expect(app.locator('.cos-fleet-map-toolbar')).toContainText('1 verified');expect(state.calls.every(c=>c.method==='GET')).toBe(true);
});
test('restored viewport survives initial address and native marker validation',async({page})=>{
 await page.addInitScript(()=>history.replaceState({...history.state,cosFieldMapView:{status:'field',health:'all',center:[28,-94],zoom:6}},''));
 const {app,state}=await mountFleet(page,false,{field:addressFixture()});
 await expect(app.locator('.cos-compact-group-marker')).toHaveCount(1);
 await expect(app.locator('.cos-fleet-map-toolbar')).toContainText('1 verified');
 const view=await app.locator('body').evaluate(()=>history.state.cosFieldMapView);
 expect(view.center).toEqual([28,-94]);expect(view.zoom).toBe(6);
 expect(state.calls.every(c=>c.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});

test('an accepted replacement file with different counts renders its exact Field Product IDs',async({page})=>{
 const value=addressFixture();value.uploadInventory.summary.totalRecords=5;value.uploadInventory.records=value.uploadInventory.records.slice(0,5);value.uploadInventory.records[3].placement='SHOP';value.uploadInventory.records[4].placement='SHOP';
 value.mhelpAddressMap={...value.mhelpAddressMap,totalProducts:5,fieldProducts:3,shopProducts:2,items:value.mhelpAddressMap.items.slice(0,3)};
 const {app}=await mountFleet(page,false,{field:value});
 const coverage=app.locator('.cos-mhelp-address-coverage');await expect(coverage).toBeVisible();
 const summary=coverage.locator(':scope>summary');if(await summary.count()){await summary.click();await expect(coverage).toContainText('Field locations · 3 of 3 equipment located · 0 need an address pin');}else await expect(coverage).toContainText('3 mHelpDesk Field Product IDs · 3 units with address coordinates · 0 addresses awaiting coordinates');
 expect(await app.locator('.cos-mhelp-address-marker').evaluateAll(nodes=>nodes.map(n=>n.dataset.mhelpProductId).sort())).toEqual(['1','2','3']);
 await revealMapFilters(app);await app.getByLabel('Fleet placement').selectOption('shop');await expect(app.locator('.cos-mhelp-address-marker')).toHaveCount(0);
});

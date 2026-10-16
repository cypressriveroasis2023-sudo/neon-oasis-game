import {test,expect} from '@playwright/test';
import {mountFleet,field} from './fleet-dashboard-fixtures.mjs';
import {combinedSourcePinFixture,sourceReceipt} from './fixtures/source-equipment-pin-fixtures.mjs';
for(const it of [false,true])test(`${it?'IT Camera Health excludes the source-address map workspace':'Owner source address pins share counts and have read-only source selection'}`,async({page},info)=>{
 const value=combinedSourcePinFixture(field),{app,state}=await mountFleet(page,it,{field:value});
 if(it){await expect(app.getByRole('region',{name:'Camera Health',exact:true})).toBeVisible();await expect(app.locator('.cos-source-equipment-marker,.cos-fleet-source-record')).toHaveCount(0);await expect(app.getByRole('button',{name:'View estimated address'})).toHaveCount(0);expect(state.calls.every(call=>call.method==='GET')).toBe(true);expect(state.errors).toEqual([]);return;}
 await expect(app.locator('.cos-fleet-stat-field strong')).toHaveText('6');await expect(app.locator('.cos-fleet-stat-verify strong')).toHaveText('3');
 for(const status of ['online','offline','unknown'])await expect(app.locator('.cos-fleet-stat-'+status+' strong')).toHaveText('1');
 await expect(app.locator('.cos-fleet-map-toolbar')).toContainText('3 equipment pins · 1 verified · 2 estimated');await expect(app.getByRole('button',{name:'Estimated / source-recorded location: 2',exact:true})).toBeVisible();
 const sourceCard=app.locator('.cos-fleet-source-record').filter({hasText:'Ranger 901'});await expect(sourceCard).toContainText('Estimated address · Unlinked equipment');await expect(sourceCard.locator('[data-unit-id]')).toHaveCount(0);
 await sourceCard.getByRole('button',{name:'View estimated address'}).click();const dialog=app.getByRole('dialog',{name:'Ranger 901 source equipment details'});await expect(dialog).toBeVisible();await expect(dialog.getByRole('heading',{name:'Estimated address',exact:true})).toBeVisible();await expect(dialog).toContainText('not live GPS or device health');await expect(dialog.locator('button')).toHaveCount(1);await expect(dialog.locator('[data-unit-id],input,select,textarea,a')).toHaveCount(0);expect(page.url()).not.toContain('mhelp_product');
 await page.screenshot({path:info.outputPath(`source-equipment-open-drawer-${it?'it':'owner'}-${info.project.name}.png`),fullPage:true});
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(sourceCard.getByRole('button',{name:'View estimated address'})).toBeFocused();await sourceCard.getByRole('button',{name:'View estimated address'}).click();await app.getByRole('button',{name:'Close equipment details'}).click();await expect(dialog).toHaveCount(0);
 await app.getByRole('button',{name:'Estimated / source-recorded location: 2',exact:true}).click();await expect(app.getByRole('heading',{name:'Location verification · 2 units'})).toBeVisible();await expect(app.getByRole('region',{name:'Unlinked Field equipment with estimated addresses'}).locator('.cos-fleet-source-record')).toHaveCount(2);
 await app.getByLabel('Location review type').selectOption('missing');await expect(app.getByRole('heading',{name:'Location verification · 3 units'})).toBeVisible();await expect(app.getByRole('region',{name:'Unlinked Field equipment without a map location'}).locator('.cos-fleet-source-record')).toHaveCount(1);await expect(app.getByRole('region',{name:'Unlinked Field equipment without a map location'})).toContainText('Ranger 903');
 await app.getByRole('button',{name:'Map',exact:true}).click();await app.getByLabel('Search units, customers, sites or addresses').fill('Solar Stand 902');await expect(app.locator('.cos-source-equipment-marker')).toHaveCount(1);const marker=app.locator('.cos-source-equipment-marker');await expect(marker).toHaveAttribute('data-record-id','mhelp_product:910002');await expect(marker).toHaveAttribute('aria-label',/Unlinked equipment · Estimated address/);await expect(marker.locator('[data-health]')).toHaveCount(0);await expect(app.locator('.cos-fleet-stat-verify strong')).toHaveText('0');await marker.click();await expect(app.getByRole('dialog',{name:'Solar Stand 902 source equipment details'})).toBeVisible();await app.getByRole('button',{name:'Close equipment details'}).click();
 await app.getByLabel('Search units, customers, sites or addresses').fill('');await app.getByLabel('Fleet placement').selectOption('all');await app.getByLabel('Include inactive / retired').check();await expect(app.locator('.cos-fleet-map-toolbar')).toContainText('3 equipment pins');await expect(app.locator('.cos-fleet-stat-verify strong')).toHaveText('3');
 await page.screenshot({path:info.outputPath(`source-equipment-${it?'it':'owner'}.png`),fullPage:true});expect(state.calls.every(call=>call.method==='GET')).toBe(true);expect(state.calls.some(call=>/mhelp_product/.test(call.path))).toBe(false);expect(state.errors).toEqual([]);
});
test('changed upload receipt rejects all source estimates while leaving native pins and missing queue intact',async({page})=>{
 const value=combinedSourcePinFixture(field);value.uploadInventory={...sourceReceipt,payloadSha256:'f'.repeat(64)};const {app,state}=await mountFleet(page,false,{field:value});await expect(app.locator('.cos-fleet-map-toolbar')).toContainText('1 unit pins · 1 verified · 0 estimated');await expect(app.locator('.cos-fleet-stat-verify strong')).toHaveText('5');await expect(app.locator('.cos-source-equipment-marker')).toHaveCount(0);await expect(app.getByRole('button',{name:'View estimated address'})).toHaveCount(0);await app.getByRole('button',{name:'Missing map location: 5',exact:true}).click();await expect(app.getByRole('heading',{name:'Location verification · 5 units'})).toBeVisible();expect(state.calls.every(call=>call.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});
test('mixed clusters preserve all native/source identities and do not assert source health',async({page})=>{
 const value=combinedSourcePinFixture(field);for(const estimate of value.sourceEquipmentEstimates.items){estimate.latitude=29.7;estimate.longitude=-95.4;}
 const {app,state}=await mountFleet(page,false,{field:value});await expect(app.locator('.cos-dashboard-cluster')).toHaveCount(1);const cluster=app.locator('.cos-dashboard-cluster');await expect(cluster).toHaveAttribute('data-record-ids',JSON.stringify(['mhelp_product:910001','mhelp_product:910002']));await expect(cluster).toHaveAttribute('data-unit-ids',JSON.stringify([field.items[0].id]));await expect(cluster).toHaveAttribute('data-health','mixed');await expect(cluster.locator('[data-unlinked-count]')).toHaveAttribute('data-unlinked-count','2');await cluster.click();await expect(app.locator('.cos-dashboard-peer')).toHaveCount(3);await expect(app.locator('.cos-source-equipment-marker')).toHaveCount(2);await expect(app.locator('.cos-source-equipment-marker [data-health]')).toHaveCount(0);await cluster.click();await expect(app.locator('.cos-dashboard-peer')).toHaveCount(0);expect(state.errors).toEqual([]);
});

for(const it of [false,true])test(`${it?'IT repeated Fleet aliases cannot expose source details':'Owner explicit menu and repeated workspace entries dismiss source details'}`,async({page})=>{
 const {app,state}=await mountFleet(page,it,{field:combinedSourcePinFixture(field)});
 if(it){for(const hash of ['#fleet-dashboard','#field-map','#camera-health']){await app.locator('body').evaluate((_,hash)=>location.hash=hash,hash);await expect.poll(()=>app.locator('body').evaluate(()=>location.hash)).toBe('#camera-health');await expect(app.getByRole('region',{name:'Camera Health',exact:true})).toBeVisible();await expect(app.getByRole('dialog',{name:/source equipment details/})).toHaveCount(0);await expect(app.locator('.cos-fleet-source-record')).toHaveCount(0);}expect(state.calls.every(call=>call.method==='GET')).toBe(true);expect(state.errors).toEqual([]);return;}
 const source=()=>app.locator('.cos-fleet-source-record').filter({hasText:'Ranger 901'}).getByRole('button',{name:'View estimated address'});
 const open=async()=>{await source().click();await expect(app.getByRole('dialog',{name:'Ranger 901 source equipment details'})).toBeVisible();};
 // Synthetic menu clicks exercise the normal navigate callback even while the modal blocks pointer input.
 const enter=async name=>{await app.getByRole('button',{name:'More',exact:true}).first().dispatchEvent('click');const menu=app.getByRole('dialog',{name:'Operations navigation'});await expect(menu).toBeVisible();await menu.getByRole('button',{name,exact:true}).dispatchEvent('click');await expect(menu).toHaveCount(0);await expect(app.getByRole('dialog',{name:'Ranger 901 source equipment details'})).toHaveCount(0);};
 for(let repeat=0;repeat<2;repeat++){
  await open();await enter('Camera Health');await expect(app.locator('.cos-fleet-table-wrap')).toBeVisible();
  await open();await enter('Camera Health');await expect(app.locator('.cos-fleet-table-wrap')).toBeVisible();
  await open();await enter('Fleet Dashboard');await expect(app.locator('.cos-fleet-map-canvas')).toBeVisible();
  await open();await enter('Fleet Dashboard');await expect(app.locator('.cos-fleet-map-canvas')).toBeVisible();
 }
 // A fresh source selection performs its own unitless onSelectUnit transition and must remain open.
 await open();await app.getByRole('button',{name:'Close equipment details'}).click();await expect(app.getByRole('dialog',{name:'Ranger 901 source equipment details'})).toHaveCount(0);
 // Use the iframe's real history entries, created by normal workspace navigation.
 const frameDocument=app.locator('html');
 const expectWorkspace=async(hash,view)=>{
  await expect.poll(()=>frameDocument.evaluate(()=>window.location.hash)).toBe(hash);
  await expect(app.getByRole('dialog',{name:'Ranger 901 source equipment details'})).toHaveCount(0);
  await expect(app.locator(view==='map'?'.cos-fleet-map-canvas':'.cos-fleet-table-wrap')).toBeVisible();
  await expect(app.locator(view==='map'?'.cos-fleet-table-wrap':'.cos-fleet-map-canvas')).toHaveCount(0);
 };
 await open();await enter('Camera Health');await expectWorkspace('#camera-health','fleet');
 await open();await frameDocument.evaluate(()=>window.history.back());await expectWorkspace('#fleet-dashboard','map');
 await open();await frameDocument.evaluate(()=>window.history.forward());await expectWorkspace('#camera-health','fleet');
 // Revisiting either entry without a fresh selection must not revive dismissed source details.
 await frameDocument.evaluate(()=>window.history.back());await expectWorkspace('#fleet-dashboard','map');
 await frameDocument.evaluate(()=>window.history.forward());await expectWorkspace('#camera-health','fleet');
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);expect(state.calls.some(call=>/mhelp_product/.test(call.path))).toBe(false);expect(state.errors).toEqual([]);
});

for(const fieldName of ['receiptId','uploadRecordSha256'])test(`source estimates without reviewed ${fieldName} remain missing`,async({page})=>{
 const value=combinedSourcePinFixture(field);for(const item of value.sourceEquipmentEstimates.items)delete item[fieldName];
 const {app,state}=await mountFleet(page,false,{field:value});await expect(app.locator('.cos-fleet-map-toolbar')).toContainText('1 unit pins · 1 verified · 0 estimated');await expect(app.locator('.cos-fleet-stat-verify strong')).toHaveText('5');await expect(app.locator('.cos-source-equipment-marker')).toHaveCount(0);await expect(app.getByRole('button',{name:'View estimated address'})).toHaveCount(0);expect(state.calls.every(call=>call.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});

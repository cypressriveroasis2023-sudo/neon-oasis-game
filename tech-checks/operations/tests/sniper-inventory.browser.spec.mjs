import {test,expect} from '@playwright/test';
import {mountFleet,field,fresh} from './fleet-dashboard-fixtures.mjs';
const source=(id,extra={})=>({recordId:'mhelp_product:'+id,productId:id,sourceUnitNumber:'Sniper '+id,category:'Sniper 2',customer:'Synthetic company',placement:'SHOP',uploadLifecycle:'UNFLAGGED',binding:{state:'unlinked'},...extra});
test('inventory shows restricted Field and unlinked Shop independently of health filters without writes',async({page})=>{
 const value=structuredClone(field),records=[source('901'),source('902',{sourceUnitNumber:'Sniper 902 - DO NOT USE',placement:'FIELD',uploadLifecycle:'DO_NOT_USE'}),source('903',{sourceUnitNumber:'Thermal Sniper 903 - DO NOT USE',category:'Thermal - Sniper',uploadLifecycle:'DO_NOT_USE',inventoryOnlyReason:'no_sim',binding:{state:'held'}}),source('904',{sourceUnitNumber:'Helios 904',category:'Helios'})];
 value.uploadInventory={contract:'COS_MHELP_UPLOAD_INVENTORY_V1',countBasis:'mhelp_product_records_not_unique_physical_units',receivedAt:fresh,summary:{totalRecords:records.length},records};
 const {app,state}=await mountFleet(page,false,{hash:'#camera-health',field:value});
 const summary=app.getByText('Sniper / CAM V inventory · 3 records',{exact:true});await summary.click();
 const panel=app.locator('details').filter({hasText:'Sniper / CAM V inventory'});await expect(panel).toContainText('1 recorded FIELD · 2 SHOP · 2 DO NOT USE');await expect(panel.locator('tbody tr')).toHaveCount(3);await expect(panel).toContainText('No SIM / no current IP');await expect(panel).not.toContainText('Helios 904');await expect(panel).not.toContainText(/online|offline|SHOP \/ ROOT/i);
 const dnu=panel.locator('tr').filter({hasText:'Sniper 902 - DO NOT USE'});await expect(dnu).toContainText('FIELD');await expect(dnu).toContainText('DO NOT USE');await app.getByLabel('Fleet status').selectOption('offline');await expect(panel.locator('tbody tr')).toHaveCount(3);
 await app.getByLabel('Fleet status').selectOption('all');await app.getByLabel('Fleet placement').selectOption('shop');const shop=app.locator('.cos-fleet-table-wrap tbody tr').filter({hasText:'Sniper 44'});await expect(shop).toContainText('SHOP');await expect(shop).not.toContainText(/online|offline|SHOP \/ ROOT/i);expect(state.calls.every(c=>c.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});

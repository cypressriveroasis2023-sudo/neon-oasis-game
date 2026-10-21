import {test,expect} from '@playwright/test';
import {mountFleet,field,fresh} from './fleet-dashboard-fixtures.mjs';
import {recordedRoster} from './fixtures/recorded-roster-fixtures.mjs';
for(const it of [false,true])test(`${it?'IT':'Owner'} sees automatic API inventory, source time and preserved camera status`,async({page})=>{
 const value=structuredClone(field);value.fleetRoster=recordedRoster(value.inventoryItems,fresh);
 value.fleetRoster.items.forEach(r=>{if(r.source==='owner_supplied_mhelp_export')r.source='mhelpdesk_api';});
 const records=Array.from({length:1001},(_,i)=>({recordId:'mhelp_product:'+String(i+1),productId:String(i+1),placement:i<287?'FIELD':'SHOP',uploadLifecycle:'UNFLAGGED'}));
 value.uploadInventory={contract:'COS_MHELP_UPLOAD_INVENTORY_V1',source:'mhelpdesk_api',countBasis:'mhelp_product_records_not_unique_physical_units',sourceSha256:'a'.repeat(64),receivedAt:fresh,lastApiReadAt:fresh,records,summary:{totalRecords:1001,fieldRecords:287,shopRecords:714,unflaggedFieldRecords:287,doNotUseRecords:0,missingRecords:0}};
 value.mhelpPlacementSync={contract:'COS_MHELP_PLACEMENT_V1',inventoryEnabled:true,lastInventorySuccessAt:fresh,lastSuccessAt:fresh,errorCode:null};
 const {app,state}=await mountFleet(page,it,{field:value});
 const inventory=app.getByRole('region',{name:'mHelpDesk equipment Product-ID inventory'});await expect(inventory).toContainText('287 Field');await expect(inventory).toContainText('714 Shop');await expect(inventory).toContainText('1001 total equipment records');
 await inventory.getByText('Inventory source details',{exact:true}).click();await expect(inventory).toContainText('Last complete mHelpDesk API read');await expect(inventory).not.toContainText('not a live mHelpDesk read');
 // This synthetic census has no Product-ID/provider associations. Native
 // camera evidence remains separate and must not be assigned to those IDs.
 await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('0');await expect(app.locator('.cos-fleet-stat-offline strong')).toHaveText('0');await expect(app.locator('.cos-fleet-stat-unknown strong')).toHaveText('287');
 await expect(app.locator('.cos-fleet-unit-row').filter({hasText:'Helios 1'}).locator('[aria-label="camera: Online"]')).toBeVisible();
 await expect(app.locator('.cos-fleet-unit-row').filter({hasText:'Spotter 1'}).locator('[aria-label="camera: Offline"]')).toBeVisible();
 await app.getByRole('button',{name:/Data sources/}).click();const status=app.getByRole('region',{name:'mHelpDesk placement update'});await expect(status).toContainText('mHelpDesk automatic inventory updates');await expect(status).toContainText('Last successful inventory update');
 await page.screenshot({path:test.info().outputPath('automatic-mhelp-inventory.png'),fullPage:true});
 state.field.mhelpPlacementSync.errorCode='inventory_source_unavailable';await app.getByRole('button',{name:'↻ Refresh data',exact:true}).click();await expect(app.getByRole('status',{name:'mHelpDesk update delayed'})).toBeVisible();await expect(inventory).toContainText('1001 total equipment records');
 expect(state.calls.every(c=>c.method==='GET')).toBeTruthy();expect(state.errors).toEqual([]);
});

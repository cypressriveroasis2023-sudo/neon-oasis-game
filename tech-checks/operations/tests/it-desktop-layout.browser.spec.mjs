import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';

// Exercise the real shared Fleet component with existing role-scoped sessions.
// Data, identities and provider evidence are the same for every presentation.
const views=[
 {name:'Owner',it:false,daily:false,management:true},
 {name:'verified IT',it:true,daily:false,management:false},
 {name:'Owner using the IT daily view',it:false,daily:true,management:false},
];

for(const view of views)test(view.name+' retains Fleet search and saved evidence with the correct management controls',async({page},info)=>{
 const {app,state}=await mountFleet(page,view.it,{
  hash:view.daily?'?mode=it-daily#fleet-dashboard':'#fleet-dashboard',
  // Real IT has no installation verification feature. An Owner daily view must
  // also hide management even though the underlying Owner still has that feature.
  features:{fieldLocationVerification:!view.it,ownerIdentityReview:!view.it,fleetPlacementEdit:true,fleetConnectionEdit:true},
 });
 const originalField=structuredClone(state.field);
 const tabs=app.getByRole('navigation',{name:'Fleet dashboard views'});
 await expect(app.getByRole('region',{name:'COS Fleet Dashboard',exact:true})).toBeVisible();
 await expect(app.locator('.cos-fleet-map-canvas')).toBeVisible();
 await expect(app.getByRole('region',{name:'Fleet units in view',exact:true})).toBeVisible();
 await expect(app.locator('.cos-fleet-unit-row')).toHaveCount(3);
 await app.getByRole('searchbox',{name:'Search units, customers, sites or addresses'}).fill('Spotter 2');
 await expect(app.locator('.cos-fleet-unit-row')).toHaveCount(1);
 await expect(app.locator('.cos-fleet-unit-row')).toContainText('Spotter 2');
 await app.getByRole('button',{name:'Clear fleet search',exact:true}).click();
 await expect(app.locator('.cos-fleet-unit-row')).toHaveCount(3);
 await app.locator('.cos-fleet-unit-row').filter({hasText:'Helios 1'}).click();
 const dialog=app.getByRole('dialog',{name:'Helios 1 unit intelligence',exact:true});
 await expect(dialog).toBeVisible();
 await dialog.locator('details.cos-fleet-installation-evidence > summary').click();
 await expect(dialog.getByText('Verified installation',{exact:true})).toBeVisible();
 await expect(dialog.getByText('29.7, -95.4',{exact:true})).toBeVisible();
 const installation=dialog.getByRole('button',{name:'Edit / verify installation →',exact:true});
 if(view.management)await expect(installation).toBeVisible();
 else await expect(installation).toHaveCount(0);
 // Existing placement permission remains available; this is not an Owner grant.
 await expect(dialog.getByRole('button',{name:'Move to Shop / ROOT',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Close unit details',exact:true}).click();
 if(view.management){
  await tabs.getByRole('button',{name:/Needs setup/}).click();
  await expect(app.getByRole('heading',{name:'HELIOS 011',exact:true})).toBeVisible();
  await expect(app.getByRole('button',{name:'Register in COS inventory →',exact:true})).toBeVisible();
 }else{
  await expect(tabs.getByRole('button',{name:/Needs setup/})).toHaveCount(0);
  await expect(app.getByRole('button',{name:'Register in COS inventory →',exact:true})).toHaveCount(0);
  await tabs.getByRole('button',{name:/Location verification/}).click();
  await app.locator('.cos-fleet-review-grid article').filter({hasText:'Spotter 2'}).getByRole('button',{name:'View saved evidence →',exact:true}).click();
  const evidence=app.getByRole('dialog',{name:'Spotter 2 unit intelligence',exact:true});
  await expect(evidence).toBeVisible();
  await expect(evidence.locator('details.cos-fleet-installation-evidence')).toBeVisible();
  await expect(evidence.getByRole('button',{name:'Edit / verify installation →',exact:true})).toHaveCount(0);
  await evidence.getByRole('button',{name:'Close unit details',exact:true}).click();
 }
 await tabs.getByRole('button',{name:/Fleet health/}).click();
 await expect(app.locator('.cos-fleet-table-wrap tbody tr')).toHaveCount(3);
 // Existing saved health remains unchanged while the available controls differ.
 await expect(app.locator('.cos-fleet-table-wrap tbody tr').filter({hasText:'Spotter 1'}).locator('[data-label="Camera / connection"]')).toContainText('Offline');
 await expect(app.locator('.cos-fleet-table-wrap tbody tr').filter({hasText:'Spotter 2'}).locator('[data-label="Camera / connection"]')).toContainText('Unverified');
 await page.screenshot({path:info.outputPath(view.name.replaceAll(' ','-')+'-fleet-health.png'),fullPage:true});
 expect(state.field).toEqual(originalField);
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);
 expect(state.errors).toEqual([]);
});

for(const view of views)test(view.name+' shows complete source evidence with CSV management limited to Owner',async({page})=>{
 const fixture=fieldProductFixture();
 const {app,state}=await mountFleet(page,view.it,{
  hash:view.daily?'?mode=it-daily#fleet-dashboard':'#fleet-dashboard',
  field:fixture.field,health:fixture.health,
 });
 const originalField=structuredClone(state.field);
 await app.getByRole('navigation',{name:'Fleet dashboard views'}).getByRole('button',{name:/Data sources/}).click();
 const board=app.getByRole('region',{name:'Complete mHelpDesk Fleet command center',exact:true});
 await expect(board).toBeVisible();
 await expect(board.locator('.cos-command-rows .cos-command-row')).toHaveCount(7);
 await expect(board.locator('.cos-command-metadata')).toContainText('7 Field + 1 Shop = 8');
 const imported=app.getByRole('region',{name:'Owner equipment inventory CSV preview',exact:true});
 const sync=board.getByRole('button',{name:'mHelpDesk CSV / sync →',exact:true});
 if(view.management){
  await expect(imported).toBeVisible();
  await expect(sync).toBeVisible();
  await expect(imported.getByRole('button',{name:'Preview equipment changes',exact:true})).toBeVisible();
 }else{
  await expect(imported).toHaveCount(0);
  await expect(sync).toHaveCount(0);
  await expect(app.getByRole('button',{name:'Preview equipment changes',exact:true})).toHaveCount(0);
 }
 await board.getByRole('searchbox',{name:'Search all Field Product IDs',exact:true}).fill('1006');
 await expect(board.locator('.cos-command-rows .cos-command-row')).toHaveCount(1);
 await expect(board.locator('.cos-command-rows')).toContainText('Ranger 902');
 await expect(board.locator('.cos-command-rows')).toContainText('Device link needed');
 await board.getByRole('button',{name:'Clear filters',exact:true}).click();
 await expect(board.locator('.cos-command-rows .cos-command-row')).toHaveCount(7);
 expect(state.field).toEqual(originalField);
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);
 expect(state.errors).toEqual([]);
});

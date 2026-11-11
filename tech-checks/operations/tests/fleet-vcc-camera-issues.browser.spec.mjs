import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
import {resource,snapshot,withStatus} from './fixtures/camera-evidence-fixtures.mjs';

// Owner decision 2026-11-11: green = all cameras up, yellow = some cameras down
// with the issues shown, red = completely down, taken from VCC by unit name.
const cam=(id,unit,status)=>withStatus({...resource(id,unit),name:unit+' CAM '+id},status);
async function open(page,extra){
 const f=fieldProductFixture();
 const health=Object.assign(snapshot([...f.health.rows,...extra]),{identityVersion:1,unitIdentities:f.health.unitIdentities,identityWarnings:[]});
 const {app}=await mountFleet(page,false,{field:f.field,health,productConnections:f.connections,skipInitialFieldCount:true});
 return app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});
}
test('a unit with one camera down in VCC is shown in yellow with the camera named, apart from fully online units',async({page})=>{
 const board=await open(page,[cam(51,'RANGER 901','online'),cam(52,'RANGER 901','offline'),cam(53,'RANGER 901','online')]);
 const card=board.locator('.cos-equipment-total-cameras');
 const issues=card.locator('.cos-total-status-issues');await expect(issues).toContainText('Issues');await expect(issues.locator('b')).toHaveText('1');
 await expect(card.locator('.cos-total-status-online b')).toHaveText('1');           // Helios 1 only; Ranger 901 is counted under Issues
 await issues.click();
 const list=board.locator('.cos-equipment-status-list');await expect(list.locator('h3')).toContainText('Camera issues · 1 Field units');
 await expect(list.locator('li')).toHaveCount(1);await expect(list.locator('li')).toContainText('Ranger 901');
 await expect(list.locator('li .cos-product-issues')).toHaveText('2 of 3 cameras online in VCC. Offline: RANGER 901 CAM 52.');
 await expect(list.locator('li')).toContainText('VCC-reported, matched by unit name.');
 await card.locator('.cos-total-status-online').click();await expect(list.locator('li')).toHaveCount(1);await expect(list.locator('li')).not.toContainText('Ranger 901');
 await expect(board.getByLabel('Units online with camera issues')).toContainText('1 online with camera issues (VCC): Ranger 901');
 if(process.env.COS_SHOT)await card.screenshot({path:process.env.COS_SHOT});
});
test('all cameras down is counted offline (red); all up is counted online (green); no yellow tile appears',async({page})=>{
 let board=await open(page,[cam(51,'RANGER 901','offline'),cam(52,'RANGER 901','offline')]);
 let card=board.locator('.cos-equipment-total-cameras');
 await expect(card.locator('.cos-total-status-offline b')).toHaveText('2');await expect(card.locator('.cos-total-status-issues')).toHaveCount(0);
 await card.locator('.cos-total-status-offline').click();await expect(board.locator('.cos-equipment-status-list')).toContainText('All 2 cameras are offline in VCC.');
});
test('without a VCC name match nothing changes',async({page})=>{
 const board=await open(page,[]);const card=board.locator('.cos-equipment-total-cameras');
 await expect(card.locator('.cos-total-status-online b')).toHaveText('1');await expect(card.locator('.cos-total-status-offline b')).toHaveText('1');await expect(card.locator('.cos-total-status-issues')).toHaveCount(0);
 await expect(board.getByLabel('Units online with camera issues')).toHaveCount(0);
});

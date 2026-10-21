import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';

test('Field products show device links, source times and partial coverage separately, with a complete evidence export',async({page},info)=>{
 const f=fieldProductFixture();
 f.health.sweepCoverage={contract:'COS_CAMERA_SWEEP_COVERAGE_V1',source:'owned_saved_service_ports',observedAt:f.fresh,complete:false,eligible:166,scanned:166,published:166,held:18,heldReasons:[{reason:'identity_unverified',count:3},{reason:'monitoring_disabled',count:4},{reason:'ownership_unverified',count:1},{reason:'retired_or_not_in_use',count:5},{reason:'saved_endpoint_unavailable',count:5}]};
 const {app,state}=await mountFleet(page,false,{field:f.field,health:f.health});
 const coverage=app.getByLabel('Avigilon sweep coverage');
 await expect(coverage).toContainText('Incomplete check · 18 held records');
 await coverage.locator('summary').click();await expect(coverage).toContainText('Saved endpoint unavailable: 5');
 await expect(coverage).toContainText('not Field Product-ID or camera outage totals');
 await app.getByRole('button',{name:'Data sources',exact:true}).click();
 const board=app.getByRole('region',{name:'Complete mHelpDesk Fleet command center'});
 await board.locator('.cos-command-row').filter({hasText:'Product 1003'}).click();
 const detail=board.getByRole('region',{name:'Selected Field equipment details'});
 await expect(detail).toContainText('No current reading');await expect(detail).toContainText('Stale / invalid time');
 await expect(detail).toContainText('Star4Live');await expect(detail).toContainText('Live video and recording are not verified');
 await board.locator('.cos-command-row').filter({hasText:'Product 1006'}).click();
 await expect(detail).toContainText('Device link needed');await expect(detail).toContainText('No attributable source observation');
 await page.screenshot({path:info.outputPath('product-health-evidence-candidate.png'),fullPage:true});
 const accounting=app.locator('.cos-fleet-accounting');await accounting.locator(':scope > summary').click();
 const downloadPromise=page.waitForEvent('download');await app.getByRole('button',{name:'Export every Field Product ID and health evidence'}).click();
 const download=await downloadPromise,csv=await readFile(await download.path(),'utf8');
 expect(csv.split('\r\n')).toHaveLength(8);expect(csv).toContain('1001');expect(csv).toContain('1007');expect(csv).not.toContain('1008');
 expect(state.calls.every(r=>r.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});

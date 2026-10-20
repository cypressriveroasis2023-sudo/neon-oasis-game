import {test,expect} from '@playwright/test';
import {mountFleet,vrm,now,fresh} from './fleet-dashboard-fixtures.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';

async function mount(page){
 const fixture=fieldProductFixture();
 const power=structuredClone(vrm);
 power.sync={state:'current',lastAttemptAt:fresh,lastSuccessAt:fresh,nextSyncAt:null,error:null,scheduleActive:true,connectionConfigured:true};
 const {app,state}=await mountFleet(page,false,{field:fixture.field,vrm:power});
 const panel=app.locator('.cos-command-provider-victron');
 await expect(panel.locator('.cos-command-status-online strong')).toHaveText('1');
 return {app,state,panel};
}
async function reload(app){
 await app.getByRole('button',{name:'↻ Refresh data',exact:true}).click();
 await expect(app.getByRole('button',{name:'↻ Refresh data',exact:true})).toBeEnabled();
}
function readOnly(state){
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);
 expect(state.calls.some(call=>call.path==='/api/vrm-fleet/refresh')).toBe(false);
 expect(state.errors).toEqual([]);
}

test('camera provider failure does not erase fresh uniquely bound Victron power',async({page})=>{
 const {app,state,panel}=await mount(page);
 state.fail=true;await reload(app);
 await expect(app.locator('.cos-fleet-message')).toContainText('Synthetic saved camera read unavailable');
 await expect(app.locator('.cos-command-positive strong')).toHaveText('0');
 await expect(panel.locator('.cos-command-status-online strong')).toHaveText('1');
 await expect(panel.locator('.cos-command-status-offline strong')).toHaveText('0');
 await panel.getByRole('button',{name:'View Victron / Helios units →'}).click();
 await app.locator('.cos-command-row').filter({hasText:'Helios 1'}).click();
 await expect(app.getByRole('region',{name:'Selected Field equipment details'})).toContainText('independently of camera health');
 readOnly(state);
});

test('a power read error cannot inherit a green retained power result',async({page})=>{
 const {app,state,panel}=await mount(page);
 state.failVrm=true;await reload(app);
 await expect(app.locator('.cos-fleet-message')).toContainText('Synthetic saved power read unavailable');
 await expect(panel.locator('.cos-command-status-online strong')).toHaveText('—');
 await expect(panel.locator('.cos-command-status-offline strong')).toHaveText('—');
 readOnly(state);
});

test('fresh screen read does not renew stale Victron telemetry',async({page})=>{
 const {app,state,panel}=await mount(page);
 for(const power of state.vrm.power)for(const reading of power.measurements)reading.observedAt=new Date(now-21*60_000).toISOString();
 state.vrm.sync.lastSuccessAt=new Date(now).toISOString();
 await reload(app);
 await expect(panel.locator('.cos-command-status-online strong')).toHaveText('0');
 await expect(panel.locator('.cos-command-status-unverified strong')).toHaveText('1');
 await expect(panel.locator('.cos-command-status-offline strong')).toHaveText('0');
 readOnly(state);
});

test('a protected identity hold immediately prevents power verification',async({page})=>{
 const {app,state,panel}=await mount(page);
 const source=state.field.uploadInventory.records.find(record=>record.productId==='1001');
 source.binding.state='held';source.binding.placementHeld=true;
 await reload(app);
 await expect(panel.locator('.cos-command-status-online strong')).toHaveText('0');
 await expect(panel.locator('.cos-command-status-unverified strong')).toHaveText('1');
 await expect(panel.locator('.cos-command-status-offline strong')).toHaveText('0');
 readOnly(state);
});

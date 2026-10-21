import {test,expect} from '@playwright/test';
import {mountFleet,field} from './fleet-dashboard-fixtures.mjs';
const failure={contract:'COS_MHELP_PLACEMENT_V1',lastSuccessAt:'2026-10-01T00:00:00Z',errorCode:'source_read_unavailable',reliability:{contract:'COS_MHELP_RELIABILITY_STATUS_V1',auth:{state:'reconnect_required'},inventory:{paused:false}}};
test('Owner sees a source failure, can open reconnect, and no source write is started',async({page})=>{
 const {app,state}=await mountFleet(page,false,{field:{...field,mhelpPlacementSync:failure}});
 const alert=app.getByRole('alert',{name:'mHelpDesk connection needs attention'});await expect(alert).toBeVisible();
 await expect(alert.getByRole('button',{name:'Reconnect mHelpDesk'})).toBeVisible();
 await page.screenshot({path:test.info().outputPath('mhelp-connection-failure.png'),fullPage:true});
 await alert.getByRole('button',{name:'Reconnect mHelpDesk'}).click();await expect(app.getByRole('heading',{name:'Unit Tracker',exact:true})).toBeVisible();await expect(app.getByRole('button',{name:'Reconnect mHelpDesk',exact:true})).toBeVisible();
 expect(state.calls.every(call=>call.method==='GET')).toBeTruthy();expect(state.errors).toEqual([]);
});
test('IT sees an Owner handoff, and a later successful refresh clears the failure',async({page})=>{
 const {app,state}=await mountFleet(page,true,{field:{...field,mhelpPlacementSync:failure}});
 const alert=app.getByRole('alert',{name:'mHelpDesk connection needs attention'});await expect(alert).toBeVisible();await expect(alert.getByText('Ask a COS Owner to reconnect mHelpDesk.')).toBeVisible();await expect(alert.getByRole('button')).toHaveCount(0);
 state.field.mhelpPlacementSync={...failure,errorCode:null,reliability:{...failure.reliability,auth:{state:'verified'}}};await app.getByRole('button',{name:'↻ Refresh data',exact:true}).click();await expect(alert).toHaveCount(0);expect(state.errors).toEqual([]);
});

test('generic source failure retains inventory and offers no reconnect on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const {app,state}=await mountFleet(page,false,{field:{...field,mhelpPlacementSync:{contract:'COS_MHELP_PLACEMENT_V1',errorCode:'inventory_source_unavailable'}}});
 const status=app.getByRole('status',{name:'mHelpDesk update delayed'});await expect(status).toBeVisible();await expect(status).toContainText('Showing saved inventory');await expect(status.getByRole('button')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();expect(state.calls.every(c=>c.method==='GET')).toBeTruthy();expect(state.errors).toEqual([]);
});
test('paused native dispatch shows pause instead of retry or reconnect',async({page})=>{
 const {app}=await mountFleet(page,false,{field:{...field,mhelpPlacementSync:{...failure,reliability:{...failure.reliability,auth:{state:'not_yet_verified'},inventory:{paused:true}}}}});
 const status=app.getByRole('status',{name:'mHelpDesk updates paused'});await expect(status).toBeVisible();await expect(status).not.toContainText(/retry|reconnect/i);await expect(status.getByRole('button')).toHaveCount(0);
});

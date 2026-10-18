import {test,expect} from '@playwright/test';
import {mountFleet,field} from './fleet-dashboard-fixtures.mjs';
const failure={contract:'COS_MHELP_PLACEMENT_V1',lastSuccessAt:'2026-10-01T00:00:00Z',errorCode:'source_read_unavailable'};
test('Owner sees a source failure, can open reconnect, and no source write is started',async({page})=>{
 const {app,state}=await mountFleet(page,false,{field:{...field,mhelpPlacementSync:failure}});
 const alert=app.getByRole('alert',{name:'mHelpDesk connection needs attention'});await expect(alert).toBeVisible();
 await expect(alert.getByRole('button',{name:'Check or reconnect mHelpDesk'})).toBeVisible();
 await page.screenshot({path:test.info().outputPath('mhelp-connection-failure.png'),fullPage:true});
 await alert.getByRole('button',{name:'Check or reconnect mHelpDesk'}).click();await expect(app.getByRole('heading',{name:'Unit Tracker',exact:true})).toBeVisible();await expect(app.getByRole('button',{name:'Reconnect mHelpDesk',exact:true})).toBeVisible();
 expect(state.calls.every(call=>call.method==='GET')).toBeTruthy();expect(state.errors).toEqual([]);
});
test('IT sees an Owner handoff, and a later successful refresh clears the failure',async({page})=>{
 const {app,state}=await mountFleet(page,true,{field:{...field,mhelpPlacementSync:failure}});
 const alert=app.getByRole('alert',{name:'mHelpDesk connection needs attention'});await expect(alert).toBeVisible();await expect(alert.getByText('Ask a COS Owner to check or reconnect mHelpDesk.')).toBeVisible();await expect(alert.getByRole('button')).toHaveCount(0);
 state.field.mhelpPlacementSync={...failure,errorCode:null};await app.getByRole('button',{name:'↻ Refresh data',exact:true}).click();await expect(alert).toHaveCount(0);expect(state.errors).toEqual([]);
});

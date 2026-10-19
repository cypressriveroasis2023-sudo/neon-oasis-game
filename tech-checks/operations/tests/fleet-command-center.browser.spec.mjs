import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';

test('all mHelp Field Product IDs remain visible with searchable system and health lists',async({page})=>{
 const fixture=fieldProductFixture();
 const {app,state}=await mountFleet(page,false,{field:fixture.field});
 const board=app.getByRole('region',{name:'Complete mHelpDesk Fleet command center'});
 await expect(board).toBeVisible();
 await expect(board.locator('.cos-command-kpis>button')).toHaveCount(6);
 await expect(board.locator('.cos-command-provider')).toHaveCount(4);
 await expect(board.locator('.cos-command-rows .cos-command-row')).toHaveCount(7);
 await expect(board.locator('.cos-command-metadata')).toContainText('7 Field + 1 Shop = 8');
 await expect(board.getByRole('heading',{name:'Victron / Helios',exact:true})).toBeVisible();
 await board.getByRole('button',{name:/Offline linked equipment/}).click();
 await expect(board.locator('.cos-command-rows .cos-command-row')).toHaveCount(1);
 await expect(board.locator('.cos-command-rows')).toContainText('Spotter 1');
 await board.getByRole('button',{name:'Clear filters'}).click();
 await board.getByRole('searchbox',{name:'Search all Field Product IDs'}).fill('1006');
 await expect(board.locator('.cos-command-rows .cos-command-row')).toHaveCount(1);
 await expect(board.locator('.cos-command-rows')).toContainText('Ranger 902');
 await expect(board.locator('.cos-command-rows')).toContainText('Unverified');
 await board.getByRole('button',{name:'Clear filters'}).click();
 await expect(board.locator('.cos-command-rows .cos-command-row')).toHaveCount(7);
 const overflow=await board.evaluate(element=>({width:element.clientWidth,scroll:element.scrollWidth}));
 expect(overflow.scroll).toBeLessThanOrEqual(overflow.width+2);
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);
 expect(state.errors).toEqual([]);
});

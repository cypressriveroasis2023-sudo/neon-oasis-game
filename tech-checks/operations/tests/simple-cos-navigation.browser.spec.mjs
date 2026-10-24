import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';

// Browser-only synthetic sessions and saved evidence. No production auth or writes.
async function menuFor(app){
 const more=app.getByRole('button',{name:'More',exact:true});
 if(await more.isVisible())await more.click();
 return app.getByRole('navigation',{name:'COS Operations',exact:true});
}

test('Owner sees eight focused workspaces, an authenticated TV link, and verified fleet cards',async({page},info)=>{
 const {app,state}=await mountFleet(page,false,{hash:'#fleet-dashboard'});
 const nav=await menuFor(app);
 await expect(nav.getByRole('button')).toHaveCount(8);
 for(const name of ['Overview','Inventory & Transfers','Camera Health','Fleet Map','Power & Routers','Unit Tracker','Team & Tech Check','Calendar'])
   await expect(nav.getByRole('button',{name,exact:true})).toHaveCount(1);
 await expect(app.getByRole('link',{name:/TV Mode/})).toHaveCount(1);
 await expect(app.locator('details.cos-owner-advanced')).toHaveCount(1);
 await nav.getByRole('button',{name:'Overview',exact:true}).click();
 await expect(app.getByRole('region',{name:'COS fleet overview'})).toBeVisible();
 await expect(app.getByRole('region',{name:'Shared equipment inventory'})).toBeVisible();
 await expect(app.locator('.it-dashboard-card-cameras')).toHaveCount(1);
 await page.screenshot({path:info.outputPath('cos-simple-owner-overview.png'),fullPage:true});
 expect(state.errors).toEqual([]);
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);
});

test('IT navigation uses only its existing permitted routes and cannot open Owner Advanced',async({page},info)=>{
 const {app,state}=await mountFleet(page,true,{hash:'#fleet-dashboard'});
 const nav=await menuFor(app);
 // Production's IT_DAILY_ONLY gate intentionally allows just Fleet and Camera.
 // Do not bypass that release gate while simplifying presentation.
 await expect(nav.getByRole('button')).toHaveCount(2);
 for(const name of ['Camera Health','Fleet Map'])
   await expect(nav.getByRole('button',{name,exact:true})).toHaveCount(1);
 for(const name of ['Overview','Inventory & Transfers','Power & Routers','Unit Tracker','Team & Tech Check','Calendar'])
   await expect(nav.getByRole('button',{name,exact:true})).toHaveCount(0);
 await expect(app.locator('details.cos-owner-advanced')).toHaveCount(0);
 await expect(app.getByRole('link',{name:/TV Mode/})).toHaveCount(0);
 await page.screenshot({path:info.outputPath('cos-simple-it-menu.png'),fullPage:true});
 expect(state.errors).toEqual([]);
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);
});

test('Owner Calendar has Day, Week and Month and never manufactures schedule entries',async({page},info)=>{
 const {app,state}=await mountFleet(page,false,{hash:'#fleet-dashboard'});
 const nav=await menuFor(app);
 await nav.getByRole('button',{name:'Calendar',exact:true}).click();
 const calendar=app.locator('.ops-calendar[aria-label="COS Operations Calendar"]');
 await expect(calendar).toBeVisible();
 for(const choice of ['Month','Week','Day'])await expect(calendar.getByRole('button',{name:choice,exact:true})).toBeVisible();
 await calendar.getByRole('button',{name:'Day',exact:true}).click();
 await expect(calendar.locator('.calendar-day')).toHaveCount(1);
 await expect(calendar.getByText('No jobs in the loaded records currently have a valid schedule.')).toBeVisible();
 await page.screenshot({path:info.outputPath('cos-simple-calendar-day.png'),fullPage:true});
 expect(state.errors).toEqual([]);
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);
});

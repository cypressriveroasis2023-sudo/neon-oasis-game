import {openWorkspace} from './navigation-helper.mjs';
import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {statusPinsFixture} from './fixtures/fleet-status-pins-fixture.mjs';
test('Overview and Shop share Fleet counts and hide historical subsets by default',async({page},info)=>{
 const {app,state}=await mountFleet(page,false,{field:statusPinsFixture().field});
 await openWorkspace(app,'Today');
 const shared=app.getByRole('region',{name:'Shared equipment inventory'});
 await expect(shared.getByRole('button',{name:'287 Field equipment'})).toBeVisible();
 await expect(shared.getByRole('button',{name:'714 Shop / ROOT'})).toBeVisible();
 await expect(shared.getByRole('button',{name:'1001 Total inventory'})).toBeVisible();
 await expect(app.getByRole('region',{name:'VISION dashboard'})).toHaveCount(0);
 await shared.getByRole('button',{name:'714 Shop / ROOT'}).click();
 const shop=app.getByRole('region',{name:'Units On Hand',exact:true});
 await expect(shop).toContainText('714 equipment records · same inventory as Fleet');
 await expect(shop.locator('.cos-shop-products article')).toHaveCount(40);
 await expect(app.getByRole('region',{name:'Registry readiness records'})).toHaveCount(0);
 await expect(shop).toContainText('At the shop does not mean ready to deploy');
 expect(await shop.evaluate(el=>el.scrollWidth<=el.clientWidth+2)).toBe(true);
 await page.screenshot({path:info.outputPath('shared-shop-inventory.png')});
 expect(state.errors).toEqual([]);expect(state.calls.every(c=>c.method==='GET')).toBe(true);
});
test('Dispatch puts the daily work above collapsed administrative controls',async({page})=>{
 const {app,state}=await mountFleet(page,false,{field:statusPinsFixture().field});
 await openWorkspace(app,'Daily Board');
 const board=app.getByRole('region',{name:'COS Daily Board'}),settings=app.locator('details').filter({has:app.locator('summary').filter({hasText:'Owner tools · import, create and manage jobs'})});
 await expect(board).toBeVisible();await expect(settings).not.toHaveAttribute('open','');
 await expect(app.getByRole('region',{name:'TV board settings'})).not.toBeVisible();
 const a=await board.boundingBox(),b=await settings.boundingBox();expect(a.y).toBeLessThan(b.y);
 expect(state.errors).toEqual([]);
});
test('unavailable inventory never substitutes native counts or a false zero',async({page})=>{
 const {app,state}=await mountFleet(page);
 await openWorkspace(app,'Units On Hand');
 const shop=app.getByRole('region',{name:'Units On Hand',exact:true});
 await expect(shop.getByRole('alert')).toContainText('Current reviewed equipment inventory is unavailable');
 await expect(shop).not.toContainText('0 equipment records');await expect(shop.locator('.cos-shop-products article')).toHaveCount(0);
 expect(state.errors).toEqual([]);
});

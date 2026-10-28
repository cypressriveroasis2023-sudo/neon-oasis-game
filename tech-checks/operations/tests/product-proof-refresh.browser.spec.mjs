import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';

for(const it of [false,true])test(`${it?'IT':'Owner'} refresh keeps saved exact checks while pending and adopts late proof`,async({page})=>{
 const f=fieldProductFixture();
 const {app,state}=await mountFleet(page,it,{field:f.field,health:f.health,productConnections:f.connections,advancingClock:true});
 const online=app.locator('.cos-fleet-stat-online strong');
 await expect(online).toHaveText('1');
 let release;state.proofGate=new Promise(resolve=>{release=resolve;});
 await app.getByRole('button',{name:'↻ Refresh data',exact:true}).click();
 await expect.poll(()=>state.calls.filter(r=>r.path==='/api/product-connections').length).toBe(2);
 await page.clock.runFor(6600);
 await expect(app.getByRole('status').filter({hasText:'Connection source is still loading'})).toBeVisible();
 await expect(online).toHaveText('1');
 state.productConnections.items.find(r=>r.status==='online').status='offline';
 release();state.proofGate=null;
 await expect(online).toHaveText('0');
 await expect(app.getByRole('status').filter({hasText:'Connection source is still loading'})).toHaveCount(0);
 expect(state.calls.filter(r=>r.path==='/api/product-connections')).toHaveLength(2);
 expect(state.calls.every(r=>r.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});
test('late connection read failure is visible and removes retained exact checks',async({page})=>{
 const f=fieldProductFixture();const {app,state}=await mountFleet(page,false,{field:f.field,health:f.health,productConnections:f.connections,advancingClock:true});
 await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('1');
 let release;state.proofGate=new Promise(resolve=>{release=resolve;});
 await app.getByRole('button',{name:'↻ Refresh data',exact:true}).click();
 await expect.poll(()=>state.calls.filter(r=>r.path==='/api/product-connections').length).toBe(2);
 await page.clock.runFor(6600);await expect(app.getByRole('status').filter({hasText:'Connection source is still loading'})).toBeVisible();
 state.productConnections=null;release();state.proofGate=null;
 await expect(app.getByRole('status').filter({hasText:'Connection source could not be read'})).toBeVisible();
 await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('0');
 expect(state.calls.every(r=>r.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});

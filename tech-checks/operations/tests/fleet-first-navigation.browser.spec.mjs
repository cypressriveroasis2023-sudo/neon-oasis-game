import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {openWorkspace} from './navigation-helper.mjs';

for(const it of [false,true])test(`${it?'Verified IT':'Owner'} opens Fleet first inside the existing COS shell`,async({page},info)=>{
 const {app,state}=await mountFleet(page,it,{hash:''});
 await expect(app.locator('.cos-fleet-dashboard')).toHaveCount(1);
 await expect(app.locator('.cos-fleet-map-canvas')).toHaveCount(1);
 await expect(app.locator('.cos-fleet-brand')).toHaveCount(0);
 await expect(app.locator('.cos-fleet-clock time')).toHaveText(/\d{1,2}:\d{2}\s*[AP]M/);
 const mobile=page.viewportSize().width<=700;
 if(mobile)await app.getByRole('button',{name:'More',exact:true}).click();
 const nav=app.getByRole('navigation',{name:'COS Operations',exact:true});
 await expect(nav.getByRole('button').first()).toHaveText('Fleet Dashboard');
 await expect(nav.getByRole('button',{name:'Fleet Dashboard',exact:true})).toHaveAttribute('aria-current','page');
 if(it){
  await expect(nav.getByRole('button')).toHaveCount(2);
  await expect(nav.getByRole('button',{name:'IT Dashboard',exact:true})).toHaveCount(0);
  await expect(nav.getByRole('button',{name:'Camera Health',exact:true})).toHaveCount(1);
  for(const name of ['Victron Power','2027 Unit Tracker'])await expect(nav.getByRole('button',{name,exact:true})).toHaveCount(0);
 }
 if(mobile)await app.getByRole('button',{name:/Close menu/}).click();
 const design=await app.locator('.cos-fleet-dashboard').evaluate(el=>({font:getComputedStyle(el).fontFamily,border:getComputedStyle(el).borderTopWidth,panel:getComputedStyle(el.querySelector('.cos-fleet-stats button')).backgroundImage,scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
 expect(design.font).toContain('Open Sans');expect(design.border).toBe('1px');expect(design.panel).toBe('linear-gradient(145deg, rgb(23, 41, 59), rgb(17, 30, 45))');expect(design.scroll).toBeLessThanOrEqual(design.viewport+1);
 await page.screenshot({path:info.outputPath((it?'it':'owner')+'-fleet-first-native.png'),fullPage:true});
 expect(state.errors).toEqual([]);expect(state.calls.every(call=>call.method==='GET')).toBe(true);
});

test('an explicit Owner overview bookmark stays available and Fleet remains one navigation action',async({page})=>{
 const {app,state}=await mountFleet(page,false,{hash:'#today'});
 await expect(app.getByRole('region',{name:'Fleet Dashboard shortcut',exact:true})).toBeVisible();
 const mobile=page.viewportSize().width<=700;
 const nav=app.getByRole('navigation',{name:mobile?'Mobile Operations navigation':'COS Operations',exact:true});
 await nav.getByRole('button',{name:'Fleet Dashboard',exact:true}).click();
 await expect(app.locator('.cos-fleet-dashboard')).toHaveCount(1);
 await nav.getByRole('button',{name:'Overview',exact:true}).click();
 await expect(app.getByRole('region',{name:'Fleet Dashboard shortcut',exact:true})).toBeVisible();
 expect(state.errors).toEqual([]);
});


test('Owner can reach Watchful and router diagnostics through normal Fleet-first navigation',async({page})=>{
 const {app,state}=await mountFleet(page,false,{hash:''});
 await expect(app.getByRole('region',{name:'COS Fleet Dashboard',exact:true})).toBeVisible();
 await openWorkspace(app,'Today');
 await expect(app.getByRole('region',{name:'Watchful',exact:true})).toBeVisible();
 await expect(app.getByRole('link',{name:'Open Watchful',exact:true})).toHaveAttribute('href','https://v2.watchful.co.nz/sites');
 await openWorkspace(app,'Field Map');
 await expect(app.getByRole('region',{name:'COS Fleet Dashboard',exact:true})).toBeVisible();
 await openWorkspace(app,'InHand Routers');
 await expect(app.getByRole('heading',{name:'Router inventory & reachability',exact:true})).toBeVisible();
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});

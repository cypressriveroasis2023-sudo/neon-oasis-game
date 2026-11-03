import {test,expect} from '@playwright/test';
import {mountFleet,units,field,vrm,fresh} from './fleet-dashboard-fixtures.mjs';

// Actual complete App with the repository's synthetic saved-read fixture.
// Never sign in, contact providers, perform live checks, or change operational records.
const router={id:'synthetic-router',unitKey:'Helios 1',name:'Fixture InHand',model:'IR615',publicIp:'192.0.2.10',unitIp:null,port:443,protocol:'https',probeStatus:'online',checkedAt:fresh,lastRecoveredAt:fresh,reportedStatus:'Online',reportedAt:fresh,reportedSource:'Synthetic fixture',savedLatencyMs:23,match:'exact_name',candidateUnit:{id:units[0].id,unitNumber:'Helios 1'},gps:null};
function power(){const value=structuredClone(vrm);value.power[0].measurements.push(...[['solar_power',190,'system',0,'W'],['solar_power',180,'solarcharger',1,'W'],['load_power',75,'system',0,'W'],['battery_voltage',12.6,'battery',278,'V']].map(([metric,value,source,instance,unit])=>({metric,value,source,instance,unit,observedAt:fresh})));return value;}
const safe=state=>{expect(state.errors).toEqual([]);expect(state.calls.every(c=>c.method==='GET')).toBe(true);};
async function banner(page){await page.evaluate(()=>{const h=document.createElement('header');h.textContent='SYNTHETIC TEST — NOT LIVE OPERATIONS';h.style.cssText='height:24px;line-height:24px;font:12px/24px sans-serif;background:#fff;color:#111;text-align:center';document.body.prepend(h);const f=document.querySelector('iframe');f.style.height='calc(100vh - 24px)';f.style.display='block';});}
async function open(app,name='Helios 1'){
 await app.locator('.cos-fleet-unit-row').filter({hasText:name}).click();
 const drawer=app.getByRole('dialog',{name:name+' unit intelligence',exact:true});await expect(drawer).toBeVisible();return drawer;
}
async function geometry(drawer){return drawer.evaluate(el=>{
 const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
 return {drawer:box(el),viewport:innerWidth,overflow:el.scrollWidth-el.clientWidth,camera:box(el.querySelector('.cos-fleet-camera-card')),router:box(el.querySelector('.cos-fleet-router-card')),power:box(el.querySelector('.cos-fleet-power-card')),grid:box(el.querySelector('.cos-fleet-unit-health-grid')),close:box(el.querySelector('.cos-fleet-drawer-close')),checkFont:parseFloat(getComputedStyle(el.querySelector('.cos-fleet-camera-card > small')).fontSize),addressFont:parseFloat(getComputedStyle(el.querySelector('.cos-fleet-recorded-address p')).fontSize)};
});}

test('Owner exact unit keeps saved evidence and links while phone cards stack and desktop power spans',async({page},info)=>{
 const {app,state}=await mountFleet(page,false,{vrm:power(),routers:[router]});await banner(page);
 const before=state.calls.filter(c=>c.path==='/api/vrm-fleet').length,drawer=await open(app);
 await expect.poll(()=>app.locator('body').evaluate(()=>new URLSearchParams(location.hash.split('?')[1]).get('unit'))).toBe(units[0].id);
 await expect(drawer.getByRole('region',{name:'Unit recorded address'})).toContainText(units[0].address);
 await expect(drawer.getByRole('region',{name:'Selected unit router health'})).toContainText('Management check; camera health is separate.');
 await expect(drawer.getByRole('region',{name:'Selected unit router health'})).toContainText('192.0.2.10');
 await expect(drawer.locator('.cos-fleet-power-metrics')).toContainText('190 W');await expect(drawer.locator('.cos-fleet-power-metrics')).toContainText('180 W');await expect(drawer.locator('.cos-fleet-power-metrics')).not.toContainText('370 W');
 await expect(drawer.getByRole('link',{name:'Open Victron'})).toHaveAttribute('href','https://vrm.victronenergy.com/installation/1001/dashboard');
 const g=await geometry(drawer);expect(g.overflow).toBeLessThanOrEqual(1);expect(g.drawer.x).toBeGreaterThanOrEqual(0);expect(g.drawer.right).toBeLessThanOrEqual(g.viewport+1);expect(g.close.height).toBeGreaterThanOrEqual(48);expect(g.checkFont).toBeGreaterThanOrEqual(15);expect(g.addressFont).toBeGreaterThanOrEqual(17);expect(Math.abs(g.power.width-g.grid.width)).toBeLessThanOrEqual(1);
 if(g.viewport<=750){expect(g.router.y).toBeGreaterThan(g.camera.y);expect(g.router.width).toBeCloseTo(g.camera.width,0);}else expect(Math.abs(g.router.y-g.camera.y)).toBeLessThanOrEqual(1);
 expect(g.power.y).toBeGreaterThan(g.camera.y);expect(state.calls.filter(c=>c.path==='/api/vrm-fleet')).toHaveLength(before);
 await drawer.evaluate(e=>e.scrollTop=0);await page.screenshot({path:info.outputPath('unit-top.png'),fullPage:true});
 await drawer.locator('.cos-fleet-unit-health-grid').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('unit-signals.png'),fullPage:true});safe(state);
});

test('saved source explanation, installation evidence and close remain usable without writes',async({page},info)=>{
 const {app,state}=await mountFleet(page,false,{vrm:power(),routers:[router]});await banner(page);const drawer=await open(app);
 const camera=drawer.locator('.cos-fleet-camera-card');await camera.locator('details > summary').click();await expect(camera.locator('details p').first()).toBeVisible();
 await drawer.locator('.cos-fleet-installation-evidence > summary').click();await expect(drawer.locator('.cos-fleet-installation-evidence')).toContainText('Location evidence');await expect(drawer.locator('.cos-fleet-installation-evidence')).toContainText('Measurement times are shown with each health source above.');
 await drawer.evaluate(e=>e.scrollTop=e.scrollHeight);const close=drawer.getByRole('button',{name:'Close unit details',exact:true});const position=await close.evaluate(e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,viewport:innerHeight}));expect(position.top).toBeGreaterThanOrEqual(0);expect(position.bottom).toBeLessThanOrEqual(position.viewport);
 await page.screenshot({path:info.outputPath('unit-location-evidence.png'),fullPage:true});await close.click();await expect(drawer).toHaveCount(0);await expect.poll(()=>app.locator('body').evaluate(()=>location.hash)).toBe('#fleet-dashboard');safe(state);
});

test('long recorded address and unavailable power wrap at the configured width',async({page})=>{
 const input=structuredClone(field);for(const u of [...input.items,...input.inventoryItems])if(u.id===units[0].id)u.address='Synthetic long service address '+('X'.repeat(180));
 const {app,state}=await mountFleet(page,false,{field:input,vrm:{items:[],power:[]}});const drawer=await open(app);
 await expect(drawer.locator('.cos-fleet-recorded-address')).toContainText('X'.repeat(180));await expect(drawer.getByRole('region',{name:'Selected unit battery charge'})).toContainText('No verified charge reading');
 const g=await geometry(drawer);expect(g.overflow).toBeLessThanOrEqual(1);expect(g.drawer.right).toBeLessThanOrEqual(g.viewport+1);safe(state);
});

test('existing IT drawer is not restyled or granted Owner navigation',async({page})=>{
 const {app,state}=await mountFleet(page,true,{vrm:power(),routers:[router]});const drawer=await open(app);
 await expect(app.locator('.cos-approved-shell')).toHaveCount(0);expect(await drawer.evaluate(e=>getComputedStyle(e).getPropertyValue('--cos-approved-unit-layout').trim())).toBe('');
 await expect(app.getByRole('searchbox',{name:'Find a tool'})).toHaveCount(0);safe(state);
});

test('camera status and saved time remain independent for online offline and unverified records',async({page})=>{
 const {app,state}=await mountFleet(page);const states=[],classes=[];
 for(const name of ['Helios 1','Spotter 1','Spotter 2']){
  const drawer=await open(app,name),camera=drawer.locator('.cos-fleet-camera-card');states.push(await camera.locator('.camera-unit-state').innerText());classes.push(await camera.locator('.camera-unit-state').getAttribute('class'));
  await expect(camera.locator(':scope > small').first()).not.toBeEmpty();await drawer.getByRole('button',{name:'Close unit details',exact:true}).click();
 }
 expect(states).toEqual(['Camera records online','Camera outage observed','Camera status unverified']);
 for(const [index,status] of ['online','offline','unknown'].entries())expect(classes[index].split(/\s+/)).toContain('camera-status-'+status);safe(state);
});

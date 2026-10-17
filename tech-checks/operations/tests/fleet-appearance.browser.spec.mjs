import {test, expect} from '@playwright/test';
import {mountFleet, field, units, vrm, fresh} from './fleet-dashboard-fixtures.mjs';

const longAddress = '123 Synthetic Street, Building Seven, North Construction Entrance, Suite ' + '0123456789'.repeat(8) + ', Houston, TX 77001';
function presentationField({cluster=false}={}) {
  const catalog = structuredClone(units);
  for (const [index, unit] of catalog.slice(0, 3).entries()) {
    Object.assign(unit, {latitude:29.7 + (cluster ? 0 : index * .08), longitude:-95.4,
      coordinateSource:'site', locationVerification:'owner_verified', locationVerifiedAt:fresh, gpsRecordedAt:fresh});
  }
  catalog[0].address = longAddress;
  catalog.push({...catalog[0], id:'00000000-0000-4000-8000-000000000007', unitNumber:'ST 007', modelName:'Solar Stand'});
  return {...structuredClone(field), items:catalog.filter(unit=>unit.currentLocationType==='field'), inventoryItems:catalog,
    summary:{fieldUnits:4, mappedUnits:4, unitGps:0, missingGps:0}};
}
function presentationPower() {
  const value = structuredClone(vrm);
  value.power[0].measurements.push(...[['solar_power',190], ['load_power',75], ['battery_power',-42]].map(([metric,value])=>({metric,value,unit:'W',source:'system',instance:0,observedAt:fresh})));
  return value;
}
const router = {id:'appearance-router',unitKey:'Helios 1',name:'Fixture InHand',model:'IR615',publicIp:'192.0.2.10',unitIp:null,port:443,protocol:'https',
  probeStatus:'online',checkedAt:fresh,lastRecoveredAt:fresh,reportedStatus:'Online',reportedAt:fresh,reportedSource:'Synthetic fixture',savedLatencyMs:23,
  match:'exact_name',candidateUnit:{id:units[0].id,unitNumber:units[0].unitNumber},gps:null};
const mount = (page,it=false,options={})=>mountFleet(page,it,{field:presentationField(),vrm:presentationPower(),routers:[router],...options});
async function noPageOverflow(app) {
  const geometry = await app.locator('html').evaluate(el=>({content:el.scrollWidth, viewport:innerWidth}));
  expect(geometry.content).toBeLessThanOrEqual(geometry.viewport+1);
}
function onlySavedReads(state) {
  expect(state.errors).toEqual([]);
  expect(state.calls.length).toBeGreaterThan(0);
  expect(state.calls.every(call=>call.method==='GET')).toBe(true);
}

for (const it of [false,true]) test(`${it?'IT':'Owner'} appearance keeps live counts, readable long addresses and usable filters`,async({page},info)=>{
  const {app,state}=await mount(page,it);
  await expect(app.locator('.cos-fleet-stats strong')).toHaveText(['4','1','1','1','0']);
  const row=app.locator('.cos-fleet-unit-row').filter({hasText:'Helios 1'});
  await expect(row).toContainText(longAddress);
  await expect(row.locator('[aria-label="camera: Online"]')).toContainText('Camera');
  await expect(row.locator('[aria-label="router: Online"]')).toContainText('Router');
  await expect(row.locator('[aria-label="battery: Online"]')).toContainText('Battery');
  await expect(app.locator('.cos-fleet-stat-online')).toHaveCSS('background-color','rgb(32, 38, 45)');
  const geometry=await app.locator('.cos-fleet-dashboard').evaluate(el=>{
    const cards=[...el.querySelectorAll('.cos-fleet-stat')].map(card=>card.getBoundingClientRect());
    const list=el.querySelector('.cos-fleet-unit-panel').getBoundingClientRect(),map=el.querySelector('.cos-fleet-map-panel').getBoundingClientRect();
    const address=el.querySelector('.cos-fleet-unit-copy small:nth-of-type(2)');
    return {cards:cards.map(card=>({x:card.x,y:card.y,width:card.width})), list:{x:list.x,y:list.y},map:{x:map.x,y:map.y},
      address:{wrap:getComputedStyle(address).whiteSpace,overflow:address.scrollWidth-address.clientWidth,font:parseFloat(getComputedStyle(address).fontSize)},
      targets:[...el.querySelectorAll('.cos-fleet-tabs button,.cos-fleet-filter-row select,.cos-fleet-search input,.cos-fleet-search button,.cos-fleet-map-toolbar button')].map(control=>({height:control.getBoundingClientRect().height,width:control.getBoundingClientRect().width})),width:innerWidth};
  });
  expect(geometry.address.wrap).toBe('normal');
  expect(geometry.address.overflow).toBeLessThanOrEqual(1);
  expect(geometry.address.font).toBeGreaterThanOrEqual(12);
  for(const target of geometry.targets){expect(target.height).toBeGreaterThanOrEqual(44);expect(target.width).toBeGreaterThanOrEqual(44);}
  if(geometry.width<=750){
    expect(Math.abs(geometry.cards[0].y-geometry.cards[1].y)).toBeLessThan(1);
    expect(geometry.cards[2].y).toBeGreaterThan(geometry.cards[0].y);
    expect(geometry.cards[4].width).toBeGreaterThan(geometry.cards[0].width*1.9);
    expect(geometry.map.y).toBeLessThan(geometry.list.y);
  }else{
    expect(new Set(geometry.cards.map(card=>Math.round(card.y))).size).toBe(1);
    expect(geometry.list.x).toBeLessThan(geometry.map.x);
  }
  await noPageOverflow(app);
  await page.screenshot({path:info.outputPath(`appearance-${it?'it':'owner'}-overview.png`),fullPage:true});
  await app.locator('.cos-fleet-map-panel').scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath(`appearance-${it?'it':'owner'}-map.png`),fullPage:true});
  await app.getByLabel('Search units, customers, sites or addresses').fill('North Construction Entrance');
  await expect(app.locator('.cos-fleet-unit-row')).toHaveCount(2);
  await app.getByRole('button',{name:'Clear fleet search'}).click();
  await app.getByLabel('Fleet status',{exact:true}).selectOption('offline');
  await expect(app.locator('.cos-fleet-unit-row')).toHaveCount(1);
  await expect(app.locator('.cos-fleet-unit-row')).toContainText('Spotter 1');
  await app.getByLabel('Fleet status',{exact:true}).selectOption('all');
  await app.getByLabel('Fleet placement',{exact:true}).selectOption('shop');
  await expect(app.locator('.cos-fleet-unit-row')).toContainText('Sniper 44');
  await expect(app.locator('.cos-dashboard-marker')).toHaveCount(0);
  onlySavedReads(state);
});

test('circle colors, clustering, fullscreen and unit selection retain their behavior',async({page},info)=>{
  const {app,state}=await mount(page,false,{field:presentationField({cluster:true})});
  await app.locator('.cos-dashboard-cluster').click();
  await expect(app.locator('.cos-dashboard-peer')).toHaveCount(4);
  for(const [status,color] of [['online','rgb(43, 255, 53)'],['offline','rgb(255, 39, 52)'],['unknown','rgb(148, 163, 184)'],['support','rgb(21, 168, 255)']]){
    const marker=app.locator(`.cos-dashboard-peer .cos-field-pin[data-health="${status}"]`);
    await expect(marker.locator('circle')).toHaveCSS('fill',color);
    await expect(marker).toHaveCSS('width','38px');
    await expect(marker).toHaveCSS('height','38px');
  }
  await expect(app.locator('.cos-fleet-map-canvas .company-eye,.cos-fleet-map-canvas [data-cos-eye]')).toHaveCount(0);
  const enter=app.getByRole('button',{name:'Fullscreen fleet map',exact:true});
  await enter.click();
  const bounds=await app.locator('.cos-fleet-map-expanded').boundingBox();
  expect(bounds).toEqual({x:0,y:0,width:page.viewportSize().width,height:page.viewportSize().height});
  await expect(app.getByRole('navigation',{name:'Fleet dashboard views'})).not.toBeVisible();
  await page.screenshot({path:info.outputPath('appearance-fullscreen.png'),fullPage:true});
  await app.locator('.cos-dashboard-peer[data-unit-id="'+units[1].id+'"]').click();
  const dialog=app.getByRole('dialog',{name:'Spotter 1 unit intelligence'});
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.camera-unit-state')).toHaveClass(/cos-signal-offline/);
  await expect(dialog.locator('.camera-unit-state')).toHaveCSS('color','rgb(255, 101, 112)');
  await dialog.getByRole('button',{name:'Close unit details'}).click();
  await app.getByRole('button',{name:'Exit fullscreen fleet map'}).press('Escape');
  await expect(app.locator('.cos-fleet-map-expanded')).toHaveCount(0);
  await expect(enter).toBeFocused();
  onlySavedReads(state);
});

test('unit detail is readable, retains all evidence and has one scroll surface',async({page},info)=>{
  const {app,state}=await mount(page);
  await app.locator('.cos-fleet-unit-row').filter({hasText:'Helios 1'}).click();
  const dialog=app.getByRole('dialog',{name:'Helios 1 unit intelligence'});
  await expect(dialog.getByRole('region',{name:'Unit recorded address'})).toContainText(longAddress);
  for(const heading of ['Camera health','InHand router','Victron power','Installation evidence','Camera troubleshooting'])await expect(dialog.getByRole('heading',{name:heading,exact:true})).toBeVisible();
  await expect(dialog.getByRole('region',{name:'Selected unit battery charge'}).locator(':scope > strong')).toHaveText('80%');
  await expect(dialog.locator('.cos-fleet-power-metrics')).toContainText('190 W');
  await expect(dialog.locator('.cos-fleet-power-metrics')).toContainText('75 W');
  const layout=await dialog.evaluate(el=>{
    const grid=el.querySelector('.cos-fleet-unit-health-grid'),camera=el.querySelector('.cos-fleet-camera-card').getBoundingClientRect(),router=el.querySelector('.cos-fleet-router-card').getBoundingClientRect(),power=el.querySelector('.cos-fleet-power-card').getBoundingClientRect();
    return {overflow:el.scrollWidth-el.clientWidth,gridWidth:grid.clientWidth,powerWidth:power.width,camera:{x:camera.x,y:camera.y},router:{x:router.x,y:router.y},height:el.getBoundingClientRect().height,viewport:innerHeight,width:innerWidth};
  });
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.powerWidth).toBeGreaterThanOrEqual(layout.gridWidth-1);
  expect(layout.height).toBeLessThanOrEqual(layout.viewport);
  if(layout.width<=750)expect(layout.router.y).toBeGreaterThan(layout.camera.y);
  else expect(Math.abs(layout.router.y-layout.camera.y)).toBeLessThan(1);
  await dialog.getByText('3 reported charge sources',{exact:true}).click();
  await expect(dialog.locator('[aria-label="Battery charge source readings"]')).toBeVisible();
  await dialog.evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:info.outputPath('appearance-unit-top.png'),fullPage:true});
  const editor=dialog.getByRole('button',{name:'Edit / verify installation →',exact:true});
  await editor.scrollIntoViewIfNeeded();await editor.click();
  await expect(dialog.locator('.field-map-detail')).toHaveCSS('max-height','none');
  await expect(dialog.locator('.field-map-detail')).toHaveCSS('overflow-y','visible');
  await dialog.evaluate(el=>el.scrollTop=el.scrollHeight);
  expect(await dialog.evaluate(el=>el.scrollTop)).toBeGreaterThan(100);
  await page.screenshot({path:info.outputPath('appearance-unit-installation.png'),fullPage:true});
  await dialog.evaluate(el=>el.scrollTop=0);
  await expect(dialog.getByRole('button',{name:'Close unit details'})).toBeVisible();
  await dialog.getByRole('button',{name:'Close unit details'}).click();
  await expect(dialog).toHaveCount(0);
  await noPageOverflow(app);onlySavedReads(state);
});

test('narrow screens retain every view tab and filter without page overflow',async({page})=>{
  await page.setViewportSize({width:320,height:740});
  const {app,state}=await mount(page,true);
  const tabs=app.getByRole('navigation',{name:'Fleet dashboard views'});
  await tabs.getByRole('button',{name:/Data sources/}).click();
  await expect(app.getByRole('heading',{name:'How to read this board'})).toBeVisible();
  await noPageOverflow(app);
  await tabs.getByRole('button',{name:'Map',exact:true}).click();
  for(const label of ['Fleet placement','Fleet family','Fleet health signal','Fleet status','Fleet provider'])await expect(app.getByLabel(label,{exact:true})).toBeVisible();
  await app.getByText('Location and installation filters',{exact:true}).click();
  for(const label of ['Installation status','Nearby unit center','Nearby radius miles'])await expect(app.getByLabel(label,{exact:true})).toBeVisible();
  await noPageOverflow(app);onlySavedReads(state);
});


test.describe('touch iPhone Fleet presentation',()=>{
 test.use({hasTouch:true});
 for(const [label,width,height] of [['portrait',390,844],['landscape',844,390],['wide landscape',932,430]]){
 test('iPhone '+label+' keeps Fleet map first without a sidebar or overflow',async({page},info)=>{
  await page.setViewportSize({width,height});
  const {app,state}=await mount(page);
  const geometry=await app.locator('.cos-fleet-dashboard').evaluate(el=>{
   const shell=el.closest('.company-shell'),map=el.querySelector('.cos-fleet-map-panel').getBoundingClientRect(),list=el.querySelector('.cos-fleet-unit-panel').getBoundingClientRect();
   const cards=[...el.querySelectorAll('.cos-fleet-stats .cos-fleet-stat')].map(x=>x.getBoundingClientRect());
   const controls=[...el.querySelectorAll('.cos-fleet-tabs button,.cos-fleet-map-toolbar button,.cos-fleet-filter-row select,.cos-fleet-search input')].map(x=>x.getBoundingClientRect());
   return {width:innerWidth,mapY:map.y,listY:list.y,mainWidth:shell.querySelector('.owner-it-main').getBoundingClientRect().width,
    sidebar:getComputedStyle(shell.querySelector('.operations-sidebar')).display,firstY:cards[0].y,secondY:cards[1].y,
    targets:controls.map(({width,height})=>({width,height})),overflow:document.documentElement.scrollWidth-innerWidth};
  });
  expect(geometry.width).toBe(width);
  expect(geometry.mapY).toBeLessThan(geometry.listY);
  expect(geometry.mainWidth).toBeGreaterThan(width*.85);
  expect(geometry.sidebar).toBe('none');
  expect(Math.abs(geometry.firstY-geometry.secondY)).toBeLessThan(1);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  for(const target of geometry.targets){expect(target.width).toBeGreaterThanOrEqual(44);expect(target.height).toBeGreaterThanOrEqual(44);}
  if(width>700){await app.getByRole('button',{name:'More',exact:true}).click();await expect(app.locator('.operations-sidebar-open')).toBeVisible();await app.getByRole('button',{name:/Close menu/}).click();}
  await page.screenshot({path:info.outputPath('iphone-'+label.replace(' ','-')+'-fleet.png'),fullPage:true});
  await app.locator('.cos-fleet-unit-row').filter({hasText:'Helios 1'}).click();
  const detail=app.getByRole('dialog',{name:'Helios 1 unit intelligence'});
  for(const title of ['Camera health','InHand router','Camera troubleshooting'])await expect(detail.getByRole('heading',{name:title,exact:true})).toBeVisible();
  await detail.getByRole('heading',{name:'Camera troubleshooting',exact:true}).scrollIntoViewIfNeeded();
  await detail.evaluate(el=>el.scrollTop=el.scrollHeight);
  expect(await detail.evaluate(el=>el.scrollTop)).toBeGreaterThan(100);
  expect(await detail.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
  await detail.getByRole('button',{name:'Close unit details'}).click();
  await noPageOverflow(app);onlySavedReads(state);
 });
}
test('rotating iPhone retains Fleet filters, map and units',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const {app,state}=await mount(page);
 await app.getByLabel('Fleet status',{exact:true}).selectOption('all');
 await app.getByLabel('Fleet family',{exact:true}).selectOption('SPOTTER');
 await expect(app.locator('.cos-fleet-unit-row')).toHaveCount(2);
 await page.setViewportSize({width:844,height:390});
 await expect(app.getByLabel('Fleet family',{exact:true})).toHaveValue('SPOTTER');
 const layout=await app.locator('.cos-fleet-workspace').evaluate(el=>({display:getComputedStyle(el).display,mapY:el.querySelector('.cos-fleet-map-panel').getBoundingClientRect().y,listY:el.querySelector('.cos-fleet-unit-panel').getBoundingClientRect().y,overflow:document.documentElement.scrollWidth-innerWidth}));
 expect(layout.display).toBe('flex');
 expect(layout.mapY).toBeLessThan(layout.listY);
 expect(layout.overflow).toBeLessThanOrEqual(1);
 await app.getByLabel('Fleet family',{exact:true}).selectOption('all');
 await expect(app.locator('.cos-fleet-unit-row').first()).toBeVisible();
 onlySavedReads(state);
});
});


test('short desktop viewport preserves sidebar and desktop Fleet map columns',async({page})=>{
 await page.setViewportSize({width:932,height:430});
 const {app,state}=await mount(page);
 const geometry=await app.locator('.cos-fleet-dashboard').evaluate(el=>{
  const shell=el.closest('.company-shell');
  const map=el.querySelector('.cos-fleet-map-panel').getBoundingClientRect();
  const list=el.querySelector('.cos-fleet-unit-panel').getBoundingClientRect();
  return {pointer:matchMedia('(pointer:coarse)').matches,
   sidebar:getComputedStyle(shell.querySelector('.operations-sidebar')).display,
   layout:getComputedStyle(el.querySelector('.cos-fleet-workspace')).display,
   mapX:map.x,listX:list.x,overflow:document.documentElement.scrollWidth-innerWidth};
 });
 expect(geometry.pointer).toBe(false);
 expect(geometry.sidebar).not.toBe('none');
 expect(geometry.layout).toBe('grid');
 expect(geometry.listX).toBeLessThan(geometry.mapX);
 expect(geometry.overflow).toBeLessThanOrEqual(1);
 onlySavedReads(state);
});

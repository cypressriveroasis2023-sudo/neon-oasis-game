import {test,expect} from '@playwright/test';
import {mountFleet,units,field,fresh} from './fleet-dashboard-fixtures.mjs';
import {traverseIframeHistory} from './helpers/iframeHistory.mjs';

for(const it of [false,true])test(`${it?'Verified IT':'Owner'} has a visible direct Fleet Dashboard entry and one operational map`,async({page})=>{
 const {app,state}=await mountFleet(page,it,{hash:it?'#fleet-dashboard':'#today'});
 if(it)await expect(app.getByRole('region',{name:'COS Fleet Dashboard',exact:true})).toBeVisible();
 else await app.getByRole('region',{name:'Fleet Dashboard shortcut'}).getByRole('button',{name:'Fleet Dashboard',exact:true}).click();
 await expect(app.getByRole('heading',{name:'Fleet Dashboard',exact:true})).toBeVisible();
 const navigation=app.getByRole('navigation',{name:page.viewportSize().width<=700?'Mobile Operations navigation':'COS Operations',exact:true});
 await expect(navigation.getByRole('button',{name:'Fleet Dashboard',exact:true})).toHaveAttribute('aria-current','page');
 await expect(navigation.getByRole('button',{name:'Field View',exact:true})).toHaveCount(0);
 await expect(app.locator('.cos-fleet-map-canvas')).toHaveCount(1);
 await expect(app.locator('.field-map-canvas')).toHaveCount(0);
 expect(state.errors).toEqual([]);
});

for(const alias of ['field-map','field-view'])for(const it of [false,true])test(`${alias} redirects for ${it?'IT':'Owner'} and preserves a selected unit`,async({page})=>{
 const {app,state}=await mountFleet(page,it,{hash:'#'+alias+'?unit='+units[0].id});
 await expect(app.getByRole('dialog',{name:'Helios 1 unit intelligence'})).toBeVisible();
 expect(await app.locator('body').evaluate(()=>location.hash)).toBe('#fleet-dashboard?unit='+units[0].id);
 await app.getByRole('button',{name:'Close unit details',exact:true}).click();
 await app.getByRole('button',{name:'↻ Refresh data',exact:true}).click();
 await expect(app.getByRole('dialog')).toHaveCount(0);
 expect(state.errors).toEqual([]);
});

test('legacy unit labels resolve uniquely, including Shop / ROOT without adding a field pin',async({page})=>{
 const {app}=await mountFleet(page,false,{hash:'#field-map?unitLabel=Sniper%2044'});
 await expect(app.getByRole('dialog',{name:'Sniper 44 unit intelligence'})).toBeVisible();
 await expect(app.getByRole('dialog')).toContainText('SHOP / ROOT');
 await expect(app.locator('.cos-dashboard-marker')).toHaveCount(0);
});

test('colored Fleet pins stay compact and clusters expand to accessible selectable units',async({page},info)=>{
 const catalog=structuredClone(units);
 for(const unit of catalog.slice(0,3))Object.assign(unit,{latitude:29.7,longitude:-95.4,coordinateSource:'site',locationVerification:'owner_verified',locationVerifiedAt:fresh,gpsRecordedAt:fresh});
 catalog.push({...catalog[0],id:'00000000-0000-4000-8000-000000000007',unitNumber:'ST 007',modelName:'Solar Stand'});
 const custom={...field,items:catalog.filter(u=>u.currentLocationType==='field'),inventoryItems:catalog,summary:{fieldUnits:4,mappedUnits:4,unitGps:0,missingGps:0}};
 const {app,state}=await mountFleet(page,false,{field:custom});
 await app.getByLabel('Fleet status',{exact:true}).selectOption('all');
 const cluster=app.locator('.cos-dashboard-cluster');await expect(cluster).toHaveCount(1);
 const dimensions=await cluster.locator('.cos-field-cluster').evaluate(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height}));
 expect(dimensions.w).toBe(32);expect(dimensions.h).toBe(32);
 expect(await cluster.locator('.cos-field-cluster').evaluate(el=>getComputedStyle(el,'::after').display)).toBe('block');
 await cluster.click();await expect(app.locator('.cos-dashboard-peer')).toHaveCount(4);
 const solar=app.locator('.cos-dashboard-peer .cos-field-pin-support .cos-reticle-artwork');
 await expect(solar).toHaveCSS('color','rgb(21, 168, 255)');
 const shape=await solar.evaluate(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height}));
 expect(shape.w).toBe(28);expect(shape.h).toBe(28);
 await expect(app.locator('.cos-fleet-map-canvas [data-cos-eye],.cos-fleet-map-canvas .company-eye,.cos-fleet-map-canvas .cos-reticle-solar-panel')).toHaveCount(0);
 await expect(app.locator('#cos-fleet-eye-artwork')).toHaveCount(0);
 await expect(app.locator('.cos-dashboard-peer .cos-map-status-dot')).toHaveCount(4);
 for(const [id,label,status,color] of [[catalog[0].id,'Helios 1','online','rgb(43, 255, 53)'],[catalog[1].id,'Spotter 1','offline','rgb(255, 39, 52)'],[catalog[2].id,'Spotter 2','unknown','rgb(148, 163, 184)'],[catalog[4].id,'ST 007','support','rgb(21, 168, 255)']]){
  const marker=app.locator('.cos-dashboard-peer[data-unit-id="'+id+'"]');
  await expect(marker).toHaveAttribute('aria-label',new RegExp(label));
  await expect(marker.locator('.cos-field-pin')).toHaveAttribute('data-health',status);
  await expect(marker.locator('circle')).toHaveCSS('fill',color);
  await expect(marker.locator('.cos-pin-unit-number')).toHaveCSS('color','rgb(7, 20, 33)');
  const centered=await marker.evaluate(el=>{const circle=el.querySelector('.cos-status-pin-art circle').getBoundingClientRect(),label=el.querySelector('.cos-pin-unit-number').getBoundingClientRect();return Math.abs(circle.x+circle.width/2-label.x-label.width/2)<1&&Math.abs(circle.y+circle.height/2-label.y-label.height/2)<1;});
  expect(centered).toBe(true);
 }
 await page.screenshot({path:info.outputPath('compact-expanded-fleet-markers.png'),fullPage:true});
 await app.locator('.cos-dashboard-peer[data-unit-id="'+units[1].id+'"]').click();
 await expect(app.getByRole('dialog',{name:'Spotter 1 unit intelligence'})).toBeVisible();
 await expect(app.locator('.camera-unit-state')).toHaveClass(/camera-status-offline/);
 await expect(app.locator('.camera-unit-state')).toHaveCSS('color','rgb(255, 101, 112)');
 expect(state.errors).toEqual([]);
});

test('map-only fullscreen isolates navigation, preserves unit cards and restores focus with Escape',async({page})=>{
 const {app,state}=await mountFleet(page);const enter=app.getByRole('button',{name:'Fullscreen fleet map',exact:true});
 await enter.click();await expect(app.getByRole('navigation',{name:'Fleet dashboard views'})).not.toBeVisible();
 await app.locator('.cos-dashboard-marker').first().click();await expect(app.getByRole('dialog',{name:'Helios 1 unit intelligence'})).toBeVisible();
 await app.getByRole('button',{name:'Close unit details'}).click();
 await app.getByRole('button',{name:'Exit fullscreen fleet map'}).press('Escape');
 await expect(app.locator('.cos-fleet-map-expanded')).toHaveCount(0);await expect(enter).toBeFocused();
 expect(state.errors).toEqual([]);
});

test('installation workflows share the same canvas and retain unsaved pin coordinates until confirmation',async({page})=>{
 const {app,state}=await mountFleet(page,false,{features:{fieldLocationVerification:true}});
 await app.locator('.cos-fleet-unit-row').filter({hasText:'Helios 1'}).click();
 await app.getByRole('button',{name:'Edit / verify installation →',exact:true}).click();
 await expect(app.getByRole('heading',{name:'GPS history'})).toBeVisible();
 await expect(app.getByRole('button',{name:'Refresh mHelpDesk location'})).toBeVisible();
 await app.getByRole('button',{name:'Choose pin on map',exact:true}).click();
 await expect(app.getByRole('dialog')).not.toBeVisible();await expect(app.locator('.cos-fleet-map-canvas')).toHaveCount(1);await expect(app.locator('.field-map-canvas')).toHaveCount(0);
 await app.locator('.cos-fleet-map-canvas').click({position:{x:80,y:100}});
 await expect(app.getByRole('dialog')).toBeVisible();
 await expect(app.getByLabel('Latitude',{exact:true})).not.toHaveValue('');
 expect(state.calls.filter(c=>c.method!=='GET')).toHaveLength(0);
 await expect(app.getByRole('button',{name:'Save verified location'})).toBeDisabled();
 await app.getByLabel(/I checked that these coordinates match/).check();
 await app.getByRole('button',{name:'Save verified location'}).click();
 await expect.poll(()=>state.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/gps')).length).toBe(1);
 await expect(app.getByRole('status').filter({hasText:'location saved and read back successfully'}).first()).toBeVisible();
 expect(state.errors).toEqual([]);
});

for(const it of [false,true])test(`${it?'IT':'Owner'} Camera Health and Field View reuse one workspace and selected-unit detail`,async({page})=>{
 const {app,state}=await mountFleet(page,it,{hash:'#camera-health'});
 await expect(app.locator('.cos-fleet-dashboard')).toHaveCount(1);
 await expect(app.locator('.camera-overview')).toHaveCount(0);
 const first=app.locator('.cos-fleet-table-wrap tbody tr').filter({hasText:'Helios 1'});
 await first.getByRole('button',{name:'Details →',exact:true}).click();
 await expect(app.getByRole('dialog',{name:'Helios 1 unit intelligence'})).toBeVisible();
 await expect.poll(()=>app.locator('body').evaluate(()=>location.hash)).toBe('#camera-health?unit='+units[0].id);
 await app.getByRole('button',{name:'Close unit details',exact:true}).click();
 await app.getByRole('button',{name:'More',exact:true}).first().click();
 await app.getByRole('dialog',{name:'Operations navigation'}).getByRole('button',{name:'Fleet Dashboard',exact:true}).click();
 await expect(app.locator('.cos-fleet-map-canvas')).toHaveCount(1);
 await expect(app.locator('.cos-fleet-table-wrap')).toHaveCount(0);
 await app.locator('.cos-fleet-unit-row').filter({hasText:'Helios 1'}).click();
 await expect(app.getByRole('dialog',{name:'Helios 1 unit intelligence'})).toBeVisible();
 await expect(app.locator('.cos-fleet-dashboard')).toHaveCount(1);
 await expect(app.locator('.camera-overview')).toHaveCount(0);
 await traverseIframeHistory(app,'back','#camera-health');
 await expect(app.locator('.cos-fleet-table-wrap')).toBeVisible();
 await expect(app.getByRole('dialog',{name:'Helios 1 unit intelligence'})).toHaveCount(0);
 await traverseIframeHistory(app,'forward','#fleet-dashboard?unit='+units[0].id);
 await expect(app.locator('.cos-fleet-map-canvas')).toBeVisible();
 await expect(app.locator('.cos-fleet-table-wrap')).toHaveCount(0);
 await expect(app.getByRole('dialog',{name:'Helios 1 unit intelligence'})).toBeVisible();
 expect(state.errors).toEqual([]);
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);
});

test('Owner advanced diagnostics remains a secondary authorized tool',async({page})=>{
 const {app,state}=await mountFleet(page,false,{hash:'#camera-health'});
 await app.locator('summary').filter({hasText:'Authorized tools'}).click();
 await app.getByRole('button',{name:'Advanced camera diagnostics',exact:true}).click();
 await expect.poll(()=>app.locator('body').evaluate(()=>location.hash)).toBe('#camera-health?diagnostics=1');
 await expect(app.locator('.camera-overview')).toBeVisible();
 await expect(app.locator('.cos-fleet-dashboard')).toHaveCount(0);
 expect(state.errors).toEqual([]);
});

test('daily IT has no Owner advanced-diagnostics launch or paused action',async({page})=>{
 const {app}=await mountFleet(page,true,{hash:'#camera-health'});
 await expect(app.getByRole('button',{name:'Advanced camera diagnostics',exact:true})).toHaveCount(0);
 await app.locator('.cos-fleet-table-wrap tbody tr').filter({hasText:'Helios 1'}).getByRole('button',{name:'Details →',exact:true}).click();
 await expect(app.getByRole('button',{name:'Create ticket',exact:true})).toHaveCount(0);
 await expect(app.getByRole('button',{name:'Review equipment identity',exact:true})).toHaveCount(0);
 await expect(app.getByRole('button',{name:'Register in COS inventory →',exact:true})).toHaveCount(0);
});

for(const it of [false,true])test(`${it?'IT':'Owner'} repeated Camera Health and Field View entries select their advertised modes`,async({page})=>{
 const {app,state}=await mountFleet(page,it,{hash:'#camera-health'});
 const entries=app.getByRole('navigation',{name:'Fleet dashboard views'});
 const enter=async(label)=>{await app.getByRole('button',{name:'More',exact:true}).first().click();await app.getByRole('dialog',{name:'Operations navigation'}).getByRole('button',{name:label,exact:true}).click();};
 for(let repeat=0;repeat<2;repeat++){
  await entries.getByRole('button',{name:'Map',exact:true}).click();
  await expect(app.locator('.cos-fleet-map-canvas')).toBeVisible();
  await enter('Camera Health');
  await expect(app.locator('.cos-fleet-table-wrap')).toBeVisible();
  await expect(app.locator('.cos-fleet-map-canvas')).toHaveCount(0);
  await enter('Fleet Dashboard');
  await entries.getByRole('button',{name:/Fleet health/}).click();
  await expect(app.locator('.cos-fleet-table-wrap')).toBeVisible();
  await enter('Fleet Dashboard');
  await expect(app.locator('.cos-fleet-map-canvas')).toBeVisible();
  await expect(app.locator('.cos-fleet-table-wrap')).toHaveCount(0);
  await enter('Camera Health');
 }
 expect(state.errors).toEqual([]);
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);
});

for(const it of [false,true])test(`${it?'IT':'Owner'} direct Camera Health unit link restores focus to its own table action`,async({page})=>{
 const {app,state}=await mountFleet(page,it,{hash:'#camera-health?unit='+units[0].id});
 await expect(app.getByRole('dialog',{name:'Helios 1 unit intelligence'})).toBeVisible();
 await app.getByRole('button',{name:'Close unit details',exact:true}).click();
 await expect(app.getByRole('dialog',{name:'Helios 1 unit intelligence'})).toHaveCount(0);
 await expect(app.locator('.cos-fleet-table-wrap tbody tr').filter({hasText:'Helios 1'}).getByRole('button',{name:'Details →',exact:true})).toBeFocused();
 expect(state.calls.every(call=>call.method==='GET')).toBe(true);expect(state.errors).toEqual([]);
});

test('expanded cluster survives pending location revalidation but settled membership changes reset it',async({page})=>{
 const catalog=structuredClone(units);
 for(const unit of catalog.slice(0,3))Object.assign(unit,{latitude:29.7,longitude:-95.4,coordinateSource:'site',locationVerification:'owner_verified',locationVerifiedAt:fresh,gpsRecordedAt:fresh});
 const custom={...field,items:catalog.filter(unit=>unit.currentLocationType==='field'),inventoryItems:catalog,summary:{fieldUnits:3,mappedUnits:3,unitGps:0,missingGps:0}};
 const {app,state}=await mountFleet(page,false,{field:custom,advancingClock:true});
 const cluster=app.locator('.cos-dashboard-cluster');await expect(cluster).toHaveCount(1);await cluster.click();
 const ids=()=>app.locator('.cos-dashboard-peer').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-unit-id')).sort());
 const expected=catalog.slice(0,3).map(unit=>unit.id).sort();await expect.poll(ids).toEqual(expected);
 const viewport=()=>app.locator('body').evaluate(()=>({center:history.state.cosFieldMapView.center,zoom:history.state.cosFieldMapView.zoom}));const before=await viewport();
 await page.clock.runFor(60_000);await expect.poll(ids).toEqual(expected);await expect.poll(viewport).toEqual(before);
 await app.getByRole('button',{name:'↻ Refresh data',exact:true}).click();await expect(app.getByRole('button',{name:'↻ Refresh data',exact:true})).toBeEnabled();await expect.poll(ids).toEqual(expected);await expect.poll(viewport).toEqual(before);
 const removed=catalog[1].id;for(const unit of state.field.inventoryItems)if(unit.id===removed)Object.assign(unit,{placement:'SHOP',currentLocationType:'shop',status:'available'});
 state.field.items=state.field.items.filter(unit=>unit.id!==removed);state.field.summary={fieldUnits:2,mappedUnits:2,unitGps:0,missingGps:0};
 await app.getByRole('button',{name:'↻ Refresh data',exact:true}).click();await expect(app.getByRole('button',{name:'↻ Refresh data',exact:true})).toBeEnabled();
 await expect(cluster).toHaveAttribute('aria-expanded','false');await expect(app.locator('.cos-dashboard-peer')).toHaveCount(0);
 await expect(cluster).toHaveAttribute('data-unit-ids',JSON.stringify([catalog[0].id,catalog[2].id]));
 await cluster.click();await expect.poll(ids).toEqual([catalog[0].id,catalog[2].id].sort());
 expect(state.calls.every(call=>call.method==='GET')).toBeTruthy();expect(state.errors).toEqual([]);
});

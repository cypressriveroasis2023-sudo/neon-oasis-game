import {showAllFieldHealth} from './field-map-controls.mjs';
import {revealMapFilters,revealMapInfo,revealUnitTroubleshooting} from './field-map-controls.mjs';
import {test,expect} from '@playwright/test';
import {port,snapshot,resource} from './fixtures/camera-evidence-fixtures.mjs';
const origin=process.env.COS_MAP_TEST_ORIGIN||'http://127.0.0.1:4173';
const id='11111111-1111-4111-8111-111111111111',id2='22222222-2222-4222-8222-222222222222',id3='33333333-3333-4333-8333-333333333333',site='44444444-4444-4444-8444-444444444444',customer='55555555-5555-4555-8555-555555555555';
const now='2026-10-06T18:00:00Z',fresh='2026-10-06T17:55:00Z';
async function mount(page,{historical=false,ambiguous=false,oldApi=false,nativeOverview=false,entryLabel='',evidenceCase=false,scopeCase=false,accessCase=false,trackerCase=false,crowded=false,crowdedCount=3,mixedCrowd=false,nearbyCrowd=false,ordinaryStand=false,htmlLabel=false,pausedClock=false}={}){
 const state={writes:[],requests:[],fail:false};
 const base={status:'installed',currentLocationType:'site',modelName:'Solar Spotter',address:'100 Fixture Road',site:'Synthetic site',customer:'Synthetic customer',installedSiteId:site,latitude:29.76,longitude:-95.37,locationVerification:'owner_verified',gpsRecordedAt:fresh,locationVerifiedAt:fresh,coordinateSource:'site',hasUnitGps:true};
 state.units=[{...base,id,unitNumber:'Solar Spotter 51'}, {...base,id:id2,unitNumber:'Solar Spotter 52',latitude:29.79}, {...base,id:id3,unitNumber:'Solar Spotter 53',latitude:29.82}];
 if(crowded)state.units=state.units.map((u,i)=>({...u,latitude:29.76,longitude:-95.37,...(i===2?{unitNumber:'Solar Stand 72 044',modelName:'SOLAR STANDS 72'}:{})}));
 if(ordinaryStand)state.units[2]={...state.units[2],unitNumber:'ST 001',modelName:'STANDS'};
 if(crowded&&crowdedCount>3)state.units.push(...Array.from({length:crowdedCount-3},(_,i)=>({...base,id:'00000000-0000-4000-8000-'+String(i+4).padStart(12,'0'),unitNumber:'Solar Spotter '+(54+i),latitude:29.76,longitude:-95.37})));
 if(nearbyCrowd)state.units.push(...Array.from({length:3},(_,i)=>({...base,id:'00000000-0000-4000-8000-'+String(i+100).padStart(12,'0'),unitNumber:'Solar Spotter '+(51+state.units.length+i),longitude:-95.36})));
 if(htmlLabel)state.units[0]={...state.units[0],unitNumber:'Ranger <img src=x onerror="window.mapLabelExecuted=true">',site:'Site <b>literal</b>',address:'100 <img src=x onerror="window.mapAddressExecuted=true"> Fixture Road'};
 if(historical)state.units[0]={...state.units[0],locationVerification:undefined,readOnly:true};
 if(ambiguous)state.units[1].unitNumber='SOLAR SPOTTER 051';
 let rows=state.units.map((u,i)=>resource(i+1,'SOLARSPOTTER '+(51+i),{name:'Fixture camera '+(i+1),status:i===1?'offline':'online',checkedAt:fresh,...(!oldApi?{evidence:{kind:'provider',source:'Star4Live',resource:'camera',active:true,status:i===1?'offline':'online',observedAt:i===2?'2026-10-06T16:00:00Z':fresh,lastOnlineAt:fresh}}:{evidence:undefined})}));
 if(mixedCrowd)rows=rows.map((row,i)=>i>2?{...row,evidence:{...row.evidence,observedAt:'2026-10-06T16:00:00Z'}}:row);
 if(evidenceCase)rows=[resource(1,'SOLARSPOTTER 51',{name:'Fixture recorder',type:'NVR'}),resource(2,'SOLARSPOTTER 52',{name:'Fixture service unit',type:'Sniper',serviceEvidence:port()}),resource(3,'SOLARSPOTTER 53',{name:'Fixture Recon detector',type:'detector',evidence:{kind:'provider',source:'Reconeyez',resource:'detector',active:true,status:'offline',observedAt:'2026-10-06T16:00:00Z',lastOnlineAt:'2026-10-05T12:00:00Z'}})];
 if(accessCase){state.units=state.units.map((unit,i)=>({...unit,unitNumber:['SNIPER 2 005','CAM V 002','CAM V 003'][i],modelName:i?'CAM V & RSU':'SNIPERS'}));rows=[resource(101,'SNIPER 2 005',{type:'Sniper 2',evidence:undefined,serviceEvidence:port(),connection:{publicIp:'203.0.113.12',ports:[80,443,554,38880]}}),resource(102,'CAM V 002',{type:'CAMV',evidence:undefined,serviceEvidence:port({status:'offline',reachable:false,confirmedOutage:true})}),resource(103,'CAM V 003',{type:'CAMV',evidence:undefined,serviceEvidence:port({status:'unknown',reachable:null})})];}
 if(trackerCase){state.units=[{...state.units[0],unitNumber:'Sniper 2 344',modelName:'SNIPERS',readOnly:true,latitude:null,longitude:null,locationVerification:'address_only',hasUnitGps:false},{...state.units[1],unitNumber:'CAMV 010',modelName:'CAM V & RSU',readOnly:true,latitude:null,longitude:null,locationVerification:'address_only',hasUnitGps:false},{...state.units[2],unitNumber:'Sniper 334',modelName:'SNIPERS',readOnly:true,latitude:null,longitude:null,locationVerification:'address_only',hasUnitGps:false}];rows=[resource(101,'Sniper 2 344',{type:'Sniper 2',evidence:undefined,scope:'unknown',serviceEvidence:port()}),resource(102,'CAMV 010',{type:'CAMV',evidence:undefined,scope:'unknown',serviceEvidence:port({status:'offline',reachable:false,confirmedOutage:true})})];}
 if(scopeCase)rows=rows.map((row,i)=>({...row,scope:['unknown','shop','inactive'][i],activationState:i===2?'deactivated':'active'}));
 if(scopeCase)state.units=state.units.map((unit,i)=>({...unit,currentLocationType:i===1?'shop':'unknown',hasUnitGps:false,latitude:null,longitude:null,locationVerification:'address_only'}));
 const health={...snapshot(rows),...(oldApi?{evidenceVersion:1,inventory:undefined}:{})};

 await page.clock.install({time:new Date(now)});
 if(pausedClock)await page.clock.pauseAt(new Date(now));
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url===origin+'/field-health-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe src="/#${nativeOverview?'camera-health?diagnostics=1':'field-map'+(entryLabel?'?unitLabel='+encodeURIComponent(entryLabel):'')}"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-only'},location.origin)})</script>`});
  if(url.startsWith(origin+'/'))return route.continue();
  if(/^https:\/\/[abc]\.tile\.openstreetmap\.org\//.test(url))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e5eadd"/><path d="M0 75H256M0 195H256M78 0V256M198 0V256" stroke="#fff" stroke-width="5"/><path d="M0 75H256M78 0V256" stroke="#d4cdb9" stroke-width="1"/></svg>'});
  if(!url.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();state.requests.push(request);if(request.method!=='GET'){state.writes.push(request);return route.fulfill({status:400,headers,body:JSON.stringify({error:'Synthetic writes disabled'})});}
  if(request.path==='/api/camera-health/summary-v3'&&state.fail)return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:'Synthetic provider unavailable'})});
  const data=request.path==='/api/session'?{authorized:true,name:'Fixture Owner',role:'Owner',features:{mhelpTicketImport:true,fieldLocationVerification:true,fleetAccess:true,fleetPlacementEdit:true,fleetConnectionEdit:true}}
    :request.path==='/api/field-map'?scopeCase?{items:[],inventoryItems:state.units,summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0},generatedAt:now}:{items:state.units,summary:{fieldUnits:state.units.length,mappedUnits:trackerCase?0:state.units.length,unitGps:trackerCase?0:state.units.length,missingGps:trackerCase?state.units.length:0},generatedAt:now}
    :request.path==='/api/camera-health/summary-v3'?health
    :request.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:now}
    :request.path==='/api/equipment'?{items:state.units,models:[]}
    :request.path==='/api/customers'?{items:[{id:customer,name:'Synthetic customer',status:'active'}]}
    :request.path==='/api/sites'?{items:[{id:site,name:'Synthetic site',status:'active',customerId:customer,customer:'Synthetic customer'}]}
    :request.path==='/api/owner/control-data'?{sites:[{id:site,name:'Synthetic site',customer_id:customer,customers:{name:'Synthetic customer'}}],truckChecks:[],itTechnicians:[],serviceTechnicians:[]}
    :request.path==='/api/daily-board'?{jobs:[],tasks:[],readiness:[],asOf:now}:{items:[]};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.addInitScript(()=>{if(parent!==window)history.replaceState({...history.state,cosFieldMapView:{...history.state?.cosFieldMapView,health:'all'}},'');});
 await page.goto('/field-health-fixture');const frame=page.frameLocator('iframe');if(nativeOverview)await frame.getByLabel('Camera Health unit filter').selectOption('all');if(nativeOverview)await expect(frame.locator('.camera-overview-card')).toHaveCount(scopeCase?1:3);else if(entryLabel)await expect(frame.locator('.cos-fleet-drawer>h2')).toHaveText(entryLabel);else {await expect(frame.locator('.cos-fleet-unit-row')).toHaveCount(state.units.length);if(!crowded&&!trackerCase&&state.units.some(unit=>unit.locationVerification==='owner_verified')){await expect(frame.locator('.cos-field-pin,.cos-field-cluster').first()).toHaveCount(1);if(await frame.locator('.cos-field-cluster-wrap').count())await frame.locator('.leaflet-control-zoom-in').click();}}if(pausedClock){await page.clock.runFor(500);await expect(frame.locator('.leaflet-zoom-anim')).toHaveCount(0);}return {frame,state};
}

async function closeUnit(frame){const button=frame.getByRole('button',{name:'Close unit details'});if(await button.isVisible())await button.click();}
async function expandGroup(frame,count){await frame.locator('.cos-fleet-map-panel').scrollIntoViewIfNeeded();await expect(frame.locator('.cos-field-cluster-wrap')).toHaveCount(0);await expect(frame.locator('.cos-field-pin')).toHaveCount(count);}

async function readablePins(frame){return frame.locator('.cos-fleet-map-canvas').evaluate(canvas=>{const bounds=canvas.getBoundingClientRect(),pins=[...canvas.querySelectorAll('.cos-field-pin')];const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;return pins.every((pin,i)=>{const box=pin.getBoundingClientRect(),hit=pin.closest('.cos-field-pin-wrap').getBoundingClientRect(),label=pin.querySelector('.cos-pin-unit-number').getBoundingClientRect();return box.width===28&&box.height===28&&hit.width===44&&hit.height===56&&hit.left>=bounds.left&&hit.right<=bounds.right&&hit.top>=bounds.top&&hit.bottom<=bounds.bottom&&box.left>=bounds.left&&box.right<=bounds.right&&box.top>=bounds.top&&label.bottom<=bounds.bottom&&pins.every((other,j)=>i===j||!overlaps(label,other.getBoundingClientRect())&&!overlaps(label,other.querySelector('.cos-pin-unit-number').getBoundingClientRect()));});});}

test('provider colors, nearby center and unit health ticket draft stay on the selected identity',async({page},testInfo)=>{
 const {frame,state}=await mount(page);
 await expect(frame.locator('.cos-field-pin')).toHaveCount(3);
 await expect(frame.locator('.cos-field-pin').nth(0)).toHaveAttribute('data-health','online');await expect(frame.locator('.cos-field-pin').nth(1)).toHaveAttribute('data-health','offline');await expect(frame.locator('.cos-field-pin').nth(2)).toHaveAttribute('data-health','unknown');
 await revealMapFilters(frame); await frame.getByLabel('Nearby unit center').selectOption(id);await expect(frame.getByLabel('Nearby radius miles')).toBeVisible();await expect(frame.locator('.cos-fleet-unit-row')).toHaveCount(3);
 await frame.locator('.cos-fleet-map-panel').scrollIntoViewIfNeeded();await frame.locator('.cos-field-pin').nth(1).click();await revealUnitTroubleshooting(frame);await expect(frame.getByRole('region',{name:'Selected field unit Camera Health'})).toContainText('Solar Spotter 52');await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#fleet-dashboard?unit='+id2);
 await expect(frame.locator('.camera-unit-state')).toHaveText('Camera outage observed');await frame.getByLabel('Camera unit ticket type').selectOption('PICKUP');await revealUnitTroubleshooting(frame);await frame.getByRole('button',{name:'Create ticket',exact:true}).click();
 await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#daily-board?create=PICKUP&unit='+id2);
 await expect(frame.getByLabel('Title',{exact:true})).toHaveValue(/Solar Spotter 52/);await expect(frame.locator('.owner-board-controls')).toContainText('Synthetic customer');await expect(frame.locator('.owner-board-controls')).toContainText('does not assign equipment');
 expect(await frame.locator('body').evaluate(()=>history.state.cosTicketFromUnitHealth)).toBe(id2);await frame.getByRole('button',{name:'Back to unit health',exact:true}).click();await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#fleet-dashboard?unit='+id2);await expect(frame.locator('.cos-fleet-map-panel')).toBeVisible();await expect(frame.locator('.cos-fleet-drawer>h2')).toHaveText('Solar Spotter 52');await frame.getByRole('button',{name:'Back to Fleet Dashboard',exact:true}).click();await expect(frame.locator('.cos-fleet-drawer')).toHaveCount(0);await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#fleet-dashboard');
 await page.screenshot({path:testInfo.outputPath('field-camera-flow.png')});expect(state.writes).toHaveLength(0);
});
test('a uniquely resolved label deep link returns a cancelled ticket to the same map unit',async({page})=>{
 const label='Solar Spotter 52',hash='#fleet-dashboard?'+new URLSearchParams({unitLabel:label});
 const {frame,state}=await mount(page,{entryLabel:label});
 await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe(hash);
 await revealUnitTroubleshooting(frame);await expect(frame.getByRole('region',{name:'Selected field unit Camera Health'})).toContainText(label);
 await revealUnitTroubleshooting(frame);await frame.getByRole('button',{name:'Create ticket',exact:true}).click();
 await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#daily-board?create=SERVICE&unit='+id2);
 expect(await frame.locator('body').evaluate(()=>history.state.cosTicketFromUnitHealth)).toBe(id2);
 await frame.getByRole('button',{name:'Back to unit health',exact:true}).click();
 await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe(hash);
 await expect(frame.locator('.cos-fleet-map-panel')).toBeVisible();
 await expect(frame.locator('.cos-fleet-drawer>h2')).toHaveText(label);
 await expect(frame.locator('.cos-fleet-unit-row.selected')).toHaveAttribute('data-unit-id',id2);
 expect(state.writes).toEqual([]);
});

test('staleness and unavailable health fail gray without moving map or writing',async({page})=>{
 const {frame,state}=await mount(page,{pausedClock:true});await expect(frame.locator('.cos-field-pin').first()).toHaveAttribute('data-health','online');
 await frame.locator('.leaflet-control-zoom-in').click();await page.clock.runFor(500);await expect(frame.locator('.leaflet-zoom-anim')).toHaveCount(0);
 const transform=await frame.locator('.leaflet-map-pane').getAttribute('style'),before=await frame.locator('body').evaluate(()=>Date.now());
 await page.clock.fastForward(16*60*1000);expect(await frame.locator('body').evaluate(()=>Date.now())-before).toBe(16*60*1000);
 await expect(frame.locator('.cos-field-pin').first()).toHaveAttribute('data-health','unknown');expect(await frame.locator('.leaflet-map-pane').getAttribute('style')).toBe(transform);
 state.fail=true;await frame.getByRole('button',{name:/Refresh data/}).click();await expect(frame.getByRole('alert')).toContainText('Synthetic provider unavailable');expect(state.writes).toHaveLength(0);
});
test('historical coordinates remain available for review and excluded from current pins and nearby distances',async({page})=>{
 const {frame,state}=await mount(page,{historical:true});await expect(frame.locator('.cos-field-pin')).toHaveCount(2);await expect(frame.getByLabel('Nearby unit center').locator('option[value="'+id+'"]')).toHaveCount(0);await frame.locator('.cos-fleet-unit-row').first().click();await frame.getByRole('button',{name:'Edit / verify installation →'}).click();await expect(frame.locator('.field-map-historical')).toContainText('Historical coordinates');await expect(frame.locator('.field-map-historical')).toContainText('Do not use for routing');await closeUnit(frame);await revealMapFilters(frame);await frame.getByLabel('Nearby unit center').selectOption(id2);await expect(frame.locator('.cos-field-pin')).toHaveCount(2);expect(state.writes).toHaveLength(0);
});

test('old backend evidence and ambiguous identities stay gray',async({page})=>{const {frame}=await mount(page,{oldApi:true,ambiguous:true});for(const pin of await frame.locator('.cos-field-pin').all())await expect(pin).toHaveAttribute('data-health','unknown');});
test('pasted address pin is an unsaved candidate; moving it clears confirmation',async({page})=>{
 const {frame,state}=await mount(page);await frame.locator('.cos-fleet-unit-row').first().click();await frame.getByRole('button',{name:'Edit / verify installation →'}).click();await frame.getByLabel('Paste coordinates or a Google Maps point link').fill('30.01, -95.41');await frame.getByRole('button',{name:'Use pasted coordinates',exact:true}).click();await expect(frame.getByLabel('Latitude',{exact:true})).toHaveValue('30.01');await expect(frame.getByLabel('Location source',{exact:true})).toHaveValue('site');await expect(frame.getByRole('button',{name:'Save verified location',exact:true})).toBeDisabled();await frame.getByRole('checkbox',{name:/I checked/}).check();await expect(frame.getByRole('button',{name:'Save verified location',exact:true})).toBeEnabled();await frame.getByLabel('Latitude',{exact:true}).fill('30.02');await expect(frame.getByRole('button',{name:'Save verified location',exact:true})).toBeDisabled();expect(state.writes).toHaveLength(0);
});

test('closing and reopening unit diagnostics preserves search, nearby center and distance filters',async({page})=>{
 const {frame,state}=await mount(page);await frame.getByLabel('Search units, customers, sites or addresses').fill('Solar');await revealMapFilters(frame);await frame.getByLabel('Nearby unit center').selectOption(id);await frame.getByLabel('Nearby radius miles').selectOption('25');await frame.locator('.cos-fleet-map-panel').scrollIntoViewIfNeeded();await frame.locator('.cos-field-pin').nth(1).click();await expect(frame.locator('.cos-fleet-drawer>h2')).toHaveText('Solar Spotter 52');await closeUnit(frame);await expect(frame.getByLabel('Search units, customers, sites or addresses')).toHaveValue('Solar');await expect(frame.getByLabel('Nearby unit center')).toHaveValue(id);await expect(frame.getByLabel('Nearby radius miles')).toHaveValue('25');await frame.locator('.cos-field-pin').nth(1).click();await expect(frame.locator('.cos-fleet-drawer>h2')).toHaveText('Solar Spotter 52');expect(state.writes).toHaveLength(0);
});

test('native Camera Health shows units and individual cameras separately with filter and accessible drill-down',async({page},testInfo)=>{
 const {frame,state}=await mount(page,{nativeOverview:true});
 const stats=frame.locator('.camera-unit-kpis');await expect(stats.locator('button b')).toHaveText(['—','—','—','—']);await expect(stats.locator('.camera-status-online')).toHaveCSS('color','rgb(43, 255, 53)');await expect(stats.locator('.camera-status-offline')).toHaveCSS('color','rgb(255, 39, 52)');await expect(frame.locator('.camera-actual-count>b')).toHaveText('3');await expect(frame.locator('.camera-record-breakdown')).toContainText('Reported camera records');
 await frame.getByLabel('Camera Health unit filter').selectOption('provider-offline');await expect(frame.locator('.camera-overview-card')).toHaveCount(1);const card=frame.locator('.camera-overview-card');await expect(card).toContainText('SOLARSPOTTER 52');await card.locator('.camera-card-main').click();const detail=frame.getByRole('dialog',{name:'Camera Health unit details'});await expect(detail).toContainText('Fixture camera 2');await expect(detail.locator('.camera-device-cards article')).toHaveCount(1);await page.keyboard.press('Escape');await expect(detail).toHaveCount(0);await expect(card.locator('.camera-card-main')).toBeFocused();await card.locator('.camera-card-main').click();await detail.getByRole('button',{name:'Back to units',exact:true}).click();await expect(detail).toHaveCount(0);await frame.getByLabel('Camera Health unit filter').selectOption('all');await frame.getByLabel('Search Camera Health units').fill('53');await expect(frame.locator('.camera-overview-card')).toHaveCount(1);await expect(frame.locator('.camera-overview-card')).toContainText('Camera status unverified');await frame.getByLabel('Search Camera Health units').fill('');await frame.locator('body').evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:testInfo.outputPath('camera-health-unit-overview.png'),fullPage:true});await frame.locator('.camera-record-breakdown > summary').click();await frame.locator('.camera-record-breakdown').evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:testInfo.outputPath('camera-health-reconciliation.png'),fullPage:true});expect(state.writes).toHaveLength(0);
});
test('native unit details can open Install Delivery draft without guessing record identity',async({page})=>{
 const {frame,state}=await mount(page,{nativeOverview:true});await frame.locator('.camera-overview-card').filter({hasText:'SOLARSPOTTER 52'}).locator('.camera-card-main').click();const detail=frame.getByRole('dialog',{name:'Camera Health unit details'});await detail.getByLabel('Unit detail ticket type').selectOption('DELIVERY');await detail.getByRole('button',{name:'Create ticket',exact:true}).click();await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#daily-board?create=DELIVERY&unit='+id2);await expect(frame.getByLabel('Title',{exact:true})).toHaveValue(/Solar Spotter 52/);expect(state.writes).toHaveLength(0);
});


test('unified Dispatch Board preserves import access without mixing a unit ticket context',async({page})=>{
 const {frame,state}=await mount(page);
 await frame.locator('.cos-fleet-map-panel').scrollIntoViewIfNeeded();
 await frame.locator('.cos-field-pin').nth(1).click();
 await revealUnitTroubleshooting(frame);await frame.getByRole('button',{name:'Create ticket',exact:true}).click();
 await expect(frame.getByLabel('Title',{exact:true})).toHaveValue(/Solar Spotter 52/);
 await expect(frame.getByRole('region',{name:'mHelpDesk ticket import',exact:true})).toHaveCount(0);
 await frame.getByRole('button',{name:'Back to unit health',exact:true}).click();
 await expect(frame.locator('.cos-fleet-drawer>h2')).toHaveText('Solar Spotter 52');
 const child=page.frames().find(child=>child.parentFrame());
 await child.evaluate(()=>{location.hash='daily-board';});
 const settings=frame.locator('details.cos-workspace-settings').filter({has:frame.locator('summary').filter({hasText:'Owner tools · import, create and manage jobs'})});
 await expect(settings).not.toHaveAttribute('open','');
 await expect(frame.getByRole('region',{name:'mHelpDesk ticket import',exact:true})).not.toBeVisible();
 await settings.getByText('Owner tools · import, create and manage jobs',{exact:true}).click();
 await expect(frame.getByRole('region',{name:'mHelpDesk ticket import',exact:true})).toBeVisible();
 await expect(frame.getByRole('heading',{name:'Import mHelpDesk ticket',exact:true})).toBeVisible();
 await expect(frame.getByLabel('Title',{exact:true})).toHaveValue('');
 await child.evaluate(()=>{location.hash='tech-check';});
 await expect(frame.getByRole('heading',{name:'Tech Checks',exact:true})).toBeVisible();
 await expect(frame.getByRole('region',{name:'mHelpDesk ticket import',exact:true})).toHaveCount(0);
 expect(state.writes).toHaveLength(0);
});


test('native recorder, service-only, and old Recon observations keep separate status dimensions',async({page})=>{
 const {frame,state}=await mount(page,{nativeOverview:true,evidenceCase:true});
 await expect(frame.locator('.camera-unit-kpis button b')).toHaveText(['—','—','—','—']);
 const recorder=frame.locator('.camera-overview-card').filter({hasText:'SOLARSPOTTER 51'});
 await expect(recorder).toContainText('Camera status unverified');await expect(recorder).toContainText('Camera channel status unavailable');
 await frame.getByLabel('Camera Health unit filter').selectOption('service');await expect(frame.locator('.camera-overview-card')).toHaveCount(1);await expect(frame.locator('.camera-overview-card')).toContainText('Camera status unverified');await expect(frame.locator('.camera-overview-card')).toContainText('Camera channel status unavailable');
 await frame.getByLabel('Camera Health unit filter').selectOption('all');await frame.locator('.camera-overview-card').filter({hasText:'SOLARSPOTTER 53'}).locator('.camera-card-main').click();
 const detail=frame.getByRole('dialog',{name:'Camera Health unit details'});await expect(detail).toContainText('DETECTOR NOT VERIFIED');await expect(detail).toContainText('Last reported detector state: OFFLINE');await expect(detail).toContainText('2 hr ago');await expect(detail).toContainText('older observation; current status unverified');await detail.getByRole('button',{name:'Back to units',exact:true}).click();
 const child=page.frames().find(child=>child.parentFrame());await child.evaluate(()=>{location.hash='field-map';});await showAllFieldHealth(frame);await expect(frame.locator('.cos-field-pin,.cos-field-cluster').first()).toBeVisible();const group=frame.locator('.cos-field-cluster-wrap');if(await group.count()){await expect(group).toHaveCount(1);await group.click();}await expect(frame.locator('.cos-field-pin')).toHaveCount(3);for(const pin of await frame.locator('.cos-field-pin').all())await expect(pin).toHaveAttribute('data-health','unknown');
 await frame.locator('.cos-fleet-unit-row').filter({hasText:'Solar Spotter 51'}).click();
 const unitSummary=frame.getByRole('region',{name:'Selected unit camera health',exact:true});
 await expect(unitSummary).toContainText('Camera status unverified');
 await expect(unitSummary).toContainText('Camera channel status unavailable. Recorder and service observations remain separate.');
 await expect(unitSummary.locator('.cos-signal-online')).toHaveCount(0);
 await revealUnitTroubleshooting(frame);
 const recorderObservation=frame.locator('.camera-health-native .camera-device-cards article').filter({hasText:'Fixture recorder'});
 await expect(recorderObservation).toHaveCount(1);
 await expect(recorderObservation.getByText('RECORDER ONLINE',{exact:true})).toBeVisible();
 await expect(recorderObservation).toContainText('Star4Live · Last reported recorder state: ONLINE');
 await expect(recorderObservation).toContainText('Camera channel status unavailable from this recorder observation.');
 expect(state.writes).toHaveLength(0);
});

test('native location review stays visible while shop and inactive scopes reconcile separately',async({page})=>{
 const {frame,state}=await mount(page,{nativeOverview:true,scopeCase:true});
 await expect(frame.locator('.camera-unit-kpis button b')).toHaveText(['—','—','—','—']);await expect(frame.locator('.camera-overview-card')).toContainText('LOCATION REVIEW');
 await frame.getByLabel('Camera Health unit filter').selectOption('shop');await expect(frame.locator('.camera-overview-card')).toHaveCount(1);await expect(frame.locator('.camera-overview-card')).toContainText('SHOP / ROOT');
 await frame.getByLabel('Camera Health unit filter').selectOption('inactive');await expect(frame.locator('.camera-overview-card')).toHaveCount(1);await expect(frame.locator('.camera-overview-card')).toContainText('INACTIVE');
 await frame.locator('.camera-record-breakdown > summary').click();await frame.getByText('How these totals add up',{exact:true}).click();await expect(frame.locator('.camera-record-breakdown')).toContainText('0 confirmed-field records + 1 shop/root records + 1 inactive records + 1 location-review records');expect(state.writes).toHaveLength(0);
});


test('Sniper and CAM V family navigation restores service views and exact saved-resource access',async({page},info)=>{
 const {frame,state}=await mount(page,{nativeOverview:true,accessCase:true});
 await expect(frame.locator('.camera-overview-card')).toHaveCount(3);await expect(frame.locator('.camera-unit-kpis button b')).toHaveText(['—','—','—','—']);
 await frame.getByLabel('Camera Health unit filter').selectOption('provider-online');await expect(frame.locator('.camera-overview-card')).toHaveCount(1);
 await frame.getByLabel('Camera Health equipment family').selectOption('sniper');await expect(frame.getByLabel('Camera Health unit filter')).toHaveValue('all');await expect(frame.locator('.camera-overview-card')).toHaveCount(1);await expect(frame.locator('.camera-overview-card')).toContainText('SNIPER 2 005');
 await frame.getByLabel('Camera Health unit filter').selectOption('service');await expect(frame.locator('.camera-overview-card')).toHaveCount(1);await expect(frame.locator('.camera-overview-card .camera-status-pill')).toHaveText('IP / PORT ONLINE');await expect(frame.locator('.camera-overview-card .camera-status-pill')).toHaveCSS('color','rgb(43, 255, 53)');await frame.locator('.camera-overview-card').screenshot({path:info.outputPath('sniper-restored-online-card.png')});
 await frame.locator('.camera-overview-card .camera-card-main').click();const dialog=frame.getByRole('dialog',{name:'Camera Health unit details'});await expect(dialog.getByRole('link',{name:'Open saved IP / ports'})).toHaveAttribute('href','../../camera-detail.html?id=101');await expect(dialog).toContainText('Camera channel status unavailable');
 await page.keyboard.press('Escape');await expect(frame.locator('.camera-overview-card .camera-card-main')).toBeFocused();
 await frame.getByLabel('Camera Health equipment family').selectOption('camv');await frame.getByLabel('Camera Health unit filter').selectOption('all');await expect(frame.locator('.camera-overview-card')).toHaveCount(2);await frame.getByLabel('Camera Health unit filter').selectOption('service-failed');await expect(frame.locator('.camera-overview-card')).toHaveCount(1);await expect(frame.locator('.camera-overview-card')).toContainText('CAM V 002');await expect(frame.locator('.camera-overview-card .camera-status-pill')).toHaveText('IP / PORT OFFLINE');await expect(frame.locator('.camera-overview-card .camera-status-pill')).toHaveCSS('color','rgb(255, 39, 52)');
 await frame.locator('.camera-overview-card .camera-card-main').click();await expect(dialog.getByRole('link',{name:'Open saved IP / ports'})).toHaveAttribute('href','../../camera-detail.html?id=102');await dialog.getByRole('button',{name:'Back to units'}).click();
 await frame.getByLabel('Camera Health unit filter').selectOption('all');await frame.getByLabel('Search Camera Health units').fill('003');await expect(frame.locator('.camera-overview-card')).toHaveCount(1);await expect(frame.locator('.camera-overview-card')).toContainText('Service status unverified');await frame.locator('.camera-overview-card .camera-card-main').click();await expect(dialog.getByRole('link',{name:'Open saved IP / ports'})).toHaveAttribute('href','../../camera-detail.html?id=103');
 expect(state.writes).toHaveLength(0);
});


test('imported tracker families stay visible and colored without inventing map coordinates',async({page})=>{
 const {frame,state}=await mount(page,{trackerCase:true});
 await expect(frame.locator('.cos-fleet-unit-row')).toHaveCount(3);await expect(frame.locator('.cos-field-pin')).toHaveCount(0);
 await expect(frame.locator('.cos-fleet-unit-row').filter({hasText:'Sniper 2 344'})).toContainText('IP / PORT ONLINE');await expect(frame.locator('.cos-fleet-unit-row').filter({hasText:'CAMV 010'})).toContainText('IP / PORT OFFLINE');
 await revealMapFilters(frame); await frame.getByLabel('Fleet status').selectOption('online');await expect(frame.locator('.cos-fleet-unit-row')).toHaveCount(1);await revealMapFilters(frame); await frame.getByLabel('Fleet status').selectOption('all');
 const child=page.frames().find(f=>f.parentFrame());await child.evaluate(()=>location.hash='camera-health?diagnostics=1');await frame.getByLabel('Camera Health unit filter').selectOption('all');await expect(frame.locator('.camera-overview-card')).toHaveCount(3);
 await frame.getByLabel('Camera Health equipment family').selectOption('sniper');await frame.getByLabel('Camera Health unit filter').selectOption('all');await expect(frame.locator('.camera-overview-card')).toHaveCount(2);await frame.locator('.camera-overview-card').filter({hasText:'Sniper 334'}).locator('.camera-card-main').click();
 const detail=frame.getByRole('dialog',{name:'Camera Health unit details'});await expect(detail).toContainText('IP / PORT UNKNOWN');await expect(detail.getByRole('link',{name:'Find unit in Camera Health diagnostics'})).toHaveAttribute('href','../../camera-health.html?q=Sniper%20334');expect(state.writes).toHaveLength(0);
});

test('native card quick actions expose safe endpoints, exact field identity and separate timestamps',async({page},info)=>{
 const {frame,state}=await mount(page,{nativeOverview:true,accessCase:true});const card=frame.locator('.camera-overview-card').filter({hasText:'SNIPER 2 005'});
 await expect(card.locator('.camera-card-main')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 await expect(card.getByRole('link',{name:'Open 203.0.113.12 ↗',exact:true})).toHaveAttribute('href','http://203.0.113.12');
 await expect(card.getByRole('link',{name:'Open 203.0.113.12:443 ↗',exact:true})).toHaveAttribute('href','https://203.0.113.12');
 await expect(card.locator('a[href*="554"],a[href*="38880"]')).toHaveCount(0);
 await expect(card.getByRole('link',{name:'Edit IP address',exact:true})).toHaveAttribute('href','../../camera-detail.html?id=101&action=edit-ip');
 await expect(card.getByRole('link',{name:'Edit field information',exact:true})).toHaveAttribute('href','../../camera-health.html?unit=SNIPER%202%20005&action=edit-field');
 await expect(card.getByRole('link',{name:'Fleet Dashboard',exact:true})).toHaveAttribute('href','../../?fieldUnit=SNIPER%202%20005');
 await expect(card.locator('.camera-card-times')).toContainText('Last successful connection');await expect(card.locator('.camera-card-times')).toContainText('No successful connection recorded');await expect(card.locator('.camera-card-times')).toContainText('Last check attempted');
 await card.locator('.camera-card-main').focus();await page.keyboard.press('Enter');await expect(frame.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(card.locator('.camera-card-main')).toBeFocused();
 expect(state.writes).toHaveLength(0);const overflow=await frame.locator('body').evaluate(el=>el.scrollWidth>innerWidth+1);expect(overflow).toBe(false);await page.screenshot({path:info.outputPath('camera-card-quick-actions.png'),fullPage:true});
});

test('compact clusters expose every colocated unit and support equipment has no false camera outage',async({page},info)=>{
 const {frame,state}=await mount(page,{crowded:true});await expect(frame.locator('.cos-field-pin')).toHaveCount(3);await expandGroup(frame,3);await frame.locator('.cos-field-pin-support').click();await expect(frame.locator('.cos-fleet-drawer>h2')).toHaveText('Solar Stand 72 044');await expect(frame.getByRole('region',{name:'Selected unit camera health'})).toContainText('SUPPORT EQUIPMENT · 0 CAMERAS');await closeUnit(frame);await frame.getByLabel('Fleet status').selectOption('support');await expect(frame.locator('.cos-fleet-unit-row')).toHaveCount(1);await expect(frame.locator('.cos-field-pin-support')).toHaveCount(1);await frame.getByRole('button',{name:'Fullscreen fleet map',exact:true}).click();await expect(frame.locator('.cos-fleet-unit-list')).not.toBeVisible();await expect(frame.locator('.cos-fleet-map-canvas')).toBeVisible();await frame.getByRole('button',{name:'Exit fullscreen fleet map',exact:true}).click();expect(state.writes).toHaveLength(0);
});


test('plain status circles expand colocated cameras and blue solar stands',async({page},info)=>{
 const {frame,state}=await mount(page,{crowded:true});await expect(frame.locator('.cos-field-cluster')).toHaveCount(0);await expandGroup(frame,3);await expect(frame.locator('.cos-map-status-dot')).toHaveCount(3);await expect(frame.locator('.cos-reticle-approved-eye,.cos-reticle-solar-panel')).toHaveCount(0);await expect(frame.locator('.cos-pin-unit-number')).toHaveText(['51','52','044']);for(const [status,color] of [['online','rgb(43, 255, 53)'],['offline','rgb(255, 39, 52)'],['support','rgb(21, 168, 255)']])await expect(frame.locator('.cos-field-pin[data-health="'+status+'"] .cos-reticle-artwork')).toHaveCSS('color',color);await expect.poll(()=>readablePins(frame)).toBe(true);await frame.locator('.cos-fleet-map-panel').screenshot({path:info.outputPath('plain-status-circles-expanded.png')});await page.clock.fastForward(16*60*1000);await expect(frame.locator('.cos-field-pin[data-health="unknown"]')).toHaveCount(2);await expect(frame.locator('.cos-field-pin-support')).toHaveCount(1);expect(state.writes).toHaveLength(0);
});


test('HTML-like imported unit and site names stay literal text in map labels',async({page})=>{
 const {frame,state}=await mount(page,{htmlLabel:true});await frame.locator('.cos-fleet-unit-row').first().click();await expect(frame.locator('.cos-field-pin-wrap').first()).toHaveAttribute('title',/<img src=x/);
 await expect(frame.locator('.cos-fleet-unit-list')).toContainText('Site <b>literal</b>');await expect(frame.locator('.cos-fleet-drawer')).toContainText('100 <img src=x');
 await expect(frame.locator('img[src="x"]')).toHaveCount(0);expect(await frame.locator('body').evaluate(()=>Boolean(window.mapLabelExecuted||window.mapAddressExecuted))).toBe(false);expect(state.writes).toHaveLength(0);
});


test('larger shared sites keep all nine unit markers and the stand selectable',async({page},info)=>{
 const {frame,state}=await mount(page,{crowded:true,crowdedCount:9});await expandGroup(frame,9);expect(await frame.locator('.cos-field-pin-wrap').evaluateAll(nodes=>nodes.map(node=>node.dataset.unitId).sort())).toEqual(state.units.map(unit=>unit.id).sort());await expect.poll(()=>readablePins(frame)).toBe(true);await frame.locator('.cos-field-pin-support').click();await expect(frame.locator('.cos-fleet-drawer>h2')).toHaveText('Solar Stand 72 044');await closeUnit(frame);await frame.getByRole('button',{name:'Fullscreen fleet map',exact:true}).click();await expect.poll(()=>readablePins(frame)).toBe(true);await frame.locator('.cos-fleet-map-panel').screenshot({path:info.outputPath('nine-unit-expanded-map.png')});await frame.getByRole('button',{name:'Exit fullscreen fleet map',exact:true}).click();expect(state.writes).toHaveLength(0);
});


test('closing a shared-site popup restores its auto-pan but preserves a subsequent user pan',async({page},info)=>{
 const {frame,state}=await mount(page,{crowded:true});await expandGroup(frame,3);await page.clock.runFor(600);const center=()=>frame.locator('body').evaluate(()=>history.state.cosFieldMapView.center);const before=await center();await expect(frame.locator('.cos-field-cluster-wrap')).toHaveCount(0);await expect(frame.locator('.cos-field-pin')).toHaveCount(3);expect(await center()).toEqual(before);const box=await frame.locator('.cos-fleet-map-canvas').boundingBox();await page.mouse.move(box.x+box.width-10,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width-55,box.y+box.height/2+25,{steps:8});await page.mouse.up();await page.clock.runFor(600);const panned=await center();expect(panned).not.toEqual(before);await expandGroup(frame,3);expect(await center()).toEqual(panned);expect(state.writes).toHaveLength(0);
});


test('filtering away an open cluster discards its old popup-pan snapshot',async({page},info)=>{
 const {frame,state}=await mount(page,{crowded:true});await expandGroup(frame,3);await frame.getByLabel('Fleet status').selectOption('support');await expect(frame.locator('.cos-field-pin-support')).toHaveCount(1);await expect(frame.locator('.cos-field-cluster-wrap')).toHaveCount(0);const center=()=>frame.locator('body').evaluate(()=>history.state.cosFieldMapView.center);await frame.locator('.cos-field-pin-support').click();await closeUnit(frame);const before=await center();await frame.getByRole('button',{name:/Refresh data/}).click();await expect.poll(center).toEqual(before);expect(state.writes).toHaveLength(0);
});


test('zoom alone exposes twelve same-site statuses and blue support without opening a group',async({page},info)=>{
 const {frame,state}=await mount(page,{crowded:true,crowdedCount:12,mixedCrowd:true});await expect(frame.locator('.cos-field-pin')).toHaveCount(12);await frame.locator('.leaflet-control-zoom-out').click();await expect(frame.locator('.cos-field-pin')).toHaveCount(12);await expandGroup(frame,12);expect(await frame.locator('.cos-field-pin-wrap').evaluateAll(nodes=>nodes.map(node=>node.dataset.unitId).sort())).toEqual(state.units.map(unit=>unit.id).sort());await expect(frame.locator('.cos-field-pin[data-health="online"]')).toHaveCount(1);await expect(frame.locator('.cos-field-pin[data-health="offline"]')).toHaveCount(1);await expect(frame.locator('.cos-field-pin[data-health="unknown"]')).toHaveCount(9);await expect(frame.locator('.cos-field-pin-support')).toHaveCount(1);await expect.poll(()=>readablePins(frame)).toBe(true);await frame.locator('.cos-fleet-map-panel').screenshot({path:info.outputPath('twelve-unit-expanded-map.png')});expect(state.writes).toHaveLength(0);
});


test('automatically separated adjacent sites do not cover each other',async({page},info)=>{
 const {frame,state}=await mount(page,{crowded:true,crowdedCount:12,mixedCrowd:true,nearbyCrowd:true});await frame.getByRole('button',{name:'Fullscreen fleet map',exact:true}).click();await expect(frame.locator('.cos-field-cluster-wrap')).toHaveCount(0);await expandGroup(frame,15);await expect.poll(()=>readablePins(frame)).toBe(true);await frame.locator('.cos-fleet-map-panel').screenshot({path:info.outputPath('adjacent-sites-expanded-map.png')});await frame.getByRole('button',{name:'Exit fullscreen fleet map',exact:true}).click();expect(state.writes).toHaveLength(0);
});


test('ordinary ST stands stay blue and outside camera-health totals alongside colocated cameras',async({page},info)=>{
 const {frame,state}=await mount(page,{crowded:true,ordinaryStand:true});await expandGroup(frame,3);const stand=frame.locator('.cos-field-pin-support');await expect(stand.locator('.cos-pin-unit-number')).toHaveText('001');await expect(stand.locator('.cos-reticle-artwork')).toHaveCSS('color','rgb(21, 168, 255)');await expect(frame.locator('.cos-fleet-count-note')).toContainText('1 support units have 0 cameras');await stand.click();await expect(frame.locator('.cos-fleet-drawer>h2')).toHaveText('ST 001');await expect(frame.getByRole('region',{name:'Selected unit camera health'})).toContainText('SUPPORT EQUIPMENT · 0 CAMERAS');expect(state.writes).toHaveLength(0);
});


test('changing the health filter excludes a previously selected unit with another status',async({page})=>{
 const {frame,state}=await mount(page);await frame.locator('.cos-fleet-unit-row').filter({hasText:'Solar Spotter 52'}).click();await closeUnit(frame);await revealMapFilters(frame);await frame.getByLabel('Fleet status').selectOption('online');await expect(frame.locator('.cos-fleet-unit-row')).toHaveCount(1);await expect(frame.locator('.cos-fleet-unit-row')).toContainText('Solar Spotter 51');await expect(frame.locator('.cos-field-pin[data-health="offline"]')).toHaveCount(0);expect(state.writes).toEqual([]);
});

// Regression: legend reflow can change the canvas height by an odd number of
// pixels. Preserve the exact geographic view, including a later manual pan.
test('cluster reflow and odd-sized canvas resizes retain exact user center and zoom',async({page})=>{
 const {frame,state}=await mount(page,{crowded:true,pausedClock:true});
 const canvas=frame.locator('.cos-fleet-map-canvas');
 const cluster=frame.locator('.cos-field-cluster-wrap');
 const view=()=>frame.locator('body').evaluate(()=>({center:history.state.cosFieldMapView.center,zoom:history.state.cosFieldMapView.zoom}));
 await expect(cluster).toHaveCount(0);
 const initial=await view();
 for(let cycle=0;cycle<3;cycle++){
  await expandGroup(frame,3);await page.clock.runFor(600);
  expect(await view()).toEqual(initial);
  await expect(frame.locator('.cos-field-pin')).toHaveCount(3);await page.clock.runFor(600);
  expect(await view()).toEqual(initial);
 }
 const box=await canvas.boundingBox();
 await page.mouse.move(box.x+box.width-10,box.y+box.height/2);await page.mouse.down();
 await page.mouse.move(box.x+box.width-55,box.y+box.height/2+25,{steps:8});await page.mouse.up();await page.clock.runFor(600);
 const panned=await view();expect(panned.center).not.toEqual(initial.center);
 await expandGroup(frame,3);await page.clock.runFor(600);expect(await view()).toEqual(panned);
 const size=await canvas.evaluate(element=>({width:element.clientWidth,height:element.clientHeight}));
 for(const [width,height] of [[size.width-1,size.height+1],[size.width,size.height],[size.width-1,size.height],[size.width,size.height+1],[size.width,size.height]]){
  await canvas.evaluate((element,{width,height})=>{element.style.flex='none';element.style.width=width+'px';element.style.height=height+'px';},{width,height});
  await expect.poll(()=>canvas.evaluate(element=>({width:element.clientWidth,height:element.clientHeight}))).toEqual({width,height});
  await page.clock.runFor(600);expect(await view()).toEqual(panned);
  await expect(cluster).toHaveCount(0);await expect(frame.locator('.cos-field-pin')).toHaveCount(3);
 }
 await frame.getByRole('button',{name:'Fit pins',exact:true}).click();await page.clock.runFor(600);
 const fitted=await view();expect(fitted.center).not.toEqual(panned.center);
 await expect(cluster).toHaveCount(0);
 await canvas.evaluate(element=>{element.style.removeProperty('flex');element.style.removeProperty('width');element.style.removeProperty('height');});
 await page.clock.runFor(600);expect(await view()).toEqual(fitted);
 expect(state.writes).toHaveLength(0);
});

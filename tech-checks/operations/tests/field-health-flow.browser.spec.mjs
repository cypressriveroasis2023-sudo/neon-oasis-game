import {test,expect} from '@playwright/test';
import {port,snapshot,resource} from './fixtures/camera-evidence-fixtures.mjs';
const origin='http://127.0.0.1:4173';
const id='11111111-1111-4111-8111-111111111111',id2='22222222-2222-4222-8222-222222222222',id3='33333333-3333-4333-8333-333333333333',site='44444444-4444-4444-8444-444444444444',customer='55555555-5555-4555-8555-555555555555';
const now='2026-10-06T18:00:00Z',fresh='2026-10-06T17:55:00Z';
async function mount(page,{historical=false,ambiguous=false,oldApi=false,nativeOverview=false,evidenceCase=false,scopeCase=false,accessCase=false}={}){
 const state={writes:[],requests:[],fail:false};
 const base={status:'installed',currentLocationType:'site',modelName:'Solar Spotter',address:'100 Fixture Road',site:'Synthetic site',customer:'Synthetic customer',installedSiteId:site,latitude:29.76,longitude:-95.37,locationVerification:'owner_verified',gpsRecordedAt:fresh,locationVerifiedAt:fresh,coordinateSource:'site',hasUnitGps:true};
 state.units=[{...base,id,unitNumber:'Solar Spotter 51'}, {...base,id:id2,unitNumber:'Solar Spotter 52',latitude:29.79}, {...base,id:id3,unitNumber:'Solar Spotter 53',latitude:29.82}];
 if(historical)state.units[0]={...state.units[0],locationVerification:undefined,readOnly:true};
 if(ambiguous)state.units[1].unitNumber='SOLAR SPOTTER 051';
 let rows=state.units.map((u,i)=>resource(i+1,'SOLARSPOTTER '+(51+i),{name:'Fixture camera '+(i+1),status:i===1?'offline':'online',checkedAt:fresh,...(!oldApi?{evidence:{kind:'provider',source:'Star4Live',resource:'camera',active:true,status:i===1?'offline':'online',observedAt:i===2?'2026-10-06T16:00:00Z':fresh,lastOnlineAt:fresh}}:{evidence:undefined})}));
 if(evidenceCase)rows=[resource(1,'SOLARSPOTTER 51',{name:'Fixture recorder',type:'NVR'}),resource(2,'SOLARSPOTTER 52',{name:'Fixture service unit',type:'Sniper',serviceEvidence:port()}),resource(3,'SOLARSPOTTER 53',{name:'Fixture Recon detector',type:'detector',evidence:{kind:'provider',source:'Reconeyez',resource:'detector',active:true,status:'offline',observedAt:'2026-10-06T16:00:00Z',lastOnlineAt:'2026-10-05T12:00:00Z'}})];
 if(accessCase)rows=[resource(101,'SNIPER 2 005',{type:'Sniper 2',evidence:undefined,serviceEvidence:port()}),resource(102,'CAM V 002',{type:'CAMV',evidence:undefined,serviceEvidence:port({status:'offline',reachable:false,confirmedOutage:true})}),resource(103,'CAM V 003',{type:'CAMV',evidence:undefined,serviceEvidence:port({status:'unknown',reachable:null})})];
 if(scopeCase)rows=rows.map((row,i)=>({...row,scope:['unknown','shop','inactive'][i],activationState:i===2?'deactivated':'active'}));
 const health={...snapshot(rows),...(oldApi?{evidenceVersion:1,inventory:undefined}:{})};

 await page.clock.install({time:new Date(now)});
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url===origin+'/field-health-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe src="/#${nativeOverview?'camera-health':'field-map'}"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-only'},location.origin)})</script>`});
  if(url.startsWith(origin+'/'))return route.continue();
  if(/^https:\/\/[abc]\.tile\.openstreetmap\.org\//.test(url))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#34495b"/></svg>'});
  if(!url.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();state.requests.push(request);if(request.method!=='GET'){state.writes.push(request);return route.fulfill({status:400,headers,body:JSON.stringify({error:'Synthetic writes disabled'})});}
  if(request.path==='/api/camera-health/summary-v2'&&state.fail)return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:'Synthetic provider unavailable'})});
  const data=request.path==='/api/session'?{authorized:true,name:'Fixture Owner',role:'Owner',features:{mhelpTicketImport:true,fieldLocationVerification:true}}
    :request.path==='/api/field-map'?{items:state.units,summary:{fieldUnits:3,mappedUnits:3,unitGps:3,missingGps:0},generatedAt:now}
    :request.path==='/api/camera-health/summary-v2'?health
    :request.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:now}
    :request.path==='/api/equipment'?{items:state.units,models:[]}
    :request.path==='/api/customers'?{items:[{id:customer,name:'Synthetic customer',status:'active'}]}
    :request.path==='/api/sites'?{items:[{id:site,name:'Synthetic site',status:'active',customerId:customer,customer:'Synthetic customer'}]}
    :request.path==='/api/owner/control-data'?{sites:[{id:site,name:'Synthetic site',customer_id:customer,customers:{name:'Synthetic customer'}}],truckChecks:[],itTechnicians:[],serviceTechnicians:[]}
    :request.path==='/api/daily-board'?{jobs:[],tasks:[],readiness:[],asOf:now}:{items:[]};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/field-health-fixture');const frame=page.frameLocator('iframe');if(nativeOverview)await expect(frame.locator('.camera-overview-card')).toHaveCount(scopeCase?1:3);else await expect(frame.locator('.field-map-list>button')).toHaveCount(3);return {frame,state};
}
test('provider colors, nearby center and unit health ticket draft stay on the selected identity',async({page},testInfo)=>{
 const {frame,state}=await mount(page);
 await expect(frame.locator('.cos-field-pin')).toHaveCount(3);
 await expect(frame.locator('.cos-field-pin').nth(0)).toHaveCSS('background-color','rgb(53, 212, 138)');await expect(frame.locator('.cos-field-pin').nth(1)).toHaveCSS('background-color','rgb(255, 115, 125)');await expect(frame.locator('.cos-field-pin').nth(2)).toHaveCSS('background-color','rgb(148, 163, 184)');
 await frame.getByLabel('Nearby unit center').selectOption(id);await expect(frame.getByLabel('Nearby distance')).toBeVisible();await expect(frame.locator('.field-map-list>button')).toHaveCount(3);
 await frame.locator('.field-map-center').scrollIntoViewIfNeeded();await frame.locator('.cos-field-pin').nth(1).click();await expect(frame.getByRole('region',{name:'Selected field unit Camera Health'})).toContainText('Solar Spotter 52');await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#camera-health?unit='+id2);
 await expect(frame.locator('.camera-unit-state')).toHaveText('Camera outage observed');await frame.getByLabel('Camera unit ticket type').selectOption('PICKUP');await frame.getByRole('button',{name:'Create ticket',exact:true}).click();
 await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#daily-board?create=PICKUP&unit='+id2);
 await expect(frame.getByLabel('Title',{exact:true})).toHaveValue(/Solar Spotter 52/);await expect(frame.locator('.owner-board-controls')).toContainText('Synthetic customer');await expect(frame.locator('.owner-board-controls')).toContainText('does not assign equipment');
 await frame.getByRole('button',{name:'Back to unit health',exact:true}).click();await expect(frame.locator('.camera-unit-detail h3')).toHaveText('Solar Spotter 52');await frame.getByRole('button',{name:'Back to Field Map',exact:true}).click();await expect(frame.locator('.field-map-detail h2')).toHaveText('Solar Spotter 52');
 await page.screenshot({path:testInfo.outputPath('field-camera-flow.png')});expect(state.writes).toHaveLength(0);
});
test('staleness and unavailable health fail gray without moving map or writing',async({page})=>{
 const {frame,state}=await mount(page);await expect(frame.locator('.cos-field-pin').first()).toHaveCSS('background-color','rgb(53, 212, 138)');
 await frame.locator('.leaflet-control-zoom-in').click();const transform=await frame.locator('.leaflet-map-pane').getAttribute('style');await page.clock.fastForward(16*60*1000);await expect(frame.locator('.cos-field-pin').first()).toHaveCSS('background-color','rgb(148, 163, 184)');expect(await frame.locator('.leaflet-map-pane').getAttribute('style')).toBe(transform);
 state.fail=true;await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect(frame.getByRole('alert')).toContainText('Camera Health unavailable');expect(state.writes).toHaveLength(0);
});
test('historical coordinates are opt-in dashed review only, never nearby or falsely current',async({page})=>{
 const {frame,state}=await mount(page,{historical:true});await expect(frame.locator('.cos-field-pin')).toHaveCount(2);await expect(frame.getByLabel('Nearby unit center').locator('option[value="'+id+'"]')).toHaveCount(0);
 await frame.getByLabel('Review unverified historical locations').check();await expect(frame.locator('.cos-field-pin')).toHaveCount(3);await expect(frame.locator('.cos-field-pin-historical')).toContainText('OLD');
 await frame.getByLabel('Nearby unit center').selectOption(id2);await expect(frame.locator('.cos-field-pin-historical')).toHaveCount(0);await expect(frame.getByLabel('Review unverified historical locations')).toBeDisabled();expect(state.writes).toHaveLength(0);
});
test('old backend evidence and ambiguous identities stay gray',async({page})=>{const {frame}=await mount(page,{oldApi:true,ambiguous:true});for(const pin of await frame.locator('.cos-field-pin').all())await expect(pin).toHaveCSS('background-color','rgb(148, 163, 184)');});
test('pasted address pin is an unsaved candidate; moving it clears confirmation',async({page})=>{
 const {frame,state}=await mount(page);await frame.locator('.field-map-list>button').first().click();await frame.getByLabel('Paste coordinates or a Google Maps point link').fill('30.01, -95.41');await frame.getByRole('button',{name:'Use pasted coordinates',exact:true}).click();await expect(frame.getByLabel('Latitude',{exact:true})).toHaveValue('30.01');await expect(frame.getByLabel('Location source',{exact:true})).toHaveValue('site');await expect(frame.getByRole('button',{name:'Save verified location',exact:true})).toBeDisabled();await frame.getByRole('checkbox',{name:/I checked/}).check();await expect(frame.getByRole('button',{name:'Save verified location',exact:true})).toBeEnabled();await frame.getByLabel('Latitude',{exact:true}).fill('30.02');await expect(frame.getByRole('button',{name:'Save verified location',exact:true})).toBeDisabled();expect(state.writes).toHaveLength(0);
});

test('Back and Forward retain map filters, nearby center and selected unit',async({page})=>{
 const {frame,state}=await mount(page);await frame.getByLabel('Search field units').fill('Solar');await frame.getByLabel('Nearby unit center').selectOption(id);await frame.getByLabel('Nearby distance').selectOption('25');await frame.locator('.field-map-center').scrollIntoViewIfNeeded();await frame.locator('.cos-field-pin').nth(1).click();await expect(frame.locator('.camera-unit-detail h3')).toHaveText('Solar Spotter 52');await frame.getByRole('button',{name:'Back to Field Map',exact:true}).click();await expect(frame.getByLabel('Search field units')).toHaveValue('Solar');await expect(frame.getByLabel('Nearby unit center')).toHaveValue(id);await expect(frame.getByLabel('Nearby distance')).toHaveValue('25');await expect(frame.locator('.field-map-detail h2')).toHaveText('Solar Spotter 52');await frame.locator('body').evaluate(()=>history.forward());await expect(frame.locator('.camera-unit-detail h3')).toHaveText('Solar Spotter 52');expect(state.writes).toHaveLength(0);
});

test('native Camera Health shows units and individual cameras separately with filter and accessible drill-down',async({page},testInfo)=>{
 const {frame,state}=await mount(page,{nativeOverview:true});
 const stats=frame.locator('.camera-unit-kpis');await expect(stats.locator('button b')).toHaveText(['3','1','1','1']);await expect(stats.locator('.camera-status-online')).toHaveCSS('color','rgb(53, 212, 138)');await expect(stats.locator('.camera-status-offline')).toHaveCSS('color','rgb(255, 115, 125)');await expect(frame.locator('.camera-actual-count>b')).toHaveText('3');await expect(frame.locator('.camera-record-breakdown')).toContainText('Reported camera records');
 await stats.getByRole('button',{name:/Provider systems offline/}).click();await expect(frame.locator('.camera-overview-card')).toHaveCount(1);const card=frame.locator('.camera-overview-card');await expect(card).toContainText('SOLARSPOTTER 52');await card.click();const detail=frame.getByRole('dialog',{name:'Camera Health unit details'});await expect(detail).toContainText('Fixture camera 2');await expect(detail.locator('.camera-device-cards article')).toHaveCount(1);await page.keyboard.press('Escape');await expect(detail).toHaveCount(0);await expect(card).toBeFocused();await card.click();await detail.getByRole('button',{name:'Back to units',exact:true}).click();await expect(detail).toHaveCount(0);await frame.getByLabel('Camera Health unit filter').selectOption('all');await frame.getByLabel('Search Camera Health units').fill('53');await expect(frame.locator('.camera-overview-card')).toHaveCount(1);await expect(frame.locator('.camera-overview-card')).toContainText('SYSTEM NOT VERIFIED');await frame.getByLabel('Search Camera Health units').fill('');await frame.locator('body').evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:testInfo.outputPath('camera-health-unit-overview.png'),fullPage:true});await frame.locator('.camera-record-breakdown summary').click();await frame.locator('.camera-record-breakdown').evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:testInfo.outputPath('camera-health-reconciliation.png'),fullPage:true});expect(state.writes).toHaveLength(0);
});
test('native unit details can open Install Delivery draft without guessing record identity',async({page})=>{
 const {frame,state}=await mount(page,{nativeOverview:true});await frame.locator('.camera-overview-card').filter({hasText:'SOLARSPOTTER 52'}).click();const detail=frame.getByRole('dialog',{name:'Camera Health unit details'});await detail.getByLabel('Unit detail ticket type').selectOption('DELIVERY');await detail.getByRole('button',{name:'Create ticket',exact:true}).click();await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#daily-board?create=DELIVERY&unit='+id2);await expect(frame.getByLabel('Title',{exact:true})).toHaveValue(/Solar Spotter 52/);expect(state.writes).toHaveLength(0);
});


test('unified Dispatch Board preserves import access without mixing a unit ticket context',async({page})=>{
 const {frame,state}=await mount(page);
 await frame.locator('.field-map-center').scrollIntoViewIfNeeded();
 await frame.locator('.cos-field-pin').nth(1).click();
 await frame.getByRole('button',{name:'Create ticket',exact:true}).click();
 await expect(frame.getByLabel('Title',{exact:true})).toHaveValue(/Solar Spotter 52/);
 await expect(frame.getByRole('region',{name:'mHelpDesk ticket import',exact:true})).toHaveCount(0);
 await frame.getByRole('button',{name:'Back to unit health',exact:true}).click();
 await expect(frame.locator('.camera-unit-detail h3')).toHaveText('Solar Spotter 52');
 const child=page.frames().find(child=>child.parentFrame());
 await child.evaluate(()=>{location.hash='daily-board';});
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
 await expect(frame.locator('.camera-unit-kpis button b')).toHaveText(['3','1','0','2']);
 const recorder=frame.locator('.camera-overview-card').filter({hasText:'SOLARSPOTTER 51'});
 await expect(recorder).toContainText('RECORDER ONLINE');await expect(recorder).toContainText('Camera channel status unavailable');
 await frame.getByLabel('Camera Health unit filter').selectOption('service');await expect(frame.locator('.camera-overview-card')).toHaveCount(1);await expect(frame.locator('.camera-overview-card')).toContainText('IP / PORT ONLINE');await expect(frame.locator('.camera-overview-card')).toContainText('Camera channel status unavailable');
 await frame.getByLabel('Camera Health unit filter').selectOption('all');await frame.locator('.camera-overview-card').filter({hasText:'SOLARSPOTTER 53'}).click();
 const detail=frame.getByRole('dialog',{name:'Camera Health unit details'});await expect(detail).toContainText('DETECTOR NOT VERIFIED');await expect(detail).toContainText('Last reported detector state: OFFLINE');await expect(detail).toContainText('2 hr ago');await expect(detail).toContainText('older observation; current status unverified');await detail.getByRole('button',{name:'Back to units',exact:true}).click();
 const child=page.frames().find(child=>child.parentFrame());await child.evaluate(()=>{location.hash='field-map';});await expect(frame.locator('.cos-field-pin')).toHaveCount(3);for(const pin of await frame.locator('.cos-field-pin').all())await expect(pin).toHaveCSS('background-color','rgb(148, 163, 184)');
 await frame.locator('.field-map-list>button').filter({hasText:'Solar Spotter 51'}).click();await expect(frame.getByRole('region',{name:'Selected unit camera health'})).toContainText('RECORDER ONLINE');expect(state.writes).toHaveLength(0);
});

test('native location review stays visible while shop and inactive scopes reconcile separately',async({page})=>{
 const {frame,state}=await mount(page,{nativeOverview:true,scopeCase:true});
 await expect(frame.locator('.camera-unit-kpis button b')).toHaveText(['1','1','0','0']);await expect(frame.locator('.camera-overview-card')).toContainText('LOCATION REVIEW');
 await frame.getByLabel('Camera Health unit filter').selectOption('shop');await expect(frame.locator('.camera-overview-card')).toHaveCount(1);await expect(frame.locator('.camera-overview-card')).toContainText('SHOP / ROOT');
 await frame.getByLabel('Camera Health unit filter').selectOption('inactive');await expect(frame.locator('.camera-overview-card')).toHaveCount(1);await expect(frame.locator('.camera-overview-card')).toContainText('INACTIVE');
 await frame.locator('.camera-record-breakdown summary').click();await expect(frame.locator('.camera-record-breakdown')).toContainText('0 confirmed-field records + 1 shop/root records + 1 inactive records + 1 location-review records');expect(state.writes).toHaveLength(0);
});


test('Sniper and CAM V family navigation restores service views and exact saved-resource access',async({page},info)=>{
 const {frame,state}=await mount(page,{nativeOverview:true,accessCase:true});
 await expect(frame.locator('.camera-overview-card')).toHaveCount(3);await expect(frame.locator('.camera-unit-kpis button b')).toHaveText(['3','0','0','3']);
 await frame.getByLabel('Camera Health unit filter').selectOption('online');await expect(frame.locator('.camera-overview-card')).toHaveCount(0);
 await frame.getByLabel('Camera Health equipment family').selectOption('sniper');await expect(frame.getByLabel('Camera Health unit filter')).toHaveValue('all');await expect(frame.locator('.camera-overview-card')).toHaveCount(1);await expect(frame.locator('.camera-overview-card')).toContainText('SNIPER 2 005');
 await frame.getByLabel('Camera Health unit filter').selectOption('service');await expect(frame.locator('.camera-overview-card')).toHaveCount(1);await expect(frame.locator('.camera-overview-card .camera-status-pill')).toHaveText('IP / PORT ONLINE');await expect(frame.locator('.camera-overview-card .camera-status-pill')).toHaveCSS('color','rgb(53, 212, 138)');await frame.locator('.camera-overview-card').screenshot({path:info.outputPath('sniper-restored-online-card.png')});
 await frame.locator('.camera-overview-card').click();const dialog=frame.getByRole('dialog',{name:'Camera Health unit details'});await expect(dialog.getByRole('link',{name:'Open saved IP / ports'})).toHaveAttribute('href','../../camera-detail.html?id=101');await expect(dialog).toContainText('Camera channel status unavailable');
 await page.keyboard.press('Escape');await expect(frame.locator('.camera-overview-card')).toBeFocused();
 await frame.getByLabel('Camera Health equipment family').selectOption('camv');await expect(frame.locator('.camera-overview-card')).toHaveCount(2);await frame.getByLabel('Camera Health unit filter').selectOption('service-failed');await expect(frame.locator('.camera-overview-card')).toHaveCount(1);await expect(frame.locator('.camera-overview-card')).toContainText('CAM V 002');await expect(frame.locator('.camera-overview-card .camera-status-pill')).toHaveText('IP / PORT OFFLINE');await expect(frame.locator('.camera-overview-card .camera-status-pill')).toHaveCSS('color','rgb(255, 115, 125)');
 await frame.locator('.camera-overview-card').click();await expect(dialog.getByRole('link',{name:'Open saved IP / ports'})).toHaveAttribute('href','../../camera-detail.html?id=102');await dialog.getByRole('button',{name:'Back to units'}).click();
 await frame.getByLabel('Camera Health unit filter').selectOption('all');await frame.getByLabel('Search Camera Health units').fill('003');await expect(frame.locator('.camera-overview-card')).toHaveCount(1);await expect(frame.locator('.camera-overview-card')).toContainText('Service status unverified');await frame.locator('.camera-overview-card').click();await expect(dialog.getByRole('link',{name:'Open saved IP / ports'})).toHaveAttribute('href','../../camera-detail.html?id=103');
 expect(state.writes).toHaveLength(0);
});

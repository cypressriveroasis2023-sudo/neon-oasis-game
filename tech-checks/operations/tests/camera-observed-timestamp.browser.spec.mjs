import {test,expect} from '@playwright/test';
import {resource,port,snapshot,withStatus} from './fixtures/camera-evidence-fixtures.mjs';

test.use({timezoneId:'UTC',locale:'en-US'});
const origin='http://127.0.0.1:4173';
const now='2026-10-14T16:00:00Z',cameraAt='2026-10-14T15:45:00Z',portAt='2026-10-14T15:59:00Z';
const cameraTime='Oct 14, 2026, 3:45:00 PM UTC',portTime='Oct 14, 2026, 3:59:00 PM UTC';
const id=n=>`90000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const allowedReads=new Set(['/api/session','/api/field-map','/api/camera-health/summary-v3','/api/routers','/api/vrm-fleet']);

async function mount(page,status){
  const state={calls:[],errors:[],blockedExternal:[],unexpectedApi:[]};
  page.on('pageerror',error=>state.errors.push(error.message));
  await page.clock.setFixedTime(new Date(now));
  const units=[['Helios 901','Helios'],['Sniper 902','Sniper']].map(([unitNumber,modelName],index)=>({
    id:id(index+1),unitNumber,modelName,status:'field',currentLocationType:'field',placement:'FIELD',
    address:'123 Synthetic Street',customer:'Synthetic timestamp customer',site:'Synthetic timestamp site',
    latitude:29.7+index*.05,longitude:-95.4,coordinateSource:'site',locationVerification:'owner_verified',locationVerifiedAt:cameraAt,gpsRecordedAt:cameraAt,
  }));
  const service=outcome=>port({status:outcome,observedAt:portAt,reachable:outcome==='online',confirmedOutage:outcome==='offline',consecutiveFailures:outcome==='offline'?3:0});
  const rows=[
    withStatus(resource(901,units[0].unitNumber,{serviceEvidence:service('online')}),status,cameraAt),
    resource(902,units[1].unitNumber,{type:'Sniper',evidence:undefined,serviceEvidence:service(status)}),
  ];
  const health={...snapshot(rows),refreshedAt:now};
  await page.route('**/*',async route=>{
    const url=route.request().url();
    if(url===origin+'/camera-observed-timestamp-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe src="/#fleet-dashboard"></iframe><script>addEventListener('message',event=>{if(event.origin===location.origin&&event.data.type==='COS_OPERATIONS_TOKEN_REQUEST')event.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:event.data.requestId,role:'owner',accessToken:'synthetic-observation-time-only'},location.origin)})</script>`});
    if(url.startsWith(origin+'/'))return route.continue();
    if(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//.test(url))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#dce5df"/></svg>'});
    if(!url.endsWith('/functions/v1/cos-operations-pages')){state.blockedExternal.push(url);return route.abort('blockedbyclient');}
    const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,content-type'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    const request=route.request().postDataJSON();state.calls.push(request);
    // The authenticated API uses POST transport for GET envelopes. No fixture mutation is supported.
    if(request.method!=='GET')return route.fulfill({status:405,headers,json:{error:'This synthetic fixture supports read-only requests only.'}});
    if(!allowedReads.has(request.path)){state.unexpectedApi.push(request.path);return route.fulfill({status:404,headers,json:{error:'Unexpected synthetic API read.'}});}
    const data=request.path==='/api/session'?{authorized:true,name:'Synthetic timestamp owner',role:'Owner',legacyOwner:true,features:{fleetAccess:true,vrmRead:false}}:
      request.path==='/api/field-map'?{items:units,inventoryItems:units,summary:{fieldUnits:2,mappedUnits:2,unitGps:0,missingGps:0},generatedAt:now}:
      request.path==='/api/camera-health/summary-v3'?health:
      request.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:now}:
      request.path==='/api/vrm-fleet'?{items:[],power:[]}:{items:[]};
    return route.fulfill({headers,json:data});
  });
  await page.goto('/camera-observed-timestamp-fixture');
  const app=page.frameLocator('iframe');await expect(app.locator('.cos-fleet-unit-row')).toHaveCount(2);
  return {app,state,units};
}

for(const status of ['online','offline'])test(`${status} camera and port observations retain separate exact times across Fleet and Camera Health`,async({page},info)=>{
  const {app,state,units}=await mount(page,status);
  expect(await app.locator('body').evaluate(()=>({now:new Date(Date.now()).toISOString(),zone:Intl.DateTimeFormat().resolvedOptions().timeZone}))).toEqual({now:'2026-10-14T16:00:00.000Z',zone:'UTC'});
  await expect(app.locator('.cos-fleet-stat-field strong,.cos-fleet-stat-online strong,.cos-fleet-stat-offline strong,.cos-fleet-stat-unknown strong')).toHaveText(status==='online'?['2','2','0','0']:['2','0','2','0']);
  const scenarios=[
    {unit:units[0],basis:'camera/detector',time:cameraTime,label:status==='online'?'Camera records online':'Camera outage observed',service:'ONLINE'},
    {unit:units[1],basis:'IP / port',time:portTime,label:'IP / PORT '+status.toUpperCase(),service:status.toUpperCase()},
  ];
  for(const scenario of scenarios){
    const row=app.locator(`.cos-fleet-unit-row[data-unit-id="${scenario.unit.id}"]`);
    await expect(row).toContainText(scenario.label);await row.click();
    const drawer=app.getByRole('dialog',{name:scenario.unit.unitNumber+' unit intelligence'});
    const card=drawer.getByRole('region',{name:'Selected unit camera health'});
    await expect(card.locator('.camera-unit-state')).toHaveText(scenario.label);
    await expect(card.locator(':scope > small')).toHaveText(`Latest ${status} ${scenario.basis} record observation: ${scenario.time}`);
    if(scenario.basis==='camera/detector')await expect(card).not.toContainText(portTime);
    await expect(drawer.getByText(/^Latest source observation:/)).toContainText(scenario.time);
    const raw=drawer.locator('.camera-device-cards article');await expect(raw).toHaveCount(1);
    await expect(raw.locator('p').filter({hasText:'Last reported service result:'})).toContainText(`Last reported service result: ${scenario.service} · ${portTime}`);
    if(scenario.basis==='camera/detector')await expect(raw.locator('p').filter({hasText:cameraTime})).toContainText('15 min ago');
    else await expect(raw).toContainText('No verified provider camera/recorder observation.');
    await card.screenshot({path:info.outputPath(`fleet-${status}-${scenario.unit.unitNumber.replaceAll(' ','-')}-observation-time.png`)});
    await drawer.getByRole('button',{name:'Close unit details',exact:true}).click();await expect(drawer).toHaveCount(0);
  }
  await app.locator('body').evaluate(()=>{location.hash='#camera-health?diagnostics=1';});
  await expect(app.locator('.camera-overview-card')).toHaveCount(2);
  await expect(app.locator('.camera-unit-kpis button b')).toHaveText(status==='online'?['2','2','0','0']:['2','0','2','0']);
  for(const scenario of scenarios){
    const overview=app.locator('.camera-overview-card').filter({hasText:scenario.unit.unitNumber});
    await expect(overview).toHaveCount(1);
    const stamp=overview.locator('.camera-card-main > small').filter({hasText:`Latest ${status} ${scenario.basis} record observation:`});
    await expect(stamp).toContainText(`Latest ${status} ${scenario.basis} record observation: ${scenario.time}`);
    if(scenario.basis==='camera/detector')await expect(stamp).not.toContainText(portTime);
    await expect(overview.locator('.camera-status-pill')).toHaveText(scenario.label);
    await overview.getByRole('button',{name:'Open '+scenario.unit.unitNumber+' unit details',exact:true}).click();
    const detail=app.getByRole('dialog',{name:'Camera Health unit details'}),raw=detail.locator('.camera-device-cards article');
    await expect(raw).toHaveCount(1);await expect(raw.locator('p').filter({hasText:'Last reported service result:'})).toContainText(`${scenario.service} · ${portTime}`);
    if(scenario.basis==='camera/detector')await expect(raw.locator('p').filter({hasText:cameraTime})).toContainText('15 min ago');
    else await expect(raw).toContainText('No verified provider camera/recorder observation.');
    await detail.getByRole('button',{name:'Back to units',exact:true}).click();await expect(detail).toHaveCount(0);
  }
  await app.locator('.camera-overview-grid').screenshot({path:info.outputPath(`overview-${status}-separate-observation-times.png`)});
  expect(state.calls.length).toBeGreaterThan(0);expect(state.calls.every(request=>request.method==='GET')).toBe(true);
  for(const path of ['/api/session','/api/field-map','/api/camera-health/summary-v3'])expect(state.calls.some(request=>request.path===path)).toBe(true);
  expect(state.calls.some(request=>/\/probe|\/run-test|\/gps$|\/partner\/unit-location/.test(request.path))).toBe(false);
  expect(state.unexpectedApi).toEqual([]);expect(state.blockedExternal).toEqual([]);expect(state.errors).toEqual([]);
});

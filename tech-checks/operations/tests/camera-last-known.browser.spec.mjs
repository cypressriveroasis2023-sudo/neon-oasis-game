import {test,expect} from '@playwright/test';
import {revealUnitTroubleshooting} from './field-map-controls.mjs';
import {resource,snapshot} from './fixtures/camera-evidence-fixtures.mjs';

// Hosted-only browser coverage. Every source is synthetic and every recorded
// application request must be GET. The clock stays paused between settled reads.
const start=Date.parse('2026-10-14T03:00:00Z'),observedAt='2026-10-14T02:55:00Z';
const unitId='91000000-0000-4000-8000-000000000001',unitNumber='Solar Spotter 22HDC1';
const summaryPath='/api/camera-health/summary-v3';
async function mount(page,{failed=false}={}){
 const state={failed,calls:[],errors:[],active:0};
 const unit={id:unitId,unitNumber,modelName:'Solar Spotter',status:'field',placement:'FIELD',currentLocationType:'field',address:'100 Synthetic Road',site:'Synthetic historical status',customer:'Synthetic customer',latitude:29.7,longitude:-95.4,coordinateSource:'site',locationVerification:'owner_verified',gpsRecordedAt:observedAt,locationVerifiedAt:observedAt};
 page.on('pageerror',error=>state.errors.push(error.message));
 await page.clock.install({time:new Date(start)});await page.clock.pauseAt(new Date(start));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/camera-last-known-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe src="/#fleet-dashboard"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-last-known-only'},location.origin)})</script>`});
  if(url.hostname==='127.0.0.1')return route.continue();
  if(/(?:^|\.)tile\.openstreetmap\.org$/.test(url.hostname))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#dce5df"/></svg>'});
  if(!url.pathname.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':request.headers().origin||'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  const body=request.postDataJSON();state.calls.push(body);state.active++;
  try{
   if(body.method!=='GET')return await route.fulfill({status:400,headers,json:{error:'Synthetic writes disabled'}});
   if(body.path===summaryPath&&state.failed)return await route.fulfill({status:503,headers,json:{error:'Synthetic saved camera read unavailable'}});
   const readAt=await page.evaluate(()=>new Date(Date.now()).toISOString());
   const row=resource('93001','SOLARSPOTTER022',{evidence:{kind:'provider',source:'Star4Live',resource:'camera',active:true,status:'online',observedAt,lastOnlineAt:observedAt}});
   const data=body.path==='/api/session'?{authorized:true,name:'Synthetic Owner',role:'Owner',features:{vrmRead:false}}
    :body.path===summaryPath?{...snapshot([row]),refreshedAt:readAt,identityVersion:1,unitIdentities:[{unitId,unitNumber,kind:'native_provider',deviceIds:['93001'],unitKeys:['SOLARSPOTTER022'],proof:'a'.repeat(64)}],identityWarnings:[]}
    :body.path==='/api/field-map'?{items:[unit],inventoryItems:[unit],summary:{fieldUnits:1,mappedUnits:1,unitGps:0,missingGps:0},generatedAt:readAt}
    :body.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:readAt}
    :{items:[]};
   await route.fulfill({headers,json:data});
  }finally{state.active--;}
 });
 await page.goto('/camera-last-known-fixture');
 const app=page.frameLocator('iframe'),card=app.locator('.cos-fleet-unit-row[data-unit-id="'+unitId+'"]');
 await expect(card).toBeVisible();await expect(app.getByRole('button',{name:'↻ Refresh data',exact:true})).toBeEnabled();await expect.poll(()=>state.active).toBe(0);
 const originalTime=await page.evaluate(value=>new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(new Date(value)),observedAt);
 return {app,card,state,originalTime};
}
function assertReadOnly(state){expect(state.calls.length).toBeGreaterThan(0);expect(state.calls.every(call=>call.method==='GET')).toBe(true);expect([...new Set(state.calls.map(call=>call.path))].sort()).toEqual(['/api/camera-health/summary-v3','/api/field-map','/api/routers','/api/session']);expect(state.errors).toEqual([]);}

test('last-known evidence stays visible on list and drawer without restoring current green after failure or expiry',async({page},testInfo)=>{
 const {app,card,state,originalTime}=await mount(page);
 await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('1');await expect(card.locator('.camera-last-known')).toHaveCount(0);
 state.failed=true;await app.getByRole('button',{name:'↻ Refresh data',exact:true}).click();
 await expect(app.locator('.cos-fleet-message').filter({hasText:'Synthetic saved camera read unavailable'})).toBeVisible();
 await expect(app.getByRole('button',{name:'↻ Refresh data',exact:true})).toBeEnabled();await expect.poll(()=>state.active).toBe(0);
 await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('—');await expect(app.locator('.cos-fleet-stat-unknown strong')).toHaveText('1');
 const history=card.locator('.camera-last-known');await expect(history).toContainText('Last known CAMERA RECORDS ONLINE');await expect(history).toContainText(originalTime);await expect(history).toContainText('current status unverified');
 await expect(card.locator('.cos-signal-online')).toHaveCount(0);
 // Suspend automatic reads only after the failure settled; advance the
 // observation clock past expiry without racing request timeout timers.
 await app.locator('body').evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 const callsBeforeAging=state.calls.length;
 await page.clock.runFor(21*60000);await expect(history).toContainText('Stale saved evidence');await expect(history).toContainText(originalTime);await expect(history).toHaveCSS('white-space','normal');
 expect(state.calls.length).toBe(callsBeforeAging);
 await expect(app.locator('.cos-field-pin[data-health="online"]')).toHaveCount(0);await expect(app.locator('.cos-field-pin[data-health="unknown"]')).toHaveCount(1);
 await card.screenshot({path:testInfo.outputPath('last-known-stale-unit-card.png')});await page.screenshot({path:testInfo.outputPath('last-known-stale-list.png'),fullPage:true});
 await card.click();const drawer=app.getByRole('dialog',{name:unitNumber+' unit intelligence'}),camera=drawer.getByRole('region',{name:'Selected unit camera health',exact:true});
 await expect(drawer).toBeVisible();await revealUnitTroubleshooting(app);await expect(drawer.getByRole('button',{name:'Reload saved results',exact:true})).toBeEnabled();await expect.poll(()=>state.active).toBe(0);
 await expect(camera.locator('.camera-status-unknown')).toBeVisible();await expect(camera.locator('.camera-last-known')).toContainText(originalTime);await expect(camera.locator('.camera-last-known')).toContainText('Stale saved evidence; current status unverified');await expect(camera.locator('.camera-status-online,.cos-signal-online')).toHaveCount(0);
 await camera.screenshot({path:testInfo.outputPath('last-known-stale-drawer-card.png')});await page.screenshot({path:testInfo.outputPath('last-known-stale-drawer.png'),fullPage:true});assertReadOnly(state);
});

test('cold-start saved-read failure has no invented historical result',async({page},testInfo)=>{
 const {app,card,state}=await mount(page,{failed:true});
 await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('—');await expect(app.locator('.cos-fleet-stat-unknown strong')).toHaveText('1');await expect(app.locator('.camera-last-known')).toHaveCount(0);
 await card.click();const drawer=app.getByRole('dialog',{name:unitNumber+' unit intelligence'});await expect(drawer).toBeVisible();await revealUnitTroubleshooting(app);await expect(drawer.getByRole('button',{name:'Reload saved results',exact:true})).toBeEnabled();await expect.poll(()=>state.active).toBe(0);
 await expect(drawer.locator('.camera-last-known')).toHaveCount(0);await expect(drawer.locator('.camera-status-online')).toHaveCount(0);await page.screenshot({path:testInfo.outputPath('last-known-cold-start-unverified.png'),fullPage:true});assertReadOnly(state);
});

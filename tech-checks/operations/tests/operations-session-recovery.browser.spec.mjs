import {test,expect} from '@playwright/test';
import {resource,snapshot,now,fresh} from './fixtures/camera-evidence-fixtures.mjs';

// Synthetic same-origin parent and saved read responses only. Never read real tokens,
// contact a provider, mutate records, or replay a write. The hosted clock stays paused.
const origin='http://127.0.0.1:4173';
const owner={authorized:true,legacyOwner:true,role:'Owner',name:'Synthetic Owner',productionOwnerUserId:'11111111-1111-4111-8111-111111111111',features:{fleetAccess:true,vrmRead:true,fleetPlacementEdit:false,fieldLocationVerification:false}};
const unitId='90000000-0000-4000-8000-000000000001';
const unit={id:unitId,unitNumber:'Helios 1',modelName:'Helios',status:'field',currentLocationType:'field',address:'100 Synthetic Road',customer:'Synthetic customer',latitude:29.7,longitude:-95.4,coordinateSource:'site',locationVerification:'owner_verified',gpsRecordedAt:fresh,locationVerifiedAt:fresh};
const health=snapshot([resource('9001','Helios 1')]);
const field={items:[unit],inventoryItems:[unit],summary:{fieldUnits:1,mappedUnits:1,unitGps:0,missingGps:0},generatedAt:fresh};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function mount(page,{it=false,locationWrites=false}={}){
 const session={...structuredClone(owner),features:{...owner.features,fieldLocationVerification:locationWrites}};
 const state={session:it?{...session,legacyOwner:false,role:'IT',productionOwnerUserId:null}:session,calls:[],errors:[],sessionGate:null,healthGate:null,routerStatus:200,sessionStatus:200,sessionReads:0};
 page.on('pageerror',error=>state.errors.push(error.message));
 await page.addInitScript(()=>{window.recoveryInvalidations=[];window.recoveryHides=0;window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===window.parent&&event.data?.type==='COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE')window.recoveryHides++;});window.addEventListener('cos-private-data-invalidated',event=>window.recoveryInvalidations.push({reason:event.detail?.reason||'untyped',at:Date.now()}));});
 await page.clock.install({time:new Date(now-60000)});await page.clock.pauseAt(new Date(now));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===origin&&url.pathname==='/session-recovery-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe src="/${it?'?mode=fleet':''}#fleet-dashboard"></iframe><script>window.syntheticSession='synthetic-session-a';window.dropNextHandshake=false;addEventListener('message',e=>{const frame=document.querySelector('iframe');if(e.origin!==location.origin||e.source!==frame.contentWindow||e.data?.type!=='COS_OPERATIONS_TOKEN_REQUEST')return;if(window.dropNextHandshake){window.dropNextHandshake=false;return;}e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'${it?'it':'owner'}',accessToken:window.syntheticSession},location.origin)})</script>`});
  if(url.origin===origin)return route.continue();
  if(/(?:^|\.)tile\.openstreetmap\.org$/.test(url.hostname))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>'});
  if(!url.pathname.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  const body=request.postDataJSON();state.calls.push(body);
  if(body.method!=='GET')return route.fulfill({status:400,headers,json:{error:'Synthetic writes disabled'}});
  if(body.path==='/api/session'){
   state.sessionReads++;const data=structuredClone(state.session),status=state.sessionStatus,gate=state.sessionGate;
   if(gate){state.sessionGate=null;await gate.promise;}
   return route.fulfill({status,headers,json:status===200?data:{error:'Synthetic authorization denied'}});
  }
  if(body.path==='/api/camera-health/summary-v3'&&state.healthGate){const gate=state.healthGate;state.healthGate=null;await gate.promise;}
  if(body.path==='/api/routers'&&state.routerGate){const gate=state.routerGate;state.routerGate=null;await gate.promise;state.oldRouterDelivered=true;return route.fulfill({status:gate.status,headers,json:{error:'Synthetic obsolete denial'}});}
  if(body.path==='/api/routers'&&state.routerStatus!==200)return route.fulfill({status:state.routerStatus,headers,json:{error:'Synthetic source authorization denied'}});
  const data=body.path==='/api/camera-health/summary-v3'?health:body.path==='/api/field-map'?field:body.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:fresh}:body.path==='/api/vrm-fleet'?{items:[],power:[]}:{items:[]};
  return route.fulfill({headers,json:data});
 });
 await page.goto('/session-recovery-fixture');const app=page.frameLocator('iframe');
 await expect(app.getByRole('button',{name:'↻ Refresh data',exact:true})).toBeEnabled();await expect(app.locator('.cos-fleet-stat-field strong')).toHaveText('1');
 return {app,state,initialSessions:state.sessionReads};
}
const refresh=app=>app.getByRole('button',{name:'↻ Refresh data',exact:true});
const privateView=app=>app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});
async function reasons(app){return app.locator('body').evaluate(()=>window.recoveryInvalidations.map(event=>event.reason));}
async function renewal(page,app){await page.evaluate(()=>window.syntheticSession='synthetic-session-b');await refresh(app).click();await expect.poll(()=>reasons(app)).toContain('token-renewed');await page.clock.runFor(1);}
async function blocked(app){await expect(privateView(app)).toHaveCount(0);await expect(app.getByRole('alert')).toContainText('Reload COS Operations');await expect(app.getByRole('button',{name:'Retry Operations access'})).toHaveCount(0);}
function readOnly(state){expect(state.calls.every(call=>call.method==='GET')).toBe(true);expect(state.errors).toEqual([]);}

test('same Owner token renewal clears private views and restores camera, map and supporting-source refresh',async({page},testInfo)=>{
 const {app,state,initialSessions}=await mount(page),gate=deferred();state.sessionGate=gate;
 await renewal(page,app);await expect.poll(()=>state.sessionReads).toBe(initialSessions+1);await expect(privateView(app)).toHaveCount(0);await expect(app.getByText('Verifying your current Operations account…')).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('owner-session-checking.png')});
 const routerReads=state.calls.filter(call=>call.path==='/api/routers').length;gate.resolve();await expect(refresh(app)).toBeEnabled();await expect(app.locator('.cos-fleet-stat-field strong')).toHaveText('1');await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('1');
 await expect.poll(()=>state.calls.filter(call=>call.path==='/api/routers').length).toBeGreaterThan(routerReads);await expect(app.getByRole('alert')).toHaveCount(0);expect(state.sessionReads).toBe(initialSessions+1);readOnly(state);
 await page.screenshot({path:testInfo.outputPath('owner-recovered-fleet.png')});
});

test('one ten-second parent timeout revalidates only the same Owner and restores Refresh',async({page})=>{
 const {app,state,initialSessions}=await mount(page);await page.evaluate(()=>window.dropNextHandshake=true);await refresh(app).click();await page.clock.runFor(10000);await expect.poll(()=>reasons(app)).toEqual(['parent-timeout']);await page.clock.runFor(1);
 await expect.poll(()=>state.sessionReads).toBe(initialSessions+1);await expect(refresh(app)).toBeEnabled();await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('1');readOnly(state);
});
for(const [label,patch] of [['changed actor',{productionOwnerUserId:'22222222-2222-4222-8222-222222222222'}],['permission downgrade',{features:{...owner.features,vrmRead:false}}],['changed role',{legacyOwner:false,role:'IT',productionOwnerUserId:null}]])test(label+' cannot recover the prior Owner private views',async({page})=>{
 const {app,state,initialSessions}=await mount(page);Object.assign(state.session,patch);await renewal(page,app);await blocked(app);await page.clock.runFor(20*60000);expect(state.sessionReads).toBe(initialSessions+1);readOnly(state);
});
for(const status of [401,403])test('true source '+status+' stays blocked without automatic revalidation',async({page},testInfo)=>{
 const {app,state,initialSessions}=await mount(page);state.routerStatus=status;await refresh(app).click();await blocked(app);await page.clock.runFor(20*60000);expect(state.sessionReads).toBe(initialSessions);expect(await reasons(app)).toContain('authentication-denied');readOnly(state);
 await page.screenshot({path:testInfo.outputPath('owner-source-'+status+'-reload-required.png')});
});
test('IT without a server-verified actor ID requires reload after token change',async({page})=>{
 const {app,state,initialSessions}=await mount(page,{it:true});await renewal(page,app);await blocked(app);expect(state.sessionReads).toBe(initialSessions);readOnly(state);
});
for(const trigger of ['host-hide','pagehide','untyped-security-event','second-token-transition'])test(trigger+' during verification discards its late successful response',async({page})=>{
 const {app,state,initialSessions}=await mount(page),gate=deferred(),replacementGate=deferred();state.sessionGate=gate;await renewal(page,app);await expect.poll(()=>state.sessionReads).toBe(initialSessions+1);
 if(trigger==='second-token-transition')state.sessionGate=replacementGate;
 if(trigger==='host-hide')await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'},location.origin));
 else await app.locator('body').evaluate((_,kind)=>dispatchEvent(kind==='pagehide'?new Event('pagehide'):kind==='second-token-transition'?new CustomEvent('cos-private-data-invalidated',{detail:{reason:'token-renewed'}}):new Event('cos-private-data-invalidated')),trigger);
 if(trigger==='second-token-transition'){await page.clock.runFor(1);await expect.poll(()=>state.sessionReads).toBe(initialSessions+2);await app.locator('body').evaluate(()=>dispatchEvent(new CustomEvent('cos-private-data-invalidated',{detail:{reason:'token-renewed'}})));}
 gate.resolve();replacementGate.resolve();await blocked(app);await page.clock.runFor(20*60000);expect(state.sessionReads).toBe(initialSessions+(trigger==='second-token-transition'?2:1));readOnly(state);
});
test('verification 401 is one failed attempt with no recursive retry',async({page})=>{
 const {app,state,initialSessions}=await mount(page);state.sessionStatus=401;await renewal(page,app);await blocked(app);await page.clock.runFor(20*60000);expect(state.sessionReads).toBe(initialSessions+1);readOnly(state);
});
test('late old saved-data responses cannot reopen a cleared unit drawer after recovery',async({page})=>{
 const {app,state}=await mount(page),gate=deferred();await app.locator('.cos-fleet-unit-row').first().click();await expect(app.getByRole('dialog')).toBeVisible();
 state.healthGate=gate;await app.getByRole('dialog').getByRole('button',{name:'↻ Refresh data',exact:true}).click();await expect.poll(()=>state.healthGate).toBe(null);
 await app.locator('body').evaluate(()=>dispatchEvent(new CustomEvent('cos-private-data-invalidated',{detail:{reason:'token-renewed'}})));await page.clock.runFor(1);await expect(refresh(app)).toBeEnabled();await expect(app.getByRole('dialog')).toHaveCount(0);
 gate.resolve();await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('1');await expect(app.getByRole('dialog')).toHaveCount(0);expect(await app.locator('body').evaluate(()=>location.hash)).toBe('#fleet-dashboard');readOnly(state);
});

async function hideForLegacy(page,app){
 await page.evaluate(()=>{const frame=document.querySelector('iframe');frame.hidden=true;frame.contentWindow.postMessage({type:'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'},location.origin);});
 await expect.poll(()=>app.locator('body').evaluate(()=>window.recoveryHides)).toBe(1);
}
test('normal legacy tool hide and return preserves the healthy authorized Owner workspace',async({page})=>{
 const {app,state,initialSessions}=await mount(page);await hideForLegacy(page,app);await page.evaluate(()=>document.querySelector('iframe').hidden=false);await expect(refresh(app)).toBeEnabled();await expect(app.locator('.cos-fleet-stat-field strong')).toHaveText('1');expect(state.sessionReads).toBe(initialSessions);expect(await reasons(app)).toEqual([]);readOnly(state);
});
test('identity changed while hidden cannot reuse the healthy prior Owner fingerprint',async({page})=>{
 const {app,state,initialSessions}=await mount(page);await hideForLegacy(page,app);state.session.productionOwnerUserId='22222222-2222-4222-8222-222222222222';await page.evaluate(()=>window.syntheticSession='synthetic-session-b');
 // The synthetic host retains its iframe to exercise the child's additional identity check.
 // The real host's separate source tests require destroying it on an actual account change.
 // The next automatic saved-data read is due after fifteen minutes, not four.
 await page.clock.runFor(15*60000-1);expect(await reasons(app)).toEqual([]);expect(state.sessionReads).toBe(initialSessions);
 await page.clock.runFor(1);await expect.poll(()=>reasons(app)).toContain('token-renewed');await page.clock.runFor(1);await expect.poll(()=>state.sessionReads).toBe(initialSessions+1);await page.evaluate(()=>document.querySelector('iframe').hidden=false);await blocked(app);readOnly(state);
});
test('late old GPS callbacks cannot expose a captured unit in the global toast during or after recovery',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(success){window.syntheticPendingGps=success;}}}));
 const {app,state,initialSessions}=await mount(page,{locationWrites:true}),gate=deferred();
 await app.locator('.cos-fleet-unit-row').first().click();await app.getByRole('button',{name:'Edit / verify installation →',exact:true}).click();await app.getByRole('button',{name:'Use My Current GPS',exact:true}).click();await expect.poll(()=>app.locator('body').evaluate(()=>typeof window.syntheticPendingGps)).toBe('function');
 state.sessionGate=gate;await app.locator('body').evaluate(()=>dispatchEvent(new CustomEvent('cos-private-data-invalidated',{detail:{reason:'token-renewed'}})));await page.clock.runFor(1);await expect.poll(()=>state.sessionReads).toBe(initialSessions+1);
 const deliver=()=>app.locator('body').evaluate(()=>window.syntheticPendingGps({coords:{latitude:29.7,longitude:-95.4,accuracy:3}}));
 await deliver();await expect(app.locator('.operations-toast')).toHaveCount(0);await expect(privateView(app)).toHaveCount(0);
 gate.resolve();await expect(refresh(app)).toBeEnabled();await deliver();await expect(app.locator('.operations-toast')).toHaveCount(0);await expect(app.getByRole('dialog')).toHaveCount(0);readOnly(state);
});

test('GPS draft waiting for an address digest cannot submit after session invalidation',async({page})=>{
 await page.addInitScript(()=>{
  const original=crypto.subtle.digest.bind(crypto.subtle);
  crypto.subtle.digest=(algorithm,bytes)=>{
   if(window.holdSyntheticGpsDigest&&new TextDecoder().decode(bytes)==='100 synthetic road'){
    window.holdSyntheticGpsDigest=false;
    return new Promise((resolve,reject)=>{window.finishSyntheticGpsDigest=()=>original(algorithm,bytes).then(resolve,reject);});
   }
   return original(algorithm,bytes);
  };
 });
 const {app,state,initialSessions}=await mount(page,{locationWrites:true}),gate=deferred();
 await app.locator('.cos-fleet-unit-row').first().click();await app.getByRole('button',{name:'Edit / verify installation →',exact:true}).click();await app.getByRole('checkbox',{name:/I checked that these coordinates match/}).check();
 await app.locator('body').evaluate(()=>window.holdSyntheticGpsDigest=true);await app.getByRole('button',{name:'Save verified location',exact:true}).click();await expect.poll(()=>app.locator('body').evaluate(()=>typeof window.finishSyntheticGpsDigest)).toBe('function');
 state.sessionGate=gate;await app.locator('body').evaluate(()=>dispatchEvent(new CustomEvent('cos-private-data-invalidated',{detail:{reason:'token-renewed'}})));await page.clock.runFor(1);await expect.poll(()=>state.sessionReads).toBe(initialSessions+1);
 await app.locator('body').evaluate(()=>window.finishSyntheticGpsDigest());await expect(privateView(app)).toHaveCount(0);expect(state.calls.filter(call=>call.method==='POST')).toEqual([]);
 gate.resolve();await expect(refresh(app)).toBeEnabled();await expect(app.getByRole('dialog')).toHaveCount(0);expect(state.calls.filter(call=>call.method==='POST')).toEqual([]);readOnly(state);
});

for(const status of [401,403])for(const timing of ['during','after'])test(`obsolete source ${status} ${timing} verified renewal keeps Owner Fleet available`,async({page},testInfo)=>{
 const {app,state,initialSessions}=await mount(page),old=deferred(),verification=deferred();old.status=status;state.routerGate=old;
 await refresh(app).click();await expect.poll(()=>state.routerGate).toBe(null);await expect(refresh(app)).toBeEnabled();
 state.sessionGate=verification;await renewal(page,app);await expect.poll(()=>state.sessionReads).toBe(initialSessions+1);
 if(timing==='after'){verification.resolve();await expect(refresh(app)).toBeEnabled();}
 old.resolve();await expect.poll(()=>state.oldRouterDelivered).toBe(true);
 if(timing==='during'){await expect(privateView(app)).toHaveCount(0);verification.resolve();}
 await expect(refresh(app)).toBeEnabled();await expect(app.locator('.cos-fleet-stat-field strong')).toHaveText('1');
 await expect(app.getByRole('alert')).toHaveCount(0);expect(await reasons(app)).toEqual(['token-renewed']);expect(state.sessionReads).toBe(initialSessions+1);readOnly(state);
 await page.screenshot({path:testInfo.outputPath(`owner-stale-${status}-${timing}-recovered.png`)});
});
test('persisted pageshow reloads the security-hidden document and verifies access afresh',async({page})=>{
 const {app,state,initialSessions}=await mount(page);
 await app.locator('body').evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await blocked(app);
 await app.locator('body').evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
 await expect.poll(()=>state.sessionReads).toBe(initialSessions+1);await expect(refresh(app)).toBeEnabled();await expect(app.locator('.cos-fleet-stat-field strong')).toHaveText('1');readOnly(state);
});
test('ordinary pageshow cannot reset an authentication hard stop',async({page})=>{
 const {app,state,initialSessions}=await mount(page);state.routerStatus=403;await refresh(app).click();await blocked(app);
 await app.locator('body').evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:false})));
 await blocked(app);expect(state.sessionReads).toBe(initialSessions);readOnly(state);
});

test('delayed parent renewal after a handshake timeout restores Owner without reload',async({page})=>{
 const {app,state,initialSessions}=await mount(page);
 await page.evaluate(()=>{window.dropNextHandshake=true;window.syntheticSession='synthetic-session-b';});
 await refresh(app).click();await page.clock.runFor(10000);
 await expect.poll(()=>reasons(app)).toContain('parent-timeout');await page.clock.runFor(1);
 await expect.poll(()=>reasons(app)).toContain('token-renewed');await page.clock.runFor(1);
 await expect(refresh(app)).toBeEnabled();await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('1');
 await expect(app.getByRole('alert')).toHaveCount(0);expect(state.sessionReads).toBe(initialSessions+2);readOnly(state);
});

for(const change of ['same Owner','changed Owner','changed permissions'])test('temporary session outage resumes only '+change+' after a delayed fresh check',async({page})=>{
 const {app,state,initialSessions}=await mount(page);state.sessionStatus=503;
 await renewal(page,app);await expect.poll(()=>state.sessionReads).toBe(initialSessions+1);
 await expect(privateView(app)).toHaveCount(0);await expect(app.getByRole('alert')).toHaveCount(0);
 await expect(app.getByText('Connection interrupted. COS will reconnect automatically. Keep this window open.')).toBeVisible();
 await page.clock.runFor(29999);expect(state.sessionReads).toBe(initialSessions+1);
 state.sessionStatus=200;
 if(change==='changed Owner')state.session.productionOwnerUserId='22222222-2222-4222-8222-222222222222';
 if(change==='changed permissions')state.session.features.vrmRead=false;
 await page.clock.runFor(1);await expect.poll(()=>state.sessionReads).toBe(initialSessions+2);
 if(change==='same Owner'){await expect(refresh(app)).toBeEnabled();await expect(app.locator('.cos-fleet-stat-online strong')).toHaveText('1');}
 else await blocked(app);
 readOnly(state);
});
test('logout boundary while offline cancels scheduled session recovery',async({page})=>{
 const {app,state,initialSessions}=await mount(page);state.sessionStatus=503;await renewal(page,app);await expect.poll(()=>state.sessionReads).toBe(initialSessions+1);
 await app.locator('body').evaluate(()=>dispatchEvent(new CustomEvent('cos-private-data-invalidated',{detail:{reason:'authentication-denied'}})));
 await blocked(app);state.sessionStatus=200;await page.clock.runFor(120000);expect(state.sessionReads).toBe(initialSessions+1);readOnly(state);
});

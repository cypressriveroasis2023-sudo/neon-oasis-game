import {expectOperationsReloadRequired} from './helpers/operationsAccess.mjs';
import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Both the host and board are real built code. All backend traffic is synthetic.
const origin = 'http://127.0.0.1:4173';
const edge = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const time = '2026-10-12T15:00:00Z';
const cors = {'access-control-allow-origin': origin};
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const harness = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}iframe{width:100%;height:600px;border:0}.hidden{display:none}</style></head><body><header id="hostToolbar">Host tools</header><div id="appView"><div id="view-owner"><div id="cosOperationsMount"></div><div id="cosOperationsLegacy"></div></div></div><script>window.TechCheckContext={getRole:()=>"owner",getEffectiveRole:()=>"owner",getSession:()=>({user:{id:"fixture-owner"}}),db:{auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session:{user:{id:"fixture-owner"},access_token:"synthetic-owner-session"}}})}}};</script><script type="module" src="/operations-host.js"></script></body></html>`;
const diagnostics=new WeakMap();
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
test.afterEach(async({page},testInfo)=>{
  const state=diagnostics.get(page);if(!state)return;
  const frames=await Promise.all(page.frames().map(frame=>frame.evaluate(()=>({url:location.href,events:window.tvLifecycleEvents||[],board:document.querySelector('.tech-check-tv')?.getAttribute('data-section')??null,access:document.querySelector('.operations-access')?.textContent??null})).catch(error=>({unavailable:error.message}))));
  const path=testInfo.outputPath('tv-session-lifecycle.json');
  await writeFile(path,JSON.stringify({reads:state.reads,pendingDaily:state.pendingDaily,dailyResults:state.dailyResults,fleetReads:state.fleetReads,writes:state.writes,frames},null,2));
  await testInfo.attach('tv-session-lifecycle',{path,contentType:'application/json'});
});
async function setup(page, { many = false, pausedClock = false } = {}) {
  const state = { fail: 0, reads: 0, writes: [], tasks: [{id:'task-1',title:'Shop work update',instructions:'Inspect the return rack',assignedTo:'Tech 1',assignedDepartment:'it',status:'assigned',priority:'high'}], jobs: many ? Array.from({length:10}, (_, index) => ({id:'job-'+index,customer:'Work '+index,technician:'Tech '+index,department:'it',status:'assigned'})) : [], readiness: [] };
  state.pendingDaily=0;state.dailyResults=[];state.dailyGate=null;diagnostics.set(page,state);
  await page.addInitScript(()=>{
    window.tvLifecycleEvents=[];
    addEventListener('cos-private-data-invalidated',event=>window.tvLifecycleEvents.push({type:'invalidated',reason:event.detail?.reason??'untyped',at:Date.now()}));
    addEventListener('focus',()=>window.tvLifecycleEvents.push({type:'focus',at:Date.now()}));
    addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.type==='COS_TV_BOARD_DISPLAY_MODE')window.tvLifecycleEvents.push({type:'display',active:event.data.active,at:Date.now()});});
  });
  // Pause at a future instant while the page is still blank, before app timers exist.
  await page.clock.install({ time: new Date(Date.parse(time)-(pausedClock?60000:0)) });
  if(pausedClock)await page.clock.pauseAt(new Date(time));
  state.settings={sections:['shop'],revision:0,updatedAt:null};state.fleetReads=0;state.fleetFailures={};
  if(many)state.tasks.push(...Array.from({length:10},(_,index)=>({id:'extra-'+index,title:'More shop work '+index,assignedTo:'Tech '+index,assignedDepartment:'it',status:'assigned',priority:'medium'})));
  const unit={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',unitNumber:'Sniper 312',modelName:'SNIPER',status:'installed',site:'Fixture field site',address:'19017 Lee Rd, Humble, TX 77032',latitude:29.986,longitude:-95.311,locationVerification:'owner_verified',locationVerifiedAt:time,gpsRecordedAt:time};
  state.fleetUnits=[unit];state.cameraRows=[{id:'fixture-resource',name:'Sniper 312 connection',unit:'Sniper 312',status:'online',scope:'field',activationState:'active',serviceEvidence:{kind:'service_port',source:'Saved connection',status:'online',active:true,resource:'service',observedAt:time,lastOnlineAt:time,reachable:true}}];
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if(url.origin===origin){
      if(url.pathname==='/tv-harness')return route.fulfill({contentType:'text/html',body:harness});
      if(url.pathname==='/operations-host.js')return route.fulfill({contentType:'application/javascript',body:await readFile(new URL('../../operations-host.js',import.meta.url),'utf8')});
      if(url.pathname==='/field-map-display-host.js')return route.fulfill({contentType:'application/javascript',body:await readFile(new URL('../../field-map-display-host.js',import.meta.url),'utf8')});
      if(url.pathname.startsWith('/operations/dist/'))return route.fulfill({path:dist+url.pathname.slice('/operations/dist/'.length)});
      return route.continue();
    }
    if(url.href!==edge)return route.abort('blockedbyclient');
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'}});
    const {path,method,body}=request.postDataJSON();
    expect(await request.headerValue('authorization')).toBe('Bearer synthetic-owner-session');
    if(path==='/api/tv-board/settings'){
      if(method==='POST'){
        state.writes.push({path,method,body});
        const timing=body.expectedRevision>=1000000000;const payload=body.expectedRevision-1000000000;const expected=timing?Math.floor(payload/1000):body.expectedRevision;const seconds=timing?payload%1000:state.settings.rotationSeconds??15;
        if(expected!==state.settings.revision)return route.fulfill({status:409,headers:cors,json:{error:'Settings changed. Refresh before saving.'}});
        state.settings={sections:body.sections,revision:state.settings.revision+1,updatedAt:time,rotationSeconds:seconds};
      }
      return route.fulfill({headers:cors,json:state.settings});
    }
    if(method!=='GET'){state.writes.push({path,method,body});return route.fulfill({status:403,headers:cors,json:{error:'Display cannot write'}});}
    if(path==='/api/daily-board'){
      const read=++state.reads,status=state.fail||200,gate=state.dailyGate;state.dailyGate=null;state.pendingDaily++;
      try{
        if(gate)await gate.promise;
        if(status!==200)await route.fulfill({status,headers:cors,json:{error:status===401?'Sign-in required':'Connection unavailable'}});
        else await route.fulfill({headers:cors,json:{jobs:state.jobs,tasks:state.tasks,readiness:state.readiness,asOf:time}});
        state.dailyResults.push({read,status});
      }finally{state.pendingDaily--;}
      return;
    }
    if(state.fleetFailures[path]){state.fleetReads++;return route.fulfill({status:state.fleetFailures[path],headers:cors,json:{error:'Connection unavailable'}});}
    if(path==='/api/field-map'){state.fleetReads++;return route.fulfill({headers:cors,json:{items:state.fleetUnits,summary:{fieldUnits:state.fleetUnits.length,mappedUnits:state.fleetUnits.length,unitGps:state.fleetUnits.length,missingGps:0},generatedAt:time,...(state.fieldMapExtras||{})}});}
    if(path==='/api/routers'){state.fleetReads++;return route.fulfill({headers:cors,json:{items:[],generatedAt:time,source:'camera_health',gpsAvailable:false}});}
    if(path==='/api/camera-health/summary-v3'){state.fleetReads++;const total=state.cameraRows.length;return route.fulfill({headers:cors,json:{totalDevices:total,online:state.cameraRows.filter(row=>row.status==='online').length,offline:state.cameraRows.filter(row=>row.status==='offline').length,review:state.cameraRows.filter(row=>row.status==='review').length,shopRoot:0,healthRows:total,fieldDevices:total,refreshedAt:time,evidenceVersion:2,inventory:{allRecords:total,activeFieldRecords:total,activeShopRecords:0,inactiveRecords:0,unknownScopeRecords:0},rows:state.cameraRows}});}
    return route.fulfill({headers:cors,json:path==='/api/session'?{authorized:true,name:'Fixture Owner',role:'Owner',features:{}}:{items:[]}});
  });
  await page.goto('/tv-harness?tvBoard=1');
  const frame=page.frameLocator('#cosOperationsFrame');
  await expect(frame.getByRole('region',{name:'Tech Check TV Board'})).toBeVisible();
  await expect(frame.getByText('Inspect the return rack',{exact:true})).toBeVisible();
  return {state,frame};
}

test('TV link fills the host and sees a saved update without a remote desktop connection', async ({page}, testInfo) => {
  const {state,frame}=await setup(page);
  await expect(page.locator('#hostToolbar')).toBeHidden();
  await expect(frame.getByRole('button',{name:'Save Schedule & Assignment'})).toHaveCount(0);
  state.tasks[0].instructions='The return rack is ready';
  await page.clock.fastForward(60000);
  await expect(frame.getByText('The return rack is ready',{exact:true})).toBeVisible();
  expect(state.reads).toBeGreaterThanOrEqual(2);
  // A routine shell clock render must not run a false TV exit cleanup.
  expect(new URL(page.url()).searchParams.get('tvBoard')).toBe('1');
  await expect(page.locator('#hostToolbar')).toBeHidden();
  expect(await page.evaluate(()=>window.tvLifecycleEvents.filter(event=>event.type==='display'&&!event.active))).toEqual([]);
  await page.reload();
  await expect(frame.getByRole('region',{name:'Tech Check TV Board'})).toBeVisible();
  await expect(frame.getByText('The return rack is ready',{exact:true})).toBeVisible();
  expect(state.writes).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('tech-check-tv.png')});
  await frame.getByRole('button',{name:'Exit TV',exact:true}).click();
  await expect(page.locator('#hostToolbar')).toBeVisible();
  await expect(frame.getByRole('region',{name:'COS Daily Board'})).toBeVisible();
  expect(new URL(page.url()).searchParams.has('tvBoard')).toBe(false);
});

test('TV rotates all technician groups without document scrolling', async ({page}) => {
  const {state,frame}=await setup(page,{many:true});
  const board=frame.getByRole('region',{name:'Tech Check TV Board'});
  const first=await board.getAttribute('data-page');
  await page.clock.fastForward(15000);
  await expect(board).not.toHaveAttribute('data-page',first);
  expect(await board.evaluate(node=>node.scrollHeight<=node.clientHeight+1&&node.scrollWidth<=node.clientWidth+1)).toBe(true);
  expect(state.writes).toEqual([]);
});

test('network failure marks delayed data and authentication failure clears private cards', async ({page}) => {
  const {state,frame}=await setup(page);
  state.fail=503;
  await frame.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(frame.getByRole('alert')).toContainText('UPDATES DELAYED');
  await expect(frame.getByText('Inspect the return rack',{exact:true})).toBeVisible();
  state.fail=401;
  await frame.getByRole('button',{name:'Refresh',exact:true}).click();
  await expectOperationsReloadRequired(frame);
  await expect(frame.getByRole('region',{name:'Tech Check TV Board'})).toHaveCount(0);
  await expect(frame.getByRole('button',{name:'Refresh',exact:true})).toHaveCount(0);
  await expect(frame.getByText('Inspect the return rack',{exact:true})).toHaveCount(0);
  await expect(page.locator('#hostToolbar')).toBeVisible();
  expect(new URL(page.url()).searchParams.has('tvBoard')).toBe(false);
  expect(state.writes).toEqual([]);
});

test('remote choices rotate all pending types, including future and unscheduled jobs',async({page})=>{
 const {state,frame}=await setup(page);
 state.jobs=['PICKUP','SWAP','DELIVERY','SERVICE'].map((jobType,index)=>({id:'pending-'+index,customer:'Pending '+jobType,jobType,status:'scheduled',scheduled:index%2?'':'2026-11-01 08:00',instructions:'Saved '+jobType+' instructions'}));
 state.settings={sections:['pickup','swap','delivery','service'],revision:1,updatedAt:time};
 await page.clock.fastForward(60000);
 for(const [index,key] of ['pickup','swap','delivery','service'].entries()){
  if(index)await page.clock.fastForward(15000);
  await expect(frame.getByRole('region',{name:'Tech Check TV Board'})).toHaveAttribute('data-section',key);
  await expect(frame.getByText('Pending '+key.toUpperCase(),{exact:true})).toBeVisible();
 }
 expect(state.writes).toEqual([]);
});

test('Owner saves switches and can turn every TV section off without changing work records',async({page})=>{
 const {state,frame}=await setup(page);
 await frame.getByRole('button',{name:'Exit TV',exact:true}).click();
 const controls=frame.getByRole('region',{name:'TV board settings'});
 await controls.getByRole('checkbox',{name:'Pending pickups',exact:true}).check();
 await controls.getByRole('button',{name:'Save TV settings',exact:true}).click();
 await expect(controls.getByText('TV settings saved and verified.',{exact:true})).toBeVisible();
 expect(state.settings.sections).toEqual(['pickup','shop']);
 await controls.getByRole('checkbox',{name:'Pending pickups',exact:true}).uncheck();await controls.getByRole('checkbox',{name:'Shop updates',exact:true}).uncheck();
 await controls.getByRole('button',{name:'Save TV settings',exact:true}).click();
 await expect(controls.getByText('TV settings saved and verified.',{exact:true})).toBeVisible();
 await frame.getByRole('button',{name:'TV View',exact:true}).click();
 await expect(frame.getByText('TV sections turned off',{exact:true})).toBeVisible();
 expect(state.writes.every(write=>write.path==='/api/tv-board/settings')).toBe(true);
});

test('Teddy and Victor have no inspection fields and Camera Health rotates with the verified map',async({page},testInfo)=>{
 const {state,frame}=await setup(page);
 state.readiness=['Teddy Hopper','Victor Garcia'].map((name,index)=>({userId:'staff-'+index,name,department:'it',status:'not_started',result:{}}));
 state.settings={sections:['readiness'],revision:1,updatedAt:time};await page.clock.fastForward(60000);
 await expect(frame.getByText('No company vehicle · truck and trailer inspections do not apply.').first()).toBeVisible();
 await expect(frame.getByText('Truck inspection',{exact:true})).toHaveCount(0);await expect(frame.getByText('Trailer inspection',{exact:true})).toHaveCount(0);
 state.settings={sections:['camera','map'],revision:2,updatedAt:time};await page.clock.fastForward(60000);
 await expect(frame.getByRole('region',{name:'Tech Check TV Board'})).toHaveAttribute('data-section','camera');
 await expect(frame.getByText('No confirmed red outages in the available records.',{exact:true})).toBeVisible();
 await expect(frame.locator('.tv-fleet-record')).toHaveCount(0);
 await page.screenshot({path:testInfo.outputPath('tv-camera-health.png')});
 const reads=state.fleetReads;expect(reads).toBe(3);await page.clock.fastForward(15000);
 await expect(frame.getByRole('region',{name:'Tech Check TV Board'})).toHaveAttribute('data-section','map');
 await expect(frame.locator('.tv-fleet-map .leaflet-marker-icon')).toHaveCount(1);
 await page.screenshot({path:testInfo.outputPath('tv-field-map.png')});
 const scheduledReads=state.reads;
 await page.clock.fastForward(60000);
 const refreshButton=frame.getByRole('button',{name:'Refresh',exact:true});
 await expect.poll(()=>state.reads).toBe(scheduledReads+1);
 await expect(refreshButton).toHaveAttribute('aria-busy','false');await expect.poll(()=>state.pendingDaily).toBe(0);
 expect(state.dailyResults.at(-1)).toEqual({read:scheduledReads+1,status:200});expect(state.fleetReads).toBe(reads);
 // Entering the iframe triggers DailyBoard's legitimate focus refresh before
 // the button's own fresh read. Settle that separately, then gate only the click.
 const focusState=()=>frame.locator('body').evaluate(()=>({focused:document.hasFocus(),events:window.tvLifecycleEvents.filter(event=>event.type==='focus').length}));
 const beforeFocus=await focusState(),focusReads=state.reads;
 await refreshButton.focus();await expect(refreshButton).toBeFocused();
 const focusDelta=beforeFocus.focused?0:1;
 await expect.poll(async()=>{const current=await focusState();return {focused:current.focused,events:current.events-beforeFocus.events};}).toEqual({focused:true,events:focusDelta});
 await expect.poll(()=>state.reads).toBe(focusReads+focusDelta);
 await expect(refreshButton).toHaveAttribute('aria-busy','false');await expect.poll(()=>state.pendingDaily).toBe(0);
 expect(state.dailyResults.at(-1)).toEqual({read:focusReads+focusDelta,status:200});expect(state.fleetReads).toBe(reads);
 const dailyReads=state.reads,gate=deferred();state.dailyGate=gate;
 await refreshButton.click();
 await expect.poll(()=>state.fleetReads).toBe(reads+3);
 // Fleet request starts do not prove that the parallel daily-board read settled.
 // Hold that response to verify this boundary before injecting the next denial.
 await expect.poll(()=>state.reads).toBe(dailyReads+1);await expect(refreshButton).toHaveAttribute('aria-busy','true');
 gate.resolve();await expect(refreshButton).toHaveAttribute('aria-busy','false');
 await expect.poll(()=>state.pendingDaily).toBe(0);expect(state.dailyResults.at(-1)).toEqual({read:dailyReads+1,status:200});
 expect(state.reads).toBe(dailyReads+1);expect(state.fleetReads).toBe(reads+3);expect((await focusState()).events-beforeFocus.events).toBe(focusDelta);
 expect(await frame.locator('body').evaluate(()=>window.tvLifecycleEvents.filter(event=>event.type==='invalidated'))).toEqual([]);expect(state.writes).toEqual([]);
 state.fail=401;await refreshButton.click();
 await expectOperationsReloadRequired(frame);
 await expect(frame.locator('.tv-fleet-map .leaflet-marker-icon')).toHaveCount(0);
 await expect(frame.getByRole('region',{name:'Tech Check TV Board'})).toHaveCount(0);await expect(refreshButton).toHaveCount(0);
 await expect.poll(()=>state.dailyResults.at(-1)).toEqual({read:dailyReads+2,status:401});expect(state.reads).toBe(dailyReads+2);expect(state.writes).toEqual([]);
});

test('TV uses the Field Map background and retains pins when optional feeds fail',async({page})=>{
 const {state,frame}=await setup(page);
 state.settings={sections:['map'],revision:1,updatedAt:time};
 state.fleetFailures={'/api/camera-health/summary-v3':503,'/api/routers':503};
 await page.clock.fastForward(60000);
 await expect(frame.getByRole('region',{name:'Tech Check TV Board'})).toHaveAttribute('data-section','map');
 await expect(frame.locator('.tv-fleet-map .leaflet-marker-icon')).toHaveCount(1);
 await expect(frame.locator('.tv-fleet-warning')).toContainText('Camera Health: Connection unavailable');
 await expect(frame.locator('.tv-fleet-warning')).toContainText('Routers: Connection unavailable');
 await expect(frame.locator('.tv-fleet-summary')).toContainText('1 unverified');
 await expect(frame.locator('.tv-fleet-map .leaflet-tile').first()).toHaveAttribute('src',/^https:\/\/tile\.openstreetmap\.org\//);
 expect(state.writes).toEqual([]);
});

test('TV reads the same complete mHelp Field address layer as Fleet, groups dense sites and preserves GPS distinction',async({page})=>{
 const {state,frame}=await setup(page);
 state.fleetUnits[0]={...state.fleetUnits[0],latitude:32.77,longitude:-96.79}; // Distinct native site, not a claimed mHelp Product-ID duplicate.
 const source='a'.repeat(64),payload='b'.repeat(64);
 const head={sourceSha256:source,payloadSha256:payload,summary:{totalRecords:1001},records:Array.from({length:1001},(_,i)=>({productId:String(i+1),placement:i<287?'FIELD':'SHOP'}))};
 const address={contract:'COS_MHELP_CENSUS_ADDRESS_MAP_V1',sourceSha256:source,payloadSha256:payload,totalProducts:1001,fieldProducts:287,shopProducts:714,verifiedGps:false,liveGps:false,confidence:'mhelpdesk_customer_address_reference_only',
  items:Array.from({length:287},(_,i)=>({productId:String(i+1),sourceRowSha256:'c'.repeat(64),unitNumber:'Field unit '+String(i+1),customer:'Saved customer',category:'Spotter',placement:'FIELD',lifecycle:'UNFLAGGED',placementHeld:false,sourceAddress:{street:'123 Example Rd',city:'Houston',state:'TX',zip:'77064'},status:'matched',reason:null,matchedAddress:'123 EXAMPLE RD, HOUSTON, TX, 77064',latitude:29.9,longitude:-95.3,geocodedAt:time,geocodeSource:'us_census_address_range',verified:false,liveGps:false,confidence:'mhelpdesk_address_census_range_unverified'}))};
 state.fieldMapExtras={uploadInventory:head,mhelpAddressMap:address};
 state.settings={sections:['map'],revision:1,updatedAt:time};
 await page.clock.fastForward(60000);
 const map=frame.locator('.tv-fleet-map'),groups=map.locator('.cos-compact-group-marker');
 await expect(frame.getByRole('region',{name:'Tech Check TV Board'})).toHaveAttribute('data-section','map');
 await expect(frame.locator('.tv-fleet-summary')).toContainText('287 mHelp address pins');
 await expect(frame.locator('.tv-fleet-summary')).toContainText('1 GPS-verified');
 await expect(groups).toHaveCount(1);
 await expect(groups).toHaveAttribute('data-group-count','287'); // All 287 Product IDs remain selectable; the native unit is separately located.
 await groups.click();
 await expect(frame.locator('.cos-compact-group-popup')).toContainText('287 equipment at nearby locations');
 await expect(frame.locator('.cos-compact-show-all')).toBeVisible();
 expect(state.writes).toEqual([]);
});

function fieldUnit(index,latitude=29.986,longitude=-95.311){return {id:'bbbbbbbb-bbbb-4bbb-8bbb-'+String(index).padStart(12,'0'),unitNumber:'Sniper '+(312+index),modelName:'SNIPER',status:'installed',site:'Field site '+index,address:'Field address '+index,latitude,longitude,locationVerification:'owner_verified',locationVerifiedAt:time,gpsRecordedAt:time};}
function cameraRow(unit,status){return {id:'resource-'+unit.id,name:unit.unitNumber+' connection',unit:unit.unitNumber,status,scope:'field',activationState:'active',serviceEvidence:{kind:'service_port',source:'Saved connection',status,active:true,resource:'service',observedAt:time,lastOnlineAt:status==='online'?time:'2026-10-12T14:00:00Z',reachable:status==='online',confirmedOutage:status==='offline'}};}

test('Camera Health rotates every red outage and never lists green or unknown units',async({page},testInfo)=>{
 // This exact page-by-page test owns elapsed time; wall-clock progress must not
 // race its synthetic ticks. Other TV tests retain their existing clock mode.
 const {state,frame}=await setup(page,{pausedClock:true});
 const board=frame.getByRole('region',{name:'Tech Check TV Board'}),clockSteps=[];
 const capture=async event=>{
  const current=await board.evaluate(node=>({now:Date.now(),page:node.dataset.page,section:node.dataset.section,summary:node.querySelector('.tv-fleet-summary')?.textContent??'',labels:[...node.querySelectorAll('.tv-fleet-record h3')].map(label=>label.textContent)}));
  clockSteps.push({event,...current,fleetReads:state.fleetReads,writes:state.writes.length});return current;
 };
 let elapsed=0;
 const advance=async milliseconds=>{
  expect((await capture('before advance '+milliseconds)).now).toBe(Date.parse(time)+elapsed);
  await page.clock.fastForward(milliseconds);elapsed+=milliseconds;
  expect((await capture('after advance '+milliseconds)).now).toBe(Date.parse(time)+elapsed);
 };
 try{
 const red=Array.from({length:6},(_,index)=>fieldUnit(index,29.986+index*.001,-95.311));
 const green=fieldUnit(8,32.77,-96.79),unknown=fieldUnit(9,30.26,-97.74);
 state.fleetUnits=[...red,green,unknown];state.cameraRows=[...red.map(unit=>cameraRow(unit,'offline')),cameraRow(green,'online')];
 state.settings={sections:['camera'],revision:1,updatedAt:time,rotationSeconds:15};
 await advance(60000);
 await expect(frame.locator('.tv-fleet-summary')).toContainText('6 down units');
 const perPage=page.viewportSize().width<900?1:4,parts=Math.ceil(red.length/perPage);
 await expect(board).toHaveAttribute('data-page','1');
 await expect(frame.locator('.tv-fleet-summary')).toContainText('Red units only · 1 / '+parts);
 const names=new Set();
 for(let index=0;index<6;index++){
  if(index)await advance(15000);
  const part=index%parts;
  // A visible prior card is not proof that React committed this timer's rotation.
  await expect(board).toHaveAttribute('data-page',String(part+1));
  await expect(frame.locator('.tv-fleet-record h3')).toHaveText(red.slice(part*perPage,(part+1)*perPage).map(unit=>unit.unitNumber));
  await expect(frame.locator('.tv-fleet-record').first()).toBeVisible();
  const labels=await frame.locator('.tv-fleet-record h3').allTextContents();labels.forEach(label=>names.add(label));
  await expect(frame.locator('.tv-fleet-record:not(.tv-state-offline)')).toHaveCount(0);
  expect(labels).not.toContain(green.unitNumber);expect(labels).not.toContain(unknown.unitNumber);
  await capture('settled sample '+index);
 }
 expect([...names].sort()).toEqual(red.map(unit=>unit.unitNumber).sort());
 await advance(15000);await expect(board).toHaveAttribute('data-page','1');
 await expect(frame.locator('.tv-fleet-record h3')).toHaveText(red.slice(0,perPage).map(unit=>unit.unitNumber));
 expect(state.fleetReads).toBe(3);expect(state.writes).toEqual([]);
 }finally{
  await capture('final').catch(error=>clockSteps.push({event:'final capture unavailable',message:error.message}));
  const diagnosticPath=testInfo.outputPath('tv-rotation-clock.json');
  await writeFile(diagnosticPath,JSON.stringify(clockSteps,null,2));
  await testInfo.attach('tv-rotation-clock',{path:diagnosticPath,contentType:'application/json'});
 }
});

test('Field Map visits overview and geographic close-ups with the red area first',async({page})=>{
 const {state,frame}=await setup(page);
 const red=fieldUnit(0),green=fieldUnit(1,32.77,-96.79);
 state.fleetUnits=[red,green];state.cameraRows=[cameraRow(red,'offline'),cameraRow(green,'online')];
 state.settings={sections:['map'],revision:1,updatedAt:time,rotationSeconds:15};
 await page.clock.fastForward(60000);
 const wrap=frame.locator('.tv-fleet-map-wrap'),map=frame.locator('.tv-fleet-map');
 await expect(wrap).toHaveAttribute('data-area-kind','overview');
 await expect.poll(async()=>Number(await map.getAttribute('data-zoom'))).toBeLessThan(11);
 await page.clock.fastForward(15000);
 await expect(wrap).toHaveAttribute('data-area-kind','closeup');
 await expect(frame.locator('.tv-map-area')).toContainText('Area near '+red.unitNumber);
 await expect(frame.locator('.tv-map-area')).toContainText('1 down');
 await expect.poll(async()=>Number(await map.getAttribute('data-zoom'))).toBe(13);
 await page.clock.fastForward(15000);
 await expect(frame.locator('.tv-map-area')).toContainText('Area near '+green.unitNumber);
 await expect(frame.locator('.tv-map-area')).toContainText('1 online');
 expect(state.fleetReads).toBe(3);expect(state.writes).toEqual([]);
});

test('Owner saves rotation time and a remote timing update changes the TV interval',async({page})=>{
 const {state,frame}=await setup(page);
 await frame.getByRole('button',{name:'Exit TV',exact:true}).click();
 const controls=frame.getByRole('region',{name:'TV board settings'});
 await controls.getByRole('checkbox',{name:'Shop updates',exact:true}).uncheck();
 await controls.getByRole('checkbox',{name:'Field Map',exact:true}).check();
 await controls.getByRole('spinbutton',{name:'Rotation time (seconds)',exact:true}).fill('30');
 await controls.getByRole('button',{name:'Save TV settings',exact:true}).click();
 await expect(controls.getByText('TV settings saved and verified.',{exact:true})).toBeVisible();
 expect(state.settings.rotationSeconds).toBe(30);expect(state.settings.sections).toEqual(['map']);
 expect(state.writes[0].path).toBe('/api/tv-board/settings');
 expect(state.writes[0].body.expectedRevision).toBe(1000000030);
 await frame.getByRole('button',{name:'TV View',exact:true}).click();
 const board=frame.getByRole('region',{name:'Tech Check TV Board'});
 await expect(frame.locator('.tv-fleet-map .leaflet-marker-icon')).toHaveCount(1);
 await expect(board).toContainText('Rotate 30s');
 await page.clock.fastForward(25000);await expect(board).toHaveAttribute('data-page','1');
 await page.clock.fastForward(6000);await expect(board).toHaveAttribute('data-page','2');
 state.settings={...state.settings,revision:state.settings.revision+1,rotationSeconds:5};
 await page.clock.fastForward(30000);await expect(board).toContainText('Rotate 5s');
 await expect(board).toHaveAttribute('data-page','1');
 await page.clock.fastForward(3000);await expect(board).toHaveAttribute('data-page','1');
 await page.clock.fastForward(3000);await expect(board).toHaveAttribute('data-page','2');
 expect(state.fleetReads).toBe(3);
});

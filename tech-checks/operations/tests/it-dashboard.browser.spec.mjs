import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {itHomeFixture} from './it-home-fixture.mjs';
import {snapshot,resource} from './fixtures/camera-evidence-fixtures.mjs';
import {routerFixture} from './fixtures/routers.mjs';

// The real authenticated host and built application run against synthetic data.
// Every external request is intercepted; no live service or write is involved.
const origin=process.env.COS_IT_DASHBOARD_TEST_ORIGIN||'http://127.0.0.1:4173';
const dist=resolve(process.env.COS_IT_DASHBOARD_TEST_DIST||fileURLToPath(new URL('../dist',import.meta.url)));
const readHost=name=>readFileSync(new URL('../../'+name,import.meta.url),'utf8');
const workbook='1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA';
const unitId='11111111-1111-4111-8111-111111111111';
const sourcePaths={field:'/api/field-map',routers:'/api/routers',cameras:'/api/camera-health/summary-v3',victron:'/api/vrm-fleet',tracker:'/api/unit-tracker'};
const sourceIds=[...Object.keys(sourcePaths),'mhelp'];
const tickets=[
  {ticket_no:'SYN-4101',site:'Synthetic north site',work_type:'delivery',scheduled_for:'2026-10-09',scheduled_time:'08:30:00',all_finished:false,equipment_manifest:[{label:'Synthetic Sniper',qty:2,category:'device'}],password:'RAW_SECRET_NOT_FOR_FRAME',invoice_total:'RAW_FINANCE_NOT_FOR_FRAME',customer_email:'RAW_CONTACT_NOT_FOR_FRAME',metadata:{access_token:'RAW_TOKEN_NOT_FOR_FRAME'}},
  {ticket_no:'SYN-4102',site:'Synthetic west site',work_type:'pickup',scheduled_for:'2026-10-10',scheduled_time:null,all_finished:true,equipment_manifest:[{label:'Synthetic Helios',qty:1,category:'device'}]},
];
const syntheticInstallation=(id,name)=>({installationId:id,name,portalUrl:`https://vrm.victronenergy.com/installation/${id}/dashboard`,embedUrl:null});
const syntheticFleet=()=>({items:Array.from({length:11},(_,index)=>syntheticInstallation(9100001+index,'Synthetic power site '+(index+1))),sync:{state:'current',lastAttemptAt:'2026-10-09T12:00:00Z',lastSuccessAt:'2026-10-09T12:00:00Z',nextSyncAt:'2026-10-09T12:15:00Z',error:null,scheduleActive:true}});
const gate=()=>{let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};};
const dashboard=frame=>frame.getByRole('region',{name:'IT Dashboard',exact:true});
const card=(frame,source)=>dashboard(frame).locator('[data-source="'+source+'"]');
const count=(frame,source)=>card(frame,source).locator('.it-dashboard-count>strong');

async function mount(page,{role='it',linked=true,slowLegacy=false,holdSource=null,holdSession=false,holdCapability=false,unitTracker=true,vrmRead=true,...options}={}){
  const state={calls:[],errors:[],unexpected:[],fail:{},holds:new Map(),fleet:syntheticFleet()};
  if(holdSource&&holdSource!=='mhelp')state.holds.set(sourcePaths[holdSource],gate());
  if(holdSession)state.holds.set('/api/session',gate());
  state.release=source=>state.holds.get(sourcePaths[source]||source)?.release();
  page.on('pageerror',error=>state.errors.push(error.message));
  await page.addInitScript(()=>{window.fixtureMhelpResponses=[];addEventListener('message',event=>{if(event.data?.type==='COS_IT_MHELP_RESPONSE')window.fixtureMhelpResponses.push(event.data);});});
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===origin&&url.pathname==='/it-dashboard-fixture'){
      let html=itHomeFixture(role,linked,{dashboard:true,mhelpTickets:tickets,...options});
      if(slowLegacy)html=html.replace('async function loadITManagedTickets(){return []};','async function loadITManagedTickets(){return new Promise(()=>{});};');
      // Instrument only the synthetic context, never the production host.
      const controls=`<script>
        window.fixtureRpcCalls=[];window.fixtureMhelpFail=false;window.fixtureMhelpEmpty=false;
        window.fixtureCapabilityHeld=${holdCapability};
        window.fixtureCapabilityGate=new Promise(resolve=>{window.fixtureReleaseCapability=()=>{window.fixtureCapabilityHeld=false;resolve();};});
        window.fixtureMhelpHeld=${holdSource==='mhelp'};
        window.fixtureMhelpGate=new Promise(resolve=>{window.fixtureReleaseMhelp=()=>{window.fixtureMhelpHeld=false;resolve();};});
        const originalRpc=window.TechCheckContext.db.rpc;
        window.TechCheckContext.db.rpc=async name=>{
          window.fixtureRpcCalls.push(name);
          if(name==='my_managed_tickets_v1'){
            const value=await originalRpc(name);
            if(window.fixtureMhelpHeld)await window.fixtureMhelpGate;
            return window.fixtureMhelpFail?{error:{message:'Synthetic MHelp unavailable'}}:window.fixtureMhelpEmpty?{data:[]}:value;
          }
          if(name==='cos_verified_fleet_capabilities_v1'&&window.fixtureCapabilityHeld)await window.fixtureCapabilityGate;
          return originalRpc(name);
        };
      </script>`;
      html=html.replace('<script type="module" src="/fleet-host-fixture.js"></script>',controls+'<script type="module" src="/fleet-host-fixture.js"></script>');
      return route.fulfill({contentType:'text/html',body:html});
    }
    if(url.href===origin+'/fleet-host-fixture.js')return route.fulfill({contentType:'text/javascript',body:readHost('verified-it-fleet-host.js')+'\nwindow.fixtureHostLoaded=true;'});
    if(url.origin===origin&&['/it-mhelp-projection.js','/field-map-display-host.js'].includes(url.pathname))return route.fulfill({contentType:'text/javascript',body:readHost(url.pathname.slice(1))});
    if(url.origin===origin&&url.pathname.startsWith('/resources/fonts/'))return route.fulfill({path:new URL('../../resources/fonts/'+url.pathname.split('/').pop(),import.meta.url).pathname});
    if(url.origin===origin&&url.pathname==='/techcheck-eye-favicon-32.png')return route.fulfill({path:new URL('../../techcheck-eye-favicon-32.png',import.meta.url).pathname});
    if(url.origin===origin){
      const pathname=url.pathname.replace(/^\/operations\/dist/,'')||'/';
      const path=resolve(dist,pathname==='/'?'index.html':'.'+decodeURIComponent(pathname));
      if(path.startsWith(dist+'/')&&existsSync(path))return route.fulfill({path,contentType:{'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.woff':'font/woff','.png':'image/png'}[extname(path)]||'application/octet-stream'});
      return route.abort();
    }
    if(!url.pathname.endsWith('/functions/v1/cos-operations-pages'))return route.abort();
    const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
    const call=request.postDataJSON();state.calls.push(call);
    if(call.method!=='GET'||!['/api/session',...Object.values(sourcePaths)].includes(call.path)){
      state.unexpected.push(call);
      return route.fulfill({status:405,headers,contentType:'application/json',body:JSON.stringify({error:'Synthetic fixture refuses non-snapshot requests'})});
    }
    const held=state.holds.get(call.path);if(held)await held.promise;
    if(state.fail[call.path])return route.fulfill({status:state.fail[call.path],headers,contentType:'application/json',body:JSON.stringify({error:'Synthetic '+call.path+' unavailable'})});
    const now=new Date().toISOString();
    const fieldUnit={id:unitId,unitNumber:'Synthetic Helios 001',modelName:'Helios',status:'installed',currentLocationType:'site',site:'Synthetic north site',address:'100 Synthetic Road, Houston TX 77001',latitude:29.76,longitude:-95.37,locationVerification:'owner_verified',gpsRecordedAt:now,locationVerifiedAt:now,coordinateSource:'site',hasUnitGps:true};
    const responses={
      '/api/session':{authorized:true,legacyOwner:false,role:'IT',name:'Synthetic Technician',features:{fleetAccess:true,unitTracker,vrmRead,importedUnitAddressEdit:false}},
      '/api/field-map':{items:[fieldUnit],inventoryItems:[fieldUnit],summary:{fieldUnits:1,mappedUnits:1,unitGps:1,missingGps:0},generatedAt:now},
      '/api/routers':routerFixture(),
      '/api/camera-health/summary-v3':snapshot([resource(1,'Synthetic Helios 001',{name:'Synthetic camera',status:'online',checkedAt:now,evidence:{kind:'provider',source:'Star4Live',resource:'camera',active:true,status:'online',observedAt:now,lastOnlineAt:now}})]),
      '/api/vrm-fleet':state.fleet,
      '/api/unit-tracker':{contract:'COS_UNIT_TRACKER_OUTBOX_V1',workbookId:workbook,connector:{enabled:false,state:'awaiting_sheets_connection'},queueEnabled:false,availability:'available',sources:[],requests:[],sourcesHeld:0,sourcesTruncated:false,requestsTruncated:false},
    };
    return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(responses[call.path])});
  });
  await page.goto(origin+'/it-dashboard-fixture');
  await expect.poll(()=>page.evaluate(()=>window.fixtureHostLoaded)).toBe(true);
  return {state,frame:page.frameLocator('dialog>iframe')};
}

async function ready(frame,except=null){
  await expect(dashboard(frame)).toBeVisible();
  await expect(dashboard(frame).locator('article')).toHaveCount(6);
  for(const source of sourceIds.filter(id=>id!==except))await expect(card(frame,source).locator('time')).toHaveCount(1);
}
async function navigate(frame,label){
  await frame.getByRole('button',{name:'More',exact:true}).first().click();
  await frame.getByRole('dialog',{name:'Operations navigation'}).getByRole('navigation',{name:'COS Operations',exact:true}).getByRole('button',{name:label,exact:true}).click();
}
const assertReads=state=>{expect(state.unexpected).toEqual([]);expect(state.calls.every(call=>call.method==='GET'&&call.body===null)).toBe(true);expect(state.errors).toEqual([]);};

for(const secondVerified of [false,true])test('verified IT '+(secondVerified?'second':'first')+' sign-in opens six independent cards with current saved counts',async({page},info)=>{
  const {frame,state}=await mount(page,{secondVerified});await ready(frame);
  await expect(page.locator('dialog')).toHaveCount(1);await expect(page.locator('dialog>iframe')).toHaveAttribute('src',/\?mode=fleet#it-dashboard$/);
  await expect(count(frame,'field')).toHaveText('1');await expect(count(frame,'routers')).toHaveText('4');await expect(count(frame,'cameras')).toHaveText('1');
  await expect(count(frame,'victron')).toHaveText('11');await expect(count(frame,'tracker')).toHaveText('0');await expect(count(frame,'mhelp')).toHaveText('2');
  await expect(card(frame,'mhelp')).toContainText('Synthetic north site');
  await expect(card(frame,'routers')).toContainText('Stale / unverified');
  const viewport=page.viewportSize(),bounds=await page.locator('dialog').boundingBox();
  expect(bounds.x).toBe(0);expect(bounds.y).toBe(0);expect(bounds.width).toBe(viewport.width);expect(bounds.height).toBe(viewport.height);
  const fit=await frame.locator('body').evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth}));expect(fit.content).toBeLessThanOrEqual(fit.width);
  for(const source of sourceIds){const button=card(frame,source).getByRole('button',{name:/^Open /});expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);}
  await page.screenshot({path:info.outputPath('it-dashboard-'+(secondVerified?'second':'first')+'.png')});assertReads(state);
});

test('IT dashboard opens while the old all-source Home loader is still pending',async({page})=>{
  const {frame,state}=await mount(page,{slowLegacy:true});await ready(frame);
  await expect(page.locator('#wlItHome')).toContainText('Loading Home');await expect(page.locator('#wlItHome .wl-it-command-head')).toHaveCount(0);
  await expect(count(frame,'mhelp')).toHaveText('2');assertReads(state);
});

test('all six cards retain their workspaces, browser Back and Dashboard return',async({page})=>{
  const {frame,state}=await mount(page);await ready(frame);
  const routes={field:'#field-map',routers:'#inhand-routers',cameras:'#camera-health',victron:'#victron-vrm',tracker:'#unit-tracker',mhelp:'#mhelp'};
  for(const source of sourceIds){
    await card(frame,source).getByRole('button',{name:/^Open /}).click();
    await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe(routes[source]);
    if(source==='field')await expect(frame.getByLabel('COS field unit map')).toBeVisible();
    if(source==='routers')await expect(frame.getByRole('heading',{name:'Router inventory & reachability'})).toBeVisible();
    if(source==='cameras')await expect(frame.locator('.camera-overview-card')).toHaveCount(1);
    if(source==='victron')await expect(frame.getByRole('navigation',{name:'Helios installations'}).getByRole('button')).toHaveCount(11);
    if(source==='tracker')await expect(frame.getByRole('region',{name:'Unit Tracker workspace'})).toBeVisible();
    if(source==='mhelp')await expect(frame.getByRole('region',{name:'MHelp information'})).toContainText('SYN-4101');
    await frame.locator('body').evaluate(()=>history.back());await ready(frame);
  }
  await card(frame,'mhelp').getByRole('button',{name:/^Open /}).click();await navigate(frame,'IT Dashboard');await ready(frame);
  await navigate(frame,'Tech Checks');await frame.getByRole('button',{name:'Return to my IT Tech Checks',exact:true}).click();
  await expect(page.locator('dialog,iframe')).toHaveCount(0);await expect(page.locator('[data-cos-it-dashboard]')).toBeFocused();assertReads(state);
});

test('redraws, repeated open clicks, Escape and explicit return leave one reusable dashboard entry',async({page})=>{
  const {frame,state}=await mount(page);await ready(frame);
  for(let index=0;index<3;index++){
    await page.evaluate(()=>window.renderITHome());await expect(page.locator('dialog')).toHaveCount(1);await expect(page.locator('[data-cos-it-dashboard]')).toHaveCount(1);
    if(index===1)await page.getByRole('button',{name:'Return to IT Tech Checks'}).click();else await page.keyboard.press('Escape');
    await expect(page.locator('dialog,iframe')).toHaveCount(0);
    const entry=page.locator('[data-cos-it-dashboard]');await expect(entry).toBeFocused();
    await page.evaluate(()=>window.renderITHome());await expect(entry).toBeVisible();await expect(page.locator('dialog')).toHaveCount(0);
    await entry.evaluate(button=>{button.click();button.click();});await ready(frame);await expect(page.locator('dialog')).toHaveCount(1);
  }
  assertReads(state);
});

for(const source of sourceIds)test(source+' slow and failed read cannot block other cards; retry reads only that source',async({page})=>{
  const {frame,state}=await mount(page,{holdSource:source});await ready(frame,source);
  const pending=card(frame,source);await expect(pending.getByRole('status')).toHaveText('Loading');await expect(pending.locator('time')).toHaveCount(0);
  await expect(pending.getByRole('button',{name:/^Open /})).toBeEnabled();
  if(source==='mhelp')await page.evaluate(()=>{window.fixtureMhelpFail=true;window.fixtureReleaseMhelp();});
  else{state.fail[sourcePaths[source]]=503;state.release(source);}
  await expect(pending.getByRole('status')).toHaveText('Unavailable');await expect(pending.getByRole('alert')).toBeVisible();
  const before=state.calls.length,beforeMhelp=await page.evaluate(()=>window.fixtureRpcCalls.filter(name=>name==='my_managed_tickets_v1').length);
  if(source==='mhelp')await page.evaluate(()=>{window.fixtureMhelpFail=false;});else delete state.fail[sourcePaths[source]];
  await pending.getByRole('button',{name:/^Retry /}).click();await ready(frame);
  await expect(pending.getByRole('alert')).toHaveCount(0);
  expect(state.calls.slice(before).map(call=>call.path)).toEqual(source==='mhelp'?[]:[sourcePaths[source]]);
  const afterMhelp=await page.evaluate(()=>window.fixtureRpcCalls.filter(name=>name==='my_managed_tickets_v1').length);expect(afterMhelp-beforeMhelp).toBe(source==='mhelp'?1:0);assertReads(state);
});

test('MHelp crosses the real host bridge with only operational ticket fields',async({page})=>{
  const {frame,state}=await mount(page);await ready(frame);
  const payload=await frame.locator('body').evaluate(()=>window.fixtureMhelpResponses.find(message=>message.items?.length));
  expect(payload.items).toHaveLength(2);
  expect(Object.keys(payload.items[0]).sort()).toEqual(['equipment','finished','scheduledFor','scheduledTime','site','ticketNumber','workType']);
  expect(payload.items[0]).toMatchObject({ticketNumber:'SYN-4101',site:'Synthetic north site',workType:'delivery',scheduledFor:'2026-10-09',finished:false,equipment:['2 × Synthetic Sniper']});
  expect(JSON.stringify(payload)).not.toMatch(/RAW_|password|invoice_total|customer_email|access_token/);
  await card(frame,'mhelp').getByRole('button',{name:/^Open /}).click();
  const workspace=frame.getByRole('region',{name:'MHelp information'});await expect(workspace).toContainText('SYN-4101');await expect(workspace).toContainText('Synthetic Sniper');
  await expect(workspace).not.toContainText('RAW_');await expect(workspace.getByRole('button',{name:/save|import|edit|sync/i})).toHaveCount(0);
  const rpc=await page.evaluate(()=>window.fixtureRpcCalls);expect(rpc).toContain('my_managed_tickets_v1');expect(rpc.every(name=>['cos_verified_fleet_capabilities_v1','my_managed_tickets_v1'].includes(name))).toBe(true);
  await workspace.getByRole('button',{name:'Open existing IT Tech Checks →',exact:true}).click();await expect(page.locator('dialog,iframe')).toHaveCount(0);assertReads(state);
});

test('IT Victron reads all eleven saved installations and reload never triggers discovery',async({page})=>{
  const {frame,state}=await mount(page);await ready(frame);await card(frame,'victron').getByRole('button',{name:/^Open /}).click();
  const installations=frame.getByRole('navigation',{name:'Helios installations'});await expect(installations.getByRole('button')).toHaveCount(11);
  await installations.getByRole('button').last().click();await expect(frame.getByRole('heading',{name:'Synthetic power site 11',exact:true})).toBeVisible();
  await expect(frame.getByRole('button',{name:'Next Helios unit',exact:true})).toBeDisabled();
  const before=state.calls.length;state.fleet.items=[...state.fleet.items].reverse();await frame.getByRole('button',{name:'Reload saved fleet',exact:true}).click();
  await expect(frame.getByRole('button',{name:'Reload saved fleet',exact:true})).toBeEnabled();
  await expect(frame.getByRole('heading',{name:'Synthetic power site 11',exact:true})).toBeVisible();
  expect(state.calls.slice(before).map(call=>call.path)).toEqual(['/api/vrm-fleet']);
  expect(state.calls.filter(call=>call.path.startsWith('/api/vrm-')).every(call=>call.path==='/api/vrm-fleet'&&call.method==='GET')).toBe(true);
  await expect(frame.getByRole('button',{name:'Refresh fleet',exact:true})).toHaveCount(0);assertReads(state);
});

for(const options of [{role:'service'},{linked:false},{capability:false},{active:false},{archived:true},{effectiveRole:'owner'},{effectiveRole:'service'}])test('restricted '+JSON.stringify(options)+' gets no dashboard, source calls or tokens',async({page})=>{
  const {state}=await mount(page,options);await expect(page.locator('[data-cos-it-dashboard],[data-cos-field-view],[data-cos-unit-tracker],dialog,iframe')).toHaveCount(0);
  expect(await page.evaluate(()=>window.fixtureTokens)).toBe(0);expect(state.calls).toEqual([]);expect(await page.evaluate(()=>window.fixtureRpcCalls.includes('my_managed_tickets_v1'))).toBe(false);assertReads(state);
});

for(const action of ['role loss','signout'])test(action+' removes the open dashboard and prevents late MHelp data from returning',async({page})=>{
  const {frame,state}=await mount(page,{holdSource:'mhelp'});await ready(frame,'mhelp');
  await expect.poll(()=>page.evaluate(()=>window.fixtureRpcCalls.includes('my_managed_tickets_v1'))).toBe(true);
  await page.evaluate(action=>{
    if(action==='signout'){window.fixtureSubject=null;window.fixtureAuthChanged('SIGNED_OUT');}
    else{window.fixtureRole='service';document.getElementById('appView').classList.add('role-changed');}
  },action);
  await expect(page.locator('[data-cos-it-dashboard],dialog,iframe')).toHaveCount(0);
  const issued=await page.evaluate(()=>window.fixtureTokens);await page.evaluate(()=>window.fixtureReleaseMhelp());
  await page.evaluate(()=>window.renderITHome());await expect(page.locator('dialog,iframe')).toHaveCount(0);
  expect(await page.evaluate(()=>window.fixtureTokens)).toBe(issued);await expect(page.locator('#appView')).toBeVisible();assertReads(state);
});

test('late session permission response cannot reopen a dashboard after role loss',async({page})=>{
  const {state}=await mount(page,{holdSession:true});await expect.poll(()=>state.calls.filter(call=>call.path==='/api/session').length).toBeGreaterThan(0);
  await page.evaluate(()=>{window.fixtureRole='service';document.getElementById('appView').classList.add('role-changed');});await expect(page.locator('dialog,iframe')).toHaveCount(0);
  state.release('/api/session');await expect(page.locator('[data-cos-it-dashboard],[data-cos-unit-tracker],dialog,iframe')).toHaveCount(0);expect(state.calls.every(call=>call.path==='/api/session')).toBe(true);
});

test('a denied source refresh clears its previous data without clearing independent sources',async({page})=>{
  const {frame,state}=await mount(page);await ready(frame);await expect(count(frame,'victron')).toHaveText('11');
  state.fail['/api/vrm-fleet']=403;await card(frame,'victron').getByRole('button',{name:/^Refresh /}).click();
  await expect(card(frame,'victron').getByRole('status')).toHaveText('Unavailable');await expect(count(frame,'victron')).toHaveCount(0);await expect(card(frame,'victron').locator('time')).toHaveCount(0);
  await expect(count(frame,'field')).toHaveText('1');await expect(count(frame,'mhelp')).toHaveText('2');assertReads(state);
});

test('delayed capability approval never interrupts a newer Tech Checks tool',async({page})=>{
  const {frame,state}=await mount(page,{holdCapability:true});
  await expect(page.locator('#wlItHome')).toBeVisible();
  await page.evaluate(()=>{document.getElementById('wlItHome').style.display='none';document.getElementById('existing-it-tool').style.display='block';window.fixtureReleaseCapability();});
  await expect.poll(()=>page.evaluate(()=>window.fixtureCapabilityHeld)).toBe(false);
  await expect(page.locator('dialog,iframe')).toHaveCount(0);await expect(page.locator('#existing-it-tool')).toBeVisible();
  await page.evaluate(()=>window.renderITHome());await ready(frame);assertReads(state);
});

test('token refresh preserves the current view and does not reopen a dismissed dashboard',async({page})=>{
  const {frame,state}=await mount(page);await ready(frame);
  await card(frame,'mhelp').getByRole('button',{name:/^Open /}).click();await expect(frame.getByRole('region',{name:'MHelp information'})).toContainText('SYN-4101');
  const reads=state.calls.length;await page.evaluate(()=>window.fixtureAuthChanged('TOKEN_REFRESHED'));
  await expect(frame.getByRole('region',{name:'MHelp information'})).toContainText('SYN-4101');await expect(page.locator('dialog')).toHaveCount(1);expect(state.calls.length).toBe(reads);
  await page.getByRole('button',{name:'Return to IT Tech Checks'}).click();await expect(page.locator('dialog,iframe')).toHaveCount(0);
  await page.evaluate(()=>{window.fixtureAuthChanged('TOKEN_REFRESHED');window.renderITHome();});await expect(page.locator('dialog,iframe')).toHaveCount(0);assertReads(state);
});

test('a late token failure from a closed dashboard cannot close its replacement',async({page})=>{
  const {frame,state}=await mount(page);await ready(frame);
  await page.evaluate(()=>{
    const original=window.TechCheckContext.db.auth.getSession;
    window.fixtureHeldTokenStarted=false;
    window.TechCheckContext.db.auth.getSession=()=>{
      window.TechCheckContext.db.auth.getSession=original;
      window.fixtureHeldTokenStarted=true;
      return new Promise(resolve=>{window.fixtureReleaseToken=()=>resolve({data:{session:null}});});
    };
  });
  await card(frame,'field').getByRole('button',{name:/^Refresh /}).click();await expect.poll(()=>page.evaluate(()=>window.fixtureHeldTokenStarted)).toBe(true);
  await page.getByRole('button',{name:'Return to IT Tech Checks'}).click();await expect(page.locator('dialog,iframe')).toHaveCount(0);
  await page.locator('[data-cos-it-dashboard]').click();await ready(frame);
  await page.evaluate(()=>window.fixtureReleaseToken());await ready(frame);await expect(page.locator('dialog')).toHaveCount(1);assertReads(state);
});

for(const source of ['field','mhelp'])test('late '+source+' capability denial belongs only to its original frame',async({page})=>{
  const {frame,state}=await mount(page);await ready(frame);
  await page.evaluate(()=>{
    const original=window.TechCheckContext.db.rpc;let held=false;
    window.fixtureHeldVerifyStarted=false;
    window.TechCheckContext.db.rpc=name=>{
      if(name==='cos_verified_fleet_capabilities_v1'&&!held){
        held=true;window.fixtureHeldVerifyStarted=true;
        return new Promise(resolve=>{window.fixtureReleaseVerify=()=>resolve({data:{fleetRead:false}});});
      }
      return original(name);
    };
  });
  await card(frame,source).getByRole('button',{name:/^Refresh /}).click();await expect.poll(()=>page.evaluate(()=>window.fixtureHeldVerifyStarted)).toBe(true);
  await page.getByRole('button',{name:'Return to IT Tech Checks'}).click();await expect(page.locator('dialog,iframe')).toHaveCount(0);
  await page.locator('[data-cos-it-dashboard]').click();await ready(frame);
  await page.evaluate(()=>window.fixtureReleaseVerify());await ready(frame);await expect(page.locator('dialog')).toHaveCount(1);
  await expect(count(frame,'field')).toHaveText('1');await expect(count(frame,'mhelp')).toHaveText('2');assertReads(state);
});

test('MHelp filters stay local and empty or failed refreshes cannot keep stale tickets',async({page})=>{
  const {frame,state}=await mount(page);await ready(frame);await card(frame,'mhelp').getByRole('button',{name:/^Open /}).click();
  const workspace=frame.getByRole('region',{name:'MHelp information'}),rows=workspace.locator('.it-mhelp-ticket');await expect(rows).toHaveCount(2);
  const before=await page.evaluate(()=>window.fixtureRpcCalls.filter(name=>name==='my_managed_tickets_v1').length);
  await workspace.getByRole('searchbox',{name:'Search references'}).fill('Sniper');await expect(rows).toHaveCount(1);await expect(rows).toContainText('SYN-4101');
  await workspace.getByRole('button',{name:'Clear filters',exact:true}).click();await workspace.getByRole('combobox',{name:'Tech Check status'}).selectOption('finished');await expect(rows).toHaveCount(1);await expect(rows).toContainText('SYN-4102');
  await workspace.getByRole('button',{name:'Clear filters',exact:true}).click();await workspace.getByRole('combobox',{name:'Work type'}).selectOption('delivery');await workspace.getByLabel('Scheduled date',{exact:true}).fill('2026-10-09');await expect(rows).toHaveCount(1);
  expect(await page.evaluate(()=>window.fixtureRpcCalls.filter(name=>name==='my_managed_tickets_v1').length)).toBe(before);
  const fit=await workspace.evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth}));expect(fit.content).toBeLessThanOrEqual(fit.width);
  await workspace.getByRole('button',{name:'Clear filters',exact:true}).click();await page.evaluate(()=>{window.fixtureMhelpEmpty=true;});await workspace.getByRole('button',{name:'Refresh references',exact:true}).click();
  await expect(rows).toHaveCount(0);await expect(workspace).toContainText('No MHelp references were returned');
  await page.evaluate(()=>{window.fixtureMhelpEmpty=false;window.fixtureMhelpFail=true;});await workspace.getByRole('button',{name:'Refresh references',exact:true}).click();
  await expect(workspace.getByRole('alert')).toBeVisible();await expect(rows).toHaveCount(0);
  await page.evaluate(()=>{window.fixtureMhelpFail=false;});await workspace.getByRole('button',{name:'Refresh references',exact:true}).click();await expect(rows).toHaveCount(2);assertReads(state);
});

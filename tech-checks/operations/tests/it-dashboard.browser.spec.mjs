import {test,expect} from '@playwright/test';
import {auditDarkPresentation} from './dark-presentation-audit.mjs';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {traverseIframeHistory} from './helpers/iframeHistory.mjs';
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
const assignment=(extra={})=>({id:'11111111-1111-4111-8111-111111111111',ticket_no:'SYN-NULL-LEAD',site:'Synthetic scheduled shell site',work_type:'delivery',scheduled_for:'2026-10-10',scheduled_time:'10:30:00',assigned_role:'it',assignee_user_id:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',assignment_scope:'technician',status:'assigned',job_lead_user_id:null,equipment_manifest:[],unit_summary:null,assigned_by_name:'mHelpDesk automatic intake',job_description:'RAW_PRIVATE_INSTRUCTIONS',notes:'RAW_PRIVATE_NOTES',...extra});
const assignmentRows=(second=false)=>[assignment({assignee_user_id:second?'b7cc3cbf-d11e-4d4a-9742-c07701857911':'4f7044b5-86b6-411f-8898-39bb64b4ddbc'}),assignment({id:'22222222-2222-4222-8222-222222222222',ticket_no:'SYN-DEPARTMENT',site:'Synthetic department site',assignee_user_id:null,assignment_scope:'department',equipment_manifest:[{label:'Synthetic Sniper',qty:2}],unit_summary:'Recorded Helios 001'})];
const syntheticInstallation=(id,name)=>({installationId:id,name,portalUrl:`https://vrm.victronenergy.com/installation/${id}/dashboard`,embedUrl:null});
const syntheticFleet=()=>({items:Array.from({length:11},(_,index)=>syntheticInstallation(9100001+index,'Synthetic power site '+(index+1))),sync:{state:'current',lastAttemptAt:'2026-10-09T12:00:00Z',lastSuccessAt:'2026-10-09T12:00:00Z',nextSyncAt:'2026-10-09T12:15:00Z',error:null,scheduleActive:true}});
const gate=()=>{let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};};
const dashboard=frame=>frame.getByRole('region',{name:'IT Dashboard',exact:true});
const card=(frame,source)=>dashboard(frame).locator('[data-source="'+source+'"]');
const count=(frame,source)=>card(frame,source).locator('.it-dashboard-count>strong');

async function mount(page,{role='it',linked=true,slowLegacy=false,holdSource=null,holdSession=false,holdCapability=false,holdQueue=false,queueRows=null,oldQueueHost=false,unitTracker=true,vrmRead=true,...options}={}){
  const state={calls:[],errors:[],unexpected:[],fail:{},holds:new Map(),fleet:syntheticFleet()};
  if(holdSource&&holdSource!=='mhelp')state.holds.set(sourcePaths[holdSource],gate());
  if(holdSession)state.holds.set('/api/session',gate());
  state.release=source=>state.holds.get(sourcePaths[source]||source)?.release();
  page.on('pageerror',error=>state.errors.push(error.message));
  await page.addInitScript(()=>{window.fixtureMhelpResponses=[];addEventListener('message',event=>{if(['COS_IT_MHELP_RESPONSE','COS_IT_ASSIGNMENTS_RESPONSE'].includes(event.data?.type))window.fixtureMhelpResponses.push(event.data);});});
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===origin&&url.pathname==='/it-dashboard-fixture'){
      let html=itHomeFixture(role,linked,{dashboard:true,mhelpTickets:tickets,itAssignments:queueRows||assignmentRows(options.secondVerified),...options});
      if(slowLegacy)html=html.replace('async function loadITManagedTickets(){return []};','async function loadITManagedTickets(){return new Promise(()=>{});};');
      // Instrument only the synthetic context, never the production host.
      const controls=`<script>
        window.fixtureRpcCalls=[];window.fixtureRpcArgs=[];window.fixtureMhelpFail=false;window.fixtureMhelpEmpty=false;
        window.fixtureQueueFail=false;window.fixtureQueueEmpty=false;window.fixtureQueueRows=null;window.fixtureQueueHeld=${holdQueue};
        window.fixtureQueueGate=new Promise(resolve=>{window.fixtureReleaseQueue=()=>{window.fixtureQueueHeld=false;resolve();};});
        window.fixtureCapabilityHeld=${holdCapability};
        window.fixtureCapabilityGate=new Promise(resolve=>{window.fixtureReleaseCapability=()=>{window.fixtureCapabilityHeld=false;resolve();};});
        window.fixtureMhelpHeld=${holdSource==='mhelp'};
        window.fixtureMhelpGate=new Promise(resolve=>{window.fixtureReleaseMhelp=()=>{window.fixtureMhelpHeld=false;resolve();};});
        const originalRpc=window.TechCheckContext.db.rpc;
        window.TechCheckContext.db.rpc=async (name,args)=>{
          window.fixtureRpcCalls.push(name);window.fixtureRpcArgs.push({name,args});
          if(name==='my_available_assignments'){
            const value=await originalRpc(name,args);
            if(window.fixtureQueueHeld)await window.fixtureQueueGate;
            return window.fixtureQueueFail?{error:{message:'RAW_PRIVATE_QUEUE_ERROR'}}:window.fixtureQueueEmpty?{data:[]}:window.fixtureQueueRows?{data:window.fixtureQueueRows}:value;
          }
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
    if(url.href===origin+'/fleet-host-fixture.js')return route.fulfill({contentType:'text/javascript',body:readHost('verified-it-fleet-host.js').replace(oldQueueHost?"d.type==='COS_IT_ASSIGNMENTS_REQUEST'":'UNUSED_REPLACEMENT',"d.type==='DISABLED_OLD_HOST_QUEUE'")+'\nwindow.fixtureHostLoaded=true;'});
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
    await traverseIframeHistory(frame,'back','#it-dashboard');await ready(frame);
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
  const pending=card(frame,source);await expect(pending.locator('.it-dashboard-status')).toHaveText('Loading');await expect(pending.locator('time')).toHaveCount(0);
  await expect(pending.getByRole('button',{name:/^Open /})).toBeEnabled();
  if(source==='mhelp')await page.evaluate(()=>{window.fixtureMhelpFail=true;window.fixtureReleaseMhelp();});
  else{state.fail[sourcePaths[source]]=503;state.release(source);}
  await expect(pending.locator('.it-dashboard-status')).toHaveText('Unavailable');await expect(pending.getByRole('alert')).toBeVisible();
  const before=state.calls.length,beforeMhelp=await page.evaluate(()=>window.fixtureRpcCalls.filter(name=>name==='my_managed_tickets_v1').length);
  if(source==='mhelp')await page.evaluate(()=>{window.fixtureMhelpFail=false;});else delete state.fail[sourcePaths[source]];
  await pending.getByRole('button',{name:/^Retry /}).click();await ready(frame);
  await expect(pending.getByRole('alert')).toHaveCount(0);
  expect(state.calls.slice(before).map(call=>call.path)).toEqual(source==='mhelp'?[]:[sourcePaths[source]]);
  const afterMhelp=await page.evaluate(()=>window.fixtureRpcCalls.filter(name=>name==='my_managed_tickets_v1').length);expect(afterMhelp-beforeMhelp).toBe(source==='mhelp'?1:0);assertReads(state);
});

test('MHelp crosses the real host bridge with only operational ticket fields',async({page})=>{
  const {frame,state}=await mount(page);await ready(frame);
  const payload=await frame.locator('body').evaluate(()=>window.fixtureMhelpResponses.find(message=>message.type==='COS_IT_MHELP_RESPONSE'&&message.items?.length));
  expect(payload.items).toHaveLength(2);
  expect(Object.keys(payload.items[0]).sort()).toEqual(['equipment','finished','scheduledFor','scheduledTime','site','ticketNumber','workType']);
  expect(payload.items[0]).toMatchObject({ticketNumber:'SYN-4101',site:'Synthetic north site',workType:'delivery',scheduledFor:'2026-10-09',finished:false,equipment:['2 × Synthetic Sniper']});
  expect(JSON.stringify(payload)).not.toMatch(/RAW_|password|invoice_total|customer_email|access_token/);
  await card(frame,'mhelp').getByRole('button',{name:/^Open /}).click();
  const workspace=frame.getByRole('region',{name:'MHelp information'});await expect(workspace).toContainText('SYN-4101');await expect(workspace).toContainText('Synthetic Sniper');
  await expect(workspace).not.toContainText('RAW_');await expect(workspace.getByRole('button',{name:/save|import|edit|sync/i})).toHaveCount(0);
  const rpc=await page.evaluate(()=>window.fixtureRpcCalls);expect(rpc).toContain('my_managed_tickets_v1');expect(rpc.every(name=>['cos_verified_fleet_capabilities_v1','my_managed_tickets_v1','my_available_assignments'].includes(name))).toBe(true);
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
  await expect(card(frame,'victron').locator('.it-dashboard-status')).toHaveText('Unavailable');await expect(count(frame,'victron')).toHaveCount(0);await expect(card(frame,'victron').locator('time')).toHaveCount(0);
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
  await card(frame,source).locator('.it-dashboard-actions').getByRole('button',{name:/^Refresh /}).click();await expect.poll(()=>page.evaluate(()=>window.fixtureHeldVerifyStarted)).toBe(true);
  await page.getByRole('button',{name:'Return to IT Tech Checks'}).click();await expect(page.locator('dialog,iframe')).toHaveCount(0);
  await page.locator('[data-cos-it-dashboard]').click();await ready(frame);
  await page.evaluate(()=>window.fixtureReleaseVerify());await ready(frame);await expect(page.locator('dialog')).toHaveCount(1);
  await expect(count(frame,'field')).toHaveText('1');await expect(count(frame,'mhelp')).toHaveText('2');assertReads(state);
});

test('MHelp filters stay local and empty or failed refreshes cannot keep stale tickets',async({page})=>{
  const {frame,state}=await mount(page);await ready(frame);await card(frame,'mhelp').getByRole('button',{name:/^Open /}).click();
  const workspace=frame.getByRole('region',{name:'MHelp information'}),rows=workspace.locator('.it-mhelp-ticket:not(.it-assignment-ticket)');await expect(rows).toHaveCount(2);
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

const queueSummary=frame=>frame.getByRole('region',{name:'IT assignment queue summary',exact:true});
const queueWorkspace=frame=>frame.getByRole('region',{name:'Your IT assignments and department queue',exact:true});
const queueCount=frame=>queueSummary(frame).locator('.it-dashboard-assignment-count>strong');
async function openQueue(frame){await card(frame,'mhelp').getByRole('button',{name:/^Open /}).click();await expect(queueWorkspace(frame).locator('.it-assignment-ticket')).toHaveCount(2);}
async function assertAssignmentReads(page,state){
  const calls=await page.evaluate(()=>window.fixtureRpcArgs);
  expect(calls.filter(call=>call.name==='my_available_assignments').every(call=>JSON.stringify(call.args)==='{"p_role":"it"}')).toBe(true);
  expect(calls.every(call=>['my_available_assignments','my_managed_tickets_v1','cos_verified_fleet_capabilities_v1'].includes(call.name))).toBe(true);assertReads(state);
}

for(const secondVerified of [false,true])test('IT assignment count and rows include own null-lead shells and unclaimed department work '+secondVerified,async({page})=>{
  const {frame,state}=await mount(page,{secondVerified});await ready(frame);await expect(queueCount(frame)).toHaveText('2');await expect(count(frame,'mhelp')).toHaveText('2');
  await expect(queueSummary(frame)).toContainText('Assigned to you');await expect(queueSummary(frame)).toContainText('Department queue');
  await openQueue(frame);const queue=queueWorkspace(frame),rows=queue.locator('.it-assignment-ticket');
  await expect(rows.first()).toContainText('SYN-NULL-LEAD');await expect(rows.first()).toContainText('Synthetic scheduled shell site');await expect(rows.first()).toContainText('Assigned to you');await expect(rows.first()).toContainText('10:30 · as recorded');
  await expect(rows.first()).toContainText('Equipment not yet specified. Review the original instructions in Tech Checks before selecting a unit.');
  await expect(rows.last()).toContainText('Unclaimed IT department queue');await expect(rows.last()).toContainText('2 × Synthetic Sniper');await expect(rows.last()).toContainText('Recorded Helios 001');
  await expect(queue).not.toContainText('RAW_');await expect(queue.getByRole('button',{name:/claim|start|save|import|link/i})).toHaveCount(0);
  const responses=await frame.locator('body').evaluate(()=>window.fixtureMhelpResponses.filter(message=>message.type==='COS_IT_ASSIGNMENTS_RESPONSE'&&message.items?.length));
  expect(Object.keys(responses.at(-1).items[0]).sort()).toEqual(['assignmentId','audience','equipment','scheduledFor','scheduledTime','site','status','ticketNumber','unitSummary','workType']);
  expect(JSON.stringify(responses)).not.toMatch(/RAW_|job_lead|assigned_by|access_token/);
  const before=await page.evaluate(()=>window.fixtureRpcCalls.length);await queue.getByRole('searchbox',{name:'Search IT assignments'}).fill('SYN-DEPARTMENT');await expect(rows).toHaveCount(1);expect(await page.evaluate(()=>window.fixtureRpcCalls.length)).toBe(before);
  await queue.getByRole('searchbox',{name:'Search IT assignments'}).fill('');await expect(rows).toHaveCount(2);
  const fit=await queue.evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth}));expect(fit.content).toBeLessThanOrEqual(fit.width);
  await frame.getByRole('button',{name:'Open existing IT Tech Checks →',exact:true}).click();await expect(page.locator('dialog,iframe')).toHaveCount(0);await assertAssignmentReads(page,state);
});

test('queue and references have independent loading/error/retry states in both directions',async({page})=>{
  const {frame,state}=await mount(page,{holdQueue:true});await ready(frame);await expect(queueSummary(frame)).toContainText('Loading IT assignment queue');await expect(count(frame,'mhelp')).toHaveText('2');
  await page.evaluate(()=>{window.fixtureQueueFail=true;window.fixtureReleaseQueue();});await expect(queueSummary(frame).getByRole('alert')).toContainText('could not be loaded');await expect(queueCount(frame)).toHaveCount(0);
  await page.evaluate(()=>{window.fixtureQueueFail=false;window.fixtureMhelpFail=true;});await queueSummary(frame).getByRole('button',{name:'Refresh IT queue',exact:true}).click();await expect(queueCount(frame)).toHaveText('2');
  await card(frame,'mhelp').getByRole('button',{name:'Refresh MHelp information',exact:true}).click();await expect(card(frame,'mhelp').locator('.it-dashboard-snapshot').getByRole('alert')).toBeVisible();await expect(queueCount(frame)).toHaveText('2');
  await card(frame,'mhelp').getByRole('button',{name:/^Open /}).click();const workspace=frame.getByRole('region',{name:'MHelp information',exact:true});await expect(queueWorkspace(frame).locator('.it-assignment-ticket')).toHaveCount(2);await expect(workspace.locator(':scope > [role=alert]')).toContainText('MHelp references could not be loaded');
  await page.evaluate(()=>{window.fixtureMhelpFail=false;window.fixtureQueueFail=true;});await workspace.getByRole('button',{name:'Refresh references',exact:true}).click();await queueWorkspace(frame).getByRole('button',{name:'Refresh IT queue',exact:true}).click();
  await expect(workspace.locator('.it-mhelp-ticket:not(.it-assignment-ticket)')).toHaveCount(2);await expect(queueWorkspace(frame).getByRole('alert')).toBeVisible();await expect(queueWorkspace(frame).locator('.it-assignment-ticket')).toHaveCount(0);await assertAssignmentReads(page,state);
});

test('queue Back/Forward, Close, refresh and newer navigation discard stale responses without mutations',async({page})=>{
  const {frame,state}=await mount(page);await ready(frame);await expect(queueCount(frame)).toHaveText('2');await openQueue(frame);
  await traverseIframeHistory(frame,'back','#it-dashboard');await ready(frame);await traverseIframeHistory(frame,'forward','#mhelp');await expect(queueWorkspace(frame).locator('.it-assignment-ticket')).toHaveCount(2);
  await page.evaluate(()=>{window.fixtureQueueHeld=true;});await queueWorkspace(frame).getByRole('button',{name:'Refresh IT queue',exact:true}).click();await expect(queueWorkspace(frame).locator('.it-assignment-ticket')).toHaveCount(0);await expect(queueWorkspace(frame)).toContainText('Loading your current IT assignments');
  await navigate(frame,'IT Dashboard');await ready(frame);await page.getByRole('button',{name:'Return to IT Tech Checks'}).click();await expect(page.locator('dialog,iframe')).toHaveCount(0);
  await page.evaluate(()=>{window.fixtureQueueEmpty=true;window.fixtureReleaseQueue();});await page.locator('[data-cos-it-dashboard]').click();await ready(frame);await expect(queueCount(frame)).toHaveText('0');
  await card(frame,'mhelp').getByRole('button',{name:/^Open /}).click();await expect(queueWorkspace(frame)).toContainText('No active IT assignments were returned');await expect(queueWorkspace(frame)).not.toContainText('SYN-NULL-LEAD');await assertAssignmentReads(page,state);
});

for(const action of ['role loss','signout','profile mismatch'])test('pending assignment data cannot survive '+action,async({page})=>{
  const {frame,state}=await mount(page,{holdQueue:true});await ready(frame);await expect.poll(()=>page.evaluate(()=>window.fixtureRpcCalls.includes('my_available_assignments'))).toBe(true);
  await page.evaluate(action=>{
    if(action==='signout'){window.fixtureSubject=null;window.fixtureAuthChanged('SIGNED_OUT');}
    else if(action==='role loss'){window.fixtureRole='service';document.getElementById('appView').classList.add('role-changed');}
    else{window.TechCheckContext.getProfile=()=>({user_id:'33333333-3333-4333-8333-333333333333',active:true});}
    window.fixtureReleaseQueue();
  },action);
  await expect(page.locator('dialog,iframe')).toHaveCount(0);await assertAssignmentReads(page,state);
});

for(const patch of [{assignee_user_id:'33333333-3333-4333-8333-333333333333'},{assigned_role:'service'},{status:'completed'},{id:'bad-id'}])test('unexpected assignment row fails the whole queue '+JSON.stringify(patch),async({page})=>{
  const {frame,state}=await mount(page,{queueRows:[assignment(patch)]});await ready(frame);await expect(queueSummary(frame).getByRole('alert')).toContainText('IT assignments could not be loaded');await expect(queueCount(frame)).toHaveCount(0);await expect(count(frame,'mhelp')).toHaveText('2');await assertAssignmentReads(page,state);
});

test('an old host leaves only the queue unavailable and never claims an empty assignment count',async({page})=>{
  const {frame,state}=await mount(page,{oldQueueHost:true});await ready(frame);await expect(count(frame,'mhelp')).toHaveText('2');
  await expect(queueSummary(frame).getByRole('alert')).toContainText('current host',{timeout:20000});await expect(queueCount(frame)).toHaveCount(0);expect(await page.evaluate(()=>window.fixtureRpcCalls.includes('my_available_assignments'))).toBe(false);await assertAssignmentReads(page,state);
});

test('queue keeps full bounded ticket/site and multiline unit-summary text without treating labels as import evidence',async({page})=>{
  const ticket='T'.repeat(128),site='Synthetic site '+ 's'.repeat(485),summary='Recorded Helios 001\nKeep the original equipment selection.';
  const {frame,state}=await mount(page,{queueRows:[assignment({ticket_no:ticket,site,unit_summary:summary})]});await ready(frame);await expect(queueCount(frame)).toHaveText('1');
  await card(frame,'mhelp').getByRole('button',{name:/^Open /}).click();const queue=queueWorkspace(frame),row=queue.locator('.it-assignment-ticket');await expect(row).toHaveCount(1);
  await expect(row.locator('h4')).toHaveText('Ticket #'+ticket);await expect(row.locator(':scope > p')).toHaveText(site);
  expect(await row.locator('.it-assignment-unit-summary').textContent()).toBe('Recorded unit summary: '+summary);
  await expect(queue).not.toContainText('mHelpDesk automatic intake');await expect(queue).toContainText('do not establish whether a ticket was imported');
  const fit=await queue.evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth}));expect(fit.content).toBeLessThanOrEqual(fit.width);await assertAssignmentReads(page,state);
});

test('late populated queue response cannot replace a newer empty dashboard without closing the frame',async({page})=>{
  const {frame,state}=await mount(page);await ready(frame);await expect(queueCount(frame)).toHaveText('2');await openQueue(frame);
  await page.evaluate(()=>{
    const original=window.TechCheckContext.db.rpc;let held=false;window.fixtureHeldQueueStarted=false;
    window.TechCheckContext.db.rpc=async(name,args)=>{
      const captured=await original(name,args);
      if(name==='my_available_assignments'&&!held){held=true;window.fixtureHeldQueueStarted=true;return new Promise(resolve=>{window.fixtureReleaseCapturedQueue=()=>resolve(captured);});}
      return captured;
    };
  });
  await queueWorkspace(frame).getByRole('button',{name:'Refresh IT queue',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.fixtureHeldQueueStarted)).toBe(true);
  await page.evaluate(()=>{window.fixtureQueueEmpty=true;});await navigate(frame,'IT Dashboard');await ready(frame);await expect(queueCount(frame)).toHaveText('0');
  await page.evaluate(()=>window.fixtureReleaseCapturedQueue());await expect(queueCount(frame)).toHaveText('0');await expect(page.locator('dialog')).toHaveCount(1);
  await traverseIframeHistory(frame,'back','#mhelp');await expect(queueWorkspace(frame)).toContainText('No active IT assignments were returned');await expect(queueWorkspace(frame)).not.toContainText('SYN-NULL-LEAD');await assertAssignmentReads(page,state);
});

for(const action of ['profile mismatch','Owner preview'])test('settled assignment view closes after '+action,async({page})=>{
 const {frame,state}=await mount(page);await ready(frame);await expect(queueCount(frame)).toHaveText('2');await openQueue(frame);await expect(queueWorkspace(frame).locator('.it-assignment-ticket')).toHaveCount(2);
 await page.evaluate(action=>{
  if(action==='profile mismatch'){window.TechCheckContext.getProfile=()=>({user_id:'33333333-3333-4333-8333-333333333333',active:true});document.getElementById('appView').classList.add('profile-changed');}
  else document.body.classList.add('owner-test-role-preview');
 },action);
 await expect(page.locator('dialog,iframe')).toHaveCount(0);await assertAssignmentReads(page,state);
});

test('IT work board prioritizes field and cameras with an independent assigned-checks panel',async({page},info)=>{
  const {frame,state}=await mount(page);await ready(frame);await expect(queueCount(frame)).toHaveText('2');
  const contrast=await auditDarkPresentation(dashboard(frame));expect(contrast.failures).toEqual([]);
  await page.screenshot({path:info.outputPath('it-work-board.png')});
  const cards=dashboard(frame).locator('[data-source]');
  expect(await cards.evaluateAll(items=>items.map(item=>item.dataset.source))).toEqual(['field','cameras','routers','victron','tracker','mhelp']);
  await expect(queueSummary(frame)).toContainText('SYN-NULL-LEAD');await expect(queueSummary(frame)).not.toContainText('SYN-DEPARTMENT');
  await expect(queueSummary(frame)).toContainText('Select equipment in Tech Checks after reviewing instructions.');
  await expect(queueSummary(frame)).not.toContainText('RAW_');
  const fieldBox=await card(frame,'field').boundingBox(),cameraBox=await card(frame,'cameras').boundingBox(),queueBox=await queueSummary(frame).boundingBox();
  if(info.project.name==='desktop-1440'){expect(Math.abs(fieldBox.y-cameraBox.y)).toBeLessThan(2);expect(queueBox.x).toBeGreaterThan(cameraBox.x);expect(Math.abs(fieldBox.y-queueBox.y)).toBeLessThan(2);}
  if(info.project.name==='mobile-390')expect(queueBox.y).toBeLessThan(fieldBox.y);
  await queueSummary(frame).getByRole('button',{name:'View all assignments and ticket info',exact:true}).click();
  await expect(queueWorkspace(frame).locator('.it-assignment-ticket')).toHaveCount(2);
  await traverseIframeHistory(frame,'back','#it-dashboard');await ready(frame);
  await dashboard(frame).getByRole('button',{name:'Open unit checks →',exact:true}).click();
  await expect(page.locator('dialog,iframe')).toHaveCount(0);await assertAssignmentReads(page,state);
});

import { openWorkspace } from './navigation-helper.mjs';
import {test,expect} from '@playwright/test';
import {vrmPortalConfig} from '../../supabase/functions/cos-operations-pages/vrm.ts';
const origin=process.env.COS_VRM_TEST_ORIGIN||'http://127.0.0.1:4173';
const edge='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
// Auth tokens and records are synthetic. Every non-local network request is blocked or intercepted.
async function mount(page,{role='owner',failJobs=false,config={items:[]},failVrm=false,onVrmRequest,initialHash='#victron-vrm',mode=''}={}){
 const requests=[];
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url===origin+'/vision-test')return route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{border:0;width:100%;height:100vh}</style></head><body><iframe title="Native Vision" src="/?theme=vision${mode?'&mode='+mode:''}${initialHash}"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,accessToken:'synthetic-only',role:'${role}'},location.origin)});</script></body></html>`});
  if(url.startsWith(origin+'/'))return route.continue();
  if(url.startsWith('https://vrm.victronenergy.com/installation/')&&url.includes('/embed/'))return route.fulfill({contentType:'text/html',body:'<main style="text-align:center;font-family:Arial,sans-serif;background:#303030;color:#fff;padding:48px 16px;min-height:100vh;box-sizing:border-box"><h1>Test dashboard - no live readings</h1><p>The live COS screen loads battery, solar, and load readings from Victron here.</p></main><style>body{margin:0}</style>'});
  if(url!==edge)return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();requests.push(request);
  if(request.method!=='GET')throw Error('Unexpected write in read-only shell test');
  if(onVrmRequest&&request.path.startsWith('/api/vrm-')){const result=await onVrmRequest(request);return route.fulfill({status:result.status||200,headers,contentType:'application/json',body:JSON.stringify(result.data)});}
  if(failVrm&&request.path==='/api/vrm-fleet')return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:'VRM configuration unavailable'})});
  if(failJobs&&request.path==='/api/jobs')return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:'Fixture unavailable'})});
  const data=request.path==='/api/routers'?{ items: [], source: 'camera_health', gpsAvailable: false, generatedAt: new Date().toISOString() }:request.path.startsWith('/api/vrm-')?config:request.path==='/api/session'?{authorized:true,name:'Fixture user',role:role==='it'?'IT':'Owner',...(role==='it'?{legacyOwner:false}:{}),features:role==='it'?{fleetAccess:true}:{}}:request.path==='/api/jobs'?{items:[{id:'11111111-1111-4111-8111-111111111111',jobNumber:'FIX-101',customer:'Fixture customer',site:'Fixture site',status:'unscheduled'}]}:request.path==='/api/quotes'?{items:[{id:'quote-fixture',status:'pending approval'}]}:{items:[]};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(origin+'/vision-test');return {frame:page.frameLocator('iframe'),requests};
}

async function openVrm(frame){
 await expect(frame.getByText('OPERATIONS CONNECTED',{exact:true})).toBeVisible();
 await openWorkspace(frame,'Victron VRM');
 await expect(frame.getByRole('heading',{name:'Helios power monitoring'})).toBeVisible();
}
test('All nine verified VRM portals work with sharing disabled',async({page})=>{
 const {frame,requests}=await mount(page,{config:vrmPortalConfig()});await openVrm(frame);
 await expect(frame.getByText('0 of 9 dashboards enabled inside COS.',{exact:false})).toBeVisible();
 const nav=frame.getByRole('navigation',{name:'Helios installations'});
 await expect(nav.getByRole('button')).toHaveCount(9);
 const layout=await nav.evaluate(el=>({display:getComputedStyle(el).display,columns:getComputedStyle(el).gridTemplateColumns.split(' ').length,width:innerWidth}));expect(layout.display).toBe('grid');expect(layout.columns).toBe(layout.width>=1200?9:3);
 for(const unit of vrmPortalConfig().items){
  await nav.getByRole('button',{name:unit.name+' VRM portal',exact:true}).click();
  await expect(frame.getByRole('link',{name:'Open '+unit.name+' in VRM ↗',exact:true})).toHaveAttribute('href',unit.portalUrl);
  await expect(nav.getByRole('button',{name:unit.name+' VRM portal',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(frame.getByRole('definition').filter({hasText:String(unit.installationId)})).toHaveText(String(unit.installationId));
 }
 await expect(frame.locator('iframe.vrm-dashboard')).toHaveCount(0);
 const size=await frame.locator('body').evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth}));expect(size.content).toBeLessThanOrEqual(size.width);
 expect(requests.every(r=>r.method==='GET')).toBeTruthy();
});
test('Authorized embedded dashboards follow the selected installation',async({page})=>{
 const config=vrmPortalConfig(JSON.stringify({1022969:'https://vrm.victronenergy.com/installation/1022969/embed/synthetic-only',1022961:'https://vrm.victronenergy.com/installation/1022961/embed/synthetic-only'}));
 const {frame,requests}=await mount(page,{config});await openVrm(frame);
 const iframe=frame.locator('iframe.vrm-dashboard');await expect(iframe).toHaveAttribute('title','HELIOS 001 Victron dashboard');
 await expect(iframe).toHaveAttribute('src',config.items[0].embedUrl);await expect(iframe).toHaveAttribute('referrerpolicy','no-referrer');
 await frame.getByRole('navigation',{name:'Helios installations'}).getByRole('button',{name:'HELIOS 002 Dashboard enabled',exact:true}).click();await expect(iframe).toHaveAttribute('src',config.items[1].embedUrl);
 await frame.getByRole('navigation',{name:'Helios installations'}).getByRole('button',{name:'HELIOS 003 VRM portal',exact:true}).click();await expect(iframe).toHaveCount(0);
 expect(requests.every(r=>r.method==='GET')).toBeTruthy();
});
test('An initial read failure never fabricates fleet installations or dashboards',async({page})=>{
 const {frame}=await mount(page,{failVrm:true});await openVrm(frame);await expect(frame.getByRole('alert')).toContainText('VRM configuration unavailable');await expect(frame.locator('iframe.vrm-dashboard')).toHaveCount(0);await expect(frame.getByRole('navigation',{name:'Helios installations'})).toHaveCount(0);await expect(frame.getByRole('link',{name:'Open VRM fleet ↗',exact:true})).toBeVisible();
});
test('Dashboard controls resize without losing the selected installation or issuing writes',async({page},testInfo)=>{
 const embeds=Object.fromEntries(vrmPortalConfig().items.map(unit=>[unit.installationId,`https://vrm.victronenergy.com/installation/${unit.installationId}/embed/synthetic-only`]));
 const {frame,requests}=await mount(page,{config:vrmPortalConfig(JSON.stringify(embeds))});await openVrm(frame);
 const dashboard=frame.locator('iframe.vrm-dashboard');
 const compactHeight=await dashboard.evaluate(el=>el.getBoundingClientRect().height);
 const position=await dashboard.evaluate(el=>{const outer=el.parentElement.getBoundingClientRect(),inner=el.getBoundingClientRect();return Math.abs((outer.left+outer.right)/2-(inner.left+inner.right)/2)});expect(position).toBeLessThanOrEqual(2);
 await expect(frame.getByText('9 / 9 configured',{exact:true})).toBeVisible();
 await expect(frame.getByRole('button',{name:'Previous Helios unit',exact:true})).toBeDisabled();
 await frame.getByRole('button',{name:'Expand dashboard',exact:true}).click();
 await expect(frame.getByRole('button',{name:'Compact view',exact:true})).toHaveAttribute('aria-expanded','true');
 expect(await dashboard.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(compactHeight);
 await frame.getByRole('button',{name:'Next Helios unit',exact:true}).click();
 await expect(dashboard).toHaveAttribute('title','HELIOS 002 Victron dashboard');
 await frame.getByRole('button',{name:'Reload view',exact:true}).click();
 await expect(dashboard).toHaveAttribute('title','HELIOS 002 Victron dashboard');
 await frame.getByRole('button',{name:'Compact view',exact:true}).click();
 expect(await dashboard.evaluate(el=>el.getBoundingClientRect().height)).toBe(compactHeight);
 await frame.getByRole('navigation',{name:'Helios installations'}).getByRole('button',{name:'HELIOS 009 Dashboard enabled',exact:true}).click();
 await expect(frame.getByRole('button',{name:'Next Helios unit',exact:true})).toBeDisabled();
 await frame.getByRole('button',{name:'Previous Helios unit',exact:true}).click();
 await expect(dashboard).toHaveAttribute('title','HELIOS 008 Victron dashboard');
 await frame.getByText('Dashboard help & reporting',{exact:true}).click();
 await expect(frame.getByText('For history, alarms, trends, and installation settings,',{exact:false})).toBeVisible();
 const size=await frame.locator('body').evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth}));expect(size.content).toBeLessThanOrEqual(size.width);
 expect(requests.every(r=>r.method==='GET')).toBeTruthy();
 if(process.env.COS_LAYOUT_PROOF){await frame.locator('.vrm-workspace').evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:`${process.env.COS_LAYOUT_PROOF}/vrm-${testInfo.project.name}.png`,fullPage:true});}
});

const syntheticUnit=(installationId,name,extra={})=>({installationId,name,portalUrl:`https://vrm.victronenergy.com/installation/${installationId}/dashboard`,embedUrl:null,...extra});
const currentSync={state:'current',lastAttemptAt:'2026-10-09T12:00:00Z',lastSuccessAt:'2026-10-09T12:00:00Z',nextSyncAt:'2026-10-09T12:15:00Z',error:null,scheduleActive:true};
const fleet=(items,sync=currentSync)=>({items,sync});
const selectedId=frame=>frame.getByRole('definition').filter({hasText:/^\d+$/});
const fleetButton=frame=>frame.getByRole('button',{name:'Refresh fleet',exact:true});

test('An empty fleet loads safely and explicit discovery can populate eleven arbitrary installations',async({page})=>{
 const items=Array.from({length:11},(_,index)=>syntheticUnit(2100000+index,'Synthetic array '+(index+1)));
 const {frame,requests}=await mount(page,{onVrmRequest:async request=>({data:fleet(request.path.endsWith('/refresh')?items:[])})});
 await openVrm(frame);
 await expect(frame.getByText('No installations in the saved fleet',{exact:true})).toBeVisible();
 await expect(frame.getByRole('button',{name:'Next Helios unit',exact:true})).toHaveCount(0);
 await expect(frame.getByText('Victron Remote Management · 0 installations',{exact:true})).toBeVisible();
 await fleetButton(frame).click();
 const nav=frame.getByRole('navigation',{name:'Helios installations'});
 await expect(nav.getByRole('button')).toHaveCount(11);
 await expect(frame.getByText('Victron Remote Management · 11 installations',{exact:true})).toBeVisible();
 for(let index=0;index<11;index++){
  await expect(selectedId(frame)).toHaveText(String(items[index].installationId));
  if(index<10)await frame.getByRole('button',{name:'Next Helios unit',exact:true}).click();
 }
 await expect(frame.getByRole('button',{name:'Next Helios unit',exact:true})).toBeDisabled();
 await frame.getByRole('button',{name:'Previous Helios unit',exact:true}).click();
 await expect(selectedId(frame)).toHaveText(String(items[9].installationId));
 expect(requests.filter(request=>request.path.startsWith('/api/vrm-')).map(request=>request.path)).toEqual(['/api/vrm-fleet','/api/vrm-fleet/refresh']);
 expect(requests.every(request=>request.method==='GET')).toBeTruthy();
 const size=await nav.evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth}));expect(size.content).toBeLessThanOrEqual(size.width);
});

test('Selection follows immutable installation IDs across duplicate names, gaps, renames and reordered refreshes',async({page})=>{
 const a=syntheticUnit(2200001,'HELIOS 002',{number:2});
 const b=syntheticUnit(2200002,'HELIOS 007',{number:7,embedUrl:'https://vrm.victronenergy.com/installation/2200002/embed/synthetic-only'});
 const c=syntheticUnit(2200003,'HELIOS 007',{number:7});
 let items=[a,b,c];
 const {frame}=await mount(page,{onVrmRequest:async()=>({data:fleet(items)})});await openVrm(frame);
 const nav=frame.getByRole('navigation',{name:'Helios installations'});
 await nav.getByRole('button',{name:'HELIOS 007 Installation 2200002 Dashboard enabled',exact:true}).click();
 await expect(selectedId(frame)).toHaveText('2200002');
 items=[{...c,name:'HELIOS 002'},{...b,name:'Renamed solar installation'},a];
 await fleetButton(frame).click();
 await expect(selectedId(frame)).toHaveText('2200002');
 await expect(frame.getByRole('heading',{name:'Renamed solar installation',exact:true})).toBeVisible();
 await expect(frame.locator('iframe.vrm-dashboard')).toHaveAttribute('src',b.embedUrl);
 await expect(nav.getByRole('button',{name:'Renamed solar installation Dashboard enabled',exact:true})).toHaveAttribute('aria-pressed','true');
 await frame.getByRole('button',{name:'Next Helios unit',exact:true}).click();
 await expect(selectedId(frame)).toHaveText('2200001');
 await expect(frame.getByRole('button',{name:'Next Helios unit',exact:true})).toBeDisabled();
 await frame.getByRole('button',{name:'Previous Helios unit',exact:true}).click();
 await expect(selectedId(frame)).toHaveText('2200002');
});

test('Installation bookmarks select by ID and ignore misleading legacy unit numbers',async({page})=>{
 const items=[syntheticUnit(2300001,'Unrelated installation',{number:1}),syntheticUnit(2300002,'Named site',{number:99})];
 const {frame}=await mount(page,{config:fleet(items),initialHash:'#victron-vrm?installationId=2300002'});
 await expect(frame.getByRole('heading',{name:'Helios power monitoring'})).toBeVisible();
 await expect(selectedId(frame)).toHaveText('2300002');
 await frame.getByRole('button',{name:'Previous Helios unit',exact:true}).click();
 await expect(selectedId(frame)).toHaveText('2300001');
 await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#victron-vrm?installationId=2300001');
 await frame.locator('body').evaluate(()=>{location.hash='#victron-vrm?installationId=2300002';});
 await expect(selectedId(frame)).toHaveText('2300002');
});

test('Refresh errors retain the selected saved fleet and embeds with an explicit stale warning',async({page})=>{
 const item=syntheticUnit(2400001,'Saved installation',{embedUrl:'https://vrm.victronenergy.com/installation/2400001/embed/synthetic-only'});
 let fail=false;
 const {frame}=await mount(page,{onVrmRequest:async()=>fail?{status:503,data:{error:'Synthetic discovery unavailable'}}:{data:fleet([item])}});await openVrm(frame);
 await expect(selectedId(frame)).toHaveText('2400001');
 fail=true;await fleetButton(frame).click();
 await expect(frame.getByRole('alert')).toContainText('Showing the last successfully loaded fleet');
 await expect(selectedId(frame)).toHaveText('2400001');
 await expect(frame.locator('iframe.vrm-dashboard')).toHaveAttribute('src',item.embedUrl);
 await expect(frame.getByRole('link',{name:'Open Saved installation in VRM ↗',exact:true})).toHaveAttribute('href',item.portalUrl);
 fail=false;await fleetButton(frame).click();await expect(frame.getByRole('alert')).toHaveCount(0);
});

test('Backend stale and unavailable records retain IDs without manufacturing current data',async({page})=>{
 const item=syntheticUnit(2500001,'Unavailable installation',{available:false,lastSeenAt:'2026-10-08T12:00:00Z'});
 const {frame}=await mount(page,{config:fleet([item],{...currentSync,state:'stale',error:'Victron could not be reached.'})});await openVrm(frame);
 await expect(frame.getByText('Fleet sync is delayed. Showing the last saved installations.',{exact:false})).toBeVisible();
 await expect(frame.getByText('Unavailable in the latest fleet sync',{exact:true})).toBeVisible();
 await expect(frame.locator('iframe.vrm-dashboard')).toHaveCount(0);
 await expect(selectedId(frame)).toHaveText('2500001');
 await expect(frame.getByRole('link',{name:'Open Unavailable installation in VRM ↗',exact:true})).toHaveAttribute('href',item.portalUrl);
});

test('Authorization failure clears previously loaded installation details and approved sharing links',async({page})=>{
 const item=syntheticUnit(2600001,'Private installation',{embedUrl:'https://vrm.victronenergy.com/installation/2600001/embed/synthetic-only'});
 let authorized=true;
 const {frame}=await mount(page,{onVrmRequest:async()=>authorized?{data:fleet([item])}:{status:403,data:{error:'Owner access required'}}});await openVrm(frame);
 await expect(frame.locator('iframe.vrm-dashboard')).toHaveCount(1);
 authorized=false;await fleetButton(frame).click();
 await expect(frame.getByRole('alert')).toContainText('Owner access required');
 await expect(frame.getByRole('navigation',{name:'Helios installations'})).toHaveCount(0);
 await expect(frame.locator('iframe.vrm-dashboard')).toHaveCount(0);
 await expect(frame.getByRole('heading',{name:'Private installation',exact:true})).toHaveCount(0);
});

test('A selected installation removed from the cache falls back safely, including an empty next response',async({page})=>{
 let items=[syntheticUnit(2700001,'First installation'),syntheticUnit(2700002,'Second installation')];
 const {frame}=await mount(page,{onVrmRequest:async()=>({data:fleet(items)})});await openVrm(frame);
 await frame.getByRole('button',{name:'Next Helios unit',exact:true}).click();
 items=[items[0]];await fleetButton(frame).click();
 await expect(selectedId(frame)).toHaveText('2700001');
 await expect(frame.getByRole('button',{name:'Next Helios unit',exact:true})).toBeDisabled();
 items=[];await fleetButton(frame).click();
 await expect(frame.getByText('No installations in the saved fleet',{exact:true})).toBeVisible();
 await expect(frame.getByRole('navigation',{name:'Helios installations'})).toHaveCount(0);
});

test('Repeated refresh clicks share one in-flight request and preserve a newer user selection',async({page})=>{
 await page.clock.install();
 const items=[syntheticUnit(2800001,'First installation'),syntheticUnit(2800002,'Second installation')];
 let release;
 let refreshes=0;
 const {frame,requests}=await mount(page,{onVrmRequest:async request=>{
  if(request.path.endsWith('/refresh')){refreshes++;await new Promise(resolve=>{release=resolve;});}
  return {data:fleet(items)};
 }});await openVrm(frame);
 await expect(fleetButton(frame)).toBeEnabled();
 await page.clock.fastForward(59_000);
 await fleetButton(frame).evaluate(button=>{button.click();button.click();button.click();});
 await expect.poll(()=>refreshes).toBe(1);
 await page.clock.fastForward(1_000);
 expect(requests.filter(request=>request.path==='/api/vrm-fleet')).toHaveLength(1);
 await expect(frame.getByRole('button',{name:'Checking fleet…',exact:true})).toBeDisabled();
 await frame.getByRole('button',{name:'Next Helios unit',exact:true}).click();
 release();
 await expect(fleetButton(frame)).toBeEnabled();
 await expect(selectedId(frame)).toHaveText('2800002');
 expect(refreshes).toBe(1);
});

test('Late requests cannot repopulate an unmounted or newly reopened workspace',async({page})=>{
 let release;
 let reads=0;
 const {frame}=await mount(page,{onVrmRequest:async request=>{
  if(request.path.endsWith('/refresh')){await new Promise(resolve=>{release=resolve;});return {data:fleet([syntheticUnit(2900001,'Old delayed installation')])};}
  reads++;return {data:fleet([syntheticUnit(2900000+reads,'Current installation '+reads)])};
 }});await openVrm(frame);
 await expect(selectedId(frame)).toHaveText('2900001');
 await fleetButton(frame).click();await expect.poll(()=>typeof release).toBe('function');
 await openWorkspace(frame,'InHand Routers');
 await expect(frame.getByRole('heading',{name:'Helios power monitoring'})).toHaveCount(0);
 await openWorkspace(frame,'Victron VRM');
 await expect(frame.getByRole('heading',{name:'Current installation 2',exact:true})).toBeVisible();
 release();
 await expect(fleetButton(frame)).toBeEnabled();
 await expect(selectedId(frame)).toHaveText('2900002');
 await expect(frame.getByRole('heading',{name:'Old delayed installation',exact:true})).toHaveCount(0);
});

test('The mounted visible workspace polls saved data every minute without discovery or background reads',async({page})=>{
 await page.clock.install();
 const {frame,requests}=await mount(page,{config:fleet([syntheticUnit(3000001,'Polling installation')])});await openVrm(frame);
 const reads=()=>requests.filter(request=>request.path==='/api/vrm-fleet').length;
 await expect.poll(reads).toBe(1);
 await page.clock.fastForward(60_000);await expect.poll(reads).toBe(2);await expect(fleetButton(frame)).toBeEnabled();
 await frame.locator('body').evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'}));
 await page.clock.fastForward(120_000);expect(reads()).toBe(2);
 await frame.locator('body').evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'}));
 await page.clock.fastForward(60_000);await expect.poll(reads).toBe(3);await expect(fleetButton(frame)).toBeEnabled();
 await page.locator('iframe').evaluate(frame=>{frame.style.display='none';});
 await page.clock.fastForward(120_000);expect(reads()).toBe(3);
 await page.locator('iframe').evaluate(frame=>{frame.style.display='';});
 await openWorkspace(frame,'InHand Routers');
 await page.clock.fastForward(120_000);expect(reads()).toBe(3);
 expect(requests.some(request=>request.path==='/api/vrm-fleet/refresh')).toBeFalsy();
});

test('IT fleet routes never request or expose the Owner Victron workspace',async({page})=>{
 const {frame,requests}=await mount(page,{role:'it',mode:'fleet',initialHash:'#victron-vrm',onVrmRequest:async()=>{throw Error('IT must never request Owner Victron data');}});
 await expect(frame.getByRole('heading',{name:'Helios power monitoring'})).toHaveCount(0);
 await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#it-dashboard');
 expect(requests.some(request=>request.path.startsWith('/api/vrm-'))).toBeFalsy();
});

test('Legacy numeric shortcuts resolve only a unique full Helios name and then retain its ID',async({page})=>{
 let items=[syntheticUnit(3100001,'Unrelated label',{number:1}),syntheticUnit(3100002,'HELIOS 001',{number:12})];
 const {frame}=await mount(page,{onVrmRequest:async()=>({data:fleet(items)})});await openVrm(frame);
 await expect(selectedId(frame)).toHaveText('3100002');
 items=[items[0],{...items[1],name:'Renamed legacy installation'}];
 await fleetButton(frame).click();
 await expect(selectedId(frame)).toHaveText('3100002');
 await expect(frame.getByRole('heading',{name:'Renamed legacy installation',exact:true})).toBeVisible();
});

test('An initial failed read recovers through one explicit fleet refresh',async({page})=>{
 const {frame,requests}=await mount(page,{onVrmRequest:async request=>request.path.endsWith('/refresh')?{data:fleet([syntheticUnit(3200001,'Recovered installation')])}:{status:503,data:{error:'Synthetic initial read failed'}}});await openVrm(frame);
 await expect(frame.getByRole('alert')).toContainText('Synthetic initial read failed');
 await expect(frame.getByRole('navigation',{name:'Helios installations'})).toHaveCount(0);
 await fleetButton(frame).click();
 await expect(selectedId(frame)).toHaveText('3200001');await expect(frame.getByRole('alert')).toHaveCount(0);
 expect(requests.filter(request=>request.path.startsWith('/api/vrm-')).map(request=>request.path)).toEqual(['/api/vrm-fleet','/api/vrm-fleet/refresh']);
});

test('Dashboard power counts follow the saved fleet when new installations arrive',async({page})=>{
 let items=[syntheticUnit(3300001,'Initial installation')];
 const {frame}=await mount(page,{initialHash:'#today',onVrmRequest:async()=>({data:fleet(items)})});
 const dashboard=frame.getByRole('region',{name:'VISION dashboard'});
 await expect(dashboard.getByRole('button',{name:/Victron Power/})).toContainText('1 power installations');
 items=Array.from({length:11},(_,index)=>syntheticUnit(3300001+index,'Synthetic power array '+index));
 await dashboard.getByRole('button',{name:'Refresh fleet',exact:true}).click();
 await expect(dashboard.getByRole('button',{name:/Victron Power/})).toContainText('11 power installations');
 await dashboard.getByRole('button',{name:/Victron Power/}).click();
 await expect(frame.getByRole('navigation',{name:'Helios installations'}).getByRole('button')).toHaveCount(11);
});

test('An old backend supports the new workspace through 404-only legacy fallback',async({page})=>{
 const legacy=vrmPortalConfig(JSON.stringify({1022969:'https://vrm.victronenergy.com/installation/1022969/embed/synthetic-only'}));
 const {frame,requests}=await mount(page,{onVrmRequest:async request=>request.path==='/api/vrm-portal'?{data:{items:legacy.items}}:{status:404,data:{error:'Route unavailable on synthetic old backend'}}});await openVrm(frame);
 await expect(frame.getByRole('navigation',{name:'Helios installations'}).getByRole('button')).toHaveCount(9);
 await expect(frame.locator('iframe.vrm-dashboard')).toHaveAttribute('src',legacy.items[0].embedUrl);
 await expect(frame.getByText('Automatic fleet sync is not configured.',{exact:false})).toBeVisible();
 await fleetButton(frame).click();await expect(fleetButton(frame)).toBeEnabled();
 expect(requests.filter(request=>request.path.startsWith('/api/vrm-')).map(request=>request.path)).toEqual(['/api/vrm-fleet','/api/vrm-portal','/api/vrm-fleet/refresh','/api/vrm-portal']);
});

test('A forbidden dynamic fleet never falls back to a legacy installation list',async({page})=>{
 const {frame,requests}=await mount(page,{onVrmRequest:async request=>request.path==='/api/vrm-portal'?{data:vrmPortalConfig()}:{status:403,data:{error:'Synthetic Owner fleet access denied'}}});await openVrm(frame);
 await expect(frame.getByRole('alert')).toContainText('Synthetic Owner fleet access denied');
 await expect(frame.getByRole('navigation',{name:'Helios installations'})).toHaveCount(0);
 await fleetButton(frame).click();await expect(fleetButton(frame)).toBeEnabled();
 expect(requests.filter(request=>request.path.startsWith('/api/vrm-')).map(request=>request.path)).toEqual(['/api/vrm-fleet','/api/vrm-fleet/refresh']);
});

test('The dashboard uses old-backend fallback only for an absent dynamic fleet route',async({page})=>{
 let forbidden=false;
 const {frame,requests}=await mount(page,{initialHash:'#today',onVrmRequest:async request=>request.path==='/api/vrm-portal'?{data:{items:vrmPortalConfig().items}}:{status:forbidden?403:404,data:{error:forbidden?'Synthetic access denied':'Route unavailable'}}});
 const dashboard=frame.getByRole('region',{name:'VISION dashboard'});
 await expect(dashboard.getByRole('button',{name:/Victron Power/})).toContainText('9 power installations');
 expect(requests.filter(request=>request.path.startsWith('/api/vrm-')).map(request=>request.path)).toEqual(['/api/vrm-fleet','/api/vrm-portal']);
 forbidden=true;await dashboard.getByRole('button',{name:'Refresh fleet',exact:true}).click();
 await expect(dashboard.getByRole('button',{name:/Victron Power/})).toContainText('Status unavailable · open to check');
 expect(requests.filter(request=>request.path.startsWith('/api/vrm-')).map(request=>request.path)).toEqual(['/api/vrm-fleet','/api/vrm-portal','/api/vrm-fleet']);
});

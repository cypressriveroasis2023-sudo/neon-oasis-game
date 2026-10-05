import {test,expect} from '@playwright/test';
import {vrmPortalConfig} from '../../supabase/functions/cos-operations-pages/vrm.ts';
const origin='http://127.0.0.1:4173';
const edge='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
// Auth tokens and records are synthetic. Every non-local network request is blocked or intercepted.
async function mount(page,{role='owner',failJobs=false,config={items:[]},failVrm=false}={}){
 const requests=[];
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url===origin+'/vision-test')return route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{border:0;width:100%;height:100vh}</style></head><body><iframe title="Native Vision" src="/?theme=vision"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,accessToken:'synthetic-only',role:'${role}'},location.origin)});</script></body></html>`});
  if(url.startsWith(origin+'/'))return route.continue();
  if(url.startsWith('https://vrm.victronenergy.com/installation/')&&url.includes('/embed/'))return route.fulfill({contentType:'text/html',body:'<h1>Synthetic Victron dashboard</h1>'});
  if(url!==edge)return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();requests.push(request);
  if(request.method!=='GET')throw Error('Unexpected write in read-only shell test');
  if(failVrm&&request.path==='/api/vrm-portal')return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:'VRM configuration unavailable'})});
  if(failJobs&&request.path==='/api/jobs')return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:'Fixture unavailable'})});
  const data=request.path==='/api/vrm-portal'?config:request.path==='/api/session'?{authorized:true,name:'Fixture owner',role:'Owner'}:request.path==='/api/jobs'?{items:[{id:'11111111-1111-4111-8111-111111111111',jobNumber:'FIX-101',customer:'Fixture customer',site:'Fixture site',status:'unscheduled'}]}:request.path==='/api/quotes'?{items:[{id:'quote-fixture',status:'pending approval'}]}:{items:[]};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(origin+'/vision-test');return {frame:page.frameLocator('iframe'),requests};
}

async function openVrm(frame){
 await expect(frame.getByText('Connected to COS Operations',{exact:true})).toBeVisible();
 await frame.getByRole('navigation',{name:'Vision main sections'}).getByRole('button',{name:'Units',exact:true}).click();
 await frame.getByRole('button',{name:'Victron VRM',exact:true}).click();
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
test('Failed configuration preserves portal access without a fake dashboard',async({page})=>{
 const {frame}=await mount(page,{failVrm:true});await openVrm(frame);await expect(frame.getByRole('alert')).toContainText('VRM configuration unavailable');await expect(frame.locator('iframe.vrm-dashboard')).toHaveCount(0);await expect(frame.getByRole('link',{name:'Open HELIOS 001 in VRM ↗',exact:true})).toBeVisible();
});
test('Dashboard controls resize without losing the selected installation or issuing writes',async({page},testInfo)=>{
 const embeds=Object.fromEntries(vrmPortalConfig().items.map(unit=>[unit.installationId,`https://vrm.victronenergy.com/installation/${unit.installationId}/embed/synthetic-only`]));
 const {frame,requests}=await mount(page,{config:vrmPortalConfig(JSON.stringify(embeds))});await openVrm(frame);
 const dashboard=frame.locator('iframe.vrm-dashboard');
 const compactHeight=await dashboard.evaluate(el=>el.getBoundingClientRect().height);
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
 if(process.env.COS_LAYOUT_PROOF){await frame.getByRole('heading',{name:'Helios power monitoring'}).scrollIntoViewIfNeeded();await page.screenshot({path:`${process.env.COS_LAYOUT_PROOF}/vrm-${testInfo.project.name}.png`,fullPage:true});}
});

import { test, expect } from '@playwright/test';
const origin='http://127.0.0.1:4173';
const edge='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
// Auth tokens and records are synthetic. Every non-local network request is blocked or intercepted.
async function mount(page,{role='owner',failJobs=false}={}){
 const requests=[];
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url===origin+'/vision-test')return route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{border:0;width:100%;height:100vh}</style></head><body><iframe title="Native Vision" src="/?theme=vision"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,accessToken:'synthetic-only',role:'${role}'},location.origin)});</script></body></html>`});
  if(url.startsWith(origin+'/'))return route.continue();
  if(url!==edge)return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();requests.push(request);
  if(request.method!=='GET')throw Error('Unexpected write in read-only shell test');
  if(failJobs&&request.path==='/api/jobs')return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:'Fixture unavailable'})});
  const data=request.path==='/api/session'?{authorized:true,name:'Fixture owner',role:'Owner'}:request.path==='/api/jobs'?{items:[{id:'11111111-1111-4111-8111-111111111111',jobNumber:'FIX-101',customer:'Fixture customer',site:'Fixture site',status:'unscheduled'}]}:request.path==='/api/quotes'?{items:[{id:'quote-fixture',status:'pending approval'}]}:{items:[]};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(origin+'/vision-test');return {frame:page.frameLocator('iframe'),requests};
}
test('Vision groups native workspaces and can return to classic without changing the hash',async({page})=>{
 const {frame,requests}=await mount(page);
 await expect(frame.getByText('Connected to COS Operations',{exact:true})).toBeVisible();
 await expect(frame.getByText('1 job ready to schedule')).toBeVisible();
 for(const name of ['Jobs','Team','Units','Money','Today']){
  await frame.getByRole('navigation',{name:'Vision main sections'}).getByRole('button',{name,exact:true}).click();
  await expect(frame.getByRole('navigation',{name:'Vision main sections'}).getByRole('button',{name,exact:true})).toHaveAttribute('aria-current','page');
  if(name==='Jobs'){await frame.getByRole('searchbox',{name:'Find a job'}).fill('not-a-real-job');await expect(frame.getByText('No jobs match these filters.')).toBeVisible();await frame.getByRole('searchbox',{name:'Find a job'}).fill('FIX-101');await expect(frame.getByText('FIX-101 · Fixture customer',{exact:true})).toBeVisible();}
  const size=await frame.locator('body').evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth}));expect(size.content).toBeLessThanOrEqual(size.width);
 }
 await frame.getByRole('button',{name:'Options',exact:true}).click();await frame.getByRole('button',{name:'All existing tools'}).click();await expect(frame.getByRole('button',{name:'Close menu'})).toBeVisible();await frame.getByRole('button',{name:'Close menu'}).click();
 await frame.getByRole('button',{name:'Use classic layout'}).click();await expect(frame.getByRole('button',{name:'Try Vision layout'})).toBeVisible();expect(requests.every(r=>r.method==='GET')).toBeTruthy();
});
test('Missing data stays unavailable rather than becoming a zero-work claim',async({page})=>{const {frame}=await mount(page,{failJobs:true});await expect(frame.getByRole('heading',{name:'Some information is unavailable'})).toBeVisible();await expect(frame.getByText('No scheduling or review items in the loaded sources.')).toHaveCount(0);});
test('Technician token cannot unlock owner Vision',async({page})=>{const {frame,requests}=await mount(page,{role:'service'});await expect(frame.getByRole('heading',{name:'Operations access needs attention'})).toBeVisible();expect(requests).toHaveLength(0);});

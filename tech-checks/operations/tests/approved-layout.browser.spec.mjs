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
  const data=request.path==='/api/routers'?{ items: [], source: 'camera_health', gpsAvailable: false, generatedAt: new Date().toISOString() }:request.path==='/api/session'?{authorized:true,name:'Fixture owner',role:'Owner'}:request.path==='/api/jobs'?{items:[{id:'11111111-1111-4111-8111-111111111111',jobNumber:'FIX-101',customer:'Fixture customer',site:'Fixture site',status:'unscheduled'}]}:request.path==='/api/quotes'?{items:[{id:'quote-fixture',status:'pending approval'}]}:{items:[]};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(origin+'/vision-test');return {frame:page.frameLocator('iframe'),requests};
}
test('old VISION links open only the approved workspace and keep native navigation working',async({page},testInfo)=>{
 const {frame,requests}=await mount(page);
 await expect(frame.getByText('OPERATIONS CONNECTED',{exact:true})).toBeVisible();
 await expect(frame.getByRole('region',{name:'Daily workspace'})).toBeVisible();
 await expect(frame.getByRole('button',{name:/Use (classic|Vision) layout/i})).toHaveCount(0);
 await expect(frame.locator('.vision-header,.vision-shell')).toHaveCount(0);
 expect(await frame.locator('body').evaluate(()=>new URLSearchParams(location.search).has('theme'))).toBe(false);
 const expectedHash={Jobs:'#jobs',Team:'#team',Equipment:'#equipment',Invoices:'#invoices',Today:'#today'};
 for(const [name,hash] of Object.entries(expectedHash)){
  await frame.getByRole('button',{name:'More',exact:true}).click();
  const menu=frame.getByRole('dialog',{name:'Operations navigation'});
  await expect(menu.getByRole('button',{name:'Close menu'})).toBeFocused();
  await menu.getByRole('navigation',{name:'COS Operations',exact:true}).getByRole('button',{name,exact:true}).click();
  await expect(menu).toHaveCount(0);
  expect(await frame.locator('body').evaluate(()=>location.hash)).toBe(hash);
  await frame.getByRole('button',{name:'More',exact:true}).click();
  const selected=frame.getByRole('dialog',{name:'Operations navigation'}).getByRole('button',{name,exact:true});
  await expect(selected).toHaveAttribute('aria-current','page');
  await frame.getByRole('button',{name:'Close menu'}).click();
  if(name==='Jobs'){
   const search=frame.getByRole('searchbox',{name:'Find a job'});
   await search.fill('not-a-real-job');await expect(frame.getByText('No jobs match these filters.')).toBeVisible();
   await search.fill('FIX-101');await expect(frame.getByText('FIX-101 · Fixture customer',{exact:true})).toBeVisible();
  }
  const size=await frame.locator('body').evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth}));
  expect(size.content).toBeLessThanOrEqual(size.width);
 }
 await frame.getByRole('button',{name:'More',exact:true}).click();
 const nav=frame.getByRole('dialog',{name:'Operations navigation'}).getByRole('navigation',{name:'COS Operations',exact:true});
 const styles=await nav.locator('button').evaluateAll(buttons=>buttons.map(button=>({active:button.getAttribute('aria-current'),color:getComputedStyle(button).color})));
 expect(styles.find(button=>button.active).color).toBe('rgb(255, 20, 44)');
 expect(styles.filter(button=>!button.active).every(button=>button.color!=='rgb(255, 20, 44)')).toBe(true);
 await frame.getByRole('button',{name:'Close menu'}).press('Escape');
 await expect(frame.getByRole('button',{name:'More',exact:true})).toBeFocused();
 await frame.locator('.owner-it-topbar').screenshot({path:testInfo.outputPath('approved-header.png')});
 expect(requests.every(r=>r.method==='GET')).toBeTruthy();
});
test('missing data remains unavailable in the single workspace',async({page})=>{
 const {frame}=await mount(page,{failJobs:true});
 await expect(frame.getByRole('heading',{name:'Some dashboard information is unavailable'})).toBeVisible();
 await expect(frame.getByText('Jobs could not be loaded. Retry before relying on this view.')).toBeVisible();
 await expect(frame.getByText('No active jobs in the loaded records.')).toHaveCount(0);
});
test('technician token cannot unlock owner Operations through an old VISION link',async({page})=>{
 const {frame,requests}=await mount(page,{role:'service'});
 await expect(frame.getByRole('heading',{name:'Operations access needs attention'})).toBeVisible();
 expect(requests).toHaveLength(0);
});

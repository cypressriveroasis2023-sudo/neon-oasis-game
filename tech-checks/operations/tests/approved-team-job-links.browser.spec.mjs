import {test,expect} from '@playwright/test';
const origin='http://127.0.0.1:4173';
const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
const tech='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444';
const nil='00000000-0000-0000-0000-000000000000';
async function mount(page,{bad=false,missing=false}={}){
 const state={calls:[],writes:[],errors:[],failJobs:false};page.on('pageerror',e=>state.errors.push(e.message));
 const team=[{userId:tech,displayName:'Example IT technician',department:'it',active:true,linked:true},{userId:other,displayName:'Example Service technician',department:'service',active:true,linked:true}];
 const base={jobNumber:'COS-SAVED-100',jobType:'SERVICE',department:'it',technicianUserId:tech,technician:'Example IT technician',status:'Assigned',equipment:'Spotter',equipmentUnitTag:'EXAMPLE-260',notes:[]};
 const jobs=[{...base,id:bad?'BAD-ID':missing?nil:first,customer:'First saved customer',site:'First recorded site'},{...base,id:second,customer:'Second saved customer',site:'Second recorded site',status:'In progress'},
  {...base,id:'55555555-5555-4555-8555-555555555555',technicianUserId:other,customer:'Other assignment',site:'Other site'},
  {...base,id:'66666666-6666-4666-8666-666666666666',customer:'Closed work',status:'Closed'}];
 await page.route('**/*',route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===origin&&url.pathname==='/approved-team-fixture')return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}header{height:24px;font:12px/24px sans-serif;text-align:center;background:white;color:#111}iframe{display:block;width:100%;height:calc(100vh - 24px);border:0}</style></head><body><header>SYNTHETIC TEST — NOT LIVE OPERATIONS</header><iframe title="COS test application" src="/#team"></iframe><script>addEventListener('message',e=>{const f=document.querySelector('iframe');if(e.origin!==location.origin||e.source!==f.contentWindow||e.data?.type!=='COS_OPERATIONS_TOKEN_REQUEST')return;e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-team-test-only'},location.origin)})</script></body></html>`});
  if(url.origin===origin)return route.continue();
  if(!url.pathname.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  const body=request.postDataJSON();state.calls.push(body.path);
  if(body.method!=='GET'){state.writes.push(body.path);return route.fulfill({status:400,headers,json:{error:'No operational writes permitted'}});}
  if(body.path==='/api/jobs'&&state.failJobs)return route.fulfill({status:503,headers,json:{error:'Synthetic jobs source unavailable'}});
  const data=body.path==='/api/session'?{authorized:true,legacyOwner:true,role:'Owner',name:'Synthetic Owner',features:{unitTracker:true}}:
   body.path==='/api/team-production'?{items:team}:body.path==='/api/jobs'?{items:jobs}:
   body.path==='/api/daily-board'?{jobs:[],tasks:[],readiness:[{userId:tech,status:'Ready'}],asOf:new Date().toISOString()}:{items:[]};
  return route.fulfill({headers,json:data});
 });
 await page.goto('/approved-team-fixture');const app=page.frameLocator('iframe'),hub=app.getByRole('region',{name:'Team Workspace',exact:true});
 await expect(hub).toBeVisible();await expect(hub.getByRole('button',{name:'REFRESH TEAM',exact:true})).toBeEnabled();
 return {app,hub,state};
}
const safe=state=>{expect(state.errors).toEqual([]);expect(state.writes).toEqual([]);};
const member=hub=>hub.locator('.record.op-record').filter({hasText:'Example IT technician'});
test('two identical display numbers retain different saved job IDs and original assignment counts',async({page},info)=>{
 const {hub,state}=await mount(page),row=member(hub),links=row.getByRole('link');
 await expect(row.getByText('IT Technician · 2 active assigned jobs',{exact:true})).toBeVisible();await expect(row).toContainText('Readiness: Ready');
 await expect(links).toHaveCount(2);await expect(links.nth(0)).toHaveAttribute('href','#jobs?job='+first);await expect(links.nth(1)).toHaveAttribute('href','#jobs?job='+second);
 await expect(row).not.toContainText('Other site');await expect(row).not.toContainText('Closed work');
 expect(state.calls.filter(p=>p==='/api/jobs')).toHaveLength(1);await row.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('team-saved-jobs.png')});safe(state);
});
test('normal click opens only the selected saved job and browser Back returns to Team',async({page})=>{
 const {app,hub,state}=await mount(page);await member(hub).getByRole('link').nth(1).click();
 const jobs=app.locator('.ops-workflows[aria-label="COS Jobs"]');await expect(jobs).toBeVisible();
 await expect(jobs.locator('.record.op-record')).toHaveCount(1);await expect(jobs).toContainText('Second saved customer');await expect(jobs).not.toContainText('First saved customer');
 expect(await jobs.evaluate(()=>location.hash)).toBe('#jobs?job='+second);await page.evaluate(()=>history.back());await expect(hub).toBeVisible();expect(await hub.evaluate(()=>location.hash)).toBe('#team');await expect(member(hub).getByRole('link')).toHaveCount(2);safe(state);
});
test('missing saved identifier remains visible but cannot become a job or unit link',async({page})=>{
 const {hub,state}=await mount(page,{missing:true}),row=member(hub);
 await expect(row.getByRole('link')).toHaveCount(1);await expect(row).toContainText('Job link unavailable');await expect(row).toContainText('First recorded site');
 await expect(row.getByRole('link')).toHaveAttribute('href','#jobs?job='+second);await expect(row.locator('a[href*="unit="]')).toHaveCount(0);safe(state);
});
test('malformed job response keeps existing unavailable state without inventing assignments',async({page})=>{
 const {hub,state}=await mount(page,{bad:true});await expect(hub.getByRole('alert')).toContainText('Jobs returned an incomplete record list');
 await expect(hub.getByRole('link')).toHaveCount(0);await expect(hub).toContainText('Assigned jobs unavailable');safe(state);
});
test('failed refresh preserves saved links with the original stale-source warning',async({page})=>{
 const {hub,state}=await mount(page);state.failJobs=true;await hub.getByRole('button',{name:'REFRESH TEAM',exact:true}).click();
 await expect(hub.getByRole('alert')).toContainText('Showing the last successful jobs records.');
 await expect(member(hub).getByRole('link').nth(1)).toHaveAttribute('href','#jobs?job='+second);safe(state);
});
test('search and department filters keep original assignments without extra reads',async({page})=>{
 const {hub,state}=await mount(page);const before=state.calls.slice();
 await hub.getByLabel('Department',{exact:true}).selectOption('service');await expect(hub.locator('.record.op-record')).toHaveCount(1);await expect(hub).toContainText('Example Service technician');
 await hub.getByLabel('Search production team').fill('no-such-person');await expect(hub).toContainText('No team members match this view.');
 await hub.getByLabel('Search production team').fill('');await hub.getByLabel('Department',{exact:true}).selectOption('it');await expect(member(hub).getByRole('link')).toHaveCount(2);expect(state.calls).toEqual(before);safe(state);
});
test('job links have readable contrast, phone touch targets and keyboard navigation',async({page})=>{
 await page.setViewportSize({width:320,height:812});const {hub,app,state}=await mount(page);const link=member(hub).getByRole('link').first();
 const metric=await link.evaluate(el=>{const rect=el.getBoundingClientRect(),c=getComputedStyle(el);return {height:rect.height,left:rect.left,right:rect.right,width:innerWidth,color:c.color,bg:c.backgroundColor,scroll:document.documentElement.scrollWidth};});
 expect(metric.height).toBeGreaterThanOrEqual(48);expect(metric.left).toBeGreaterThanOrEqual(0);expect(metric.right).toBeLessThanOrEqual(metric.width+1);expect(metric.scroll).toBeLessThanOrEqual(metric.width+1);
 const lum=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);
 const fg=lum(metric.color),bg=lum(metric.bg);expect((Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)).toBeGreaterThanOrEqual(4.5);
 await link.focus();await page.keyboard.press('Enter');await expect(app.locator('.ops-workflows')).toContainText('First saved customer');safe(state);
});

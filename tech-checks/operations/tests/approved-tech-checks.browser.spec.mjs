import {test,expect} from '@playwright/test';
const origin='http://127.0.0.1:4173';

// Complete compiled Operations app. Only the parent-message boundary is simulated.
// Actual legacy host/input/history behavior is covered separately by tech-checks-navigation.
async function mount(page){
 const state={calls:[],writes:[],errors:[]};page.on('pageerror',e=>state.errors.push(e.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===origin&&url.pathname==='/approved-checks-fixture')return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}header{height:24px;font:12px/24px sans-serif;background:white;color:#111;text-align:center}iframe{display:block;width:100%;height:calc(100vh - 24px);border:0}</style></head><body><header>SYNTHETIC TEST — NOT LIVE OPERATIONS</header><iframe title="COS test application" src="/#tech-check"></iframe><script>window.recordedRoutes=[];addEventListener('message',e=>{const frame=document.querySelector('iframe');if(e.origin!==location.origin||e.source!==frame.contentWindow)return;if(e.data?.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-check-test-only'},location.origin);if(e.data?.type==='COS_OPERATIONS_NAVIGATE')recordedRoutes.push(e.data.route)})</script></body></html>`});
  if(url.origin===origin)return route.continue();
  if(!url.pathname.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  const body=request.postDataJSON();state.calls.push(body);
  if(body.method!=='GET'){state.writes.push(body.path);return route.fulfill({status:400,headers,json:{error:'Writes prohibited in test'}});}
  const data=body.path==='/api/session'?{authorized:true,legacyOwner:true,role:'Owner',name:'Synthetic Owner',features:{unitTracker:true,vrmRead:true}}:{items:[]};
  return route.fulfill({headers,json:data});
 });
 await page.goto('/approved-checks-fixture');const app=page.frameLocator('iframe'),hub=app.getByRole('region',{name:'Tech Check workspaces',exact:true});await expect(hub).toBeVisible();return {app,hub,state};
}
const safe=state=>{expect(state.errors).toEqual([]);expect(state.writes).toEqual([]);};
async function fits(hub){
 const g=await hub.evaluate(el=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,boxes:[...el.querySelectorAll('button,summary')].map(n=>({rect:n.getBoundingClientRect().toJSON(),visible:n.getClientRects().length>0&&getComputedStyle(n).visibility!=='hidden'})).filter(n=>n.visible&&n.rect.width>0&&n.rect.height>0)}));
 expect(g.scroll).toBeLessThanOrEqual(g.viewport+1);for(const {rect:r}of g.boxes){expect(r.x).toBeGreaterThanOrEqual(0);expect(r.right).toBeLessThanOrEqual(g.viewport+1);expect(r.height).toBeGreaterThanOrEqual(48);}
}

test('routine checks stay visible while management starts collapsed',async({page},info)=>{
 const {hub,state}=await mount(page);
 await expect(hub.locator('button')).toHaveCount(13);await expect(hub.locator('details')).not.toHaveAttribute('open','');
 for(const label of [/^IT check in \/ out/,/^Service handoffs/,/^Check handoffs & returns/,/^Checks needing attention/,/^Check history/])await expect(hub.getByRole('button',{name:label})).toBeVisible();
 await expect(hub.getByRole('button',{name:/^Technician accounts/})).toBeHidden();await expect(hub).toContainText('Required checks, photos and signatures still apply.');await expect(hub).toContainText('Service jobs are created in mHelp.');
 await fits(hub);await page.screenshot({path:info.outputPath('tech-check-primary.png')});safe(state);
});
test('all original check buttons send exactly their existing parent routes',async({page})=>{
 const {hub,state}=await mount(page);const expected=[];
 for(const [label,route]of [['IT check in / out','it'],['Service handoffs','service'],['Check handoffs & returns','handoffs'],['Checks needing attention','attention'],['Check history','history'],['Check assignments','assign'],['Truck & team readiness','team'],['Review completed checks','review'],['Check schedule','calendar'],['Checked equipment','units'],['Check activity','activity'],['Technician accounts','accounts'],['Owner test center','testcenter']]){
  const button=hub.getByRole('button',{name:new RegExp('^'+label)});if(!await button.isVisible())await hub.locator('summary').click();await button.click();expected.push(route);await expect.poll(()=>page.evaluate(()=>recordedRoutes)).toEqual(expected);
 }
 safe(state);
});
test('Escape closes only management and returns focus without reading or writing records',async({page},info)=>{
 const {hub,state}=await mount(page),summary=hub.locator('summary'),details=hub.locator('details');
 const calls=state.calls.length;await summary.click();await expect(hub.getByRole('button',{name:/^Technician accounts/})).toBeVisible();await fits(hub);
 await page.screenshot({path:info.outputPath('tech-check-management.png')});await hub.getByRole('button',{name:/^Technician accounts/}).focus();await page.keyboard.press('Escape');
 await expect(details).not.toHaveAttribute('open','');await expect(summary).toBeFocused();await expect(hub).toBeVisible();expect(state.calls.length).toBe(calls);expect(await page.evaluate(()=>recordedRoutes)).toEqual([]);
 await summary.press('Enter');await expect(details).toHaveAttribute('open','');await summary.press('Space');await expect(details).not.toHaveAttribute('open','');safe(state);
});
test('Tech Check tools fit a 320-pixel phone while open and closed',async({page})=>{
 await page.setViewportSize({width:320,height:812});const {hub,state}=await mount(page);await fits(hub);await hub.locator('summary').click();await fits(hub);safe(state);
});

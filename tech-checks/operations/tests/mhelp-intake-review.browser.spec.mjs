import {test,expect} from '@playwright/test';
import {existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const origin='http://127.0.0.1:4173',dist=resolve(fileURLToPath(new URL('../dist',import.meta.url)));
const now=Date.parse('2026-10-10T05:00:00.000Z');
const status=(patch={})=>({contract:'cos-mhelp-intake-review-v1',enabled:true,activationAt:'2026-10-10T04:00:00.000Z',pendingReviewCount:1,createdCount:2,lastAttemptAt:'2026-10-10T04:59:00.000Z',lastSuccessAt:'2026-10-10T04:59:00.000Z',failureCount:0,retryAfter:null,lastErrorCode:null,held:[{ticketNumber:'000042',reasonCodes:['source_changed_review_required']}],heldTruncated:false,...patch});
async function mount(page,{role='owner',legacyOwner=role==='owner',value=status()}={}){
 const state={calls:[],value,failure:0,hold:false,releases:[],errors:[]};
 await page.clock.install({time:now});page.on('pageerror',e=>state.errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url===origin+'/intake-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style><iframe src="/${role==='owner'?'':'?mode=fleet'}#unit-tracker"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:${JSON.stringify(role)},accessToken:'synthetic-only'},location.origin)})</script>`});
  if(url.startsWith(origin+'/')){
   const pathname=new URL(url).pathname,path=resolve(dist,pathname==='/'?'index.html':'.'+decodeURIComponent(pathname));
   if(path.startsWith(dist+'/')&&existsSync(path))return route.fulfill({path,contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff':'font/woff','.png':'image/png'}[extname(path)]||'application/octet-stream'});
   return route.abort();
  }
  if(!url.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();state.calls.push(request);
  const answer=(data,code=200)=>route.fulfill({status:code,headers,contentType:'application/json',body:JSON.stringify(data)});
  if(request.path==='/api/session')return answer({authorized:true,legacyOwner,role:role==='owner'?'Owner':role==='it'?'IT':'Service',features:{unitTracker:true,fleetAccess:true}});
  if(request.path==='/api/unit-tracker')return answer({contract:'COS_UNIT_TRACKER_OUTBOX_V1',workbookId:'1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA',connector:{enabled:false,state:'awaiting_sheets_connection'},queueEnabled:false,sources:[],requests:[],sourcesTruncated:false,requestsTruncated:false,sourcesHeld:0});
  if(request.path==='/api/field-map')return answer({items:[],inventoryItems:[],summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0}});
  if(request.path==='/api/mhelpdesk/intake/status'){
   const value=structuredClone(state.value),failure=state.failure;
   if(state.hold)await new Promise(resolve=>state.releases.push(resolve));
   return answer(failure?{error:'PRIVATE source body contact@example.invalid secret'}:value,failure||200);
  }
  return answer({items:[]});
 });
 await page.goto(origin+'/intake-fixture');const frame=page.frameLocator('iframe');
 if(role!=='service')await expect(frame.getByRole('region',{name:'Unit Tracker workspace',exact:true})).toBeVisible();
 else await expect(frame.getByRole('alert')).toContainText('Your existing Tech Check session is unavailable');
 return {frame,panel:frame.getByRole('region',{name:'mHelpDesk automatic intake status',exact:true}),state};
}
const reads=state=>state.calls.filter(x=>x.path==='/api/mhelpdesk/intake/status');
const refresh=panel=>panel.getByRole('button',{name:'Refresh intake status',exact:true});
test('explicit saved-status read shows active state, activation, poll, counts, held printed number and code',async({page})=>{
 const {panel,state}=await mount(page);await expect(panel).toContainText('Intake state unknown');expect(reads(state)).toHaveLength(0);
 await refresh(panel).focus();await page.keyboard.press('Enter');await expect(panel).toContainText('Recent source scan completed');
 await expect(panel).toContainText('Active configuration');await expect(panel).toContainText('Oct 10, 2026, 4:00:00 AM UTC');
 await expect(panel).toContainText('000042');await expect(panel).toContainText('source_changed_review_required');await expect(panel).toContainText('Created by intake2');
 expect(reads(state)).toHaveLength(1);expect(reads(state)[0].method).toBe('GET');expect(state.calls.some(x=>x.method==='POST')).toBe(false);
 expect(state.calls.some(x=>x.path.startsWith('/api/mhelpdesk/partner'))).toBe(false);
 expect(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);expect(state.errors).toEqual([]);
});
test('disabled and unrecorded timing never claim a successful poll or activation',async({page})=>{
 const {panel,state}=await mount(page,{value:status({enabled:false,activationAt:null,lastAttemptAt:null,lastSuccessAt:null,pendingReviewCount:0,held:[]})});
 await refresh(panel).click();await expect(panel.getByRole('status')).toContainText('Disabled');await expect(panel).toContainText('Not recorded');await expect(panel).toContainText('No tickets are held');await expect(panel).not.toContainText('Recent source scan');
 state.value=status({activationAt:null});await refresh(panel).click();await expect(panel.getByRole('status')).toContainText('activation unverified');await expect(panel.getByRole('status')).not.toContainText('Active configuration');
});
test('stale, backoff, error and local read age are explicit without automatic network refresh',async({page})=>{
 const {panel,state}=await mount(page,{value:status({lastSuccessAt:'2026-10-10T04:00:00.000Z'})});
 await refresh(panel).click();await expect(panel.getByRole('status')).toContainText('Stale');
 state.value=status({failureCount:2,retryAfter:'2026-10-10T05:20:00.000Z',lastErrorCode:'SOURCE_UNAVAILABLE'});
 await refresh(panel).click();await expect(panel.getByRole('status')).toContainText('Backoff');await expect(panel).toContainText('SOURCE_UNAVAILABLE');
 await page.clock.fastForward(21*60000);await expect(panel.getByRole('status')).toContainText('Poll error');await expect(panel).toContainText('This status was read more than 15 minutes ago');expect(reads(state)).toHaveLength(2);
});
test('failed or malformed refresh clears previous held rows, counts and success without exposing raw errors',async({page})=>{
 const {panel,state}=await mount(page);await refresh(panel).click();await expect(panel).toContainText('000042');
 for(const failure of [503,403,401,404]){state.failure=failure;await refresh(panel).click();await expect(panel.getByRole('alert')).toContainText('unknown');await expect(panel).not.toContainText('000042');await expect(panel.locator('dl')).toHaveCount(0);await expect(panel).not.toContainText('PRIVATE');}
 state.failure=0;state.value={...status(),source:{body:'PRIVATE'}};await refresh(panel).click();await expect(panel.getByRole('alert')).toContainText('unknown');await expect(panel).not.toContainText('000042');
 state.value=status();await refresh(panel).click();await expect(panel).toContainText('000042');expect(state.errors).toEqual([]);
});
test('repeated clicks share one in-flight status read and clear previous results immediately',async({page})=>{
 const {panel,state}=await mount(page);await refresh(panel).click();await expect(panel).toContainText('000042');state.hold=true;
 await refresh(panel).evaluate(button=>{button.click();button.click();button.click();});await expect.poll(()=>state.releases.length).toBe(1);
 await expect(panel.getByRole('button')).toBeDisabled();await expect(panel).not.toContainText('000042');expect(reads(state)).toHaveLength(2);
 state.releases.shift()();await expect(panel).toContainText('000042');expect(state.errors).toEqual([]);
});
test('hidden host cancels old reads and a newer refresh wins over the old response',async({page})=>{
 const {panel,state}=await mount(page);state.hold=true;await refresh(panel).click();await expect.poll(()=>state.releases.length).toBe(1);
 await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'},location.origin));
 await expect(panel).toContainText('Intake state unknown');state.hold=false;state.value=status({pendingReviewCount:0,held:[],createdCount:7});
 await refresh(panel).click();await expect(panel).toContainText('Created by intake7');state.releases.shift()();await expect(panel).not.toContainText('000042');await expect(panel).toContainText('Created by intake7');expect(state.errors).toEqual([]);
});
test('navigation and Back discard a pending result and return to unknown status',async({page})=>{
 const {frame,panel,state}=await mount(page);state.hold=true;await refresh(panel).click();await expect.poll(()=>state.releases.length).toBe(1);
 await frame.locator('body').evaluate(()=>{location.hash='#units-on-hand';});await expect(panel).toHaveCount(0);state.releases.shift()();
 // The route belongs to the iframe's same-document history. page.goBack()
 // waits for a top-level load that this hash traversal cannot produce.
 await frame.locator('body').evaluate(()=>{history.back();});
 await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#unit-tracker');
 await expect(panel).toBeVisible();await expect(panel).toContainText('Intake state unknown');await expect(panel).not.toContainText('000042');
 state.hold=false;await refresh(panel).click();await expect(panel).toContainText('000042');expect(state.errors).toEqual([]);
});
test('bounded held list remains readable on mobile and clearly says it is truncated',async({page})=>{
 const held=Array.from({length:25},(_,i)=>({ticketNumber:String(i).padStart(128,'0'),reasonCodes:['assignment_identity_unverified','source_status_unreviewed']}));
 const {panel}=await mount(page,{value:status({pendingReviewCount:30,held,heldTruncated:true})});await refresh(panel).click();await expect(panel).toContainText('Showing 25 of 30');await expect(panel.locator('.mhelp-intake-held>li')).toHaveCount(25);
 expect(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
});
for(const role of ['it','service'])test(`${role} session has no intake review or read even with forged Owner flag`,async({page})=>{
 const {panel,state}=await mount(page,{role,legacyOwner:true});await expect(panel).toHaveCount(0);expect(reads(state)).toHaveLength(0);
});

test('a completed all-held scan never claims that Tech Check assignments were created',async({page})=>{
 const {panel,state}=await mount(page,{value:status({createdCount:0})});await refresh(panel).click();
 await expect(panel.getByRole('status')).toContainText('Review is required');await expect(panel).toContainText('No Tech Check assignments have been created by this intake yet.');
 state.value=status({createdCount:0,pendingReviewCount:0,held:[]});await refresh(panel).click();await expect(panel.getByRole('status')).toContainText('Recent source scan completed');await expect(panel.getByRole('status')).not.toContainText('Review is required');await expect(panel).toContainText('No Tech Check assignments have been created');
});

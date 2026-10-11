import {test,expect} from '@playwright/test';
const origin=process.env.MHELP_RECONNECT_TEST_ORIGIN||'http://127.0.0.1:4173',root='/api/mhelpdesk/partner/reconnect';
const ready={contract:'cos-mhelpdesk-reconnect-v1',state:'ready',portalId:'224643',revision:2,renewalVerified:false};
async function mount(page,{role='owner'}={}){
 const calls=[],state={fail:false,delay:null,saved:false,bad:false};
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.route(origin+'/reconnect-fixture',route=>route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{border:0;width:100%;height:100vh}</style><iframe src="/${role==='it'?'?mode=fleet':''}#unit-tracker"></iframe><script>window.holdTokenReplies=false;window.pendingTokenReply=null;window.tokenValue='synthetic-only';addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST'){const respond=()=>e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'${role}',accessToken:window.tokenValue},location.origin);if(window.holdTokenReplies)window.pendingTokenReply=respond;else respond();}})</script>`}));
 await page.route('**/functions/v1/cos-operations-pages',async route=>{
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();calls.push(request);
  const answer=data=>route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
  if(request.path==='/api/session')return answer({authorized:true,legacyOwner:role==='owner',role:role==='owner'?'Owner':'IT',features:{unitTracker:true,fleetAccess:true}});
  if(request.path==='/api/unit-tracker')return answer({contract:'COS_UNIT_TRACKER_OUTBOX_V1',workbookId:'1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA',connector:{enabled:false,state:'awaiting_sheets_connection'},queueEnabled:false,sources:[],requests:[],sourcesTruncated:false,requestsTruncated:false,sourcesHeld:0});
  if(request.path==='/api/field-map')return answer({items:[],inventoryItems:[],summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0}});
  if(request.path===root+'/status'&&state.statusDelay)await state.statusDelay;
  if(request.path===root+'/status')return answer(request.body.requestId?{...ready,state:state.saved?'committed':'pending',renewalVerified:state.saved,revision:state.saved?3:2,requestId:request.body.requestId}:ready);
  if(request.path===root){
   if(state.delay)await state.delay;
   state.saved=true;
   if(state.fail)return route.abort('failed');
   return answer({...ready,state:'committed',renewalVerified:true,revision:3,requestId:request.body.requestId,...(state.bad?{access_token:'synthetic-private-should-not-display'}:{})});
  }
  return answer({});
 });
 await page.goto(origin+'/reconnect-fixture');
 const frame=page.frameLocator('iframe'),form=frame.getByRole('region',{name:'Secure mHelpDesk reconnect'});
 await expect(frame.getByRole('region',{name:'Unit Tracker workspace'})).toBeVisible();
 return {frame,form,calls,state};
}
async function openAndFill(form){
 await form.getByRole('button',{name:'Reconnect mHelpDesk',exact:true}).click();
 await form.getByLabel('Fresh access token').fill('synthetic-fresh-access');
 await form.getByLabel('Matching refresh token').fill('synthetic-fresh-refresh');
}
test('Owner reconnect is explicit, masked, clears on submission, and verifies only correlated success',async({page})=>{
 const {form,calls,state}=await mount(page);expect(calls.some(x=>x.path.startsWith(root))).toBe(false);
 await openAndFill(form);await expect(form.getByLabel('Fresh access token')).toHaveAttribute('type','password');await expect(form.getByLabel('Matching refresh token')).toHaveAttribute('autocomplete','off');
 let finish;state.delay=new Promise(resolve=>{finish=resolve;});await form.getByRole('button',{name:'Replace pair and verify renewal'}).click();
 await expect(form.getByLabel('Fresh access token')).toHaveCount(0);
 await expect(form.getByRole('button',{name:'Check reconnect result'})).toBeDisabled();
 await form.getByRole('button').evaluateAll(buttons=>{for(const b of buttons){if(b.textContent==='Check reconnect result'){b.click();b.click();}}});
 expect(calls.filter(x=>x.path===root)).toHaveLength(1);finish();
 await expect(form.getByRole('status')).toContainText('Reconnect saved');
 expect(calls.filter(x=>x.path===root)[0].body).toMatchObject({accessToken:'synthetic-fresh-access',refreshToken:'synthetic-fresh-refresh',expectedRevision:2});
 const browserState=await form.evaluate(()=>({local:{...localStorage},session:{...sessionStorage},url:location.href}));expect(JSON.stringify(browserState)).not.toContain('synthetic-fresh');
 await expect(form).not.toContainText('synthetic-fresh');expect(await form.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
});
test('uncertain save clears secrets and explicit metadata check confirms without token replay',async({page})=>{
 const {form,calls,state}=await mount(page);await openAndFill(form);state.fail=true;await form.getByRole('button',{name:'Replace pair and verify renewal'}).click();
 await expect(form.getByRole('status')).toContainText('could not be confirmed');await expect(form.getByLabel('Fresh access token')).toHaveCount(0);
 expect(calls.filter(x=>x.path===root)).toHaveLength(1);
 await form.getByRole('button',{name:'Check reconnect result'}).click();await expect(form.getByRole('status')).toContainText('Reconnect saved');
 expect(calls.filter(x=>x.path===root)).toHaveLength(1);const check=calls.filter(x=>x.path===root+'/status').at(-1).body;
 expect(Object.keys(check).sort()).toEqual(['expectedRevision','requestId']);expect(check.requestId).toBe(calls.find(x=>x.path===root).body.requestId);
});
test('Close, auth invalidation and navigation discard unsubmitted fields',async({page})=>{
 const {form,frame,calls}=await mount(page);await openAndFill(form);await form.getByRole('button',{name:'Close reconnect'}).click();
 await form.getByRole('button',{name:'Reconnect mHelpDesk',exact:true}).click();await expect(form.getByLabel('Fresh access token')).toHaveValue('');
 await form.getByLabel('Fresh access token').fill('synthetic-fresh-access');await form.evaluate(()=>window.dispatchEvent(new Event('cos-private-data-invalidated')));
 await expect(form.getByLabel('Fresh access token')).toHaveCount(0);expect(calls.some(x=>x.path===root)).toBe(false);
 await form.getByRole('button',{name:'Reconnect mHelpDesk',exact:true}).click();await form.getByLabel('Fresh access token').fill('synthetic-fresh-access');
 await frame.locator('body').evaluate(()=>window.dispatchEvent(new Event('popstate')));await expect(form.getByLabel('Fresh access token')).toHaveCount(0);
});
test('malformed response cannot display private values or successful connection',async({page})=>{
 const {form,state}=await mount(page);await openAndFill(form);state.bad=true;await form.getByRole('button',{name:'Replace pair and verify renewal'}).click();
 await expect(form.getByRole('status')).toContainText('could not be confirmed');await expect(form).not.toContainText('synthetic-private-should-not-display');
});
test('IT cannot see reconnect and initiates no reconnect request',async({page})=>{
 const {form,calls}=await mount(page,{role:'it'});await expect(form).toHaveCount(0);expect(calls.some(x=>x.path.startsWith(root))).toBe(false);
});

test('only verified parent hide clears secret fields; a late status cannot reopen a closed form',async({page})=>{
 const {form,state}=await mount(page);await openAndFill(form);
 await form.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{origin:'https://other.invalid',source:window.parent,data:{type:'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'}})));
 await expect(form.getByLabel('Fresh access token')).toHaveValue('synthetic-fresh-access');
 await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'},location.origin));
 await expect(form.getByLabel('Fresh access token')).toHaveCount(0);
 await form.getByRole('button',{name:'Reconnect mHelpDesk',exact:true}).click();
 await expect(form.getByLabel('Fresh access token')).toHaveValue('');
 let release;state.statusDelay=new Promise(resolve=>{release=resolve;});
 await form.getByRole('button',{name:'Reconnect mHelpDesk',exact:true}).click();
 await form.getByRole('button',{name:'Close reconnect'}).click();release();
 await expect(form.getByRole('button',{name:'Reconnect mHelpDesk',exact:true})).toBeEnabled();
 await expect(form.getByLabel('Fresh access token')).toHaveCount(0);
});


for(const interruption of ['replacement session','Close','parent hide','unmount'])test('delayed parent auth cannot transmit token pair after '+interruption,async({page})=>{
 const {form,calls,frame}=await mount(page);await openAndFill(form);await page.evaluate(()=>{window.holdTokenReplies=true;});await form.getByRole('button',{name:'Replace pair and verify renewal'}).click();
 await expect.poll(()=>page.evaluate(()=>Boolean(window.pendingTokenReply))).toBe(true);
 if(interruption==='Close')await form.getByRole('button',{name:'Close reconnect'}).click();
 if(interruption==='parent hide')await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'},location.origin));
 if(interruption==='unmount')await frame.locator('body').evaluate(()=>{location.hash='#field-map';});
 await page.evaluate(value=>{if(value==='replacement session')window.tokenValue='synthetic-replacement-session';window.holdTokenReplies=false;window.pendingTokenReply();},interruption);
 await page.waitForTimeout(100);expect(calls.filter(x=>x.path===root)).toHaveLength(0);await expect(frame.getByLabel('Fresh access token')).toHaveCount(0);
 const snapshot=await frame.locator('body').evaluate(()=>({local:{...localStorage},session:{...sessionStorage},url:location.href}));expect(JSON.stringify(snapshot)).not.toContain('synthetic-fresh');
});

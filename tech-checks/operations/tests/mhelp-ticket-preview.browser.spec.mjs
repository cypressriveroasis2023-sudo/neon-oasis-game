import {test,expect} from '@playwright/test';
import {ticketPreviewFixture} from './fixtures/mhelpTicketPreview.mjs';
const origin='http://127.0.0.1:4173',path='/api/mhelpdesk/partner/tickets/preview';
async function mount(page,{role='owner'}={}){
  const calls=[],state={bad:false,fail:false,denied:false,delay:null,preview:ticketPreviewFixture()};
  // Only local test assets may reach a server. Specific mocks registered below
  // take precedence, including the production-shaped API URL with synthetic data.
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.route(origin+'/ticket-preview-fixture',route=>route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{border:0;width:100%;height:100vh}</style><iframe src="/${role==='it'?'?mode=fleet':''}#unit-tracker"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'${role}',accessToken:'synthetic-only'},location.origin)})</script>`}));
  await page.route('**/functions/v1/cos-operations-pages',async route=>{
    const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    const request=route.request().postDataJSON();calls.push(request);const answer=data=>route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
    if(request.path==='/api/session')return answer({authorized:true,legacyOwner:role==='owner',role:role==='owner'?'Owner':'IT',features:{unitTracker:true,fleetAccess:true}});
    if(request.path==='/api/unit-tracker')return answer({contract:'COS_UNIT_TRACKER_OUTBOX_V1',workbookId:'1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA',connector:{enabled:false,state:'awaiting_sheets_connection'},queueEnabled:false,sources:[],requests:[],sourcesTruncated:false,requestsTruncated:false,sourcesHeld:0});
    if(request.path==='/api/field-map')return answer({items:[],inventoryItems:[],summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0}});
    if(request.path===path){
      // Capture this request's response before waiting, so later fixture changes
      // cannot accidentally turn a stale-response test into a fresh response.
      const {delay,fail,denied}=state,payload=structuredClone({...state.preview,...(state.bad?{automaticSync:true}:{})});
      if(delay)await delay;
      if(fail)return route.abort('failed');
      if(denied)return route.fulfill({status:403,headers,contentType:'application/json',body:JSON.stringify({error:'synthetic private provider text'})});
      return answer(payload);
    }
    return answer({});
  });
  await page.goto(origin+'/ticket-preview-fixture');
  const frame=page.frameLocator('iframe'),preview=frame.getByRole('region',{name:'mHelpDesk ticket type preview'});
  await expect(frame.getByRole('region',{name:'Unit Tracker workspace'})).toBeVisible();
  return {frame,preview,calls,state};
}
test('today ticket preview is explicit, aggregate-only and preserves equipment controls',async({page})=>{
  const {frame,preview,calls}=await mount(page);await expect(preview).toBeVisible();expect(calls.some(call=>call.path===path)).toBe(false);
  await expect(frame.getByRole('button',{name:'Check mHelpDesk connection'})).toBeVisible();
  await preview.getByRole('button',{name:'Preview today’s ticket types'}).click();
  await expect(preview.getByRole('status')).toContainText('3 tickets');await expect(preview).toContainText('Type ID 11');await expect(preview).toContainText('Installation');
  await expect(preview).toContainText('assignment unknown');await expect(preview).toContainText('1 ticket missing a service-location ID');await expect(preview).toContainText('Automatic intake is paused');
  await expect(preview).toContainText('12:00 AM CDT');await expect(preview).toContainText('3:00 PM CDT');
  expect(calls.filter(call=>call.method==='POST').map(call=>({path:call.path,body:call.body}))).toEqual([{path,body:{}}]);
  expect(await preview.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
});
test('repeated clicks issue one request and a failed refresh clears previous counts',async({page})=>{
  const {preview,calls,state}=await mount(page);let release;state.delay=new Promise(resolve=>{release=resolve});
  const button=preview.getByRole('button',{name:'Preview today’s ticket types'});await button.click();await expect(preview.getByRole('button')).toBeDisabled();
  await preview.getByRole('button').evaluate(button=>{button.click();button.click();});await expect.poll(()=>calls.filter(call=>call.path===path).length).toBe(1);
  release();await expect(preview.getByRole('status')).toContainText('3 tickets');state.delay=null;state.bad=true;
  await preview.getByRole('button').click();await expect(preview.getByRole('alert')).toContainText('could not be verified');await expect(preview.getByRole('table')).toHaveCount(0);await expect(preview.getByRole('status')).toHaveCount(0);
});
test('transport failures describe a read failure and retry requires another click',async({page})=>{
  const {preview,calls,state}=await mount(page);state.fail=true;await preview.getByRole('button').click();await expect(preview.getByRole('alert')).toHaveText('The ticket preview could not be verified. Try again.');
  await expect(preview).not.toContainText('save could not be confirmed');expect(calls.filter(call=>call.path===path)).toHaveLength(1);
  state.fail=false;state.preview.window.createdBefore='2026-10-09T21:00:00.000Z';state.preview.readAt='2026-10-09T21:00:01.000Z';
  await preview.getByRole('button').click();await expect(preview).toContainText('4:00 PM CDT');expect(calls.filter(call=>call.path===path)).toHaveLength(2);
});
test('navigating away discards an unfinished preview and does not auto-read when returning',async({page})=>{
  const {frame,preview,calls,state}=await mount(page);let release;state.delay=new Promise(resolve=>{release=resolve});
  await preview.getByRole('button').click();await expect(preview.getByRole('button')).toBeDisabled();
  await expect.poll(()=>calls.filter(call=>call.path===path).length).toBe(1);
  await frame.locator('body').evaluate(()=>{location.hash='#field-map';});await expect(preview).toHaveCount(0);
  await frame.locator('body').evaluate(()=>{location.hash='#unit-tracker';});await expect(preview).toBeVisible();
  const response=page.waitForResponse(response=>response.url().endsWith('/functions/v1/cos-operations-pages')&&response.request().method()==='POST'&&response.request().postDataJSON()?.path===path);
  release();state.delay=null;await (await response).finished();
  // Observe after the completed old response has had a rendering opportunity.
  await frame.locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(preview.getByRole('status')).toHaveCount(0);expect(calls.filter(call=>call.path===path)).toHaveLength(1);
});
test('an expired Owner session clears old aggregates and does not display provider text',async({page})=>{
  const {preview,calls,state}=await mount(page);await preview.getByRole('button').click();await expect(preview.getByRole('status')).toContainText('3 tickets');
  state.denied=true;await preview.getByRole('button').click();
  await expect(preview.getByRole('alert')).toHaveText('Your Owner session could not be verified. Return to Tech Check and sign in again.');
  await expect(preview.getByRole('table')).toHaveCount(0);await expect(preview.getByRole('status')).toHaveCount(0);await expect(preview).not.toContainText('synthetic private');
  expect(calls.filter(call=>call.path===path)).toHaveLength(2);
});
test('verified IT has no ticket preview button and makes no ticket request',async({page})=>{
  const {preview,calls}=await mount(page,{role:'it'});await expect(preview).toHaveCount(0);expect(calls.some(call=>call.path===path)).toBe(false);
});

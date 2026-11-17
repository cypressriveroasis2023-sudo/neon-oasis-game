import {expectOperationsReloadRequired} from './helpers/operationsAccess.mjs';
import {traverseIframeHistory} from './helpers/iframeHistory.mjs';
import {test,expect} from '@playwright/test';
import {existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const origin='http://127.0.0.1:4173',dist=resolve(process.env.COS_STATUS_TEST_DIST||fileURLToPath(new URL('../dist',import.meta.url)));
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
  if(request.path==='/api/mhelpdesk/intake/status?capability=pending_schedule_v1'){
   const value=structuredClone(state.value),failure=state.failure;
   if(state.hold)await new Promise(resolve=>state.releases.push(resolve));
   return answer(failure?{error:'PRIVATE source body contact@example.invalid secret'}:value,failure||200);
  }
  return answer({items:[]});
 });
 await page.goto(origin+'/intake-fixture');const frame=page.frameLocator('iframe');
 if(role==='owner')await expect(frame.getByRole('region',{name:'Unit Tracker workspace',exact:true})).toBeVisible();
 else if(role==='it')await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#unit-tracker');
 else await expectOperationsReloadRequired(frame);
 return {frame,panel:frame.getByRole('region',{name:'mHelpDesk automatic intake status',exact:true}),state};
}
const reads=state=>state.calls.filter(x=>x.path==='/api/mhelpdesk/intake/status?capability=pending_schedule_v1');
const refresh=panel=>panel.getByRole('button',{name:'Refresh intake status',exact:true});
test('intake refresh does not call the retired status route',async({page})=>{
 const {panel,state}=await mount(page);
 await expect(panel).toContainText('Intake state unknown');
 await refresh(panel).click();
 await expect(panel.getByRole('alert')).toContainText('Intake state is unknown');
 expect(reads(state)).toHaveLength(0);
 expect(state.calls.some(item=>String(item.path).includes('/api/mhelpdesk/intake'))).toBe(false);
 expect(state.errors).toEqual([]);
});
test('IT and Service sessions do not read intake status',async({page})=>{
 const it=await mount(page,{role:'it'});
 await expect(it.panel).toHaveCount(0);
 expect(reads(it.state)).toHaveLength(0);
 const service=await mount(page,{role:'service'});
 expect(reads(service.state)).toHaveLength(0);
});

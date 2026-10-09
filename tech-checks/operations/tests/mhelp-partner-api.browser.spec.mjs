import {test,expect} from '@playwright/test';
const origin='http://127.0.0.1:4173';
const status={contract:'cos-mhelpdesk-partner-review-v1',docsUrl:'https://www.mhelpdesk.com/partner-api/index.html',mode:'read_only_review',state:'setup_required',portalConfigured:false,tokenConfigured:false,automaticSync:false,sheetsPublisher:false,liveAccessVerified:false};
const item={equipmentId:'1001',portalId:'224643',name:'Sniper 2 023.1',model:'Sniper 2',equipmentTypeId:'20',customerId:'21',serviceLocationId:'22',active:true,updatedAt:'2026-10-09T01:00:00Z',identity:{state:'review_needed',nativeUnitId:null,candidateUnitIds:[]}};
async function mount(page,{configured=false,role='owner'}={}){
 const calls=[],state={bad:false};
 await page.route(origin+'/partner-fixture',route=>route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{border:0;width:100%;height:100vh}</style><iframe src="/${role==='it'?'?mode=fleet':''}#unit-tracker"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'${role}',accessToken:'synthetic-only'},location.origin)})</script>`}));
 await page.route('**/functions/v1/cos-operations-pages',async route=>{
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();calls.push(request);
  const answer=data=>route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
  if(request.path==='/api/session')return answer({authorized:true,legacyOwner:role==='owner',role:role==='owner'?'Owner':'IT',features:{unitTracker:true,fleetAccess:true}});
  if(request.path==='/api/unit-tracker')return answer({contract:'COS_UNIT_TRACKER_OUTBOX_V1',workbookId:'1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA',connector:{enabled:false,state:'awaiting_sheets_connection'},queueEnabled:false,sources:[],requests:[],sourcesTruncated:false,requestsTruncated:false,sourcesHeld:0});
  if(request.path==='/api/field-map')return answer({items:[],inventoryItems:[],summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0}});
  if(request.path==='/api/mhelpdesk/partner/status')return answer(configured?{...status,state:'ready_to_test',portalConfigured:true,tokenConfigured:true}:status);
  if(request.path==='/api/mhelpdesk/partner/preview')return answer({...status,state:'preview_verified',portalConfigured:true,tokenConfigured:true,liveAccessVerified:true,readAt:'2026-10-09T01:01:00Z',totalRows:100,partial:true,items:[item],...(state.bad?{automaticSync:true}:{})});
  return answer({});
 });
 await page.goto(origin+'/partner-fixture');
 const frame=page.frameLocator('iframe'),workspace=frame.getByRole('region',{name:'Unit Tracker workspace'});
 await expect(workspace).toBeVisible();return{frame,review:frame.getByRole('region',{name:'mHelpDesk Partner API review'}),calls,state};
}
test('setup requires an explicit check and never claims live sync or calls equipment preview',async({page})=>{
 const {review,calls}=await mount(page);await expect(review).toBeVisible();
 expect(calls.some(x=>x.path.startsWith('/api/mhelpdesk/partner/'))).toBe(false);
 await review.getByRole('button',{name:'Check mHelpDesk connection'}).click();
 await expect(review.getByRole('status')).toContainText('Connection setup required');await expect(review).toContainText('Automatic sync is paused');
 await expect(review.getByRole('button',{name:'Preview mHelpDesk equipment'})).toHaveCount(0);
 expect(calls.some(x=>x.path.endsWith('/preview'))).toBe(false);
 await expect(review.getByRole('link',{name:'Partner API documentation'})).toHaveAttribute('href',status.docsUrl);
});
test('verified read displays partial coverage, exact decimal label and separate administrative activity',async({page})=>{
 const {review,calls}=await mount(page,{configured:true});
 await review.getByRole('button',{name:'Check mHelpDesk connection'}).click();await expect(review).toContainText('Test an equipment read');
 await review.getByLabel('Full mHelpDesk equipment label (optional)').fill(item.name);
 await review.getByRole('button',{name:'Preview mHelpDesk equipment'}).click();
 await expect(review).toContainText('API equipment read verified');await expect(review).toContainText('Showing 1 of 100');await expect(review).toContainText('additional records have not been read');
 await expect(review.locator('tbody')).toContainText('Sniper 2 023.1');await expect(review).toContainText('Equipment link needs review');await expect(review).toContainText('administrative flag');await expect(review).toContainText('Addresses and GPS have not changed');
  await expect(review.locator('tbody').getByText('Equipment link needs review',{exact:true})).toBeVisible();
 expect(calls.find(x=>x.path.endsWith('/preview')).body).toEqual({name:item.name});
 await expect(review.getByRole('button',{name:'View Field View'})).toHaveCount(0);
 expect(calls.filter(x=>x.method==='POST').map(x=>x.path)).toEqual(['/api/mhelpdesk/partner/preview']);
 expect(await review.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
});
test('invalid preview is rejected without leaving stale verified results',async({page})=>{
 const {review,state}=await mount(page,{configured:true});await review.getByRole('button',{name:'Check mHelpDesk connection'}).click();
 state.bad=true;await review.getByRole('button',{name:'Preview mHelpDesk equipment'}).click();await expect(review.getByRole('alert')).toContainText('could not be verified');await expect(review.locator('tbody')).toHaveCount(0);
});
test('verified IT has no Partner API connection controls',async({page})=>{
 const {review,calls}=await mount(page,{role:'it'});await expect(review).toHaveCount(0);expect(calls.some(x=>x.path.startsWith('/api/mhelpdesk/partner/'))).toBe(false);
});

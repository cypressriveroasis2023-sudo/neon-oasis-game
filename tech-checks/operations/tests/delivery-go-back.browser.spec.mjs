import { test, expect } from '@playwright/test';

// Synthetic records and bearer token are confined to this test. External traffic
// is blocked, and bridge responses are intercepted before any production call.
const origin='http://127.0.0.1:4173';
const edge='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const day='2026-10-04';
const now=day+'T15:00:00.000Z';
const jobId='11111111-1111-4111-8111-111111111111';
const reviewId='33333333-3333-4333-8333-333333333333';
const visitId='22222222-2222-4222-8222-222222222222';
function harness(workspace) {
  return '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0;display:block}</style></head><body><iframe id="operations" title="Operations test fixture" src="/?theme=classic#'+workspace+'"></iframe><script>window.addEventListener("message",function(event){var frame=document.getElementById("operations");if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data.type!=="COS_OPERATIONS_TOKEN_REQUEST")return;event.source.postMessage({type:"COS_OPERATIONS_TOKEN_RESPONSE",requestId:event.data.requestId,accessToken:"synthetic-owner-session",role:"owner"},location.origin);});</script></body></html>';
}
function fixture() {
  return {
    jobs:[
      {id:jobId,visitId,jobNumber:'FIX-101',customer:'Fixture North Yard',site:'North Gate',department:'service',technician:'Unassigned',status:'Unscheduled',stage:'Service',jobType:'Service',equipment:'Sniper',equipmentUnitTag:'FIX-SN-001',priority:'high'},
      {id:reviewId,visitId:'44444444-4444-4444-8444-444444444444',jobNumber:'FIX-102',customer:'Fixture Review Yard',site:'Review Gate',department:'service',technician:'Casey Service',goBackAvailable:true,status:'Owner Review',stage:'Owner Review',jobType:'DELIVERY',scheduled:day+' 09:00',equipmentUnitTag:'FIX-SN-002',billingReady:false,needsAttention:true,photos:[{id:'photo-1',kind:'gate',stage:'Service',by:'Casey Service'}],signatures:[{id:'signature-1',kind:'technician',name:'Casey Service'}],notes:[{text:'Fixture evidence note',by:'Casey Service'}],techCheckHistory:[{stage:'Service',department:'Service',technician:'Casey Service',answers:[{title:'Unit secure',answer:'NO',note:'Owner correction required',by:'Casey Service'}]}]},
    ],
    team:[{userId:'55555555-5555-4555-8555-555555555555',displayName:'Casey Service',department:'service',active:true},{userId:'66666666-6666-4666-8666-666666666666',displayName:'Jordan IT',department:'it',active:true}],
    handoffs:[{jobId,toVisitId:visitId,jobNumber:'FIX-101',customer:'Fixture North Yard',site:'North Gate',jobType:'Service',equipmentUnitTag:'FIX-SN-001',fromDepartment:'it',fromTechnician:'Jordan IT',fromVisitType:'it_prep',toDepartment:'service',toTechnician:'Unassigned',toVisitType:'service',status:'Ready to schedule'}],
    failedPaths:new Set(),writes:[],requests:[],readbackMismatch:false,
  };
}
async function openFixture(page,workspace) {
  const state=fixture();
  await page.clock.install({time:new Date(now)});
  await page.route('**/*',async route=>{
    const request=route.request(),url=request.url();
    if(url===origin+'/workflow-harness')return route.fulfill({contentType:'text/html',body:harness(workspace)});
    if(url.startsWith(origin+'/'))return route.continue();
    if(url!==edge)return route.abort('blockedbyclient');
    const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
    expect(await request.headerValue('authorization')).toBe('Bearer synthetic-owner-session');
    const envelope=request.postDataJSON();
    state.requests.push(envelope);
    const {path,method,body}=envelope;
    if(state.failedPaths.has(path))return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:'Fixture source unavailable'})});
    let data;
    if(method==='GET') {
      if(path==='/api/routers')data={ items: [], source: 'camera_health', gpsAvailable: false, generatedAt: new Date().toISOString() };
      else if(path==='/api/camera-health/summary-v3')data={totalDevices:0,online:0,offline:0,review:0,shopRoot:0,healthRows:0,fieldDevices:0,refreshedAt:new Date().toISOString(),rows:[]};
      else if(path==='/api/session')data={authorized:true,role:'Owner',name:'Fixture Owner'};
      else if(path==='/api/jobs'){
        data={items:structuredClone(state.readbackMismatch?state.jobs.map(row=>row.id===jobId?{...row,status:'Scheduled'}:row):state.jobs)};
        if(state.holdJobsRead)await new Promise(resolve=>{state.releaseJobsRead=resolve;});
      }
      else if(path==='/api/daily-board')data={jobs:state.jobs,tasks:[],readiness:[],asOf:now};
      else if(path==='/api/tv-board/settings')data={sections:['today','pickup','swap','delivery','service','shop','camera','map'],revision:0,updatedAt:null};
      else if(path==='/api/owner/control-data')data={sites:[],truckChecks:[],serviceTechnicians:[],itTechnicians:[]};
      else if(path==='/api/owner-review')data={items:state.jobs.filter(row=>row.status==='Owner Review')};
      else if(path==='/api/team-production')data={items:state.team};
      else if(path==='/api/handoffs')data={items:state.handoffs};
      else if(['/api/quotes','/api/ar','/api/purchasing','/api/owner-tasks','/api/sites','/api/customers'].includes(path))data={items:[]};
      else throw new Error('Unexpected fixture GET '+path);
    } else if(method==='POST') {
      state.writes.push(envelope);
      const action=/^\/api\/jobs\/([^/]+)\/(schedule|dispatch|owner-review|go-back)$/.exec(path);
      if(!action)throw new Error('Unexpected fixture POST '+path);
      const job=state.jobs.find(row=>row.id===action[1]);
      if(!job)throw new Error('Unknown fixture job');
      if(action[2]==='go-back') {
        if(state.failWrite)return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:'Synthetic save outcome unknown'})});
        if(state.holdWrite)await new Promise(resolve=>{state.releaseWrite=resolve;});
        if(!state.ignoreWrite)Object.assign(job,{status:'Unscheduled',department:'service',stage:'Service Delivery',visitId:'77777777-7777-4777-8777-777777777777',scheduled:'Not scheduled',technician:'Unassigned',billingReady:false,goBack:{...body,jobId:job.id,visitId:'77777777-7777-4777-8777-777777777777',previousVisitId:job.visitId,status:'planned',required:true,completionVerified:false,completedAt:null}});
      }
      else if(action[2]==='schedule')Object.assign(job,{scheduled:body.start,scheduledEnd:body.end,technician:body.technician,status:'Scheduled'});
      else if(action[2]==='dispatch')job.status='Dispatched';
      else if(body.action==='approve')Object.assign(job,{status:'Billing Ready',stage:'Billing',billingReady:true});
      else Object.assign(job,{status:'Unscheduled',stage:'Service',billingReady:false,activity:['Returned by Owner: '+body.reason]});
      data={accepted:true};
    } else throw new Error('Unexpected fixture method '+method);
    return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('/workflow-harness');
  const frame=page.frameLocator('#operations');
  await expect(frame.getByText('OPERATIONS CONNECTED',{exact:true})).toBeVisible();
  return {frame,state};
}
async function noOverflow(page) {
  const frame=page.frames().find(frame=>frame.parentFrame());
  const size=await frame.evaluate(()=>({viewport:innerWidth,width:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)}));
  expect(size.width).toBeLessThanOrEqual(size.viewport+1);
}
async function routeTo(page,workspace) {
  const frame=page.frames().find(frame=>frame.parentFrame());
  await frame.evaluate(workspace=>{location.hash=workspace;},workspace);
}
async function scheduleDialog(frame) {
  await frame.getByRole('button',{name:'Schedule + Assign',exact:true}).click();
  const dialog=frame.getByRole('dialog',{name:'Schedule and assign job'});
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type=date]').fill(day);
  await dialog.locator('input[type=time]').nth(0).fill('08:00');
  await dialog.locator('input[type=time]').nth(1).fill('10:00');
  await expect(dialog.getByRole('option',{name:'Jordan IT',exact:true})).toHaveCount(0);
  await dialog.locator('select').selectOption('Casey Service');
  return dialog;
}


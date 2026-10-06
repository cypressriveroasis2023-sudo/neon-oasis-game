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
      {id:reviewId,visitId:'44444444-4444-4444-8444-444444444444',jobNumber:'FIX-102',customer:'Fixture Review Yard',site:'Review Gate',department:'service',technician:'Casey Service',status:'Owner Review',stage:'Owner Review',jobType:'Service',scheduled:day+' 09:00',equipmentUnitTag:'FIX-SN-002',billingReady:false,needsAttention:true,photos:[{id:'photo-1',kind:'gate',stage:'Service',by:'Casey Service'}],signatures:[{id:'signature-1',kind:'technician',name:'Casey Service'}],notes:[{text:'Fixture evidence note',by:'Casey Service'}],techCheckHistory:[{stage:'Service',department:'Service',technician:'Casey Service',answers:[{title:'Unit secure',answer:'NO',note:'Owner correction required',by:'Casey Service'}]}]},
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
      else if(path==='/api/camera-health/summary')data={totalDevices:0,online:0,offline:0,review:0,shopRoot:0,healthRows:0,fieldDevices:0,refreshedAt:new Date().toISOString(),rows:[]};
      else if(path==='/api/session')data={authorized:true,role:'Owner',name:'Fixture Owner'};
      else if(path==='/api/jobs'){
        data={items:structuredClone(state.readbackMismatch?state.jobs.map(row=>row.id===jobId?{...row,status:'Scheduled'}:row):state.jobs)};
        if(state.holdJobsRead)await new Promise(resolve=>{state.releaseJobsRead=resolve;});
      }
      else if(path==='/api/owner-review')data={items:state.jobs.filter(row=>row.status==='Owner Review')};
      else if(path==='/api/team-production')data={items:state.team};
      else if(path==='/api/handoffs')data={items:state.handoffs};
      else if(['/api/quotes','/api/ar','/api/purchasing','/api/owner-tasks','/api/sites'].includes(path))data={items:[]};
      else throw new Error('Unexpected fixture GET '+path);
    } else if(method==='POST') {
      state.writes.push(envelope);
      const action=/^\/api\/jobs\/([^/]+)\/(schedule|dispatch|owner-review)$/.exec(path);
      if(!action)throw new Error('Unexpected fixture POST '+path);
      const job=state.jobs.find(row=>row.id===action[1]);
      if(!job)throw new Error('Unknown fixture job');
      if(action[2]==='schedule')Object.assign(job,{scheduled:body.start,scheduledEnd:body.end,technician:body.technician,status:'Scheduled'});
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

test('native Jobs scheduling validates department and times, sends one write, and survives refresh',async({page})=>{
  const {frame,state}=await openFixture(page,'unscheduled');
  const dialog=await scheduleDialog(frame);
  await dialog.locator('input[type=time]').nth(1).fill('07:00');
  await dialog.getByRole('button',{name:'SAVE SCHEDULE & ASSIGN',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('End time must be after start time.');
  expect(state.writes).toHaveLength(0);
  await dialog.locator('input[type=time]').nth(1).fill('10:00');
  await noOverflow(page);
  await dialog.getByRole('button',{name:'SAVE SCHEDULE & ASSIGN',exact:true}).click();
  await expect(dialog).toBeHidden();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].body).toEqual({start:day+' 08:00',end:day+' 10:00',technician:'Casey Service'});
  await page.reload();
  await routeTo(page,'jobs');
  await expect(frame.locator('.record.op-record').filter({hasText:'FIX-101'})).toContainText(day+' 08:00');
  await expect(frame.locator('.record.op-record').filter({hasText:'FIX-101'})).toContainText('Casey Service');
  expect(state.writes).toHaveLength(1);
  await noOverflow(page);
});

test('native Dispatch verifies one write and preserves an unverified outcome until refresh',async({page})=>{
  const {frame,state}=await openFixture(page,'jobs');
  Object.assign(state.jobs[0],{status:'Scheduled',technician:'Casey Service',scheduled:day+' 08:00',scheduledEnd:day+' 10:00'});
  await routeTo(page,'dispatch');
  await expect(frame.locator('.row-actions').getByRole('button',{name:'Dispatch',exact:true})).toBeVisible();
  state.readbackMismatch=true;
  await frame.locator('.row-actions').getByRole('button',{name:'Dispatch',exact:true}).click();
  await expect(frame.getByRole('alert')).toContainText('Save accepted, but the requested job change could not be verified.');
  expect(state.writes).toHaveLength(1);
  await expect(frame.locator('.row-actions').getByRole('button',{name:'Dispatch',exact:true})).toBeDisabled();
  const reads=state.requests.filter(request=>request.path==='/api/jobs'&&request.method==='GET').length;
  await frame.locator('body').evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect.poll(()=>state.requests.filter(request=>request.path==='/api/jobs'&&request.method==='GET').length).toBeGreaterThan(reads);
  await expect(frame.getByRole('button',{name:'Refresh jobs',exact:true})).toBeEnabled();
  await expect(frame.getByRole('alert')).toContainText('Save accepted, but the requested job change could not be verified.');
  await expect(frame.locator('.row-actions').getByRole('button',{name:'Dispatch',exact:true})).toBeDisabled();
  state.failedPaths.add('/api/jobs');
  await frame.getByRole('button',{name:'Refresh before another action',exact:true}).click();
  await expect(frame.getByRole('alert').filter({hasText:'Fixture source unavailable'})).toBeVisible();
  await expect(frame.locator('.row-actions').getByRole('button',{name:'Dispatch',exact:true})).toBeDisabled();
  state.failedPaths.delete('/api/jobs');
  state.readbackMismatch=false;
  await frame.getByRole('button',{name:'Refresh before another action',exact:true}).click();
  await expect(frame.locator('.record.op-record').filter({hasText:'FIX-101'})).toContainText('Dispatched');
  await expect(frame.locator('.row-actions').getByRole('button',{name:'Dispatch',exact:true})).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  await noOverflow(page);
});

test('native Jobs blocks actions during an explicit recovery refresh',async({page})=>{
  const {frame,state}=await openFixture(page,'unscheduled');
  await expect(frame.getByRole('button',{name:'Schedule + Assign',exact:true})).toBeEnabled();
  await frame.getByRole('searchbox').click();
  await expect(frame.getByRole('button',{name:'Refresh jobs',exact:true})).toBeEnabled();
  state.holdJobsRead=true;
  await frame.getByRole('button',{name:'Refresh jobs',exact:true}).click();
  await expect.poll(()=>Boolean(state.releaseJobsRead)).toBe(true);
  await expect(frame.getByRole('button',{name:'Schedule + Assign',exact:true})).toBeDisabled();
  expect(state.writes).toHaveLength(0);
  state.holdJobsRead=false;state.releaseJobsRead();
  const dialog=await scheduleDialog(frame);
  await dialog.getByRole('button',{name:'SAVE SCHEDULE & ASSIGN',exact:true}).click();
  await expect(dialog).toBeHidden();
  expect(state.writes).toHaveLength(1);
});

test('native Jobs ignores a pre-write passive snapshot after an unknown write outcome',async({page})=>{
  const {frame,state}=await openFixture(page,'unscheduled');
  const dialog=await scheduleDialog(frame);
  state.holdJobsRead=true;
  await frame.locator('body').evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect.poll(()=>Boolean(state.releaseJobsRead)).toBe(true);
  const path='/api/jobs/'+jobId+'/schedule';state.failedPaths.add(path);
  await dialog.getByRole('button',{name:'SAVE SCHEDULE & ASSIGN',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Fixture source unavailable');
  await expect(dialog.getByRole('button',{name:'SAVE SCHEDULE & ASSIGN',exact:true})).toBeDisabled();
  state.holdJobsRead=false;state.releaseJobsRead();
  await expect(dialog.getByRole('button',{name:'Refresh jobs',exact:true})).toBeEnabled();
  await expect(dialog.getByRole('alert')).toContainText('Fixture source unavailable');
  await expect(dialog.getByRole('button',{name:'SAVE SCHEDULE & ASSIGN',exact:true})).toBeDisabled();
  expect(state.requests.filter(request=>request.method==='POST'&&request.path===path)).toHaveLength(1);
});

test('native Calendar Month, Week and Year views show real scheduled records without viewport overflow',async({page})=>{
  const {frame}=await openFixture(page,'calendar');
  await expect(frame.getByRole('grid')).toBeVisible();
  await expect(frame.getByRole('button',{name:'FIX-102 · Fixture Review Yard',exact:true})).toBeVisible();
  await noOverflow(page);
  await frame.getByRole('button',{name:'Week',exact:true}).click();
  await expect(frame.getByRole('gridcell')).toHaveCount(7);
  await noOverflow(page);
  await frame.getByRole('button',{name:'Year',exact:true}).click();
  await expect(frame.locator('.calendar-year button')).toHaveCount(12);
  await expect(frame.locator('.calendar-year button').filter({hasText:'October'})).toContainText('1 scheduled');
  await noOverflow(page);
});

test('native Handoffs keeps loaded routing when refresh fails, never claims an empty source',async({page})=>{
  const {frame,state}=await openFixture(page,'handoffs');
  await expect(frame.locator('.record.op-record')).toContainText('Jordan IT');
  await expect(frame.locator('.record.op-record')).toContainText('TO: SERVICE');
  state.failedPaths.add('/api/handoffs');
  await frame.getByRole('button',{name:'Refresh handoffs',exact:true}).click();
  await expect(frame.getByRole('alert')).toContainText('Fixture source unavailable');
  await expect(frame.getByRole('alert')).toContainText('Showing the last successful routing records.');
  await expect(frame.locator('.record.op-record')).toContainText('FIX-101');
  await expect(frame.getByText('No department handoffs are currently waiting for the next COS stage.',{exact:true})).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
  await noOverflow(page);
});

test('native Owner Review preserves failed check, photo, signature and note evidence during correction',async({page})=>{
  const {frame,state}=await openFixture(page,'owner-review');
  await expect(frame.getByText('Needs Attention items remain open.',{exact:true})).toBeVisible();
  await expect(frame.getByLabel('Field evidence for FIX-102')).toContainText('1 FAILED CHECK(S)');
  await expect(frame.getByLabel('Field evidence for FIX-102')).toContainText('Photo preserved; file link unavailable.');
  await expect(frame.getByLabel('Field evidence for FIX-102')).toContainText('Signature recorded; file link unavailable.');
  await expect(frame.getByLabel('Field evidence for FIX-102')).toContainText('Fixture evidence note');
  await frame.getByRole('button',{name:'Return for Correction',exact:true}).click();
  const dialog=frame.getByRole('dialog',{name:'Return for Correction',exact:true});
  await expect(dialog).toBeVisible();
  await dialog.locator('textarea').fill('Correct the fixture mounting.');
  await dialog.getByRole('button',{name:'RETURN JOB FOR CORRECTION',exact:true}).click();
  await expect(dialog).toBeHidden();
  expect(state.writes).toHaveLength(1);
  expect(state.jobs[1].status).toBe('Unscheduled');
  expect(state.jobs[1].techCheckHistory).toHaveLength(1);
  expect(state.jobs[1].signatures).toHaveLength(1);
  expect(state.jobs[1].photos).toHaveLength(1);
  await noOverflow(page);
});

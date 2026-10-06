import { test, expect } from '@playwright/test';
// Isolated synthetic mutation coverage. No external request reaches production.
const origin='http://127.0.0.1:4173', edge='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const jobId='11111111-1111-4111-8111-111111111111',visitId='22222222-2222-4222-8222-222222222222',siteId='33333333-3333-4333-8333-333333333333',checkId='44444444-4444-4444-8444-444444444444',createdId='55555555-5555-4555-8555-555555555555',nextVisit='66666666-6666-4666-8666-666666666666';
const now='2026-10-05T15:00:00Z';
async function mount(page,workspace='daily-board'){
 const state={jobs:[{id:jobId,jobNumber:'TEST-101',jobType:'DELIVERY',visitId,status:'Unscheduled',department:'it',stage:'IT Prep',technician:'Jordan IT',customer:'Fixture Customer',site:'Fixture Site',equipmentUnitTag:'TEST-SN-1'}],tasks:[],writes:[],requests:[],unchanged:false,failRead:false,taskMismatch:false,
 control:{sites:[{id:siteId,name:'Fixture Site',customers:{name:'Fixture Customer'}}],truckChecks:[{id:checkId,technician:'Casey Service',department:'service',status:'pending',ownerApproved:false,result:{}}],itTechnicians:['Jordan IT','Morgan IT'],serviceTechnicians:['Casey Service']}};
 await page.clock.install({time:new Date(now)});
 await page.route('**/*',async route=>{
  const request=route.request(),url=request.url();
  if(url===origin+'/owner-fixture')return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0;display:block}</style></head><body><iframe id="operations" src="/?theme=classic#${workspace}" title="Synthetic Owner Controls"></iframe><script>addEventListener('message',event=>{const frame=document.getElementById('operations');if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data.type!=='COS_OPERATIONS_TOKEN_REQUEST')return;event.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:event.data.requestId,accessToken:'synthetic-owner-only',role:'owner'},location.origin)});</script></body></html>`});
  if(url.startsWith(origin+'/'))return route.continue();
  if(url!==edge)return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  expect(await request.headerValue('authorization')).toBe('Bearer synthetic-owner-only');
  const envelope=request.postDataJSON();state.requests.push(envelope);const {path,method,body}=envelope;
  const answer=data=>route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
  if(method==='GET'){
   if(state.readGate&&['/api/jobs','/api/owner/control-data','/api/owner-tasks'].includes(path))await state.readGate;
   if(state.failRead&&['/api/jobs','/api/owner/control-data'].includes(path))return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:'Synthetic refresh unavailable'})});
   if(path==='/api/routers')return answer({ items: [], source: 'camera_health', gpsAvailable: false, generatedAt: new Date().toISOString() });
   if(path==='/api/camera-health/summary')return answer({totalDevices:0,online:0,offline:0,review:0,shopRoot:0,healthRows:0,fieldDevices:0,refreshedAt:new Date().toISOString(),rows:[]});
   if(path==='/api/session')return answer({authorized:true,name:'Fixture Owner',role:'Owner'});
   if(path==='/api/jobs')return answer({items:state.jobs});
   if(path==='/api/owner/control-data')return answer(state.control);
   if(path==='/api/daily-board')return answer({jobs:state.jobs,tasks:state.tasks,readiness:[],asOf:now});
   if(path==='/api/owner-tasks')return answer({items:state.tasks.map(task=>({...task,...(state.taskMismatch?{relatedJobId:null,relatedSiteId:null,ownerNotes:'old note'}:{}),...(state.taskAssignedMismatch?{assignedUserId:checkId}:{})}))});
   if(path==='/api/sites')return answer({items:state.control.sites});
   if(path==='/api/team-production')return answer({items:[{userId:checkId,displayName:'Casey Service',department:'service',active:true}]});
   if(['/api/quotes','/api/ar','/api/purchasing'].includes(path))return answer({items:[]});
   throw Error('Unexpected synthetic GET '+path);
  }
  expect(method).toBe('POST');state.writes.push(envelope);
  if(path==='/api/owner/jobs/manual'){
   if(!state.unchanged)state.jobs.push({...state.jobs[0],id:createdId,jobNumber:'TEST-102',jobType:body.jobType,technician:'Unassigned'});
   return answer({job_id:createdId,job_number:'TEST-102',job_type:body.jobType,visit_count:2,created_by_owner:true});
  }
  if(path==='/api/owner-tasks'){
   const row={...body,id:body.id||createdId,status:'assigned',assignedTo:body.assignedUserId?'Casey Service':'IT'};
   state.tasks=state.tasks.filter(task=>task.id!==row.id).concat(row);return answer({id:row.id});
  }
  if(path===`/api/jobs/${jobId}/assign`){if(!state.unchanged)state.jobs[0].technician=body.technician;return answer({accepted:true});}
  if(path===`/api/jobs/${jobId}/close`){if(!state.unchanged)Object.assign(state.jobs[0],{status:'Closed',visitId:null});return answer({job_id:jobId,job_number:'TEST-101',status:'closed'});}
  if(path===`/api/jobs/${jobId}/remove`){if(!state.unchanged)state.jobs=[];return answer({deleted:true,job_id:jobId,job_number:'TEST-101'});}
  if(path===`/api/owner/jobs/${jobId}/advance-it`){if(!state.unchanged)Object.assign(state.jobs[0],{visitId:nextVisit,stage:'Service Delivery',department:'service',status:'Scheduled',technician:body.serviceTechnician,equipmentUnitTag:body.unitNumber,scheduled:body.start,scheduledEnd:body.end});return answer({job_id:jobId,next_visit_id:nextVisit,next_department:'service',owner_override:true});}
  if(path===`/api/owner/truck-checks/${checkId}/approve`){if(!state.unchanged)Object.assign(state.control.truckChecks[0],{status:'completed',ownerApproved:true,result:{owner_override:true,owner_override_missing_fields:['backup battery identifier']}});return answer({check_id:checkId,owner_approved:true,status:'completed',missing_fields:['backup battery identifier']});}
  throw Error('Unexpected synthetic write '+path);
 });
 await page.goto('/owner-fixture');
 const frame=page.frameLocator('#operations'),controls=frame.locator('.owner-board-controls');
 await expect(frame.getByText('OPERATIONS CONNECTED',{exact:true})).toBeVisible();
 if(workspace==='daily-board')await expect(controls.getByRole('button',{name:'ADD COS JOB',exact:true})).toBeEnabled();
 const size=await frame.locator('body').evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth}));expect(size.content).toBeLessThanOrEqual(size.width+1);
 return {state,frame,controls};
}
async function selectJob(controls){await controls.getByLabel('Selected COS Job').selectOption(jobId);}
async function prompt(frame,value){const dialog=frame.getByRole('dialog');await expect(dialog).toBeVisible();if(value!==undefined)await dialog.locator('input,textarea').fill(value);await dialog.getByRole('button',{name:'SAVE & CONTINUE',exact:true}).click();}
async function confirm(frame){await frame.getByRole('dialog').getByRole('button',{name:'CONFIRM & CONTINUE',exact:true}).click();}
async function navigate(page,frame,name){
 const button=frame.getByRole('navigation',{name:'COS Operations',exact:true}).getByRole('button',{name:new RegExp('^'+(name==='Jobs'?'Job flow':name)+'(?:$| AppDeploy| ↗)')});
 if(!await button.isVisible())await frame.getByRole('button',{name:'More',exact:true}).click();
 await button.click();
}

test('Owner creates one synthetic job, verifies its fresh identity and preserves it after reload',async({page})=>{
 const {state,frame,controls}=await mount(page);
 await controls.getByRole('button',{name:'ADD COS JOB',exact:true}).click();await expect(controls.getByRole('alert')).toContainText('Choose a site');expect(state.writes).toHaveLength(0);
 await controls.getByLabel('Customer / Site').selectOption(siteId);await controls.getByLabel('Title',{exact:true}).fill('Synthetic delivery');
 await controls.getByRole('button',{name:'ADD COS JOB',exact:true}).click();
 await expect(frame.getByRole('status').filter({hasText:'TEST-102 created and found in current jobs.'})).toBeVisible();
 await expect(controls.getByLabel('Selected COS Job')).toHaveValue(createdId);expect(state.writes).toHaveLength(1);
 await page.reload();await expect(controls.getByLabel('Selected COS Job').locator('option[value="'+createdId+'"]')).toHaveCount(1);expect(state.writes).toHaveLength(1);
});
test('Owner assignment rejects an unchanged readback and stays locked through failed refresh',async({page})=>{
 const {state,controls}=await mount(page);await selectJob(controls);await controls.getByLabel('Assign technician').selectOption('Morgan IT');state.unchanged=true;
 await controls.getByRole('button',{name:'ASSIGN',exact:true}).click();await expect(controls.getByRole('alert')).toContainText('Action accepted, but the saved result could not be verified');
 await expect(controls.getByRole('button',{name:'ASSIGN',exact:true})).toBeDisabled();expect(state.writes).toHaveLength(1);
 state.failRead=true;await controls.getByRole('button',{name:'REFRESH',exact:true}).click();await expect(controls.getByRole('alert')).toContainText('Synthetic refresh unavailable');await expect(controls.getByRole('button',{name:'ASSIGN',exact:true})).toBeDisabled();
 state.failRead=false;state.unchanged=false;await controls.getByRole('button',{name:'REFRESH',exact:true}).click();await expect(controls.getByRole('button',{name:'ASSIGN',exact:true})).toBeEnabled();await controls.getByRole('button',{name:'ASSIGN',exact:true}).click();await expect(controls.getByText('TEST-101', {exact:true})).toBeVisible();expect(state.writes).toHaveLength(2);
});
test('Owner close confirmation Escape and Cancel send no write, then closure is read back',async({page})=>{
 const {state,frame,controls}=await mount(page);await selectJob(controls);
 await controls.getByRole('button',{name:'CLOSE JOB',exact:true}).click();await prompt(frame,'Synthetic completion');
 await page.keyboard.press('Escape');await expect(frame.getByRole('dialog')).toHaveCount(0);expect(state.writes).toHaveLength(0);
 await controls.getByRole('button',{name:'CLOSE JOB',exact:true}).click();await frame.getByRole('dialog').getByRole('button',{name:'CANCEL',exact:true}).click();expect(state.writes).toHaveLength(0);
 await controls.getByRole('button',{name:'CLOSE JOB',exact:true}).click();await prompt(frame,'Synthetic completion');await confirm(frame);
 await expect(frame.getByRole('status').filter({hasText:'TEST-101 closed · saved and verified'})).toBeVisible();await expect(controls.getByLabel('Selected COS Job')).toHaveValue('');expect(state.writes).toHaveLength(1);
});
test('Owner deletes only after exact synthetic confirmation and verifies receipt plus absence',async({page})=>{
 const {state,frame,controls}=await mount(page);await selectJob(controls);
 await controls.getByRole('button',{name:'DELETE JOB',exact:true}).click();await prompt(frame,'DELETE wrong');await expect(controls.getByRole('alert')).toContainText('exact COS Job number');expect(state.writes).toHaveLength(0);
 await controls.getByRole('button',{name:'DELETE JOB',exact:true}).click();await prompt(frame,'DELETE TEST-101');await confirm(frame);
 await expect(frame.getByRole('status').filter({hasText:'TEST-101 permanently deleted · saved and verified'})).toBeVisible();expect(state.jobs).toHaveLength(0);expect(state.writes).toHaveLength(1);
});
test('Owner IT handoff validates times and verifies the new Service visit',async({page})=>{
 const {state,frame,controls}=await mount(page);await selectJob(controls);await controls.getByLabel('Service technician').selectOption('Casey Service');await controls.getByLabel('Service date').fill('2026-10-05');await controls.getByLabel('End time').fill('07:00');
 await controls.getByRole('button',{name:'OWNER VERIFIED · SCHEDULE TO SERVICE',exact:true}).click();await expect(controls.getByRole('alert')).toContainText('after the start');expect(state.writes).toHaveLength(0);
 await controls.getByLabel('End time').fill('10:00');await controls.getByRole('button',{name:'OWNER VERIFIED · SCHEDULE TO SERVICE',exact:true}).click();await confirm(frame);
 await expect(frame.getByRole('status').filter({hasText:'advanced from IT and scheduled to Casey Service · saved and verified'})).toBeVisible();expect(state.jobs[0].visitId).toBe(nextVisit);expect(state.writes).toHaveLength(1);
 await page.reload();await selectJob(controls);await expect(controls.getByRole('button',{name:'OWNER VERIFIED · SCHEDULE TO SERVICE'})).toHaveCount(0);
});
test('Owner truck approval preserves nested missing identifiers without marking stock received',async({page})=>{
 const {state,frame,controls}=await mount(page);await controls.getByRole('button',{name:'APPROVE / OVERRIDE',exact:true}).click();await prompt(frame,'Fixture approved with shortage');await confirm(frame);
 await expect(frame.getByRole('status').filter({hasText:'Truck stock approved · saved and verified'})).toBeVisible();await expect(controls.getByText('backup battery identifier',{exact:true})).toBeVisible();await expect(controls.getByText('Approval does not mark these items received.',{exact:true})).toBeVisible();expect(state.writes).toHaveLength(1);
 await page.reload();await expect(controls.getByText('backup battery identifier',{exact:true})).toBeVisible();
});
test('Every AppDeploy handoff is reachable and workspace Back, Forward and reload preserve destinations',async({page})=>{
 const {state,frame}=await mount(page,'today');
 for(const name of ['Work Requests','CRM','Accounting','Collections','Payments','Needs Attention','History','Reports','Activity']){
  await navigate(page,frame,name);await expect(frame.getByRole('heading',{name,exact:true}).first()).toBeVisible();await expect(frame.getByRole('link',{name:'Open AppDeploy COS Operations ↗'})).toHaveAttribute('href','https://cos-operations-platform-preview-wpbf1y.v2.appdeploy.ai/');
 }
 await navigate(page,frame,'Jobs');await navigate(page,frame,'Team');
 await frame.locator('body').evaluate(()=>history.back());await expect(frame.getByRole('heading',{name:'Job flow',exact:true}).first()).toBeVisible();
 await frame.locator('body').evaluate(()=>history.forward());await expect(frame.getByRole('heading',{name:'Team',exact:true}).first()).toBeVisible();
 await frame.locator('body').evaluate(()=>location.reload());await expect(frame.getByRole('heading',{name:'Team',exact:true}).first()).toBeVisible();expect(state.writes).toHaveLength(0);
});
test('Jobs close dialog supports Escape, Cancel, focus restoration and navigation without mutation',async({page})=>{
 const {state,frame}=await mount(page,'jobs');const close=frame.getByRole('button',{name:'Close Job',exact:true});
 await close.click();const dialog=frame.getByRole('dialog',{name:'Close Job',exact:true});await expect(dialog).toBeVisible();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(close).toBeFocused();
 await close.click();await dialog.getByRole('button',{name:'CANCEL',exact:true}).click();await expect(dialog).toHaveCount(0);await navigate(page,frame,'Unscheduled');await navigate(page,frame,'Jobs');await close.click();await frame.locator('body').evaluate(()=>history.back());await expect(dialog).toHaveCount(0);await expect(frame.getByRole('heading',{name:'Unscheduled',exact:true})).toBeVisible();expect(state.writes).toHaveLength(0);
});
test('Owner Tasks verifies related job, site and notes, and supports cancel plus edit/reload',async({page})=>{
 const {state,frame}=await mount(page,'owner-tasks');const task=frame.getByRole('region',{name:'Owner Tasks',exact:true});
 await task.getByRole('button',{name:'+ New Owner Task',exact:true}).click();await task.getByLabel('Task Title *').fill('Discard me');await task.getByRole('button',{name:'Cancel',exact:true}).click();expect(state.writes).toHaveLength(0);
 await task.getByRole('button',{name:'+ New Owner Task',exact:true}).click();await task.getByLabel('Task Title *').fill('Fixture follow-up');await task.getByLabel('Related Job').selectOption(jobId);await task.getByLabel('Related Site').selectOption(siteId);await task.getByLabel('Owner Notes').fill('Keep the serial label');
 state.taskMismatch=true;await task.getByRole('button',{name:'Save task',exact:true}).click();await expect(task.getByRole('alert')).toContainText('Save accepted, but the task could not be verified');await expect(task.getByRole('button',{name:'+ New Owner Task',exact:true})).toBeDisabled();expect(state.writes).toHaveLength(1);
 state.taskMismatch=false;await task.getByRole('button',{name:'Refresh tasks',exact:true}).click();await task.getByRole('button').filter({hasText:'Fixture follow-up'}).click();let release;state.readGate=new Promise(resolve=>release=resolve);await task.getByRole('button',{name:'Refresh tasks',exact:true}).click();await expect(task.getByRole('button',{name:'Save task',exact:true})).toBeDisabled();expect(state.writes).toHaveLength(1);state.readGate=null;release();await expect(task.getByRole('button',{name:'Save task',exact:true})).toBeEnabled();await task.getByLabel('Owner Notes').fill('Updated serial label');await task.getByRole('button',{name:'Save task',exact:true}).click();await expect(task.getByRole('status')).toHaveText('Owner Task saved and verified.');expect(state.writes).toHaveLength(2);
 await page.reload();await task.getByRole('button').filter({hasText:'Fixture follow-up'}).click();await expect(task.getByLabel('Owner Notes')).toHaveValue('Updated serial label');await expect(task.getByLabel('Related Job')).toHaveValue(jobId);await expect(task.getByLabel('Related Site')).toHaveValue(siteId);
 await task.getByLabel('Technician').selectOption(checkId);await task.getByRole('button',{name:'Save task',exact:true}).click();await expect(task.getByRole('status')).toHaveText('Owner Task saved and verified.');
 await task.getByRole('button').filter({hasText:'Fixture follow-up'}).click();await task.getByLabel('Technician').selectOption('');state.taskAssignedMismatch=true;await task.getByRole('button',{name:'Save task',exact:true}).click();await expect(task.getByRole('alert')).toContainText('Save accepted, but the task could not be verified');await expect(task.getByRole('button',{name:'+ New Owner Task',exact:true})).toBeDisabled();expect(state.writes).toHaveLength(4);
});

test('Owner refresh and Daily Board action events cannot overlap or submit from a stale snapshot',async({page})=>{
 const {state,frame,controls}=await mount(page);await selectJob(controls);
 let release;state.readGate=new Promise(resolve=>release=resolve);
 await controls.getByRole('button',{name:'REFRESH',exact:true}).click();
 await frame.locator('body').evaluate(({jobId})=>dispatchEvent(new CustomEvent('cos-owner-job-action',{detail:{jobId,jobNumber:'TEST-101',action:'close'}})),{jobId});
 await expect(frame.getByRole('dialog')).toHaveCount(0);expect(state.writes).toHaveLength(0);
 state.readGate=null;release();await expect(controls.getByRole('button',{name:'CLOSE JOB',exact:true})).toBeEnabled();
});

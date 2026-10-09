import { openWorkspace } from './navigation-helper.mjs';
import { test, expect } from '@playwright/test';
// Isolated synthetic mutation coverage. No external request reaches production.
const origin='http://127.0.0.1:4173', edge='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const jobId='11111111-1111-4111-8111-111111111111',visitId='22222222-2222-4222-8222-222222222222',siteId='33333333-3333-4333-8333-333333333333',checkId='44444444-4444-4444-8444-444444444444',createdId='55555555-5555-4555-8555-555555555555',nextVisit='66666666-6666-4666-8666-666666666666';
const now='2026-10-05T15:00:00Z';
const equipmentId='77777777-7777-4777-8777-777777777777',trackerId='88888888-8888-4888-8888-888888888888';
async function mount(page,workspace='daily-board',authorized=true,overrides={}){
 const state={customers:[{id:checkId,name:'Fixture Customer',legalName:'Fixture Customer LLC',customerNumber:'FX-01',status:'active'},{id:nextVisit,name:'Imported Customer Without Site',customerNumber:'FX-02',status:'active'}],jobs:[{id:jobId,jobNumber:'TEST-101',jobType:'DELIVERY',visitId,status:'Unscheduled',department:'it',stage:'IT Prep',technician:'Jordan IT',customer:'Fixture Customer',site:'Fixture Site',equipmentUnitTag:'TEST-SN-1'}],tasks:[],writes:[],requests:[],unchanged:false,failRead:false,taskMismatch:false,
 control:{sites:[{id:siteId,name:'Fixture Site',customerId:checkId,customer_id:checkId,customer:'Fixture Customer',status:'active',addressLine1:'100 Fixture Street',city:'Katy',stateRegion:'TX',customers:{name:'Fixture Customer'}}],truckChecks:[{id:checkId,technician:'Casey Service',department:'service',status:'pending',ownerApproved:false,result:{}}],itTechnicians:['Jordan IT','Morgan IT'],serviceTechnicians:['Casey Service']}};
 state.equipment=[{id:equipmentId,unitNumber:'FIX-UNIT-77',modelName:'Fixture model',status:'installed',currentLocationType:'site',installedSiteId:siteId}];state.fieldUnits=[...state.equipment];Object.assign(state,overrides);
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
   if(state.contextGate&&['/api/equipment','/api/field-map'].includes(path))await state.contextGate;
   if(path==='/api/equipment')return answer({items:state.equipment,models:[]});
   if(path==='/api/field-map')return answer({items:state.fieldUnits,summary:{fieldUnits:state.fieldUnits.length,mappedUnits:0,unitGps:0,missingGps:state.fieldUnits.length},generatedAt:now});
   if(state.directoryFailure===path||(state.siteReadFailAfterWrite&&state.siteWritten&&path==='/api/sites'))return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:'Synthetic directory unavailable'})});
   if(state.readGate&&['/api/jobs','/api/owner/control-data','/api/owner-tasks'].includes(path))await state.readGate;
   if(state.failRead&&['/api/jobs','/api/owner/control-data'].includes(path))return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:'Synthetic refresh unavailable'})});
   if(path==='/api/routers')return answer({ items: [], source: 'camera_health', gpsAvailable: false, generatedAt: new Date().toISOString() });
   if(path==='/api/camera-health/summary-v3')return answer({totalDevices:0,online:0,offline:0,review:0,shopRoot:0,healthRows:0,fieldDevices:0,refreshedAt:new Date().toISOString(),rows:[]});
   if(path==='/api/session')return answer({authorized,name:'Fixture Owner',role:'Owner'});
   if(path==='/api/jobs')return answer({items:state.jobs});
   if(path==='/api/owner/control-data')return answer(state.control);
   if(path==='/api/daily-board')return answer({jobs:state.jobs,tasks:state.tasks,readiness:[],asOf:now});
   if(path==='/api/owner-tasks')return answer({items:state.tasks.map(task=>({...task,...(state.taskMismatch?{relatedJobId:null,relatedSiteId:null,ownerNotes:'old note'}:{}),...(state.taskAssignedMismatch?{assignedUserId:checkId}:{})}))});
   const contactRead=/^\/api\/customers\/([^/]+)\/contacts$/.exec(path);
   if(contactRead){if(state.contactFailure)return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:'Synthetic contacts unavailable'})});if(state.contactGate)await state.contactGate;return answer({customerId:contactRead[1],items:state.contacts?.[contactRead[1]]||[]});}
   if(path==='/api/customers')return answer({items:state.customers});
   if(path==='/api/sites')return answer({items:state.control.sites});
   if(path==='/api/team-production')return answer({items:[{userId:checkId,displayName:'Casey Service',department:'service',active:true}]});
   if(['/api/quotes','/api/ar','/api/purchasing','/api/vrm-portal','/api/vrm-fleet','/api/equipment','/api/field-map'].includes(path))return answer({items:[]});
   throw Error('Unexpected synthetic GET '+path);
  }
  expect(method).toBe('POST');state.writes.push(envelope);
  if(path==='/api/owner/jobs/manual'){
   if(state.writeGate)await state.writeGate;
   if(!state.unchanged)state.jobs.push({...state.jobs[0],id:createdId,jobNumber:'TEST-102',jobType:body.jobType,technician:'Unassigned'});
   return answer({job_id:createdId,job_number:'TEST-102',job_type:body.jobType,visit_count:2,created_by_owner:true});
  }
  if(path==='/api/sites'){state.siteWritten=true;const id='99999999-9999-4999-8999-999999999999';state.control.sites.push({id,...body});return answer({id});}
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
 if(authorized)await expect(frame.getByText('OPERATIONS CONNECTED',{exact:true})).toBeVisible();
 else await expect(frame.getByRole('heading',{name:'Operations access needs attention'})).toBeVisible();
 if(workspace==='daily-board')await expect(controls.getByRole('button',{name:'ADD COS JOB',exact:true})).toBeEnabled();
 const size=await frame.locator('body').evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth}));expect(size.content).toBeLessThanOrEqual(size.width+1);
 return {state,frame,controls};
}
async function chooseSite(controls){await controls.getByRole('combobox',{name:'Search customers'}).fill('Fixture Customer');await controls.getByRole('listbox',{name:'Matching customers'}).getByRole('option',{name:/Fixture Customer/}).click();await controls.getByLabel('Customer / Site',{exact:true}).selectOption(siteId);}
async function selectJob(controls){await controls.getByLabel('Selected COS Job').selectOption(jobId);}
async function prompt(frame,value){const dialog=frame.getByRole('dialog');await expect(dialog).toBeVisible();if(value!==undefined)await dialog.locator('input,textarea').fill(value);await dialog.getByRole('button',{name:'SAVE & CONTINUE',exact:true}).click();}
async function confirm(frame){await frame.getByRole('dialog').getByRole('button',{name:'CONFIRM & CONTINUE',exact:true}).click();}
async function navigate(page,frame,name){
 await openWorkspace(frame,name);
}

test('Owner creates one synthetic job, verifies its fresh identity and preserves it after reload',async({page})=>{
 const {state,frame,controls}=await mount(page);
 await controls.getByRole('button',{name:'ADD COS JOB',exact:true}).click();await expect(controls.getByRole('alert')).toContainText('Choose a site');expect(state.writes).toHaveLength(0);
 await chooseSite(controls);await controls.getByLabel('Title',{exact:true}).fill('Synthetic delivery');
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

for(const [label,jobType] of [['service','SERVICE'],['pickup','PICKUP'],['install / delivery','DELIVERY'],['swap','SWAP']]){
 test('Dashboard '+label+' shortcut opens the existing type without creating, including keyboard and history',async({page},testInfo)=>{
  const {frame,controls,state}=await mount(page,'today');
  const actions=frame.getByRole('region',{name:'Create ticket',exact:true});
  await expect(actions).toBeInViewport();
  const shortcut=actions.getByRole('button',{name:'Create '+label+' ticket',exact:true});
  if(jobType==='SERVICE')await page.screenshot({path:testInfo.outputPath('dashboard-ticket-actions.png'),fullPage:true});
  await shortcut.focus();await page.keyboard.press('Enter');
  await expect(controls.getByRole('heading',{name:'Create ticket',exact:true})).toBeFocused();
  await expect(controls.getByLabel('Job type')).toHaveValue(jobType);
  await expect(controls.getByRole('button',{name:'CREATE TICKET',exact:true})).toBeEnabled();
  await expect(controls.getByLabel('Selected COS Job')).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
  if(jobType==='DELIVERY'){
   await expect(controls.getByRole('note')).toContainText('existing DELIVERY job type');
   await page.screenshot({path:testInfo.outputPath('install-ticket-form.png'),fullPage:true});
  }
  await frame.locator('body').evaluate(()=>history.back());
  await expect(actions).toBeVisible();
  await frame.locator('body').evaluate(()=>history.forward());
  await expect(controls.getByLabel('Job type')).toHaveValue(jobType);
  await frame.locator('body').evaluate(()=>location.reload());await expect(controls.getByLabel('Job type')).toHaveValue(jobType);
  await controls.getByRole('button',{name:'Back to dashboard',exact:true}).click();
  await expect(actions).toBeVisible();expect(state.writes).toHaveLength(0);
  const bounds=await frame.locator('body').evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));
  expect(bounds.width).toBeLessThanOrEqual(bounds.viewport+1);
 });
 test('Dashboard '+label+' creates exactly one synthetic job with the existing API and offers scheduling',async({page})=>{
  const {frame,controls,state}=await mount(page,'daily-board?create='+jobType);
  await expect(controls.getByRole('button',{name:'CREATE TICKET',exact:true})).toBeEnabled();
  await controls.getByRole('button',{name:'CREATE TICKET',exact:true}).click();
  await expect(controls.getByRole('alert')).toContainText('Choose a site');expect(state.writes).toHaveLength(0);
  await chooseSite(controls);
  await controls.getByLabel('Title',{exact:true}).fill('Synthetic '+label+' ticket');
  await controls.getByLabel('Description / instructions').fill('Isolated fixture only');
  await controls.getByLabel('Priority').selectOption('high');
  if(jobType==='SERVICE')await controls.getByLabel('SERVICE REQUIRES IT SHOP PREP').check();
  let release;state.writeGate=new Promise(resolve=>release=resolve);
  await controls.getByRole('button',{name:'CREATE TICKET',exact:true}).evaluate(button=>{button.click();button.click();});
  await expect(controls.getByRole('button',{name:'CREATING…',exact:true})).toBeDisabled();
  await expect(controls.getByRole('button',{name:'Back to dashboard'})).toBeDisabled();
  await expect.poll(()=>state.writes.length).toBe(1);release();
  await expect(controls.getByRole('region',{name:'Ticket created'})).toContainText('TEST-102');
  expect(state.writes[0]).toMatchObject({path:'/api/owner/jobs/manual',method:'POST',body:{siteId,jobType,title:'Synthetic '+label+' ticket',description:'Isolated fixture only',priority:'high',shopPrep:jobType==='SERVICE'}});
  await expect(controls.getByRole('button',{name:'CREATE TICKET',exact:true})).toHaveCount(0);
  await controls.getByRole('button',{name:'Schedule this ticket'}).click();
  await expect(frame.getByRole('button',{name:'Schedule + Assign',exact:true})).toHaveCount(1);
  expect(state.writes).toHaveLength(1);
 });
}

test('ticket creation keeps the uncertain-readback lock and requires an explicit successful refresh',async({page})=>{
 const {frame,controls,state}=await mount(page,'daily-board?create=SWAP');
 await expect(controls.getByRole('button',{name:'CREATE TICKET',exact:true})).toBeEnabled();
 await chooseSite(controls);await controls.getByLabel('Title',{exact:true}).fill('Synthetic uncertain swap');
 state.unchanged=true;await controls.getByRole('button',{name:'CREATE TICKET',exact:true}).click();
 await expect(controls.getByRole('alert')).toContainText('saved result could not be verified');
 await expect(controls.getByRole('button',{name:'CREATE TICKET',exact:true})).toBeDisabled();
 await expect(controls.getByRole('region',{name:'Ticket created'})).toHaveCount(0);expect(state.writes).toHaveLength(1);
 state.failRead=true;await controls.getByRole('button',{name:'REFRESH',exact:true}).click();
 await expect(controls.getByRole('alert')).toContainText('Synthetic refresh unavailable');
 await expect(controls.getByRole('button',{name:'CREATE TICKET',exact:true})).toBeDisabled();
 state.failRead=false;await controls.getByRole('button',{name:'REFRESH',exact:true}).click();
 await expect(controls.getByRole('button',{name:'CREATE TICKET',exact:true})).toBeEnabled();expect(state.writes).toHaveLength(1);
});

test('ticket shortcuts and direct creation routes stay behind the existing owner authorization',async({page})=>{
 const {frame,state}=await mount(page,'daily-board?create=SERVICE',false);
 await expect(frame.getByRole('heading',{name:'Operations access needs attention'})).toBeVisible();
 await expect(frame.getByRole('button',{name:'CREATE TICKET',exact:true})).toHaveCount(0);
 await frame.locator('body').evaluate(()=>location.hash='#today');
 await expect(frame.getByRole('region',{name:'Create ticket',exact:true})).toHaveCount(0);
 expect(state.writes).toHaveLength(0);expect(state.requests.filter(request=>request.path==='/api/owner/control-data')).toHaveLength(0);
});

test('changing away from Service clears hidden shop prep and navigation discards unsaved ticket text',async({page})=>{
 const {frame,controls,state}=await mount(page,'daily-board?create=SERVICE');
 await expect(controls.getByRole('button',{name:'CREATE TICKET',exact:true})).toBeEnabled();
 await controls.getByLabel('SERVICE REQUIRES IT SHOP PREP').check();
 await controls.getByLabel('Job type').selectOption('PICKUP');
 await expect(controls.getByLabel('SERVICE REQUIRES IT SHOP PREP')).toHaveCount(0);
 await controls.getByLabel('Job type').selectOption('SERVICE');
 await expect(controls.getByLabel('SERVICE REQUIRES IT SHOP PREP')).not.toBeChecked();
 await controls.getByLabel('Title',{exact:true}).fill('Unsaved fixture draft');
 await navigate(page,frame,'Jobs');await expect(controls).toHaveCount(0);
 await navigate(page,frame,'Today');await frame.getByRole('button',{name:'Create swap ticket',exact:true}).click();
 await expect(controls.getByLabel('Job type')).toHaveValue('SWAP');await expect(controls.getByLabel('Title',{exact:true})).toHaveValue('');expect(state.writes).toHaveLength(0);
});

test('all 1506 customers are searchable and a customer without sites is explicit',async({page},testInfo)=>{
 const {frame,controls,state}=await mount(page,'today');
 state.customers=Array.from({length:1506},(_,index)=>({id:'a0000000-0000-4000-8000-'+String(index).padStart(12,'0'),name:index===1505?'Zebra Imported Customer 1506 with a very long construction company and regional division name':'Customer '+String(index).padStart(4,'0'),customerNumber:'IM-'+index,status:'active'}));
 state.customers.push(...Array.from({length:8},(_,index)=>({id:'b0000000-0000-4000-8000-'+String(index).padStart(12,'0'),name:'Archived imported customer '+index,customerNumber:'OLD-'+index,status:'archived'})));
 state.control.sites[0].customerId=state.customers[0].id;
 await frame.getByRole('button',{name:'Create pickup ticket',exact:true}).click();
 await expect(controls.getByText('1,506 active customers · 1 active sites. Customers without sites are included.',{exact:true})).toBeVisible();
 const search=controls.getByRole('combobox',{name:'Search customers'});await search.fill('Archived imported');await expect(controls.getByRole('status').filter({hasText:'No customers match this search.'})).toBeVisible();await expect(controls.getByRole('listbox',{name:'Matching customers'}).getByRole('option')).toHaveCount(0);await search.fill('Zebra Imported');
 await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 await expect(controls.getByText('This customer has no active site yet. Add the real service location before creating a ticket.',{exact:true})).toBeVisible();
 await expect(controls.getByLabel('Customer / Site',{exact:true})).toHaveCount(0);
 await controls.getByLabel('Title',{exact:true}).fill('Fixture should not create without a site');
 await controls.getByRole('button',{name:'CREATE TICKET',exact:true}).click();await expect(controls.getByRole('alert')).toContainText('Choose a site');expect(state.writes).toHaveLength(0);
 const size=await frame.locator('body').evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));expect(size.width).toBeLessThanOrEqual(size.viewport+1);
 await page.screenshot({path:testInfo.outputPath('full-customer-directory-no-site.png'),fullPage:true});
});

test('adding a real site uses the existing explicit save and returns to the unchanged ticket draft',async({page},testInfo)=>{
 const {frame,controls,state}=await mount(page,'daily-board?create=SWAP');
 await expect(controls.getByRole('button',{name:'CREATE TICKET',exact:true})).toBeEnabled();
 const search=controls.getByRole('combobox',{name:'Search customers'});await search.fill('Imported Customer');
 await controls.getByRole('option',{name:/Imported Customer Without Site/}).click();
 await controls.getByLabel('Title',{exact:true}).fill('Preserved swap draft');
 await controls.getByLabel('Description / instructions').fill('Keep these site and work instructions');
 await controls.getByLabel('Priority').selectOption('urgent');
 await controls.getByRole('button',{name:'+ Add site for this customer',exact:true}).click();
 const editor=controls.getByRole('region',{name:'New Site',exact:true});
 await expect(editor.getByLabel('Customer *',{exact:true})).toHaveValue(nextVisit);await expect(editor.getByLabel('Customer *',{exact:true})).toBeDisabled();await expect(editor.getByLabel('Status',{exact:true})).toBeDisabled();await expect(editor.getByLabel('Status',{exact:true})).toHaveValue('active');
 await editor.getByLabel('Site Name *').fill('Fixture New Service Location');
 await editor.getByLabel('Address',{exact:true}).fill('99 Synthetic Way');await editor.getByLabel('City',{exact:true}).fill('Katy');
 expect(state.writes).toHaveLength(0);await page.screenshot({path:testInfo.outputPath('inline-create-site.png'),fullPage:true});
 await editor.getByRole('button',{name:'SAVE',exact:true}).click();
 await expect(editor).toHaveCount(0);await expect(search).toBeFocused();
 await expect(controls.getByLabel('Customer / Site',{exact:true})).toHaveValue('99999999-9999-4999-8999-999999999999');
 await expect(controls.getByLabel('Job type')).toHaveValue('SWAP');await expect(controls.getByLabel('Title',{exact:true})).toHaveValue('Preserved swap draft');
 await expect(controls.getByLabel('Description / instructions')).toHaveValue('Keep these site and work instructions');await expect(controls.getByLabel('Priority')).toHaveValue('urgent');
 expect(state.writes).toHaveLength(1);expect(state.writes[0]).toMatchObject({path:'/api/sites',body:{customerId:nextVisit,name:'Fixture New Service Location',addressLine1:'99 Synthetic Way'}});
});

test('changing customer clears an unrelated site and cancelling site entry never writes',async({page})=>{
 const {controls,state}=await mount(page,'daily-board?create=SERVICE');
 await chooseSite(controls);await controls.getByLabel('Title',{exact:true}).fill('Keep this ticket');
 await controls.getByRole('combobox',{name:'Search customers'}).fill('Imported Customer');await controls.getByRole('option',{name:/Imported Customer Without Site/}).click();
 await controls.getByRole('button',{name:'CREATE TICKET',exact:true}).click();await expect(controls.getByRole('alert')).toContainText('Choose a site');expect(state.writes).toHaveLength(0);
 await controls.getByRole('button',{name:'+ Add site for this customer',exact:true}).click();
 const editor=controls.getByRole('region',{name:'New Site',exact:true});await editor.getByLabel('Site Name *').fill('Unsaved location');
 await editor.getByRole('button',{name:'Cancel',exact:true}).click();await expect(editor).toHaveCount(0);await expect(controls.getByLabel('Title',{exact:true})).toHaveValue('Keep this ticket');
 await expect(controls.getByRole('combobox',{name:'Search customers'})).toBeFocused();await expect(controls.getByRole('combobox',{name:'Search customers'})).toHaveValue('Imported Customer Without Site');expect(state.writes).toHaveLength(0);
});

test('directory load failures stay explicit and cannot submit a guessed site',async({page})=>{
 const {frame,controls,state}=await mount(page,'today');state.directoryFailure='/api/customers';
 await frame.getByRole('button',{name:'Create service ticket',exact:true}).click();
 await expect(controls.getByRole('alert')).toContainText('Synthetic directory unavailable');
 await expect(controls.getByRole('combobox',{name:'Search customers'})).toBeDisabled();
 await expect(controls.getByText(/active customers ·/)).toHaveCount(0);
 await controls.getByRole('button',{name:'CREATE TICKET',exact:true}).click();expect(state.writes).toHaveLength(0);
 state.directoryFailure=null;await controls.getByRole('button',{name:'Retry customers and sites',exact:true}).click();
 await chooseSite(controls);await expect(controls.getByLabel('Customer / Site',{exact:true})).toHaveValue(siteId);expect(state.writes).toHaveLength(0);
});

test('uncertain new-site save stays locked then refresh returns existing sites without duplicating or losing the ticket',async({page})=>{
 const {controls,state}=await mount(page,'daily-board?create=SWAP');
 await controls.getByRole('combobox',{name:'Search customers'}).fill('Imported Customer');await controls.getByRole('option',{name:/Imported Customer Without Site/}).click();
 await controls.getByLabel('Title',{exact:true}).fill('Preserved uncertain draft');
 await controls.getByRole('button',{name:'+ Add site for this customer',exact:true}).click();
 const editor=controls.getByRole('region',{name:'New Site',exact:true});await editor.getByLabel('Site Name *').fill('Saved fixture with delayed readback');
 state.siteReadFailAfterWrite=true;await editor.getByRole('button',{name:'SAVE',exact:true}).click();
 await expect(editor.getByRole('alert')).toContainText('fresh records could not be loaded');await expect(editor.getByRole('button',{name:'SAVE',exact:true})).toBeDisabled();expect(state.writes).toHaveLength(1);
 state.siteReadFailAfterWrite=false;await controls.getByRole('button',{name:'REFRESH RECORDS',exact:true}).click();
 await expect(editor).toHaveCount(0);await expect(controls.getByLabel('Customer / Site',{exact:true})).toHaveValue('');
 await controls.getByLabel('Customer / Site',{exact:true}).selectOption('99999999-9999-4999-8999-999999999999');
 await expect(controls.getByLabel('Title',{exact:true})).toHaveValue('Preserved uncertain draft');await expect(controls.getByLabel('Job type')).toHaveValue('SWAP');expect(state.writes).toHaveLength(1);
});

test('an inline site load failure always allows returning to the existing ticket draft',async({page})=>{
 const {controls,state}=await mount(page,'daily-board?create=PICKUP');
 await chooseSite(controls);await controls.getByLabel('Title',{exact:true}).fill('Preserved load-error draft');
 state.directoryFailure='/api/sites';await controls.getByRole('button',{name:'+ Add site for this customer',exact:true}).click();
 const editor=controls.getByRole('region',{name:'Sites Workspace',exact:true});await expect(editor.getByRole('alert')).toContainText('Synthetic directory unavailable');
 await editor.getByRole('button',{name:'Back to ticket',exact:true}).click();await expect(editor).toHaveCount(0);
 await expect(controls.getByRole('combobox',{name:'Search customers'})).toBeFocused();await expect(controls.getByLabel('Title',{exact:true})).toHaveValue('Preserved load-error draft');expect(state.writes).toHaveLength(0);
});

test.describe('touch customer selection',()=>{
 test.use({hasTouch:true});
 test('touch selection chooses the actual customer and site without submitting',async({page})=>{
  const {controls,state}=await mount(page,'daily-board?create=PICKUP');
  const search=controls.getByRole('combobox',{name:'Search customers'});await search.tap();await search.fill('Fixture Customer');
  await controls.getByRole('listbox',{name:'Matching customers'}).getByRole('option',{name:/Fixture Customer/}).tap();
  await controls.getByLabel('Customer / Site',{exact:true}).selectOption(siteId);await expect(controls.getByLabel('Customer / Site',{exact:true})).toHaveValue(siteId);expect(state.writes).toHaveLength(0);
 });
});

test('leaving an uncertain inline site save refreshes first and exposes the saved site before reopening',async({page})=>{
 const {controls,state}=await mount(page,'daily-board?create=PICKUP');
 await controls.getByRole('combobox',{name:'Search customers'}).fill('Imported Customer');await controls.getByRole('option',{name:/Imported Customer Without Site/}).click();
 await controls.getByRole('button',{name:'+ Add site for this customer',exact:true}).click();
 const editor=controls.getByRole('region',{name:'New Site',exact:true});await editor.getByLabel('Site Name *').fill('Saved fixture before return');
 state.siteReadFailAfterWrite=true;await editor.getByRole('button',{name:'SAVE',exact:true}).click();
 await expect(editor.getByRole('button',{name:'SAVE',exact:true})).toBeDisabled();
 await editor.getByRole('button',{name:'Refresh & return to ticket',exact:true}).click();
 await expect(controls.getByRole('region',{name:'Sites Workspace',exact:true}).getByRole('alert').filter({hasText:'Synthetic directory unavailable'})).toBeVisible();
 await expect(editor).toBeVisible();expect(state.writes).toHaveLength(1);
 state.siteReadFailAfterWrite=false;await editor.getByRole('button',{name:'Refresh & return to ticket',exact:true}).click();
 await expect(editor).toHaveCount(0);await expect(controls.getByLabel('Customer / Site',{exact:true}).locator('option[value="99999999-9999-4999-8999-999999999999"]')).toHaveCount(1);
 await controls.getByRole('button',{name:'+ Add site for this customer',exact:true}).click();
 await expect(editor.getByRole('button',{name:'SAVE',exact:true})).toBeEnabled();expect(state.writes).toHaveLength(1);
});

test('unit ticket context prefills exact customer/site and persists an editable reference without assigning equipment',async({page})=>{
 const {controls,state,frame}=await mount(page,'daily-board?create=SERVICE&unit='+equipmentId);
 await expect(controls.getByRole('region',{name:'Selected unit context'})).toContainText('FIX-UNIT-77');
 await expect(controls.getByLabel('Customer / Site',{exact:true})).toHaveValue(siteId);
 await expect(controls.getByRole('combobox',{name:'Search customers'})).toHaveValue('Fixture Customer');
 await expect(controls.getByLabel('Title',{exact:true})).toHaveValue('Service · FIX-UNIT-77');
 await expect(controls.getByLabel('Description / instructions')).toContainText('This reference does not assign equipment');
 expect(state.writes).toHaveLength(0);
 await controls.getByLabel('Job type').selectOption('PICKUP');await expect(controls.getByLabel('Title',{exact:true})).toHaveValue('Pickup · FIX-UNIT-77');
 await controls.getByLabel('Title',{exact:true}).fill('Owner edited pickup title');await controls.getByLabel('Description / instructions').fill('Owner instructions for FIX-UNIT-77');
 await controls.getByLabel('Job type').selectOption('SWAP');await expect(controls.getByLabel('Title',{exact:true})).toHaveValue('Owner edited pickup title');
 await controls.getByRole('button',{name:'CREATE TICKET',exact:true}).click();await expect(controls.getByRole('region',{name:'Ticket created'})).toBeVisible();
 expect(state.writes).toHaveLength(1);expect(state.writes[0].body).toEqual({siteId,jobType:'SWAP',title:'Owner edited pickup title',description:'Owner instructions for FIX-UNIT-77',priority:'normal',shopPrep:false});
 await controls.getByRole('button',{name:'Back to unit health',exact:true}).click();await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#camera-health?unit='+equipmentId);
});

test('late unit context cannot overwrite title, instructions or a manually chosen customer',async({page})=>{
 let release;const gate=new Promise(resolve=>release=resolve);
 const {controls,state}=await mount(page,'daily-board?create=PICKUP&unit='+equipmentId,true,{contextGate:gate});
 await expect(controls.getByRole('status').filter({hasText:'Verifying the selected unit'})).toBeVisible();
 await controls.getByLabel('Title',{exact:true}).fill('Typed while loading');await controls.getByLabel('Description / instructions').fill('These instructions belong to the owner');
 await controls.getByRole('combobox',{name:'Search customers'}).fill('Imported Customer');await controls.getByRole('option',{name:/Imported Customer Without Site/}).click();
 release();await expect(controls.getByRole('region',{name:'Selected unit context'})).toContainText('FIX-UNIT-77');
 await expect(controls.getByLabel('Title',{exact:true})).toHaveValue('Typed while loading');await expect(controls.getByLabel('Description / instructions')).toHaveValue('These instructions belong to the owner');
 await expect(controls.getByRole('combobox',{name:'Search customers'})).toHaveValue('Imported Customer Without Site');await expect(controls.getByLabel('Customer / Site',{exact:true})).toHaveCount(0);expect(state.writes).toHaveLength(0);
});

test('tracker-only unit context does not infer a customer/site from an identical equipment name',async({page})=>{
 const {controls,state}=await mount(page,'daily-board?create=SERVICE&unit='+trackerId,true,{fieldUnits:[{id:trackerId,unitNumber:'FIX-UNIT-77',modelName:'Fixture model',status:'field',readOnly:true,recordSource:'Fixture tracker'}]});
 await expect(controls.getByRole('region',{name:'Selected unit context'})).toContainText('read-only tracker reference');
 await expect(controls.getByRole('combobox',{name:'Search customers'})).toHaveValue('');await expect(controls.getByLabel('Customer / Site',{exact:true})).toHaveCount(0);
 await expect(controls.getByLabel('Description / instructions')).toContainText('Read-only tracker record: '+trackerId);
 await chooseSite(controls);await expect(controls.getByLabel('Customer / Site',{exact:true})).toHaveValue(siteId);expect(state.writes).toHaveLength(0);
});

test('deleted unit context blocks creation, retry does not duplicate a reference, and Back sends no write',async({page})=>{
 const {controls,state,frame}=await mount(page,'daily-board?create=SWAP&unit='+equipmentId,true,{equipment:[],fieldUnits:[]});
 await expect(controls.getByRole('alert')).toContainText('selected unit is no longer available');await expect(controls.getByRole('button',{name:'CREATE TICKET',exact:true})).toBeDisabled();
 state.equipment=[{id:equipmentId,unitNumber:'FIX-UNIT-77',status:'installed',currentLocationType:'site',installedSiteId:siteId}];state.fieldUnits=[...state.equipment];
 await controls.getByRole('button',{name:'Retry unit context',exact:true}).click();await expect(controls.getByLabel('Customer / Site',{exact:true})).toHaveValue(siteId);
 const instructions=await controls.getByLabel('Description / instructions').inputValue();expect(instructions.match(/Unit reference:/g)).toHaveLength(1);
 await controls.getByRole('button',{name:'Back to unit health',exact:true}).click();await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#camera-health?unit='+equipmentId);expect(state.writes).toHaveLength(0);
});

const fixtureContactId='77777777-7777-4777-8777-777777777777';
const fixtureContact={id:fixtureContactId,customerId:checkId,name:'Fixture Contact',title:'Project coordinator',email:'contact@example.invalid',phone:'202-555-0101',isPrimary:true,billingContact:false};

test('saved customer contact details are visible and an optional editable snapshot is included once in ticket instructions',async({page},testInfo)=>{
 const {controls,state,frame}=await mount(page,'daily-board?create=SERVICE');state.contacts={[checkId]:[fixtureContact]};
 await chooseSite(controls);
 const panel=controls.getByRole('region',{name:'Customer contacts',exact:true});
 await panel.getByLabel('Customer contact for this ticket (optional)',{exact:true}).selectOption(fixtureContactId);
 await expect(panel.locator('.customer-contact-details')).toContainText('contact@example.invalid');await expect(panel.locator('.customer-contact-details')).toContainText('202-555-0101');
 await expect(panel).toContainText('not assumed to be the on-site contact');
 await controls.getByLabel('Title',{exact:true}).fill('Synthetic contact ticket');await controls.getByLabel('Description / instructions').fill('Owner work instructions');
 await panel.getByLabel('Contact instructions',{exact:true}).fill('Customer contact for this ticket: Fixture Contact\nPhone: 202-555-0101\nOwner edited this contact note.');
 await panel.evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:testInfo.outputPath('ticket-customer-contact.png'),fullPage:true});
 expect(state.writes).toHaveLength(0);await controls.getByRole('button',{name:'CREATE TICKET',exact:true}).click();
 await expect(controls.getByRole('region',{name:'Ticket created'})).toBeVisible();expect(state.writes).toHaveLength(1);
 expect(state.writes[0].body.description).toBe('Owner work instructions\n\nCustomer contact for this ticket: Fixture Contact\nPhone: 202-555-0101\nOwner edited this contact note.');
 expect(state.writes[0].body).not.toHaveProperty('contactId');expect(state.writes[0].body).not.toHaveProperty('customerContactId');
});

test('deselecting or changing customer clears stale contact instructions and preserves general work notes',async({page})=>{
 const {controls,state}=await mount(page,'daily-board?create=SWAP');state.contacts={[checkId]:[fixtureContact]};await chooseSite(controls);
 const panel=controls.getByRole('region',{name:'Customer contacts',exact:true});
 await controls.getByLabel('Title',{exact:true}).fill('Synthetic clean contact reset');await controls.getByLabel('Description / instructions').fill('Keep my work notes');
 await panel.getByLabel('Customer contact for this ticket (optional)',{exact:true}).selectOption(fixtureContactId);
 await panel.getByLabel('Contact instructions',{exact:true}).fill('Edited old contact note');
 await panel.getByLabel('Customer contact for this ticket (optional)',{exact:true}).selectOption('');await expect(panel.getByLabel('Contact instructions',{exact:true})).toHaveCount(0);
 await panel.getByLabel('Customer contact for this ticket (optional)',{exact:true}).selectOption(fixtureContactId);
 await controls.getByRole('combobox',{name:'Search customers'}).fill('Imported Customer');await controls.getByRole('option',{name:/Imported Customer Without Site/}).click();
 await expect(panel.getByRole('status')).toContainText('No saved customer contacts');await expect(controls.getByLabel('Description / instructions')).toHaveValue('Keep my work notes');
 await chooseSite(controls);await expect(panel.getByLabel('Customer contact for this ticket (optional)',{exact:true})).toHaveValue('');
 await controls.getByRole('button',{name:'CREATE TICKET',exact:true}).click();await expect(controls.getByRole('region',{name:'Ticket created'})).toBeVisible();expect(state.writes[0].body.description).toBe('Keep my work notes');
});

test('customer directory exposes saved contact details read-only and disables inactive customer contact reads',async({page},testInfo)=>{
 const {frame,state}=await mount(page,'today');state.contacts={[checkId]:[fixtureContact]};
 await navigate(page,frame,'Customers');
 const workspace=frame.getByRole('region',{name:'Customers Workspace',exact:true});const row=workspace.locator('.record').filter({hasText:'Fixture Customer'});
 await row.getByRole('button',{name:'View contacts',exact:true}).click();
 const panel=workspace.getByRole('region',{name:'Selected customer contacts',exact:true});await expect(panel).toBeFocused();await expect(panel).toContainText('Fixture Contact');await expect(panel).toContainText('contact@example.invalid');
 await expect(panel.getByLabel('Contact instructions',{exact:true})).toHaveCount(0);expect(state.writes).toHaveLength(0);
 await page.screenshot({path:testInfo.outputPath('customer-directory-contacts.png'),fullPage:true});
 await panel.getByRole('button',{name:'Close contacts',exact:true}).click();await expect(row.getByRole('button',{name:'View contacts',exact:true})).toBeFocused();
 state.customers[0].status='inactive';await workspace.getByRole('button',{name:'REFRESH RECORDS',exact:true}).click();await expect(row.getByRole('button',{name:'View contacts',exact:true})).toBeDisabled();
});

test('contact read failure is explicit and retry never guesses a contact or sends a message',async({page})=>{
 const {controls,state}=await mount(page,'daily-board?create=PICKUP');state.contacts={[checkId]:[fixtureContact]};state.contactFailure=true;await chooseSite(controls);
 const panel=controls.getByRole('region',{name:'Customer contacts',exact:true});await expect(panel.getByRole('alert')).toContainText('Synthetic contacts unavailable');await expect(panel.getByText('No saved customer contacts were returned for this customer.',{exact:true})).toHaveCount(0);
 state.contactFailure=false;await panel.getByRole('button',{name:'Retry contacts',exact:true}).click();await expect(panel.getByLabel('Customer contact for this ticket (optional)',{exact:true})).toHaveValue('');expect(state.writes).toHaveLength(0);
});

test('wrong-customer contact response fails closed instead of exposing another contact',async({page})=>{
 const {controls,state}=await mount(page,'daily-board?create=PICKUP');state.contacts={[checkId]:[{...fixtureContact,customerId:nextVisit}]};await chooseSite(controls);
 const panel=controls.getByRole('region',{name:'Customer contacts',exact:true});await expect(panel.getByRole('alert')).toContainText('identities or details could not be verified');await expect(panel.getByText('contact@example.invalid',{exact:true})).toHaveCount(0);expect(state.writes).toHaveLength(0);
});

test('late contact response cannot restore a prior customer selection',async({page})=>{
 const {controls,state}=await mount(page,'daily-board?create=SERVICE');state.contacts={[checkId]:[fixtureContact]};let release;state.contactGate=new Promise(resolve=>release=resolve);await chooseSite(controls);
 await controls.getByRole('combobox',{name:'Search customers'}).fill('Imported Customer');await controls.getByRole('option',{name:/Imported Customer Without Site/}).click();release();
 const panel=controls.getByRole('region',{name:'Customer contacts',exact:true});await expect(panel.getByRole('status')).toContainText('No saved customer contacts');await expect(panel.getByText('Fixture Contact',{exact:true})).toHaveCount(0);expect(state.writes).toHaveLength(0);
});

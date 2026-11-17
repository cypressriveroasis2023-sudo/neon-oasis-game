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
   if(path==='/api/tv-board/settings')return answer({sections:['today','pickup','swap','delivery','service','shop','camera','map'],revision:0,updatedAt:null});
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
 if(workspace==='daily-board'){
  await expect(frame.getByRole('region',{name:'COS Daily Board'})).toBeVisible();
  await expect(frame.getByText('Owner tools · import, create and manage jobs')).toHaveCount(0);
  await expect(controls).toHaveCount(0);
 }
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

test('owner job controls, truck-check approval, owner tasks and ticket creation are not reachable',async({page})=>{
 const {state,frame}=await mount(page,'daily-board');
 await expect(frame.locator('.daily-board-card')).toHaveCount(0);
 await expect(frame.getByRole('button',{name:'ADD COS JOB',exact:true})).toHaveCount(0);
 await expect(frame.getByRole('region',{name:'Create ticket',exact:true})).toHaveCount(0);
 for (const hash of ['#jobs','#owner-tasks','#customers','#quotes','#dispatch']) {
  await frame.locator('body').evaluate((_,value)=>{location.hash=value;},hash);
  await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#today');
 }
 expect(state.writes).toEqual([]);
 expect(state.requests.some(item=>['/api/jobs','/api/owner/control-data','/api/owner-tasks','/api/customers','/api/sites','/api/owner/jobs/manual'].includes(item.path)||String(item.path).includes('/approve'))).toBe(false);
});

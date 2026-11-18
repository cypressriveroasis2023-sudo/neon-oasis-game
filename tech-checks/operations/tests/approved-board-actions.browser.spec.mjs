import {test,expect} from '@playwright/test';
const origin='http://127.0.0.1:4173';
const jobId='11111111-1111-4111-8111-111111111111';
const visitId='22222222-2222-4222-8222-222222222222';
const taskId='33333333-3333-4333-8333-333333333333';

// Complete rebuilt App and its real parent/session bridge; every operational response is synthetic.
// External traffic is blocked and any operational write fails the test.
async function mount(page,{goBack=false}={}) {
 const state={calls:[],writes:[],errors:[]};page.on('pageerror',e=>state.errors.push(e.message));
 const at=new Date().toISOString();
 const job={id:jobId,jobNumber:'COS-FIXTURE-3001',customer:'Example Builder',site:'Recorded site',siteAddress:'100 Example Road',status:'Unscheduled',department:'service',technician:'Fixture Technician',jobType:'SERVICE',equipment:'Spotter',equipmentUnitTag:'Fixture 260',notes:[{text:'Saved note: inspect the enclosure.',by:'Fixture Technician',at}],...(goBack?{goBack:{required:true}}:{})};
 const completed={...job,id:`${jobId}:visit:${visitId}`,jobId,visitId,completionKind:'visit',customer:'Completed Example Builder',jobNumber:'COS-FIXTURE-3002',status:'Completed',completedAt:at,jobType:'INSTALL'};
 const task={id:taskId,title:'Recorded inspection follow-up',status:'Not started',assignedTo:'Fixture Technician',assignedDepartment:'service',instructions:'Review the saved inspection photos before the next visit.',ownerNotes:'No additional service job is requested.'};
 const board={jobs:[job,completed],tasks:[task],readiness:[{userId:'44444444-4444-4444-8444-444444444444',name:'Fixture Technician',department:'service',status:'not_started',result:{}}],asOf:at};
 await page.route('**/*',route=>{
  const r=route.request(),url=new URL(r.url());
  if(url.origin===origin&&url.pathname==='/approved-board-action-fixture')return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}header{height:24px;font:12px/24px sans-serif;background:#fff;color:#111;text-align:center}iframe{display:block;width:100%;height:calc(100vh - 24px);border:0}</style></head><body><header>SYNTHETIC TEST — NOT LIVE OPERATIONS</header><iframe title="COS test application" src="/#daily-board"></iframe><script>addEventListener('message',e=>{const f=document.querySelector('iframe');if(e.origin!==location.origin||e.source!==f.contentWindow||e.data?.type!=='COS_OPERATIONS_TOKEN_REQUEST')return;e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-test-only'},location.origin)});</script></body></html>`});
  if(url.origin===origin)return route.continue();
  if(!url.pathname.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(r.method()==='OPTIONS')return route.fulfill({status:204,headers});
  const body=r.postDataJSON();state.calls.push(body.path);
  if(body.method!=='GET'){state.writes.push(body.path);return route.fulfill({status:400,headers,json:{error:'Operational writes prohibited in this synthetic review'}});}
  const data=body.path==='/api/session'?{authorized:true,legacyOwner:true,role:'Owner',name:'Synthetic Owner',productionOwnerUserId:jobId,features:{fleetAccess:true,mhelpTicketImport:false}}:
   body.path==='/api/daily-board'?board:body.path==='/api/jobs'?{items:[job]}:
   body.path==='/api/owner/control-data'?{sites:[],truckChecks:[],itTechnicians:[],serviceTechnicians:['Fixture Technician']}:
   body.path==='/api/tv-board/settings'?{sections:['today'],revision:0,updatedAt:null}: {items:[]};
  return route.fulfill({headers,json:data});
 });
 await page.goto('/approved-board-action-fixture');const app=page.frameLocator('iframe');
 await expect(app.getByText('OPERATIONS CONNECTED',{exact:true})).toBeVisible();
 await expect(app.getByRole('region',{name:'COS Daily Board'}).locator('.daily-board-card')).toHaveCount(1);
 return {app,state,at};
}
async function open(app,title='Example Builder') {
 await app.locator('.daily-board-card').filter({has:app.getByText(title,{exact:true})}).click();
 const dialog=app.getByRole('dialog',{name:'Work details',exact:true});await expect(dialog).toBeVisible();return dialog;
}
const management=dialog=>dialog.locator('summary').filter({hasText:'Manage this work'});
const safe=state=>{expect(state.errors).toEqual([]);expect(state.writes).toEqual([]);};

test('Daily Board shows the service handoff and does not open a job record',async({page})=>{
 const {app,state}=await mount(page);
 await expect(app.getByText('Example Builder',{exact:true})).toBeVisible();
 await expect(app.getByText('Recorded inspection follow-up',{exact:true})).toHaveCount(0);
 await expect(app.getByRole('link',{name:'Open job record'})).toHaveCount(0);
 await expect(app.getByText('OWNER TASK')).toHaveCount(0);
 expect(state.calls.includes('/api/jobs')).toBe(false);
 safe(state);
});

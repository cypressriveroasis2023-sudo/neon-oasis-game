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
 const completed={...job,id:`${jobId}:visit:${visitId}`,jobId,visitId,completionKind:'visit',customer:'Completed Example Builder',jobNumber:'COS-FIXTURE-3002',status:'Completed',completedAt:at};
 const task={id:taskId,title:'Recorded inspection follow-up',status:'Not started',assignedTo:'Fixture Technician',assignedDepartment:'service',instructions:'Review the saved inspection photos before the next visit.',ownerNotes:'No additional service job is requested.'};
 const board={jobs:[job,completed],tasks:[task],readiness:[{userId:'44444444-4444-4444-8444-444444444444',name:'Fixture Technician',department:'service',status:'not_started',result:{}}],asOf:at};
 await page.route('**/*',route=>{
  const r=route.request(),url=new URL(r.url());
  if(url.origin===origin&&url.pathname==='/approved-board-action-fixture')return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}header{height:24px;font:12px/24px sans-serif;background:#fff;color:#111;text-align:center}iframe{display:block;width:100%;height:calc(100vh - 24px);border:0}</style></head><body><header>SYNTHETIC TEST — NOT LIVE OPERATIONS</header><iframe title="COS test application" src="/#daily-board"></iframe><script>addEventListener('message',e=>{const f=document.querySelector('iframe');if(e.origin!==location.origin||e.source!==f.contentWindow||e.data?.type!=='COS_OPERATIONS_TOKEN_REQUEST')return;e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-test-only'},location.origin)});</script></body></html>`});
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
 await expect(app.getByRole('region',{name:'COS Daily Board'}).locator('.daily-board-card')).toHaveCount(3);
 return {app,state,at};
}
async function open(app,title='Example Builder') {
 await app.locator('.daily-board-card').filter({has:app.getByText(title,{exact:true})}).click();
 const dialog=app.getByRole('dialog',{name:'Work details',exact:true});await expect(dialog).toBeVisible();return dialog;
}
const management=dialog=>dialog.locator('summary').filter({hasText:'Manage this work'});
const safe=state=>{expect(state.errors).toEqual([]);expect(state.writes).toEqual([]);};

test('saved work and exact job link remain prominent while management stays collapsed',async({page},info)=>{
 const {app,state}=await mount(page),dialog=await open(app);
 await expect(dialog.getByRole('link',{name:'Open job record'})).toHaveAttribute('href','#jobs?job='+jobId);
 await expect(dialog.getByRole('button',{name:'Open Jobs workspace',exact:true})).toBeVisible();
 for(const name of ['Schedule / Reassign','Close Job','Delete Job'])await expect(dialog.getByRole('button',{name,exact:true})).toBeHidden();
 await expect(management(dialog)).toBeVisible();await expect(dialog.getByRole('heading',{name:'Unit not linked',exact:true})).toBeVisible();
 await expect(dialog.getByRole('region',{name:'Recorded next step'})).toContainText('No next step is recorded');
 await management(dialog).scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('board-management-closed.png')});
 const before=state.calls.slice();await management(dialog).click();
 for(const name of ['Schedule / Reassign','Close Job','Delete Job'])await expect(dialog.getByRole('button',{name,exact:true})).toBeVisible();
 expect(state.calls).toEqual(before);await page.screenshot({path:info.outputPath('board-management-open.png')});safe(state);
});

test('management Escape restores focus without dismissing the selected work',async({page})=>{
 const {app,state}=await mount(page),dialog=await open(app);await management(dialog).click();
 await dialog.getByRole('button',{name:'Delete Job',exact:true}).focus();await page.keyboard.press('Escape');
 await expect(dialog).toBeVisible();await expect(management(dialog)).toBeFocused();
 await expect(dialog.locator('.cos-approved-board-management')).not.toHaveAttribute('open','');
 await dialog.getByRole('button',{name:'Close details',exact:true}).click();await expect(dialog).toHaveCount(0);
 const again=await open(app);await expect(again.locator('.cos-approved-board-management')).not.toHaveAttribute('open','');safe(state);
});

test('existing schedule and destructive confirmations remain original and cancellable without writes',async({page})=>{
 const {app,state}=await mount(page);let dialog=await open(app);await management(dialog).click();
 await dialog.getByRole('button',{name:'Schedule / Reassign',exact:true}).click();
 const assignment=app.getByRole('dialog',{name:'Schedule and reassign job',exact:true});await expect(assignment).toBeVisible();
 await assignment.getByRole('button',{name:'Cancel',exact:true}).click();
 // Scheduling opens the original separate dialog and does not submit a change.
 if(await app.getByRole('dialog',{name:'Work details',exact:true}).count())await app.getByRole('button',{name:'Close details',exact:true}).click();
 for(const [action,label] of [['Close Job','Close reason (optional)'],['Delete Job','Type DELETE COS-FIXTURE-3001 to permanently remove this job']]){
  dialog=await open(app);await management(dialog).click();await dialog.getByRole('button',{name:action,exact:true}).click();
  const confirmation=app.getByRole('dialog',{name:label,exact:true});await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button',{name:'CANCEL',exact:true}).click();await expect(confirmation).toHaveCount(0);
 }
 safe(state);
});

test('task and completed-visit records never gain management actions or inferred unit links',async({page})=>{
 const {app,state}=await mount(page);
 for(const title of ['Recorded inspection follow-up','Completed Example Builder']){
  const dialog=await open(app,title);await expect(management(dialog)).toHaveCount(0);
  for(const name of ['Schedule / Reassign','Close Job','Delete Job'])await expect(dialog.getByRole('button',{name,exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('heading',{name:'Unit not linked',exact:true})).toBeVisible();
  if(title.startsWith('Recorded'))await expect(dialog.getByRole('region',{name:'Recorded next step'})).toContainText('Review the saved inspection photos');
  else await expect(dialog.getByRole('link',{name:'Open current job'})).toHaveAttribute('href','#jobs?job='+jobId);
  await dialog.getByRole('button',{name:'Close details',exact:true}).click();
 }
 safe(state);
});

test('go-back job preserves original prohibition on Close Job',async({page})=>{
 const {app,state}=await mount(page,{goBack:true}),dialog=await open(app);await management(dialog).click();
 await expect(dialog.getByRole('button',{name:'Close Job',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'Delete Job',exact:true})).toBeVisible();safe(state);
});

test('management controls wrap and remain at least 48px high on narrow screens',async({page})=>{
 const {app,state}=await mount(page),dialog=await open(app);await management(dialog).click();
 for(const width of [page.viewportSize().width,320]){
  await page.setViewportSize({width,height:844});
  const geometry=await dialog.locator('.cos-approved-board-actions').evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth,controls:[...el.querySelectorAll('button,summary')].map(n=>{const r=n.getBoundingClientRect();return {height:r.height,left:r.left,right:r.right};}),viewport:innerWidth}));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client+1);
  for(const box of geometry.controls){expect(box.height).toBeGreaterThanOrEqual(48);expect(box.left).toBeGreaterThanOrEqual(0);expect(box.right).toBeLessThanOrEqual(geometry.viewport+1);}
 }
 safe(state);
});

test('existing job link keeps the saved UUID and closes the work dialog',async({page})=>{
 const {app,state}=await mount(page),dialog=await open(app);await dialog.getByRole('link',{name:'Open job record'}).click();
 await expect.poll(()=>app.locator('body').evaluate(()=>location.hash)).toBe('#jobs?job='+jobId);
 await expect(app.getByRole('dialog',{name:'Work details',exact:true})).toHaveCount(0);safe(state);
});

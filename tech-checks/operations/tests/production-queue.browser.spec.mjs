import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const actualHostSource=readFileSync(new URL('../../production-assignments-host.js',import.meta.url),'utf8');
const origin=process.env.COS_TEST_ORIGIN||'http://127.0.0.1:4173';
const endpoint='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const visitId='11111111-1111-4111-8111-111111111111';
const host='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe id="queue" src="/?mode=production-assignments"></iframe><script>window.addEventListener("message",e=>{const f=document.getElementById("queue");if(e.origin!==location.origin||e.source!==f.contentWindow||e.data.type!=="COS_OPERATIONS_TOKEN_REQUEST")return;e.source.postMessage({type:"COS_OPERATIONS_TOKEN_RESPONSE",requestId:e.data.requestId,accessToken:"synthetic-it-token",role:"it"},location.origin)})</script></body></html>';
const actualHarness="<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>body{margin:0}#cosProductionAssignmentsOverlay[hidden],#cosProductionAssignmentsButton[hidden]{display:none}#cosProductionAssignmentsOverlay{position:fixed;inset:0;z-index:30000;background:#07121f}#cosProductionAssignmentsFrame{width:100%;height:100dvh;border:0;display:block}#cosProductionAssignmentsClose{position:absolute;right:8px;top:8px;z-index:1;width:36px;height:44px}#cosProductionAssignmentsButton{position:fixed;right:12px;bottom:148px}</style></head><body><div id=\"appView\"><section id=\"view-it\"><label>Existing check value<input id=\"nativeValue\" value=\"preserved check\"></label></section></div><div id=\"authView\" class=\"hidden\"></div><script>window.TechCheckContext={getRole:()=> 'it',getEffectiveRole:()=> 'it',getSession:()=>({user:{id:'legacy-tech'}}),getProfile:()=>({user_id:'legacy-tech',active:true}),db:{auth:{onAuthStateChange:fn=>{window.authChangeHook=fn;return{}},getSession:async()=>({data:{session:{user:{id:'legacy-tech'},access_token:'synthetic-it-token'}}})}}};</script><script src=\"/actual-queue-host.js\"></script></body></html>";
async function setup(page,{actualHost=false}={}){
  const state={requests:[],failTasks:false,assigned:true,pending:false};
  await page.route('**/*',async route=>{
    const url=route.request().url();
    if(url===origin+'/queue-harness')return route.fulfill({status:200,contentType:'text/html',body:actualHost?actualHarness:host});
    if(url===origin+'/actual-queue-host.js')return route.fulfill({status:200,contentType:'text/javascript',body:actualHostSource});
    if(url.startsWith(origin+'/operations/dist/index.html'))return route.fulfill({status:307,headers:{location:'/?mode=production-assignments'}});
    if(url.startsWith(origin+'/'))return route.continue();
    if(url!==endpoint)return route.abort('blockedbyclient');
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'}});
    const envelope=route.request().postDataJSON();state.requests.push(envelope);
    expect(envelope.method).toBe('GET');expect(await route.request().headerValue('authorization')).toBe('Bearer synthetic-it-token');
    let value;
    if(envelope.path==='/api/tech/session')value={authorized:true,legacyTechnician:true,name:'Fixture IT',department:'it',role:'IT',productionTechnicianUserId:'fixture-actor'};
    else if(envelope.path==='/api/tech/it-queue')value={actorId:'fixture-actor',items:[]};
    else if(envelope.path==='/api/tech/assignments'){if(state.assignmentGate)await state.assignmentGate;value={profile:{display_name:'Fixture IT',department:'it'},visits:state.assigned?[{visit_id:visitId,job_id:'job',job_number:'FIX-501',customer_name:'Fixture customer',site_name:'Fixture site',visit_type:'IT_PREP',dispatch_status:'ready',scheduled_start:'2026-10-05T13:00:00Z'}]:[]};}
    else if(envelope.path==='/api/tech/tasks'){if(state.failTasks)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture task source unavailable'})});value={items:[{id:'task',title:'Fixture preparation',instructions:'Use existing check procedure',status:'assigned',priority:'high'}]};}
    else if(envelope.path==='/api/tech/visits/'+visitId){if(state.deniedVisit)return route.fulfill({status:403,headers:{'access-control-allow-origin':origin},contentType:'application/json',body:JSON.stringify({error:'Technician access revoked'})});value={pendingWorkflow:state.pending,visit:{id:visitId,visit_type:'IT_PREP',dispatch_status:'ready'},job:{id:'job',job_number:'FIX-501',customer_name:'Fixture customer'},site:{name:'Fixture site'},execution:state.pending?null:{status:'not_started'},current_step:state.pending?null:{title:'Inspect physical unit'}};}
    else throw new Error('Unexpected queue path '+envelope.path);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value),headers:{'access-control-allow-origin':origin}});
  });
  await page.goto('/queue-harness');
  if(actualHost)await page.getByRole('button',{name:'Operations assignments',exact:true}).click();
  const frame=page.frameLocator(actualHost?'#cosProductionAssignmentsFrame':'#queue');await expect(frame.getByRole('heading',{name:'Assigned jobs',exact:true})).toBeVisible();
  return{frame,state};
}
test('technician queue loads real-shaped assignments/details on desktop and mobile without writes',async({page})=>{
  const{frame,state}=await setup(page);
  await expect(frame.getByRole('button',{name:/FIX-501/})).toBeVisible();
  await frame.getByRole('button',{name:/FIX-501/}).click();
  await expect(frame.getByRole('region',{name:'Assigned visit details'})).toBeVisible();
  await expect(frame.getByText('Inspect physical unit',{exact:true})).toBeVisible();
  await frame.getByRole('button',{name:'Close visit details'}).click();
  const queueFrame=page.frames().find(f=>f.url().includes('mode=production-assignments'));
  const reloaded=page.waitForEvent('framenavigated',f=>f===queueFrame);
  await page.locator('#queue').evaluate(frame=>{frame.src=frame.src;});
  await reloaded;
  await expect(frame.getByRole('button',{name:/FIX-501/})).toBeVisible();
  expect(state.requests.every(request=>request.method==='GET'&&request.path.startsWith('/api/tech/'))).toBe(true);
  const overflow=await page.frames().find(f=>f.url().includes('mode=production-assignments')).evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
  expect(overflow).toBe(false);
});
test('one technician source failure stays explicit and retains prior records',async({page})=>{
  const{frame,state}=await setup(page);
  await expect(frame.getByText('Fixture preparation',{exact:true})).toBeVisible();
  state.failTasks=true;await frame.getByRole('button',{name:'Refresh assignments',exact:true}).click();
  await expect(frame.getByRole('alert')).toContainText('Fixture task source unavailable');
  await expect(frame.getByText('Fixture preparation',{exact:true})).toBeVisible();
  await expect(frame.getByRole('button',{name:/FIX-501/})).toBeVisible();
  expect(state.requests.filter(r=>r.method==='POST')).toHaveLength(0);
});

test('refresh clears details when Operations revokes the assigned visit',async({page})=>{
  const{frame,state}=await setup(page);await frame.getByRole('button',{name:/FIX-501/}).click();
  await expect(frame.getByRole('region',{name:'Assigned visit details'})).toBeVisible();
  state.assigned=false;await frame.getByRole('button',{name:'Refresh assignments',exact:true}).click();
  await expect(frame.getByRole('region',{name:'Assigned visit details'})).toHaveCount(0);
  await expect(frame.getByText('No assigned Operations visits.',{exact:true})).toBeVisible();
});
test('actual overlay keeps existing check state and clears data on cross-tab logout',async({page})=>{
  const{frame,state}=await setup(page,{actualHost:true});
  await expect(frame.getByRole('button',{name:/FIX-501/})).toBeVisible();
  await page.getByRole('button',{name:'Close Operations assignments',exact:true}).click();
  await expect(page.locator('#nativeValue')).toHaveValue('preserved check');
  await page.getByRole('button',{name:'Operations assignments',exact:true}).click();
  await expect(frame.getByRole('button',{name:/FIX-501/})).toBeVisible();
  await page.evaluate(()=>window.authChangeHook('SIGNED_OUT',null));
  await expect(page.locator('#cosProductionAssignmentsFrame')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Operations assignments',exact:true})).toBeHidden();
  await expect(page.locator('#nativeValue')).toHaveValue('preserved check');
  expect(state.requests.every(r=>r.method==='GET')).toBe(true);
});

test('old assignment details cannot reopen while a revoked queue refresh is pending',async({page})=>{
  const{frame,state}=await setup(page);let release;state.assignmentGate=new Promise(done=>{release=done;});
  await frame.getByRole('button',{name:'Refresh assignments',exact:true}).click();
  await expect(frame.getByRole('button',{name:/FIX-501/})).toBeDisabled();
  state.assigned=false;release();
  await expect(frame.getByText('No assigned Operations visits.',{exact:true})).toBeVisible();
  await expect(frame.getByRole('region',{name:'Assigned visit details'})).toHaveCount(0);
});

test('scheduled assigned prep opens pending details without inventing a workflow or start action',async({page})=>{
  const{frame,state}=await setup(page);state.pending=true;
  await frame.getByRole('button',{name:/FIX-501/}).click();
  const detail=frame.getByRole('region',{name:'Assigned visit details'});
  await expect(detail).toBeVisible();await expect(detail).toContainText('Assigned · Tech Check setup pending');
  await expect(detail).toContainText('Not dispatched. Operations must finish any required physical-unit setup and dispatch this visit before work can start.');
  await expect(detail.getByRole('button',{name:/start|complete|dispatch/i})).toHaveCount(0);
  expect(state.requests.every(request=>request.method==='GET')).toBe(true);
});

test('a visit access denial immediately clears previous technician records',async({page})=>{const{frame,state}=await setup(page);state.deniedVisit=true;await frame.getByRole('button',{name:/FIX-501/}).click();await expect(frame.getByRole('alert')).toContainText('Technician access revoked');await expect(frame.getByRole('region',{name:'Operations job assignments'})).toHaveCount(0);await expect(frame.getByRole('region',{name:'Shared IT queue'})).toHaveCount(0);expect(state.requests.every(request=>request.method==='GET')).toBe(true);});

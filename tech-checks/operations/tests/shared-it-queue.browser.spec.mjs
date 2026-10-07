import { test, expect } from '@playwright/test';
const origin=process.env.COS_TEST_ORIGIN||'http://127.0.0.1:4173';
const endpoint='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const visitId='22222222-2222-4222-8222-222222222222';
const actorId='fixture-it-actor';
const row={visitId,jobId:'shared-job',jobNumber:'FIX-SHARED',customer:'Fixture customer',site:'Fixture site',visitType:'IT_PREP',scheduledStart:'2026-10-06T21:00:00Z',scheduledEnd:'2026-10-06T22:00:00Z',setupNeeded:true,readinessNote:'Physical unit and Tech Check setup needed; ownership can be taken now.',nativeDispatchStatus:'ready',queueStatus:'ready',claimOwnerId:null,claimOwner:null,claimable:true};
const host=role=>`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0}</style><iframe id="queue" src="/?mode=production-assignments"></iframe><script>addEventListener('message',e=>{const f=document.getElementById('queue');if(e.origin!==location.origin||e.source!==f.contentWindow||e.data.type!=='COS_OPERATIONS_TOKEN_REQUEST')return;e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,accessToken:'synthetic-token',role:${JSON.stringify(role)}},location.origin)})</script>`;
async function setup(page,role='it') {
  const state={requests:[],writes:[],items:[structuredClone(row)],assigned:[],authorized:true,failRead:false,outcome:'success',hold:null};
  await page.route('**/*',async route=>{
    const req=route.request(),url=req.url();
    if(url===origin+'/shared-fixture')return route.fulfill({contentType:'text/html',body:host(role)});
    if(url.startsWith(origin+'/'))return route.continue();
    if(url!==endpoint)return route.abort('blockedbyclient');
    const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
    const envelope=req.postDataJSON();state.requests.push(envelope);const{path,method,body}=envelope;
    const answer=(data,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});
    if(method==='POST') {
      expect(path).toBe('/api/tech/it-queue/'+visitId+'/claim');expect(body).toEqual({});state.writes.push(envelope);
      if(state.hold)await state.hold;
      if(state.outcome==='conflict'){Object.assign(state.items[0],{queueStatus:'claimed',claimOwnerId:'other-actor',claimOwner:'Other IT',claimable:false,readinessNote:'Physical unit and Tech Check setup needed before work starts.'});return answer({error:'This visit has already been claimed.'},409);}
      if(state.outcome!=='no-save'){Object.assign(state.items[0],{queueStatus:'claimed',claimOwnerId:actorId,claimOwner:'Fixture IT',claimable:false,readinessNote:'Physical unit and Tech Check setup needed before work starts.'});state.assigned=[{visit_id:visitId,job_id:'shared-job',job_number:'FIX-SHARED',customer_name:'Fixture customer',site_name:'Fixture site',visit_type:'IT_PREP',assignment_status:'accepted',dispatch_status:'ready',status:'scheduled'}];}
      if(state.outcome==='uncertain'||state.outcome==='no-save')return route.abort('connectionfailed');
      return answer({visit_id:visitId,claimed_by:actorId,technician:'Fixture IT',status:'accepted',already_claimed:false});
    }
    expect(method).toBe('GET');
    if(path==='/api/tech/session')return answer({legacyTechnician:true,authorized:state.authorized,productionTechnicianUserId:actorId,department:role,name:'Fixture IT',reason:'IT access revoked'});
    if(state.failRead&&['/api/tech/assignments','/api/tech/it-queue'].includes(path))return answer({error:'Snapshot unavailable'},503);
    if(path==='/api/tech/it-queue')return answer({actorId,items:state.items});
    if(path==='/api/tech/assignments')return answer({profile:{department:role},visits:state.omitOwn?[]:state.assigned});
    if(path==='/api/tech/tasks')return answer({items:[]});
    throw Error('Unexpected synthetic request '+path);
  });
  await page.goto('/shared-fixture');const frame=page.frameLocator('#queue');
  await expect(frame.getByRole('heading',{name:'Assigned jobs',exact:true})).toBeVisible();
  if(role==='it')await expect(frame.getByRole('button',{name:'Take job',exact:true})).toBeEnabled();
  return{state,frame};
}
const writes=state=>state.requests.filter(req=>req.method==='POST');
test('take owns an unprepared job once and verifies both snapshots without dispatch',async({page})=>{
  const{state,frame}=await setup(page);await expect(frame.getByRole('region',{name:'Shared IT queue'})).toContainText('Setup needed');await expect(frame.getByRole('button',{name:/^start/i})).toHaveCount(0);let release;state.hold=new Promise(done=>release=done);
  const take=frame.getByRole('button',{name:'Take job',exact:true});await take.evaluate(button=>{button.click();button.click();});
  await expect(frame.getByRole('button',{name:'Taking job…'})).toBeDisabled();expect(writes(state)).toHaveLength(1);
  release();await expect(frame.getByText('Job taken and verified in your assigned jobs.',{exact:true})).toBeVisible();
  await expect(frame.getByRole('region',{name:'Operations job assignments'}).getByRole('button',{name:/FIX-SHARED/})).toBeVisible();
  await expect(frame.getByRole('region',{name:'Shared IT queue'})).toContainText('Taken by you');
  expect(state.assigned[0].dispatch_status).toBe('ready');expect(state.assigned[0].status).toBe('scheduled');await expect(frame.getByRole('region',{name:'Shared IT queue'})).toContainText('Setup needed');
  const index=state.requests.findIndex(req=>req.method==='POST');expect(state.requests.slice(index+1).map(req=>req.path)).toEqual(expect.arrayContaining(['/api/tech/it-queue','/api/tech/assignments']));
  await page.reload();await expect(frame.getByRole('region',{name:'Shared IT queue'})).toContainText('Taken by you');expect(writes(state)).toHaveLength(1);
  expect(await page.frames().find(f=>f.parentFrame()).evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
test('another IT claimant wins visibly and cannot be reassigned',async({page})=>{
  const{state,frame}=await setup(page);state.outcome='conflict';await frame.getByRole('button',{name:'Take job',exact:true}).click();
  await expect(frame.getByRole('alert')).toContainText('This job was taken by Other IT.');
  await expect(frame.getByRole('button',{name:'Already taken',exact:true})).toBeDisabled();
  await expect(frame.getByText('No assigned Operations visits.',{exact:true})).toBeVisible();expect(writes(state)).toHaveLength(1);
});
test('an uncertain accepted write is resolved by reads without replay',async({page})=>{
  const{state,frame}=await setup(page);state.outcome='uncertain';await frame.getByRole('button',{name:'Take job',exact:true}).click();
  await expect(frame.getByText('Job taken and verified in your assigned jobs.',{exact:true})).toBeVisible();expect(writes(state)).toHaveLength(1);
});
test('failed readback locks taking work until both sources refresh',async({page})=>{
  const{state,frame}=await setup(page);state.outcome='no-save';state.failRead=true;
  await frame.getByRole('button',{name:'Take job',exact:true}).click();
  await expect(frame.getByText('Refresh assignments to verify the previous claim before taking more work.',{exact:true})).toBeVisible();
  await frame.getByRole('button',{name:'Refresh assignments',exact:true}).click();
  await expect(frame.getByRole('button',{name:'Take job',exact:true})).toHaveCount(0);expect(writes(state)).toHaveLength(1);
  state.failRead=false;await frame.getByRole('button',{name:'Refresh assignments',exact:true}).click();
  await expect(frame.getByRole('button',{name:'Take job',exact:true})).toBeEnabled();
  state.outcome='success';await frame.getByRole('button',{name:'Take job',exact:true}).click();
  await expect(frame.getByText('Job taken and verified in your assigned jobs.',{exact:true})).toBeVisible();expect(writes(state)).toHaveLength(2);
});
test('focus refresh sees claimed work and revoked identity clears all records',async({page})=>{
  const{state,frame}=await setup(page);Object.assign(state.items[0],{queueStatus:'claimed',claimOwnerId:'other-actor',claimOwner:'Other IT',claimable:false,readinessNote:'Physical unit and Tech Check setup needed before work starts.'});
  await frame.locator('body').evaluate(()=>dispatchEvent(new Event('focus')));
  await expect(frame.getByRole('region',{name:'Shared IT queue'})).toContainText('Taken by Other IT');
  state.authorized=false;await frame.locator('body').evaluate(()=>dispatchEvent(new Event('focus')));
  await expect(frame.getByRole('alert')).toContainText('IT access revoked');await expect(frame.getByRole('region',{name:'Shared IT queue'})).toHaveCount(0);
  await expect(frame.getByRole('region',{name:'Operations job assignments'})).toHaveCount(0);expect(writes(state)).toHaveLength(0);
});
test('Service accounts retain own assignments without reading or claiming the IT queue',async({page})=>{
  const{state,frame}=await setup(page,'service');await expect(frame.getByText('No assigned Operations visits.',{exact:true})).toBeVisible();
  await expect(frame.getByRole('region',{name:'Shared IT queue'})).toHaveCount(0);expect(state.requests.some(req=>req.path.includes('it-queue'))).toBe(false);expect(writes(state)).toHaveLength(0);
});

test('a claimed queue row alone never reports a verified assignment',async({page})=>{const{state,frame}=await setup(page);state.omitOwn=true;await frame.getByRole('button',{name:'Take job',exact:true}).click();await expect(frame.getByRole('alert').filter({hasText:'Ownership appears saved'})).toBeVisible();await expect(frame.getByText('Job taken and verified in your assigned jobs.',{exact:true})).toHaveCount(0);await expect(frame.getByRole('region',{name:'Shared IT queue'})).toContainText('assignment verification pending');await expect(frame.getByText('Refresh assignments to verify the previous claim before taking more work.',{exact:true})).toBeVisible();expect(writes(state)).toHaveLength(1);await frame.getByRole('button',{name:'Refresh assignments',exact:true}).click();await expect(frame.getByText('Refresh assignments to verify the previous claim before taking more work.',{exact:true})).toBeVisible();state.omitOwn=false;await frame.getByRole('button',{name:'Refresh assignments',exact:true}).click();await expect(frame.getByRole('region',{name:'Shared IT queue'})).toContainText('Taken by you');expect(writes(state)).toHaveLength(1);});

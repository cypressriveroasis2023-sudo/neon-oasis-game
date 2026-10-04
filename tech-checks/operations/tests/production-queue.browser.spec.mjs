import { test, expect } from '@playwright/test';
const origin='http://127.0.0.1:4173';
const endpoint='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const visitId='11111111-1111-4111-8111-111111111111';
const host='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe id="queue" src="/?mode=production-assignments"></iframe><script>window.addEventListener("message",e=>{const f=document.getElementById("queue");if(e.origin!==location.origin||e.source!==f.contentWindow||e.data.type!=="COS_OPERATIONS_TOKEN_REQUEST")return;e.source.postMessage({type:"COS_OPERATIONS_TOKEN_RESPONSE",requestId:e.data.requestId,accessToken:"synthetic-it-token",role:"it"},location.origin)})</script></body></html>';
async function setup(page){
  const state={requests:[],failTasks:false};
  await page.route('**/*',async route=>{
    const url=route.request().url();
    if(url===origin+'/queue-harness')return route.fulfill({status:200,contentType:'text/html',body:host});
    if(url.startsWith(origin+'/'))return route.continue();
    if(url!==endpoint)return route.abort('blockedbyclient');
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'}});
    const envelope=route.request().postDataJSON();state.requests.push(envelope);
    expect(envelope.method).toBe('GET');expect(await route.request().headerValue('authorization')).toBe('Bearer synthetic-it-token');
    let value;
    if(envelope.path==='/api/tech/session')value={authorized:true,legacyTechnician:true,name:'Fixture IT',department:'it',role:'IT'};
    else if(envelope.path==='/api/tech/assignments')value={profile:{display_name:'Fixture IT',department:'it'},visits:[{visit_id:visitId,job_id:'job',job_number:'FIX-501',customer_name:'Fixture customer',site_name:'Fixture site',visit_type:'IT_PREP',dispatch_status:'ready',scheduled_start:'2026-10-05T13:00:00Z'}]};
    else if(envelope.path==='/api/tech/tasks'){if(state.failTasks)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture task source unavailable'})});value={items:[{id:'task',title:'Fixture preparation',instructions:'Use existing check procedure',status:'assigned',priority:'high'}]};}
    else if(envelope.path==='/api/tech/visits/'+visitId)value={visit:{id:visitId,visit_type:'IT_PREP',dispatch_status:'ready'},job:{id:'job',job_number:'FIX-501',customer_name:'Fixture customer'},site:{name:'Fixture site'},execution:{status:'not_started'},current_step:{title:'Inspect physical unit'}};
    else throw new Error('Unexpected queue path '+envelope.path);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value),headers:{'access-control-allow-origin':origin}});
  });
  await page.goto('/queue-harness');
  const frame=page.frameLocator('#queue');await expect(frame.getByRole('heading',{name:'Assigned jobs',exact:true})).toBeVisible();
  return{frame,state};
}
test('technician queue loads real-shaped assignments/details on desktop and mobile without writes',async({page})=>{
  const{frame,state}=await setup(page);
  await expect(frame.getByRole('button',{name:/FIX-501/})).toBeVisible();
  await frame.getByRole('button',{name:/FIX-501/}).click();
  await expect(frame.getByRole('region',{name:'Assigned visit details'})).toBeVisible();
  await expect(frame.getByText('Inspect physical unit',{exact:true})).toBeVisible();
  await frame.getByRole('button',{name:'Close visit details'}).click();
  await page.locator('#queue').evaluate(frame=>{frame.src=frame.src;});
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

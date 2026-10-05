import {test,expect} from '@playwright/test';

// Isolated browser fixtures only; all external requests are blocked.
const origin='http://127.0.0.1:4173';
const endpoint='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const customerId='11111111-1111-4111-8111-111111111111';
const siteId='22222222-2222-4222-8222-222222222222';
const unitId='33333333-3333-4333-8333-333333333333';
const modelId='44444444-4444-4444-8444-444444444444';
const newId='55555555-5555-4555-8555-555555555555';
const itId='66666666-6666-4666-8666-666666666666';
const serviceId='77777777-7777-4777-8777-777777777777';
const fixtureHtml='<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe id="operations" title="Isolated Operations" src="/?theme=classic"></iframe><script>window.addEventListener("message",event=>{const frame=document.getElementById("operations");if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data.type!=="COS_OPERATIONS_TOKEN_REQUEST")return;event.source.postMessage({type:"COS_OPERATIONS_TOKEN_RESPONSE",requestId:event.data.requestId,accessToken:"directory-fixture-token",role:"owner"},location.origin);});</script></body></html>';
async function setup(page){
  const state={
    customers:[{id:customerId,name:'Fixture Customer',legalName:'Fixture Customer LLC',customerNumber:'FX-C1',siteCount:1,jobCount:1,quoteCount:0,notes:'Fixture note',status:'active'}],
    sites:[{id:siteId,customerId,customer:'Fixture Customer',name:'Fixture Site',addressLine1:'100 Fixture Road',addressLine2:'',city:'Katy',stateRegion:'TX',postalCode:'77494',country:'US',accessInstructions:'Call before arrival',parkingInstructions:'Use north gate',safetyNotes:'Hard hat required',operationalNotes:'Fixture instructions',jobCount:1,status:'active'}],
    units:[{id:unitId,modelId,unitNumber:'FX-UNIT',serialNumber:'FX-SERIAL',modelName:'Fixture Model',modelCode:'FX',status:'available',currentLocationType:'shop'}],
    models:[{id:modelId,name:'Fixture Model',code:'FX'}],
    team:[{userId:itId,displayName:'Fixture IT',department:'it',active:true,linked:true},{userId:serviceId,displayName:'Fixture Service',department:'service',active:true,linked:true}],
    jobs:[{id:newId,jobNumber:'FX-JOB',technicianUserId:itId,technician:'Fixture IT',department:'it',status:'Assigned'}],
    readiness:[{userId:itId,name:'Fixture IT',department:'it',status:'Ready',result:{}}],
    writes:[],failed:new Set(),mismatch:false,
  };
  await page.route('**/*',async route=>{
    const request=route.request(),url=request.url();
    if(url===origin+'/directory-fixture')return route.fulfill({status:200,contentType:'text/html',body:fixtureHtml});
    if(url.startsWith(origin+'/'))return route.continue();
    if(url!==endpoint)return route.abort('blockedbyclient');
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'}});
    expect(await request.headerValue('authorization')).toBe('Bearer directory-fixture-token');
    const envelope=request.postDataJSON(),{path,method,body}=envelope;
    if(state.failed.has(path))return route.fulfill({status:503,contentType:'application/json',headers:{'access-control-allow-origin':origin},body:JSON.stringify({error:'Fixture source unavailable'})});
    let data;
    if(method==='GET'){
      if(path==='/api/routers')data={ items: [], source: 'camera_health', gpsAvailable: false, generatedAt: new Date().toISOString() };
      else if(path==='/api/session')data={authorized:true,name:'Fixture Owner',role:'Owner'};
      else if(path==='/api/customers')data={items:state.mismatch?state.customers.map(row=>({...row,notes:'Old note'})):state.customers};
      else if(path==='/api/sites')data={items:state.sites};
      else if(path==='/api/equipment')data={items:state.units,models:state.models};
      else if(path==='/api/team-production')data={items:state.team};
      else if(path==='/api/jobs')data={items:state.jobs};
      else if(path==='/api/daily-board')data={jobs:state.jobs,tasks:[],readiness:state.readiness,asOf:new Date().toISOString()};
      else if(['/api/quotes','/api/ar','/api/purchasing','/api/owner-tasks'].includes(path))data={items:[]};
      else throw new Error('Unexpected directory fixture GET: '+path);
    }else{
      state.writes.push(envelope);
      const match=/^\/api\/(customers|sites|equipment)(?:\/([^/]+))?$/.exec(path);
      if(!match)throw new Error('Unexpected fixture write: '+path);
      const rows=match[1]==='customers'?state.customers:match[1]==='sites'?state.sites:state.units;
      const id=match[2]||newId;
      const existing=rows.find(row=>row.id===id);
      if(existing)Object.assign(existing,body);else rows.push({id,...body,...(match[1]==='equipment'?{modelName:'Fixture Model',modelCode:'FX'}:{})});
      data={id};
    }
    return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':origin},body:JSON.stringify(data)});
  });
  await page.goto('/directory-fixture');
  const frame=page.frameLocator('#operations');
  await expect(frame.locator('.operations-shell')).toBeAttached();
  const more=frame.getByRole('button',{name:'More',exact:true});
  if(await more.isVisible())await more.click();
  await expect(frame.getByRole('navigation',{name:'COS Operations'})).toBeVisible();
  return{state,frame};
}
async function open(frame,name){
  const more=frame.getByRole('button',{name:'More',exact:true});
  if(await more.isVisible()&&await more.getAttribute('aria-expanded')!=='true')await more.click();
  const nav=frame.getByRole('navigation',{name:'COS Operations'});
  await expect(nav).toBeVisible();
  const button=nav.getByRole('button',{name,exact:true});
  await button.click();
  return frame.getByRole('region',{name:name+' Workspace',exact:true});
}
async function noOverflow(page){
  const frame=page.frames().find(value=>value.parentFrame());
  const metrics=await frame.evaluate(()=>({viewport:innerWidth,width:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)}));
  if(metrics.width>metrics.viewport+1){
    const overflowing=await frame.evaluate(()=>Array.from(document.body.querySelectorAll('*')).map(element=>({tag:element.tagName,class:element.className,text:element.textContent?.slice(0,90),left:element.getBoundingClientRect().left,right:element.getBoundingClientRect().right,scroll:element.scrollWidth,width:element.clientWidth})).filter(value=>value.right>innerWidth+1||value.scroll>value.width+1).slice(0,30));
    console.log('Directory overflow diagnostics',JSON.stringify({metrics,overflowing}));
  }
  expect(metrics.width).toBeLessThanOrEqual(metrics.viewport+1);
}

test('Customer edit saves once, reads back, and remains after reload',async({page})=>{
  const{state,frame}=await setup(page);
  const workspace=await open(frame,'Customers');
  await expect(workspace.getByText('Fixture Customer',{exact:true})).toBeVisible();
  await workspace.getByRole('button',{name:'Edit',exact:true}).click();
  await workspace.getByLabel('Notes',{exact:true}).fill('Updated fixture note');
  await workspace.getByRole('button',{name:'SAVE',exact:true}).click();
  await expect(frame.getByRole('status').filter({hasText:'Customer saved and verified.'})).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].body).not.toHaveProperty('id');
  expect(state.writes[0].body).not.toHaveProperty('p_actor_user_id');
  await page.reload();
  const restored=await open(frame,'Customers');
  await restored.getByRole('button',{name:'Edit',exact:true}).click();
  await expect(restored.getByLabel('Notes',{exact:true})).toHaveValue('Updated fixture note');
  await noOverflow(page);
});

test('Site instructions save and persist after reload without changing the customer',async({page})=>{
  const{state,frame}=await setup(page);
  const workspace=await open(frame,'Sites');
  await expect(workspace.getByText('Fixture Site',{exact:true})).toBeVisible();
  await workspace.getByRole('button',{name:'Edit',exact:true}).click();
  await workspace.getByLabel('Access Instructions',{exact:true}).fill('Call fixture contact at arrival');
  await workspace.getByLabel('Safety Notes',{exact:true}).fill('Wear fixture safety vest');
  await workspace.getByRole('button',{name:'SAVE',exact:true}).click();
  await expect(frame.getByRole('status').filter({hasText:'Site saved and verified.'})).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].body.customerId).toBe(customerId);
  await page.reload();
  const restored=await open(frame,'Sites');
  await expect(restored.getByText('Access: Call fixture contact at arrival',{exact:true})).toBeVisible();
  await expect(restored.getByText('Safety: Wear fixture safety vest',{exact:true})).toBeVisible();
  await noOverflow(page);
});

test('Equipment create validates production model and verifies the new unit after reload',async({page})=>{
  const{state,frame}=await setup(page);
  const workspace=await open(frame,'Equipment');
  await workspace.getByRole('button',{name:'+ ADD EQUIPMENT UNIT',exact:true}).click();
  await workspace.getByRole('button',{name:'SAVE UNIT',exact:true}).click();
  await expect(workspace.getByRole('alert')).toContainText('Model is required.');
  expect(state.writes).toHaveLength(0);
  await workspace.getByLabel('Model *',{exact:true}).selectOption(modelId);
  await workspace.getByLabel('Unit Number *',{exact:true}).fill('FX-NEW-UNIT');
  await workspace.getByLabel('Serial Number',{exact:true}).fill('FX-NEW-SERIAL');
  await workspace.getByRole('button',{name:'SAVE UNIT',exact:true}).click();
  await expect(frame.getByRole('status').filter({hasText:'Equipment unit saved and verified.'})).toBeVisible();
  expect(state.writes).toHaveLength(1);
  await page.reload();
  const restored=await open(frame,'Equipment');
  await restored.getByLabel('Search equipment').fill('FX-NEW-UNIT');
  await expect(restored.locator('.record.op-record')).toHaveCount(1);
  await expect(restored.locator('.record.op-record')).toContainText('FX-NEW-SERIAL');
  await noOverflow(page);
});

test('Directory failure retains records and mismatch blocks duplicate save until refresh',async({page})=>{
  const{state,frame}=await setup(page);
  const workspace=await open(frame,'Customers');
  await expect(workspace.getByText('Fixture Customer',{exact:true})).toBeVisible();
  state.failed.add('/api/customers');
  await workspace.getByRole('button',{name:'REFRESH RECORDS',exact:true}).click();
  await expect(workspace.getByRole('alert')).toContainText('Showing the last successful records.');
  await expect(workspace.getByText('Fixture Customer',{exact:true})).toBeVisible();
  state.failed.clear();
  await workspace.getByRole('button',{name:'Edit',exact:true}).click();
  await workspace.getByLabel('Notes',{exact:true}).fill('Mismatch fixture note');
  state.mismatch=true;
  await workspace.getByRole('button',{name:'SAVE',exact:true}).click();
  await expect(workspace.getByRole('alert').filter({hasText:'fresh record does not match'})).toBeVisible();
  await expect(workspace.getByRole('button',{name:'SAVE',exact:true})).toBeDisabled();
  expect(state.writes).toHaveLength(1);
  await workspace.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(workspace.getByRole('button',{name:'+ NEW CUSTOMER',exact:true})).toBeDisabled();
  await expect(workspace.getByRole('button',{name:'Edit',exact:true})).toBeDisabled();
  state.mismatch=false;
  await workspace.getByRole('button',{name:'REFRESH RECORDS',exact:true}).click();
  await expect(workspace.getByRole('region',{name:'Edit Customer',exact:true})).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  await noOverflow(page);
});

test('Team shows only actual roster, exact assignment and readiness without provisioning writes',async({page})=>{
  const{state,frame}=await setup(page);
  const workspace=await open(frame,'Team');
  await expect(workspace.getByText('Fixture IT',{exact:true})).toBeVisible();
  await expect(workspace.getByText('IT Technician · 1 active assigned jobs',{exact:true})).toBeVisible();
  await expect(workspace.getByText('Readiness: Ready',{exact:true})).toBeVisible();
  await workspace.getByLabel('Department',{exact:true}).selectOption('service');
  await expect(workspace.locator('.record.op-record')).toHaveCount(1);
  await expect(workspace.getByText('Fixture Service',{exact:true})).toBeVisible();
  expect(state.writes).toHaveLength(0);
  await expect(workspace.getByRole('button',{name:/PROVISION|REPAIR/})).toHaveCount(0);
  await noOverflow(page);
});

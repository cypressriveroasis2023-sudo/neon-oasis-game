import {test,expect} from '@playwright/test';
const origin='http://127.0.0.1:4173';
const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
const tech='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444';
const nil='00000000-0000-0000-0000-000000000000';
async function mount(page,{bad=false,missing=false}={}){
 const state={calls:[],writes:[],errors:[],failJobs:false};page.on('pageerror',e=>state.errors.push(e.message));
 const team=[{userId:tech,displayName:'Example IT technician',department:'it',active:true,linked:true},{userId:other,displayName:'Example Service technician',department:'service',active:true,linked:true}];
 const base={jobNumber:'COS-SAVED-100',jobType:'SERVICE',department:'it',technicianUserId:tech,technician:'Example IT technician',status:'Assigned',equipment:'Spotter',equipmentUnitTag:'EXAMPLE-260',notes:[]};
 const jobs=[{...base,id:bad?'BAD-ID':missing?nil:first,customer:'First saved customer',site:'First recorded site'},{...base,id:second,customer:'Second saved customer',site:'Second recorded site',status:'In progress'},
  {...base,id:'55555555-5555-4555-8555-555555555555',technicianUserId:other,customer:'Other assignment',site:'Other site'},
  {...base,id:'66666666-6666-4666-8666-666666666666',customer:'Closed work',status:'Closed'}];
 await page.route('**/*',route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===origin&&url.pathname==='/approved-team-fixture')return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}header{height:24px;font:12px/24px sans-serif;text-align:center;background:white;color:#111}iframe{display:block;width:100%;height:calc(100vh - 24px);border:0}</style></head><body><header>SYNTHETIC TEST — NOT LIVE OPERATIONS</header><iframe title="COS test application" src="/#team"></iframe><script>addEventListener('message',e=>{const f=document.querySelector('iframe');if(e.origin!==location.origin||e.source!==f.contentWindow||e.data?.type!=='COS_OPERATIONS_TOKEN_REQUEST')return;e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-team-test-only'},location.origin)})</script></body></html>`});
  if(url.origin===origin)return route.continue();
  if(!url.pathname.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  const body=request.postDataJSON();state.calls.push(body.path);
  if(body.method!=='GET'){state.writes.push(body.path);return route.fulfill({status:400,headers,json:{error:'No operational writes permitted'}});}
  if(body.path==='/api/jobs'&&state.failJobs)return route.fulfill({status:503,headers,json:{error:'Synthetic jobs source unavailable'}});
  const data=body.path==='/api/session'?{authorized:true,legacyOwner:true,role:'Owner',name:'Synthetic Owner',features:{unitTracker:true}}:
   body.path==='/api/team-production'?{items:team}:body.path==='/api/jobs'?{items:jobs}:
   body.path==='/api/daily-board'?{jobs:[],tasks:[],readiness:[{userId:tech,status:'Ready'}],asOf:new Date().toISOString()}:{items:[]};
  return route.fulfill({headers,json:data});
 });
 await page.goto('/approved-team-fixture');const app=page.frameLocator('iframe'),hub=app.getByRole('region',{name:'Team Workspace',exact:true});
 await expect(hub).toBeVisible();await expect(hub.getByRole('button',{name:'REFRESH TEAM',exact:true})).toBeEnabled();
 return {app,hub,state};
}
const safe=state=>{expect(state.errors).toEqual([]);expect(state.writes).toEqual([]);};
const member=hub=>hub.locator('.record.op-record').filter({hasText:'Example IT technician'});
test('Team shows roster and readiness without job links or a jobs read',async({page})=>{
 const {hub,state}=await mount(page),row=member(hub);
 await expect(row.getByText('IT Technician',{exact:true})).toBeVisible();
 await expect(row).toContainText('Readiness: Ready');
 await expect(row.getByRole('link')).toHaveCount(0);
 await expect(hub.getByRole('link')).toHaveCount(0);
 expect(state.calls.filter(path=>path==='/api/jobs')).toEqual([]);
 await hub.getByLabel('Department',{exact:true}).selectOption('service');
 await expect(hub.locator('.record.op-record')).toHaveCount(1);
 await expect(hub).toContainText('Example Service technician');
 safe(state);
});

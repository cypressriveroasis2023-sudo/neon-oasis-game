import {test,expect} from '@playwright/test';
import {mountFleet,units,now,fresh} from './fleet-dashboard-fixtures.mjs';
import {openWorkspace} from './navigation-helper.mjs';
import {resolveBoardUnitLink} from '../proposals/board-unit-link/resolveBoardUnitLink.ts';
import {fixture,JOB,VISIT,TASK} from '../proposals/board-unit-link/fixtures.mjs';

// Real built App, ordinary navigation, synthetic server responses only. No live credentials or data.
const origin='http://127.0.0.1:4173',asOf=new Date(now).toISOString(),unit=units[1];
function verified(record,kind='job'){
 const f=fixture();f.asOf=asOf;f.assignments.asOf=asOf;f.assignments.items[0].unitId=unit.id;f.assignments.items[0].assignedAt='2026-10-01T12:00:00Z';
 f.fleet.asOf=asOf;f.fleet.value.inventoryItems[0].id=unit.id;f.fleet.value.inventoryItems[0].uploadPlacementEvidence.observedAt=fresh;
 f.fleet.value.uploadInventory.lastApiReadAt=fresh;f.fleet.value.uploadInventory.records[0].observedAt=fresh;f.fleet.value.uploadInventory.records[0].binding.unitIds=[unit.id];
 const result=resolveBoardUnitLink(kind,record,f);expect(result.state).toBe('linked');return result;
}
async function mount(page,{mode='valid'}={}){
 const {app,state}=await mountFleet(page);
 await page.evaluate(()=>{const h=document.createElement('header');h.textContent='SYNTHETIC TEST — NOT LIVE OPERATIONS';h.style.cssText='height:24px;font:12px/24px sans-serif;background:#fff;color:#111;text-align:center';document.body.prepend(h);document.querySelector('iframe').style.height='calc(100vh - 24px)';});
 const job={id:JOB,jobNumber:'COS-SAMPLE-9001',customer:'Board sample customer',site:'Recorded service site',status:'Unscheduled',department:'service',technician:'Example technician',jobType:'SERVICE',equipment:'Spotter',equipmentUnitTag:'An unrelated display alias',notes:[{text:'Saved inspection note; do not create another ticket.',by:'Example technician',at:fresh}]};
 job.unitLink=verified(job);
 const visit={...job,id:`${JOB}:visit:${VISIT}`,jobId:JOB,visitId:VISIT,completionKind:'visit',customer:'Completed sample customer',jobNumber:'COS-SAMPLE-9002',status:'Completed',completedAt:asOf};visit.unitLink=verified(visit);
 const task={id:TASK,title:'Inspect the saved issue',relatedJobId:JOB,status:'Not started',assignedTo:'Example technician',assignedDepartment:'service',instructions:'Review the recorded inspection note.'};task.unitLink=verified(task,'task');
 if(mode==='missing')delete job.unitLink;
 if(mode==='held')job.unitLink={contract:'COS_BOARD_UNIT_LINK_V1',state:'not_linked',reason:'product_binding_held'};
 if(mode==='mismatch')job.unitLink.jobId=TASK;
 if(mode==='newer')job.unitLink.fleetAsOf='2026-10-06T18:01:00Z';
 const board={jobs:[job,visit],tasks:[task],readiness:[],asOf};const control={fail:false};
 await page.route('**/functions/v1/cos-operations-pages',async route=>{
  const r=route.request();if(r.method()==='OPTIONS')return route.fallback();const request=r.postDataJSON();
  if(request.method!=='GET'){state.calls.push(request);return route.abort('blockedbyclient');}
  if(request.path!=='/api/daily-board'&&request.path!=='/api/tv-board/settings')return route.fallback();
  state.calls.push(request);const headers={'access-control-allow-origin':origin};
  if(control.fail&&request.path==='/api/daily-board')return route.fulfill({status:503,headers,json:{error:'Synthetic Board refresh unavailable'}});
  return route.fulfill({headers,json:request.path==='/api/daily-board'?board:{sections:['today'],revision:0,updatedAt:null}});
 });
 await openWorkspace(app,'Daily Board');await expect(app.locator('.daily-board-card')).toHaveCount(1);
 return {app,state,control};
}
const safe=state=>{expect(state.errors).toEqual([]);expect(state.calls.every(c=>c.method==='GET')).toBe(true);};
async function open(app,title='Board sample customer'){
 await app.locator('.daily-board-card').filter({hasText:title}).click();
 const dialog=app.getByRole('dialog',{name:'Work details',exact:true});await expect(dialog).toBeVisible();return dialog;
}
test('job cards stay off the Daily Board while the assigned task remains',async({page})=>{
 const {app,state}=await mount(page);
 await expect(app.getByText('Board sample customer')).toHaveCount(0);
 await expect(app.getByText('Completed sample customer')).toHaveCount(0);
 await expect(app.getByText('Inspect the saved issue')).toBeVisible();
 expect(state.calls.some(item=>String(item.path||'').startsWith('/api/jobs'))).toBe(false);
 safe(state);
});
test('failed Board refresh suppresses a formerly valid unit shortcut without altering saved records',async({page})=>{
 const {app,state,control}=await mount(page);control.fail=true;
 await app.getByRole('button',{name:'Refresh',exact:true}).click();await expect(app.locator('.daily-board-error')).toContainText('Showing the last successful snapshot.');
 const dialog=await open(app,'Inspect the saved issue');
 await expect(dialog.locator('a[href*="unit="]')).toHaveCount(0);
 await expect(dialog).toContainText('Board refresh is unavailable or delayed.');
 await expect(dialog).toContainText('Review the recorded inspection note.');
 expect(state.calls.some(item=>item.method!=='GET')).toBe(false);
 safe(state);
});

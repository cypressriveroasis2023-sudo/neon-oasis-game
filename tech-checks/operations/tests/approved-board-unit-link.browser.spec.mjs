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
 await openWorkspace(app,'Daily Board');await expect(app.locator('.daily-board-card')).toHaveCount(3);
 return {app,state,control};
}
const safe=state=>{expect(state.errors).toEqual([]);expect(state.calls.every(c=>c.method==='GET')).toBe(true);};
async function open(app,title='Board sample customer'){
 await app.locator('.daily-board-card').filter({hasText:title}).click();
 const dialog=app.getByRole('dialog',{name:'Work details',exact:true});await expect(dialog).toBeVisible();return dialog;
}
test('Board problem opens its exact saved unit, original evidence and browser Back',async({page},info)=>{
 const {app,state}=await mount(page);const before=state.calls.map(c=>c.path),dialog=await open(app);
 const link=dialog.getByRole('link',{name:'Open unit',exact:true});await expect(link).toHaveAttribute('href','#fleet-dashboard?unit='+unit.id);
 await expect(dialog).toContainText('Product ID: 123456789');await expect(dialog).toContainText('not a camera check time');
 expect(state.calls.map(c=>c.path)).toEqual(before);await link.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('board-verified-unit-link.png')});
 await link.click();const drawer=app.getByRole('dialog',{name:unit.unitNumber+' unit intelligence',exact:true});await expect(drawer).toBeVisible();
 await expect.poll(()=>app.locator('body').evaluate(()=>location.hash)).toBe('#fleet-dashboard?unit='+unit.id);
 await expect(drawer.getByRole('region',{name:'Unit recorded address'})).toContainText(unit.address);
 await expect(drawer.locator('.cos-fleet-camera-card')).toContainText('Camera outage observed');
 await expect(drawer.locator('.cos-fleet-camera-card > small').first()).not.toBeEmpty();
 await drawer.locator('.cos-fleet-installation-evidence > summary').click();await expect(drawer.locator('.cos-fleet-installation-evidence')).toContainText('Location evidence');
 await page.screenshot({path:info.outputPath('board-opened-exact-unit.png')});
 await page.evaluate(()=>history.back());await expect.poll(()=>app.locator('body').evaluate(()=>location.hash)).toBe('#daily-board');
 await expect(app.locator('.daily-board-card')).toHaveCount(3);safe(state);
});
test('completed visits explicitly link current job equipment and tasks use their related job',async({page})=>{
 const {app,state}=await mount(page);let dialog=await open(app,'Completed sample customer');
 await expect(dialog.getByRole('link',{name:'Open current job unit',exact:true})).toHaveAttribute('href','#fleet-dashboard?unit='+unit.id);
 await expect(dialog).toContainText('not verified equipment from this completed visit');await dialog.getByRole('button',{name:'Close details',exact:true}).click();
 dialog=await open(app,'Inspect the saved issue');await expect(dialog.getByRole('link',{name:'Open unit',exact:true})).toHaveAttribute('href','#fleet-dashboard?unit='+unit.id);
 await expect(dialog).toContainText('Review the recorded inspection note.');safe(state);
});
for(const mode of ['missing','held','mismatch','newer'])test(mode+' metadata keeps original unlinked explanation and exact job link',async({page})=>{
 const {app,state}=await mount(page,{mode}),dialog=await open(app);
 await expect(dialog.getByRole('heading',{name:'Unit not linked',exact:true})).toBeVisible();
 await expect(dialog.locator('a[href*="unit="]')).toHaveCount(0);await expect(dialog.getByRole('link',{name:'Open job record'})).toHaveAttribute('href','#jobs?job='+JOB);safe(state);
});
test('failed Board refresh suppresses a formerly valid unit shortcut without altering saved records',async({page})=>{
 const {app,state,control}=await mount(page);control.fail=true;
 await app.getByRole('button',{name:'Refresh',exact:true}).click();await expect(app.locator('.daily-board-error')).toContainText('Showing the last successful snapshot.');
 const dialog=await open(app);await expect(dialog.locator('a[href*="unit="]')).toHaveCount(0);await expect(dialog).toContainText('Board refresh is unavailable or delayed.');
 await dialog.locator('.cos-board-record-history > summary').click();await expect(dialog).toContainText('Saved inspection note; do not create another ticket.');safe(state);
});
test('the new shortcut has a phone-sized touch target, readable contrast and native keyboard activation',async({page})=>{
 await page.setViewportSize({width:320,height:844});const {app,state}=await mount(page),dialog=await open(app),link=dialog.getByRole('link',{name:'Open unit',exact:true});
 const m=await link.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {h:r.height,l:r.left,r:r.right,w:innerWidth,fg:s.color,bg:s.backgroundColor,scroll:document.documentElement.scrollWidth};});
 expect(m.h).toBeGreaterThanOrEqual(48);expect(m.l).toBeGreaterThanOrEqual(0);expect(m.r).toBeLessThanOrEqual(m.w+1);expect(m.scroll).toBeLessThanOrEqual(m.w+1);
 const lum=c=>c.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
 const fg=lum(m.fg),bg=lum(m.bg);expect((Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)).toBeGreaterThanOrEqual(4.5);
 await link.focus();await expect(link).toBeFocused();await page.keyboard.press('Enter');await expect(app.getByRole('dialog',{name:unit.unitNumber+' unit intelligence',exact:true})).toBeVisible();safe(state);
});

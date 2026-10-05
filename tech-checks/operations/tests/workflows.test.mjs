import test from 'node:test';
import assert from 'node:assert/strict';
import { assignmentTechnicians, calendarDays, canDispatch, confirmedDispatch, confirmedReview, confirmedSchedule, createJobActionSaver, jobDepartment, jobItems, moveCalendar, safeEvidenceUrl, scheduledDay, technicianLocationUrl, visibleJobs } from '../src/operationsWorkflowData.ts';

const id='6f1c0dc0-e52b-4fd8-b6b1-692715089ae4';
const visit='9d2aa1ca-097e-46ec-89c0-c860ab3d90a2';
const job=(extra={})=>({id,visitId:visit,status:'Scheduled',technician:'Actual Service Technician',scheduled:'2026-10-05 08:00',scheduledEnd:'2026-10-05 10:00',equipmentUnitTag:'UNIT-17',...extra});

test('failed or malformed jobs snapshots do not become an empty queue',()=>{
  assert.throws(()=>jobItems(null),/incomplete/);
  assert.throws(()=>jobItems({}),/incomplete/);
  assert.throws(()=>jobItems({items:[null]}),/incomplete/);
  assert.throws(()=>jobItems({items:[job(),job()]}),/inconsistent/);
  assert.deepEqual(jobItems({items:[]}),[]);
});

test('queues use normalized real workflow states',()=>{
  const rows=[job({id:'a',status:'unscheduled'}),job({id:'b',status:'Assigned'}),job({id:'c',status:'owner_review'}),job({id:'d',status:'Closed'})];
  assert.deepEqual(visibleJobs(rows,'unscheduled').map(row=>row.id),['a']);
  assert.deepEqual(visibleJobs(rows,'dispatch').map(row=>row.id),['b']);
  assert.deepEqual(visibleJobs(rows,'review').map(row=>row.id),['c']);
  assert.equal(visibleJobs(rows,'jobs').length,4);
});

test('department assignment uses only currently active roster identities',()=>{
  const team=[{userId:'1',displayName:'Active IT',department:'IT',active:true},{userId:'2',displayName:'Retired IT',department:'it',active:false},{userId:'3',displayName:'Active Service',department:'service',active:true}];
  assert.deepEqual(assignmentTechnicians(team,'it').map(row=>row.name),['Active IT']);
  assert.deepEqual(assignmentTechnicians([],'service'),[]);
  assert.equal(jobDepartment({department:'service',stage:'IT Prep'}),'service');
  assert.equal(jobDepartment({jobType:'DELIVERY'}),'it');
  assert.equal(jobDepartment({jobType:'SERVICE',shopPrep:false}),'service');
});

test('dispatch requires a scheduled or assigned job and an identified physical unit',()=>{
  assert.equal(canDispatch(job()),true);
  assert.equal(canDispatch(job({equipmentUnitTag:''})),false);
  assert.equal(canDispatch(job({equipmentUnitTag:' '})),false);
  assert.equal(canDispatch(job({status:'Dispatched'})),false);
  assert.equal(canDispatch(job({status:'Owner Review'})),false);
});

test('calendar groups ISO timestamps in Chicago while preserving native local dates',()=>{
  assert.equal(scheduledDay('2026-10-04 08:30'),'2026-10-04');
  assert.equal(scheduledDay('2026-10-04T04:00:00Z'),'2026-10-03');
  assert.equal(scheduledDay('Not scheduled'),'');
  assert.equal(scheduledDay('2026-02-30 08:30'),'');
  assert.equal(scheduledDay(null),'');
});

test('calendar navigation preserves month and year boundaries without date rollover',()=>{
  assert.equal(moveCalendar('2026-01-31','Month',1),'2026-02-28');
  assert.equal(moveCalendar('2024-02-29','Year',1),'2025-02-28');
  assert.equal(moveCalendar('2026-12-31','Month',1),'2027-01-31');
  assert.deepEqual(calendarDays('2026-10-04','Week'),['2026-10-04','2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10']);
  assert.equal(calendarDays('2026-10-31','Month').length,42);
  assert.equal(calendarDays('2026-10-31','Month')[0],'2026-09-27');
});

test('evidence links reject executable schemes and invalid technician coordinates',()=>{
  assert.equal(safeEvidenceUrl('javascript:alert(1)'),null);
  assert.equal(safeEvidenceUrl('data:text/html,<script>'),null);
  assert.equal(safeEvidenceUrl('http://example.test/photo'),null);
  assert.equal(safeEvidenceUrl('https://example.test/photo'),'https://example.test/photo');
  assert.equal(technicianLocationUrl({latitude:91,longitude:0}),null);
  assert.equal(technicianLocationUrl({latitude:null,longitude:null}),null);
  assert.equal(technicianLocationUrl({latitude:'',longitude:''}),null);
  assert.equal(technicianLocationUrl({latitude:false,longitude:false}),null);
  assert.equal(technicianLocationUrl({latitude:0,longitude:0}),'https://www.google.com/maps/search/?api=1&query=0,0');
});

test('schedule confirmation requires the same job, current visit, technician and both times',()=>{
  const expected={id,visitId:visit,technician:'Actual Service Technician',start:'2026-10-05 08:00',end:'2026-10-05 10:00'};
  assert.equal(confirmedSchedule([job()],expected),true);
  assert.equal(confirmedSchedule([job({scheduled:'2026-10-05T08:00'})],expected),true);
  assert.equal(confirmedSchedule([job({visitId:'another-visit'})],expected),false);
  assert.equal(confirmedSchedule([job({technician:'Different Technician'})],expected),false);
  assert.equal(confirmedSchedule([job({scheduledEnd:'2026-10-05 11:00'})],expected),false);
});

test('dispatch and review confirmations require corresponding persisted lifecycle state',()=>{
  assert.equal(confirmedDispatch([job({status:'Dispatched'})],id,'Actual Service Technician',visit),true);
  assert.equal(confirmedDispatch([job({status:'Dispatched',visitId:'other'})],id,'Actual Service Technician',visit),false);
  assert.equal(confirmedDispatch([job()],id,'Actual Service Technician',visit),false);
  assert.equal(confirmedReview([job({stage:'Billing',billingReady:true})],id,'approve'),true);
  assert.equal(confirmedReview([job({stage:'Billing',billingReady:false})],id,'approve'),false);
  assert.equal(confirmedReview([job({status:'Unscheduled',billingReady:false})],id,'return'),true);
  assert.equal(confirmedReview([job({status:'Owner Review'})],id,'return'),false);
});

test('accepted writes require an independent readback and do not replay on read failure',async()=>{
  let writes=0,reads=0;
  const saver=createJobActionSaver({post:async()=>{writes+=1;},get:async()=>{reads+=1;throw new Error('read unavailable');}});
  const result=await saver.save('/api/jobs/'+id+'/dispatch',{},()=>true);
  assert.equal(result.status,'accepted_unverified');
  assert.equal(writes,1);
  assert.equal(reads,1);
  assert.equal(saver.needsRefresh,true);
  assert.equal((await saver.save('/api/jobs/'+id+'/dispatch',{},()=>true)).status,'refresh_required');
  assert.equal(writes,1);
});

test('connection failures never trigger an automatic write retry',async()=>{
  let writes=0,reads=0;
  const saver=createJobActionSaver({post:async()=>{writes+=1;throw new Error('connection failed');},get:async()=>{reads+=1;return {data:{items:[job()]}};}});
  assert.equal((await saver.save('/api/jobs/'+id+'/schedule',{},()=>true)).status,'unconfirmed');
  assert.equal(writes,1);
  assert.equal(reads,0);
  assert.equal(saver.needsRefresh,true);
  assert.equal((await saver.save('/api/jobs/'+id+'/schedule',{},()=>true)).status,'refresh_required');
  assert.throws(()=>saver.acknowledgeRefresh({items:[job(),job()]}));
  assert.equal(saver.needsRefresh,true);
  saver.acknowledgeRefresh({items:[job()]});
  assert.equal(saver.needsRefresh,false);
  await saver.save('/api/jobs/'+id+'/schedule',{},()=>true);
  assert.equal(writes,2);
});

test('a stale readback is accepted but unverified, and a matching fresh read confirms',async()=>{
  const stale=createJobActionSaver({post:async()=>{},get:async()=>({data:{items:[job()]}})});
  assert.equal((await stale.save('/api/jobs/'+id+'/dispatch',{},rows=>confirmedDispatch(rows,id,'Actual Service Technician',visit))).status,'accepted_unverified');
  const fresh=createJobActionSaver({post:async()=>{},get:async()=>({data:{items:[job({status:'Dispatched'})]}})});
  assert.equal((await fresh.save('/api/jobs/'+id+'/dispatch',{},rows=>confirmedDispatch(rows,id,'Actual Service Technician',visit))).status,'confirmed');
});

test('concurrent user actions cannot submit duplicate writes',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  let writes=0;
  const saver=createJobActionSaver({post:async()=>{writes+=1;await gate;},get:async()=>({data:{items:[job()]}})});
  const first=saver.save('/api/jobs/'+id+'/schedule',{},()=>true);
  assert.equal((await saver.save('/api/jobs/'+id+'/schedule',{},()=>true)).status,'busy');
  release();
  assert.equal((await first).status,'confirmed');
  assert.equal(writes,1);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { productionDay, productionTasks, productionVisit, queueTime, queueStatus } from '../src/productionQueueData.ts';
import { validateCameraHealth } from '../src/CameraHealthWorkspace.tsx';
import { snapshot as cameraSnapshot, resource as cameraResource } from './fixtures/camera-evidence-fixtures.mjs';
test('native queue accepts a real empty snapshot and rejects malformed visits',()=>{
  assert.deepEqual(productionDay({profile:{department:'it'},visits:[]}).visits,[]);
  for(const data of [null,{}, {profile:{},visits:[null]}, {profile:{},visits:[{}]}, {profile:[],visits:[]}]) assert.throws(()=>productionDay(data),/incomplete/);
});
test('task list preserves native values and never treats a failure as empty',()=>{
  const item={id:'native-task',title:'Real task',instructions:'Check inventory',dueAt:null,status:'assigned'};
  assert.equal(productionTasks({items:[item]})[0],item);
  for(const value of [null,{}, {items:[null]}, {items:[{}]}]) assert.throws(()=>productionTasks(value),/incomplete/);
});
test('visit readback must match selected authorized visit and a real job',()=>{
  const value={visit:{id:'visit-a'},job:{id:'job-a'},current_step:{title:'Inspect'}};
  assert.equal(productionVisit(value,'visit-a'),value);
  assert.throws(()=>productionVisit(value,'visit-b'),/verified/);
  assert.throws(()=>productionVisit({visit:{id:'visit-a'},job:{}},'visit-a'),/verified/);
});
test('unavailable schedule and status stay explicit',()=>{
  assert.equal(queueTime(null),'Not scheduled');
  assert.equal(queueStatus(null),'UNAVAILABLE');
  assert.equal(queueStatus('owner_review'),'OWNER REVIEW');
});
test('camera health counts require coherent source-separated inventory rows',()=>{
  const value=cameraSnapshot([cameraResource(1,'Synthetic Unit 1'),cameraResource(2,'Synthetic Unit 2',{scope:'shop'})]);
  assert.equal(validateCameraHealth(value),value);
  for(const bad of [{...value,offline:1},{...value,rows:[null]},{...value,rows:[]},{...value,online:-1},{...value,refreshedAt:'invalid'}]) assert.throws(()=>validateCameraHealth(bad),/incomplete|reconciled/);
});

import { confirmedItClaim, productionItQueue } from '../src/productionQueueData.ts';
import { permitsTechnicianRequest } from '../src/api.ts';
const queueVisit='11111111-1111-4111-8111-111111111111';
const queueItem={visitId:queueVisit,jobId:'job-a',jobNumber:'FIX-1',customer:'Fixture',site:'Site',visitType:'IT_PREP',scheduledStart:null,scheduledEnd:null,setupNeeded:true,readinessNote:'Physical unit and Tech Check setup needed; ownership can be taken now.',nativeDispatchStatus:'ready',queueStatus:'ready',claimOwnerId:null,claimOwner:null,claimable:true};
test('shared queue validates the current actor, unique visits and coherent ownership',()=>{
  assert.deepEqual(productionItQueue({actorId:'actor-a',items:[queueItem]},'actor-a').items,[queueItem]);
  for(const data of [{actorId:'other',items:[]},{actorId:'actor-a',items:[queueItem,queueItem]},{actorId:'actor-a',items:[{...queueItem,queueStatus:'claimed'}]},{actorId:'actor-a',items:[{...queueItem,claimOwnerId:'other'}]},{actorId:'actor-a',items:[{...queueItem,claimable:'yes'}]}])assert.throws(()=>productionItQueue(data,'actor-a'),/verified/);
});
test('claim requires accepted ownership without inventing native dispatch or setup',()=>{
  const queue={actorId:'actor-a',items:[{...queueItem,queueStatus:'claimed',claimable:false,claimOwnerId:'actor-a',claimOwner:'Fixture IT'}]};
  const day={profile:{department:'it'},visits:[{visit_id:queueVisit,assignment_status:'accepted',dispatch_status:'ready',status:'scheduled'}]};
  assert.equal(confirmedItClaim(queue,day,queueVisit,'actor-a'),true);
  assert.equal(confirmedItClaim(queue,{...day,visits:[]},queueVisit,'actor-a'),false);
  assert.equal(confirmedItClaim(queue,{...day,visits:[{visit_id:queueVisit,dispatch_status:'accepted'}]},queueVisit,'actor-a'),false);
  assert.equal(confirmedItClaim({...queue,items:[{...queue.items[0],claimOwnerId:'other'}]},day,queueVisit,'actor-a'),false);
});
test('technician API only opens one empty-body IT claim write',()=>{
  const claim='/api/tech/it-queue/'+queueVisit+'/claim';
  assert.equal(permitsTechnicianRequest('POST',claim,{}),true);
  assert.equal(permitsTechnicianRequest('GET','/api/tech/it-queue'),true);
  for(const [method,path,body] of [['POST',claim,{actorId:'other'}],['POST',claim,{technician:'Other'}],['POST',claim,[]],['POST','/api/tech/it-queue/not-a-visit/claim',{}],['POST','/api/tech/visits/'+queueVisit,{}],['POST','/api/jobs/'+queueVisit+'/dispatch',{}],['GET','/api/jobs'],['DELETE',claim]])assert.equal(permitsTechnicianRequest(method,path,body),false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { productionDay, productionTasks, productionVisit, queueTime, queueStatus } from '../src/productionQueueData.ts';
import { validateCameraHealth } from '../src/CameraHealthWorkspace.tsx';
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
test('camera health counts require fresh coherent real rows',()=>{
  const value={totalDevices:2,online:1,offline:0,review:0,shopRoot:1,healthRows:1,fieldDevices:1,refreshedAt:'2026-10-04T10:00:00Z',rows:[{id:'camera',name:'Unit camera',status:'online'}]};
  assert.equal(validateCameraHealth(value),value);
  for(const bad of [{...value,offline:1},{...value,rows:[null]},{...value,rows:[]},{...value,online:-1},{...value,refreshedAt:'invalid'}]) assert.throws(()=>validateCameraHealth(bad),/incomplete/);
});

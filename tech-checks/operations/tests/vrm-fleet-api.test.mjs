import test from 'node:test';
import assert from 'node:assert/strict';
import { getVrmFleet } from '../src/vrmFleetApi.ts';
import { readVrmFleetConfig } from '../../supabase/functions/cos-operations-pages/vrm.ts';
const failure=status=>Object.assign(new Error('Synthetic failure'),{response:{status}});
for(const discover of [false,true]){
 const path=discover?'/api/vrm-fleet/refresh':'/api/vrm-fleet';
 test(`${path} prefers the dynamic fleet without a legacy request`,async()=>{
  const calls=[];const expected={data:{items:[],sync:{state:'current'}}};
  const result=await getVrmFleet({get:async value=>{calls.push(value);return expected;}},discover);
  assert.equal(result,expected);assert.deepEqual(calls,[path]);
 });
 test(`${path} falls back once to the old cached route only when absent`,async()=>{
  const calls=[];
  const result=await getVrmFleet({get:async value=>{calls.push(value);if(value===path)throw failure(404);return {data:{items:[]}};}},discover);
  assert.deepEqual(calls,[path,'/api/vrm-portal']);assert.equal(readVrmFleetConfig(result.data).sync.state,'not_configured');
 });
 for(const status of [401,403,429,500,503,undefined])test(`${path} never masks ${status??'network'} errors with legacy data`,async()=>{
  const calls=[];const error=failure(status);
  await assert.rejects(getVrmFleet({get:async value=>{calls.push(value);throw error;}},discover),cause=>cause===error);
  assert.deepEqual(calls,[path]);
 });
 test(`${path} propagates a failed legacy fallback without retry`,async()=>{
  const calls=[];const denied=failure(403);
  await assert.rejects(getVrmFleet({get:async value=>{calls.push(value);if(value===path)throw failure(404);throw denied;}},discover),cause=>cause===denied);
  assert.deepEqual(calls,[path,'/api/vrm-portal']);
 });
}

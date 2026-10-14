/** Generic direct-attempt client contract; no provider or handler source. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixture,MINUTE,refused,unknown,attemptId} from '../lib/fixture.mjs';
import {beginDirectAttempt,completeDirectAttempt} from '../inputs/client/directAttemptClient.ts';
const request=make=>Promise.resolve(make(new AbortController().signal));
const definitive=s=>({health:s.health,history:s.history,device:s.device});
async function scenario(run){const f=await createFixture({syntheticClock:true});try{
 const device=await f.device(),binding=await f.binding();
 const candidate={device,master:binding.master,host:device.public_ip,ports:device.expected_ports,key:device.unit_key};
 return await run(f,candidate);
}finally{await f.close();}}
function intercept(f,fn){return {rpc(name,args){assert.equal(name,'publish_camera_connection_v1');const q={abortSignal(){return q;},then(resolve,reject){return Promise.resolve().then(()=>fn(args,()=>f.rpc(args))).then(resolve,reject);}};return q;}};}

test('uncertain committed registration gives the client no ticket for transport',()=>scenario(async(f,c)=>{
 const db=intercept(f,async(args,deliver)=>{await deliver();throw Error('synthetic lost committed registration response');});
 assert.equal(await beginDirectAttempt(db,c,'automatic_tcp_sweep',request,()=>attemptId(9001)),null);
 const snapshot=await f.snapshot();assert.equal(snapshot.receipts.length,1);assert.equal(snapshot.state[0].phase,'pending');assert.equal(snapshot.health,null);
 assert.deepEqual(f.calls.map(a=>a.p_health.direct_attempt.op),['begin']);
}));

test('uncertain uncommitted registration gives no ticket and creates no receipt',()=>scenario(async(f,c)=>{
 const db=intercept(f,async()=>{throw Error('synthetic request lost before execution');});
 assert.equal(await beginDirectAttempt(db,c,'automatic_tcp_sweep',request,()=>attemptId(9002)),null);
 const snapshot=await f.snapshot();assert.equal(snapshot.receipts.length,0);assert.equal(snapshot.state.length,0);assert.equal(snapshot.health,null);
}));

test('committed completion response loss resolves through the same receipt without redating',()=>scenario(async(f,c)=>{
 const calls=[],db=intercept(f,async(args,deliver)=>{calls.push(structuredClone(args));const data=await deliver();
  if(args.p_health.direct_attempt.op==='complete'){await f.advance(MINUTE);throw Error('synthetic lost committed completion response');}
  return {data,error:null};
 });
 const ticket=await beginDirectAttempt(db,c,'automatic_tcp_sweep',request,()=>attemptId(9003));assert.ok(ticket);
 const frozen={completed_at:new Date(f.now).toISOString(),ports:[refused()]};
 const result=await completeDirectAttempt(db,ticket,frozen,request);assert.ok(result);assert.equal(result.health_published,true);
 assert.equal(Date.parse(result.completed_at),Date.parse(frozen.completed_at));assert.equal(Date.parse((await f.snapshot()).health.checked_at),Date.parse(frozen.completed_at));
 assert.deepEqual(calls.map(a=>a.p_health.direct_attempt.op),['begin','complete','read']);
 assert.equal(calls[1].p_health.direct_attempt.result.completed_at,frozen.completed_at);
}));

test('uncommitted completion loss reads pending once without retrying completion',()=>scenario(async(f,c)=>{
 const calls=[],db=intercept(f,async(args,deliver)=>{const op=args.p_health.direct_attempt.op;calls.push(op);
  if(op==='complete')throw Error('synthetic completion never reached database');return {data:await deliver(),error:null};
 });
 const ticket=await beginDirectAttempt(db,c,'automatic_tcp_sweep',request,()=>attemptId(9004));assert.ok(ticket);
 assert.equal(await completeDirectAttempt(db,ticket,{completed_at:new Date(f.now).toISOString(),ports:[refused()]},request),null);
 assert.deepEqual(calls,['begin','complete','read']);const snapshot=await f.snapshot();assert.equal(snapshot.state[0].phase,'pending');assert.equal(snapshot.health,null);
}));

test('client and SQL together preserve R/R/U/R as Verifying1 and preserve definitive evidence through U',()=>scenario(async(f,c)=>{
 const results=[];let beforeUnknown;
 for(const [index,ports] of [[0,[refused()]],[1,[refused()]],[2,[unknown()]],[3,[refused()]]]){
  if(index)await f.advance(MINUTE);if(index===2)beforeUnknown=definitive(await f.snapshot());
  const ticket=await beginDirectAttempt(f.facade,c,'automatic_tcp_sweep',request,()=>attemptId(9010+index));assert.ok(ticket);
  const result=await completeDirectAttempt(f.facade,ticket,{completed_at:new Date(f.now).toISOString(),ports},request);assert.ok(result);results.push(result);
  if(index===2)assert.deepEqual(definitive(await f.snapshot()),beforeUnknown);
 }
 assert.deepEqual(results.map(r=>r.consecutive_failures),[1,2,0,1]);assert.equal(results[2].health_published,false);
 assert.equal(results[3].status,'verifying');assert.equal((await f.snapshot()).health.confirmed_outage,false);
}));

import test from 'node:test';
import assert from 'node:assert/strict';
import {createMhelpRequestBudget,mhelpRequestClass} from '../../supabase/functions/cos-operations-pages/mhelpRequestBudget.ts';
const data='https://connect.mhelpdesk.com/api/v1.0/portal/224643/equipment',token='https://login.mhelpdesk.com/connect/token';
test('allowlist distinguishes essential calls without intercepting other services',()=>{
 assert.equal(mhelpRequestClass(data),'data');assert.equal(mhelpRequestClass(token),'essential');assert.equal(mhelpRequestClass('https://connect.mhelpdesk.com/api/v1.0/users/me'),'essential');
 for(const url of ['https://other.invalid/','https://connect.mhelpdesk.com.evil/api/v1.0/x','http://connect.mhelpdesk.com/api/v1.0/x','https://user@connect.mhelpdesk.com/api/v1.0/x','https://connect.mhelpdesk.com:444/api/v1.0/x'])assert.equal(mhelpRequestClass(url),null);
});
test('every page, retry and separate worker obtains a separate durable permission',async()=>{
 const admissions=[],starts=[];const options={admit:async essential=>{admissions.push(essential);return{allowed:true,reason:null,retryAt:null};},fetch:async u=>{starts.push(String(u));return Response.json({});}};
 const a=createMhelpRequestBudget(options),b=createMhelpRequestBudget(options);
 await Promise.all([a.fetch(data),a.fetch(data+'?page=2'),b.fetch(data),b.fetch(token),a.fetch('https://connect.mhelpdesk.com/api/v1.0/users/me')]);
 assert.equal(starts.length,5);assert.deepEqual(admissions.sort(),[false,false,false,true,true]);
 await a.fetch(data);assert.equal(admissions.length,6);
});
test('provider and local holds make no network request and do not leak diagnostics',async()=>{
 for(const reason of ['provider_wait','daily_budget','usage_not_yet_measured']){
  let calls=0;const b=createMhelpRequestBudget({now:()=>0,admit:async()=>({allowed:false,reason,retryAt:'1970-01-02T00:00:00Z'}),fetch:async()=>{calls++;throw Error('private');}});
  const r=await b.fetch(data);assert.equal(calls,0);assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'86400');assert.equal(r.headers.get('X-COS-Mhelp-Deferred'),'1');assert.equal(r.headers.get('X-COS-Mhelp-Budget'),'1');assert(!await r.text().then(s=>s.includes(reason)));
 }
});
test('pacing waits then re-admits rather than reusing a reservation',async()=>{
 let now=0,admissions=0,starts=0;const waits=[];
 const b=createMhelpRequestBudget({now:()=>now,wait:async ms=>{waits.push(ms);now+=ms;},admit:async()=>++admissions===1?{allowed:false,reason:'pacing',retryAt:new Date(400).toISOString()}:{allowed:true,reason:null,retryAt:null},fetch:async()=>{starts++;return new Response();}});
 await b.fetch(data);assert.equal(admissions,2);assert.deepEqual(waits,[400]);assert.equal(starts,1);
});
test('malformed or unavailable accounting fails closed, including a lost admission acknowledgment',async()=>{
 for(const value of [null,{},[],{allowed:true},{allowed:true,reason:null,retryAt:null,extra:'private'},{allowed:false,reason:'unknown',retryAt:'2026-01-01'},{allowed:false,reason:'pacing',retryAt:'invalid'}]){
  let starts=0;const b=createMhelpRequestBudget({admit:async()=>value,fetch:async()=>{starts++;return new Response();}});
  await assert.rejects(b.fetch(data),/allowance unavailable/);assert.equal(starts,0);
 }
 let starts=0;const b=createMhelpRequestBudget({admit:async()=>{throw Error('lost acknowledgment');},fetch:async()=>{starts++;return new Response();}});await assert.rejects(b.fetch(data));assert.equal(starts,0);
});
test('cancellation before and after admission never starts a request',async()=>{
 for(const after of [false,true]){
  const c=new AbortController();let calls=0,admissions=0;if(!after)c.abort();
  const b=createMhelpRequestBudget({admit:async()=>{admissions++;c.abort();return{allowed:true,reason:null,retryAt:null};},fetch:async()=>{calls++;return new Response();}});
  await assert.rejects(b.fetch(data,{signal:c.signal}),/canceled/);assert.equal(calls,0);assert.equal(admissions,after?1:0);
 }
});
test('nonvendor requests do not debit the mHelp allowance',async()=>{
 let calls=0;const b=createMhelpRequestBudget({admit:async()=>{throw Error();},fetch:async()=>{calls++;return new Response();}});await b.fetch('https://tughscoxralhofrckvxy.supabase.co/rest/v1/rpc/example');assert.equal(calls,1);
});

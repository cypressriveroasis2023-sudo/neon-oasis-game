import test from 'node:test';
import assert from 'node:assert/strict';
import {createMhelpIntakeReviewBridge,MhelpIntakeReviewError} from '../../supabase/functions/cos-operations-pages/mhelpIntakeReviewBridge.ts';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
const owner='e4abc521-1ef3-45a6-9829-b87faff78210',actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const status=()=>({contract:'cos-mhelp-intake-review-v1',enabled:false,activationAt:null,pendingReviewCount:0,createdCount:0,lastAttemptAt:null,lastSuccessAt:null,failureCount:0,retryAfter:null,lastErrorCode:null,held:[],heldTruncated:false});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
function fixture(change={}){
 const calls=[];
 const handler=createOperationsHandler({platformUrl:'https://native.example',serviceKey:'synthetic-native-secret',fetch:async(url,init={})=>{
 calls.push({url,init});
 if(url.includes('/auth/v1/user'))return json({id:change.unmapped?'22222222-2222-2222-2222-222222222222':owner},change.invalid?401:200);
 if(url.includes('/rest/v1/profiles?'))return json([{user_id:change.unmapped?'22222222-2222-2222-2222-222222222222':owner,role:change.role||'owner',active:!change.inactive,archived_at:null}]);
 if(url.includes('/rest/v1/user_profiles?'))return json([{user_id:actor,department:'owner',active:true}]);
 if(url.includes('/rest/v1/user_roles?'))return json([{roles:{code:'owner',organization_id:org}}]);
 if(url.endsWith('/functions/v1/camera-mhelp-ticket-intake'))return json(change.body??status(),change.backendStatus??200);
 throw Error('Unexpected request');}});
 const invoke=(body={},method='GET',origin='https://cos-vision-integration-preview.pages.dev',path='/api/mhelpdesk/intake/status',query='')=>handler(new Request('https://native.example/functions/v1/cos-operations-pages'+query,{method:'POST',headers:{Origin:origin,Authorization:'Bearer synthetic-owner-session','Content-Type':'application/json'},body:JSON.stringify({path,method,body})}));
 return {calls,invoke,handler};
}
test('Owner saved-status route forwards only the original legacy session and a fixed read action',async()=>{
 const f=fixture(),r=await f.invoke();assert.equal(r.status,200);assert.deepEqual(await r.json(),status());
 const forwarded=f.calls.filter(x=>x.url.endsWith('/functions/v1/camera-mhelp-ticket-intake'));assert.equal(forwarded.length,1);
 assert.equal(forwarded[0].init.headers.Authorization,'Bearer synthetic-owner-session');assert.equal(forwarded[0].init.headers['x-camera-cron-secret'],undefined);
 assert(!JSON.stringify(forwarded).includes('synthetic-native-secret'));assert.equal(forwarded[0].init.body,'{"action":"review_status"}');
 assert.equal(forwarded[0].init.redirect,'error');assert.equal(forwarded[0].init.cache,'no-store');assert(!f.calls.some(x=>x.url.includes('mhelpdesk.com')||x.url.includes('/rpc/')));
});
test('Owner bridge rejects non-Owner/inactive/unlinked/invalid and caller scope before the saved-status read',async()=>{
 for(const change of [{role:'it'},{role:'service'},{inactive:true},{unmapped:true},{invalid:true}]){const f=fixture(change),r=await f.invoke();assert([401,403].includes(r.status));assert(!f.calls.some(x=>x.url.endsWith('/camera-mhelp-ticket-intake')));}
 for(const body of [{action:'run'},{portalId:'1'},{token:'private'},{url:'https://other.invalid'},{ticketNumber:'1'}]){const f=fixture();assert.equal((await f.invoke(body)).status,400);assert(!f.calls.some(x=>x.url.endsWith('/camera-mhelp-ticket-intake')));}
 const f=fixture();assert.equal((await f.invoke({},'POST')).status,405);assert.equal((await f.invoke({},'GET','https://other.invalid')).status,403);
});
test('private backend error text and malformed saved states never reach the Owner',async()=>{
 for(const change of [{backendStatus:503,body:{error:'private-secret'}},{backendStatus:403,body:{error:'private-secret'}},{body:{...status(),secret:'private-secret'}},{body:{...status(),held:[{ticketNumber:'contact@example.invalid',reasonCodes:[]}]}}]){
 const f=fixture(change),r=await f.invoke();assert([403,503].includes(r.status));const body=await r.json();assert(!JSON.stringify(body).includes('private-secret'));assert(!JSON.stringify(body).includes('contact@example.invalid'));assert(!('pendingReviewCount' in body));}
});
test('saved-status bridge bounds streams, rejects malformed credentials and sanitizes transport errors',async()=>{
 let calls=0;const bridge=createMhelpIntakeReviewBridge(async()=>{calls++;throw Error('private-secret');});
 await assert.rejects(bridge('malformed'),e=>e instanceof MhelpIntakeReviewError&&e.status===403);assert.equal(calls,0);
 await assert.rejects(bridge('Bearer synthetic-owner'),e=>!e.message.includes('private-secret'));
 for(const response of [new Response('x'.repeat(65537)),new Response('{}',{headers:{'Content-Length':'65537'}}),new Response('{private-secret')])await assert.rejects(createMhelpIntakeReviewBridge(async()=>response)('Bearer synthetic-owner'),MhelpIntakeReviewError);
});

const pending=()=>({contract:'cos-mhelp-pending-status-v1',waitingCount:1,dueCount:0,oldestWaitingCreatedAt:'2026-10-10T00:00:00.000Z',lastRefreshAt:null,lastRefreshState:null,lastRefreshCode:null});
const extended=()=>({contract:'cos-mhelp-intake-status-pending-v1',review:status(),pendingSchedule:pending()});
const capabilityPath='/api/mhelpdesk/intake/status?capability=pending_schedule_v1';
test('explicit capability remains genuine linked Owner-only and sends only a fixed saved evidence request',async()=>{
 for(const body of [extended(),{...extended(),pendingSchedule:null},status()]){
  const f=fixture({body}),r=await f.invoke({},'GET',undefined,capabilityPath);assert.equal(r.status,200);assert.deepEqual(await r.json(),body);
  const forwarded=f.calls.filter(x=>x.url.endsWith('/functions/v1/camera-mhelp-ticket-intake'));assert.equal(forwarded.length,1);
  assert.equal(forwarded[0].init.body,'{"action":"review_status","evidenceCapability":"pending_schedule_v1"}');
  assert.equal(forwarded[0].init.headers.Authorization,'Bearer synthetic-owner-session');assert(!JSON.stringify(forwarded).includes('synthetic-native-secret'));
  assert(!f.calls.some(x=>x.url.includes('mhelpdesk.com')||x.url.includes('/rpc/')));
 }
 for(const change of [{role:'it'},{role:'service'},{inactive:true},{unmapped:true},{invalid:true}]){const f=fixture(change),r=await f.invoke({},'GET',undefined,capabilityPath);assert([401,403].includes(r.status));assert(!f.calls.some(x=>x.url.endsWith('/camera-mhelp-ticket-intake')));}
});
test('status capability query rejects unknown, duplicate and caller-selected scope in both transports',async()=>{
 const suffixes=['?capability=other','?capability=','?portalId=17','?capability=pending_schedule_v1&portalId=17','?capability=pending_schedule_v1&capability=pending_schedule_v1','?evidenceCapability=pending_schedule_v1','?capability=pending_schedule_v1#scope'];
 for(const suffix of suffixes){const f=fixture();assert.equal((await f.invoke({},'GET',undefined,'/api/mhelpdesk/intake/status'+suffix)).status,404);assert(!f.calls.some(x=>x.url.endsWith('/camera-mhelp-ticket-intake')));}
 for(const suffix of suffixes.slice(0,-1)){const f=fixture();const r=await f.handler(new Request('https://native.example/functions/v1/cos-operations-pages/api/mhelpdesk/intake/status'+suffix,{headers:{Authorization:'Bearer synthetic-owner-session'}}));assert.equal(r.status,400);assert(!f.calls.some(x=>x.url.endsWith('/camera-mhelp-ticket-intake')));}
 for(const body of [{capability:'pending_schedule_v1'},{evidenceCapability:'pending_schedule_v1'},{action:'review_status'},{ticketId:'17'},{run:true}]){const f=fixture();assert.equal((await f.invoke(body,'GET',undefined,capabilityPath)).status,400);assert(!f.calls.some(x=>x.url.endsWith('/camera-mhelp-ticket-intake')));}
 const duplicate=fixture();assert.equal((await duplicate.invoke({},'GET',undefined,capabilityPath,'?capability=pending_schedule_v1')).status,400);
 const post=fixture();assert.equal((await post.invoke({},'POST',undefined,capabilityPath)).status,404);
 const direct=fixture({body:extended()}),r=await direct.handler(new Request('https://native.example/functions/v1/cos-operations-pages'+capabilityPath,{headers:{Authorization:'Bearer synthetic-owner-session'}}));assert.equal(r.status,200);assert.deepEqual(await r.json(),extended());
});
test('opt-in malformed pending evidence never leaks arbitrary fields or errors',async()=>{
 for(const body of [{...extended(),pendingSchedule:{...pending(),private:'PRIVATE'}},{...extended(),pendingSchedule:{...pending(),lastRefreshCode:'PRIVATE'}},{...extended(),private:'PRIVATE'}]){const f=fixture({body}),r=await f.invoke({},'GET',undefined,capabilityPath);assert.equal(r.status,503);assert(!(await r.text()).includes('PRIVATE'));}
 const unsolicited=fixture({body:extended()});assert.equal((await unsolicited.invoke()).status,503);
});
const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
const bounded=promise=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('read did not settle')),1000))]);
test('status bridge bounds ignored abort, disposes late responses and permits the next read',async()=>{
 let resolveFetch,cancelled=0,calls=0;const bridge=createMhelpIntakeReviewBridge(async()=>{calls++;if(calls===1)return new Promise(resolve=>resolveFetch=resolve);return json(status());});
 const controller=new AbortController(),waiting=bridge('Bearer synthetic-owner',controller.signal,'pending_schedule_v1');controller.abort();await assert.rejects(bounded(waiting),MhelpIntakeReviewError);
 resolveFetch(new Response(new ReadableStream({cancel(){cancelled++;return new Promise(()=>{});}})));await turn();assert.equal(cancelled,1);
 assert.deepEqual(await bridge('Bearer synthetic-owner'),status());
 const already=new AbortController();already.abort();await assert.rejects(bridge('Bearer synthetic-owner',already.signal),MhelpIntakeReviewError);assert.equal(calls,2);
});
test('status stream cancellation can hang or throw without blocking a redacted response',async()=>{
 for(const mode of ['hang','throw']){
  const cancel=()=>{if(mode==='throw')throw Error('PRIVATE');return new Promise(()=>{});};
  const response=new Response(new ReadableStream({cancel}),{status:503});await assert.rejects(bounded(createMhelpIntakeReviewBridge(async()=>response)('Bearer synthetic-owner')),MhelpIntakeReviewError);
  let readStarted=false;const controller=new AbortController(),stream=new ReadableStream({pull(){readStarted=true;return new Promise(()=>{});},cancel});
  const waiting=createMhelpIntakeReviewBridge(async()=>new Response(stream))('Bearer synthetic-owner',controller.signal);await turn();assert(readStarted);controller.abort();await assert.rejects(bounded(waiting),MhelpIntakeReviewError);
 }
});

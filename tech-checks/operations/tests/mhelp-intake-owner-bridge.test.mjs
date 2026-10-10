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
 const invoke=(body={},method='GET',origin='https://cos-vision-integration-preview.pages.dev')=>handler(new Request('https://native.example/functions/v1/cos-operations-pages',{method:'POST',headers:{Origin:origin,Authorization:'Bearer synthetic-owner-session','Content-Type':'application/json'},body:JSON.stringify({path:'/api/mhelpdesk/intake/status',method,body})}));
 return {calls,invoke};
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

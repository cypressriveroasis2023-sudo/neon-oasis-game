import test from 'node:test';
import assert from 'node:assert/strict';
import {createMhelpReadinessHandler,projectReadiness,TicketReadinessError} from '../../supabase/functions/cos-mhelp-readiness/index.ts';
import {createCameraMhelpReadinessHandler} from '../../supabase/functions/camera-mhelp-readiness/index.ts';
import {MhelpPartnerError} from '../../supabase/functions/cos-operations-pages/mhelpPartner.ts';
const key='ab'.repeat(32),contract='cos-mhelpdesk-partner-review-v1';
const request=(body={action:'status'})=>new Request('https://synthetic.invalid/check',{method:'POST',headers:{'Content-Type':'application/json','x-cos-mhelp-read-key':key,'x-camera-cron-secret':'synthetic-only'},body:JSON.stringify(body)});
const status={contract,state:'ready_to_test',tokenConfigured:true,portalConfigured:false,liveAccessVerified:false,automaticSync:false};
test('native readiness requires existing server authentication before configuration reads',async()=>{
 let called=false;const h=createMhelpReadinessHandler({authenticate:()=>false,partner:async()=>{called=true;throw Error('must not read')}});
 assert.equal((await h(request())).status,403);assert.equal(called,false);
});
test('readiness accepts only fixed actions and bounded JSON; caller actor, URL, credentials and filters are rejected',async()=>{
 const calls=[];const h=createMhelpReadinessHandler({authenticate:()=>true,partner:async(...args)=>{calls.push(args);return status}});
 for(const b of [{action:'sync'},{action:'status',actorId:'owner'},{action:'preview',token:'synthetic'},[],{action:'status',url:'https://attacker.invalid'}])assert.equal((await h(request(b))).status,400);
 assert.equal((await h(request({action:'x'.repeat(5000)}))).status,400);
 assert.equal((await h(request())).status,200);assert.deepEqual(calls,[['/api/mhelpdesk/partner/status','GET',{}]]);
});
test('a successful preview publishes counts only and discards labels, identities, customers and credentials',()=>{
 const output=projectReadiness({...status,state:'preview_verified',liveAccessVerified:true,verifiedPortalId:'224643',totalRows:120,partial:true,password:'synthetic-private',items:[{name:'private-name',customerId:'private-id',identity:{state:'review_needed',nativeUnitId:'private-native'}}]});
 assert.equal(output.previewCount,1);assert.equal(output.identities.review_needed,1);assert.equal(output.partial,true);assert(!JSON.stringify(output).includes('private'));assert(!Object.hasOwn(output,'items'));
 assert.throws(()=>projectReadiness({...status,liveAccessVerified:true,items:[]}));
});
test('native failures never echo unknown errors or credentials',async()=>{
 const h=createMhelpReadinessHandler({authenticate:()=>true,partner:async()=>{throw Error('synthetic-private-token')}});const r=await h(request({action:'preview'}));assert.equal(r.status,503);assert(!(await r.text()).includes('synthetic-private'));
 const denied=createMhelpReadinessHandler({authenticate:()=>true,partner:async()=>{throw new MhelpPartnerError('mHelpDesk denied API access. Verify the token, portal, and Partner API approval.')}});
 assert.equal((await denied(request({action:'preview'}))).status,503);
});
test('full maintenance requires a complete scan and returns only counts and configuration booleans',async()=>{
 const items=Array.from({length:51},()=>({name:'synthetic-private-name',identity:{state:'review_needed',candidateUnitIds:['synthetic-private-id']}}));
 const full={...status,state:'preview_verified',liveAccessVerified:true,verifiedPortalId:'224643',totalRows:51,partial:false,items};
 assert.throws(()=>projectReadiness(full));assert.throws(()=>projectReadiness({...full,partial:true},true));
 const h=createMhelpReadinessHandler({authenticate:()=>true,partner:async()=>{throw Error('not used')},fullReview:async()=>full,renewalConfiguration:()=>({refreshTokenConfigured:true,clientIdConfigured:false,clientSecretConfigured:false,password:'synthetic-private-token'})});
 const result=await (await h(request({action:'full_review'}))).json();assert.equal(result.fullReview,true);assert.equal(result.previewCount,51);assert.equal(result.labelCandidates.single,51);
 assert.deepEqual(result.renewalConfiguration,{refreshTokenConfigured:true,clientIdConfigured:false,clientSecretConfigured:false});assert(!JSON.stringify(result).includes('synthetic-private'));
});
test('maintenance exposes only the failed provider operation and HTTP status, with no provider body or URL',async()=>{
 const h=createMhelpReadinessHandler({authenticate:()=>true,partner:async()=>{throw new MhelpPartnerError('mHelpDesk could not complete the account or equipment read. Retry later.',503,{operation:'equipment_read',httpStatus:500,body:'synthetic-private'});}});
 const result=await (await h(request({action:'preview'}))).json();assert.deepEqual(result.provider,{operation:'equipment_read',httpStatus:500});assert(!JSON.stringify(result).includes('synthetic-private'));
});
test('credential introspection validates the existing camera cron before answering',async()=>{
 let calls=0;const h=createCameraMhelpReadinessHandler({verifyCron:async candidate=>{calls++;assert.equal(candidate,'synthetic-only');return false}});
 assert.equal((await h(request({action:'authenticate'}))).status,403);assert.equal(calls,1);
});
test('credential introspection returns one boolean and rejects alternate actions or caller fields',async()=>{
 const h=createCameraMhelpReadinessHandler({verifyCron:async()=>true});
 assert.deepEqual(await (await h(request({action:'authenticate'}))).json(),{authenticated:true});
 for(const b of [{action:'status'},{action:'preview'},{action:'authenticate',actor:'owner'},[],{action:'authenticate',key:'x'.repeat(500)}])assert.equal((await h(request(b))).status,400);
 const failed=createCameraMhelpReadinessHandler({verifyCron:async()=>{throw Error('synthetic-private-key')}});const r=await failed(request({action:'authenticate'}));assert.equal(r.status,403);assert(!(await r.text()).includes('synthetic-private'));
});

test('ticket preview reuses existing maintenance auth and accepts only a bounded explicit UTC creation window',async()=>{
 const window={createdAfter:'2026-10-09T00:00:00Z',createdBefore:'2026-10-10T00:00:00Z'},calls=[];
 const h=createMhelpReadinessHandler({authenticate:()=>true,partner:async()=>{throw Error('equipment must not be called')},ticketPreview:async input=>{calls.push(input);return {contract:'synthetic-aggregate',totalRows:4}}});
 assert.equal((await h(request({action:'ticket_preview',...window}))).status,200);assert.deepEqual(calls,[window]);
 for(const body of [{action:'ticket_preview'},{action:'ticket_preview',...window,token:'private'},{action:'ticket_preview',...window,url:'https://other.invalid'},{action:'ticket_preview',...window,createdAfter:'2026-10-09'},{action:'ticket_preview',...window,createdBefore:'2026-11-10T00:00:00Z'},{action:'ticket_preview',...window,createdBefore:window.createdAfter}])assert.equal((await h(request(body))).status,400);
 assert.equal(calls.length,1);
 const denied=createMhelpReadinessHandler({authenticate:()=>false,partner:async()=>status,ticketPreview:async()=>{throw Error('must not read ticket config')}});
 assert.equal((await denied(request({action:'ticket_preview',...window}))).status,403);
 const failure=createMhelpReadinessHandler({authenticate:()=>true,partner:async()=>status,ticketPreview:async()=>{throw Error('synthetic-private-ticket-payload')}});
 const response=await failure(request({action:'ticket_preview',...window}));assert.equal(response.status,503);assert(!(await response.text()).includes('synthetic-private'));
});

test('ticket maintenance waits for authentication and denies before reading the body or any data',async()=>{
 let release,called=false;const auth=new Promise(resolve=>{release=resolve});
 const h=createMhelpReadinessHandler({authenticate:()=>auth,partner:async()=>{called=true;throw Error('must not read')},ticketPreview:async()=>{called=true;throw Error('must not read')}});
 const req=request({action:'ticket_preview',createdAfter:'2026-10-09T00:00:00Z',createdBefore:'2026-10-10T00:00:00Z'}),pending=h(req);
 await Promise.resolve();assert.equal(called,false);assert.equal(req.bodyUsed,false);release(false);
 assert.equal((await pending).status,403);assert.equal(called,false);assert.equal(req.bodyUsed,false);
 const failed=createMhelpReadinessHandler({authenticate:()=>{throw Error('synthetic-private-auth')},partner:async()=>{called=true;return status}});
 const r=await failed(request({action:'ticket_preview'}));assert.equal(r.status,403);assert.equal(called,false);assert(!(await r.text()).includes('synthetic-private'));
});

test('ticket maintenance rejects impossible UTC calendar dates and non-UTC/normalized timestamps before the reader',async()=>{
 let reads=0;const h=createMhelpReadinessHandler({authenticate:()=>true,partner:async()=>status,ticketPreview:async()=>{reads++;return {}}});
 for(const createdAfter of ['2026-02-30T00:00:00Z','2026-02-29T00:00:00Z','2026-10-09T24:00:00Z','2026-10-09T23:60:00Z','2026-10-09T00:00:60Z','2026-10-09T00:00:00+00:00','2026-10-09T00:00:00.0000001Z']){
  const r=await h(request({action:'ticket_preview',createdAfter,createdBefore:'2026-10-10T00:00:00Z'}));assert.equal(r.status,400,createdAfter);
 }
 assert.equal(reads,0);
 const unavailable=createMhelpReadinessHandler({authenticate:()=>true,partner:async()=>{throw Error('must not fall back to equipment')}});
 assert.equal((await unavailable(request({action:'ticket_preview',createdAfter:'2026-10-09T00:00:00Z',createdBefore:'2026-10-10T00:00:00Z'}))).status,503);
});

test('trusted ticket errors expose only a sanitized message, status and allowlisted provider diagnostic',async()=>{
 const body={action:'ticket_preview',createdAfter:'2026-10-09T00:00:00Z',createdBefore:'2026-10-10T00:00:00Z'};
 for(const operation of ['account_read','ticket_read','ticket_types_read','ticket_statuses_read']){
  const h=createMhelpReadinessHandler({authenticate:()=>true,partner:async()=>status,ticketPreview:async()=>{throw new TicketReadinessError('mHelpDesk is limiting ticket reads. Retry later.',429,{operation,httpStatus:429,body:'synthetic-private',url:'synthetic-private-url',headers:{Authorization:'synthetic-private'}})}});
  const response=await h(request(body)),result=await response.json();assert.equal(response.status,429);
  assert.deepEqual(result,{error:'mHelpDesk is limiting ticket reads. Retry later.',provider:{operation,httpStatus:429}});assert(!JSON.stringify(result).includes('synthetic-private'));
 }
 for(const provider of [{operation:'synthetic-private',httpStatus:500},{operation:'ticket_read',httpStatus:600},{operation:'ticket_read',httpStatus:0},{operation:'ticket_read',httpStatus:429.5}]){
  const h=createMhelpReadinessHandler({authenticate:()=>true,partner:async()=>status,ticketPreview:async()=>{throw new TicketReadinessError('Ticket preview unavailable',503,provider)}});
  assert.deepEqual(await (await h(request(body))).json(),{error:'Ticket preview unavailable'});
 }
 const unknown=createMhelpReadinessHandler({authenticate:()=>true,partner:async()=>status,ticketPreview:async()=>{throw {name:'TicketReadinessError',message:'synthetic-private',status:429,provider:{operation:'ticket_read',httpStatus:429}}}});
 const response=await unknown(request(body));assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'mHelpDesk readiness is unavailable'});
});

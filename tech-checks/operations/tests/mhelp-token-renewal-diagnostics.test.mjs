import test from 'node:test';
import assert from 'node:assert/strict';
import {createMhelpTokenManager,MhelpTokenRenewalError,projectMhelpTokenRenewalDiagnostic} from '../../supabase/functions/cos-operations-pages/mhelpTokenSession.ts';
import {createMhelpTicketReader,MhelpTicketError} from '../../supabase/functions/cos-operations-pages/mhelpTickets.ts';
import {mhelpTicketDiagnostic} from '../../supabase/functions/cos-operations-pages/mhelpTicketDiagnostics.ts';
const secret='synthetic-credential-never-export',portal='17',lease='00000000-0000-4000-8000-000000000001';
const json=(body,status=400)=>new Response(JSON.stringify(body),{status,statusText:secret,headers:{'Content-Type':'application/json','X-Private':secret}});
function fixture(respond){
 const actions=[];let tokenRequests=0;
 const manager=createMhelpTokenManager({getConfig:()=>({clientId:secret+'-client',clientSecret:secret+'-secret'}),session:async body=>{
  actions.push(body.p_action);
  if(body.p_action==='read')return {configured:true,access_token:secret,portal_id:portal};
  if(body.p_action==='claim')return {configured:true,refresh_token:secret+'-refresh',portal_id:portal,lease_id:lease};
  if(body.p_action==='release')return {released:true};
  throw Error(secret);
 },fetch:async(url,init)=>{
  assert.equal(url,'https://login.mhelpdesk.com/connect/token');assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
  const form=new URLSearchParams(init.body);assert.equal(form.get('scope'),'openid profile offline_access mhdapi');assert.equal(form.get('refresh_token'),secret+'-refresh');
  tokenRequests++;return respond(init);
 }});
 return {manager,actions,requests:()=>tokenRequests};
}
function safe(error,expected){
 assert(error instanceof MhelpTokenRenewalError);assert.equal(error.message,'mHelpDesk secure token renewal is unavailable');
 assert.deepEqual(error.diagnostic,expected);assert.deepEqual(Object.keys(error.diagnostic).sort(),['httpStatus','oauthError','reason','stage']);
 assert(!JSON.stringify(error).includes(secret));assert.equal(error.cause,undefined);
 return true;
}
const responseDiagnostic=(reason,httpStatus,oauthError=null)=>({stage:'token_response',reason,httpStatus,oauthError});
test('OAuth rejection retains only six exact RFC error names and preserves single-flight/release',async()=>{
 for(const code of ['invalid_request','invalid_client','invalid_grant','unauthorized_client','unsupported_grant_type','invalid_scope']){
  const status=code==='invalid_client'?401:400;
  const f=fixture(()=>json({error:code,error_description:secret,error_uri:'https://private.invalid/'+secret,access_token:secret,refresh_token:secret},status));
  const [a,b]=await Promise.allSettled([f.manager.renewAccess(),f.manager.renewAccess()]);
  assert.equal(a.status,'rejected');assert.equal(b.status,'rejected');assert.equal(a.reason,b.reason);
  safe(a.reason,responseDiagnostic('http_error',status,code));assert.equal(f.requests(),1);assert.deepEqual(f.actions,['read','claim','release']);
 }
});
test('unknown or credential-shaped OAuth names and source metadata are discarded without coercion',async()=>{
 for(const error of [secret,'invalid_grant '+secret,'INVALID_GRANT',{value:'invalid_grant'},['invalid_client'],null,404]){
  const f=fixture(()=>json({error,error_description:secret,error_uri:secret,headers:{Authorization:secret},body:secret},403));
  await assert.rejects(f.manager.renewAccess(),e=>safe(e,responseDiagnostic('http_error',403)));
  assert.equal(f.requests(),1);assert.deepEqual(f.actions,['read','claim','release']);
 }
});
test('POST transport exceptions and deadline discard caught messages, causes, stacks and request data',async t=>{
 const f=fixture(()=>{throw Object.assign(Error(secret,{cause:secret}),{body:secret,headers:{Authorization:secret},url:secret});});
 await assert.rejects(f.manager.renewAccess(),e=>safe(e,{stage:'token_request',reason:'transport_failed',httpStatus:null,oauthError:null}));
 const original=setTimeout;t.mock.method(globalThis,'setTimeout',(fn,delay,...args)=>original(fn,delay===45000?1:delay,...args));
 const expired=fixture(({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error(secret)),{once:true})));
 await assert.rejects(expired.manager.renewAccess(),e=>safe(e,{stage:'token_request',reason:'deadline',httpStatus:null,oauthError:null}));
 assert.deepEqual(expired.actions,['read','claim','release']);
});
test('bounded error parsing distinguishes missing, oversized and invalid responses without reflecting bodies',async()=>{
 for(const [respond,reason,status] of [
  [()=>new Response(null,{status:503}),'response_missing',503],
  [()=>new Response(secret,{status:400}),'response_invalid',400],
  [()=>json([secret],400),'response_invalid',400],
  [()=>json(null,200),'response_invalid',200],
  [()=>new Response(new Uint8Array([0xff,0xfe]),{status:502}),'response_invalid',502],
  [()=>new Response(secret,{status:400,headers:{'Content-Length':'32769'}}),'response_too_large',400],
  [()=>new Response(JSON.stringify({error:'invalid_grant',error_description:secret.repeat(1500)}),{status:400}),'response_too_large',400],
  [()=>new Response(new ReadableStream({start(c){c.error(Error(secret));}}),{status:200}),'response_invalid',200],
 ]){
  const f=fixture(respond);await assert.rejects(f.manager.renewAccess(),e=>safe(e,responseDiagnostic(reason,status)));
  assert.equal(f.requests(),1);assert.deepEqual(f.actions,['read','claim','release']);
 }
});
test('renewal POST diagnostics pass through existing reader category into only the allowlisted log object',async()=>{
 const f=fixture(()=>json({error:'invalid_grant',error_description:secret},400));
 const reader=createMhelpTicketReader({getConfig:f.manager.getPartnerConfig,renewAccess:f.manager.renewAccess,fetch:async()=>json({private:secret},401)});
 await assert.rejects(reader.preview({createdAfter:'2026-10-10T05:00:00Z',createdBefore:'2026-10-10T22:00:00Z'}),error=>{
  const diagnostic=mhelpTicketDiagnostic(error);assert.equal(diagnostic.error,'MHELP_PREVIEW_RENEWAL_FAILED');assert.equal(diagnostic.httpStatus,503);
  assert.deepEqual(diagnostic.log.renewal,responseDiagnostic('http_error',400,'invalid_grant'));
  assert(!JSON.stringify(diagnostic).includes(secret));return true;
 });
 assert.deepEqual(f.actions,['read','read','claim','release']);assert.equal(f.requests(),1);
});
test('log boundary reprojects diagnostic fields and ignores forged generic errors or unrelated categories',()=>{
 const expected=responseDiagnostic('http_error',400,'invalid_grant');
 const cause=new MhelpTicketError('mHelpDesk could not renew its existing server token.');
 cause.renewal={...expected,error_description:secret,error_uri:secret,body:secret,headers:secret,stack:secret};
 assert.deepEqual(mhelpTicketDiagnostic(cause).log.renewal,expected);
 for(const change of [{stage:secret},{reason:secret}])assert.equal(projectMhelpTokenRenewalDiagnostic({...expected,...change}),undefined);
 for(const httpStatus of [secret,'400',NaN,Infinity,99,600,400.5])assert.equal(projectMhelpTokenRenewalDiagnostic({...expected,httpStatus}).httpStatus,null);
 for(const oauthError of [secret,'invalid_grant '+secret,{},['invalid_scope']])assert.equal(projectMhelpTokenRenewalDiagnostic({...expected,oauthError}).oauthError,null);
 const unrelated=new MhelpTicketError('mHelpDesk returned an invalid ticket identity.');unrelated.renewal=expected;
 assert.equal(mhelpTicketDiagnostic(unrelated).log.renewal,undefined);
 assert.equal(mhelpTicketDiagnostic({message:cause.message,renewal:expected}).log.renewal,undefined);
 assert(!JSON.stringify(mhelpTicketDiagnostic(cause)).includes(secret));
});
test('oversized and aborted response bodies are cancelled safely without changing pre-rotation lease release',async t=>{
 for(const contentLength of [undefined,'32769']){
  let cancelled=0;const f=fixture(()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(32769));},cancel(){cancelled++;throw Error(secret);}}),{status:400,headers:contentLength?{'Content-Length':contentLength}:{}}));
  await assert.rejects(f.manager.renewAccess(),e=>safe(e,responseDiagnostic('response_too_large',400)));
  assert.equal(cancelled,1);assert.deepEqual(f.actions,['read','claim','release']);
 }
 const original=setTimeout;t.mock.method(globalThis,'setTimeout',(fn,delay,...args)=>original(fn,delay===45000?1:delay,...args));
 const f=fixture(({signal})=>new Response(new ReadableStream({start(c){signal.addEventListener('abort',()=>c.error(Error(secret)),{once:true});}}),{status:400}));
 await assert.rejects(f.manager.renewAccess(),e=>safe(e,responseDiagnostic('deadline',400)));
 assert.equal(f.requests(),1);assert.deepEqual(f.actions,['read','claim','release']);
});
test('a generic renewal exception cannot smuggle a fabricated diagnostic through the ticket reader',async()=>{
 const reader=createMhelpTicketReader({getConfig:()=>({portalId:portal,accessToken:secret}),renewAccess:async()=>{throw Object.assign(Error(secret),{diagnostic:responseDiagnostic('http_error',400,'invalid_grant'),body:secret});},fetch:async()=>json({private:secret},401)});
 await assert.rejects(reader.preview({createdAfter:'2026-10-10T05:00:00Z',createdBefore:'2026-10-10T22:00:00Z'}),error=>{
  const result=mhelpTicketDiagnostic(error);assert.equal(result.error,'MHELP_PREVIEW_RENEWAL_FAILED');assert.equal(result.log.renewal,undefined);assert(!JSON.stringify(result).includes(secret));return true;
 });
});
test('stalled non-2xx body cannot outlive the deadline even if read and cancellation ignore abort',async t=>{
 const original=setTimeout;t.mock.method(globalThis,'setTimeout',(fn,delay,...args)=>original(fn,delay===45000?1:delay,...args));
 let cancelled=0;
 const f=fixture(()=>new Response(new ReadableStream({start(){},cancel(){cancelled++;return new Promise(()=>{});}}),{status:400}));
 await assert.rejects(f.manager.renewAccess(),e=>safe(e,responseDiagnostic('deadline',400)));
 assert.equal(cancelled,1);assert.equal(f.requests(),1);assert.deepEqual(f.actions,['read','claim','release']);
});
test('abort-ignoring POST is bounded and its late response is cancelled without parsing or persisting it',async t=>{
 const original=setTimeout;t.mock.method(globalThis,'setTimeout',(fn,delay,...args)=>original(fn,delay===45000?1:delay,...args));
 let finish,cancelled=0;
 const f=fixture(()=>new Promise(resolve=>{finish=resolve;}));
 await assert.rejects(f.manager.renewAccess(),e=>safe(e,{stage:'token_request',reason:'deadline',httpStatus:null,oauthError:null}));
 assert.equal(f.requests(),1);assert.deepEqual(f.actions,['read','claim','release']);
 finish(new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify({access_token:secret,refresh_token:secret,token_type:'Bearer',expires_in:3600})));},cancel(){cancelled++;return new Promise(()=>{});}}),{status:200}));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled,1);assert.deepEqual(f.actions,['read','claim','release']);
});

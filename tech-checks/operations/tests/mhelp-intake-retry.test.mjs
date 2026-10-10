import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_RETRY_AFTER_SECONDS,MAX_RETRY_AFTER_SECONDS,isRetryAfterSeconds,parseRetryAfter} from '../intake/mhelpIntakeRetry.ts';
import {IntakeFault,runMhelpIntake} from '../intake/mhelpIntakeRuntime.ts';
import {createNativeMhelpTicketAccess} from '../intake/mhelpIntakeTokenAccess.ts';
import {createNativeIntakeSourceHandler,projectRunResult} from '../intake/mhelpIntakeHandlers.ts';
import {createExistingCredentialSourceRead} from '../intake/mhelpIntakeTransport.ts';
import {fixture} from '../legacy/mhelp-intake-fixture.mjs';
const now=Date.parse('2026-10-10T12:00:00.250Z');
const window={createdAfter:'2026-10-10T11:59:59.999Z',createdBefore:'2026-10-10T12:05:00.000Z'};
const req=()=>new Request('https://synthetic.invalid',{headers:{'x-camera-cron-secret':'synthetic-only'}});
const signal=()=>new AbortController().signal;
test('Retry-After accepts bounded decimal seconds and all HTTP-date formats, rounded upward',()=>{
 for(const [raw,value] of [['0',0],['001',1],[' 3600 ',3600],['9999999999999999999999999999999999999999',MAX_RETRY_AFTER_SECONDS],['Sat, 10 Oct 2026 12:10:01 GMT',601],['Saturday, 10-Oct-26 12:10:01 GMT',601],['Sat Oct 10 12:10:01 2026',601],['Sat, 10 Oct 2026 12:00:00 GMT',0],['Sun, 11 Oct 2026 12:10:01 GMT',MAX_RETRY_AFTER_SECONDS]])assert.equal(parseRetryAfter(raw,now),value,raw);
 for(const raw of [null,'','-1','1.5','1e3','Infinity','0, 3600','3600, 7200','private vendor text','2026-10-10T12:10:01Z','Sat, 31 Feb 2026 12:10:01 GMT','Fri, 10 Oct 2026 12:10:01 GMT','9'.repeat(129)])assert.equal(parseRetryAfter(raw,now),undefined,String(raw));
 for(const value of [null,'300',-1,86401,1.5,Infinity,NaN,{},undefined])assert.equal(isRetryAfterSeconds(value),false);
 assert.equal(isRetryAfterSeconds(0),true);assert.equal(isRetryAfterSeconds(86400),true);
});
test('native error projection and legacy parsing preserve permanent/transient flags and only a numeric cooldown',async()=>{
 for(const fault of [new IntakeFault('SOURCE_UNAVAILABLE',false),new IntakeFault('SOURCE_UNAVAILABLE',true,3600),new IntakeFault('SOURCE_UNAVAILABLE',true,0)]){
  let projected;
  const handler=createNativeIntakeSourceHandler({authenticate:()=>true,read:async()=>{throw fault;}});
  const read=createExistingCredentialSourceRead({projectUrl:'https://goqrnolcvqnirjmzaeyk.supabase.co',request:req(),fetch:async(url,init)=>{const response=await handler(new Request(url,init));projected=await response.clone().json();return response;}});
  await assert.rejects(read(window,signal()),error=>error.code===fault.code&&error.retryable===fault.retryable&&error.retryAfterSeconds===fault.retryAfterSeconds);
  assert.deepEqual(projected,{code:fault.code,retryable:fault.retryable,...(fault.retryAfterSeconds!==undefined?{retryAfterSeconds:fault.retryAfterSeconds}:{})});
 }
});
test('malformed cooldown DTO never becomes an immediate retry; unknown raw gateway errors use safe fallback',async()=>{
 for(const retryAfterSeconds of [null,'3600',-1,86401,0.5,{},[]]){
  const read=createExistingCredentialSourceRead({projectUrl:'https://goqrnolcvqnirjmzaeyk.supabase.co',request:req(),fetch:async()=>new Response(JSON.stringify({code:'SOURCE_UNAVAILABLE',retryable:true,retryAfterSeconds}),{status:503})});
  await assert.rejects(read(window,signal()),error=>error.retryable===false&&error.retryAfterSeconds===undefined);
 }
 for(const header of [undefined,'private invalid header','0']){
  const read=createExistingCredentialSourceRead({projectUrl:'https://goqrnolcvqnirjmzaeyk.supabase.co',request:req(),fetch:async()=>new Response('private gateway body',{status:429,headers:header?{'Retry-After':header}:{}})});
  await assert.rejects(read(window,signal()),error=>error.retryable===true&&error.retryAfterSeconds===(header==='0'?0:DEFAULT_RETRY_AFTER_SECONDS)&&error.message==='SOURCE_UNAVAILABLE');
 }
});
test('structured boundary 429 also defers without overriding explicit false or shortening either numeric/header delay',async()=>{
 for(const [status,retryable,numeric,header,expected] of [[429,true,undefined,undefined,300],[429,true,undefined,'3600',3600],[503,true,undefined,'3600',3600],[429,false,undefined,'3600',undefined],[429,true,0,'3600',3600],[429,true,7200,'3600',7200]]){
  const read=createExistingCredentialSourceRead({projectUrl:'https://goqrnolcvqnirjmzaeyk.supabase.co',request:req(),fetch:async()=>new Response(JSON.stringify({code:'SOURCE_UNAVAILABLE',retryable,...(numeric===undefined?{}:{retryAfterSeconds:numeric})}),{status,headers:header?{'Retry-After':header}:{}})});
  await assert.rejects(read(window,signal()),error=>error.retryable===retryable&&error.retryAfterSeconds===expected);
 }
});
function sourceChain({status=429,header,phase='account',now=Date.now(),renewReject=false}={}){
 const counts={vendor:0,account:0,tickets:0,renew:0,native:0};
 const tokens={getPartnerConfig:async()=>({accessToken:'synthetic-only',portalId:'17'}),renewAccess:async()=>{counts.renew++;if(renewReject)throw Error('private opaque renewal failure');return {accessToken:'synthetic-renewed',portalId:'17'};}};
 const access=createNativeMhelpTicketAccess({now:()=>now,env:key=>key==='SUPABASE_URL'?'https://tughscoxralhofrckvxy.supabase.co':undefined,tokens,fetch:async url=>{
  counts.vendor++;if(url.endsWith('/users/me')){counts.account++;if(phase==='tickets')return Response.json({portalId:17});}else counts.tickets++;
  return new Response('private provider error',{status,headers:header===undefined?{}:{'Retry-After':header}});
 }});
 const handler=createNativeIntakeSourceHandler({authenticate:()=>true,read:async(window,_req,signal)=>{const accessClient=await access.begin('17',signal);return accessClient.readTicketPage({...window,offset:0,pageSize:50});}});
 const read=createExistingCredentialSourceRead({projectUrl:'https://goqrnolcvqnirjmzaeyk.supabase.co',request:req(),fetch:async(url,init)=>{counts.native++;return handler(new Request(url,init));}});
 return {counts,read};
}
test('vendor cooldown crosses account/page errors and persisted SQL fail blocks later polls without watermark advance',async()=>{
 for(const spec of [{header:'3600',delay:3600},{header:'Sat, 10 Oct 2026 13:00:01 GMT',delay:3601},{header:'bad private value',delay:300},{delay:300},{header:'0',delay:30},{header:'3600',delay:3600,phase:'tickets'},{status:403,delay:1800},{status:401,delay:1800},{status:401,renewReject:true,delay:300}]){
  const db=await fixture({realScheduler:true});await db.exec("update cos_mhelp_intake.portal_config set activated_at=date_trunc('milliseconds',clock_timestamp()-interval '5 minutes')");
  const f=sourceChain({...spec,now}),calls=[],sleeps=[];
  const rpc=async input=>{calls.push(structuredClone(input));await db.exec('set role service_role');try{return (await db.query('select public.camera_mhelp_ticket_intake_v1($1::jsonb) v',[JSON.stringify(input)])).rows[0].v;}finally{await db.exec('reset role');}};
  const options={enabled:true,rpc,readSource:f.read,sleep:async ms=>sleeps.push(ms)};
  const before=Date.now(),result=await runMhelpIntake(options);
  assert.equal(result.state,'failed');assert.equal(result.watermarkAdvanced,false);assert.equal(f.counts.native,1);assert.equal(f.counts.account,spec.status===401&&!spec.renewReject?2:1);assert.equal(f.counts.tickets,spec.phase==='tickets'?1:0);assert.deepEqual(sleeps,[]);assert(!calls.some(c=>['record','finish'].includes(c.action)));
  const stored=(await db.query('select * from cos_mhelp_intake.scheduler_state')).rows[0],config=(await db.query('select activated_at from cos_mhelp_intake.portal_config')).rows[0];
  assert.equal(stored.watermark.getTime(),config.activated_at.getTime());assert(stored.retry_after.getTime()>=before+spec.delay*1000);assert.equal(stored.failure_count,1);
  assert.equal((await runMhelpIntake(options)).state,'backoff');assert.equal(f.counts.native,1,'A later poll before persisted eligibility must not touch the provider');
  assert.deepEqual(Object.keys(projectRunResult(result)).sort(),['code','contract','created','existing','reviewNeeded','scanned','state','watermarkAdvanced'].sort());
  assert(!JSON.stringify(result).includes('private'));assert(!JSON.stringify(calls).includes('private'));
  await db.exec("update cos_mhelp_intake.scheduler_state set retry_after=clock_timestamp()-interval '1 second',last_attempt_at=clock_timestamp()-interval '5 minutes'");
  assert.equal((await rpc({action:'begin'})).state,'leased','A synthetic advance past cooldown is eligible again');
 }
});
test('vendor 403 and post-renewal 401 stay permanent through the native 503 wrapper; renewal rejection is deferred',async()=>{
 for(const spec of [{status:403,renew:0,retryable:false},{status:401,renew:1,retryable:false},{status:401,renew:1,retryable:true,renewReject:true}]){
  const f=sourceChain({...spec,header:'3600'});
  await assert.rejects(f.read(window,signal()),error=>error.code==='SOURCE_UNAVAILABLE'&&error.retryable===spec.retryable&&error.retryAfterSeconds===(spec.renewReject?300:undefined));
  assert.equal(f.counts.renew,spec.renew);assert.equal(f.counts.account,spec.status===401&&!spec.renewReject?2:1);assert.equal(f.counts.tickets,0);
 }
});

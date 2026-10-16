import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {currentAdmittedEndpoint,createBoundedAvigilonTcp} from '../../supabase/functions/_shared/avigilonEndpointRuntime.ts';
import {createReviewedAvigilonDeployment} from '../../supabase/functions/_shared/avigilonDeploymentBootstrap.ts';
import {avigilonDeployment} from '../../supabase/functions/_shared/avigilonDeployment.ts';
import {reviewedAvigilonRuntime} from '../../supabase/functions/_shared/avigilonReviewedRuntime.ts';
const actor={tenantId:'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',actorId:'11111111-1111-4111-8111-111111111111',canCheck:true};
const endpoint={deviceId:'10',revision:'2',ip:'8.8.8.8',ports:[443],profile:'sniper'};
const unit={id:'roster1',nativeUnitId:'11111111-2222-4222-8222-111111111111',name:'Sniper 1',family:'Sniper',placement:'FIELD',restricted:false,identityVerified:true,endpoint};
const envelope=()=>({contract:'COS_AVIGILON_PUBLICATIONS_V1',tenantId:actor.tenantId,authority:{contract:'COS_AVIGILON_AUTHORITY_V1',tenantId:actor.tenantId,generation:'1',rosterRevision:'r1',admitted:true},roster:{tenantId:actor.tenantId,revision:'r1',units:[structuredClone(unit)]},items:[{deviceId:'10',endpoint:structuredClone(endpoint),placement:'FIELD',restricted:false,receipt:null,health:null}]});
const observed=()=>{const e=envelope(),at='2026-10-16T20:00:00Z';e.items[0].receipt={unitId:unit.id,endpointRevision:'2',publicationReceipt:'73',outcome:'nonresponse',completedAt:at,confirmedOutage:false};e.items[0].health={checked_at:at,ip_reachable:false,consecutive_failures:2,confirmed_outage:false};return e;};
test('shipped deployment remains disabled with zero configuration access and no global runtime',()=>{
 assert.equal(avigilonDeployment,undefined);assert.equal(reviewedAvigilonRuntime(),undefined);
 assert.equal(createReviewedAvigilonDeployment({enabled:false,get bindings(){throw Error('disabled binding access');}}),undefined);
 for(const value of [undefined,{}, {enabled:true},{enabled:true,bindings:{actor}}])assert.throws(()=>createReviewedAvigilonDeployment(value));
 const gate=readFileSync(new URL('../../supabase/functions/_shared/avigilonDeployment.ts',import.meta.url),'utf8');assert.match(gate,/createReviewedAvigilonDeployment\(\{enabled:false\}\)/);assert.doesNotMatch(gate,/Deno\.env|enabled:true/);
 for(const name of ['camera-provider-reconcile','vigilant-sync','reconeyez-connect','reconeyez-webhook','camera-health-sweep'])assert.match(readFileSync(new URL('../../supabase/functions/'+name+'/index.ts',import.meta.url),'utf8'),/import '\.\.\/_shared\/avigilonDeployment\.ts'/);
 const serve=readFileSync(new URL('../../supabase/functions/cos-operations-pages/serve.ts',import.meta.url),'utf8');assert.match(serve,/avigilonChecks:avigilonDeployment\?\.checks/);assert.match(serve,/avigilonSources:avigilonDeployment\?\.sourcesForActor/);
});
test('native admitted current endpoint does not reuse legacy failures or fabricate first failure time',()=>{
 assert.equal(currentAdmittedEndpoint(envelope(),actor,'10').consecutiveFailures,0);
 const current=currentAdmittedEndpoint(observed(),actor,'10');assert.equal(current.consecutiveFailures,2);assert.equal(current.firstFailedAt,null);assert.equal(current.active,true);
});
for(const [name,mutate] of Object.entries({shop:e=>e.roster.units[0].placement='SHOP',restriction:e=>e.roster.units[0].restricted=true,identity:e=>e.roster.units[0].identityVerified=false,unadmitted:e=>e.authority.admitted=false,tenant:e=>e.tenantId='other',roster:e=>e.roster.revision='r2',missing:e=>e.items=[],duplicate:e=>e.roster.units.push(structuredClone(e.roster.units[0])),collision:e=>e.roster.units.push({...structuredClone(unit),id:'other',endpoint:{...endpoint,deviceId:'11'}}),revision:e=>e.items[0].endpoint.revision='3',privateIp:e=>e.roster.units[0].endpoint.ip='127.0.0.1',receipt:e=>e.items[0].receipt.unitId='other',zeroReceipt:e=>e.items[0].receipt.publicationReceipt='0',aliasCollision:e=>e.roster.units.push({...structuredClone(unit),id:'other',endpoint:{...endpoint,deviceId:'11',ip:'8.8.8.8/32'}}),failures:e=>e.items[0].health.consecutive_failures=-1}))test('rejects '+name+' before any endpoint connection',()=>{const e=observed();mutate(e);assert.throws(()=>currentAdmittedEndpoint(e,actor,'10'));});
test('same host with disjoint approved ports does not invent a collision',()=>{const e=envelope();e.roster.units.push({...structuredClone(unit),id:'other',endpoint:{...endpoint,deviceId:'11',ip:'8.8.8.8/32',ports:[80]}});assert.equal(currentAdmittedEndpoint(e,actor,'10').deviceId,'10');});
test('bounded TCP closes successful and late sockets; abort and runtime faults never become outages',async()=>{
 let closed=0;const controller=new AbortController();
 assert.equal((await createBoundedAvigilonTcp(async()=>({close:()=>closed++}))(endpoint.ip,443,controller.signal)).kind,'responded');assert.equal(closed,1);
 let release;const late=createBoundedAvigilonTcp(()=>new Promise(r=>release=r),10)(endpoint.ip,443,controller.signal);assert.equal((await late).kind,'nonresponse');release({close:()=>closed++});await new Promise(r=>setImmediate(r));assert.equal(closed,2);
 const aborted=new AbortController();let releaseAborted;const waiting=createBoundedAvigilonTcp(()=>new Promise(r=>releaseAborted=r))(endpoint.ip,443,aborted.signal);await new Promise(r=>setImmediate(r));aborted.abort();assert.equal((await waiting).kind,'checker_failure');releaseAborted({close:()=>closed++});await new Promise(r=>setImmediate(r));assert.equal(closed,3);
 for(const [name,kind] of [['ConnectionRefused','nonresponse'],['PermissionDenied','checker_failure'],['TooManyOpenFiles','checker_failure'],['Error','checker_failure']]){const error=new Error('synthetic');error.name=name;assert.equal((await createBoundedAvigilonTcp(async()=>{throw error;})(endpoint.ip,443,controller.signal)).kind,kind);}
 for(const socket of [null,undefined,{}])assert.equal((await createBoundedAvigilonTcp(async()=>socket)(endpoint.ip,443,controller.signal)).kind,'checker_failure');
 let calls=0;assert.equal((await createBoundedAvigilonTcp(async()=>{calls++;})( '127.0.0.1',443,controller.signal)).kind,'checker_failure');assert.equal(calls,0);
});
test('explicit reviewed composition uses admitted native evidence and native receipt commit only',async()=>{
 const requests=[],jobs=[];let connects=0,closed=0,e=observed();
 const bindings={actor,platformUrl:'https://tughscoxralhofrckvxy.supabase.co',serviceKey:'synthetic-native',legacyUrl:'https://goqrnolcvqnirjmzaeyk.supabase.co',legacyServiceKey:'synthetic-legacy',background:p=>jobs.push(p),connect:async()=>{connects++;return{close:()=>closed++};},fetch:async(url,init)=>{
  const name=new URL(url).pathname.split('/').pop(),body=JSON.parse(init.body);requests.push({name,body});
  if(name==='cos_avigilon_source_control')return Response.json({tenantId:actor.tenantId,generation:'1',admitted:true,pending:null});
  if(name==='cos_avigilon_health_read')return Response.json(e);
  if(name==='cos_avigilon_run_commit')return Response.json({unitId:unit.id,publicationReceipt:'74',outcome:'online'});
  throw Error('Unexpected transport '+name);
 }};
 for(const change of [{actor:{...actor,canCheck:false}},{actor:{...actor,actorId:'bad'}},{actor:{...actor,tenantId:'22222222-2222-4222-8222-222222222222'}},{platformUrl:'https://wrong.invalid'},{platformUrl:'https://goqrnolcvqnirjmzaeyk.supabase.co'},{background:null},{connect:null},{legacyUrl:'https://wrong.invalid'}])assert.throws(()=>createReviewedAvigilonDeployment({enabled:true,bindings:{...bindings,...change}}));
 assert.equal(requests.length,0);
 const deployment=createReviewedAvigilonDeployment({enabled:true,bindings});assert.equal(reviewedAvigilonRuntime(),deployment);assert.equal(requests.length,0);
 const result=await deployment.checks.probe(actor,endpoint,new AbortController().signal);assert.equal(result.outcome,'online');assert.equal(result.confirmedOutage,false);assert.equal(connects,1);assert.equal(closed,1);assert.match(result.publication.p_health.detail,/service port/);
 const row=await deployment.checks.store(actor).commit({id:'run1',tenantId:actor.tenantId,rows:[{unitId:unit.id,startedAt:'2026-10-16T20:00:00Z'}]},unit,result);assert.equal(row.publicationReceipt,'74');assert(requests.some(r=>r.name==='cos_avigilon_run_commit'));assert(!requests.some(r=>r.name==='publish_camera_connection_v1'));
 e.roster.units[0].placement='SHOP';await assert.rejects(()=>deployment.checks.probe(actor,endpoint,new AbortController().signal));assert.equal(connects,1);
 await assert.rejects(()=>deployment.checks.probe({...actor,tenantId:'other'},endpoint,new AbortController().signal));assert.equal(connects,1);
 const job=Promise.resolve();deployment.checks.background(job);assert.equal(jobs[0],job);await job;
});

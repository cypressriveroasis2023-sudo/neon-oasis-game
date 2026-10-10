import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCameraMhelpTicketIntakeHandler} from '../../supabase/functions/camera-mhelp-ticket-intake/index.ts';
import {verifyLegacyOwner} from '../../supabase/functions/camera-mhelp-ticket-intake/authorization.ts';
import {createProtectedNativeIntakeSource} from '../../supabase/functions/cos-mhelp-ticket-source/index.ts';
import {createCameraMhelpReadinessHandler} from '../../supabase/functions/camera-mhelp-readiness/index.ts';
const id='10000000-0000-4000-8000-000000000001',time='2026-10-10T00:00:00.000Z';
const review=()=>({contract:'cos-mhelp-intake-review-v1',enabled:false,activationAt:time,pendingReviewCount:1,createdCount:0,held:[{ticketNumber:'000042',reasonCodes:['source_status_unreviewed']}],heldTruncated:false,lastAttemptAt:null,lastSuccessAt:null,failureCount:0,retryAfter:null,lastErrorCode:null});
const aggregate=()=>({contract:'cos-mhelp-ticket-intake-run-v1',state:'disabled',scanned:0,created:0,existing:0,reviewNeeded:0,watermarkAdvanced:false});
const request=(body,headers={},url='https://synthetic.invalid/intake',method='POST')=>new Request(url,{method,headers:{'Content-Type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})});
const cron={'x-camera-cron-secret':'synthetic-only'},owner={authorization:'Bearer synthetic-user-jwt'};
function handler(patch={}){const calls=[];const h=createCameraMhelpTicketIntakeHandler({verifyCron:async()=>{calls.push('cron-auth');return true;},verifyOwner:async()=>{calls.push('owner-auth');return true;},run:async()=>{calls.push('run');return aggregate();},review:async()=>{calls.push('review');return review();},...patch});return {calls,h};}
test('legacy Edge authenticates before body/status reads; missing/mixed credentials never fall through',async()=>{
 const denied=handler({verifyCron:async()=>false,verifyOwner:async()=>false});for(const headers of [cron,owner,{}, {...cron,...owner}]){const req=request({action:'review_status'},headers);assert.equal((await denied.h(req)).status,403);assert.equal(req.bodyUsed,false);assert.deepEqual(denied.calls,[]);}
 const gate=handler();assert.equal((await gate.h(request({action:'run'},{...cron,...owner}))).status,403);assert.deepEqual(gate.calls,[]);
});
test('cron is run-only and aggregate-only; genuine Owner is read-only without config controls',async()=>{
 const {h,calls}=handler({run:async()=>({...aggregate(),tickets:[{private:'source'}],assignmentIds:['private']})});assert.deepEqual(await (await h(request({action:'run'},cron))).json(),aggregate());
 for(const action of ['review_status','policy','record','begin','finish','fail','enable'])assert.equal((await h(request({action},cron))).status,400);
 assert.deepEqual(await (await h(request({action:'review_status'},owner))).json(),review());
 for(const action of ['run','policy','record','begin','finish','fail','enable'])assert.equal((await h(request({action},owner))).status,400);assert.equal(calls.filter(x=>x==='review').length,1);
});
test('server boundary rejects origins, methods, query strings and caller-selected actor/scope/URL/oversized fields',async()=>{
 const {h,calls}=handler();for(const origin of ['https://evil.invalid','null','https://cypressriveroasis2023-sudo.github.io'])assert.equal((await h(request({action:'run'},{...cron,origin}))).status,403);assert.deepEqual(calls,[]);
 assert.equal((await h(request(null,cron,'https://synthetic.invalid/intake','GET'))).status,400);assert.equal((await h(request({action:'run'},cron,'https://synthetic.invalid/intake?actor=owner'))).status,400);
 for(const fields of [{actorId:id},{portalId:'17'},{url:'https://other.invalid'},{ticket:{}},{enabled:true},{extra:'x'.repeat(300)}])assert.equal((await h(request({action:'run',...fields},cron))).status,400);assert(!calls.includes('run'));assert(!calls.includes('review'));
});
test('aborted request is denied before async authorization or body consumption',async()=>{
 const {h,calls}=handler(),controller=new AbortController();controller.abort();const req=new Request('https://synthetic.invalid/intake',{method:'POST',headers:{...cron,'Content-Type':'application/json'},body:'{"action":"run"}',signal:controller.signal});assert.equal((await h(req)).status,403);assert.equal(req.bodyUsed,false);assert.deepEqual(calls,[]);
});
test('review rejects operational payloads and raw provider/SQL failures',async()=>{
 for(const value of [{...review(),sourceBody:{private:'raw'}},{...review(),held:[{ticketNumber:'42',reasonCodes:['private source body']}]},{...review(),activationAt:'2026-02-30T00:00:00.000Z'}]){const {h}=handler({review:async()=>value});const r=await h(request({action:'review_status'},owner));assert.equal(r.status,503);assert(!(await r.text()).includes('private'));}
 const {h}=handler({review:async()=>{throw Error('private raw SQL');}});assert(!(await (await h(request({action:'review_status'},owner))).text()).includes('private'));
});
function ownerDb({authError=null,user={id},profile={user_id:id,role:'owner',active:true,archived_at:null},rows,profileError=null}={}){
 const calls=[];const db={auth:{getUser:async token=>{calls.push(['getUser',token]);return {data:{user},error:authError};}},from:table=>{calls.push(['from',table]);return {select:columns=>{calls.push(['select',columns]);return {eq:(column,value)=>{calls.push(['eq',column,value]);return {limit:limit=>{calls.push(['limit',limit]);return {abortSignal:async()=>({data:rows??[profile],error:profileError})};}};}};}};}};return {calls,db};
}
test('Owner gate uses real getUser identity plus current active/nonarchived Owner profile',async()=>{
 const f=ownerDb();assert.equal(await verifyLegacyOwner(f.db,owner.authorization,new AbortController().signal),true);assert.deepEqual(f.calls,[['getUser','synthetic-user-jwt'],['from','profiles'],['select','user_id,role,active,archived_at'],['eq','user_id',id],['limit',2]]);
 for(const patch of [{authError:{message:'private'}},{user:null},{user:{id,is_anonymous:true}},{user:{id:'not-uuid'}},{profile:{user_id:id,role:'it',active:true,archived_at:null}},{profile:{user_id:id,role:'owner',active:false,archived_at:null}},{profile:{user_id:id,role:'owner',active:true,archived_at:time}},{profile:{user_id:'other',role:'owner',active:true,archived_at:null}},{rows:[]},{rows:[{},{}]},{profileError:{private:true}}])assert.equal(await verifyLegacyOwner(ownerDb(patch).db,owner.authorization,new AbortController().signal),false);
 const bad=ownerDb();for(const token of [null,'','Bearer bad token','Basic synthetic','Bearer '+'x'.repeat(17000)])assert.equal(await verifyLegacyOwner(bad.db,token,new AbortController().signal),false);assert.deepEqual(bad.calls,[]);
});
test('original verifier retains exact authenticate response and adds only protected fixed intake_policy',async()=>{
 let policies=0;const h=createCameraMhelpReadinessHandler({verifyCron:async()=>true,intakePolicy:async()=>{policies++;return {state:'disabled'};}});assert.deepEqual(await (await h(request({action:'authenticate'},cron))).json(),{authenticated:true});assert.equal(policies,0);assert.deepEqual(await (await h(request({action:'intake_policy'},cron))).json(),{state:'disabled'});assert.equal(policies,1);
 for(const fields of [{actorId:id},{portalId:'17'},{url:'other'},{secret:'private'},{extra:'x'.repeat(300)}])assert.equal((await h(request({action:'intake_policy',...fields},cron))).status,400);
 for(const headers of [{...cron,origin:'https://evil.invalid'},{...cron,...owner}])assert.equal((await h(request({action:'intake_policy'},headers))).status,403);assert.equal(policies,1);
 const denied=createCameraMhelpReadinessHandler({verifyCron:async()=>false,intakePolicy:async()=>{throw Error('must not read');}});const req=request({action:'intake_policy'},cron);assert.equal((await denied(req)).status,403);assert.equal(req.bodyUsed,false);
});
test('policy returns only fixed metadata; false mapping flags preserved and source body rejected',async()=>{
 const policy={state:'ready',portalId:'17',activationFloor:time,schemaContract:'synthetic',schemaEvidence:'Synthetic reviewed schema',typeMappingsVerified:false,identityMappingsVerified:false,statusPoliciesVerified:false};const h=createCameraMhelpReadinessHandler({verifyCron:async()=>true,intakePolicy:async()=>policy});assert.deepEqual(await (await h(request({action:'intake_policy'},cron))).json(),policy);
 const bad=createCameraMhelpReadinessHandler({verifyCron:async()=>true,intakePolicy:async()=>({...policy,source:'private'})});const response=await bad(request({action:'intake_policy'},cron));assert.equal(response.status,503);assert(!(await response.text()).includes('private'));
});
test('native source uses fixed native project/verifier; proven policy cannot bypass empty production registry',async()=>{
 const calls=[],policy={state:'ready',portalId:'17',activationFloor:time,schemaContract:'synthetic',schemaEvidence:'Synthetic reviewed schema',typeMappingsVerified:true,identityMappingsVerified:true,statusPoliciesVerified:true};const h=createProtectedNativeIntakeSource({env:name=>name==='SUPABASE_URL'?'https://tughscoxralhofrckvxy.supabase.co':undefined,fetch:async(url,init)=>{calls.push({url,init});assert.equal(url,'https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/camera-mhelp-readiness');return new Response(JSON.stringify(JSON.parse(init.body).action==='authenticate'?{authenticated:true}:policy));}});
 const body={action:'ticket_batch',createdAfter:time,createdBefore:'2026-10-10T00:01:00.000Z'},response=await h(request(body,cron));assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'Intake source unavailable',code:'CONFIGURATION'});assert.deepEqual(calls.map(c=>JSON.parse(c.init.body).action),['authenticate','intake_policy']);assert(calls.every(c=>c.init.redirect==='error'&&c.init.signal));
 for(const headers of [owner,{...cron,...owner},{...cron,origin:'https://evil.invalid'}])assert.equal((await h(request(body,headers))).status,403);assert.equal(calls.length,2);
});
test('native oversized verifier response fails before policy/source reads and body consumption',async()=>{
 let calls=0;const h=createProtectedNativeIntakeSource({env:()=> 'https://tughscoxralhofrckvxy.supabase.co',fetch:async()=>{calls++;return new Response(JSON.stringify({authenticated:true,payload:'x'.repeat(200)}));}}),req=request({action:'ticket_batch',createdAfter:time,createdBefore:'2026-10-10T00:01:00.000Z'},cron);assert.equal((await h(req)).status,403);assert.equal(req.bodyUsed,false);assert.equal(calls,1);
});
test('entrypoints pin existing SDK/project/service RPC and avoid auth mutation or credential setup',async()=>{
 const server=await readFile(new URL('../../supabase/functions/camera-mhelp-ticket-intake/serve.ts',import.meta.url),'utf8');assert.match(server,/npm:@supabase\/supabase-js@2\.57\.4/);assert.match(server,/verifyLegacyOwner\(db,authorization,signal\)/);assert.match(server,/createExistingServiceRpc\(db\)/);assert.doesNotMatch(server,/setSession|set_config|user_metadata|console\./);
 const native=await readFile(new URL('../../supabase/functions/cos-mhelp-ticket-source/index.ts',import.meta.url),'utf8');assert.match(native,/productionAdapterFor\(policy,access\)/);assert.match(native,/nativeMhelpTokens/);assert.doesNotMatch(native,/console\.|SUPABASE_SERVICE_ROLE_KEY/);
});

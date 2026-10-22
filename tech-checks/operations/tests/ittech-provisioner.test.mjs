import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {createITTechProvisioner,renderITTechProvisioner} from '../scripts/prepareITTechProvisioner.mjs';

const token='synthetic-bearer-for-local-tests-only-01234567890123456789';
const serviceKey='synthetic-service-key-never-expose';
const tokenSha256=createHash('sha256').update(token).digest('hex');
const config={tokenSha256,expiresAt:'2026-10-22T15:20:00.000Z'};
const userId='c9a7c3e9-953c-4ad6-a080-5eacbcd1d1c7';
const email='ittech@cameras-on-site.invalid';
const project='https://tughscoxralhofrckvxy.supabase.co';
const user=()=>({id:userId,email,role:'authenticated',is_anonymous:false,phone:'',email_confirmed_at:'2026-10-22T15:00:00.000Z',user_metadata:{name:'Test IT',full_name:'Test IT',email_verified:true},app_metadata:{provider:'email',providers:['email'],cos_provisioning_contract:'COS_ITTECH_NATIVE_AUTH_20261022_V1',cos_legacy_user_id:'05bf20fe-19f7-4db7-ac05-5b2a5f681fdf'},identities:[{user_id:userId,provider:'email',identity_data:{sub:userId,email}}]});
const response=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const request=options=>new Request('https://function.example/provision'+(options?.query||''),{method:options?.method||'POST',headers:{authorization:'Bearer '+(options?.token??token)},...(options?.body!==undefined?{body:options.body}:{})});
function harness(options={}){
 const calls=[],clock={value:Date.parse('2026-10-22T15:00:00Z')};let existing=options.existing?structuredClone(options.existing):null;
 const fetcher=async(url,init)=>{
  calls.push({url,...init});
  assert.equal(init.headers.apikey,serviceKey);assert.equal(init.headers.authorization,'Bearer '+serviceKey);assert.equal(init.redirect,'error');assert.ok(init.signal instanceof AbortSignal);
  if(init.method==='GET'){
   assert.equal(url,project+'/auth/v1/admin/users/'+userId);
   if(options.readUnavailable)return response(503,{error:serviceKey});
   if(options.expireDuringRead)clock.value=Date.parse(config.expiresAt);
   return existing?response(200,existing):response(404,{error:'User not found'});
  }
  assert.equal(init.method,'POST');assert.equal(url,project+'/auth/v1/admin/users');
  if(options.failCreate)return response(500,{error:serviceKey});
  existing=options.readbackMismatch?{...user(),email:'other@example.invalid'}:user();
  if(options.uncertainCreate)throw Error(serviceKey);
  return response(200,{...existing,neverReturnThis:serviceKey});
 };
 const getEnv=key=>key==='SUPABASE_URL'?(options.projectUrl||project):key==='SUPABASE_SERVICE_ROLE_KEY'?serviceKey:undefined;
 return {calls,clock,handler:createITTechProvisioner(config,{fetcher,getEnv,now:()=>clock.value})};
}

test('creates only the fixed native Auth user and independently verifies readback',async()=>{
 const {handler,calls}=harness(),result=await handler(request()),body=await result.json();
 assert.equal(result.status,201);assert.deepEqual(body,{ok:true,state:'created',userId,displayName:'Test IT'});
 assert.deepEqual(calls.map(call=>call.method),['GET','POST','GET']);
 assert.deepEqual(JSON.parse(calls[1].body),{id:userId,email,email_confirm:true,user_metadata:{name:'Test IT',full_name:'Test IT'},app_metadata:{cos_provisioning_contract:'COS_ITTECH_NATIVE_AUTH_20261022_V1',cos_legacy_user_id:'05bf20fe-19f7-4db7-ac05-5b2a5f681fdf'}});
 assert.equal(result.headers.get('cache-control'),'no-store');assert.equal(result.headers.get('access-control-allow-origin'),null);
 assert.doesNotMatch(JSON.stringify(body),/synthetic|password|token|service.key/i);
});

test('a verified replay performs only a fixed-ID read and issues no second creation',async()=>{
 const {handler,calls}=harness();await handler(request());calls.length=0;
 const result=await handler(request());assert.equal(result.status,200);assert.equal((await result.json()).state,'already_exists');
 assert.deepEqual(calls.map(call=>call.method),['GET']);
});

test('an already existing exact stamped account is read-only',async()=>{
 const {handler,calls}=harness({existing:user()}),result=await handler(request());
 assert.equal(result.status,200);assert.deepEqual(calls.map(call=>call.method),['GET']);
});

for(const [label,alter]of [
 ['wrong id',value=>value.id='00000000-0000-4000-8000-000000000001'],
 ['wrong email',value=>value.email='someone@example.invalid'],
 ['different name',value=>value.user_metadata.full_name='Different Person'],
 ['missing server provenance',value=>delete value.app_metadata.cos_provisioning_contract],
 ['wrong legacy identity',value=>value.app_metadata.cos_legacy_user_id='other'],
 ['unexpected app role',value=>value.app_metadata.role='owner'],
 ['unexpected native auth role',value=>value.role='service_role'],
 ['unconfirmed email',value=>value.email_confirmed_at=null],
 ['other provider',value=>value.identities[0].provider='google'],
 ['extra identity',value=>value.identities.push({...value.identities[0]})],
])test('existing '+label+' fails closed without modifying the user',async()=>{
 const existing=user();alter(existing);const {handler,calls}=harness({existing});
 assert.equal((await handler(request())).status,409);assert.deepEqual(calls.map(call=>call.method),['GET']);
});

for(const options of [{token:'incorrect-bearer-that-is-at-least-thirty-two-characters'},{token:''},{method:'GET'},{method:'OPTIONS'},{body:'{}'},{body:JSON.stringify({id:userId,role:'owner'})},{query:'?id=other'},{query:'?token='+token}])test('request overrides and invalid authorization cause no Auth traffic '+JSON.stringify({...options,query:options.query?'query-present':undefined}),async()=>{
 const {handler,calls}=harness(),result=await handler(request(options));assert.ok([400,401,405].includes(result.status));assert.equal(calls.length,0);
});

test('expiry rejects requests before service-key access and rechecks immediately before create',async()=>{
 let reads=0;
 const expired=createITTechProvisioner(config,{now:()=>Date.parse(config.expiresAt),getEnv:()=>{reads++;throw Error('should not read');},fetcher:()=>{throw Error('should not fetch');}});
 assert.equal((await expired(request())).status,410);assert.equal(reads,0);
 const {handler,calls}=harness({expireDuringRead:true});assert.equal((await handler(request())).status,410);assert.deepEqual(calls.map(call=>call.method),['GET']);
});

test('expiry during request validation stops before reading service configuration',async()=>{
 let checks=0,secretReads=0;
 const handler=createITTechProvisioner(config,{now:()=>++checks===1?Date.parse('2026-10-22T15:00:00Z'):Date.parse(config.expiresAt),getEnv:()=>{secretReads++;throw Error('must not read');},fetcher:()=>{throw Error('must not fetch');}});
 assert.equal((await handler(request())).status,410);assert.equal(secretReads,0);
});

test('wrong project configuration never transmits the service key',async()=>{
 const {handler,calls}=harness({projectUrl:'https://unrelated.example'});assert.equal((await handler(request())).status,503);assert.equal(calls.length,0);
});

test('unavailable initial Auth read does not create or expose upstream details',async()=>{
 const {handler,calls}=harness({readUnavailable:true}),result=await handler(request());assert.equal(result.status,502);assert.deepEqual(calls.map(call=>call.method),['GET']);assert.doesNotMatch(await result.text(),/synthetic-service/);
});

test('uncertain successful create is confirmed by GET without replaying POST',async()=>{
 const {handler,calls}=harness({uncertainCreate:true}),result=await handler(request());assert.equal(result.status,200);assert.equal((await result.json()).state,'confirmed_after_submit');assert.deepEqual(calls.map(call=>call.method),['GET','POST','GET']);
});

test('failed creation is not automatically replayed and errors contain no service key',async()=>{
 const {handler,calls}=harness({failCreate:true}),result=await handler(request());assert.equal(result.status,502);assert.deepEqual(calls.map(call=>call.method),['GET','POST','GET']);assert.doesNotMatch(await result.text(),/synthetic-service/);
});

test('mismatched independent readback cannot report success or trigger correction writes',async()=>{
 const {handler,calls}=harness({readbackMismatch:true});assert.equal((await handler(request())).status,409);assert.deepEqual(calls.map(call=>call.method),['GET','POST','GET']);
});

test('concurrent authenticated calls in one instance share one creation attempt',async()=>{
 const {handler,calls}=harness(),results=await Promise.all([handler(request()),handler(request()),handler(request())]);
 assert.ok(results.every(result=>result.ok));assert.equal(calls.filter(call=>call.method==='POST').length,1);
});

test('rendered source contains only the hash and fixed expiry and runs with Deno env configuration',async()=>{
 const source=renderITTechProvisioner(config);assert.ok(source.includes(tokenSha256));assert.ok(source.includes(config.expiresAt));assert.equal(source.includes(token),false);assert.equal(source.includes(serviceKey),false);
 let handler;const runtime={Deno:{serve:value=>{handler=value;},env:{get:()=>{throw Error('expired handler must not read secrets');}}},Date:class extends Date{static now(){return Date.parse(config.expiresAt);}},Response,Request,URL,TextEncoder,crypto,AbortSignal};
 runInNewContext(source,runtime);assert.equal(typeof handler,'function');assert.equal((await handler(request())).status,410);
});

test('renderer refuses missing hash, invalid expiry or target/role/token configuration',()=>{
 for(const invalid of [{},{...config,tokenSha256:'invalid'},{...config,expiresAt:'tomorrow'},{...config,actorId:userId},{...config,role:'owner'},{...config,token}])assert.throws(()=>renderITTechProvisioner(invalid));
});

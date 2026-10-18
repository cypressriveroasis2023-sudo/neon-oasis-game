import test from 'node:test';
import assert from 'node:assert/strict';
import {addressEvidence,createMhelpAddressGeocodioHandler} from '../../supabase/functions/cos-mhelp-address-geocodio/index.ts';
const hashes={sourceSha256:'a'.repeat(64),payloadSha256:'b'.repeat(64),addressSha256:'c'.repeat(64)};
const requestId='11111111-1111-4111-8111-111111111111',reservationToken='22222222-2222-4222-8222-222222222222';
const evidence={results:[{address_components:{number:'123',formatted_street:'Example Rd',city:'Houston',state_province:'TX',postal_code:'77002',country:'US'},
 formatted_address:'123 Example Rd, Houston, TX 77002',location:{lat:29.7,lng:-95.4},accuracy:1,accuracy_type:'rooftop',source:'Synthetic county fixture'}]};
function setup(overrides={}){
 const calls=[],sent=[];
 const options={apiKey:'synthetic-test-key',rpc:async(name,args)=>{calls.push({name,args});if(name==='verify_camera_health_cron_secret')return true;
  if(name.endsWith('claim_v1'))return {claimed:true,requestId,reservationToken,sendBefore:'2026-10-18T12:00:10Z',address:{street:'123 Example Rd',city:'Houston',state:'TX',zip:'77002'}};
  return {accepted:true};},fetch:async(url,init)=>{sent.push({url,init});return Response.json(evidence);},now:()=>Date.parse('2026-10-18T12:00:00Z'),...overrides};
 return {calls,sent,handler:createMhelpAddressGeocodioHandler(options)};
}
const req=(body=hashes,headers={'x-camera-cron-secret':'synthetic-operator-secret'})=>new Request('https://fixture.invalid/worker',{method:'POST',headers,body:JSON.stringify(body)});
test('one reserved lookup sends only address components to the named provider and stores evidence privately',async()=>{
 const f=setup(),r=await f.handler(req());assert.equal(r.status,200);assert.deepEqual(await r.json(),{claimed:true,status:'received'});
 assert.equal(f.sent.length,1);const url=new URL(f.sent[0].url);assert.equal(url.origin,'https://api.geocod.io');assert.equal(url.pathname,'/v2/geocode');
 assert.deepEqual([...url.searchParams.keys()].sort(),['city','country','postal_code','state_province','street']);
 assert.equal(url.searchParams.get('country'),'US');assert(!url.href.includes('synthetic-test-key'));assert(!url.searchParams.has('limit'));
 assert.equal(f.sent[0].init.headers.Authorization,'Bearer synthetic-test-key');assert.equal(f.sent[0].init.redirect,'error');
 assert.deepEqual(f.calls.map(c=>c.name),['verify_camera_health_cron_secret','cos_mhelp_address_geocodio_claim_v1','cos_mhelp_address_geocodio_finish_v1']);
 assert.equal(f.calls[2].args.p_request_id,requestId);assert.equal(f.calls[2].args.p_receipt.results[0].source,'Synthetic county fixture');
});
test('unauthenticated, browser-shaped, and arbitrary-address requests cannot claim a credit',async()=>{
 for(const r of [req(hashes,{}),req({...hashes,street:'123 Example Rd'}),req({address:'123 Example Rd'})]){
  const f=setup(),response=await f.handler(r);assert([400,403].includes(response.status));assert(!f.calls.some(c=>c.name.endsWith('claim_v1')));assert.equal(f.sent.length,0);
 }
 const f=setup({rpc:async()=>false});assert.equal((await f.handler(req())).status,403);
});
test('a missing provider key consumes no reservation or network request',async()=>{
 const f=setup({apiKey:undefined});assert.equal((await f.handler(req())).status,503);assert.equal(f.calls.length,1);assert.equal(f.sent.length,0);
});
test('a duplicate, disabled account or exhausted ledger cannot send a request',async()=>{
 for(const status of ['reserved','received','provider_error','budget_exhausted','configuration_unavailable','account_deferred','not_enrolled']){
  let sends=0;const f=setup({rpc:async name=>name==='verify_camera_health_cron_secret'?true:{claimed:false,status},fetch:async()=>{sends++;throw Error('not allowed');}});
  assert.deepEqual(await (await f.handler(req())).json(),{claimed:false,status});assert.equal(sends,0);
 }
});
test('expiry is checked immediately before send and never retried',async()=>{
 const f=setup({now:()=>Date.parse('2026-10-18T12:00:11Z')});await f.handler(req());assert.equal(f.sent.length,0);
 assert.equal(f.calls.at(-1).args.p_reason,'expired_before_send');
});
test('ambiguous results are retained for operator review without choosing or inventing a coordinate',async()=>{
 const f=setup({fetch:async()=>Response.json({results:[...evidence.results,{...evidence.results[0],location:{lat:29.8,lng:-95.5}}]})});
 await f.handler(req());const result=f.calls.at(-1).args.p_receipt;assert.equal(result.results.length,2);assert.equal(result.results[1].location.lat,29.8);
});
test('provider errors do not retain vendor error bodies and communicate account stop signals',async()=>{
 for(const [status,reason] of [[401,'provider_forbidden'],[403,'provider_forbidden'],[429,'provider_rate_limited'],[500,'provider_unavailable']]){
  const f=setup({fetch:async()=>new Response('untrusted credential-bearing error text',{status,headers:{'Retry-After':'120'}})});await f.handler(req());
  const finish=f.calls.at(-1).args;assert.equal(finish.p_status,'provider_error');assert.equal(finish.p_reason,reason);assert.equal(finish.p_receipt,null);
  assert(!JSON.stringify(finish).includes('untrusted'));assert.equal(finish.p_retry_after_seconds,status===429?120:null);
 }
});
test('transport and malformed responses never become no-match equipment or automatic retries',async()=>{
 for(const fetch of [async()=>{throw Error('transport');},async()=>new Response('not-json'),async()=>Response.json({unexpected:1}),async()=>new Response('x'.repeat(262145))]){
  let n=0;const f=setup({fetch:async(...args)=>{n++;return fetch(...args);}});await f.handler(req());assert.equal(n,1);
  assert.equal(f.calls.at(-1).args.p_status,'provider_error');assert.equal(f.calls.at(-1).args.p_receipt,null);
 }
});
test('untrusted provider extras and nonnumeric coordinates cannot leak into retained evidence',()=>{
 const raw=structuredClone(evidence);raw.api_key='sensitive-extra';raw.results[0].secret='other-extra';raw.results[0].location.lat='29.7';
 const result=addressEvidence(raw);assert(!JSON.stringify(result).includes('extra'));assert.equal(result.results[0].location.lat,null);
 assert.equal(addressEvidence({results:new Array(51).fill(evidence.results[0])}),null);
});
test('only a matching persisted receipt is reported successful; finish failure never resends',async()=>{
 let sends=0;const f=setup({rpc:async(name)=>name==='verify_camera_health_cron_secret'?true:name.endsWith('claim_v1')?{claimed:true,requestId,reservationToken,sendBefore:'2026-10-18T12:00:10Z',address:{street:'123 Example Rd',city:'Houston',state:'TX',zip:'77002'}}:{accepted:false},fetch:async()=>{sends++;return Response.json(evidence);}});
 assert.equal((await f.handler(req())).status,503);assert.equal(sends,1);
});

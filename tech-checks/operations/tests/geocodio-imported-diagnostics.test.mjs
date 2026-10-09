import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
globalThis.crypto??=webcrypto;
import {createGeocodeHandler} from '../../supabase/functions/camera-field-geocode/index.ts';
import {addressDigest} from '../../supabase/functions/camera-field-geocode/censusAddress.ts';
import {GeocodeDependencyError,geocodeDependencyCode,SOURCE_ORG,sourceIdentity} from '../../supabase/functions/camera-field-geocode/importedSources.ts';
import {processImportedGeocodes,importedGeocodeFailure} from '../../supabase/functions/camera-field-geocode/importedGeocodeSweep.ts';

const secret='Authorization: Bearer private-key; unit=PRIVATE-991; 999 Private Street; https://private.example/?token=private-token; vendor-body';
const failure=()=>Object.assign(new Error(secret,{cause:new Error(secret)}),{url:secret,headers:{Authorization:secret},toJSON(){throw Error('must never serialize an error');}});
const id='12345678-1234-1234-1234-123456789012',key='a'.repeat(64),address='123 Main St, Houston, TX 77002';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
async function harness({stage='census',rpcFailure,readFailure,queue,claim,reservation,beforeStale=false,providerFailure=false,rpcHook}={}){
 const binding={schemaVersion:1,organizationId:SOURCE_ORG,sourceSystem:'mhelpdesk_product_import',entityKind:'equipment_unit',nativeUnitId:id,productId:'12345',sourceRevision:id,
  unitNumber:'HELIOS 099HDC4',family:'HELIOS',variant:null,sourceFileSha256:key,sourceRowSha256:key,addressSha256:await addressDigest(address),nativeGuardSha256:key,
  installation:{street:'123 Main St',city:'Houston',state:'TX',zip:'77002'},suppliedComponents:{street:true,city:true,state:true,zip:true},eligibility:'FIELD',eventId:'1'};
 let dueReads=0,currentReads=0;const calls=[],finishes=[];
 const rpc=async(name,args)=>{
  calls.push(name);await rpcHook?.(name,args);
  if(name===rpcFailure)throw failure();
  if(name==='verify_camera_health_cron_secret')return true;
  if(name==='cos_field_geocode_list_due')return [{auditId:'41',unitKey:'OWNER 41',address}];
  if(name==='cos_field_geocode_claim')return {claimed:true,claimToken:id};
  if(name==='cos_field_geocode_finish')return {accepted:true,record:{status:'success'}};
  if(name==='cos_field_geocode_fallback_list_due')return [];
  if(name==='cos_imported_geocode_cursor_read')return {eventId:'0',scanGeneration:id};
  if(name==='cos_imported_geocode_sync')return {accepted:true,eventId:'1',scanGeneration:id,applied:1};
  if(name==='cos_imported_geocode_scan_complete')return {accepted:true};
  if(name==='cos_imported_geocode_postal_retry_list_due')return [];
  if(name==='cos_imported_geocode_postal_ordinary_list_due')return dueReads++?[]:queue??[{binding,stage}];
  if(name==='cos_imported_geocode_invalidate')return {accepted:true};
  if(name==='cos_imported_geocode_census_claim')return claim??{claimed:true,claimToken:id};
  if(name==='cos_imported_geocode_reserve')return reservation??{reserved:true,reservationToken:id,sendBefore:new Date(Date.now()+10000).toISOString()};
  if(['cos_imported_geocode_census_finish','cos_imported_geocode_finish'].includes(name)){finishes.push(args);return {accepted:true};}
  throw Error('Unexpected fixture RPC');
 };
 const requestFetch=async(url,init)=>{
  if(new URL(url).hostname==='tughscoxralhofrckvxy.supabase.co'){
   const body=JSON.parse(init.body),phase=body.action==='list_changes'?'source_changes':['source_sync_read','source_before','source_after'][currentReads++];
   if(readFailure?.phase===phase)return readFailure.run();
   if(body.action==='list_changes')return json({events:[{...sourceIdentity(binding),eventId:'1',kind:'upsert'}],nextEventId:'1'});
   return json({sources:body.sources.map(()=>beforeStale&&phase==='source_before'?null:binding)});
  }
  if(providerFailure&&calls.includes(stage==='census'?'cos_imported_geocode_census_claim':'cos_imported_geocode_reserve'))throw failure();
  if(new URL(url).hostname==='geocoding.geo.census.gov')return json({result:{addressMatches:[{matchedAddress:address,coordinates:{x:-95,y:29}}]}});
  return json({results:[{address_components:{number:'123',formatted_street:'Main St',city:'Houston',state_province:'TX',postal_code:'77002',country:'US'},formatted_address:address,location:{lat:29,lng:-95},accuracy:1,accuracy_type:'rooftop'}]});
 };
 const options={rpc,fetch:requestFetch,sourceReadKey:key,geocodioApiKey:'fixture',verifyFleetActor:async()=>true};
 return {options,binding,calls,finishes,run:()=>createGeocodeHandler(options)(new Request('https://fixture',{method:'POST',headers:{'x-camera-cron-secret':'fixture'},body:'{}'}))};
}
async function receipt(h,stage,code){
 const response=await h.run(),text=await response.text();assert.equal(response.status,200);assert.equal(text.includes(secret),false);
 for(const value of ['private-key','PRIVATE-991','Private Street','private.example','private-token','vendor-body'])assert.equal(text.includes(value),false);
 const body=JSON.parse(text);assert.equal(body.ok,true);assert.deepEqual(body.results,[{auditId:'41',status:'success'}]);assert.deepEqual(body.fallbackResults,[]);
 assert.deepEqual(body.importedResults,{status:'unavailable',stage,code});return body;
}
for(const [rpcName,stage,provider,beforeStale] of [
 ['cursor_read','cursor_read'],['sync','source_sync'],['scan_complete','scan_complete'],['postal_ordinary_list_due','queue_read'],['postal_retry_list_due','queue_read'],
 ['invalidate','source_invalidate','census',true],['census_claim','census_claim'],['reserve','geocodio_reserve','geocodio'],
 ['census_finish','census_finish'],['finish','geocodio_finish','geocodio'],
])test('HTTP keeps successful Owner result and redacts '+stage+' RPC failure',async()=>{
 await receipt(await harness({rpcFailure:'cos_imported_geocode_'+rpcName,stage:provider,beforeStale}),stage,'rpc_error');
});
for(const phase of ['source_changes','source_sync_read','source_before','source_after'])test('HTTP identifies '+phase+' bridge read without error data',async()=>{
 const h=await harness({readFailure:{phase,run(){throw failure();}}});await receipt(h,phase,'source_transport');
 if(phase==='source_after')assert.equal(h.finishes.length,0);
});
for(const [code,run] of [
 ['source_http',()=>new Response(secret,{status:503})],['source_body',()=>new Response(null)],
 ['source_body',()=>new Response('x'.repeat(524289))],['source_json',()=>new Response(secret)],['source_shape',()=>json({sources:secret})],
])test('HTTP allowlists '+code+' bridge failure',async()=>{await receipt(await harness({readFailure:{phase:'source_before',run}}),'source_before',code);});
for(const [options,stage,code] of [
 [{queue:{error:secret}},'queue_read','queue_shape'],[{queue:[{binding:{address:secret},stage:'census'}]},'queue_binding','binding_shape'],
 [{claim:{claimed:true,claimToken:secret}},'census_claim','claim_shape'],
 [{stage:'geocodio',reservation:{reserved:true,reservationToken:secret,sendBefore:secret}},'geocodio_reserve','reservation_shape'],
])test('HTTP allowlists '+code+' validation failure',async()=>{await receipt(await harness(options),stage,code);});
test('malformed cursor gets a fixed diagnostic before reading sources',async()=>{
 const h=await harness(),rpc=h.options.rpc;h.options.rpc=(name,args)=>name==='cos_imported_geocode_cursor_read'?Promise.resolve({eventId:secret,scanGeneration:secret}):rpc(name,args);
 await receipt(h,'cursor_read','cursor_shape');
});
for(const stage of ['census','geocodio'])test(stage+' provider setup exception retains its own stage and redacts its error',async()=>{
 const h=await harness({stage}),rpc=h.options.rpc,OriginalURL=globalThis.URL;
 h.options.rpc=(name,args)=>name==='cos_field_geocode_claim'?Promise.resolve({claimed:false,record:{status:'success'}}):rpc(name,args);
 const provider=stage==='census'?'https://geocoding.geo.census.gov/geocoder/locations/address':'https://api.geocod.io/v2/geocode';
 globalThis.URL=class extends OriginalURL{constructor(url,base){if(url===provider)throw failure();super(url,base);}};
 try{await receipt(h,stage+'_provider','unexpected');}finally{globalThis.URL=OriginalURL;}
});
for(const stage of ['census','geocodio'])test(stage+' success and handled provider failure retain the imported summary contract',async()=>{
 for(const providerFailure of [false,true]){
  const h=await harness({stage,providerFailure}),response=await h.run(),body=await response.json();assert.equal(response.status,200);
  assert.deepEqual(body.importedResults,{configured:true,syncedSources:1,consideredAddresses:1,censusSucceeded:!providerFailure&&stage==='census'?1:0,geocodioSucceeded:!providerFailure&&stage==='geocodio'?1:0,deferred:providerFailure?1:0,stale:0});
  assert.equal(h.finishes.length,1);assert.equal(h.finishes[0].p_status,providerFailure?'provider_error':'success');assert.equal(JSON.stringify(body).includes(secret),false);
 }
});
test('unknown and hostile exceptions cannot smuggle fields into the receipt',async()=>{
 const fallback={status:'unavailable',stage:'unknown',code:'unexpected'};
 for(const error of [failure(),{stage:secret,code:secret},new Proxy({}, {getPrototypeOf(){throw failure();}})])assert.deepEqual(importedGeocodeFailure(error),fallback);
 const h=await harness({rpcFailure:'cos_imported_geocode_postal_ordinary_list_due'});let caught;
 try{await processImportedGeocodes({...h.options,deadlineMs:Date.now()+100000});}catch(error){caught=error;}
 assert.ok(caught);caught.code=secret;assert.deepEqual(importedGeocodeFailure(caught),fallback);
 let reads=0;Object.defineProperty(caught,'code',{get(){return reads++?'private-key':'rpc_error';}});
 assert.deepEqual(importedGeocodeFailure(caught),{status:'unavailable',stage:'queue_read',code:'rpc_error'});assert.equal(reads,1);
 Object.defineProperty(caught,'stage',{get(){throw failure();}});assert.deepEqual(importedGeocodeFailure(caught),fallback);
 const dependency=new GeocodeDependencyError('rpc_http');let codeReads=0;
 Object.defineProperty(dependency,'code',{get(){return codeReads++?secret:'rpc_http';}});assert.equal(geocodeDependencyCode(dependency),'rpc_http');assert.equal(codeReads,1);
 assert.equal(geocodeDependencyCode(new Proxy({}, {getPrototypeOf(){throw failure();}})),null);
});
test('concurrent reservation failure retains its own stage while another claim is pending',async()=>{
 const h=await harness();let release,entered=false;
 const waiting=new Promise(resolve=>{release=resolve;});
 const rpc=h.options.rpc;h.options.rpc=async(name,args)=>{
  if(name==='cos_imported_geocode_postal_ordinary_list_due')return [{binding:h.binding,stage:'geocodio'},{binding:h.binding,stage:'census'}];
  if(name==='cos_imported_geocode_reserve'){await waiting;throw failure();}
  if(name==='cos_imported_geocode_census_claim'){entered=true;release();await new Promise(resolve=>setTimeout(resolve,5));return {claimed:false};}
  return rpc(name,args);
 };
 await receipt(h,'geocodio_reserve','rpc_error');assert.equal(entered,true);
});
test('actual serve transport reports fixed RPC transport, HTTP, and JSON codes',async()=>{
 const originalDeno=globalThis.Deno,originalFetch=globalThis.fetch;let handler;
 globalThis.Deno={env:{get(name){return {SUPABASE_URL:'https://fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture',COS_GEOCODE_SOURCE_READ_KEY:key}[name];}},serve(value){handler=value;}};
 try{
  await import('../../supabase/functions/camera-field-geocode/serve.ts');assert.equal(typeof handler,'function');
  for(const [code,fail] of [['rpc_transport',()=>{throw failure();}],['rpc_http',()=>new Response(secret,{status:503})],['rpc_json',()=>new Response(secret)]]){
   globalThis.fetch=async(url)=>{
    if(url.endsWith('/verify_camera_health_cron_secret'))return json(true);
    if(url.endsWith('/cos_field_geocode_list_due'))return json([]);
    if(url.endsWith('/cos_imported_geocode_cursor_read'))return fail();
    throw Error('Unexpected fixture request');
   };
   const response=await handler(new Request('https://fixture',{method:'POST',headers:{'x-camera-cron-secret':'fixture'},body:'{}'}));
   assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,results:[],fallbackResults:[],importedResults:{status:'unavailable',stage:'cursor_read',code}});
  }
 }finally{globalThis.fetch=originalFetch;if(originalDeno===undefined)delete globalThis.Deno;else globalThis.Deno=originalDeno;}
});
test('enrolled postal Census takes priority over ordinary fallback for the same full-address hash',async()=>{
 const h=await harness({stage:'geocodio'}),rpc=h.options.rpc;
 h.options.rpc=(name,args)=>name==='cos_imported_geocode_postal_retry_list_due'?Promise.resolve([{binding:h.binding,stage:'census'}]):rpc(name,args);
 const response=await h.run(),body=await response.json();assert.equal(response.status,200);assert.equal(body.importedResults.censusSucceeded,1);assert.equal(body.importedResults.geocodioSucceeded,0);
 assert.equal(h.calls.includes('cos_imported_geocode_census_claim'),true);assert.equal(h.calls.includes('cos_imported_geocode_reserve'),false);
});
test('malformed or oversized enrolled cohort cannot authorize a claim or leak provider material',async()=>{
 for(const invalid of [{error:secret},Array.from({length:81},()=>({binding:{address:secret},stage:'census'}))]){
  const h=await harness(),rpc=h.options.rpc;
  h.options.rpc=(name,args)=>name==='cos_imported_geocode_postal_retry_list_due'?Promise.resolve(invalid):rpc(name,args);
  await receipt(h,'queue_read','queue_shape');assert.equal(h.calls.includes('cos_imported_geocode_census_claim'),false);assert.equal(h.calls.includes('cos_imported_geocode_reserve'),false);
 }
});

import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
globalThis.crypto??=webcrypto;
import {fixture as nativeFixture,reset as nativeReset,seed,install,rpc as nativeRPC,ORG,hash} from './fixtures/geocode-sources-database-fixture.mjs';
import {fixture as legacyFixture,reset as legacyReset,credits} from './fixtures/geocodio-database-fixture.mjs';
import {createGeocodeSourcesHandler} from '../../supabase/functions/cos-geocode-sources/index.ts';
import {createGeocodeHandler} from '../../supabase/functions/camera-field-geocode/index.ts';
import {processImportedGeocodes} from '../../supabase/functions/camera-field-geocode/importedGeocodeSweep.ts';
import {GeocodeDependencyError} from '../../supabase/functions/camera-field-geocode/importedSources.ts';

let native,legacy;
before(async()=>{native=await nativeFixture();legacy=await legacyFixture({imported:true});});
after(async()=>{await native?.close();await legacy?.close();});
beforeEach(async()=>{await nativeReset(native);await legacyReset(legacy);});
const key='a'.repeat(64),secret='private-token; 999 Private Street; https://private.example/vendor-body';
const failure=()=>new Error(secret,{cause:new Error(secret)});
const json=body=>new Response(JSON.stringify(body));
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function latch(){let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};}
function serial(fn){let previous=Promise.resolve();return (...args)=>{const task=previous.then(()=>fn(...args));previous=task.catch(()=>{});return task;};}

async function harness({stage='census',count=5}={}){
 const sources=[];
 for(let i=0;i<count;i++){
  const record=await seed(native,{label:`HELIOS ${100+i}HDC4`,product:String(12345+i)});
  record.installation.street=`${123+i} Main St`;record.addressSha256=hash(`${123+i} main st, houston, tx 77002-1234`);
  sources.push(...await install(native,[record]));
 }
 const hooks={},events=[],requests=[],finishes=[];let active=0,completed=false,postReturnOperations=0,censusMatch=stage==='census';
 const tracked=async(kind,operation)=>{
  if(completed)postReturnOperations++;active++;events.push(kind+':start');
  try{return await operation();}finally{active--;events.push(kind+':settled');}
 };
 const rawRpc=serial(async(name,args)=>{
  if(name==='verify_camera_health_cron_secret')return true;
  if(name==='cos_field_geocode_list_due'||name==='cos_field_geocode_fallback_list_due')return [];
  await legacy.exec('reset role;set role service_role');
  try{return (await legacy.query(`select public.${name}(${Object.keys(args).map((name,i)=>name+'=>$'+(i+1)).join(',')}) result`,Object.values(args))).rows[0].result;}
  finally{await legacy.exec('reset role');}
 });
 const rpc=(name,args)=>tracked(name,async()=>{
  const next=()=>rawRpc(name,args);
  const result=await (hooks.rpc?hooks.rpc(name,args,next):next());
  if(name==='cos_imported_geocode_census_finish'||name==='cos_imported_geocode_finish')finishes.push({name,args,result});
  return result;
 });
 const bridge=createGeocodeSourcesHandler({readKey:key,rpc:serial((name,args)=>nativeRPC(native,name.replace('cos_geocode_sources_',''),args))});
 const requestFetch=(url,init)=>tracked('fetch',async()=>{
  const parsed=new URL(url);
  if(parsed.hostname==='tughscoxralhofrckvxy.supabase.co'){
   const body=JSON.parse(init.body),next=()=>bridge(new Request(url,init));
   return hooks.source?hooks.source(body,next):next();
  }
  const stage=parsed.hostname==='geocoding.geo.census.gov'?'census':'geocodio';
  if(stage==='geocodio')assert.equal(parsed.origin,'https://api.geocod.io');
  const street=parsed.searchParams.get('street'),source=sources.find(item=>item.installation.street===street);
  assert.ok(source,'provider requests use a checked fixture source');requests.push({stage,source});
  const next=()=>{
   const address=`${street}, Houston, TX 77002-1234`;
   if(stage==='census')return json({result:{addressMatches:censusMatch?[{matchedAddress:address,coordinates:{x:-95,y:29}}]:[]}});
   return json({results:[{address_components:{number:street.split(' ')[0],formatted_street:'Main St',city:'Houston',state_province:'TX',postal_code:'77002-1234',country:'US'},formatted_address:address,location:{lat:29,lng:-95},accuracy:1,accuracy_type:'rooftop'}]});
  };
  return hooks.provider?hooks.provider(stage,source,next):next();
 });
 const options={rpc,fetch:requestFetch,sourceReadKey:key,geocodioApiKey:'fixture-only',verifyFleetActor:async()=>false};
 if(stage==='geocodio'){
  await processImportedGeocodes({...options,geocodioApiKey:undefined,deadlineMs:Date.now()+100000});
  events.length=0;requests.length=0;finishes.length=0;censusMatch=true;
 }
 return {sources,hooks,events,requests,finishes,options,
  get active(){return active;},get postReturnOperations(){return postReturnOperations;},
  run:async()=>{const response=await createGeocodeHandler(options)(new Request('https://fixture',{method:'POST',headers:{'x-camera-cron-secret':'fixture'},body:'{}'}));completed=true;assert.equal(response.status,200);return response.json();},
 };
}
const claimName=stage=>stage==='census'?'cos_imported_geocode_census_claim':'cos_imported_geocode_reserve';
const finishName=stage=>stage==='census'?'cos_imported_geocode_census_finish':'cos_imported_geocode_finish';
const diagnosticStage=stage=>stage==='census'?'census_claim':'geocodio_reserve';
async function records(stage){
 const cache=stage==='census'?'cos_imported_census_cache':'cos_field_geocode_fallback_cache';
 const requests=stage==='census'?'cos_imported_census_requests':'cos_geocodio_reservations';
 return {cache:(await legacy.query(`select address_sha256,status,attempts,active_request_id,lease_until from app_private.${cache} order by address_sha256`)).rows,
  requests:(await legacy.query(`select address_sha256,completed_at from app_private.${requests} order by address_sha256`)).rows,credits:await credits(legacy)};
}
async function settledReceipt(h,body,stage,code='rpc_error'){
 assert.deepEqual(body,{ok:true,results:[],fallbackResults:[],importedResults:{status:'unavailable',stage,code}});
 assert.equal(JSON.stringify(body).includes(secret),false);assert.equal(h.active,0,'handler returns only after every started dependency settles');
 const atReturn=h.events.slice();await turn();await turn();assert.deepEqual(h.events,atReturn,'no writes or provider completions after HTTP return');assert.equal(h.postReturnOperations,0);
}
async function pendingUntilReleased(h,gate,entered){
 let returned=false;const running=h.run().then(body=>{returned=true;return body;});
 await entered.promise;await turn();await turn();
 const wasReturned=returned;gate.release();const body=await running;
 assert.equal(wasReturned,false,'an error must not return while its sibling operation is pending');return body;
}
async function expectCache(stage,h,{success=3,pending=1,attempts=4}={}){
 const state=await records(stage);
 assert.equal(state.cache.filter(row=>row.status==='success').length,success);
 assert.equal(state.cache.filter(row=>row.status==='pending'&&row.active_request_id&&row.lease_until).length,pending);
 assert.equal(state.requests.length,attempts);assert.equal(state.requests.filter(row=>row.completed_at!==null).length,success);
 assert.equal(state.cache.reduce((sum,row)=>sum+row.attempts,0),attempts);assert.equal(state.credits,stage==='geocodio'?attempts:0);
 assert.equal(h.requests.filter(item=>item.source.nativeUnitId===h.sources[4]?.nativeUnitId).length,0,'failure stops before the next batch');
 return state;
}

for(const stage of ['census','geocodio'])test(stage+' claim acknowledgement failure settles delayed siblings and preserves charged leases',async()=>{
 const h=await harness({stage}),gate=latch(),entered=latch();
 h.hooks.rpc=async(name,args,next)=>{
  if(name!==claimName(stage))return next();
  const index=h.sources.findIndex(source=>source.nativeUnitId===args.p_binding.nativeUnitId),result=await next();
  assert.equal(result[stage==='census'?'claimed':'reserved'],true);
  if(index===0){await entered.promise;throw failure();}
  if(index===1){entered.release();await gate.promise;}
  return result;
 };
 const body=await pendingUntilReleased(h,gate,entered);await settledReceipt(h,body,diagnosticStage(stage));
 assert.equal(h.requests.length,3);assert.equal(h.finishes.length,3);await expectCache(stage,h);
});

for(const stage of ['census','geocodio'])test(stage+' finish failure waits for sibling persistence before returning',async()=>{
 const h=await harness({stage}),gate=latch(),entered=latch();let started=0;
 h.hooks.rpc=async(name,args,next)=>{
  if(name!==finishName(stage))return next();
  started++;const index=h.sources.findIndex(source=>source.nativeUnitId===args.p_binding.nativeUnitId);
  if(index===0){await entered.promise;throw failure();}
  if(index===1){entered.release();await gate.promise;}
  return next();
 };
 const body=await pendingUntilReleased(h,gate,entered);await settledReceipt(h,body,stage+'_finish');
 assert.equal(started,4);assert.equal(h.requests.length,4);assert.equal(h.finishes.length,3);await expectCache(stage,h);
});

for(const stage of ['census','geocodio'])test(stage+' unexpected provider setup failure still finishes delayed successful siblings',async()=>{
 const h=await harness({stage}),gate=latch(),entered=latch(),OriginalURL=globalThis.URL;
 const provider=stage==='census'?'https://geocoding.geo.census.gov/geocoder/locations/address':'https://api.geocod.io/v2/geocode';let failed=false;
 globalThis.URL=class extends OriginalURL{constructor(url,base){if(url===provider&&!failed){failed=true;throw failure();}super(url,base);}};
 h.hooks.provider=async(providerStage,source,next)=>{if(source.nativeUnitId===h.sources[1].nativeUnitId){entered.release();await gate.promise;}return next();};
 try{
  const body=await pendingUntilReleased(h,gate,entered);await settledReceipt(h,body,stage+'_provider','unexpected');
  assert.equal(h.requests.length,3);assert.equal(h.finishes.length,3);await expectCache(stage,h);
 }finally{globalThis.URL=OriginalURL;}
});

test('the first observed job error survives a later finish error, regardless of queue order',async()=>{
 const h=await harness(),failed=latch();
 h.hooks.rpc=async(name,args,next)=>{
  const index=h.sources.findIndex(source=>source.nativeUnitId===args.p_binding?.nativeUnitId);
  if(name===claimName('census')&&index===1){await next();failed.release();throw new GeocodeDependencyError('rpc_http');}
  if(name===claimName('census')&&index===0){await failed.promise;await turn();throw failure();}
  if(name===finishName('census')&&index===2)throw failure();
  return next();
 };
 const body=await h.run();await settledReceipt(h,body,'census_claim','rpc_http');
 assert.equal(h.requests.length,2);assert.equal(h.finishes.length,1);await expectCache('census',h,{success:1,pending:2,attempts:3});
});

for(const jobFailure of [false,true])test('failed fresh source read publishes nothing and preserves leases'+(jobFailure?' and the earlier error':''),async()=>{
 const h=await harness({stage:'geocodio'});let providerSeen=false;
 h.hooks.rpc=async(name,args,next)=>{
  const result=await next();
  if(jobFailure&&name===claimName('geocodio')&&args.p_binding.nativeUnitId===h.sources[0].nativeUnitId)throw failure();
  return result;
 };
 h.hooks.provider=async(stage,source,next)=>{providerSeen=true;return next();};
 h.hooks.source=async(body,next)=>{if(body.action==='read_current'&&providerSeen)throw failure();return next();};
 const body=await h.run();await settledReceipt(h,body,jobFailure?'geocodio_reserve':'source_after',jobFailure?'rpc_error':'source_transport');
 assert.equal(h.requests.length,jobFailure?3:4);assert.equal(h.finishes.length,0);await expectCache('geocodio',h,{success:0,pending:4});
});

test('a successful sibling whose native GPS changes is finished as stale, never published',async()=>{
 const h=await harness({stage:'geocodio'});
 h.hooks.rpc=async(name,args,next)=>{const result=await next();if(name===claimName('geocodio')&&args.p_binding.nativeUnitId===h.sources[0].nativeUnitId)throw failure();return result;};
 h.hooks.provider=async(stage,source,next)=>{if(source.nativeUnitId===h.sources[1].nativeUnitId)await native.query('update public.equipment_units set gps_latitude=31,gps_longitude=-96 where id=$1',[source.nativeUnitId]);return next();};
 const body=await h.run();await settledReceipt(h,body,'geocodio_reserve');
 const stale=h.finishes.find(item=>item.args.p_binding.nativeUnitId===h.sources[1].nativeUnitId);
 assert.equal(stale.args.p_source_current,false);assert.equal(stale.result.accepted,false);
 const state=await records('geocodio');assert.equal(state.cache.filter(row=>row.status==='success').length,2);assert.equal(state.credits,4);
 assert.equal(state.cache.some(row=>row.address_sha256===h.sources[1].addressSha256&&row.status==='success'),false);
});

test('queue read failure waits for its delayed sibling RPC, which can cancel stale postal rows',async()=>{
 const h=await harness(),gate=latch(),entered=latch();let queueMutation=0;
 h.hooks.rpc=async(name,args,next)=>{
  if(name==='cos_imported_geocode_postal_ordinary_list_due'){await entered.promise;throw failure();}
  if(name==='cos_imported_geocode_postal_retry_list_due'){entered.release();await gate.promise;const result=await next();queueMutation++;return result;}
  return next();
 };
 const body=await pendingUntilReleased(h,gate,entered);await settledReceipt(h,body,'queue_read');
 assert.equal(queueMutation,1);assert.equal(h.requests.length,0);assert.equal(h.finishes.length,0);assert.equal((await records('census')).requests.length,0);
});

test('all rejected jobs require no fresh source read or fabricated finish',async()=>{
 const h=await harness();let afterRead=false,claimed=false;
 h.hooks.rpc=async(name,args,next)=>{if(name===claimName('census')){claimed=true;throw failure();}return next();};
 h.hooks.source=(body,next)=>{if(body.action==='read_current'&&claimed)afterRead=true;return next();};
 const body=await h.run();await settledReceipt(h,body,'census_claim');
 assert.equal(afterRead,false);assert.equal(h.requests.length,0);assert.equal(h.finishes.length,0);await expectCache('census',h,{success:0,pending:0,attempts:0});
});

test('a delayed reservation that expires is not sent while a sibling fails',async()=>{
 const h=await harness({stage:'geocodio'}),gate=latch(),entered=latch();
 h.hooks.rpc=async(name,args,next)=>{
  const result=await next();if(name!==claimName('geocodio'))return result;
  const index=h.sources.findIndex(source=>source.nativeUnitId===args.p_binding.nativeUnitId);
  if(index===0){await entered.promise;throw failure();}
  if(index===1){entered.release();await gate.promise;return {...result,sendBefore:new Date(Date.now()-1).toISOString()};}
  return result;
 };
 const body=await pendingUntilReleased(h,gate,entered);await settledReceipt(h,body,'geocodio_reserve');
 assert.equal(h.requests.length,2);assert.equal(h.finishes.length,2);await expectCache('geocodio',h,{success:2,pending:2});
});

for(const stage of ['census','geocodio'])test(stage+' normal four-job batch retains its successful summary and accounting',async()=>{
 const h=await harness({stage,count:4}),body=await h.run();
 assert.deepEqual(body.importedResults,{configured:true,syncedSources:stage==='census'?4:0,consideredAddresses:4,censusSucceeded:stage==='census'?4:0,geocodioSucceeded:stage==='geocodio'?4:0,deferred:0,stale:0});
 assert.equal(h.active,0);assert.equal(h.requests.length,4);assert.equal(h.finishes.length,4);await expectCache(stage,h,{success:4,pending:0});
});

test('ordinary handled provider errors are persisted as failures without rejecting the whole batch',async()=>{
 const h=await harness({stage:'geocodio',count:4});
 h.hooks.provider=async(stage,source,next)=>{if(source.nativeUnitId===h.sources[0].nativeUnitId)throw failure();return next();};
 const body=await h.run();assert.equal(body.importedResults.geocodioSucceeded,3);assert.equal(body.importedResults.deferred,1);assert.equal(h.active,0);
 assert.equal(h.finishes.length,4);assert.equal(h.finishes.find(item=>item.args.p_binding.nativeUnitId===h.sources[0].nativeUnitId).args.p_status,'provider_error');
 const state=await records('geocodio');assert.equal(state.cache.filter(row=>row.status==='provider_error').length,1);assert.equal(state.credits,4);assert.equal(state.requests.filter(row=>row.completed_at).length,4);
});

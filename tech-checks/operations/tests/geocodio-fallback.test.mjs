import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto,createHash} from 'node:crypto';
globalThis.crypto??=webcrypto;
import {addressDigest} from '../../supabase/functions/camera-field-geocode/censusAddress.ts';
import {safeGeocodioParts,selectGeocodioResult,geocodioAddress,rateLimitSeconds} from '../../supabase/functions/camera-field-geocode/geocodioAddress.ts';
import {processGeocodioFallback} from '../../supabase/functions/camera-field-geocode/geocodioFallback.ts';
import {createGeocodeHandler} from '../../supabase/functions/camera-field-geocode/index.ts';
import {createFleetVerifier} from '../../supabase/functions/camera-field-geocode/fleetAuthorization.ts';
import {projectFallbackGeocodes} from '../../supabase/functions/cos-operations-pages/fallbackGeocodeProjection.ts';
import {checkedAddressEstimate,addressEstimateLabel} from '../src/fieldAddressEstimates.ts';
import {isCurrentFieldPin,locationTag,locationExplanation} from '../src/fieldLocations.ts';
const legacyBaselineHashes={"fleetAuthorization.ts": "6de420a18496d981e83f3cda7b29b6427e7594d67e7ce7155fea8d2ca86676d3", "censusAddress.ts": "e8040941fe48a400f872c9026ef05eb9ff01f9445e7e5809e72c751ed60302da"};
const address='100 Example Road, Test City, TX 77001',at='2026-01-01T00:00:00Z';
const result=()=>({address_components:{number:'100',formatted_street:'Example Rd',city:'Test City',state_province:'TX',postal_code:'77001',country:'US'},formatted_address:'100 Example Rd, Test City, TX 77001',location:{lat:30,lng:-95},accuracy:1,accuracy_type:'range_interpolation',match_type:null,source:'Never copied provider source',unapproved:'Never copied'});
const payload=(patch={})=>({results:[{...result(),...patch}]});
const response=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers});
const row=async()=>({auditId:'41',unitKey:'SNIPER 901',address,addressSha256:await addressDigest(address)});
const record=async(patch={})=>({...await row(),status:'success',provider:'geocodio',confidence:'estimate',verified:false,liveGps:false,latitude:30,longitude:-95,matchedAddress:address,geocodedAt:at,accuracyType:'range_interpolation',accuracy:1,matchType:null,source:'geocodio_automatic_address_estimate',...patch});
const unit=()=>({id:'unit-fixture',unitNumber:'Sniper 901',placementUnitKey:'SNIPER 901',placementAuditId:'41',placement:'FIELD',placementSource:'owner',status:'field',currentLocationType:'field',address,locationVerification:'address_changed',latitude:null,longitude:null,hasUnitGps:false,readOnly:false,locationGeocode:{status:'no_match',provider:'us_census_address_range'}});
test('single exact range and rooftop results are unverified estimates with minimal output',()=>{
 for(const accuracy_type of ['rooftop','range_interpolation']){
  const r=selectGeocodioResult(address,payload({accuracy_type}));assert.equal(r.status,'success');assert.equal(r.accuracyType,accuracy_type);assert.equal(r.accuracy,1);assert.equal(r.latitude,30);assert.equal(JSON.stringify(r).includes('Never copied'),false);
 }
});
for(const [name,patch] of Object.entries({low_accuracy:{accuracy:.89},over_accuracy:{accuracy:1.1},nan:{accuracy:NaN},city_centroid:{accuracy_type:'place'},street_centroid:{accuracy_type:'street_center'},nearest:{accuracy_type:'nearest_rooftop_match'},point:{accuracy_type:'point'},wrong_lat:{location:{lat:91,lng:-95}},numeric_strings:{location:{lat:'30',lng:-95}},unit_match:{match_type:'unit'},range_parcel:{match_type:'parcel_centroid'},warnings:{_warnings:['untrusted']},wrong_formatted:{formatted_address:'101 Example Rd, Test City, TX 77001'},hostile_formatted:{formatted_address:'100 Example Rd, Test City, TX 77001\nsecret'}}))test('reject '+name,()=>assert.equal(selectGeocodioResult(address,payload(patch)).status,'no_match'));
for(const [name,patch] of Object.entries({house:{number:'101'},street:{formatted_street:'Wrong Rd'},city:{city:'Another City'},state:{state_province:'LA'},zip:{postal_code:'77002'},country:{country:'CA'},unit:{unit_number:'A'},unit_type:{unit_type:'Apt'},sensitive:{formatted_street:'Example Rd password secret'}}))test('reject component '+name,()=>assert.equal(selectGeocodioResult(address,payload({address_components:{...result().address_components,...patch}})).status,'no_match'));
test('reject empty ambiguous malformed responses and top-level warnings',()=>{
 for(const p of [{results:[]},{results:[result(),result()]},{results:[null]},{results:'bad'},{results:[result()],_warnings:['untrusted']}])assert.equal(selectGeocodioResult(address,p).status,'no_match');
});
for(const unsafe of ['100 Example Rd Apt 2, Test City, TX 77001','100 Example Rd password abc, Test City, TX 77001','100 Example Rd, Test City, TX 77001\nGate code 1234','https://example.com','100 Example Rd call John, Test City, TX 77001'])test('refuse unsafe address without sending: '+unsafe.slice(0,25),async()=>{let calls=0;assert.equal(safeGeocodioParts(unsafe),null);const r=await geocodioAddress(unsafe,'synthetic-key',async()=>{calls++;throw Error()});assert.equal(calls,0);assert.equal(r.status,'no_match');});
test('GET bearer request uses only address components and never a query key or app data',async()=>{
 let calls=0;const r=await geocodioAddress(address,'fixture-only-secret',async(url,init)=>{calls++;const u=new URL(url);assert.equal(u.origin,'https://api.geocod.io');assert.equal(u.pathname,'/v2/geocode');assert.deepEqual([...u.searchParams.keys()],['street','city','state_province','postal_code','country']);assert.equal(u.searchParams.get('country'),'US');assert.equal(init.method,'GET');assert.equal(init.headers.Authorization,'Bearer fixture-only-secret');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');return response(payload());});assert.equal(calls,1);assert.equal(r.status,'success');assert.equal(JSON.stringify(r).includes('fixture-only-secret'),false);
});
for(const [status,reason] of [[403,'provider_forbidden'],[401,'provider_forbidden'],[429,'provider_rate_limited'],[500,'provider_unavailable']])test('safe status '+status,async()=>{const r=await geocodioAddress(address,'fixture',async()=>response({error:'secret URL raw token'},status));assert.equal(r.reason,reason);assert.equal(JSON.stringify(r).includes('secret'),false);});
test('422 returns no match and invalid response/network exceptions are sanitized',async()=>{
 assert.equal((await geocodioAddress(address,'fixture',async()=>response({error:'ignored'},422))).status,'no_match');
 assert.equal((await geocodioAddress(address,'fixture',async()=>new Response('not JSON'))).reason,'invalid_response');
 assert.deepEqual(await geocodioAddress(address,'fixture',async()=>{throw Error('Authorization: fixture')}),{status:'provider_error',reason:'provider_unavailable'});
});
test('429 numeric duration or Retry-After parsed conservatively',()=>{
 assert.equal(rateLimitSeconds(new Headers({'X-RateLimit-Period':'3600'})),3600);assert.equal(rateLimitSeconds(new Headers({'Retry-After':'300'})),300);assert.equal(rateLimitSeconds(new Headers({'Retry-After':'https://secret'})),86400);assert.equal(rateLimitSeconds(new Headers({'Retry-After':'999999'})),86400);
});
test('missing key fails closed before SQL and vendor calls',async()=>{assert.deepEqual(await processGeocodioFallback({rpc:()=>{throw Error('called')}},{}),[]);});
test('durable reservation is required; replay/cached/deferred never calls vendor',async()=>{
 for(const state of ['replayed','success','deferred']){let sends=0;const calls=[];const r=await processGeocodioFallback({geocodioApiKey:'fixture',fetch:async()=>{sends++;throw Error()},rpc:async(name,args)=>{calls.push(name);return name.endsWith('list_due')?[await row()]:{reserved:false,record:{status:state}};}},{});assert.equal(sends,0);assert.equal(r[0].status,state);assert.equal(calls.length,2);}
});
test('one reservation one outbound attempt and safe bound finish',async()=>{
 const calls=[];let sends=0;const r=await processGeocodioFallback({geocodioApiKey:'fixture',fetch:async()=>{sends++;return response(payload())},rpc:async(name,args)=>{calls.push({name,args});if(name.endsWith('list_due'))return [await row()];if(name.endsWith('reserve'))return {reserved:true,reservationToken:'12345678-1234-1234-1234-123456789012',sendBefore:new Date(Date.now()+10000).toISOString()};return {accepted:true,record:{status:'success'}};}},{p_audit_id:'41',p_unit_key:'SNIPER 901'});
 assert.equal(sends,1);assert.equal(r[0].status,'success');assert.match(calls[1].args.p_request_id,/^[a-f0-9-]{36}$/);assert.equal(calls[2].args.p_accuracy_type,'range_interpolation');assert.equal(calls[2].args.p_accuracy,1);assert.equal(JSON.stringify(calls).includes('fixture'),false);
});
test('expired reservation and stale hash cannot send',async()=>{
 for(const staleHash of [false,true]){let sends=0;await processGeocodioFallback({geocodioApiKey:'fixture',fetch:async()=>{sends++;throw Error()},rpc:async(name)=>name.endsWith('list_due')?[{...await row(),...(staleHash?{addressSha256:'0'.repeat(64)}:{})}]:{reserved:true,reservationToken:'12345678-1234-1234-1234-123456789012',sendBefore:at}},{});assert.equal(sends,0);}
});
test('uncertain finish does not replay outbound request',async()=>{
 let sends=0;await assert.rejects(()=>processGeocodioFallback({geocodioApiKey:'fixture',fetch:async()=>{sends++;return response(payload())},rpc:async(name)=>name.endsWith('list_due')?[await row()]:name.endsWith('reserve')?{reserved:true,reservationToken:'12345678-1234-1234-1234-123456789012',sendBefore:new Date(Date.now()+10000).toISOString()}:(()=>{throw Error('unknown commit')})()},{}));assert.equal(sends,1);
});
test('legacy endpoint retains method, origin, body and authorization gates',async()=>{
 let calls=0;const handler=createGeocodeHandler({rpc:async()=>{calls++;return []},verifyFleetActor:async()=>false,geocodioApiKey:'fixture',fetch:async()=>{throw Error('no')}});
 assert.equal((await handler(new Request('https://fixture',{method:'GET'}))).status,405);
 assert.equal((await handler(new Request('https://fixture',{method:'POST',headers:{origin:'https://untrusted.invalid'},body:'{}'}))).status,403);
 assert.equal((await handler(new Request('https://fixture',{method:'POST',body:'{}'}))).status,403);assert.equal(calls,0);
});
test('active Owner and approved IT only; Service and unapproved IT denied',async()=>{
 const approved='4f7044b5-86b6-411f-8898-39bb64b4ddbc',other='12345678-1234-1234-1234-123456789012';
 for(const [id,role,active,want] of [[other,'owner',true,true],[approved,'it',true,true],[other,'it',true,false],[approved,'service',true,false],[other,'owner',false,false]]){
  const check=createFleetVerifier(async(path)=>path==='/auth/v1/user'?{id}:[{user_id:id,role,active,archived_at:null}],'fixture-service');assert.equal(await check('Bearer fixture-user'),want);
 }
});
test('native projection uses exact audit/address binding and preserves verified GPS and Census success',async()=>{
 const source=unit(),r=await record();const snapshot={items:[source],inventoryItems:[source]};const out=await projectFallbackGeocodes(snapshot,[r]);assert.equal(out.items[0].locationGeocode.provider,'geocodio');assert.equal(out.items[0].latitude,null);assert.equal(out.items[0].hasUnitGps,false);
 for(const patch of [{auditId:'42'},{unitKey:'Other Unit'},{addressSha256:'0'.repeat(64)},{accuracyType:'place'},{accuracy:.1},{verified:true},{liveGps:true}])assert.deepEqual((await projectFallbackGeocodes(snapshot,[{...r,...patch}])).items[0],source);
 for(const patch of [{locationVerification:'owner_verified',latitude:31,longitude:-96},{placement:'UNKNOWN'},{placementStatus:'needs_identity_review'},{locationGeocode:{status:'success',provider:'us_census_address_range'}}]){const u={...source,...patch};assert.deepEqual((await projectFallbackGeocodes({items:[u],inventoryItems:[u]},[r])).items[0],u);}
});
test('frontend new estimates stay honest EST-only and do not become verified unit GPS',async()=>{
 for(const accuracyType of ['rooftop','range_interpolation']){const u={...unit(),locationGeocode:await record({accuracyType})};const e=await checkedAddressEstimate(u);assert.equal(e.provider,'geocodio');assert.match(addressEstimateLabel(e),/Geocodio/);assert.equal(isCurrentFieldPin(u),false);assert.equal(e.accuracyType,accuracyType);}
 const u={...unit(),locationGeocode:await record()};for(const patch of [{placement:'UNKNOWN'},{placementStatus:'needs_identity_review'},{placementAuditId:'42'},{address:'101 Example Road, Test City, TX 77001'},{locationVerification:'owner_verified'}])assert.equal(await checkedAddressEstimate({...u,...patch}),null);
});
test('deferred free-only queue has safe explanation',()=>{const u={...unit(),locationGeocode:{status:'deferred'}};assert.equal(locationTag(u),'LOOKUP DELAYED');assert.match(locationExplanation(u),/without paid lookups/);});
test('legacy auth and Census adapter unchanged; no logging or vendor query credentials',()=>{
 for(const [name,sha] of Object.entries(legacyBaselineHashes))assert.equal(createHash('sha256').update(readFileSync(new URL('../../supabase/functions/camera-field-geocode/'+name,import.meta.url))).digest('hex'),sha);
 const code=readFileSync(new URL('../../supabase/functions/camera-field-geocode/geocodioAddress.ts',import.meta.url),'utf8');assert.doesNotMatch(code,/console\.|api_key|Deno\.env/);
});
test('timeout produces only safe retry code',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const promise=geocodioAddress(address,'fixture-only-secret',async(_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('secret raw network URL')))));
 t.mock.timers.tick(10001);const r=await promise;assert.deepEqual(r,{status:'provider_error',reason:'provider_timeout'});t.mock.timers.reset();
});
test('oversized response is rejected without copying provider data',async()=>{
 const r=await geocodioAddress(address,'fixture',async()=>new Response('x'.repeat(262145)));assert.equal(r.status,'provider_error');assert.equal(JSON.stringify(r).length<150,true);
});
test('saved-address handler runs Census first then fallback, never accepts browser addresses',async()=>{
 let external=[];const saved=await row();
 const rpc=async(name,args)=>{if(name==='cos_field_geocode_list_due')return [saved];if(name==='cos_field_geocode_claim')return {claimed:true,claimToken:'12345678-1234-1234-1234-123456789012'};if(name==='cos_field_geocode_finish'){assert.equal(args.p_status,'no_match');return {accepted:true,record:{status:'no_match'}};}if(name==='cos_field_geocode_fallback_list_due')return [saved];if(name==='cos_field_geocode_fallback_reserve')return {reserved:true,reservationToken:'12345678-1234-1234-1234-123456789012',sendBefore:new Date(Date.now()+10000).toISOString()};if(name==='cos_field_geocode_fallback_finish')return {accepted:true,record:{status:'success'}};throw Error(name);};
 const handler=createGeocodeHandler({rpc,verifyFleetActor:async()=>true,geocodioApiKey:'fixture',fetch:async(url)=>{external.push(new URL(url).hostname);return new URL(url).hostname==='geocoding.geo.census.gov'?response({result:{addressMatches:[]}}):response(payload());}});
 const r=await handler(new Request('https://fixture',{method:'POST',body:JSON.stringify({unitKey:saved.unitKey,auditId:saved.auditId})}));assert.equal(r.status,200);assert.deepEqual(external,['geocoding.geo.census.gov','api.geocod.io']);assert.deepEqual((await r.json()).fallbackResults,[{auditId:'41',status:'success'}]);
 const rejected=await handler(new Request('https://fixture',{method:'POST',body:JSON.stringify({unitKey:saved.unitKey,auditId:saved.auditId,address:'unapproved address'})}));assert.equal(rejected.status,400);assert.equal(external.length,2);
});
test('Census-only behavior stays available when fallback configuration is absent',async()=>{
 let fetched=0;const saved=await row();const handler=createGeocodeHandler({verifyFleetActor:async()=>true,fetch:async()=>{fetched++;return response({result:{addressMatches:[{matchedAddress:address,coordinates:{x:-95,y:30}}]}})},rpc:async(name,args)=>{if(name==='cos_field_geocode_list_due')return [saved];if(name==='cos_field_geocode_claim')return {claimed:true,claimToken:'12345678-1234-1234-1234-123456789012'};assert.equal(name,'cos_field_geocode_finish');assert.equal(args.p_status,'success');return {accepted:true,record:{status:'success'}};}});
 const r=await handler(new Request('https://fixture',{method:'POST',body:JSON.stringify({unitKey:saved.unitKey,auditId:saved.auditId})}));assert.equal(r.status,200);assert.equal(fetched,1);assert.deepEqual((await r.json()).fallbackResults,[]);
});
test('new provider preserves and exactly matches ZIP+4, leaving Census parser untouched',async()=>{
 const saved=address+'-1234';assert.equal(safeGeocodioParts(saved).zip,'77001-1234');
 const good=payload({formatted_address:address+'-1234',address_components:{...result().address_components,postal_code:'77001-1234'}});
 assert.equal(selectGeocodioResult(saved,good).status,'success');
 for(const zip of ['77001','77001-9999'])assert.equal(selectGeocodioResult(saved,payload({formatted_address:address.replace('77001',zip),address_components:{...result().address_components,postal_code:zip}})).status,'no_match');
 await geocodioAddress(saved,'fixture',async(url)=>{assert.equal(new URL(url).searchParams.get('postal_code'),'77001-1234');return response(good)});
 for(const matchedAddress of [address,address+'-9999']){
  const u={...unit(),address:saved};const r=await record({address:saved,addressSha256:await addressDigest(saved),matchedAddress});
  assert.deepEqual((await projectFallbackGeocodes({items:[u],inventoryItems:[u]},[r])).items[0],u);
  assert.equal(await checkedAddressEstimate({...u,locationGeocode:r}),null);
 }
});
test('unsafe saved addresses are retired from due queue without spending or sending',async()=>{
 const unsafe='100 Example Rd Apt 2, Test City, TX 77001',calls=[];let sends=0;
 const result=await processGeocodioFallback({geocodioApiKey:'fixture',fetch:async()=>{sends++;throw Error()},rpc:async(name,args)=>{calls.push(name);return name.endsWith('list_due')?[{...await row(),address:unsafe,addressSha256:await addressDigest(unsafe)}]:{accepted:true};}},{});
 assert.deepEqual(calls,['cos_field_geocode_fallback_list_due','cos_field_geocode_fallback_reject_address']);assert.equal(sends,0);assert.equal(result[0].status,'invalid_address');
});

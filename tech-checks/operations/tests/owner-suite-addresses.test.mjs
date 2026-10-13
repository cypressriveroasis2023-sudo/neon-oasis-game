import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import * as candidate from '../../supabase/functions/_shared/ownerInstallationAddress.ts';
import * as baseParser from '../../supabase/functions/cos-operations-pages/censusAddress.ts';
import * as contract from '../../supabase/functions/cos-operations-pages/importedAddressContract.ts';
import * as workerContract from '../../supabase/functions/camera-field-geocode/importedAddress.ts';
import * as census from '../../supabase/functions/camera-field-geocode/ownerCensusAddress.ts';
import * as oldCensus from '../../supabase/functions/camera-field-geocode/censusAddress.ts';
import * as geo from '../../supabase/functions/camera-field-geocode/geocodioAddress.ts';
import * as projection from '../../supabase/functions/cos-operations-pages/fallbackGeocodeProjection.ts';
import * as ui from '../src/fieldAddressEstimates.ts';
import * as locations from '../src/fieldLocations.ts';
import {createGeocodeHandler} from '../../supabase/functions/camera-field-geocode/index.ts';
import {normalizeAddress as workerNormalizeAddress} from '../../supabase/functions/camera-field-geocode/censusAddress.ts';
globalThis.crypto??=webcrypto;
// Every provider request below is an injected synthetic Response; never use the network.
const raw='12345 I-45 N, Ste#700, Testville, TX 77001-1234';
const base='12345 I-45 N, Testville, TX 77001';
const at='2026-10-01T00:00:00.000Z',now=Date.parse('2026-10-12T12:00:00.000Z');
const parse=value=>candidate.parseOwnerInstallationAddress(value,contract.fullMatchedParts);
const response=body=>new Response(JSON.stringify(body));
const censusMatch=address=>({matchedAddress:address,coordinates:{x:-95,y:30}});
const censusPayload=(matches=[censusMatch(base)])=>({result:{addressMatches:matches}});
const result=(patch={})=>({address_components:{number:'12345',formatted_street:'I-45 N',city:'Testville',state_province:'TX',postal_code:'77001',country:'US'},formatted_address:base,accuracy:1,accuracy_type:'range_interpolation',match_type:null,location:{lat:30,lng:-95},...patch});
const payload=(patch={})=>({results:[result(patch)]});
const row=()=>({id:'synthetic-unit',unitNumber:'SYNTHETIC 900',placement:'FIELD',placementSource:'owner',placementStatus:'confirmed',placementAuditId:'900',placementUnitKey:'SYNTHETIC 900',status:'field',currentLocationType:'field',address:raw,hasUnitGps:false,readOnly:false,locationVerification:'address_changed',latitude:null,longitude:null,locationGeocode:{status:'no_match',provider:'us_census_address_range'}});
const record=async(patch={})=>({auditId:'900',unitKey:'SYNTHETIC 900',addressSha256:await baseParser.addressDigest(raw),status:'success',provider:'geocodio',source:'geocodio_automatic_address_estimate',confidence:'estimate',verified:false,liveGps:false,matchedAddress:base,latitude:30,longitude:-95,geocodedAt:at,accuracyType:'range_interpolation',accuracy:1,matchType:null,...patch});
const censusRecord=async(patch={})=>({...await record(),provider:'us_census_address_range',benchmark:'Public_AR_Current',...patch});
const snapshot=r=>({items:[r],inventoryItems:[r]});

test('exact original source, separate numbered suite, unchanged street/city/state and full ZIP+4',()=>{
 const value='  12345 I-45 N, Ste#700, Testville, TX 77001-1234  ';
 assert.deepEqual(parse(value),{originalAddress:value,installation:{street:'12345 I-45 N',city:'Testville',state:'TX',zip:'77001-1234'},secondaryUnit:{kind:'suite',identifier:'700',sourceText:'Ste#700'}});
 for(const suite of ['Ste#700','Ste #700','Ste. 700','Suite 700','suite #00700A']){
  const v=`12345 I-45 N, ${suite}, Testville, TX, 77001-1234`,p=parse(v);
  assert.equal(p.originalAddress,v);assert.equal(p.secondaryUnit.sourceText,suite);assert.equal(p.installation.zip,'77001-1234');
 }
 assert.equal(parse(base).secondaryUnit,null);assert.equal(parse(base).originalAddress,base);
});

const invalid=[
 '12345 I-45 N, Ste#700, Suite 701, Testville, TX 77001-1234',
 '12345 I-45 N, Ste#700, Other City, Testville, TX 77001-1234',
 '12345 I-45 N, Ste#700 or 701, Testville, TX 77001-1234',
 '12345 I-45 N, Ste#700-701, Testville, TX 77001-1234',
 '12345 I-45 N, Ste#700/701, Testville, TX 77001-1234',
 '12345 I-45 N, Ste#700 & 701, Testville, TX 77001-1234',
 '12345-12349 I-45 N, Ste#700, Testville, TX 77001-1234',
 '12345 I-45 N OR 12349 I-45 N, Ste#700, Testville, TX 77001-1234',
 '12345 I-45 N, Ste#700, Testville, TX 77001-1234; 99 Main St, Other City, TX 77002',
 '12345 I-45 N Ste#700, Testville, TX 77001-1234',
 '12345 I-45 N Suite 700, Testville, TX 77001-1234',
 '12345 I-45 N, Apt 700, Testville, TX 77001-1234',
 '12345 I-45 N, Unit 700, Testville, TX 77001-1234',
 '12345 I-45 N, Floor 7, Testville, TX 77001-1234',
 '12345 I-45 N, Ste#700, Testville, XX 77001-1234',
 '12345 I-45 N, Ste#700, Testville, TX 7700',
 '12345 I-45 N, Ste#700, Testville, TX 77001-123',
 '12345 I-45 N, Ste#700, TX 77001-1234',
 '12345 I-45 N, Ste#700, Testville, TX',
 '12345 I-45 N, Ste#700, Testville, TX 77001-1234, gate code 9999',
 '12345 I-45 N, Ste#700, Testville, TX 77001-1234\n',
 '12345 I-45 N, Ste#700, Testville, TX 77001-1234\t',
 '12345 I-45 N, Ste#700, Testville, TX 77001-1234\0',
 '12345 I-45 N, Ste#700, Customer Name, TX 77001-1234',
 '12345 I-45 N, Ste#700, Testville, TX 77001-1234 password x',
 raw+' https://example.invalid',raw.replace('700','７００'),raw.replace('Testville','Testville OR Elsewhere'),raw.replace('Testville','Téstville'),raw.replace('Ste#700','Ste#700\u200b'),raw.replace('N,','N\u202e,'),raw.replace('Ste#700','Ste#700 contact someone'),null,{},'x'.repeat(601),
];
for(const [index,value] of invalid.entries())test(`strict input rejection ${index+1}`,async()=>{
 assert.equal(parse(value),null);
 assert.equal(geo.safeGeocodioParts(value),null);
 let requests=0;assert.equal((await census.censusOwnerAddress(value,async()=>{requests++;return response(censusPayload());})).status,'invalid_address');
 assert.equal(requests,0);
});

test('imported/provider address contracts remain strict and unchanged',()=>{
 for(const c of [contract,workerContract]){
  assert.equal(c.fullMatchedParts(raw),null);
  assert.equal(c.validInstallation({street:'12345 I-45 N Suite 700',city:'Testville',state:'TX',zip:'77001'}),false);
 }

});

test('provider requests contain only base components, retain supplied ZIP+4, and use mocks only',async()=>{
 const expected=parse(raw);let calls=0;
 const r=await census.censusOwnerAddress(raw,async(url)=>{calls++;const u=new URL(url);assert.equal(u.searchParams.get('street'),expected.installation.street);assert.equal(u.searchParams.get('city'),'Testville');assert.equal(u.searchParams.get('state'),'TX');assert.equal(u.searchParams.get('zip'),'77001-1234');assert.equal([...u.searchParams.values()].some(v=>/ste|suite|#700/i.test(v)),false);assert.deepEqual([...u.searchParams.keys()],['street','city','state','zip','benchmark','format']);return response(censusPayload());},()=>at);
 assert.equal(r.status,'success');assert.equal(r.geocodedAt,at);assert.equal(calls,1);
 const g=await geo.geocodioAddress(raw,'synthetic-placeholder',async(url)=>{const u=new URL(url);assert.equal(u.searchParams.get('street'),'12345 I-45 N');assert.equal(u.searchParams.get('postal_code'),'77001-1234');assert.equal([...u.searchParams.values()].some(v=>/ste|suite|#700/i.test(v)),false);assert.deepEqual([...u.searchParams.keys()],['street','city','state_province','postal_code','country']);return response(payload());});
 assert.equal(g.status,'success');assert.equal(parse(raw).originalAddress,raw);
});

test('ZIP5 is an explicitly allowed existing precision reduction; conflicting supplied ZIP+4 is rejected',async()=>{
 for(const zip of ['77001','77001-1234']){
  const matched=`12345 I-45 N, Testville, TX ${zip}`;
  assert.equal(contract.matchesInstallation(parse(raw).installation,matched),true);
  assert.equal((await census.censusOwnerAddress(raw,async()=>response(censusPayload([censusMatch(matched)])))).status,'success');
 }
 for(const zip of ['77002','77001-9999']){
  const matched=`12345 I-45 N, Testville, TX ${zip}`;
  assert.equal(contract.matchesInstallation(parse(raw).installation,matched),false);
  assert.equal((await census.censusOwnerAddress(raw,async()=>response(censusPayload([censusMatch(matched)])))).status,'no_match');
 }
 const leading='12345 I-45 N, Suite 700, Testville, MA 01234-5678';
 assert.equal(parse(leading).installation.zip,'01234-5678');
 assert.equal(contract.matchesInstallation(parse(leading).installation,'12345 I-45 N, Testville, MA 01234'),true);
});

test('Census empty/multiple results and every material component mismatch remain rejected',async()=>{
 for(const matches of [[],[censusMatch(base),censusMatch(base)]])assert.equal((await census.censusOwnerAddress(raw,async()=>response(censusPayload(matches)))).status,'no_match');
 for(const matched of [base.replace('12345','12346'),base.replace('I-45','I-46'),base.replace(' N,',' S,'),base.replace('Testville','Elsewhere'),base.replace('TX','OK'),base.replace('77001','77002'),base+'-9999',raw]){
  assert.equal((await census.censusOwnerAddress(raw,async()=>response(censusPayload([censusMatch(matched)])))).status,'no_match',matched);
 }
 assert.equal((await census.censusOwnerAddress(raw,async()=>response(censusPayload([{...censusMatch(base),coordinates:{x:-95,y:91}}])))).status,'no_match');
});

test('Geocodio ambiguity, warnings, secondary components, locality/ZIP mismatches and quality gates remain rejected',()=>{
 for(const data of [{results:[]},{results:[result(),result()]},{...payload(),_warnings:['synthetic warning']},payload({_warnings:['synthetic warning']})])assert.equal(geo.selectGeocodioResult(raw,data).status,'no_match');
 for(const components of [{number:'12346'},{formatted_street:'I-45 S'},{city:'Elsewhere'},{state_province:'OK'},{postal_code:'77002'},{postal_code:'77001-9999'},{country:'CA'},{unit_number:'700'},{unit_type:'Suite'}]){
  assert.equal(geo.selectGeocodioResult(raw,payload({address_components:{...result().address_components,...components}})).status,'no_match');
 }
 for(const patch of [{formatted_address:base+'-9999'},{formatted_address:raw},{address_components_secondary:{}},{accuracy:.89},{accuracy_type:'place'},{accuracy_type:'range_interpolation',match_type:'parcel_centroid'},{location:{lat:30,lng:181}}])assert.equal(geo.selectGeocodioResult(raw,payload(patch)).status,'no_match');
});

test('full original digest differs from stripped address and different suites; server/client normalization stays identical',async()=>{
 const digest=await baseParser.addressDigest(raw);
 assert.notEqual(digest,await baseParser.addressDigest(base));
 assert.notEqual(digest,await baseParser.addressDigest(raw.replace('700','701')));
 assert.equal(await baseParser.addressDigest('  '+raw.toUpperCase()+'  '),digest);
 assert.equal(baseParser.normalizeAddress(raw),locations.normalizeLocationAddress(raw));
 assert.equal(baseParser.normalizeAddress(raw),workerNormalizeAddress(raw));
});

test('fallback projection and client show only bound unverified building estimate and preserve source',async()=>{
 const source=row(),before=structuredClone(source),r=await record();
 const out=await projection.projectFallbackGeocodes(snapshot(source),[r]);
 assert.equal(out.items[0].address,raw);assert.equal(out.inventoryItems[0].address,raw);assert.deepEqual(source,before);
 const e=await ui.checkedAddressEstimate(out.items[0],now);
 assert.equal(e.originalAddress,raw);assert.equal(e.secondaryUnit.sourceText,'Ste#700');assert.equal(e.secondaryUnitVerified,false);
 assert.equal(e.confidence,'automatic_address_estimate');assert.equal(locations.isCurrentFieldPin(out.items[0]),false);
 assert.equal(out.items[0].latitude,null);assert.equal(out.items[0].hasUnitGps,false);
 const c=await ui.checkedAddressEstimate({...source,locationGeocode:await censusRecord()},now);
 assert.equal(c.originalAddress,raw);assert.equal(c.secondaryUnit.identifier,'700');assert.equal(c.secondaryUnitVerified,false);assert.equal(c.confidence,'address_range_interpolation');
});

test('stale/full-address digest, audit and equipment identity mismatches remain rejected in both consumers',async()=>{
 const source=row(),r=await record();
 for(const patch of [{addressSha256:await baseParser.addressDigest(base)},{addressSha256:'0'.repeat(64)},{auditId:'901'},{unitKey:'SYNTHETIC 901'}]){
  assert.deepEqual((await projection.projectFallbackGeocodes(snapshot(source),[{...r,...patch}])).items[0],source);
  assert.equal(await ui.checkedAddressEstimate({...source,locationGeocode:{...r,...patch}},now),null);
  assert.equal(await ui.checkedAddressEstimate({...source,locationGeocode:await censusRecord(patch)},now),null);
 }
 const changed={...source,address:raw.replace('700','701')};
 assert.deepEqual((await projection.projectFallbackGeocodes(snapshot(changed),[r])).items[0],changed);
 assert.equal(await ui.checkedAddressEstimate({...changed,locationGeocode:r},now),null);
 assert.equal(await ui.checkedAddressEstimate({...changed,locationGeocode:await censusRecord()},now),null);
});

test('server and both client branches reject changed city/state/ZIP+4 and unsafe provider suite outputs',async()=>{
 for(const matchedAddress of [base.replace('Testville','Elsewhere'),base.replace('TX','OK'),base.replace('77001','77002'),base+'-9999',raw]){
  const source=row(),r=await record({matchedAddress});
  assert.deepEqual((await projection.projectFallbackGeocodes(snapshot(source),[r])).items[0],source);
  assert.equal(await ui.checkedAddressEstimate({...source,locationGeocode:r},now),null);
  assert.equal(await ui.checkedAddressEstimate({...source,locationGeocode:await censusRecord({matchedAddress})},now),null);
 }
});

test('verified GPS, wrong placement and unresolved identity stay protected',async()=>{
 for(const patch of [{locationVerification:'owner_verified',hasUnitGps:true},{placement:'SHOP'},{placementSource:'imported'},{placementStatus:'needs_identity_review'}]){
  const source={...row(),...patch},r=await record();
  assert.deepEqual((await projection.projectFallbackGeocodes(snapshot(source),[r])).items[0],source);
  assert.equal(await ui.checkedAddressEstimate({...source,locationGeocode:r},now),null);
  assert.equal(await ui.checkedAddressEstimate({...source,locationGeocode:await censusRecord()},now),null);
 }
});

test('endpoint claims/finishes exact original address and hash without accepting browser-supplied address',async()=>{
 const calls=[],sha=await baseParser.addressDigest(raw);let sent=0;
 const handler=createGeocodeHandler({verifyFleetActor:async()=>true,rpc:async(name,args)=>{calls.push({name,args});if(name==='cos_field_geocode_list_due')return [{auditId:'900',unitKey:'SYNTHETIC 900',address:raw,addressSha256:sha}];if(name==='cos_field_geocode_claim')return {claimed:true,claimToken:'11111111-1111-4111-8111-111111111111'};if(name==='cos_field_geocode_finish'){assert.equal(args.p_status,'success');return {accepted:true,record:{status:'success'}};}throw Error(name);},fetch:async()=>{sent++;return response(censusPayload());}});
 const body={unitKey:'SYNTHETIC 900',auditId:'900'};
 assert.equal((await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify(body)}))).status,200);
 assert.equal(sent,1);
 for(const {args} of calls.filter(c=>c.name!=='cos_field_geocode_list_due')){assert.equal(args.p_address,raw);assert.equal(args.p_address_sha256,sha);}
 assert.equal((await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({...body,address:base})}))).status,400);
 assert.equal(sent,1);
});

test('suite estimate disclosure explicitly retains original address and unverified suite',()=>{
 const source=readFileSync(new URL('../src/FieldMap.tsx',import.meta.url),'utf8')+readFileSync(new URL('../src/LocationEstimatePreview.tsx',import.meta.url),'utf8');
 assert.match(source,/This estimate locates the building address; the suite and installed unit position remain unverified/);
});
test('ordinary unsuited Census success/failure behavior and client estimate shape are preserved',async()=>{
 for(const sourceAddress of [base,base+'-1234']){
  for(const matches of [[censusMatch(base)],[censusMatch(base+'-9999')],[],[censusMatch(base),censusMatch(base)]]){
   const request=async()=>response(censusPayload(matches));
   assert.deepEqual(await census.censusOwnerAddress(sourceAddress,request,()=>at),await oldCensus.censusAddress(sourceAddress,request,()=>at));
  }
  const source={...row(),address:sourceAddress},automatic=await censusRecord({addressSha256:await baseParser.addressDigest(sourceAddress)});
  const estimate=await ui.checkedAddressEstimate({...source,locationGeocode:automatic},now);assert.ok(estimate);assert.equal(Object.hasOwn(estimate,'secondaryUnit'),false);assert.equal(estimate.confidence,'address_range_interpolation');
 }
});

test('unsupported inline suite and duplicate-suite source cannot pass client validation even with identical provider text',async()=>{
 for(const address of [raw.replace(', Ste#700',' Suite 700'),raw.replace('Ste#700','Ste#700, Ste#701')]){
  const r=await censusRecord({addressSha256:await baseParser.addressDigest(address),matchedAddress:address});
  assert.equal(await ui.checkedAddressEstimate({...row(),address,locationGeocode:r},now),null);
 }
});

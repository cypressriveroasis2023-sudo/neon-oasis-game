import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
globalThis.crypto??=webcrypto;
import * as legacy from '../../supabase/functions/camera-field-geocode/importedAddress.ts';
import * as native from '../../supabase/functions/cos-operations-pages/importedAddressContract.ts';
import {selectGeocodioInstallation,geocodioInstallation} from '../../supabase/functions/camera-field-geocode/geocodioAddress.ts';
const installation={street:'123 Main St',city:'Test City',state:'MA',zip:'01234-5678'};
const address=zip=>`123 Main Street, Test City, MA ${zip}`;
const result=(zip='01234')=>({address_components:{number:'123',formatted_street:'Main Street',city:'Test City',state_province:'MA',postal_code:zip,country:'US'},formatted_address:address(zip),location:{lat:42,lng:-71},accuracy:.95,accuracy_type:'rooftop',match_type:'building_centroid'});
const payload=patch=>({results:[{...result(),...patch}]});
for(const [name,contract] of [['legacy',legacy],['native',native]]){
 test(name+' postal comparison is symmetric, lossless and strict',()=>{
  for(const [a,b] of [['01234','01234-5678'],['01234-5678','01234'],['01234','01234'],['01234-5678','01234-5678'],[77002,'77002'],['77002-1234',77002]])assert.equal(contract.sameUsPostalCode(a,b),true,`${a}/${b}`);
  for(const a of ['1234','001234','012345678','01234-567','01234-56789',' 01234','01234 ','01234\n','A1A 1A1','01234A',1234,123456789,77002.5,NaN,Infinity,null,{},['01234']])assert.equal(contract.sameUsPostalCode(a,'01234'),false,String(a));
  for(const [a,b] of [['01234','11234'],['01234-5678','01234-0000'],['01234-5678','01235-5678']])assert.equal(contract.sameUsPostalCode(a,b),false);
 });
 test(name+' imported checks retain all non-postal components and the original source',()=>{
  const before=structuredClone(installation);
  assert.equal(contract.matchesInstallation(installation,address('01234')),true);
  assert.equal(contract.matchesInstallation({...installation,zip:'01234'},address('01234-5678')),true);
  assert.equal(contract.matchesInstallation(installation,address('01234-5678')),true);
  for(const actual of [address('01235'),address('01234-0000'),address('01234').replace('123 ','124 '),address('01234').replace('Main','Other'),address('01234').replace('Test City','Other City'),address('01234').replace('MA','CA'),address('01234').replace('MA','ON')])assert.equal(contract.matchesInstallation(installation,actual),false,actual);
  assert.deepEqual(installation,before);assert.equal(contract.validInstallation({...installation,zip:1234}),false);
 });
}
test('US only numeric provider ZIP5 accepts lossless values and never invents a leading zero',()=>{
 const expected={...installation,state:'TX',zip:'77002-1234'},r={...result(77002),address_components:{...result(77002).address_components,state_province:'TX'},formatted_address:'123 Main St, Test City, TX 77002'};
 assert.equal(selectGeocodioInstallation(expected,{results:[r]}).status,'success');
 for(const postal_code of [1234,123456789,'012345678','01234-56789','H2X 1Y4'])assert.equal(selectGeocodioInstallation(installation,payload({address_components:{...result().address_components,postal_code}})).reason,'invalid_components');
 for(const country of ['CA','GB',null])assert.equal(selectGeocodioInstallation(installation,payload({address_components:{...result().address_components,country}})).reason,'invalid_components');
});
test('formatted and structured ZIP precision agrees but conflicting supplied +4 rejects',()=>{
 assert.equal(selectGeocodioInstallation(installation,payload({formatted_address:address('01234-5678')})).status,'success');
 assert.equal(selectGeocodioInstallation(installation,payload({formatted_address:address('01234-0000')})).reason,'formatted_address_mismatch');
 assert.equal(selectGeocodioInstallation({...installation,zip:'01234'},payload({address_components:{...result().address_components,postal_code:'01234-5678'},formatted_address:address('01234-0000')})).reason,'formatted_address_mismatch');
});
test('new Geocodio codes distinguish empty, ambiguity, component, method and quality failures',async()=>{
 const cases=[
  [{results:[]},'provider_empty'],[{results:[result(),result()]},'ambiguous_results'],[{results:[result()],_warnings:['raw address secret']},'provider_warning'],
  [payload({address_components:{...result().address_components,number:'124'}}),'component_mismatch'],[payload({address_components:null}),'invalid_components'],
  [payload({formatted_address:address('01235')}),'formatted_address_mismatch'],[payload({accuracy_type:'place'}),'unsupported_method'],[payload({accuracy:.89}),'low_accuracy'],[payload({location:{lat:91,lng:-71}}),'invalid_coordinates']
 ];
 for(const [input,reason] of cases){assert.deepEqual(selectGeocodioInstallation(installation,input),{status:'no_match',reason});assert.equal(legacy.safeGeocodeRejectionReason(reason),reason);assert.equal(native.safeGeocodeRejectionReason(reason),reason);}
 assert.equal(native.safeGeocodeRejectionReason('secret raw provider error'),null);assert.equal(native.safeGeocodeRejectionReason('no_match'),null);
 assert.deepEqual(await geocodioInstallation(installation,'fixture',async()=>new Response(JSON.stringify({error:'secret address'}),{status:422})),{status:'no_match',reason:'provider_rejected'});
});
test('Census precision and fresh safe reasons keep provider material out of failures',async()=>{
 const census=matches=>legacy.censusInstallation(installation,async()=>new Response(JSON.stringify({result:{addressMatches:matches}})));
 const match={matchedAddress:address('01234'),coordinates:{x:-71,y:42}};
 assert.equal((await census([match])).status,'success');
 for(const [matches,reason] of [[[],'provider_empty'],[[match,match],'ambiguous_results'],[[{...match,matchedAddress:address('01235')}],'component_mismatch'],[[{...match,matchedAddress:'secret'}],'invalid_components'],[[{...match,coordinates:{x:181,y:42}}],'invalid_coordinates']])assert.deepEqual(await census(matches),{status:'no_match',reason});
 assert.deepEqual(await legacy.censusInstallation(installation,async()=>new Response('secret invalid JSON')),{status:'provider_error',reason:'invalid_response'});
});

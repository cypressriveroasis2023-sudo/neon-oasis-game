import test from 'node:test';
import assert from 'node:assert/strict';
import {readMhelpAddressMapPins,mhelpAddressProviderLabel} from '../src/mhelpAddressMapPins.ts';
const source='a'.repeat(64),payload='b'.repeat(64),now=Date.parse('2026-10-17T21:00:00Z'),head={sourceSha256:source,payloadSha256:payload,records:Array.from({length:1001},(_,i)=>({productId:String(i+1),placement:i<287?'FIELD':'SHOP'}))};
const record=(index)=>{
 const productId=String(index+1);
 return {productId,sourceRowSha256:'c'.repeat(64),unitNumber:'Spotter '+index,customer:'Example customer '+index,category:'Spotter',
  sourceAddress:{street:'123 Example Rd',city:'Houston',state:'TX',zip:'77064'},
  placement:'FIELD',lifecycle:'UNFLAGGED',placementHeld:false,status:'matched',reason:null,
  matchedAddress:'123 EXAMPLE RD, HOUSTON, TX, 77064',latitude:29.9,longitude:-95.5,geocodedAt:'2026-10-17T20:01:00Z',
  verified:false,liveGps:false,confidence:'mhelpdesk_address_census_range_unverified',geocodeSource:'us_census_address_range'};
};
const sample=()=>({contract:'COS_MHELP_CENSUS_ADDRESS_MAP_V1',sourceSha256:source,payloadSha256:payload,verifiedGps:false,liveGps:false,
  confidence:'mhelpdesk_customer_address_reference_only',totalProducts:1001,fieldProducts:287,shopProducts:714,
  items:Array.from({length:287},(_,i)=>record(i))});
const parse=s=>readMhelpAddressMapPins(s,head,now);
test('public project points always carry review status and their actual provenance',()=>{
 const s=sample();s.items[0].geocodeSource='public_site_reference';
 const pin=parse(s)?.pins[0];
 assert.equal(pin?.provider,'public_site_reference');assert.equal(pin?.state,'address_review');
 assert.equal(pin?.verified,false);assert.equal(pin?.liveGps,false);
 assert.match(mhelpAddressProviderLabel(pin.provider),/Public project.*approximate/);
 assert.equal(mhelpAddressProviderLabel('geocodio'),'Geocodio saved address result');
 assert.equal(mhelpAddressProviderLabel('unknown'),'Unknown address provider');
 s.items[0].geocodeSource='unreviewed_web_guess';assert.equal(parse(s),null);
});
test('all 287 current mHelp Field Product IDs become address reference markers even without any GPS',()=>{
 const s=sample(),p=parse(s);
 assert.equal(p?.pins.length,287);assert.equal(p?.totalField,287);assert.equal(p?.matched,287);
 assert.equal(p?.pins.every(x=>x.verified===false&&x.liveGps===false),true);
 assert.equal(p?.pins[0].id,'mhelp_product:1');
});
test('held camera identity and Do Not Use do not prevent a recorded Field address pin',()=>{
 const s=sample();s.items[0].placementHeld=true;s.items[1].lifecycle='DO_NOT_USE';
 const p=parse(s);assert.equal(p?.pins.length,287);assert.equal(p?.pins[1].id,'mhelp_product:2');
});
test('14 address mismatches are marked for review, not promoted to GPS',()=>{
 const s=sample();for(let i=0;i<14;i++){s.items[i].status='address_review';s.items[i].reason='matched_address_components_differ_from_source';}
 const p=parse(s);assert.equal(p?.addressReview,14);assert.equal(p?.matched,273);
 assert.equal(p?.pins.filter(x=>x.state==='address_review').length,14);
});
test('no-match and malformed service address remain visible in audit, but never get fictitious map coordinates',()=>{
 const s=sample();
 for(let i=0;i<112;i++){Object.assign(s.items[i],{status:'no_match',matchedAddress:null,latitude:null,longitude:null,geocodedAt:'2026-10-17T20:00:00Z'});}
 for(let i=112;i<126;i++){Object.assign(s.items[i],{status:'invalid_address',reason:'missing_building_number',matchedAddress:null,latitude:null,longitude:null,
  sourceAddress:{street:'Lee Rd.',city:'Humble',state:'TX',zip:''}});}
 const p=parse(s);assert.equal(p?.pins.length,161);assert.equal(p?.unlocated,126);assert.equal(p?.reviews.length,126);
 assert.ok(p?.reviews.find(x=>x.id==='mhelp_product:125'&&x.address.includes('Lee Rd.')));
});
test('shop cannot enter the outside map even if its GPS is valid',()=>{
 const s=sample();s.items[0].placement='SHOP';assert.equal(parse(s),null);
});
test('duplicate Product ID, ambiguous origin and partial census fail closed',()=>{
 for(const m of [s=>s.items[1].productId=s.items[0].productId,s=>s.items.pop(),s=>s.totalProducts=1000,
   s=>s.payloadSha256='f'.repeat(64),s=>s.items[0].sourceRowSha256='invalid']){
  const s=sample();m(s);assert.equal(parse(s),null);
 }
});
test('bad coordinates and forged GPS claims fail closed',()=>{
 for(const m of [s=>s.items[0].latitude=900,s=>s.items[0].longitude=0/0,s=>s.items[0].verified=true,
   s=>s.items[0].liveGps=true,s=>s.items[0].geocodedAt='2030-01-01T00:00:00Z']){
  const s=sample();m(s);assert.equal(parse(s),null);
 }
});
test('invalid and no-match rows cannot smuggle coordinates into pin map',()=>{
 const s=sample();s.items[0].status='no_match';assert.equal(parse(s),null);
});

test('street direction mismatch is visible even if upstream called the Census result matched',()=>{
 const s=sample();s.items[0].matchedAddress='123 S Example Rd, Houston, TX 77064';
 assert.equal(parse(s)?.pins[0].state,'address_review');
});
test('saved fallback evidence retains the original Field Product ID and its provider',()=>{
 const s=sample();s.items[0].geocodeSource='geocodio';s.items[0].lookupAddress='123 Example Rd, Houston, TX 77064';
 assert.equal(parse(s)?.pins[0].provider,'geocodio');
 s.items[0].geocodeSource='municipal_address_point';assert.equal(parse(s)?.pins[0].provider,'municipal_address_point');
});
test('a valid count with a foreign or superseded Product ID cannot enter the current source map',()=>{
 const s=sample();s.items[0].productId='9999999';assert.equal(parse(s),null);
});

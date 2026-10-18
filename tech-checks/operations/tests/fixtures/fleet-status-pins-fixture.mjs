import {fieldProductFixture} from './mhelp-field-health-fixtures.mjs';
export function statusPinsFixture(){
 const f=fieldProductFixture();
 for(let i=0;i<993;i++){
  const field=i<280,id=String(2001+i);
  f.upload.records.push({...f.upload.records[4],recordId:'mhelp_product:'+id,productId:id,unitNumber:'Unlinked '+id,placement:field?'FIELD':'SHOP'});
  f.roster.items.push({...f.roster.items[4],id:'mhelp_product:'+id,unitNumber:'Unlinked '+id,productIds:[id],sourceRecordIds:['mhelp_product:'+id],placement:field?'field':'shop'});
 }
 Object.assign(f.upload.summary,{totalRecords:1001,fieldRecords:287,shopRecords:714,unflaggedFieldRecords:286,unflaggedShopRecords:714});
 Object.assign(f.roster.summary,{totalRecords:1001,activeRecords:1000,field:285,shop:714,sourceOnlyRecords:997});
 f.upload.payloadSha256='b'.repeat(64);
 f.field.mhelpAddressMap={contract:'COS_MHELP_CENSUS_ADDRESS_MAP_V1',sourceSha256:f.upload.sourceSha256,payloadSha256:f.upload.payloadSha256,totalProducts:1001,fieldProducts:287,shopProducts:714,verifiedGps:false,liveGps:false,confidence:'mhelpdesk_customer_address_reference_only',items:f.upload.records.filter(r=>r.placement==='FIELD').map((r,i)=>({productId:r.productId,sourceRowSha256:'c'.repeat(64),unitNumber:r.unitNumber,customer:'Synthetic service customer',category:r.category,placement:'FIELD',lifecycle:r.uploadLifecycle,placementHeld:r.binding.placementHeld,sourceAddress:{street:'123 Example Rd',city:'Houston',state:'TX',zip:'77064'},status:i<7?(i===0?'address_review':'matched'):'no_match',reason:i<7?null:'Synthetic unresolved address',matchedAddress:i<7?'123 EXAMPLE RD, HOUSTON, TX, 77064':null,latitude:i<7?30+i*.08:null,longitude:i<7?-96:null,geocodedAt:f.fresh,geocodeSource:'us_census_address_range',verified:false,liveGps:false,confidence:'mhelpdesk_address_census_range_unverified'}))};
 Object.assign(f.units[0],{latitude:30,longitude:-96,coordinateSource:'site',locationVerification:'owner_verified',locationVerifiedAt:f.fresh,gpsRecordedAt:f.fresh});
 Object.assign(f.field.summary,{mappedUnits:1,missingGps:3});
 return f;
}

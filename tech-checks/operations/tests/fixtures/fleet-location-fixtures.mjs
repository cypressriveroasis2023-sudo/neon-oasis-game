import {createHash} from 'node:crypto';
export function withSyntheticEstimate(unit){
 const address='100 Example Road, Test City, TX 77001',at='2026-10-07T12:00:00Z';
 const marker={schemaVersion:1,trackerId:unit.id,unitNumber:unit.unitNumber,addressSha256:createHash('sha256').update(address.toLowerCase()).digest('hex'),latitude:30,longitude:-95,provider:'us_census_address_range',benchmark:'Public_AR_Current',providerMatchQuality:'Exact',matchedAddress:'100 EXAMPLE RD, TEST CITY, TX, 77001',geocodedAt:at,confidence:'address_range_interpolation',verified:false,liveGps:false,requiresOwnerConfirmation:true,batchId:'synthetic-batch',approvalReference:'synthetic-approval',appliedByDatabaseRole:'synthetic-role',appliedAt:at};
 return {...unit,address,readOnly:true,hasUnitGps:false,locationVerification:'coordinates_unverified',locationVerifiedAt:null,gpsRecordedAt:null,latitude:null,longitude:null,coordinateSource:null,historicalLatitude:30,historicalLongitude:-95,historicalCoordinateSource:'us_census_address_range_estimate',locationNote:'COS_ADDRESS_ESTIMATE_V1|'+JSON.stringify(marker)};
}

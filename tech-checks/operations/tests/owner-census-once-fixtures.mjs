import {createHash} from 'node:crypto';
export const id='11111111-1111-4111-8111-111111111111',otherId='22222222-2222-4222-8222-222222222222';
export const at='2026-10-10T02:00:00.000Z',now=Date.parse('2026-10-12T12:00:00.000Z');
export const owner={authorized:true,legacyOwner:true,role:'Owner',name:'Synthetic Owner',features:{fieldLocationVerification:true}};
export function fixture(){
 const address='200 Synthetic Fixture Road, Suite 700, Testville, TX 77002-1234';
 const hash=createHash('sha256').update(address.toLowerCase()).digest('hex');
 const guard={nativeUnitId:id,nativeGuardSha256:'a'.repeat(64)};
 const row={id,unitNumber:'SYNTHETIC BOUNDARY 900',status:'field',currentLocationType:'field',placement:'FIELD',placementSource:'owner',readOnly:false,
  placementAuditId:'9001',placementUnitKey:'SYNTHETIC BOUNDARY 900',address,addressSource:'Owner confirmed installation address',
  addressUpdatedAt:'2026-10-10T00:00:00.000Z',placementUpdatedAt:'2026-10-10T00:00:00.000Z',hasUnitGps:true,
  latitude:null,longitude:null,coordinateSource:null,locationVerification:'address_changed',locationVerifiedAt:null,locationHistoryId:null,
  gpsRecordedAt:'2026-10-01T00:00:00.000Z',historicalRecordedAt:'2026-10-01T00:00:00.000Z',historicalLatitude:30,historicalLongitude:-95,historicalCoordinateSource:'site',locationNote:'Synthetic saved history.',
  locationGeocode:{status:'no_match',auditId:'9001',unitKey:'SYNTHETIC BOUNDARY 900',addressSha256:hash,provider:'us_census_address_range',benchmark:'Public_AR_Current',censusOnly:true,censusOnlyState:'ready',censusOnlyGuard:guard}};
 const proof={contract:'COS_OWNER_ONE_CENSUS_NATIVE_V1',nativeUnitId:id,auditId:'9001',unitKey:row.placementUnitKey,addressSha256:hash,nativeGuardSha256:guard.nativeGuardSha256,complete:true};
 const snapshot={items:[row],summary:{fieldUnits:1,mappedUnits:0,unitGps:1,missingGps:1},generatedAt:at,ownerCensusProofs:[proof]};
 return {row,proof,snapshot};
}
export function consumed(snapshot,status='success'){
 const result=structuredClone(snapshot),row=result.items[0];
 row.locationGeocode={...row.locationGeocode,status,censusOnlyState:'consumed',...(status==='success'?{latitude:31,longitude:-96,matchedAddress:'200 Synthetic Fixture Road, Testville, TX 77002',geocodedAt:at}:{})};
 return result;
}

import {fixture as lookupFixture,id,owner,now} from './owner-census-once-fixtures.mjs';
export {id,now};
export const preparationOwner={...owner,productionOwnerUserId:'77777777-7777-4777-8777-777777777777'};
export const receipt=()=>({eligible:true,nativeGuardSha256:'b'.repeat(64),nativeSourceSha256:'c'.repeat(64),preparedAt:new Date(now).toISOString()});
export function fixture(){
 const f=lookupFixture();
 f.row.locationGeocode.status='invalid_address';
 delete f.row.locationGeocode.censusOnly;delete f.row.locationGeocode.censusOnlyState;delete f.row.locationGeocode.censusOnlyGuard;
 delete f.snapshot.ownerCensusProofs;
 f.row.locationGeocode.censusPreparation={nativeUnitId:id};
 return f;
}

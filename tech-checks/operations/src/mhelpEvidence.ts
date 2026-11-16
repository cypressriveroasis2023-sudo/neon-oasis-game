// What mHelp says about where a unit is.
//
// mHelp is the record of record for placement: COS mirrors it and never
// decides it. This reads that mirror so the troubleshooting screen can say
// what mHelp holds, when it was last confirmed, and -- the useful part -- when
// mHelp and the live board disagree about whether a unit is in the field.
//
// Nothing here changes mHelp. It is read only, as the board always is.
import type {FieldLocation} from './fieldLocations';
import type {UnitCameraStatus} from '../shared/starUnitStatus';
import {canonicalCameraUnit} from './fieldCameraHealth';

export type MhelpEvidence={
 /** When mHelp's placement for this unit was last written. */
 seenAt?:string|null;
 /** FIELD or SHOP as mHelp holds it, upper-cased, or null when unrecorded. */
 placement?:'FIELD'|'SHOP'|null;
 /** Why the location is held for review, where it is. */
 reviewReason?:string|null;
};

const placementOf=(row:FieldLocation):'FIELD'|'SHOP'|null=>{
 const raw=String(row.placement||row.placementStatus||'').trim().toUpperCase();
 return raw==='FIELD'||raw==='SHOP'?raw:null;
};

/** Index mHelp evidence by canonical unit key. */
export function mhelpEvidenceByUnit(fieldMap:unknown):Map<string,MhelpEvidence>{
 const found=new Map<string,MhelpEvidence>();
 const rows=(fieldMap as {units?:FieldLocation[];items?:FieldLocation[]});
 const list=Array.isArray(rows?.units)?rows.units:Array.isArray(rows?.items)?rows.items:null;
 if(!list)return found;
 for(const row of list){
  const key=canonicalCameraUnit(String(row?.unitNumber||''));
  if(!key)continue;
  found.set(key,{
   seenAt:row.placementUpdatedAt||row.sourceVerifiedAt||row.addressUpdatedAt||null,
   placement:placementOf(row),
   reviewReason:row.mhelpLocationReviewReason||null,
  });
 }
 return found;
}

/** The evidence for one unit, or nothing when mHelp has no row for it. */
export function mhelpEvidenceFor(unit:UnitCameraStatus,index:Map<string,MhelpEvidence>):MhelpEvidence|undefined{
 const key=canonicalCameraUnit(unit.unit);
 return key?index.get(key):undefined;
}

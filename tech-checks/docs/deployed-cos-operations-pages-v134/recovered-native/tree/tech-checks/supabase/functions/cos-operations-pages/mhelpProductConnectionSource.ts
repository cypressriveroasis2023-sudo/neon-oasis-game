/** Accepted mHelp source projection for an independent connection read.
 * Does not change placement, source rows, tracker IPs or native inventory.
 * The protected 2027 read independently checks the complete Product-ID set.
 */
import {validPrior} from './mhelpEquipmentCsvPreview.ts';
import {readMhelpInventoryAuthority} from '../../../operations/src/mhelpInventoryAuthority.ts';

type Row=Record<string,any>;
export function currentMhelpProductConnectionCensus(value:unknown,now=Date.now()){
 const prior=validPrior(value);
 const original=value as Row;
 const rows=prior.records.map(row=>{
  const r=row as Row,b=r.binding;
  return {
   productId:r.productId,recordId:'mhelp_product:'+r.productId,
   placement:r.placement,uploadLifecycle:r.lifecycle,
   binding:{state:r.placementHeld===true||r.possibleAliasUnitIds?.length||b?.guardCurrent===false?'held':b?'linked':'unlinked',
    placementHeld:r.placementHeld===true||b?.guardCurrent===false,candidateUnitIds:r.possibleAliasUnitIds||[]}
  };
 });
 const summary={totalRecords:rows.length,
  fieldRecords:rows.filter(r=>r.placement==='FIELD').length,
  shopRecords:rows.filter(r=>r.placement==='SHOP').length,
  unflaggedFieldRecords:rows.filter(r=>r.placement==='FIELD'&&r.uploadLifecycle==='UNFLAGGED').length,
  doNotUseRecords:rows.filter(r=>r.uploadLifecycle==='DO_NOT_USE').length,
  missingRecords:rows.filter(r=>r.uploadLifecycle==='MISSING').length};
 const census={contract:'COS_MHELP_UPLOAD_INVENTORY_V1',
  countBasis:'mhelp_product_records_not_unique_physical_units',
  sourceSha256:prior.sourceSha256,source:original.origin==='mhelpdesk_api'?'mhelpdesk_api':'owner_supplied_mhelp_export',
  receivedAt:original.receivedAt,lastApiReadAt:original.apiSync?.lastSuccessAt||original.receivedAt,
  summary,records:rows};
 if(!readMhelpInventoryAuthority(census,now))throw Error('Current mHelp product receipt is unavailable.');
 return {census,candidate:prior.records,sourceSha256:prior.sourceSha256};
}

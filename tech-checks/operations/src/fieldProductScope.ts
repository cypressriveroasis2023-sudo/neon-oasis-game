import {readMhelpInventoryAuthority} from './mhelpInventoryAuthority';
import {readRecordedRoster} from './fleetRecordedRoster';

export type FieldProductScope={contract:'COS_FIELD_PRODUCT_HEALTH_SCOPE_V1';sourceSha256:string;receivedAt:string;unitIds:string[]};
/** A restrictive view of existing reviewed links. This never creates a link or
 * overrides placement. Raw provider records remain available in diagnostics. */
export function fieldProductScope(map:any,now=Date.now()):FieldProductScope|undefined{
 if(map.uploadInventory===undefined)return undefined;
 const authority=readMhelpInventoryAuthority(map.uploadInventory,now);
 // An entirely inactive source needs no positive health association. Preserve
 // older read adapters' Do Not Use / Missing exclusions during reconciliation.
 if(authority?.fieldActive===0)return {contract:'COS_FIELD_PRODUCT_HEALTH_SCOPE_V1',sourceSha256:authority.sourceSha256,receivedAt:authority.receivedAt,unitIds:[]};
 const roster=readRecordedRoster(map.fleetRoster,map.inventoryItems||map.items).roster;
 if(!authority||!roster)throw Error('Field Product-ID health scope could not be verified.');
 const unitIds:string[]=[];
 for(const product of map.uploadInventory.records){
  if(product.placement!=='FIELD'||product.uploadLifecycle!=='UNFLAGGED')continue;
  const records=roster.items.filter(item=>item.productIds.includes(product.productId)),record=records.length===1?records[0]:null,binding=product.binding;
  if(record?.kind!=='unit'||!record.active||record.lifecycle!=='active'||record.placement!=='field'||record.productIds.length!==1
   ||binding?.state!=='linked'||binding.placementHeld===true||binding.candidateUnitIds?.length||!Array.isArray(binding.unitIds)||!binding.unitIds.includes(record.unitId))continue;
  if(record.unitId)unitIds.push(record.unitId);
 }
 return {contract:'COS_FIELD_PRODUCT_HEALTH_SCOPE_V1',sourceSha256:authority.sourceSha256,receivedAt:authority.receivedAt,unitIds};
}

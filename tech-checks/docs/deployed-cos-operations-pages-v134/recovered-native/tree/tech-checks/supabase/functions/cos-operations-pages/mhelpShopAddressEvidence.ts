/** A source-only Shop address may be restored only from sealed reviewed CSV
 * history. This never supplies or refreshes a native identity/placement guard. */
import type {EquipmentCsvRow} from './mhelpEquipmentCsvPreview.ts';
const fields=['productId','unitNumber','category','customerId','customer','placement','lifecycle'] as const;
const address=['street','city','state','zip'] as const;
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function reviewedShopAddressEnrichment(previous:any,old:any,row:EquipmentCsvRow):boolean{
 const proof=previous?.shopAddressBaseline;
 if(previous?.contract!=='COS_MHELP_API_V1'||previous.reviewed!==true||previous.complete!==true
  ||previous.origin!=='mhelpdesk_api'||previous.portalId!=='224643'
  ||!hash(previous.sourceSha256)||!hash(previous.payloadSha256)||previous.recordCount!==previous.records?.length
  ||!Array.isArray(previous.apiMissingRecords)||old?.placement!=='SHOP'||row.placement!=='SHOP'
  ||fields.some(k=>old[k]!==row[k])||!address.every(k=>old.sourceAddress?.[k]==='')
  ||old.apiAssignment?.placementProof?.version!==1||old.apiAssignment.placementProof.serviceVerified!==false
  ||old.apiAssignment.placementProof.siteLabel!==''||old.addressReview!=null
  ||proof?.contract!=='COS_REVIEWED_SHOP_ADDRESS_BASELINE_V1'||proof.baseSourceSha256!==previous.sourceSha256
  ||!hash(proof.sourceSha256)||!hash(proof.payloadSha256)||!Array.isArray(proof.records))return false;
 const matches=proof.records.filter((r:any)=>r.productId===row.productId);
 if(matches.length)return matches.length===1&&fields.every(k=>matches[0][k]===row[k])
  &&address.every(k=>typeof row.sourceAddress[k]==='string'&&matches[0].sourceAddress?.[k]===row.sourceAddress[k]);
 // A currently reviewed API Shop assignment may postdate the last CSV. The
 // company's single sealed Shop postal address is source evidence only; never
 // use another equipment record to infer identity or installation coordinates.
 const company=proof.records.filter((r:any)=>r.placement==='SHOP'&&r.customerId===row.customerId&&r.customer===row.customer);
 return company.length>0&&company.every((r:any)=>address.every(k=>typeof row.sourceAddress[k]==='string'&&r.sourceAddress?.[k]===row.sourceAddress[k]));
}

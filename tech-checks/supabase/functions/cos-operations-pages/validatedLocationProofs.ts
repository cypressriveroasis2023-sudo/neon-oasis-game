/** The map's existing validators remain the single acceptance boundary. This
 * server-only list authorizes retaining an existing point, never a new point or
 * a more precise/fresher label. It is built before placement-only overlays. */
import {checkedAddressEstimate} from '../../../operations/src/fieldAddressEstimates.ts';
import {isCurrentFieldPin} from '../../../operations/src/fieldLocations.ts';
type Row=Record<string,any>;
const fields=['address','addressSource','addressUpdatedAt','latitude','longitude','coordinateSource','gpsRecordedAt','gpsAccuracyM','hasUnitGps','installedSiteId','locationVerification','locationVerifiedAt','locationHistoryId','locationNote','locationGeocode','locationImportedGeocode','locationSourceRecorded','locationSourceRecordedConflict','importedInstallation','importedPlacement','placementPrecedenceBinding','addressEstimateOrganizationId','addressEstimateReviewEpoch','addressEstimateNativeRevision','addressEstimateLegacyEvidenceSha256','addressEstimateTrackerId','addressEstimateUnitNumber','historicalLatitude','historicalLongitude','historicalCoordinateSource','historicalRecordedAt'];
export async function validatedLocationProofs(snapshot:Row,now=Date.now(),options:{originalInventory?:Row[]}={}):Promise<Map<string,Row>>{
 const proofs=new Map<string,Row>(),ids=new Set<string>();
 if(!Array.isArray(snapshot.items)||!Array.isArray(snapshot.inventoryItems))throw Error('Location proof inventory unavailable');
 const fieldsInView=new Set(snapshot.items.map((r:Row)=>r.id));
 const originals=new Map<string,Row>();for(const row of options.originalInventory||[]){if(originals.has(row.id))throw Error('Duplicate original location identity');originals.set(row.id,row);}
 for(const row of snapshot.inventoryItems){
  if(ids.has(row.id))throw Error('Duplicate location proof identity');ids.add(row.id);
  if(!fieldsInView.has(row.id)||row.placement==='SHOP'||row.placement==='UNKNOWN'||row.placementStatus==='needs_identity_review'||row.placementReviewReason||row.representationStatus==='conflict'||typeof row.address!=='string'||!row.address.trim())continue;
  const verified=isCurrentFieldPin(row)&&Number.isFinite(Date.parse(row.locationVerifiedAt))&&Date.parse(row.locationVerifiedAt)<=now;
  const estimate=verified?null:await checkedAddressEstimate(row,now);if(!verified&&!estimate)continue;
  // Raw mHelp service coordinates have their own freshness/assignment contract;
  // they are never made durable by a newer CSV upload or this retention proof.
  if(estimate?.confidence==='mhelp_service_unverified')continue;
  const locationFields=Object.fromEntries(fields.filter(k=>Object.hasOwn(row,k)).map(k=>[k,structuredClone(row[k])]));
  const ownerPlacementFields=row.placementSource==='owner'?{...Object.fromEntries(['placementSource','placementAuditId','placementUnitKey','placementUpdatedAt','placementStatus'].filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]])),placementEvidence:row.placementEvidence??null}:null;
  const original=originals.get(row.id),normalize=(v:unknown)=>typeof v==='string'?v.trim().replace(/\s+/g,' ').toLowerCase():'';
  const originalAssignment=original&&original.unitNumber===row.unitNumber&&normalize(original.address)===normalize(row.address)?{unitId:row.id,unitNumber:row.unitNumber,customer:typeof original.customer==='string'?original.customer:null,site:typeof original.site==='string'?original.site:null}:null;
  proofs.set(row.id,{originalAssignment,contract:'COS_VALIDATED_LOCATION_PROOF_V1',unitId:row.id,unitNumber:row.unitNumber,kind:verified?'owner_verified':'address_estimate',productId:row.importedInstallation?.productId||row.locationSourceRecorded?.productId||null,address:row.address,customer:typeof row.customer==='string'?row.customer:null,site:typeof row.site==='string'?row.site:null,locationFields,ownerPlacementFields});
 }
 return proofs;
}
export function exactLocationProof(proofs:Map<string,Row>|undefined,row:Row):Row|null{
 const proof=proofs?.get(row.id);return proof?.contract==='COS_VALIDATED_LOCATION_PROOF_V1'&&proof.unitId===row.id&&proof.unitNumber===row.unitNumber&&['owner_verified','address_estimate'].includes(proof.kind)&&proof.address===row.address&&proof.locationFields?.address===proof.address?proof:null;
}

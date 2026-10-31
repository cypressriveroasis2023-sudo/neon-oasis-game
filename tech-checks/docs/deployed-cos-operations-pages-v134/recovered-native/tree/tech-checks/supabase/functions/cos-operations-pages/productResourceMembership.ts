/** Display attribution only. No producer profile/family admission, IO or writes. */
import {verifiedHealthIdentities,type IdentityReview,type UnitHealthIdentity} from './verifiedHealthIdentity.ts';
import {validateOwnerIdentitySnapshot,type ResourceEpoch} from './ownerIdentityCrosswalk.ts';
import {projectMhelpUploadPlacement} from './mhelpUploadPlacement.ts';
import {currentMhelpProductConnectionCensus} from './mhelpProductConnectionSource.ts';
import {isSupportEquipment} from '../../../operations/src/fieldCameraHealth.ts';
import type {FullSource} from '../_shared/exact-product-producer/fullSource.ts';
type Row=Record<string,any>;
const terminal=(v:unknown)=>typeof v==='string'&&/(?:^|\W)(RETIRED|DELETED|DECOMMISSIONED|STOLEN|DNU|DO\s+NOT\s+USE|NOT\s+IN\s+USE)(?:$|\W)/i.test(v);
/** Require complete, non-vacuous epoch coverage of the admitted resource set.
 * Native incarnation rules remain in the existing identity-kind validator. */
export function resourceEpochsCoverIdentity(proof:Pick<UnitHealthIdentity,'deviceIds'|'unitKeys'>,resources:readonly Row[],epochs:readonly ResourceEpoch[]):boolean{
 const ids=proof.deviceIds,keys=proof.unitKeys;
 if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!(/^[1-9][0-9]*$/).test(id))
  ||!Array.isArray(keys)||!keys.length||new Set(keys).size!==keys.length||keys.some(k=>typeof k!=='string'||!k||k!==k.trim()))return false;
 const equal=(a:readonly string[],b:readonly string[])=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
 if(!equal(ids,resources.map(r=>String(r.id)))||!equal(keys,[...new Set(resources.map(r=>r.unit_key))]))return false;
 return keys.every(key=>{
  const current=epochs.filter(e=>e.unitKey===key),members=resources.filter(r=>r.unit_key===key).map(r=>String(r.id));
  return current.length===1&&(/^[a-f0-9]{64}$/).test(current[0].epoch)&&Array.isArray(current[0].deviceIds)&&equal(current[0].deviceIds,members);
 });
}
/** The caller obtains this snapshot through the existing actor-gated, bracketed
 * sourceReader in this request. This read budget is independent of the
 * unchanged 20-minute saved TCP observation freshness policy. */
export async function productResourceMembership(source:FullSource,now=Date.now(),review?:IdentityReview){
 const readAt=Date.parse(source.verifiedAt);
 if(source.complete!==true||!Number.isFinite(readAt)||readAt>now||now-readAt>26_000)throw Error('Current complete membership source required');
 validateOwnerIdentitySnapshot(source.identitySources.ownerCrosswalk);
 const census=currentMhelpProductConnectionCensus(source.upload,now);
 if(source.tracker.expectedMhelpSourceSha256!==census.sourceSha256)throw Error('Membership source changed');
 const identity=await verifiedHealthIdentities(source.identitySources,review);
 const projected=projectMhelpUploadPlacement(source.map,source.upload,source.identitySources.audits,identity,now).snapshot.uploadInventory;
 if(!projected||projected.sourceSha256!==census.sourceSha256)throw Error('Membership projection changed');
 const proofs=[...identity.unitIdentities,...(identity.ownerConfirmedUnitIdentities||[])],members=new Map<string,readonly string[]>();
 const rows=source.identitySources.devices,byDevice=new Map<string,Row[]>(),byUnit=new Map<string,Row[]>(),byInventory=new Map<string,Row[]>(),byProduct=new Map(projected.records.map((r:Row)=>[r.productId,r]));
 for(const [list,key,map] of [[rows,'id',byDevice],[source.identitySources.units,'id',byUnit],[source.map.inventoryItems,'id',byInventory]] as const)for(const row of list){const id=String(row[key]);map.set(id,[...(map.get(id)||[]),row]);}
 for(const raw of source.upload.records){
  if(raw.placement!=='FIELD'||raw.lifecycle!=='UNFLAGGED'||isSupportEquipment({id:'mhelp_product:'+raw.productId,unitNumber:raw.unitNumber,modelName:raw.category}))continue;
  const b=raw.binding,p=byProduct.get(raw.productId) as Row|undefined,linked=p?.binding,ids=linked?.unitIds;
  if(!b||b.guardCurrent!==true||!b.nativeUnitId||linked?.state!=='linked'||linked.placementHeld||linked.reason||linked.candidateUnitIds?.length||!Array.isArray(ids)||!ids.includes(b.nativeUnitId)||ids.length>2||new Set(ids).size!==ids.length)continue;
  if(ids.some((id:string)=>id!==b.nativeUnitId&&(id!==b.trackerId||byUnit.has(id)||byInventory.get(id)?.length!==1||byInventory.get(id)![0].readOnly!==true)))continue;
  if(byInventory.get(b.nativeUnitId)?.length!==1||byInventory.get(b.nativeUnitId)![0].readOnly===true)continue;
  const native=byUnit.get(b.nativeUnitId)||[];
  if(native.length!==1||typeof native[0].status!=='string'||terminal(native[0].status)||terminal(native[0].unit_number))continue;
  const proof=proofs.filter(p=>p.unitId===b.nativeUnitId);
  if(proof.length!==1||identity.identityWarnings.some(w=>w.unitId===b.nativeUnitId)||!proof[0].deviceIds.length)continue;
  const resources=proof[0].deviceIds.map(id=>byDevice.get(String(id)));
  if(resources.some(r=>r?.length!==1))continue;
  const exact=resources.map(r=>r![0]);
  // Operational service evidence already requires ACTIVE in cameraEvidence.
  // A deactivated resource is held, never asserted physically removed/offline.
  // Free-form customer/organization labels are not lifecycle evidence.
  if(exact.some(r=>r.monitoring_enabled!==true||r.activation_state!=='active'||[r.device_name,r.unit_key].some(terminal)))continue;
  if(!resourceEpochsCoverIdentity(proof[0],exact,source.identitySources.ownerEpochs||[]))continue;
  members.set(raw.productId,proof[0].deviceIds.map(String));
 }
 return {census:projected,members};
}

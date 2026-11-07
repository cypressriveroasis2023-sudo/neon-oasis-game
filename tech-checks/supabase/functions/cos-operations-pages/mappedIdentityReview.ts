import {OwnerIdentityError,validateOwnerIdentitySnapshot} from './ownerIdentityCrosswalk.ts';
import {verifiedHealthIdentities,nativeIdentityKey,nativeIdentityTuple,identityDigest,healthResourceKey,healthSourceUnitKey,type IdentitySources} from './verifiedHealthIdentity.ts';
import {REVIEWED_NATIVE_IDENTITIES,REVIEWED_NATIVE_RESOURCES,REVIEWED_OWNER_IDENTITIES,REVIEWED_OWNER_RESOURCES,REVIEWED_OWNER_PHYSICAL_IDENTITIES} from './verifiedHealthIdentityScope.ts';
import {validateMhelpUploadReceipt} from './mhelpUploadPlacement.ts';
import {CAMERA_FRESH_MS} from './cameraEvidence.ts';
type Row=Record<string,any>;
const contract='COS_MAPPED_IDENTITY_REVIEW_ONLY_V1';
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function fail(message:string,status=409):never{throw new OwnerIdentityError(message,status);}

/** This evaluates a proposed commitment in memory. It neither adds a live proof
 * nor produces a token accepted by the existing Owner confirmation endpoint. */
export async function prepareMappedIdentityReview(sources:IdentitySources,upload:unknown,productId:string,unitKey:string,now:number){
 const receipt=validateMhelpUploadReceipt(upload,now);
 if(!receipt)fail('Current reviewed Product-ID source is unavailable.');
 const rows=receipt.records.filter((r:Row)=>r.productId===productId),row=rows[0],binding=row?.binding;
 if(rows.length!==1||row.lifecycle!=='UNFLAGGED'||row.holdReason||row.placementHeld||!binding?.nativeUnitId||binding.guardCurrent!==true)fail('The exact Product ID is missing, held or its identity guard is not current.');
 const unitId=binding.nativeUnitId;
 if(receipt.records.some((r:Row)=>r.productId!==productId&&[r.binding?.nativeUnitId,r.binding?.trackerId,...(r.binding?.representedUnitIds||[])].includes(unitId)))fail('Another Product ID represents this native unit.');
 const unit=sources.units.find(u=>u.id===unitId);
 if(!unit||typeof unit.status!=='string'||['retired','deleted'].includes(unit.status)||binding.nativeLabel!==unit.unit_number)fail('The native equipment is unavailable or its reviewed label changed.');
 validateOwnerIdentitySnapshot(sources.ownerCrosswalk);
 const crosswalk=sources.ownerCrosswalk!;
 const key=await nativeIdentityKey(unitId);
 if(REVIEWED_NATIVE_IDENTITIES[key]||REVIEWED_NATIVE_RESOURCES[key])fail('This native identity already has a reviewed or reserved commitment.');
 const links=sources.matches.filter(m=>m.equipment_unit_id===unitId);
 if(!links.length)fail('This review requires existing provider mappings.');
 const associations=links.map(match=>{
  const provider=sources.providers.find(p=>p.id===match.vigilant_device_id);
  const device=provider&&sources.devices.find(d=>d.external_device_id===provider.external_device_id);
  if(!provider||!device)fail('An existing mapping has no complete provider resource.');
  return {match,provider,device};
 });
 if(associations.some(a=>a.device.unit_key!==unitKey))fail('The requested exact source group does not match the existing mappings.');
 const ids=associations.map(a=>String(a.device.id)).sort((a,b)=>Number(a)-Number(b));
 if(crosswalk.claims.some(c=>c.native_unit_id===unitId||c.legacy_unit_key.toUpperCase()===unitKey.toUpperCase()||c.device_ids.some(id=>ids.includes(id))))fail('An active or revoked Owner commitment reserves this identity.');
 const nativeEpochs=crosswalk.nativeEpochs?.filter(e=>e.unitId===unitId),epochs=sources.ownerEpochs?.filter(e=>e.unitKey===unitKey);
 if(nativeEpochs?.length!==1||!hash(nativeEpochs[0].epoch)||epochs?.length!==1||!hash(epochs[0].epoch)||JSON.stringify([...epochs[0].deviceIds].sort())!==JSON.stringify([...ids].sort()))fail('Current complete identity incarnations are unavailable.');
 const proof=await identityDigest(nativeIdentityTuple(unit,associations));
 const resources={deviceIds:await Promise.all(ids.map(healthResourceKey)),unitKeys:[await healthSourceUnitKey(unitKey)]};
 // Reuse every production uniqueness, full-group, ownership and overlap check.
 // Existing commitments are copied, never relaxed or replaced.
 const simulated=await verifiedHealthIdentities(sources,{native:{...REVIEWED_NATIVE_IDENTITIES,[key]:proof},nativeResources:{...REVIEWED_NATIVE_RESOURCES,[key]:resources},owner:REVIEWED_OWNER_IDENTITIES,ownerResources:REVIEWED_OWNER_RESOURCES,ownerPhysical:REVIEWED_OWNER_PHYSICAL_IDENTITIES});
 const candidate=simulated.unitIdentities.find(i=>i.unitId===unitId);
 if(!candidate)fail('The complete provider identity requires conflict review.');
 const observations=associations.map(({device})=>{
  const at=typeof device.source_last_seen_at==='string'?Date.parse(device.source_last_seen_at):NaN;
  if(!Number.isFinite(at)||at>now||now-at>CAMERA_FRESH_MS)fail('A saved provider observation is stale, future-dated or unavailable.');
  return {deviceId:String(device.id),type:device.device_type,providerReportedStatus:['online','offline'].includes(device.source_status)?device.source_status:'unverified',observedAt:new Date(at).toISOString()};
 }).sort((a,b)=>Number(a.deviceId)-Number(b.deviceId));
 const evidence={contract,productId,unitId,unitNumber:row.unitNumber,unitKey,deviceIds:ids,sourceSha256:receipt.sourceSha256,payloadSha256:receipt.payloadSha256,proof,resources,nativeEpoch:nativeEpochs[0].epoch,resourceEpoch:epochs[0].epoch,crosswalkRevision:crosswalk.revision,binding,observations};
 return {contract,reviewOnly:true,commitSupported:false,productId,unitId,unitNumber:row.unitNumber,unitKey,deviceIds:ids,observations,liveVideoTested:false,sourceSha256:receipt.sourceSha256,reviewDigest:await identityDigest(evidence),consequence:'A separately approved identity commitment would permit existing saved provider observations to be evaluated for this unit. It would not verify live video, change placement or prove recorder camera-channel health.'};
}

/** Called behind the existing active Owner gate. Two independent complete reads
 * must agree. No RPC/write dependency or confirmation action is provided. */
export function createMappedIdentityReview(deps:{read:(key:string)=>Promise<{sources:IdentitySources;upload:unknown}>;now:()=>number}){
 return async(method:string,body:unknown)=>{
  if(method!=='POST'||!body||typeof body!=='object'||Array.isArray(body))fail('An explicit mapped identity preview is required.',400);
  const b=body as Row;
  if(Object.keys(b).some(k=>!['productId','unitKey'].includes(k))||typeof b.productId!=='string'||!/^\d{1,15}$/.test(b.productId)||typeof b.unitKey!=='string'||!b.unitKey||b.unitKey!==b.unitKey.trim()||b.unitKey.length>250||/[\x00-\x1f\x7f]/.test(b.unitKey))fail('Only an exact Product ID and source group may be requested.',400);
  const first=await deps.read(b.unitKey);
  const before=await prepareMappedIdentityReview(first.sources,first.upload,b.productId,b.unitKey,deps.now());
  const second=await deps.read(b.unitKey);
  const after=await prepareMappedIdentityReview(second.sources,second.upload,b.productId,b.unitKey,deps.now());
  if(before.reviewDigest!==after.reviewDigest)fail('The review evidence changed while loading. Reload; no identity was committed.');
  return after;
 };
}

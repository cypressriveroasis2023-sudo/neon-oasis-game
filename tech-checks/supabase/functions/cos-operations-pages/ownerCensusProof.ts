import {addressDigest} from './censusAddress.ts';
import {parseOwnerInstallationAddress} from '../_shared/ownerInstallationAddress.ts';
import {fullMatchedParts} from './importedAddressContract.ts';
import {placementMatchKey,placementIdentityConcernKey,currentOwnerPlacements} from './placementProjection.ts';
import {checkedMhelpPlacements} from './mhelpPlacementProjection.ts';

type Row=Record<string,any>;
export const OWNER_CENSUS_PROOF_CONTRACT='COS_OWNER_ONE_CENSUS_NATIVE_V1';
export const OWNER_CENSUS_SOURCE_CONTRACT='COS_OWNER_ONE_CENSUS_SOURCE_V1';
export const OWNER_CENSUS_NATIVE_FIELDS=['id','organization_id','model_id','unit_number','serial_number','status','current_location_type','current_location_ref','installed_site_id','retired_at','updated_at','gps_latitude','gps_longitude','gps_accuracy_m','gps_source','gps_recorded_at','gps_recorded_by'] as const;
export const OWNER_CENSUS_SITE_FIELDS=['id','organization_id','name','address_line1','address_line2','city','state_region','postal_code','latitude','longitude','updated_at'] as const;
const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const object=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const decimal=(v:unknown)=>typeof v==='string'&&/^[1-9]\d{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;
const text=(v:unknown,max=600)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f<>]/.test(v);
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const sameSet=(a:unknown[],b:unknown[])=>a.length===b.length&&new Set(a).size===a.length&&new Set(b).size===b.length&&a.every(v=>b.includes(v));
const fields=(row:Row,keys:readonly string[])=>keys.map(k=>{if(!Object.hasOwn(row,k))throw Error('Incomplete native source');return row[k];});
const coordinate=(v:unknown,max:number)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=max;
function stable(v:any):string {if(v===undefined)return 'null';if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(stable).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';}
const sorted=(rows:any[])=>rows.map(stable).sort();
async function digest(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(value)))),x=>x.toString(16).padStart(2,'0')).join('');}
export type OwnerCensusNativeProof={contract:typeof OWNER_CENSUS_PROOF_CONTRACT;nativeUnitId:string;auditId:string;unitKey:string;addressSha256:string;nativeGuardSha256:string;complete:true};
export type OwnerCensusSourceReceipt={contract:typeof OWNER_CENSUS_SOURCE_CONTRACT;nativeUnitId:string;auditId:string;unitKey:string;addressSha256:string;nativeSourceSha256:string;complete:true};
type OwnerCensusEvidence={proof:OwnerCensusNativeProof;receipt:OwnerCensusSourceReceipt};
export type OwnerCensusTargetRead={native:unknown;history:unknown;epochs:unknown;site:unknown};

export async function readOwnerCensusJson(response:Response,maxBytes=2097152):Promise<any>{
 if(!response.ok||Number(response.headers.get('content-length')||0)>maxBytes){await response.body?.cancel();throw Error('Owner source unavailable');}
 const reader=response.body?.getReader();if(!reader)throw Error('Owner source unavailable');
 const decoder=new TextDecoder('utf-8',{fatal:true});let body='',size=0;
 try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>maxBytes)throw Error('Owner source unavailable');body+=decoder.decode(chunk.value,{stream:true});}return JSON.parse(body+decoder.decode());}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

/** Full existing Owner history RPC, not a direct history-table read. Its actor
 * permission gate and unpaginated full-list contract were inspected in production.
 * Only allowed response fields participate; no raw history/person data is emitted. */
function targetTuple(value:OwnerCensusTargetRead,unitId:string,auditAt:string){
 const native=value.native;
 if(!object(native)||native.id!==unitId||native.organization_id!==ORG||!uuid(native.model_id)||!text(native.unit_number,250)
  ||native.retired_at!==null||!date(native.updated_at))throw Error('Native placement authority changed');
 const nativeTuple=fields(native,OWNER_CENSUS_NATIVE_FIELDS);
 const unassigned=native.status==='available'&&native.installed_site_id===null&&native.current_location_ref===null&&[null,''].includes(native.current_location_type);
 let siteTuple=null;
 if(unassigned){if(value.site!==null)throw Error('Unexpected native site');}
 else{
  const site=value.site;
  if(native.status!=='installed'||native.current_location_type!=='site'||!uuid(native.installed_site_id)||native.current_location_ref!==native.installed_site_id
   ||Date.parse(native.updated_at)>=Date.parse(auditAt)||native.gps_source!=='site'||!object(site)||site.id!==native.installed_site_id||site.organization_id!==ORG
   ||!date(site.updated_at)||Date.parse(site.updated_at)>=Date.parse(auditAt)
   ||!(site.latitude===null&&site.longitude===null||coordinate(site.latitude,90)&&coordinate(site.longitude,180)&&site.latitude===native.gps_latitude&&site.longitude===native.gps_longitude))throw Error('Native site authority is not proved historical');
  siteTuple=fields(site,OWNER_CENSUS_SITE_FIELDS);
 }
 const history=value.history;
 if(!object(history)||!Array.isArray(history.items)||history.items.length>10000)throw Error('Complete history unavailable');
 const seen=new Set<string>();
 const rows=history.items.map((h:unknown)=>{
  if(!object(h)||!uuid(h.id)||seen.has(h.id)||!coordinate(h.latitude,90)||!coordinate(h.longitude,180)
   ||!date(h.recordedAt)||Date.parse(h.recordedAt)>=Date.parse(auditAt)||!(h.accuracyM===null||typeof h.accuracyM==='number'&&Number.isFinite(h.accuracyM)&&h.accuracyM>=0)
   ||!text(h.source,100)||!(h.note===null||typeof h.note==='string'&&h.note.length<=10000)||!(h.recordedBy===null||typeof h.recordedBy==='string'&&h.recordedBy.length<=250))throw Error('History is malformed or newer than Owner placement');
  seen.add(h.id);return fields(h,['id','latitude','longitude','accuracyM','source','note','recordedAt','recordedBy']);
 });
 const gpsKeys=['gps_latitude','gps_longitude','gps_accuracy_m','gps_source','gps_recorded_at','gps_recorded_by'];
 if(gpsKeys.some(k=>native[k]!==null)){
  if(!coordinate(native.gps_latitude,90)||!coordinate(native.gps_longitude,180)||!date(native.gps_recorded_at)
   ||Date.parse(native.gps_recorded_at)>=Date.parse(auditAt)||!text(native.gps_source,100)||!uuid(native.gps_recorded_by)
   ||!(native.gps_accuracy_m===null||typeof native.gps_accuracy_m==='number'&&Number.isFinite(native.gps_accuracy_m)&&native.gps_accuracy_m>=0))throw Error('Partial or current GPS authority');
  const atTime=history.items.filter((h:Row)=>h.recordedAt===native.gps_recorded_at),matched=atTime.filter((h:Row)=>h.latitude===native.gps_latitude&&h.longitude===native.gps_longitude&&h.source===native.gps_source&&h.accuracyM===native.gps_accuracy_m);
  if(matched.length!==1||atTime.length!==1)throw Error('GPS history binding unavailable');
 }
 return {native:nativeTuple,history:sorted(rows),site:siteTuple};
}

/** Opaque current-source commitment. Actor identity is bound privately. No cache,
 * lease, lookup status, request time or health observation enters this hash. */
export type OwnerCensusProofInputs={actorId:string;record:Row;rawSnapshot:Row;snapshot:Row;bundle:Row;mhelpReceipt:unknown;target:OwnerCensusTargetRead};
export type OwnerCensusPreflightBinding={nativeUnitId:string;auditId:string;unitKey:string;addressSha256:string};
async function computeOwnerCensusProof(input:Omit<OwnerCensusProofInputs,'record'>&{binding:OwnerCensusPreflightBinding}):Promise<OwnerCensusEvidence|null>{
 try{
  const {actorId,binding:r,rawSnapshot,snapshot,bundle,mhelpReceipt,target}=input;
  if(!uuid(actorId)||!decimal(r.auditId)||!text(r.unitKey,250)||!sha(r.addressSha256)||!uuid(r.nativeUnitId)
   ||snapshot.placementProjectionVersion!==2||!Array.isArray(snapshot.nativePlacementAliases)||!Array.isArray(snapshot.items)||!Array.isArray(snapshot.inventoryItems)||!Array.isArray(rawSnapshot.inventoryItems))return null;
  const id=r.nativeUnitId,aliases=snapshot.nativePlacementAliases.filter((a:Row)=>a.unitId===id),rows=snapshot.inventoryItems.filter((a:Row)=>a.id===id),raw=rawSnapshot.inventoryItems.filter((a:Row)=>a.id===id);
  if(aliases.length!==1||rows.length!==1||raw.length!==1||snapshot.items.filter((a:Row)=>a.id===id).length!==1)return null;
  const alias=aliases[0],row=rows[0];
  if(alias.contract!=='COS_NATIVE_PLACEMENT_ALIAS_V1'||alias.writerContract!=='COS_CAMERA_PLACEMENT_V2'||alias.auditId!==r.auditId||alias.unitKey!==r.unitKey||!sha(alias.proof)
   ||!Array.isArray(alias.deviceIds)||!alias.deviceIds.length||alias.deviceIds.some((v:unknown)=>!decimal(v))||new Set(alias.deviceIds).size!==alias.deviceIds.length
   ||row.readOnly!==false||row.placementSource!=='owner'||row.placement!=='FIELD'||row.placementAuditId!==r.auditId||row.placementUnitKey!==r.unitKey
   ||row.unitNumber!==alias.unitNumber||row.locationVerification==='owner_verified'||row.placementStatus==='needs_identity_review'||row.placementReviewReason
   ||!text(row.address)||!parseOwnerInstallationAddress(row.address,fullMatchedParts)||await addressDigest(row.address)!==r.addressSha256)return null;
  const {sources:s,identity}=bundle;
  if(!object(s)||!object(identity)||![s.units,s.devices,s.matches,s.providers,s.audits].every(v=>Array.isArray(v)&&v.length<=100000&&v.every(object))
   ||!object(s.ownerCrosswalk)||!sha(s.ownerCrosswalk.revision)||!Array.isArray(s.ownerCrosswalk.nativeEpochs)||!Array.isArray(s.ownerEpochs))return null;
  const proofs=[...(identity.unitIdentities||[]),...(identity.ownerConfirmedUnitIdentities||[])],proof=proofs.filter(p=>p.unitId===id);
  if(proof.length!==1||!['native_provider','owner_confirmed_native'].includes(proof[0].kind)||proof[0].proof!==alias.proof||!sameSet(proof[0].deviceIds,alias.deviceIds)||!sameSet(proof[0].unitKeys,[r.unitKey])
   ||!Array.isArray(identity.identityWarnings)||identity.identityWarnings.some((w:Row)=>w.unitId===id||w.deviceIds?.some((d:string)=>alias.deviceIds.includes(d))||w.unitKeys?.includes(r.unitKey)))return null;
  const audit=currentOwnerPlacements(s.audits,s.devices).filter(a=>a.unit_key===r.unitKey&&String(a.id)===r.auditId);
  if(audit.length!==1||audit[0].conflictReason||audit[0].placement!=='FIELD'||audit[0].street_address!==row.address||!sameSet(audit[0].device_ids.map(String),alias.deviceIds))return null;
  const targetData=targetTuple(target,id,audit[0].created_at),native=target.native as Row;
  if(!Array.isArray(target.epochs)||target.epochs.length!==1||!object(target.epochs[0])||target.epochs[0].unitKey!==r.unitKey||!sha(target.epochs[0].epoch)
   ||!Array.isArray(target.epochs[0].deviceIds)||!sameSet(target.epochs[0].deviceIds,alias.deviceIds))return null;
  const nativeMembership=s.units.filter((u:Row)=>u.id===id),epochs=s.ownerCrosswalk.nativeEpochs.filter((e:Row)=>e.unitId===id);
  if(nativeMembership.length!==1||nativeMembership[0].status!==native.status||nativeMembership[0].unit_number!==native.unit_number||native.unit_number!==row.unitNumber||epochs.length!==1||!sha(epochs[0].epoch))return null;
  if(raw[0].gpsRecordedAt!==native.gps_recorded_at||raw[0].gpsAccuracyM!==native.gps_accuracy_m||raw[0].installedSiteId!==native.installed_site_id||raw[0].currentLocationType!==native.current_location_type||raw[0].activeJobNumber!==null)return null;
  if(native.gps_latitude!==null&&(raw[0].hasUnitGps!==true||raw[0].historicalLatitude!==native.gps_latitude||raw[0].historicalLongitude!==native.gps_longitude||raw[0].historicalCoordinateSource!==native.gps_source))return null;
  if(!object(raw[0]._placementProof)||typeof raw[0]._placementProof.owner!=='boolean')return null;
  if(!object(mhelpReceipt)||mhelpReceipt.contract!=='COS_MHELP_PLACEMENT_V1'||typeof mhelpReceipt.enabled!=='boolean'||!Array.isArray(mhelpReceipt.items)||mhelpReceipt.items.length>1000)return null;
  checkedMhelpPlacements(mhelpReceipt);
  const concerns=new Set([row.unitNumber,r.unitKey].map(placementMatchKey));
  const relatedMhelp=mhelpReceipt.items.filter((m:Row)=>!object(m)||m.nativeUnitId===id||concerns.has(placementMatchKey(m.nativeLabel))||concerns.has(placementMatchKey(m.trackerLabel)));
  if(relatedMhelp.length)return null; // Never silently decide competing native/mHelp precedence.
  // Discover collision concerns from the COMPLETE input rosters. These labels
  // only select negative/changed evidence; the positive binding is the exact alias.
  const concernKeys=new Set([row.unitNumber,r.unitKey].map(placementIdentityConcernKey)),relatedLabel=(v:unknown)=>concernKeys.has(placementIdentityConcernKey(v));
  const targetDevices=s.devices.filter((d:Row)=>alias.deviceIds.includes(String(d.id)));
  const devices=s.devices.filter((d:Row)=>alias.deviceIds.includes(String(d.id))||relatedLabel(d.unit_key)||targetDevices.some((t:Row)=>t.external_device_id&&t.external_device_id===d.external_device_id||t.device_serial&&t.device_serial===d.device_serial));
  const deviceIds=new Set<string>(devices.map((d:Row)=>String(d.id))),unitIds=new Set<string>(s.units.filter((u:Row)=>u.id===id||relatedLabel(u.unit_number)).map((u:Row)=>u.id));
  const providers=s.providers.filter((p:Row)=>devices.some((d:Row)=>d.external_device_id&&d.external_device_id===p.external_device_id));
  const providerIds=new Set<string>(providers.map((p:Row)=>p.id));
  const nativeEdges=new Map<string,string[]>(),providerEdges=new Map<string,string[]>();
  for(const m of s.matches){nativeEdges.set(m.equipment_unit_id,[...(nativeEdges.get(m.equipment_unit_id)||[]),m.vigilant_device_id]);providerEdges.set(m.vigilant_device_id,[...(providerEdges.get(m.vigilant_device_id)||[]),m.equipment_unit_id]);}
  const pending=[...unitIds].map(v=>['native',v]).concat([...providerIds].map(v=>['provider',v]));
  for(let i=0;i<pending.length;i++){
   const [kind,key]=pending[i],edges=kind==='native'?nativeEdges:providerEdges,seen=kind==='native'?providerIds:unitIds;
   for(const next of edges.get(key)||[])if(!seen.has(next)){seen.add(next);pending.push([kind==='native'?'provider':'native',next]);}
  }
  const claims=s.ownerCrosswalk.claims.filter((c:Row)=>unitIds.has(c.native_unit_id)||relatedLabel(c.legacy_unit_key)||c.device_ids.some((d:string)=>deviceIds.has(d)));
  const sourceIdentity={
   nativeEpoch:epochs[0].epoch,ownerClaims:sorted(claims),
   nativeRoster:sorted(s.units.filter((u:Row)=>unitIds.has(u.id)).map((u:Row)=>fields(u,['id','organization_id','unit_number','status']))),
   devices:sorted(devices.map((d:Row)=>[String(d.id),d.unit_key,d.source,d.device_type,d.external_device_id??null,d.device_serial??null])),
   matches:sorted(s.matches.filter((m:Row)=>unitIds.has(m.equipment_unit_id)||providerIds.has(m.vigilant_device_id)).map((m:Row)=>fields(m,['id','organization_id','equipment_unit_id','vigilant_device_id','camera_key','match_method','confidence']))),
   providers:sorted(s.providers.filter((p:Row)=>providerIds.has(p.id)).map((p:Row)=>fields(p,['id','organization_id','external_device_id','device_name','device_type','source']))),
   audits:sorted(s.audits.filter((a:Row)=>relatedLabel(a.unit_key)||unitIds.has(a.control_id)||a.control_id===audit[0].control_id||a.device_ids?.some((d:unknown)=>deviceIds.has(String(d)))).map((a:Row)=>[String(a.id),a.unit_key,a.contract,a.control_id,a.request_id,a.action,a.placement,a.site_label,a.street_address,a.created_at,a.device_ids])),
   admittedIdentity:proof[0],alias,rawProof:raw[0]._placementProof,target:targetData,targetEpoch:target.epochs[0],mhelp:{enabled:mhelpReceipt.enabled,relevant:relatedMhelp},
  };
  const binding={nativeUnitId:id,auditId:r.auditId,unitKey:r.unitKey,addressSha256:r.addressSha256,complete:true as const};
  return {proof:{...binding,contract:OWNER_CENSUS_PROOF_CONTRACT,nativeGuardSha256:await digest([OWNER_CENSUS_PROOF_CONTRACT,ORG,actorId,r.auditId,r.unitKey,r.addressSha256,sourceIdentity])},
   receipt:{...binding,contract:OWNER_CENSUS_SOURCE_CONTRACT,nativeSourceSha256:await digest([OWNER_CENSUS_SOURCE_CONTRACT,ORG,r.auditId,r.unitKey,r.addressSha256,sourceIdentity])}};
 }catch{return null;}
}

async function ownerCensusEvidence(input:OwnerCensusProofInputs):Promise<OwnerCensusEvidence|null>{
 const r=input.record;
 if(!object(r)||r.censusOnly!==true||!['draining','ready','consumed'].includes(r.censusOnlyState)||!object(r.censusOnlyGuard)||!sha(r.censusOnlyGuard.nativeGuardSha256))return null;
 return computeOwnerCensusProof({...input,binding:{nativeUnitId:r.censusOnlyGuard.nativeUnitId,auditId:r.auditId,unitKey:r.unitKey,addressSha256:r.addressSha256}});
}

export async function ownerCensusProof(input:OwnerCensusProofInputs):Promise<OwnerCensusNativeProof|null>{return (await ownerCensusEvidence(input))?.proof??null;}
export async function ownerCensusSourceReceipt(input:OwnerCensusProofInputs):Promise<OwnerCensusSourceReceipt|null>{return (await ownerCensusEvidence(input))?.receipt??null;}

/** Normal authenticated Owner preparation after an exact server-issued marker.
 * No enrolled record or placeholder guard is synthesized. Both target reads use
 * that current actor's existing history permission and original legacy bearer. */
export async function readOwnerCensusPreparation(input:Omit<OwnerCensusProofInputs,'record'|'target'>&{binding:OwnerCensusPreflightBinding;readTarget:(id:string)=>Promise<OwnerCensusTargetRead>}):Promise<{eligible:true;nativeGuardSha256:string;nativeSourceSha256:string}|null>{
 try{
  if(!uuid(input.actorId)||!uuid(input.binding.nativeUnitId)||!decimal(input.binding.auditId)||!text(input.binding.unitKey,250)||!sha(input.binding.addressSha256))return null;
  const a=await computeOwnerCensusProof({...input,target:await input.readTarget(input.binding.nativeUnitId)});if(!a)return null;
  const b=await computeOwnerCensusProof({...input,target:await input.readTarget(input.binding.nativeUnitId)});
  return b&&stable(a)===stable(b)?{eligible:true,nativeGuardSha256:b.proof.nativeGuardSha256,nativeSourceSha256:b.receipt.nativeSourceSha256}:null;
 }catch{return null;}
}

/** Private offline enrollment preparation only. Call with independently obtained
 * CURRENT Owner/session and successful existing history-RPC authorization evidence.
 * This does not authenticate a browser assertion, create policy or call a provider. */
export async function preflightOwnerCensusBinding(input:Omit<OwnerCensusProofInputs,'record'>&{binding:OwnerCensusPreflightBinding;authorization:unknown},now:number){
 const a=input.authorization;
 if(!Number.isFinite(now)||!object(a)||a.contract!=='COS_CURRENT_OWNER_READ_AUTHORIZATION_V1'||a.actorId!==input.actorId||a.organizationId!==ORG||a.role!=='owner'||a.active!==true||a.equipmentView!==true
  ||!date(a.verifiedAt)||Date.parse(a.verifiedAt)>now||now-Date.parse(a.verifiedAt)>60000||!object(a.history)||a.history.actorId!==input.actorId
  ||a.history.nativeUnitId!==input.binding.nativeUnitId||a.history.authorized!==true||a.history.complete!==true)return {eligible:false,reason:'current_owner_authorization_unavailable'};
 try{
  const audits=currentOwnerPlacements(input.bundle.sources.audits,input.bundle.sources.devices).filter(a=>a.unit_key===input.binding.unitKey&&String(a.id)===input.binding.auditId);
  if(audits.length!==1)return {eligible:false,reason:'owner_placement_unavailable'};
  targetTuple(input.target,input.binding.nativeUnitId,audits[0].created_at);
 }catch(error){
  const reasons:Record<string,string>={'Incomplete native source':'native_fields_incomplete','Native placement authority changed':'native_authority_changed','Unexpected native site':'site_scope_mismatch','Native site authority is not proved historical':'historical_site_unproven','Complete history unavailable':'history_unavailable','History is malformed or newer than Owner placement':'history_newer_or_malformed','Partial or current GPS authority':'gps_partial_or_current','GPS history binding unavailable':'gps_history_unbound'};
  return {eligible:false,reason:reasons[error instanceof Error?error.message:'']||'complete_current_source_unavailable'};
 }
 const proof=await computeOwnerCensusProof(input);
 return proof?{eligible:true,nativeGuardSha256:proof.proof.nativeGuardSha256,nativeSourceSha256:proof.receipt.nativeSourceSha256,identity:'complete',history:'historical_only',placement:'owner_field'}:{eligible:false,reason:'complete_current_source_unavailable'};
}

/** Exact-target reads use the requesting already-authorized Field View actor.
 * Execution proof output remains Owner-only; source receipts stay backend-private. */
type OwnerCensusReadInputs={actorId:string;records:Row[];rawSnapshot:Row;snapshot:Row;bundle:Row;mhelpReceipt:unknown;readTarget:(id:string)=>Promise<OwnerCensusTargetRead>};
export async function readOwnerCensusEvidence(input:OwnerCensusReadInputs,allowExecutionProofs:boolean):Promise<{proofs:OwnerCensusNativeProof[];receipts:OwnerCensusSourceReceipt[]}>{
 const candidates=input.records.filter(r=>r?.censusOnly===true),result={proofs:[] as OwnerCensusNativeProof[],receipts:[] as OwnerCensusSourceReceipt[]};
 if(candidates.length>1000||new Set(candidates.map(r=>r.censusOnlyGuard?.nativeUnitId)).size!==candidates.length)return result;
 for(const record of candidates){
  try{
   const id=record.censusOnlyGuard?.nativeUnitId;if(!uuid(id))continue;
   const first=await input.readTarget(id),a=await ownerCensusEvidence({...input,record,target:first});if(!a)continue;
   const second=await input.readTarget(id),b=await ownerCensusEvidence({...input,record,target:second});
   if(b&&stable(a)===stable(b)){result.receipts.push(b.receipt);if(allowExecutionProofs)result.proofs.push(b.proof);}
  }catch{/* Permission/read failure never becomes empty history or alternate credentials. */}
 }
 return result;
}
export async function readOwnerCensusProofs(input:OwnerCensusReadInputs):Promise<OwnerCensusNativeProof[]>{return (await readOwnerCensusEvidence(input,true)).proofs;}
export function matchesOwnerCensusReceipt(receipt:OwnerCensusSourceReceipt|undefined,record:Row,id:string){
 return !!receipt&&receipt.contract===OWNER_CENSUS_SOURCE_CONTRACT&&receipt.complete===true&&Object.keys(receipt).length===7&&sha(receipt.nativeSourceSha256)&&record.censusOnly===true
  &&receipt.nativeUnitId===id&&record.censusOnlyGuard?.nativeUnitId===id&&receipt.auditId===record.auditId&&receipt.unitKey===record.unitKey&&receipt.addressSha256===record.addressSha256
  &&sha(record.censusOnlySourceSha256)&&receipt.nativeSourceSha256===record.censusOnlySourceSha256;
}

export function matchesOwnerCensusProof(proof:OwnerCensusNativeProof|undefined,record:Row,id:string){
 return !!proof&&proof.contract===OWNER_CENSUS_PROOF_CONTRACT&&proof.complete===true&&Object.keys(proof).length===7&&sha(proof.nativeGuardSha256)&&record.censusOnly===true&&proof.nativeUnitId===id&&proof.auditId===record.auditId&&proof.unitKey===record.unitKey&&proof.addressSha256===record.addressSha256
  &&proof.nativeGuardSha256===record.censusOnlyGuard?.nativeGuardSha256&&record.censusOnlyGuard?.nativeUnitId===id;
}

/** Current protected source -> exact Product/native/complete resource proof.
 * No mapping admission, credentials, IO or persisted changes in this module. */
import {verifiedHealthIdentities,type IdentitySources,type IdentityReview} from '../../cos-operations-pages/verifiedHealthIdentity.ts';
import {validateOwnerIdentitySnapshot} from '../../cos-operations-pages/ownerIdentityCrosswalk.ts';
import {projectMhelpUploadPlacement} from '../../cos-operations-pages/mhelpUploadPlacement.ts';
import {currentMhelpProductConnectionCensus} from '../../cos-operations-pages/mhelpProductConnectionSource.ts';
import {buildExactProductConnections,TRACKER_CONNECTION_CENSUS_V2,completedSavedTcpCheck} from '../../../../operations/src/exactProductConnection.ts';
import {directPublicHost} from '../scheduledDirectService.ts';
import {digest,targetsValid} from './model.ts';
type Row=Record<string,any>;
export const RECEIPT_CONTRACT='COS_PRODUCT_TCP_RECEIPT_V2' as const;
export const PROFILES:Readonly<Record<string,string>>=Object.freeze({'Spotter':'spotter','Solar Spotter':'solar_spotter','Ranger':'ranger'});
const terminal=(v:unknown)=>typeof v==='string'&&/(?:^|\W)(RETIRED|DECOMMISSIONED|STOLEN|DNU|DO\s+NOT\s+USE|NOT\s+IN\s+USE)(?:$|\W)/i.test(v);
const decimal=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?String(v):typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)?v:null;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export type LocalDevice={id:string;revision:string;ip:string;ports:number[];profile:string;source:string;enabled:boolean;activation:string;unitKey:string;name:string;organization:string;externalId:string|null;serial:string|null;type:string|null};
export type GroupProof={contract:typeof RECEIPT_CONTRACT;productId:string;nativeUnitId:string;family:string;authorityGuard:string;identityGuard:string;bindingGuard:string;sourceSha256:string;trackerSha256:string;crosswalkRevision:string;epochGuard:string;resourceEpochs:{unitKey:string;epoch:string;deviceIds:string[]}[];nativeEpoch:string|null;verifiedAt:string;devices:LocalDevice[]};
export type FullSource={upload:Row;map:Row;identitySources:IdentitySources;tracker:Row;complete:true;verifiedAt:string};
export function localDevice(d:Row):LocalDevice|null{
 const id=decimal(d.id),revision=decimal(d.connection_revision),ip=directPublicHost(d.public_ip);
 const ports=d.expected_ports;
 if(!id||id==='0'||revision===null||!ip||ip!==d.public_ip||!Array.isArray(ports)||!ports.length||ports.length>32
  ||ports.some(p=>!Number.isInteger(p)||p<1||p>65535)||new Set(ports).size!==ports.length)return null;
 if(!['source','monitoring_profile','activation_state','unit_key','device_name','organization'].every(k=>typeof d[k]==='string')||typeof d.monitoring_enabled!=='boolean')return null;
 return {id,revision,ip,ports:[...ports],profile:d.monitoring_profile,source:d.source,enabled:d.monitoring_enabled,activation:d.activation_state,
  unitKey:d.unit_key,name:d.device_name,organization:d.organization,externalId:d.external_device_id??null,serial:d.device_serial??null,type:d.device_type??null};
}
export async function buildProductGroups(source:FullSource,ids:readonly string[],now=Date.now(),review?:IdentityReview){
 if(!targetsValid(ids)||source.complete!==true||!Number.isFinite(Date.parse(source.verifiedAt))||Date.parse(source.verifiedAt)>now||now-Date.parse(source.verifiedAt)>30_000)throw Error('Complete current source required');
 if(source.upload.contract!=='COS_MHELP_API_V1'||source.tracker.contract!==TRACKER_CONNECTION_CENSUS_V2)throw Error('Complete API and 2027 source required');
 // Validate the complete protected upload AND current native/group identity.
 validateOwnerIdentitySnapshot(source.identitySources.ownerCrosswalk);
 const identity=await verifiedHealthIdentities(source.identitySources,review);
 const projected=projectMhelpUploadPlacement(source.map,source.upload,source.identitySources.audits,identity,now).snapshot.uploadInventory;
 const minimal=currentMhelpProductConnectionCensus(source.upload,now);
 if(!projected||projected.sourceSha256!==minimal.sourceSha256)throw Error('Source projection changed');
 // No endpoints here: preserve ALL Product-ID source/IP-claim holds, then
 // separately establish exact reviewed group membership (never collapse by IP).
 const admission=buildExactProductConnections(projected,source.tracker,[],now);
 if(!admission)throw Error('Current complete tracker authority unavailable');
 const rows=source.identitySources.devices,allIdentities=[...identity.unitIdentities,...(identity.ownerConfirmedUnitIdentities||[])];
 if(new Set(rows.map(d=>String(d.id))).size!==rows.length)throw Error('Duplicate device IDs');
 const sourceGuard=await digest({sourceSha256:source.upload.sourceSha256,payloadSha256:source.upload.payloadSha256,
  records:source.upload.records,apiMissingRecords:source.upload.apiMissingRecords,scopedRevision:source.upload.scopedRevision??null,
  trackerSha256:source.tracker.trackerSourceSha256,trackerRecords:source.tracker.records,
  crosswalk:source.identitySources.ownerCrosswalk??null,epochs:source.identitySources.ownerEpochs??[],
  identities:identity,inventory:source.map.inventoryItems});
 const groups:GroupProof[]=[],held:{productId:string;reason:string}[]=[];
 for(const productId of ids){
  const hold=(reason:string)=>held.push({productId,reason});
  const gate=admission.items.find(p=>p.productId===productId);
  if(gate?.reason!=='No saved camera endpoint matches the current tracker IP.'){hold('source_or_ip_claim_hold');continue;}
  const record=projected.records.find((r:Row)=>r.productId===productId),raw=source.upload.records.find((r:Row)=>r.productId===productId),b=raw?.binding;
  const binding=record?.binding;
  if(!b||b.guardCurrent!==true||binding?.state!=='linked'||binding.placementHeld||binding.reason||binding.candidateUnitIds?.length
   ||!Array.isArray(binding.unitIds)||binding.unitIds.length!==1||binding.unitIds[0]!==b.nativeUnitId){hold('product_native_binding_hold');continue;}
  const native=source.identitySources.units.filter(u=>u.id===b.nativeUnitId);
  if(native.length!==1||typeof native[0].status!=='string'||['retired','deleted'].includes(native[0].status)||terminal(native[0].status)){hold('native_lifecycle_hold');continue;}
  const proof=allIdentities.filter(i=>i.unitId===b.nativeUnitId);
  if(proof.length!==1||identity.identityWarnings.some(w=>w.unitId===b.nativeUnitId)||proof[0].deviceIds.length<1||proof[0].deviceIds.length>16){hold('reviewed_complete_identity_required');continue;}
  const family=raw.category,profile=PROFILES[family];
  if(!profile){hold('family_protocol_unreviewed');continue;}
  const members=rows.filter(d=>proof[0].deviceIds.includes(String(d.id))),devices=members.map(localDevice);
  const ip=source.tracker.records.find((r:Row)=>r.productId===productId)?.publicIp;
  // Include disabled/foreign and unrelated records when finding IP collisions.
  const allAtIp=rows.filter(d=>directPublicHost(d.public_ip)===ip);
  if(members.length!==proof[0].deviceIds.length||allAtIp.length!==members.length||allAtIp.some(d=>!proof[0].deviceIds.includes(String(d.id)))){hold('endpoint_group_conflict');continue;}
  if(devices.some(d=>!d||d.ip!==ip||!d.enabled||d.profile!==profile||d.source!=='vigilant_control_center'
   ||!['active','deactivated'].includes(d.activation)||[d.activation,d.unitKey,d.name,d.organization].some(terminal))){hold('endpoint_configuration_or_lifecycle_hold');continue;}
  const valid=devices as LocalDevice[];
  if(valid.some(d=>!same([...d.ports].sort((a,b)=>a-b),[...valid[0].ports].sort((a,b)=>a-b)))){hold('group_port_set_mismatch');continue;}
  valid.sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1);
  const resourceEpochs=(source.identitySources.ownerEpochs??[]).filter(e=>proof[0].unitKeys.includes(e.unitKey));
  if(resourceEpochs.length!==proof[0].unitKeys.length||new Set(resourceEpochs.map(e=>e.unitKey)).size!==resourceEpochs.length||resourceEpochs.some(e=>!(/^[a-f0-9]{64}$/).test(e.epoch)||!Array.isArray(e.deviceIds)||new Set(e.deviceIds).size!==e.deviceIds.length||!same([...e.deviceIds].sort(),valid.filter(d=>d.unitKey===e.unitKey).map(d=>d.id).sort()))){hold('current_resource_epoch_required');continue;}
  const nativeEpoch=source.identitySources.ownerCrosswalk!.nativeEpochs?.find(e=>e.unitId===b.nativeUnitId)?.epoch??null;
  const identityGuard=await digest(proof[0]),epochGuard=await digest(resourceEpochs);
  const authorityGuard=await digest({sourceGuard,identityGuard,binding:b,devices:valid});
  groups.push({contract:RECEIPT_CONTRACT,productId,nativeUnitId:b.nativeUnitId,family,authorityGuard,identityGuard,
   bindingGuard:b.expectedGuard,sourceSha256:source.upload.sourceSha256,trackerSha256:source.tracker.trackerSourceSha256,
   crosswalkRevision:source.identitySources.ownerCrosswalk!.revision,epochGuard,resourceEpochs,nativeEpoch,verifiedAt:source.verifiedAt,devices:valid});
 }
 return {groups,held};
}
/** Read-side authorization is mandatory even for accepted persisted receipts.
 * A remote change after the final producer read cannot contaminate global health:
 * these scoped receipts are only consumed against fresh full source proof. */
export function consumeProductReceipt(current:GroupProof,receipt:Row,now=Date.now()){
 if(receipt?.state!=='accepted'||receipt.payload?.contract!==RECEIPT_CONTRACT||receipt.payload.proof?.authorityGuard!==current.authorityGuard
  ||receipt.payload.proof?.productId!==current.productId||Date.parse(current.verifiedAt)>now||now-Date.parse(current.verifiedAt)>30_000)return null;
 const {ports,checkedAt}=receipt.payload;
 const results=current.devices.map(d=>completedSavedTcpCheck({deviceId:d.id,publicIp:d.ip,expectedPorts:d.ports,connectionRevision:d.revision,monitoringEnabled:d.enabled,
  portStatus:{...ports,_connection:{ip:d.ip,revision:d.revision,checkedAt,status:Object.values(ports||{}).some((p:any)=>p?.online===true)?'online':'offline',reachable:Object.values(ports||{}).some((p:any)=>p?.online===true)}}},now));
 if(!results.length||results.some(r=>!r)||new Set(results.map(r=>r!.status)).size!==1)return null;
 return {productId:current.productId,status:results[0]!.status,basis:'tcp_service_port',checkedAt:results[0]!.checkedAt,
  deviceCount:results.length,reason:'Completed saved service-port check for the current reviewed equipment group. Camera video is not verified.'};
}

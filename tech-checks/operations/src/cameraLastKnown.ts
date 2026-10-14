import {cameraTimestamp,cameraRecord,cameraState,providerRecord,providerState,resourceKind,type CameraRow} from './cameraEvidence';
import {canonicalCameraUnit,fieldCameraHealth,type FieldHealthUnit,type Health,type UnitCameraHealth} from './fieldCameraHealth';
import type {FleetSnapshot} from './fleetSnapshot';
import {savedConnectionObservation} from './savedConnectionObservation';

export type LastKnownCamera={state:'online'|'offline';basis:NonNullable<UnitCameraHealth['basis']>;label:string;observedAt:string;oldestObservedAt:string};
type Entry={observation:LastKnownCamera;unitSignature:string;sourceSignature:string;authoritySignature:string;deviceIds:string[];unitKeys:string[]};
export type CameraHistory=ReadonlyMap<string,Entry>;
const stable=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const sorted=(values:string[])=>[...values].sort();
// These are the identity/placement inputs used by the existing classifier,
// including the independent Field-recorder authority and its source binding.
function unitSignature(unit:FieldHealthUnit,units:FieldHealthUnit[]){
 const value=unit as FieldHealthUnit&Record<string,unknown>,key=canonicalCameraUnit(unit.unitNumber);
 const fields=['id','unitNumber','modelName','readOnly','status','currentLocationType','importedPlacement','placementSource','placementAuditId','placementUnitKey','importedInstallation','fieldRecorderAuthority','activeInventoryEligible','placement','effectivePlacement'];
 return stable({unit:Object.fromEntries(fields.map(field=>[field,value[field]])),peers:units.filter(peer=>peer.id===unit.id||peer.unitNumber===unit.unitNumber||key&&canonicalCameraUnit(peer.unitNumber)===key).map(peer=>[peer.id,peer.unitNumber,peer.modelName]).sort()});
}
function sourceSignature(health:Health,deviceIds:string[],unitKeys:string[]){
 const keys=unitKeys.map(canonicalCameraUnit).filter(Boolean);
 const rows=health.rows.filter(row=>deviceIds.includes(String(row.id))||unitKeys.includes(row.unit)||keys.includes(canonicalCameraUnit(row.unit)));
 // Summary status/read times can age without a new observation. Do not use
 // those fields to renew history or to discard unchanged source evidence.
 const source=(row:CameraRow)=>({id:String(row.id),unit:row.unit,type:row.type,trackerOnly:row.trackerOnly,scope:row.scope,activationState:row.activationState,connection:row.connection,evidence:row.evidence,serviceEvidence:row.serviceEvidence});
 return stable(rows.map(source).sort((a,b)=>a.id.localeCompare(b.id)));
}
function authoritySignature(health:Health){
 return stable({evidenceVersion:health.evidenceVersion,identityVersion:health.identityVersion,unitIdentities:health.unitIdentities,ownerConfirmedIdentityVersion:health.ownerConfirmedIdentityVersion,ownerConfirmedUnitIdentities:health.ownerConfirmedUnitIdentities,reconProviderIdentityVersion:health.reconProviderIdentityVersion,reconProviderUnitIdentities:health.reconProviderUnitIdentities,identityWarnings:health.identityWarnings,fieldRecorderObservationVersion:health.fieldRecorderObservationVersion,fieldRecorderObservationGuards:health.fieldRecorderObservationGuards});
}
/** Only actual accepted, definitive classifications enter memory. No clock
 * rewind, stale-row reclassification, persistent storage or network request. */
export function rememberCameraHistory(previous:CameraHistory,fleet:FleetSnapshot,now=Date.now()):CameraHistory{
 const units=((fleet.fieldMap as any).inventoryItems||fleet.fieldMap.items) as FieldHealthUnit[],next=new Map<string,Entry>();
 // One shared string per accepted snapshot, not one whole-envelope allocation
 // per unit. Keep the conservative cross-unit authority invalidation rule.
 const authority=authoritySignature(fleet.health);
 for(const unit of units){
  const result=fieldCameraHealth(unit,units,fleet.health,now),signature=unitSignature(unit,units),old=previous.get(unit.id);
  if(result.identity==='matched'&&(result.state==='online'||result.state==='offline')&&result.basis){
   const supportingRows=result.rows.filter(row=>result.basis==='connection'?savedConnectionObservation(row,now)===result.state
     :result.basis==='camera'?cameraRecord(row)&&cameraState(row,now)===result.state
     :result.basis==='recorder'?resourceKind(row)==='recorders'&&providerRecord(row)&&(result.classification?.fieldRecorderVerified?row.evidence?.status===result.state:providerState(row,now)===result.state)
     :providerRecord(row)&&providerState(row,now)===result.state);
   const times=supportingRows.flatMap(row=>{
    const evidence=result.basis==='connection'?row.serviceEvidence||(row.evidence?.kind==='service_port'?row.evidence:undefined):row.evidence;
    const time=cameraTimestamp(evidence?.observedAt,now);
    return time.fresh&&time.at&&['online','offline'].includes(evidence?.status||'')?[time.at]:[];
   }).sort();
   if(!times.length)continue;
   const prefix={camera:supportingRows.every(row=>row.evidence?.resource==='detector')?'DETECTOR RECORDS':'CAMERA RECORDS',recorder:'RECORDER',provider:'PROVIDER SYSTEM',connection:'IP / PORT'}[result.basis];
   const deviceIds=sorted(result.rows.map(row=>String(row.id))),unitKeys=sorted([...new Set(result.rows.map(row=>row.unit))]);
   next.set(unit.id,{unitSignature:signature,sourceSignature:sourceSignature(fleet.health,deviceIds,unitKeys),authoritySignature:authority,deviceIds,unitKeys,observation:{state:result.state,basis:result.basis,label:prefix+' '+result.state.toUpperCase(),observedAt:times.at(-1)!,oldestObservedAt:times[0]}});
  }else if(old&&old.unitSignature===signature&&old.authoritySignature===authority&&old.sourceSignature===sourceSignature(fleet.health,old.deviceIds,old.unitKeys)){
   // Identical accepted evidence merely aged. New unknown/mixed evidence,
   // missing authority, changed memberships and warnings invalidate history.
   next.set(unit.id,old);
  }
 }
 return next;
}
/** Historical text only; never an input to current status, totals or map colors. */
export function lastKnownCamera(history:CameraHistory,unit:FieldHealthUnit,units:FieldHealthUnit[],current:UnitCameraHealth|null|undefined):LastKnownCamera|null{
 if(current?.state!=='unknown')return null;
 const entry=history.get(unit.id);
 return entry&&entry.unitSignature===unitSignature(unit,units)?entry.observation:null;
}

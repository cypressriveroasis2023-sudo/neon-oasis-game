import {cameraTimestamp,resourceKind,providerRecord,providerState,cameraState,combinedState,type CameraRow,type CameraState,type EvidenceState} from './cameraEvidence';
import {savedConnectionObservation} from './savedConnectionObservation';

/** Server-verified resource associations. Display labels alone never establish these links. */
export type VerifiedUnitIdentity={unitId:string;unitNumber:string;kind:'native_provider'|'owner_placement'|'owner_confirmed_native';deviceIds:string[];unitKeys:string[];proof:string;placementAuditId?:string};
export type IdentityWarning={unitId:string;reason:string;deviceIds?:string[];unitKeys?:string[]};
export type IdentityEnvelope={identityVersion?:number;unitIdentities?:VerifiedUnitIdentity[];ownerConfirmedIdentityVersion?:number;ownerConfirmedUnitIdentities?:VerifiedUnitIdentity[];identityWarnings?:IdentityWarning[];evidenceVersion?:number;rows:CameraRow[]};
export type IdentityUnit={id:string;unitNumber:string;placementAuditId?:string;placementUnitKey?:string};
export type IdentityResolution={state:'verified';identity:VerifiedUnitIdentity;rows:CameraRow[]}|{state:'unavailable'|'conflict';reason:string};
const object=(value:unknown):value is Record<string,any>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const text=(value:unknown):value is string=>typeof value==='string'&&value.trim()!=='';
const resourceId=(value:unknown):value is string=>typeof value==='string'&&/^[1-9]\d*$/.test(value);
const sameSet=(a:string[],b:string[])=>a.length===b.length&&new Set(a).size===a.length&&new Set(b).size===b.length&&a.every(x=>b.includes(x));
export function validateIdentityEnvelope(value:IdentityEnvelope){
  if(value.identityVersion===undefined){if(value.unitIdentities!==undefined||value.identityWarnings!==undefined||value.ownerConfirmedIdentityVersion!==undefined||value.ownerConfirmedUnitIdentities!==undefined)throw new Error('Equipment identity contract is incomplete.');return;}
  if(value.identityVersion!==1||value.evidenceVersion!==2||!Array.isArray(value.unitIdentities)||value.unitIdentities.length>1000)throw new Error('Equipment identity contract is unavailable.');
  if(value.ownerConfirmedIdentityVersion===undefined?value.ownerConfirmedUnitIdentities!==undefined:value.ownerConfirmedIdentityVersion!==1||!Array.isArray(value.ownerConfirmedUnitIdentities)||value.ownerConfirmedUnitIdentities.length>1000||value.ownerConfirmedUnitIdentities.some(row=>row.kind!=='owner_confirmed_native'))throw new Error('Owner-confirmed identity contract is unavailable.');
  if(value.unitIdentities.some(row=>row.kind==='owner_confirmed_native'))throw new Error('Owner-confirmed identities require the additive contract.');
  for(const row of [...value.unitIdentities,...(value.ownerConfirmedUnitIdentities||[])]){
    if(!object(row)||!text(row.unitId)||!text(row.unitNumber)||!['native_provider','owner_placement','owner_confirmed_native'].includes(row.kind)||!Array.isArray(row.deviceIds)||!row.deviceIds.length||row.deviceIds.length>1000||!row.deviceIds.every(resourceId)||!Array.isArray(row.unitKeys)||!row.unitKeys.length||!row.unitKeys.every(text)||!/^[a-f0-9]{64}$/.test(row.proof)||row.kind==='owner_placement'&&!resourceId(row.placementAuditId))throw new Error('Equipment identity proof is malformed.');
  }
  if(value.identityWarnings!==undefined&&(!Array.isArray(value.identityWarnings)||value.identityWarnings.length>1000||value.identityWarnings.some(row=>!object(row)||!text(row.unitId)||!text(row.reason)||(row.deviceIds!==undefined&&(!Array.isArray(row.deviceIds)||!row.deviceIds.every(resourceId)))||(row.unitKeys!==undefined&&(!Array.isArray(row.unitKeys)||!row.unitKeys.every(text))))))throw new Error('Equipment identity warnings are malformed.');
}
export function allVerifiedUnitIdentities(value:IdentityEnvelope):VerifiedUnitIdentity[]{validateIdentityEnvelope(value);return [...(value.unitIdentities||[]),...(value.ownerConfirmedUnitIdentities||[])];}
function resolve(identity:VerifiedUnitIdentity,health:IdentityEnvelope):IdentityResolution{
  const fail=(reason:string):IdentityResolution=>({state:'conflict',reason});
  const identities=allVerifiedUnitIdentities(health);
  if(identities.filter(x=>x.unitId===identity.unitId).length!==1||new Set(identity.unitKeys).size!==identity.unitKeys.length||new Set(identity.deviceIds).size!==identity.deviceIds.length)return fail('Equipment identity has duplicate or conflicting associations.');
  if(identities.some(x=>x!==identity&&x.deviceIds.some(id=>identity.deviceIds.includes(id))))return fail('A source resource is associated with more than one equipment identity.');
  const rows=health.rows.filter(row=>identity.deviceIds.includes(String(row.id)));
  if(!sameSet(rows.map(row=>String(row.id)),identity.deviceIds)||rows.some(row=>row.trackerOnly||!identity.unitKeys.includes(row.unit)))return fail('The expected source resource set is incomplete or changed.');
  const group=health.rows.filter(row=>identity.unitKeys.includes(row.unit));
  if(!sameSet(group.map(row=>String(row.id)),identity.deviceIds))return fail('The current source group no longer matches the complete verified resource set.');
  if(identity.kind==='native_provider'&&rows.some(row=>row.evidence?.kind!=='provider'||row.evidence.source!=='Star4Live'||!providerRecord(row)))return fail('The linked provider identity changed.');
  return {state:'verified',identity,rows};
}
export function resolveVerifiedUnitIdentity(unit:IdentityUnit,health:IdentityEnvelope):IdentityResolution{
  try{validateIdentityEnvelope(health);}catch{return {state:'conflict',reason:'Equipment identity proof could not be verified. Reload saved results.'};}
  if(health.identityVersion!==1)return {state:'unavailable',reason:'No durable equipment-to-resource association is available.'};
  const warnings=health.identityWarnings?.filter(row=>row.unitId===unit.id)||[];
  if(warnings.length)return {state:'conflict',reason:warnings[0].reason};
  const identities=allVerifiedUnitIdentities(health).filter(row=>row.unitId===unit.id);
  if(identities.length!==1)return {state:identities.length?'conflict':'unavailable',reason:identities.length?'Equipment identity has conflicting source associations.':'No durable equipment-to-resource association is available.'};
  const identity=identities[0];
  if(identity.unitNumber!==unit.unitNumber)return {state:'conflict',reason:'The saved equipment label changed after its resource association was verified.'};
  if(identity.kind==='owner_placement'&&(String(unit.placementAuditId||'')!==identity.placementAuditId||unit.placementUnitKey!==identity.unitNumber))return {state:'conflict',reason:'The Owner placement changed. Reload the map and saved source evidence.'};
  return resolve(identity,health);
}
export type GroupIdentity={state:'verified';identity:VerifiedUnitIdentity}|{state:'conflict';reason:string}|{state:'unlinked'};
export function groupIdentityForRows(rows:CameraRow[],health:IdentityEnvelope):GroupIdentity{
  try{validateIdentityEnvelope(health);}catch{return {state:'conflict',reason:'Equipment identity proof is malformed or unavailable.'};}
  if(health.identityVersion!==1)return {state:'unlinked'};
  const related=(claim:{deviceIds?:string[];unitKeys?:string[]})=>rows.some(row=>claim.deviceIds?.includes(String(row.id))||claim.unitKeys?.includes(row.unit));
  const warnings=health.identityWarnings?.filter(warning=>related(warning)||warning.deviceIds===undefined&&warning.unitKeys===undefined)||[];
  if(warnings.length)return {state:'conflict',reason:warnings[0].reason};
  const matches=allVerifiedUnitIdentities(health).filter(related);
  if(!matches.length)return {state:'unlinked'};
  if(matches.length!==1)return {state:'conflict',reason:'Source resources have conflicting equipment associations.'};
  const verified=resolve(matches[0],health);
  if(verified.state!=='verified')return {state:'conflict',reason:verified.reason};
  if(!sameSet(matches[0].deviceIds,rows.map(row=>String(row.id))))return {state:'conflict',reason:'The source group is incomplete for the verified equipment identity.'};
  return {state:'verified',identity:matches[0]};
}
export function verifiedIdentityForRows(rows:CameraRow[],health:IdentityEnvelope):VerifiedUnitIdentity|null{
  const result=groupIdentityForRows(rows,health);return result.state==='verified'?result.identity:null;
}
/** An exact name cannot claim resources committed to a different saved equipment ID. */
export function legacyIdentityConflict(unitId:string,rows:CameraRow[],health:IdentityEnvelope):string|null{
  if(health.identityVersion!==1)return null;
  const related=(claim:{deviceIds?:string[];unitKeys?:string[]})=>rows.some(row=>claim.deviceIds?.includes(String(row.id))||claim.unitKeys?.includes(row.unit));
  if(allVerifiedUnitIdentities(health).some(identity=>identity.unitId!==unitId&&related(identity)))return 'These source resources belong to another verified equipment identity. Review this separate field record before linking it.';
  const warning=health.identityWarnings?.find(related);return warning?.reason||null;
}
export type LinkedUnitObservation={state:EvidenceState;basis:'camera'|'recorder'|'provider'|'connection';label:string;checkedAt:string|null;providerState:EvidenceState;cameraState:CameraState;serviceState:EvidenceState};
/** Proven identity and current source state are independent of physical placement. */
export function linkedUnitObservation(rows:CameraRow[],now=Date.now()):LinkedUnitObservation{
  const providers=rows.filter(row=>['cameras','detectors','recorders'].includes(resourceKind(row))),cameras=rows.filter(row=>['cameras','detectors'].includes(resourceKind(row)));
  // Every expected resource participates; filtering missing proof would turn a partial group green.
  const provider=providers.length?combinedState(rows.map(row=>providerState(row,now))) as EvidenceState:'verifying';
  const service=combinedState(rows.map(row=>savedConnectionObservation(row,now))) as EvidenceState;
  const camera=cameras.length?combinedState(rows.map(row=>cameraState(row,now))):'mapping';
  const basis=providers.length&&provider!=='verifying'?providers.every(row=>resourceKind(row)==='recorders')?'recorder':providers.every(row=>['cameras','detectors'].includes(resourceKind(row)))?'camera':'provider':!providers.length||service!=='verifying'?'connection':providers.every(row=>resourceKind(row)==='recorders')?'recorder':'camera';
  const state=basis==='connection'?service:provider;
  const prefix={camera:'CAMERA RECORDS',recorder:'RECORDER',provider:'PROVIDER SYSTEM',connection:'IP / PORT'}[basis];
  const times=rows.map(row=>basis==='connection'?row.serviceEvidence?.observedAt:row.evidence?.observedAt).map(value=>cameraTimestamp(value,now).at).filter((value):value is string=>Boolean(value)).sort();
  return {state,basis,label:prefix+' '+({online:'ONLINE',offline:'OFFLINE',degraded:'MIXED / PARTLY VERIFIED',verifying:'UNVERIFIED'}[state]),checkedAt:times.at(-1)||null,providerState:provider,cameraState:camera,serviceState:service};
}

/** Public, pure presentation semantics. A saved observation is not a live probe. */
export const CAMERA_FRESH_MS = 15 * 60 * 1000;
export type EvidenceState = 'online'|'offline'|'degraded'|'verifying';
export type CameraState = EvidenceState|'mapping';
export type PlacementScope = 'field'|'shop'|'inactive'|'unknown';
export type ResourceKind = 'cameras'|'detectors'|'recorders'|'unitInventory'|'other';
export type CameraEvidence = {
  kind:'provider'|'service_port'|'unknown'; source:string;
  resource?:'camera'|'detector'|'recorder'|'service'|'unknown'; active?:boolean;
  status:'online'|'offline'|'degraded'|'unknown'; observedAt:string|null; lastOnlineAt:string|null;
  reachable?:boolean|null; confirmedOutage?:boolean; consecutiveFailures?:number|null;
};
export type CameraRow = {
  id:string|number; name:string; unit:string; type?:string; organization?:string; status:string;
  activationState?:string; scope?:PlacementScope; trackerOnly?:boolean;
  checkedAt?:string|null; evidence?:CameraEvidence; serviceEvidence?:CameraEvidence;
};
export type UnitEvidence = {
  scope:PlacementScope; state:EvidenceState|'service'|'mapping'|'shop'|'inactive';
  providerState:EvidenceState; cameraState:CameraState; serviceState:EvidenceState;
  systemKind:'recorder'|'detector'|'system'; recorderOffline:boolean;
};
const normalized=(value:unknown)=>typeof value==='string'?value.trim().replace(/\s+/g,' ').toUpperCase():'';
export function cameraTimestamp(value:unknown,now=Date.now()):{at:string|null;fresh:boolean} {
  if(typeof value!=='string')return {at:null,fresh:false};
  const p=/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
  const d=p?new Date(Date.UTC(+p[1],+p[2]-1,+p[3])):null;
  const valid=p&&d?.getUTCFullYear()===+p[1]&&d.getUTCMonth()===+p[2]-1&&d.getUTCDate()===+p[3]&&+p[4]<24&&+p[5]<60&&+p[6]<60;
  const parsed=valid?Date.parse(value.replace(/([+-]\d{2})$/,'$1:00')):NaN;
  return Number.isFinite(parsed)&&parsed>0&&parsed<=now?{at:new Date(parsed).toISOString(),fresh:now-parsed<=CAMERA_FRESH_MS}:{at:null,fresh:false};
}
export function resourceKind(row:Pick<CameraRow,'type'|'trackerOnly'>):ResourceKind {
  const type=normalized(row.type).toLowerCase();
  return row.trackerOnly?'unitInventory':['ipc','camera'].includes(type)?'cameras':['detector','reconeyez detector'].includes(type)?'detectors':type==='nvr'?'recorders':/^(?:sniper(?: [24])?|camv|tracker_unit)$/.test(type)?'unitInventory':'other';
}
export const cameraRecord=(row:CameraRow)=>!row.trackerOnly&&['cameras','detectors'].includes(resourceKind(row));
const providerSource=(value:unknown)=>['Star4Live','Reconeyez'].includes(String(value));
export function providerRecord(row:CameraRow) {
  const kind=resourceKind(row),resource=kind==='cameras'?'camera':kind==='detectors'?'detector':kind==='recorders'?'recorder':null;
  return !row.trackerOnly&&resource!==null&&row.evidence?.kind==='provider'&&row.evidence.resource===resource&&providerSource(row.evidence.source);
}
export function currentCameraStatus(evidence?:CameraEvidence,now=Date.now()):'online'|'offline'|'review' {
  return evidence?.kind==='provider'&&['camera','detector'].includes(evidence.resource||'')&&evidence.active===true&&providerSource(evidence.source)&&cameraTimestamp(evidence.observedAt,now).fresh&&['online','offline'].includes(evidence.status)?evidence.status as 'online'|'offline':'review';
}
export function providerState(row:CameraRow,now=Date.now()):EvidenceState {
  if(normalized(row.activationState)!=='ACTIVE'||!providerRecord(row)||row.evidence?.active!==true)return 'verifying';
  return cameraTimestamp(row.evidence.observedAt,now).fresh&&['online','offline'].includes(row.evidence.status)?row.evidence.status as 'online'|'offline':'verifying';
}
export function cameraState(row:CameraRow,now=Date.now()):CameraState {
  if(row.trackerOnly)return 'mapping';
  if(!cameraRecord(row)||!providerRecord(row)||normalized(row.activationState)!=='ACTIVE')return 'verifying';
  const value=currentCameraStatus(row.evidence,now);return value==='review'?'verifying':value;
}
export function serviceState(row:CameraRow,now=Date.now()):EvidenceState {
  const evidence=row.serviceEvidence|| (row.evidence?.kind==='service_port'?row.evidence:undefined);
  if(normalized(row.activationState)!=='ACTIVE'||evidence?.kind!=='service_port'||evidence.active!==true||!cameraTimestamp(evidence.observedAt,now).fresh)return 'verifying';
  if(evidence.status==='online'&&evidence.reachable===true)return 'online';
  if(evidence.status==='offline'&&(evidence.confirmedOutage===true||Number.isInteger(evidence.consecutiveFailures)&&Number(evidence.consecutiveFailures)>=3))return 'offline';
  return evidence.status==='degraded'&&evidence.reachable===true?'degraded':'verifying';
}
export function combinedState(states:CameraState[],empty:CameraState='verifying'):CameraState {
  if(!states.length)return empty;
  return states.every(state=>state==='online')?'online':states.every(state=>state==='offline')?'offline':states.some(state=>['online','offline','degraded'].includes(state))?'degraded':'verifying';
}
export function classifyCameraUnit(rows:CameraRow[],now=Date.now()):UnitEvidence {
  const active=rows.filter(row=>row.scope!=='inactive');
  const scopes=new Set(active.map(row=>row.scope||'unknown'));
  const scope:PlacementScope=!active.length?'inactive':scopes.size===1?[...scopes][0]:'unknown';
  const cameras=active.filter(cameraRecord),providers=active.filter(providerRecord);
  const provider=combinedState(providers.map(row=>providerState(row,now))) as EvidenceState;
  const camera=combinedState(cameras.map(row=>cameraState(row,now)),'mapping');
  const service=combinedState(active.map(row=>serviceState(row,now))) as EvidenceState;
  const state=scope==='inactive'?'inactive':scope==='shop'?'shop':provider!=='verifying'?provider:service==='online'?'service':providers.length?'verifying':'mapping';
  return {scope,state,providerState:scope==='inactive'||scope==='shop'?'verifying':provider,cameraState:scope==='inactive'||scope==='shop'?'mapping':camera,serviceState:scope==='inactive'||scope==='shop'?'verifying':service,systemKind:providers.length&&providers.every(row=>resourceKind(row)==='recorders')?'recorder':providers.length&&providers.every(row=>resourceKind(row)==='detectors')?'detector':'system',recorderOffline:active.some(row=>resourceKind(row)==='recorders'&&providerState(row,now)==='offline')};
}
export function evidenceCoverage(groups:UnitEvidence[]) {
  const active=groups.filter(group=>['field','unknown'].includes(group.scope));
  const count=(key:'providerState'|'cameraState',state:string)=>active.filter(group=>group[key]===state).length;
  const online=count('providerState','online'),offline=count('providerState','offline');
  return {total:active.length,online,offline,review:active.length-online-offline,degraded:count('providerState','degraded'),serviceReachable:active.filter(group=>group.providerState==='verifying'&&group.serviceState==='online').length,cameraOnline:count('cameraState','online'),cameraOffline:count('cameraState','offline'),cameraMixed:active.filter(group=>['degraded','verifying'].includes(group.cameraState)).length,cameraUnavailable:count('cameraState','mapping')};
}
export function unitEvidenceLabel(group:UnitEvidence) {
  if(group.state==='shop')return 'SHOP / ROOT';if(group.state==='inactive')return 'INACTIVE';
  if(group.state==='service')return 'SERVICE REACHABLE';
  const kind=group.systemKind==='recorder'?'RECORDER':group.systemKind==='detector'?'DETECTOR':'SYSTEM';
  return kind+' '+({online:'ONLINE',offline:'OFFLINE',degraded:'MIXED / UNVERIFIED',verifying:'NOT VERIFIED',mapping:'STATUS UNVERIFIED'} as Record<string,string>)[group.state];
}
export function cameraEvidenceLabel(state:CameraState) {
  return {online:'Reported camera/detector records online',offline:'Reported camera/detector records offline',degraded:'Camera/detector records mixed or partly unverified',verifying:'Camera/detector status unverified',mapping:'Camera channel status unavailable'}[state];
}
export function serviceEvidenceLabel(state:EvidenceState) {
  return {online:'Service endpoint reachable',offline:'Service check failed',degraded:'Service checks mixed',verifying:'Service status unverified'}[state];
}
export function observationAge(value:unknown,now=Date.now()) {
  const stamp=cameraTimestamp(value,now);if(!stamp.at)return 'Time not recorded / invalid';
  const minutes=Math.floor((now-Date.parse(stamp.at))/60000);
  return (minutes<1?'less than a minute':minutes<60?minutes+' min':minutes<1440?Math.floor(minutes/60)+' hr':Math.floor(minutes/1440)+' days')+' ago'+(stamp.fresh?' · within 15-minute presentation window':' · older observation; current status unverified');
}

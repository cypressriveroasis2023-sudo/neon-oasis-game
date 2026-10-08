/** Private bridge projection. Presentation semantics are mirrored by the public pure helper and contract-tested. */
import {CAMERA_FRESH_MS, serviceEvidence, savedCameraConnection} from './cameraEvidence.ts';
export {CAMERA_FRESH_MS, serviceEvidence} from './cameraEvidence.ts';
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
export type ReconBatteryEvidence = {source:'Reconeyez';percent:number|null;percentObservedAt:string|null;status:'normal'|'low'|'critical'|null;statusObservedAt:string|null};
/** Percent and warning observations keep their own source times. Refresh never renews them. */
export function reconBatteryEvidence(percent:unknown,percentAt:unknown,status:unknown,statusAt:unknown):ReconBatteryEvidence {
  const numeric=typeof percent==='number'?percent:typeof percent==='string'&&/^\d+(?:\.\d+)?$/.test(percent.trim())?Number(percent):NaN;
  return {source:'Reconeyez',percent:Number.isFinite(numeric)&&numeric>=0&&numeric<=100?numeric:null,percentObservedAt:typeof percentAt==='string'?percentAt:null,status:typeof status==='string'&&['normal','low','critical'].includes(status)?status as 'normal'|'low'|'critical':null,statusObservedAt:typeof statusAt==='string'?statusAt:null};
}
export type CameraRow = {
  id:string|number; name:string; unit:string; type?:string; organization?:string; status:string;
  connection?:{publicIp:string;ports:number[]};
  activationState?:string; scope?:PlacementScope; trackerOnly?:boolean;
  checkedAt?:string|null; evidence?:CameraEvidence; serviceEvidence?:CameraEvidence; batteryEvidence?:ReconBatteryEvidence;
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
  return (minutes<1?'less than a minute':minutes<60?minutes+' min':minutes<1440?Math.floor(minutes/60)+' hr':Math.floor(minutes/1440)+' days')+' ago'+(stamp.fresh?' · within 20-minute presentation window':' · older observation; current status unverified');
}

/** Only the bounded source projection is accepted; no source metadata is returned. */
type SourceRecord=Record<string,any>;
export type TrackerPlacement={canonical_family:string;unit_tag:string;source_label:string;tracker_state:string;health_provider?:string|null};
const sourceText=(value:unknown)=>typeof value==='string'?value:null;
const resourceId=(value:unknown):string|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):typeof value==='string'&&/^[1-9]\d*$/.test(value)?value:null;
const object=(value:unknown):value is SourceRecord=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
export function cameraScope(device:SourceRecord,tracker:TrackerPlacement[]=[]):PlacementScope {
  const activation=normalized(device.activation_state),org=normalized(device.organization),unit=normalized(device.unit_key);
  if(device.__ownerPlacement==='FIELD'||device.__ownerPlacement==='SHOP'||device.__ownerPlacement==='UNKNOWN')return device.__ownerPlacement.toLowerCase();
  if(/^STOLEN FROM RII?[-\s]*\d+ ON \d{2}\/\d{2}\/\d{4}$/.test(unit)||/^STOLEN FROM RII?[-\s]*\d+ ON \d{2}\/\d{2}\/\d{4}$/.test(org)||['RETIRED','STOLEN','NOT IN USE'].includes(org)||/^RII?[-\s]*\d+\s*-?\s*(?:NOT IN USE|RETIRED|STOLEN)$/.test(unit))return 'inactive';
  if(['ROOT','SHOP','SHOP/ROOT','ROOT/SHOP','SHOP / ROOT','ROOT / SHOP','SHOP EQUIPMENT'].includes(org)||unit==='SHOP EQUIPMENT'||/^RII?[-\s]*\d+\s*-?\s*SHOP$/.test(unit))return 'shop';
  if(activation==='DEACTIVATED')return 'inactive';
  if(activation!=='ACTIVE')return 'unknown';
  const matches=tracker.filter(row=>normalized(row.source_label)===unit);
  if(matches.length>1||matches.some(row=>['shop','retired'].includes(row.tracker_state)))return 'unknown';
  if(device.__trackerOnly||!org||['TRACKER FIELD','TRACKER · SITE NOT LINKED','UNKNOWN','FIELD OR UNKNOWN'].includes(org))return 'unknown';
  return 'field';
}
export function cameraEvidence(device:SourceRecord):CameraEvidence {
  const type=String(device.device_type||'').trim().toLowerCase();
  const resource=['ipc','camera'].includes(type)?'camera':['detector','reconeyez detector'].includes(type)?'detector':type==='nvr'?'recorder':'unknown';
  const provider=device.source==='vigilant_control_center'?'Star4Live':device.source==='reconeyez'?'Reconeyez':null;
  const active=normalized(device.activation_state)==='ACTIVE';
  return {kind:provider&&resource!=='unknown'?'provider':'unknown',source:provider||'Unverified provider source',resource,active,status:['online','offline'].includes(device.source_status)?device.source_status:'unknown',observedAt:sourceText(device.source_last_seen_at),lastOnlineAt:sourceText(device.last_online_at)};
}
export function validateCameraSources(devices:SourceRecord[],health:SourceRecord[],tracker:TrackerPlacement[]) {
  if(![devices,health,tracker].every(Array.isArray))throw new Error('Camera Health source records are unavailable.');
  const textOrMissing=(value:unknown)=>value==null||typeof value==='string',seen=new Set<string>(),checked=new Set<string>();
  for(const row of devices){const id=object(row)?resourceId(row.id):null;if(!id||seen.has(id)||!['device_name','device_type','organization','unit_key','source','source_status','source_last_seen_at','last_online_at','last_probe_online_at','activation_state'].every(key=>textOrMissing(row[key])))throw new Error('Camera Health returned malformed or duplicate device identities.');seen.add(id);}
  for(const row of health){const id=object(row)?resourceId(row.camera_device_id):null;if(!id||!seen.has(id)||checked.has(id)||!['overall_status','checked_at'].every(key=>textOrMissing(row[key]))||(row.confirmed_outage!=null&&typeof row.confirmed_outage!=='boolean')||(row.ip_reachable!=null&&typeof row.ip_reachable!=='boolean')||(row.consecutive_failures!=null&&(!Number.isSafeInteger(row.consecutive_failures)||row.consecutive_failures<0)))throw new Error('Camera Health returned malformed or duplicate health identities.');checked.add(id);}
  for(const row of tracker)if(!object(row)||!(['canonical_family','unit_tag','source_label','tracker_state'] as const).every(key=>typeof row[key]==='string')||!textOrMissing(row.health_provider))throw new Error('Camera Health tracker placement records are malformed.');
}
const trackerFamilies=['Helios','Ranger','Solar Spotter','Spotter','SS Hybrid','CAMV','Sniper','Sniper 2','Sniper 4','Recon','Recon 2'];
export function canonicalTrackerKey(row:TrackerPlacement):string|null {
  const family=trackerFamilies.find(value=>normalized(value)===normalized(row.canonical_family)),tag=row.unit_tag.trim();
  if(!family||!/^\d{1,6}(?:\.\d+)?$/.test(tag)||Number(tag.split('.')[0])===0)return null;
  const [base,...tail]=tag.split('.');return family.toLowerCase()+'|'+String(Number(base)).padStart(3,'0')+(tail.length?'.'+tail.join('.'): '');
}
function deviceTrackerKey(unit:unknown):string|null {
  if(typeof unit!=='string')return null;
  // Recognized inventory-state annotations retain the same asset identity for deduplication only.
  const scoped=/^(RII?[-\s]*\d+)\s*-?\s*(?:SHOP|NOT IN USE|RETIRED|STOLEN)$/.exec(normalized(unit));
  const stolen=/^STOLEN FROM (RII?[-\s]*\d+) ON \d{2}\/\d{2}\/\d{4}$/.exec(normalized(unit));
  const identityLabel=scoped?.[1]||stolen?.[1]||unit.trim();
  const match=/^(HELIOS|RANGER|SOLAR\s*SPOTTER|SPOTTER|SS\s*HYBRID|SNIPER(?:\s+[24])?|CAM\s*V|RECON(?:\s+(?:2|II))?|RII|RI)\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)$/i.exec(identityLabel);
  if(!match)return null;
  const aliases:Record<string,string>={RI:'Recon',RII:'Recon 2',RECONII:'Recon 2',RECON2:'Recon 2'};
  const condensed=normalized(match[1]).replace(/\s/g,'');
  const family=aliases[condensed]||trackerFamilies.find(value=>normalized(value).replace(/\s/g,'')===condensed);
  return family?canonicalTrackerKey({canonical_family:family,unit_tag:match[2],source_label:'',tracker_state:''}):null;
}
/** The integration read must use provider,units:metadata->units filtered to Witness. */
function witnessUnits(integrations:SourceRecord[]) {
  if(!Array.isArray(integrations)||integrations.some(row=>!object(row)||row.provider!=='witness'||(row.units!=null&&!object(row.units))))throw new Error('Witness service observations are malformed.');
  if(integrations.length>1)throw new Error('Witness service observations have duplicate provider identities.');
  return integrations[0]?.units||{};
}
export function cameraSummary(devices:SourceRecord[],health:SourceRecord[],now=Date.now(),tracker:TrackerPlacement[]=[],integrations:SourceRecord[]=[]) {
  validateCameraSources(devices,health,tracker);
  const byId=new Map(health.map(row=>[resourceId(row.camera_device_id),row])),witness=witnessUnits(integrations);
  const rows:CameraRow[]=devices.map(device=>{
    const evidence=cameraEvidence(device),service=serviceEvidence(device,byId.get(resourceId(device.id))||{},false,now);
    const row:CameraRow={id:device.id,name:device.device_name||device.unit_key||('Resource '+device.id),unit:device.unit_key||'',type:device.device_type||'',organization:device.organization||'',activationState:device.activation_state||'',scope:cameraScope(device,tracker),status:'review',checkedAt:evidence.observedAt,evidence,serviceEvidence:service};
    const connection=savedCameraConnection(device.public_ip,device.expected_ports);if(connection)row.connection=connection;
    if(device.source==='reconeyez')row.batteryEvidence=reconBatteryEvidence(device.recon_battery_percent,device.recon_battery_updated_at,device.recon_battery_status,device.recon_battery_status_updated_at);
    row.status=['field','unknown'].includes(row.scope!)?currentCameraStatus(evidence,now):'review';return row;
  });
  const linked=new Set(devices.map(device=>deviceTrackerKey(device.unit_key)).filter(Boolean));
  for(const device of devices)for(const record of tracker.filter(row=>normalized(row.source_label)===normalized(device.unit_key))){const key=canonicalTrackerKey(record);if(key)linked.add(key);}
  const synthesized=new Set<string>();
  for(const record of tracker){
    const key=canonicalTrackerKey(record);if(!key||record.tracker_state!=='field_or_unknown'||linked.has(key)||synthesized.has(key))continue;
    synthesized.add(key);
    const peers=tracker.filter(row=>canonicalTrackerKey(row)===key);
    const exactLabel=normalized(record.source_label),labelKey=deviceTrackerKey(record.source_label),identitySafe=peers.length===1&&exactLabel!==''&&(!labelKey||labelKey===key)&&tracker.filter(row=>normalized(row.source_label)===exactLabel).length===1;
    const observed=identitySafe&&String(record.health_provider||'').toLowerCase()==='witness'&&Object.hasOwn(witness,key)&&object(witness[key])?witness[key]:{};
    // Each DTO is an allowlist. Unknown metadata, IP addresses, tokens and provider payloads cannot escape.
    const service=serviceEvidence({activation_state:'active'},observed,true,now);
    rows.push({id:'tracker:'+key,name:record.source_label||record.canonical_family+' '+record.unit_tag,unit:record.source_label||record.canonical_family+' '+record.unit_tag,type:'tracker_unit',organization:'TRACKER · SITE NOT LINKED',activationState:'active',scope:'unknown',trackerOnly:true,status:'review',checkedAt:service.observedAt,serviceEvidence:service});
  }
  rows.sort((a,b)=>a.name.localeCompare(b.name));
  const fields=rows.filter(row=>row.scope==='field');
  const inventory={allRecords:rows.length,activeFieldRecords:fields.length,activeShopRecords:rows.filter(row=>row.scope==='shop').length,inactiveRecords:rows.filter(row=>row.scope==='inactive').length,unknownScopeRecords:rows.filter(row=>row.scope==='unknown').length,sourceDeviceRecords:devices.length,trackerOnlyRecords:rows.filter(row=>row.trackerOnly).length};
  return {totalDevices:rows.length,healthRows:health.length,fieldDevices:fields.length,shopRoot:inventory.activeShopRecords,online:fields.filter(row=>row.status==='online').length,offline:fields.filter(row=>row.status==='offline').length,review:fields.filter(row=>row.status==='review').length,rows,refreshedAt:new Date(now).toISOString(),source:'Camera Health',evidenceVersion:2,inventory,coverageNote:'Provider systems, camera/detector observations and service ports are separate. Expected camera channel coverage is not established. Field devices counts confirmed-field resources; displayed inventory also includes unresolved placement, shop/root, inactive and tracker-only resources.'};
}



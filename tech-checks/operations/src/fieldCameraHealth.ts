import {validateIdentityEnvelope,resolveVerifiedUnitIdentity,linkedUnitObservation,legacyIdentityConflict,type VerifiedUnitIdentity,type IdentityWarning,type LinkedUnitObservation} from './verifiedUnitIdentity';
import { cameraTimestamp, cameraRecord, cameraState, combinedState, classifyCameraUnit, type CameraRow, type UnitEvidence } from './cameraEvidence';
import {savedConnectionObservation} from './savedConnectionObservation';
export type { CameraRow } from './cameraEvidence';
export type Health = {totalDevices:number;online:number;offline:number;review:number;shopRoot:number;healthRows:number;fieldDevices:number;refreshedAt:string;rows:CameraRow[];evidenceVersion?:number;inventory?:{allRecords:number;activeFieldRecords:number;activeShopRecords:number;inactiveRecords:number;unknownScopeRecords?:number};coverageNote?:string;identityVersion?:number;unitIdentities?:VerifiedUnitIdentity[];ownerConfirmedIdentityVersion?:number;ownerConfirmedUnitIdentities?:VerifiedUnitIdentity[];identityWarnings?:IdentityWarning[]};
export type FieldHealthUnit = {id:string;unitNumber:string;modelName?:string;category?:string;readOnly?:boolean;address?:string;site?:string;customer?:string;placementAuditId?:string;placementUnitKey?:string};
export type UnitCameraHealth = {state:'online'|'offline'|'unknown'|'support';reason:string;rows:CameraRow[];unitKey:string|null;checkedAt:string|null;identity:'matched'|'missing'|'ambiguous';classification:(UnitEvidence&{observation?:LinkedUnitObservation})|null;basis?:'camera'|'connection'|'recorder'|'provider';observation?:LinkedUnitObservation;association?:VerifiedUnitIdentity};
export const cameraColors={online:'#35d48a',offline:'#ff737d',unknown:'#94a3b8',support:'#67c8ed'};
export const cameraLabels={online:'Camera records online',offline:'Camera outage observed',unknown:'Camera status unverified'};
export function validateCameraHealth(value:any):Health {
  const object=(v:any)=>v&&typeof v==='object'&&!Array.isArray(v);
  if(!object(value)||['totalDevices','online','offline','review','shopRoot','healthRows','fieldDevices'].some(key=>!Number.isSafeInteger(value[key])||value[key]<0)||!Array.isArray(value.rows)||value.rows.some((r:any)=>!object(r)||(typeof r.id!=='string'&&typeof r.id!=='number')||String(r.id).trim()===''||typeof r.name!=='string'||typeof r.unit!=='string'||!['online','offline','review'].includes(r.status))||value.online+value.offline+value.review!==value.fieldDevices||!Number.isFinite(Date.parse(value.refreshedAt)))throw new Error('Camera Health returned an incomplete summary.');
  if(new Set(value.rows.map((row:CameraRow)=>String(row.id))).size!==value.rows.length)throw new Error('Camera Health contains duplicate resource identities.');
  if(value.evidenceVersion===2){
    const inventory=value.inventory;
    if(!object(inventory)||!['allRecords','activeFieldRecords','activeShopRecords','inactiveRecords','unknownScopeRecords'].every(key=>Number.isSafeInteger(inventory[key])&&inventory[key]>=0)||inventory.allRecords!==value.totalDevices||inventory.allRecords!==value.rows.length||inventory.activeFieldRecords!==value.fieldDevices||inventory.activeShopRecords!==value.shopRoot||inventory.allRecords!==inventory.activeFieldRecords+inventory.activeShopRecords+inventory.inactiveRecords+inventory.unknownScopeRecords)throw new Error('Camera Health inventory counts could not be reconciled.');
    for(const [scope,key] of [['field','activeFieldRecords'],['shop','activeShopRecords'],['inactive','inactiveRecords'],['unknown','unknownScopeRecords']])if(value.rows.filter((row:CameraRow)=>row.scope===scope).length!==inventory[key])throw new Error('Camera Health placement counts could not be reconciled.');
    for(const row of value.rows){
      if(typeof row.activationState!=='string'||!['field','shop','inactive','unknown'].includes(row.scope))throw new Error('Camera Health placement evidence is incomplete.');
      const battery=row.batteryEvidence;
      if(battery!==undefined&&(!object(battery)||row.evidence?.source!=='Reconeyez'||battery.source!=='Reconeyez'||(battery.percent!==null&&(typeof battery.percent!=='number'||!Number.isFinite(battery.percent)||battery.percent<0||battery.percent>100))||![null,'normal','low','critical'].includes(battery.status)||[battery.percentObservedAt,battery.statusObservedAt].some(time=>time!==null&&typeof time!=='string')))throw new Error('Recon battery evidence is malformed.');
      for(const e of [row.evidence,row.serviceEvidence].filter(Boolean) as any[]){
        if(!object(e)||!['provider','service_port','unknown'].includes(e.kind)||typeof e.source!=='string'||!['online','offline','degraded','unknown'].includes(e.status)||typeof e.active!=='boolean'||!['camera','detector','recorder','service','unknown'].includes(e.resource)||[e.observedAt,e.lastOnlineAt].some(time=>time!==null&&typeof time!=='string')||(e.reachable!==undefined&&e.reachable!==null&&typeof e.reachable!=='boolean')||(e.confirmedOutage!==undefined&&typeof e.confirmedOutage!=='boolean')||(e.consecutiveFailures!==undefined&&e.consecutiveFailures!==null&&(!Number.isSafeInteger(e.consecutiveFailures)||e.consecutiveFailures<0)))throw new Error('Camera Health source evidence is malformed.');
      }
    }
  }else if(value.rows.length!==value.fieldDevices)throw new Error('Camera Health returned an incomplete legacy summary.');
  validateIdentityEnvelope(value);
  return value;
}
const plain=(value:string)=>value.trim().replace(/\s+/g,' ').toUpperCase();
/** Fully anchored family + numeric asset tag; never device/site-name substring matching. */
export function canonicalCameraUnit(value:string):string|null {
  // A variant discriminator must end before the asset tag: Sniper 201 is not Sniper 2 01.
  const match=/^(SNIPER\s*[24]|RECON\s*(?:2|II))(?=\s|[-#])\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)$/i.exec(value.trim())
    || /^(HELIOS|RANGER|SOLAR\s*SPOTTER|SPOTTER|SS\s*HYBRID|SNIPER|CAM\s*V|RECON|RII|RI)\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)$/i.exec(value.trim());
  if(!match)return null;
  let family=plain(match[1]).replace(/\s/g,'');
  family=({RI:'RECON',RII:'RECON2',RECONII:'RECON2'} as Record<string,string>)[family]||family;
  const [base,...tail]=match[2].split('.');
  if(Number(base)===0)return null;
  return family+'|'+Number(base)+(tail.length?'.'+tail.join('.'): '');
}
export function scopedFieldIdentity(unit:FieldHealthUnit) {
  const key=canonicalCameraUnit(unit.unitNumber); if(!key)return null;
  const family=key.split('|')[0],model=plain(unit.modelName||'').replace(/[\s&]/g,'');
  const aliases:Record<string,string[]>={HELIOS:['HELIOS'],RANGER:['RANGER','RANGERS'],SOLARSPOTTER:['SOLARSPOTTER','SOLARSPOTTERS'],SPOTTER:['SPOTTER','SPOTTERS'],SSHYBRID:['SSHYBRID','SSHYBRIDS'],RECON:['RECON','RECONS'],RECON2:['RECON2','RECONII'],SNIPER:['SNIPER','SNIPERS'],SNIPER2:['SNIPER2','SNIPERS'],SNIPER4:['SNIPER4','SNIPERS'],CAMV:['CAMV','CAMVRSU']};
  return aliases[family]?.includes(model)?key:null;
}
/** Equipment families with no camera channels. Do not infer capability from a site name. */
export function isSupportEquipment(unit:FieldHealthUnit):boolean {
  const name=unit.unitNumber.trim().toUpperCase();
  const model=(unit.modelName||'').trim().toUpperCase().replace(/[_-]/g,' ').replace(/\s+/g,' ');
  return /^(?:ST|STAND)\s*[-#]?\s*\d{1,6}$/i.test(name)
    || ['STAND','STANDS'].includes(model)
    || /^(?:SOLAR\s*STANDS?(?:\s*72)?|SOLAR\s*POLES?|SKIDS?)(?:\s|[-#])\s*\d+$/i.test(name)
    || ['SOLAR STAND','SOLAR STANDS','SOLAR STANDS 72','SOLAR STAND 72','SOLAR POLES & SKIDS','SOLAR POLE','SOLAR POLES','SKID','SKIDS'].includes(model);
}
export function fieldCameraHealth(unit:FieldHealthUnit,units:FieldHealthUnit[],health:Health|null,now=Date.now()):UnitCameraHealth {
  const unknown=(reason:string,identity:UnitCameraHealth['identity']='missing',rows:CameraRow[]=[]):UnitCameraHealth=>({state:'unknown',reason,identity,rows,unitKey:null,checkedAt:null,classification:null});
  if(isSupportEquipment(unit))return {state:'support',reason:'Support equipment · 0 cameras. Camera online/offline status does not apply. Power health is shown only when a verified power source is linked.',identity:'missing',rows:[],unitKey:null,checkedAt:null,classification:null};
  if(!health)return unknown('Camera Health is unavailable.');
  if(units.filter(candidate=>candidate.id===unit.id).length!==1)return unknown('More than one field record uses this equipment identity.','ambiguous');
  const association=resolveVerifiedUnitIdentity(unit,health);
  if(association.state==='conflict')return unknown(association.reason,'ambiguous');
  if(association.state==='verified'){
    const rows=association.rows,observation=linkedUnitObservation(rows,now),raw=classifyCameraUnit(rows,now);
    const complete=['field','unknown'].includes(raw.scope)?{state:observation.providerState!=='verifying'?observation.providerState:observation.serviceState==='online'?'service' as const:raw.state==='mapping'?'mapping' as const:'verifying' as const,providerState:observation.providerState,cameraState:observation.cameraState,serviceState:observation.serviceState}:{};
    const classification={...raw,...complete,observation};
    const state=observation.state==='online'?'online':observation.state==='offline'?'offline':'unknown';
    const detail=observation.basis==='recorder'?'This observation describes the recorder. Individual camera channels and video are not verified.':observation.basis==='connection'?'The saved IP / port observation describes service reachability. Camera video is not verified.':'Expected camera channel coverage is unknown; reported records do not verify every camera or video.';
    const freshness=state==='unknown'?' Source records are mixed, stale, missing, or unverified; silence is not a confirmed outage.':'';
    const placement=classification.scope==='unknown'?' LOCATION REVIEW: saved placement is unresolved.':['shop','inactive'].includes(classification.scope)?' PLACEMENT CONFLICT: source inventory says '+classification.scope.toUpperCase()+' while this record is in the field map. The source observation does not move equipment.':'';
    return {state,reason:detail+freshness+placement,rows,unitKey:association.identity.unitKeys[0],checkedAt:observation.checkedAt,identity:'matched',classification,basis:observation.basis,observation,association:association.identity};
  }
  const key=scopedFieldIdentity(unit);
  if(!key)return unknown('No verified equipment-to-resource association is available for this saved identifier. Review its identity; source status is not inferred from a similar name.');
  if(units.filter(candidate=>canonicalCameraUnit(candidate.unitNumber)===key).length!==1||units.filter(candidate=>candidate.id===unit.id).length!==1)return unknown('More than one field record uses this unit identity.','ambiguous');
  const rows=health.rows.filter(row=>typeof row.unit==='string'&&canonicalCameraUnit(row.unit)===key);
  if(!rows.length)return unknown('No exact family and unit-number match in Camera Health.');
  const resourceConflict=legacyIdentityConflict(unit.id,rows,health);if(resourceConflict)return unknown(resourceConflict,'ambiguous');
  if(new Set(rows.map(row=>plain(row.unit))).size!==1||new Set(rows.map(row=>String(row.id))).size!==rows.length||rows.some(row=>health.rows.filter(other=>String(other.id)===String(row.id)).length!==1))return unknown('Camera Health has conflicting or duplicate unit identities.','ambiguous');
  const safeRows=health.evidenceVersion===2?rows:rows.map(row=>({...row,scope:'unknown' as const,activationState:'',evidence:undefined,serviceEvidence:undefined}));
  const classification=classifyCameraUnit(safeRows,now),active=safeRows.filter(row=>row.scope!=='inactive'),cameras=active.filter(cameraRecord);
  const states=cameras.map(row=>cameraState(row,now));
  // Sniper/CAM-V expose direct connection evidence; location confidence is independent.
  const direct=['SNIPER','SNIPER2','SNIPER4','CAMV'].includes(key.split('|')[0]);
  const connection=combinedState(safeRows.map(row=>savedConnectionObservation(row,now)));
  const operational=['field','unknown'].includes(classification.scope);
  const state=direct?connection==='online'?'online':connection==='offline'?'offline':'unknown':operational&&states.includes('offline')?'offline':operational&&states.length>0&&states.every(s=>s==='online')?'online':'unknown';
  const dates=rows.flatMap(row=>direct?[row.serviceEvidence?.observedAt]:[row.evidence?.observedAt,row.serviceEvidence?.observedAt]).map(value=>cameraTimestamp(value,now).at).filter((v):v is string=>Boolean(v)).sort();
  const location=classification.scope==='unknown'?' LOCATION REVIEW: saved placement is unresolved.':['shop','inactive'].includes(classification.scope)?' PLACEMENT CONFLICT: camera inventory says '+(classification.scope==='shop'?'SHOP / ROOT':'INACTIVE')+' while this unit remains in the field tracker. Confirm its physical placement; a connection result does not move the unit.':'';
  const reason=health.evidenceVersion!==2?'Source-separated observations are not available in this response.':!operational?'Shop/root or inactive inventory is excluded from operational camera colors.':state==='offline'?'At least one matched camera/detector has a recent provider OFFLINE observation.':state==='online'?'Reported camera/detector records are recently ONLINE. Expected channel coverage is unknown; this does not verify every camera.':cameras.length?'Camera/detector observations are older, missing, or unverified. Silence is not a confirmed outage.':'Camera channel status unavailable. Recorder and service observations remain separate.';
  return {state,identity:'matched',rows,unitKey:rows[0].unit,checkedAt:dates.at(-1)||null,classification,basis:direct?'connection':'camera',reason:(direct?(state==='online'?'The saved IP / port check responded.':state==='offline'?'The saved IP / port checks confirmed no response.':'No recent definitive IP / port result is available.')+' This is connection status; camera video is not verified. Location confidence does not change this connection result.':reason)+location};
}
export function cameraTime(value?:string|null,now=Date.now()) {
  const {at}=cameraTimestamp(value,now);
  return at?new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(new Date(at)):'Not recorded / invalid';
}

export function unitHealthLabel(info:UnitCameraHealth|null|undefined){
  if(info?.state==='support')return 'SUPPORT EQUIPMENT · 0 CAMERAS';
  if(info?.observation)return info.observation.label;
  return info?.basis==='connection'?({online:'IP / PORT ONLINE',offline:'IP / PORT OFFLINE',unknown:'IP / PORT UNKNOWN'}[info.state]):cameraLabels[info?.state||'unknown'];
}
export function unitDiagnosticsPath(unit:FieldHealthUnit,rows:CameraRow[]=[]){
  const source=new Set(rows.map(row=>row.unit));
  const label=canonicalCameraUnit(unit.unitNumber)?unit.unitNumber:source.size===1&&canonicalCameraUnit(rows[0]?.unit||'')?rows[0].unit:null;
  return label?'../../camera-health.html?q='+encodeURIComponent(label):null;
}

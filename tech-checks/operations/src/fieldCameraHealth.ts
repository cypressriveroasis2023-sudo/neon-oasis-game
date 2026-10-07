import { cameraTimestamp, cameraRecord, cameraState, classifyCameraUnit, type CameraRow, type UnitEvidence } from './cameraEvidence';
export type { CameraRow } from './cameraEvidence';
export type Health = {totalDevices:number;online:number;offline:number;review:number;shopRoot:number;healthRows:number;fieldDevices:number;refreshedAt:string;rows:CameraRow[];evidenceVersion?:number;inventory?:{allRecords:number;activeFieldRecords:number;activeShopRecords:number;inactiveRecords:number;unknownScopeRecords?:number};coverageNote?:string};
export type FieldHealthUnit = {id:string;unitNumber:string;modelName?:string;category?:string;readOnly?:boolean;address?:string;site?:string;customer?:string};
export type UnitCameraHealth = {state:'online'|'offline'|'unknown';reason:string;rows:CameraRow[];unitKey:string|null;checkedAt:string|null;identity:'matched'|'missing'|'ambiguous';classification:UnitEvidence|null};
export const cameraColors={online:'#35d48a',offline:'#ff737d',unknown:'#94a3b8'};
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
      if(typeof row.activationState!=='string'||!['field','shop','inactive','unknown'].includes(row.scope)||(['field','shop'].includes(row.scope)&&row.activationState.trim().toLowerCase()!=='active'))throw new Error('Camera Health placement evidence is incomplete.');
      for(const e of [row.evidence,row.serviceEvidence].filter(Boolean) as any[]){
        if(!object(e)||!['provider','service_port','unknown'].includes(e.kind)||typeof e.source!=='string'||!['online','offline','degraded','unknown'].includes(e.status)||typeof e.active!=='boolean'||!['camera','detector','recorder','service','unknown'].includes(e.resource)||[e.observedAt,e.lastOnlineAt].some(time=>time!==null&&typeof time!=='string')||(e.reachable!==undefined&&e.reachable!==null&&typeof e.reachable!=='boolean')||(e.confirmedOutage!==undefined&&typeof e.confirmedOutage!=='boolean')||(e.consecutiveFailures!==undefined&&e.consecutiveFailures!==null&&(!Number.isSafeInteger(e.consecutiveFailures)||e.consecutiveFailures<0)))throw new Error('Camera Health source evidence is malformed.');
      }
    }
  }else if(value.rows.length!==value.fieldDevices)throw new Error('Camera Health returned an incomplete legacy summary.');
  return value;
}
const plain=(value:string)=>value.trim().replace(/\s+/g,' ').toUpperCase();
/** Fully anchored family + numeric asset tag; never device/site-name substring matching. */
export function canonicalCameraUnit(value:string):string|null {
  const match=/^(HELIOS|RANGER|SOLAR\s*SPOTTER|SPOTTER|SS\s*HYBRID|SNIPER(?:\s+[24])?|CAM\s*V|RECON(?:\s+(?:2|II))?|RII|RI)\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)$/i.exec(value.trim());
  if(!match)return null;
  let family=plain(match[1]).replace(/\s/g,'');
  family=({RI:'RECON',RII:'RECON2',RECONII:'RECON2'} as Record<string,string>)[family]||family;
  const [base,...tail]=match[2].split('.');
  if(Number(base)===0)return null;
  return family+'|'+Number(base)+(tail.length?'.'+tail.join('.'): '');
}
function scopedFieldIdentity(unit:FieldHealthUnit) {
  const key=canonicalCameraUnit(unit.unitNumber); if(!key)return null;
  const family=key.split('|')[0],model=plain(unit.modelName||'').replace(/[\s&]/g,'');
  const aliases:Record<string,string[]>={HELIOS:['HELIOS'],RANGER:['RANGER','RANGERS'],SOLARSPOTTER:['SOLARSPOTTER','SOLARSPOTTERS'],SPOTTER:['SPOTTER','SPOTTERS'],SSHYBRID:['SSHYBRID','SSHYBRIDS'],RECON:['RECON'],RECON2:['RECON2','RECONII'],SNIPER:['SNIPER'],SNIPER2:['SNIPER2'],SNIPER4:['SNIPER4'],CAMV:['CAMV','CAMVRSU']};
  return aliases[family]?.includes(model)?key:null;
}
export function fieldCameraHealth(unit:FieldHealthUnit,units:FieldHealthUnit[],health:Health|null,now=Date.now()):UnitCameraHealth {
  const unknown=(reason:string,identity:UnitCameraHealth['identity']='missing',rows:CameraRow[]=[]):UnitCameraHealth=>({state:'unknown',reason,identity,rows,unitKey:null,checkedAt:null,classification:null});
  if(!health)return unknown('Camera Health is unavailable.');
  const key=scopedFieldIdentity(unit);
  if(!key)return unknown('Unit identifier or equipment family needs verification.');
  if(units.filter(candidate=>canonicalCameraUnit(candidate.unitNumber)===key).length!==1||units.filter(candidate=>candidate.id===unit.id).length!==1)return unknown('More than one field record uses this unit identity.','ambiguous');
  const rows=health.rows.filter(row=>typeof row.unit==='string'&&canonicalCameraUnit(row.unit)===key);
  if(!rows.length)return unknown('No exact family and unit-number match in Camera Health.');
  if(new Set(rows.map(row=>plain(row.unit))).size!==1||new Set(rows.map(row=>String(row.id))).size!==rows.length||rows.some(row=>health.rows.filter(other=>String(other.id)===String(row.id)).length!==1))return unknown('Camera Health has conflicting or duplicate unit identities.','ambiguous');
  const safeRows=health.evidenceVersion===2?rows:rows.map(row=>({...row,scope:'unknown' as const,activationState:'',evidence:undefined,serviceEvidence:undefined}));
  const classification=classifyCameraUnit(safeRows,now),active=safeRows.filter(row=>row.scope!=='inactive'),cameras=active.filter(cameraRecord);
  const states=cameras.map(row=>cameraState(row,now));
  // Pins show only observed camera/detector evidence. Location is independently verified by FieldMap.
  const operational=['field','unknown'].includes(classification.scope);
  const state=operational&&states.includes('offline')?'offline':operational&&states.length>0&&states.every(s=>s==='online')?'online':'unknown';
  const dates=rows.flatMap(row=>[row.evidence?.observedAt,row.serviceEvidence?.observedAt]).map(value=>cameraTimestamp(value,now).at).filter((v):v is string=>Boolean(v)).sort();
  const location=classification.scope==='unknown'?' LOCATION REVIEW: saved placement is unresolved.':'';
  const reason=health.evidenceVersion!==2?'Source-separated observations are not available in this response.':!operational?'Shop/root or inactive inventory is excluded from operational camera colors.':state==='offline'?'At least one matched camera/detector has a recent provider OFFLINE observation.':state==='online'?'Reported camera/detector records are recently ONLINE. Expected channel coverage is unknown; this does not verify every camera.':cameras.length?'Camera/detector observations are older, missing, or unverified. Silence is not a confirmed outage.':'Camera channel status unavailable. Recorder and service observations remain separate.';
  return {state,identity:'matched',rows,unitKey:rows[0].unit,checkedAt:dates.at(-1)||null,classification,reason:reason+location};
}
export function cameraTime(value?:string|null,now=Date.now()) {
  const {at}=cameraTimestamp(value,now);
  return at?new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(new Date(at)):'Not recorded / invalid';
}

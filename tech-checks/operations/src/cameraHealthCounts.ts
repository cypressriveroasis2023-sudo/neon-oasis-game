import { cameraTimestamp,unitEvidenceLabel,cameraState,providerState,serviceState,resourceKind,classifyCameraUnit,evidenceCoverage,type UnitEvidence,type ResourceKind,type CameraRow } from './cameraEvidence';
import {validateCameraHealth,canonicalCameraUnit,isSupportEquipment,type FieldHealthUnit,type Health} from './fieldCameraHealth';
export {resourceKind};export type {ResourceKind};
export type CameraUnitGroup=UnitEvidence&{key:string;name:string;site:string;rows:CameraRow[];online:number;offline:number;unknown:number;lastObservedAt:string|null;linkedIdentity:boolean};
export function cameraOverview(health:Health,now=Date.now()){
  const records=new Map<string,CameraRow>();let duplicates=0;
  for(const raw of health.rows){const row=health.evidenceVersion===2?raw:{...raw,scope:'unknown' as const,activationState:'',evidence:undefined,serviceEvidence:undefined};const id=String(row.id);if(records.has(id)){duplicates++;records.set(id,{...row,unit:'',name:'Conflicting resource identity '+id,status:'review',scope:'unknown',activationState:'',evidence:undefined,serviceEvidence:undefined});continue;}records.set(id,row);}
  const buckets=new Map<string,CameraRow[]>();
  for(const row of records.values()){const key=typeof row.unit==='string'&&row.unit.trim()?row.unit.trim().replace(/\s+/g,' ').toUpperCase():'UNLINKED:'+row.id;buckets.set(key,[...(buckets.get(key)||[]),row]);}
  const groups=Array.from(buckets,([key,rows]):CameraUnitGroup=>{
    const classification=classifyCameraUnit(rows,now),states=rows.filter(row=>row.scope!=='inactive'&&['cameras','detectors'].includes(resourceKind(row))).map(row=>cameraState(row,now));
    const dates=rows.flatMap(row=>[row.evidence?.observedAt,row.serviceEvidence?.observedAt]).map(value=>cameraTimestamp(value,now).at).filter((v):v is string=>Boolean(v)).sort();
    const linkedIdentity=!key.startsWith('UNLINKED:');
    return {...classification,key,name:linkedIdentity?rows[0].unit:'Unlinked resource · '+rows[0].name,site:[...new Set(rows.map(row=>row.organization).filter(Boolean))].join(' · '),rows,online:states.filter(s=>s==='online').length,offline:states.filter(s=>s==='offline').length,unknown:states.filter(s=>!['online','offline'].includes(s)).length,lastObservedAt:dates.at(-1)||null,linkedIdentity};
  }).sort((a,b)=>({offline:0,degraded:1,verifying:2,mapping:2,service:3,online:4,shop:5,inactive:6}[a.state]-{offline:0,degraded:1,verifying:2,mapping:2,service:3,online:4,shop:5,inactive:6}[b.state])||a.name.localeCompare(b.name));
  const kinds:Record<ResourceKind,number>={cameras:0,detectors:0,recorders:0,unitInventory:0,other:0};for(const row of records.values())kinds[resourceKind(row)]++;
  const units=groups.filter(group=>group.linkedIdentity),coverage=evidenceCoverage(units);
  const summary={monitored:coverage.total,online:coverage.online,offline:coverage.offline,unknown:coverage.review};
  const activeRows=Array.from(records.values()).filter(row=>['field','unknown'].includes(row.scope||'unknown'));
  const cameraRows=activeRows.filter(row=>resourceKind(row)==='cameras');
  const cameras={total:cameraRows.length,online:cameraRows.filter(row=>cameraState(row,now)==='online').length,offline:cameraRows.filter(row=>cameraState(row,now)==='offline').length,unknown:cameraRows.filter(row=>!['online','offline'].includes(cameraState(row,now))).length};
  const scopes={field:units.filter(group=>group.scope==='field').length,unknown:units.filter(group=>group.scope==='unknown').length,shop:units.filter(group=>group.scope==='shop').length,inactive:units.filter(group=>group.scope==='inactive').length};
  let scopeVerified=false;try{scopeVerified=health.evidenceVersion===2&&duplicates===0&&Boolean(validateCameraHealth(health));}catch{/* Incomplete snapshots must not certify totals. */}
  return {groups,summary,coverage,scopes,kinds,cameras,records:records.size,duplicates,unlinked:groups.filter(g=>!g.linkedIdentity).length,scopeVerified};
}
export function resourceBreakdown(rows:CameraRow[]){const counts:Partial<Record<ResourceKind,number>>={};for(const row of rows){const kind=resourceKind(row);counts[kind]=(counts[kind]||0)+1;}return Object.entries(counts).map(([kind,count])=>count+' '+(count===1?({cameras:'camera record',detectors:'detector',recorders:'recorder',unitInventory:'unit inventory record',other:'other resource'} as Record<string,string>)[kind]:({cameras:'camera records',detectors:'detectors',recorders:'recorders',unitInventory:'unit inventory records',other:'other resources'} as Record<string,string>)[kind])).join(' · ');}

/** Presentation filter only; never establishes a cross-system asset association. */
export function cameraFamily(rows:CameraRow[],family:string) {
  if(family==='all')return true;
  if(family==='recon')return rows.some(row=>row.evidence?.source==='Reconeyez'||['RECON','RECON2'].includes(canonicalCameraUnit(row.unit||'')?.split('|')[0]||''));
  return rows.some(row=>[row.unit,row.type].some(value=>family==='sniper'?/\bSNIPER\b/i.test(value||''):/\bCAM[\s-]*V\b/i.test(value||'')));
}
/** Source-device IDs are the existing authenticated diagnostics identity. */
export function cameraResourcePath(row:CameraRow) {
  return !row.trackerOnly&&/^[1-9]\d*$/.test(String(row.id))&&Number.isSafeInteger(Number(row.id))?'../../camera-detail.html?id='+encodeURIComponent(row.id):null;
}

export function cameraUnitDisplayState(group:UnitEvidence&{rows?:CameraRow[]}) {
  const direct=group.rows&&(cameraFamily(group.rows,'sniper')||cameraFamily(group.rows,'camv'));
  return direct&&['field','unknown'].includes(group.scope)&&group.providerState==='verifying'?group.serviceState:group.state;
}
export function cameraUnitStatusLabel(group:UnitEvidence&{rows?:CameraRow[]}) {
  const direct=group.rows&&(cameraFamily(group.rows,'sniper')||cameraFamily(group.rows,'camv'));
  if(direct&&['field','unknown'].includes(group.scope)&&group.providerState==='verifying')return 'IP / PORT '+({online:'ONLINE',offline:'OFFLINE',degraded:'MIXED',verifying:'UNVERIFIED'}[group.serviceState]);
  return unitEvidenceLabel(group);
}

/** Existing field inventory remains visible when the camera feed has no matching resource. */
export function healthWithFieldInventory(health:Health,units:FieldHealthUnit[]){
  if(health.evidenceVersion!==2||!health.inventory)return health;
  const represented=new Set(health.rows.map(row=>canonicalCameraUnit(row.unit)).filter(Boolean));
  const additions:CameraRow[]=[];
  for(const unit of units){
    if(isSupportEquipment(unit))continue;
    const key=canonicalCameraUnit(unit.unitNumber);
    if(!key||represented.has(key)||units.filter(peer=>canonicalCameraUnit(peer.unitNumber)===key).length!==1)continue;
    represented.add(key);
    additions.push({id:'field:'+unit.id,name:unit.unitNumber,unit:unit.unitNumber,type:'tracker_unit',organization:[unit.customer,unit.site,unit.address].filter(Boolean).join(' · '),status:'review',activationState:'',scope:'unknown',trackerOnly:true});
  }
  if(!additions.length)return health;
  return {...health,rows:[...health.rows,...additions],totalDevices:health.totalDevices+additions.length,
    inventory:{...health.inventory,allRecords:health.inventory.allRecords+additions.length,unknownScopeRecords:(health.inventory.unknownScopeRecords||0)+additions.length},
    coverageNote:[health.coverageNote,additions.length+' existing field inventory units have no matched camera resource. Their connection status is unknown; no check or location is invented.'].filter(Boolean).join(' ')};
}

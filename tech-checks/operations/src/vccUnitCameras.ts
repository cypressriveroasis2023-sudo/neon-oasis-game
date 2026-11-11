import {cameraTimestamp,providerRecord,providerState,resourceKind,type CameraRow} from './cameraEvidence';

/** Owner decision 2026-11-11 (James Martin): VCC is the status source for the
 * VCC fleet. A Field unit may take its camera status from the VCC devices that
 * carry its unit name, only when exactly one mHelp record and exactly one VCC
 * unit group share that name. It is always labelled VCC-reported and matched by
 * unit name; nothing is written back and no reviewed device link is created. */
export type VccUnitCameras={
 key:string;unitKey:string;link:'unit_name';
 total:number;up:number;down:string[];undecided:number;observedAt:string|null;
 rows:CameraRow[];
};
export type FieldProductCameras={source:'VCC';link:'unit_name';total:number;up:number;down:string[];observedAt:string|null};
export const VCC_REPORTED='VCC-reported, matched by unit name. ';
const FAMILY='(HELIOS|RANGER|SOLAR\\s*SPOTTER|SPOTTER)';
const key=(family:string,tag:string)=>{
 const [base,...tail]=tag.split('.');
 return Number(base)===0?null:family.toUpperCase().replace(/\s/g,'')+'|'+Number(base)+(tail.length?'.'+tail.join('.'):'');
};
/** mHelp unit label: anchored family + asset number, then only a model or
 * option suffix ("HDC2", "- SOLAR COMPATIBLE"). A trailing variant such as
 * " .2" is not understood and is left for a person to link. */
export function vccProductNameKey(value:unknown):string|null{
 if(typeof value!=='string'||value.length>200)return null;
 const match=new RegExp('^'+FAMILY+'\\s*[-#]?\\s*(\\d{1,6}(?:\\.\\d+)?)(?!\\d)(.*)$','i').exec(value.trim());
 if(!match||/^\s*\.\s*\d/.test(match[3]))return null;
 return key(match[1],match[2]);
}
/** VCC unit group key as stored by the sync ("SOLARSPOTTER 045", "SPOTTER NVR 305"). */
export function vccGroupNameKey(value:unknown):string|null{
 if(typeof value!=='string'||value.length>200)return null;
 const match=new RegExp('^'+FAMILY+'(?:[\\s_]*NVR)?\\s*[-#]?\\s*(\\d{1,6}(?:\\.\\d+)?)$','i').exec(value.trim());
 return match?key(match[1],match[2]):null;
}
const vccRow=(row:CameraRow)=>!row.trackerOnly&&row.scope!=='inactive'&&row.evidence?.kind==='provider'&&row.evidence.source==='Star4Live'&&providerRecord(row);
/** One entry per unit name. A name carried by two different VCC unit groups is
 * ambiguous and is returned as null so it can never supply a status. */
export function vccUnitGroups(rows:ReadonlyArray<CameraRow>|null|undefined,now=Date.now()):Map<string,VccUnitCameras|null>{
 const byUnit=new Map<string,CameraRow[]>();
 for(const row of rows||[]){if(!vccRow(row)||typeof row.unit!=='string')continue;const list=byUnit.get(row.unit);if(list)list.push(row);else byUnit.set(row.unit,[row]);}
 const result=new Map<string,VccUnitCameras|null>();
 for(const [unitKey,group] of byUnit){
  const name=vccGroupNameKey(unitKey);
  if(!name)continue;
  if(result.has(name)){result.set(name,null);continue;}
  // Cameras decide the unit. A recorder-only unit is read from its recorder.
  const cameras=group.filter(row=>resourceKind(row)==='cameras');
  const members=cameras.length?cameras:group.filter(row=>resourceKind(row)==='recorders');
  if(!members.length){result.set(name,null);continue;}
  const states=members.map(row=>providerState(row,now));
  const times=members.map(row=>cameraTimestamp(row.evidence?.observedAt,now).at).filter((time):time is string=>Boolean(time)).sort();
  result.set(name,{key:name,unitKey,link:'unit_name',total:members.length,
   up:states.filter(state=>state==='online').length,
   down:members.filter((_,index)=>states[index]==='offline').map(row=>row.name).sort(),
   undecided:states.filter(state=>state!=='online'&&state!=='offline').length,
   // The oldest member reading: the unit result is only as current as that.
   observedAt:times[0]||null,rows:members});
 }
 return result;
}
export const vccSummary=(cameras:{total:number;up:number;down:string[]})=>{
 const noun=cameras.total===1?'device':'cameras';
 return cameras.down.length===0?(cameras.total===1?'The '+noun+' is online in VCC.':'All '+cameras.total+' '+noun+' are online in VCC.')
  :cameras.up===0?(cameras.total===1?'The '+noun+' is offline in VCC.':'All '+cameras.total+' '+noun+' are offline in VCC.')
  :cameras.up+' of '+cameras.total+' '+noun+' online in VCC. Offline: '+cameras.down.join('; ')+'.';
};
/** Online, but VCC reports at least one of this unit's cameras offline. */
export const cameraIssues=(product:{state?:string;status?:string;evidence?:{cameras?:FieldProductCameras}}|null|undefined):FieldProductCameras|null=>{
 const cameras=product?.evidence?.cameras;
 return cameras&&(product!.state??product!.status)==='online'&&cameras.down.length>0?cameras:null;
};
export const issueText=(cameras:FieldProductCameras)=>(cameras.up===0?'Unit answers, but ':'')+vccSummary(cameras);

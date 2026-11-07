import {checkedFieldMap} from './gpsPersistence';
import {validateCameraHealth,type Health} from './fieldCameraHealth';
import {readExactProductConnections} from './exactProductConnection';
import {readRouterSnapshot,type RouterSnapshot} from '../../supabase/functions/cos-operations-pages/routers';
import {readVrmFleetConfig} from '../../supabase/functions/cos-operations-pages/vrm';
import {safeVrmPower} from '../../supabase/functions/cos-operations-pages/vrmSafePower';

// Private display data, never authority for a write or a new connection result.
// The caller obtains readingKey only AFTER /api/session verifies the Owner or IT
// actor, role, exact account, mode and feature permissions. No tokens are persisted.
const PREFIX='cos-saved-fleet-presentation-v1:';
const MAX_BYTES=4_000_000;
// A renewed bearer is not proof of the same account. Quarantine persisted
// display data while /api/session revalidates the Owner, without destroying it.
// The session hook alone releases this gate after server authorization succeeds.
let accessSuspended=false;
export function suspendFleetPresentationAccess(){accessSuspended=true;}
export function resumeFleetPresentationAccess(){accessSuspended=false;}
export type SavedFleetPresentation={
 contract:'COS_SAVED_FLEET_PRESENTATION_V1';scope:string;checkedAt:number;
 fieldMap:ReturnType<typeof checkedFieldMap>;health:Health|null;
 routers:RouterSnapshot|null;vrm:any;sourceErrors:Record<string,string>;
};
/** Normalize ONLY local display metadata against one captured save clock.
 * Date precision/clock sampling can put a just-completed display 1 ms ahead.
 * Never renew older readings, accept larger clock reversal, or edit source /
 * connection timestamps: those remain subject to their existing validators. */
export function fleetDisplaySaveTime(readAt:number,now:number):number|null{
 const reading=Math.trunc(readAt),clock=Math.trunc(now);
 if(!Number.isSafeInteger(reading)||!Number.isSafeInteger(clock)||reading<=0||clock<=0||reading>clock+1)return null;
 return Math.min(reading,clock);
}
export function browserFleetStorage():Storage|null{
 try{return window.localStorage;}catch{return null;}
}
function validate(value:unknown,key:string,now:number):SavedFleetPresentation|null{
 try{
  const v=value as SavedFleetPresentation;
  if(!v||v.contract!=='COS_SAVED_FLEET_PRESENTATION_V1'||v.scope!==key||!Number.isSafeInteger(v.checkedAt)||v.checkedAt<=0||v.checkedAt>now)return null;
  const map=checkedFieldMap(v.fieldMap),upload=map.uploadInventory;
  if(map.productConnectionsState!=='ready'||!upload||!Array.isArray(upload.records)||!readExactProductConnections(map.productConnections,upload.sourceSha256,upload.records.filter((r:any)=>r.placement==='FIELD').map((r:any)=>r.productId),v.checkedAt))return null;
  if(v.health!==null)validateCameraHealth(v.health);
  if(v.routers!==null)readRouterSnapshot(v.routers);
  if(v.vrm!==null){readVrmFleetConfig(v.vrm);if(v.vrm.power!==undefined)safeVrmPower(v.vrm.power,v.vrm.items);}
  if(!v.sourceErrors||typeof v.sourceErrors!=='object'||Array.isArray(v.sourceErrors)||Object.values(v.sourceErrors).some(x=>typeof x!=='string'))return null;
  return v;
 }catch{return null;}
}
export function readFleetPresentation(storage:Storage|null,key:string|null,now=Date.now()):SavedFleetPresentation|null{
 if(accessSuspended||!storage||!key)return null;
 try{const raw=storage.getItem(PREFIX+key);if(!raw||raw.length>MAX_BYTES)return null;return validate(JSON.parse(raw),key,now);}catch{return null;}
}
export function saveFleetPresentation(storage:Storage|null,key:string|null,value:Omit<SavedFleetPresentation,'contract'|'scope'>,now=Date.now()):boolean{
 if(accessSuspended||!storage||!key)return false;
 try{
  const next={...value,contract:'COS_SAVED_FLEET_PRESENTATION_V1' as const,scope:key};
  if(!validate(next,key,now))return false;
  const previous=readFleetPresentation(storage,key,now);
  if(previous&&previous.checkedAt>next.checkedAt)return false;
  const raw=JSON.stringify(next,(name,v)=>/^(?:authorization|cookie|password|secret|access_?token|refresh_?token|service_?role_?key|api_?key|jwt)$/i.test(name)?undefined:v);
  if(raw.length>MAX_BYTES)return false;
  if(!validate(JSON.parse(raw),key,now))return false;
  if(storage.getItem(PREFIX+key)!==raw)storage.setItem(PREFIX+key,raw);
  return true;
 }catch{return false;}
}
export function clearFleetPresentations(storage:Storage|null){
 if(!storage)return;
 try{for(let i=storage.length-1;i>=0;i--){const key=storage.key(i);if(key?.startsWith(PREFIX))storage.removeItem(key);}}catch{/* Storage can be unavailable. */}
}
if(typeof window!=='undefined')window.addEventListener('cos-private-data-invalidated',event=>{
 suspendFleetPresentationAccess();
 const reason=(event as CustomEvent<{reason?:unknown}>).detail?.reason;
 // Hard or unknown boundaries still erase immediately. The recovery controller
 // also erases on changed identity/permissions or rejected verification.
 if(reason!=='token-renewed'&&reason!=='parent-timeout')clearFleetPresentations(browserFleetStorage());
});

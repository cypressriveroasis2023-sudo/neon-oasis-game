import {checkedFieldMap} from './gpsPersistence';
import {validateCameraHealth,type Health} from './fieldCameraHealth';
import {readExactProductConnections} from './exactProductConnection';
import {readRouterSnapshot,type RouterSnapshot} from '../../supabase/functions/cos-operations-pages/routers';
import {readVrmFleetConfig} from '../../supabase/functions/cos-operations-pages/vrm';
import {safeVrmPower} from '../../supabase/functions/cos-operations-pages/vrmSafePower';

// Private display data, never authority for a write or a new connection result.
// The caller obtains readingKey only AFTER /api/session verifies the Owner,
// role, exact account, mode and feature permissions. No tokens are persisted.
const PREFIX='cos-saved-fleet-presentation-v1:';
const MAX_BYTES=4_000_000;
export type SavedFleetPresentation={
 contract:'COS_SAVED_FLEET_PRESENTATION_V1';scope:string;checkedAt:number;
 fieldMap:ReturnType<typeof checkedFieldMap>;health:Health|null;
 routers:RouterSnapshot|null;vrm:any;sourceErrors:Record<string,string>;
};
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
  // Validate at the ORIGINAL display time, not now. The UI must label this
  // historical reading; loading it cannot renew observation timestamps.
  return v;
 }catch{return null;}
}
export function readFleetPresentation(storage:Storage|null,key:string|null,now=Date.now()):SavedFleetPresentation|null{
 if(!storage||!key)return null;
 try{const raw=storage.getItem(PREFIX+key);if(!raw||raw.length>MAX_BYTES)return null;return validate(JSON.parse(raw),key,now);}catch{return null;}
}
export function saveFleetPresentation(storage:Storage|null,key:string|null,value:Omit<SavedFleetPresentation,'contract'|'scope'>,now=Date.now()):boolean{
 if(!storage||!key)return false;
 try{
  const next={...value,contract:'COS_SAVED_FLEET_PRESENTATION_V1' as const,scope:key};
  if(!validate(next,key,now))return false;
  const previous=readFleetPresentation(storage,key,now);
  if(previous&&previous.checkedAt>next.checkedAt)return false;
  // Responses are already browser-facing DTOs. Also omit credential fields
  // defensively if a future response grows one. Never serialize session state.
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
if(typeof window!=='undefined')window.addEventListener('cos-private-data-invalidated',()=>clearFleetPresentations(browserFleetStorage()));

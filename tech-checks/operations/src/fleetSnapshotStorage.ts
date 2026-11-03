import {readExactProductConnections} from './exactProductConnection';
import {reconcileFleetSnapshot,type FleetSnapshot} from './fleetSnapshot';

const PREFIX='cos-fleet-snapshot-v1:';
type StoredSnapshot={version:1;readStartedAt:number;readAt:string;health:unknown;fieldMap:unknown};
export type FleetSnapshotCacheEntry={value:FleetSnapshot;at:number};

/** Bind a local display cache to the authenticated actor without storing its bearer token. */
export async function fleetSnapshotStorageKey(token:string,role:string,mode:string|null):Promise<string|null>{
 try{
  if(typeof localStorage==='undefined'||!globalThis.crypto?.subtle||typeof TextEncoder==='undefined')return null;
  // Access tokens may rotate during an otherwise unchanged signed-in session.
  // Use the signed subject only as a cache namespace; all requests still pass
  // through the existing parent-auth handshake and backend authorization.
  let actor=token;
  try{
   const payload=token.split('.')[1];
   if(payload&&typeof atob==='function'){
    const bytes=Uint8Array.from(atob(payload.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(payload.length/4)*4,'=')),character=>character.charCodeAt(0));
    const claims=JSON.parse(new TextDecoder().decode(bytes));
    if(typeof claims?.sub==='string'&&claims.sub)actor=claims.sub;
   }
  }catch{/* Opaque/non-JWT credentials are scoped by their token digest. */}
  const input=new TextEncoder().encode(['COS_FLEET_SNAPSHOT_V1',role,mode||'',actor].join('\0'));
  const digest=await globalThis.crypto.subtle.digest('SHA-256',input);
  return PREFIX+Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
 }catch{return null;}
}

/** A cached fleet snapshot is display-only until the current authenticated read succeeds. */
export function readFleetSnapshotCache(key:string|null,now=Date.now()):FleetSnapshotCacheEntry|null{
 if(!key||typeof localStorage==='undefined')return null;
 try{
  const raw=localStorage.getItem(key);if(!raw)return null;
  const stored=JSON.parse(raw) as StoredSnapshot;
  if(stored?.version!==1||!Number.isFinite(stored.readStartedAt)||stored.readStartedAt<=0||stored.readStartedAt>now+30000
   ||typeof stored.readAt!=='string'||!Number.isFinite(Date.parse(stored.readAt)))throw Error('Invalid cached fleet snapshot.');
  const value=reconcileFleetSnapshot(stored.health,stored.fieldMap,now);
  const fieldMap=value.fieldMap as Record<string,any>,upload=fieldMap.uploadInventory;
  if(fieldMap.productConnections){
   const ids=Array.isArray(upload?.records)?upload.records.filter((record:any)=>record?.placement==='FIELD').map((record:any)=>record.productId):[];
   if(typeof upload?.sourceSha256!=='string'||!ids.length||!readExactProductConnections(fieldMap.productConnections,upload.sourceSha256,ids,now)){
    fieldMap.productConnections=null;
    fieldMap.productConnectionsState='rejected';
    fieldMap.productConnectionsDiagnostic={stage:'connection_envelope',code:'validation_rejected'};
   }
  }
  return {value:{...value,readAt:stored.readAt,readStartedAt:stored.readStartedAt},at:stored.readStartedAt};
 }catch{
  try{localStorage.removeItem(key);}catch{}
  return null;
 }
}

export function writeFleetSnapshotCache(key:string|null,value:FleetSnapshot,readStartedAt:number):void{
 if(!key||typeof localStorage==='undefined')return;
 try{
  localStorage.setItem(key,JSON.stringify({version:1,readStartedAt,readAt:value.readAt,health:value.health,fieldMap:value.fieldMap} satisfies StoredSnapshot));
 }catch{/* Browser storage is optional; the in-memory cache still works. */}
}

export function clearFleetSnapshotCache(key?:string|null):void{
 if(typeof localStorage==='undefined')return;
 try{
  if(key){localStorage.removeItem(key);return;}
  const keys:string[]=[];
  for(let index=0;index<localStorage.length;index++){
   const name=localStorage.key(index);if(name?.startsWith(PREFIX))keys.push(name);
  }
  for(const name of keys)localStorage.removeItem(name);
 }catch{/* Browser storage is optional and may be disabled by policy. */}
}

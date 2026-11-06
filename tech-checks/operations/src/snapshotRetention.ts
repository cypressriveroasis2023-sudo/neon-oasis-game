import type {FleetSnapshot} from './fleetSnapshot';
/** Retain a dated completed result only for the identical inventory authority.
 * Completed unknown/negative checks replace it; a failed transport does not.
 * Actor changes clear the owner before this helper can be used. */
export function retainCompletedSnapshot(previous:FleetSnapshot|null,next:FleetSnapshot){
 return retainCompletedConnectionMap(previous?.fieldMap,next.fieldMap);
}
export function retainCompletedConnectionMap(a:any,b:any){
 return Boolean(a?.uploadInventory?.sourceSha256
   &&a.uploadInventory.sourceSha256===b?.uploadInventory?.sourceSha256
   &&a.productConnectionsState==='ready'
   &&['pending','error','timeout','rejected'].includes(b.productConnectionsState));
}

export type FleetConnectionRead={map:FleetSnapshot['fieldMap'];revision:number;verified?:boolean};
/** Attempt diagnostics are separate from retained display authority. The API's
 * monotonic revision orders requests even when the clock has not advanced. */
export function newerFleetConnectionRead(previous:FleetConnectionRead|null,next:FleetConnectionRead|null):FleetConnectionRead|null{
 if(!next)return previous;if(!previous)return next;
 if(next.revision!==previous.revision)return next.revision>previous.revision?next:previous;
 // A successful explicit verification supersedes this generation's ordinary
 // read, but cannot erase the result of a newer request.
 if(Boolean(next.verified)!==Boolean(previous.verified))return next.verified?next:previous;
 const pending=(read:FleetConnectionRead)=>read.map.productConnectionsState==='pending';
 if(pending(previous)!==pending(next))return pending(next)?previous:next;
 return next;
}
export function latestFleetConnectionRead(authority:any,...reads:(FleetConnectionRead|null)[]):FleetConnectionRead|null{
 const source=authority?.uploadInventory?.sourceSha256;
 if(typeof source!=='string'||!source)return null;
 return reads.filter((read):read is FleetConnectionRead=>Boolean(read&&Number.isSafeInteger(read.revision)&&read.revision>=0
  &&read.map.uploadInventory?.sourceSha256===source
  &&['pending','ready','error','timeout','rejected'].includes(read.map.productConnectionsState)))
  .reduce<FleetConnectionRead|null>((previous,next)=>newerFleetConnectionRead(previous,next),null);
}

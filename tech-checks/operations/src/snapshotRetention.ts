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

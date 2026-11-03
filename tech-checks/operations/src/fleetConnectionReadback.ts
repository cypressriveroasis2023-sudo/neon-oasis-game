import {readExactProductConnections} from './exactProductConnection';
const time=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?Date.parse(v):0;
/** Choose current inventory before comparing connection observations. */
export function preferredFleetMap(paired:any,independent:any){
 if(!paired)return independent;if(!independent)return paired;
 // A failed read of the same inventory cannot erase a completed result.
 // A changed source hash is never bridged.
 if(paired.uploadInventory?.sourceSha256===independent.uploadInventory?.sourceSha256
   &&paired.productConnectionsState==='ready'
   &&['pending','error','timeout','rejected'].includes(independent.productConnectionsState))return paired;
 const a=time(paired.uploadInventory?.receivedAt),b=time(independent.uploadInventory?.receivedAt);
 if(a!==b)return b>a?independent:paired;
 const x=time(paired.generatedAt),y=time(independent.generatedAt);
 if(x!==y)return y>x?independent:paired;
 return time(independent.productConnections?.trackerVerifiedAt)>=time(paired.productConnections?.trackerVerifiedAt)?independent:paired;
}
const accepted=(receipt:any,map:any,now:number)=>{
 const u=map?.uploadInventory;
 return Boolean(u&&Array.isArray(u.records)&&readExactProductConnections(receipt,u.sourceSha256,u.records.filter((r:any)=>r.placement==='FIELD').map((r:any)=>r.productId),now));
};
/** Refresh mismatched inventory, never relabel an old receipt as new authority. */
export async function fleetConnectionReadback(receipt:any,map:any,io:{readReceipt:()=>Promise<any>;readMap:(sha:string)=>Promise<any>;current:()=>boolean;now?:()=>number}){
 const now=io.now||Date.now;let value=receipt||await io.readReceipt(),currentMap=map;
 if(!io.current())throw Error('Your fleet session changed. Reload COS.');
 if(value?.contract==='COS_EXACT_PRODUCT_CONNECTIONS_V2'&&/^[a-f0-9]{64}$/.test(value.sourceSha256)&&value.sourceSha256!==map?.uploadInventory?.sourceSha256){
  currentMap=await io.readMap(value.sourceSha256);
  if(!io.current())throw Error('Your fleet session changed. Reload COS.');
  // Another legitimate inventory update may have arrived while reloading.
  if(value.sourceSha256!==currentMap?.uploadInventory?.sourceSha256)value=currentMap?.productConnections;
 }
 if(!accepted(value,currentMap,now()))throw Error('The saved result does not match the current inventory. The source could not be confirmed.');
 return {map:currentMap,connections:value};
}

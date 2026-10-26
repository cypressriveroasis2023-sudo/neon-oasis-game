import {readMhelpInventoryAuthority} from './mhelpInventoryAuthority';
import {fieldHealthLabels,type FieldProduct,type FieldProductHealth,type mhelpFieldHealth} from './mhelpFieldHealth';
import {mhelpProviderFamily} from './mhelpProviderFleet';

/** Placement comes from the accepted Product-ID census. Camera identity and
 * connectivity may annotate that census, but never decide its membership. */
export function fieldInventoryCensus(value:unknown,health:ReturnType<typeof mhelpFieldHealth>,healthAvailable:boolean,now=Date.now()):ReturnType<typeof mhelpFieldHealth>{
 const authority=readMhelpInventoryAuthority(value,now);
 if(!authority)return null;
 const products=(value as {records:Record<string,any>[]}).records.filter(r=>r.placement==='FIELD');
 const ids=new Set(products.map(p=>p.productId));
 if(healthAvailable&&health?.sourceSha256===authority.sourceSha256&&health.total===authority.field&&health.items.length===authority.field
  &&new Set(health.items.map(p=>p.productId)).size===authority.field&&health.items.every(p=>ids.has(p.productId)))return health;
 const counts=Object.fromEntries(Object.keys(fieldHealthLabels).map(key=>[key,0])) as Record<FieldProductHealth,number>;
 const items:FieldProduct[]=products.map(p=>{
  const state:FieldProductHealth=p.uploadLifecycle!=='UNFLAGGED'?'inactive':p.binding?.state==='held'||p.binding?.placementHeld===true?'review':mhelpProviderFamily(p.category,p.unitNumber)==='support'?'support':'unverified';
  counts[state]++;
  return {productId:p.productId,unitNumber:typeof p.unitNumber==='string'&&p.unitNumber.trim()?p.unitNumber:'Product '+p.productId,state,unitId:null,recordId:null,
   reason:'Recorded Field placement is unchanged. '+(state==='inactive'?'The source lifecycle hold remains in place.':state==='review'?'The saved association or placement review hold remains in place.':state==='support'?'Support equipment has no camera-channel status; power evidence is separate.':'Connectivity is unavailable; this is not evidence of an outage.')};
 });
 return {total:authority.field,counts,items,receivedAt:authority.receivedAt,sourceSha256:authority.sourceSha256};
}

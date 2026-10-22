import {cameraTimestamp} from './cameraEvidence';
import {readMhelpInventoryAuthority} from './mhelpInventoryAuthority';
import type {FieldProduct} from './mhelpFieldHealth';

/** The provider family is an mHelp equipment classification, not proof that a
 * provider is currently connected. Product IDs, never names or IPs, carry the
 * existing reviewed Camera Health association into this read-only display. */
export type FieldProvider='star4live'|'avigilon'|'reconeyez'|'walle'|'support'|'other';
export type ProviderHealthStatus='online'|'offline'|'unverified'|'not_applicable';
export type ProviderProduct= {
 productId:string;unitNumber:string;category:string;customer:string;
 provider:FieldProvider;healthStatus:ProviderHealthStatus;reason:string;
 linked:FieldProduct|null;
};
export type ProviderCounts={online:number;offline:number;unverified:number;not_applicable:number};
export type ProviderSummary={provider:FieldProvider;count:number;counts:ProviderCounts;items:ProviderProduct[]};
export type ProviderFleet={total:number;healthVerified:boolean;receivedAt:string;stale:boolean;groups:ProviderSummary[]};

export const providerTitles:Record<FieldProvider,string>={
 star4live:'Star4Live',avigilon:'Avigilon',reconeyez:'Reconeyez',walle:'Wall-E',
 support:'Solar stands / support',other:'Other equipment'
};
export const providerOrder:FieldProvider[]=['star4live','avigilon','reconeyez','walle','support','other'];
const clean=(value:unknown)=>typeof value==='string'?value.trim().toUpperCase().replace(/[^A-Z0-9]/g,''):'';

/** Preserve distinct sources: no inference of device connectivity from model names. */
export function mhelpProviderFamily(category:unknown,unitNumber:unknown):FieldProvider {
 const key=clean(category)||clean(unitNumber);
 if(/^(SOLARSTAND|SOLARPOLE|STAND|STANDS|SKID|SOLARSKID|SOLARPOLESKID)/.test(key))return 'support';
 if(/^(SNIPER|CAMV|RSU|RADARSNIPER)/.test(key))return 'avigilon';
 if(/^RECON/.test(key))return 'reconeyez';
 if(/^WALLE/.test(key))return 'walle';
 if(/^(SOLARSPOTTER|SPOTTER|RANGER|HELIOS)/.test(key))return 'star4live';
 return 'other';
}

/** The reviewed join is necessary but port or recorder health is insufficient.
 * Require every attributed camera/detector observation to agree and be current. */
function currentProductCameraState(product:FieldProduct|null,now:number):'online'|'offline'|null {
 const evidence=product?.evidence;
 if(!product||!['online','offline'].includes(product.state)||!evidence?.association||evidence.basis!=='camera')return null;
 const cameras=evidence.observations.filter(row=>['camera','detector'].includes(row.kind));
 return cameras.length>0&&cameras.every(row=>cameraTimestamp(row.observedAt,now).fresh&&row.currentState===product.state)
  ?product.state as 'online'|'offline':null;
}

type ReviewedHealth={total:number;items:FieldProduct[]};
type CensusRecord={productId:string;placement:string;unitNumber?:string;category?:string;customer?:string;uploadLifecycle?:string};

/** Never use stale or partial health data to color all 287 Field Product IDs.
 * Health association is supplied by mhelpFieldHealth's exact server-reviewed
 * Product-ID -> COS registry join. No guess from family, name, public IP, or
 * historical 2026 tracker is allowed. */
export function mhelpProviderFleet(
 upload:unknown,health:ReviewedHealth|null,healthReadSucceeded:boolean,now=Date.now()
):ProviderFleet|null {
 const authority=readMhelpInventoryAuthority(upload,now);
 if(!authority)return null;
 const products=(upload as {records:CensusRecord[]}).records.filter(item=>item.placement==='FIELD');
 const expected=new Set(products.map(item=>item.productId));
 const usable=Boolean(healthReadSucceeded&&health&&health.total===authority.field
  &&health.items.length===authority.field
  &&new Set(health.items.map(item=>item.productId)).size===authority.field
  &&health.items.every(item=>expected.has(item.productId)));
 const healthById=new Map((usable?health!.items:[]).map(item=>[item.productId,item]));
 const groups=providerOrder.map(provider=>({
  provider,count:0,counts:{online:0,offline:0,unverified:0,not_applicable:0},items:[] as ProviderProduct[],
 }));
 const groupByProvider=new Map(groups.map(group=>[group.provider,group]));
 for(const product of products){
  const provider=mhelpProviderFamily(product.category,product.unitNumber);
  const linked=healthById.get(product.productId)||null;
  const healthStatus:ProviderHealthStatus=provider==='support'?'not_applicable':
   usable&&currentProductCameraState(linked,now)||'unverified';
  const reason=provider==='support'?'Support equipment has no camera-health requirement. Verify its power separately.':
    !usable?'Latest Field camera health is unavailable. No offline condition is inferred.':
    product.uploadLifecycle&&product.uploadLifecycle!=='UNFLAGGED'?'Source is marked Do Not Use / Missing. Do not activate from a saved connection.':
    linked?.evidence?.basis&&linked.evidence.basis!=='camera'?'Only '+linked.evidence.basis+' evidence is available; camera video is unverified.':
    healthStatus==='unverified'&&linked&&['online','offline'].includes(linked.state)?'Current complete camera/detector evidence is unavailable. The saved connection result does not establish video status.':
    linked?.reason||'No verified Product-ID-to-camera association. Not counted as an outage.';
  const group=groupByProvider.get(provider)!;
  group.count++;
  group.counts[healthStatus]++;
  group.items.push({
   productId:product.productId,unitNumber:product.unitNumber||'Product '+product.productId,
   category:product.category||'Not classified',customer:product.customer||'',
   provider,healthStatus,reason,linked
  });
 }
 if(groups.reduce((total,group)=>total+group.count,0)!==authority.field)throw Error('Field provider totals do not reconcile to mHelp Product IDs.');
 return {total:authority.field,healthVerified:usable,receivedAt:authority.receivedAt,stale:authority.stale,groups};
}

import {fieldReticleColors,mapReticleMarkup,clusterReticleMarkup,type ReticleState,type ReticleCounts} from './fieldMapMarkers';
import {sourceEquipmentMarkerMarkup} from './sourceEquipmentMarker';
import type {FieldProduct} from './mhelpFieldHealth';
import type {FleetDashboardRow,FleetFilters} from './fleetDashboardModel';
import type {MhelpAddressMapPin} from './mhelpAddressMapPins';

/** Reuse the existing, reviewed Product-ID association. Names and addresses never match health. */
export function fleetAddressHealth(products:FieldProduct[],rows:FleetDashboardRow[],layer:FleetFilters['layer']):Map<string,ReticleState>{
 const result=new Map<string,ReticleState>();
 const duplicates=new Set(products.filter((p,i)=>products.findIndex(x=>x.productId===p.productId)!==i).map(p=>p.productId));
 for(const p of products){
  let state:ReticleState='unknown';
  const matches=p.unitId?rows.filter(row=>row.id===p.unitId):[];
  const row=matches.length===1?matches[0]:null;
  if(!duplicates.has(p.productId)){
   if(p.state==='support')state='support';
   else if(['online','offline','unverified'].includes(p.state)&&row&&row.placement==='field'&&!row.retired
    &&products.filter(x=>x.unitId===p.unitId).length===1
    &&(p.state==='unverified'?'unknown':p.state)===row.cameraState){
    const value=row[layer+'State' as 'cameraState'|'routerState'|'batteryState'];
    state=value==='online'||value==='offline'?value:'unknown';
   }
  }
  result.set(p.productId,state);
 }
 return result;
}
const order:ReticleState[]=['online','offline','unknown','support'];
export function addressGroupHealth(pins:MhelpAddressMapPin[],health:ReadonlyMap<string,ReticleState>){
 const counts:ReticleCounts={online:0,offline:0,unknown:0,support:0};
 for(const p of pins){const value=p.lifecycle==='UNFLAGGED'&&!p.placementHeld?health.get(p.productId):'unknown';counts[value&&order.includes(value)?value:'unknown']++;}
 const states=order.filter(s=>counts[s]>0);
 return {counts,state:states.length===1?states[0]:'mixed' as const};
}
/** Same compact circle for all Fleet layers; its center marks the recorded point. */
export const fleetPinArtwork='<svg class="cos-reticle-artwork cos-map-status-dot cos-status-pin-art" viewBox="0 0 44 44" aria-hidden="true" focusable="false"><circle cx="22" cy="22" r="19" fill="currentColor" stroke="#071421" stroke-width="2"/></svg>';
/** A single segmented outline keeps mixed groups compact without inventing a dominant status. */
export function fleetStatusRing(counts:ReticleCounts):string{
 const total=order.reduce((n,state)=>n+counts[state],0);if(!total)return fieldReticleColors.unknown;
 let start=0;return 'conic-gradient('+order.filter(state=>counts[state]>0).map(state=>{const end=start+counts[state]/total*100,part=fieldReticleColors[state]+' '+start+'% '+end+'%';start=end;return part;}).join(',')+')';
}
const shaped=(html:string)=>html.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/,fleetPinArtwork).replace('class="cos-field-pin','class="cos-field-pin cos-status-shaped');
export function fleetUnitPinMarkup(...args:Parameters<typeof mapReticleMarkup>){return shaped(mapReticleMarkup(...args));}
export function fleetSourcePinMarkup(label:string){return shaped(sourceEquipmentMarkerMarkup(label)).replace('--pin:#d6a84b','--pin:'+fieldReticleColors.unknown);}
export function fleetGroupPinMarkup(...args:Parameters<typeof clusterReticleMarkup>){
 return clusterReticleMarkup(...args).replace('class="cos-field-cluster"','class="cos-field-cluster cos-status-shaped"').replace('<i class="cos-reticle-ring" aria-hidden="true"></i>',fleetPinArtwork.replace(' cos-map-status-dot','')).replace('style="--pin:', 'style="--status-ring:'+fleetStatusRing(args[0])+';--pin:').replace('--pin:#d6a84b','--pin:'+fieldReticleColors.unknown);
}
export function addressPinStatusLabel(counts:ReticleCounts):string{
 return order.filter(s=>counts[s]).map(s=>counts[s]+' '+({online:'online',offline:'offline',unknown:'unverified',support:'solar support'}[s])).join(', ');
}

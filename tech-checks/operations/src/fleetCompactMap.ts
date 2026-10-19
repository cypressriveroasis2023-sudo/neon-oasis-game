import type {MapPoint,ReticleCounts,ReticleState} from './fieldMapMarkers';
import {fleetMapGroups} from './fleetMapGroups';
import {fleetStatusRing} from './fleetStatusPins';

/** Display-only groups. Small/filtered views keep their direct single-unit pins. */
export const COMPACT_MAP_GROUP_THRESHOLD=18;
export function compactMapGroups<T>(points:MapPoint<T>[]):MapPoint<T>[][] {
 return points.length<COMPACT_MAP_GROUP_THRESHOLD?points.map(point=>[point]):fleetMapGroups(points);
}

export type CompactMapMember={
 key:string;label:string;health:ReticleState;site:string;address:string;locationLabel:string;
 productId?:string;select?:()=>void;
};
export function compactMapStatusCounts(members:ReadonlyArray<Pick<CompactMapMember,'health'>>):ReticleCounts {
 const counts:ReticleCounts={online:0,offline:0,unknown:0,support:0};
 for(const member of members)counts[member.health in counts?member.health:'unknown']++;
 return counts;
}
export function compactGroupMarkup(counts:ReticleCounts):string {
 const total=Object.values(counts).reduce((sum,count)=>sum+count,0);
 // Ring CSS is constructed solely from fixed status colors and numeric counts.
 return '<span class="cos-compact-group" style="--cos-group-ring:'+fleetStatusRing(counts)+'">'
   +'<i class="cos-compact-group-ring" aria-hidden="true"></i>'
   +'<b class="cos-compact-group-total" aria-hidden="true">'+total+'</b>'
   +(counts.offline?'<span class="cos-compact-group-alert" aria-hidden="true">!</span>':'')
   +'</span>';
}
export const compactStatusName=(state:ReticleState)=>({
 online:'Online',offline:'Offline',unknown:'Unverified',support:'Solar support'
})[state];
export function compactGroupDescription(counts:ReticleCounts):string {
 return (['offline','online','unknown','support'] as const).filter(state=>counts[state]).map(state=>counts[state]+' '+compactStatusName(state).toLowerCase()).join(' · ');
}

/** Text nodes, never HTML from equipment/customer/address records. */
export function compactGroupPopup(members:CompactMapMember[],zoom?:()=>void):HTMLElement {
 const counts=compactMapStatusCounts(members),sorted=[...members].sort((a,b)=>
  (a.health==='offline'?0:a.health==='unknown'?1:a.health==='online'?2:3)-
  (b.health==='offline'?0:b.health==='unknown'?1:b.health==='online'?2:3)||
  a.label.localeCompare(b.label)||a.key.localeCompare(b.key));
 const root=document.createElement('section');
 root.className='cos-compact-group-popup';
 const heading=document.createElement('h3');
 heading.textContent=members.length+' equipment at nearby locations';
 const summary=document.createElement('p');summary.className='cos-compact-popup-summary';summary.textContent=compactGroupDescription(counts);
 root.append(heading,summary);
 if(zoom){const zoomButton=document.createElement('button');zoomButton.type='button';zoomButton.textContent='Zoom into locations';zoomButton.addEventListener('click',zoom);root.append(zoomButton);}
 const list=document.createElement('ul');list.className='cos-compact-popup-list';root.append(list);
 const append=(member:CompactMapMember)=>{
  const li=document.createElement('li'),content=member.select?document.createElement('button'):document.createElement('div');
  content.className='cos-compact-popup-member';
  if(content instanceof HTMLButtonElement){content.type='button';content.addEventListener('click',member.select!);}
  content.setAttribute('data-map-member-id',member.key);
  if(member.productId)content.setAttribute('data-mhelp-product-id',member.productId);
  const label=document.createElement('strong');label.textContent=member.label;
  const status=document.createElement('span');status.className='cos-compact-popup-status cos-compact-popup-status-'+member.health;status.textContent=compactStatusName(member.health);
  const site=document.createElement('small');site.textContent=member.site||'Site not recorded';
  const address=document.createElement('small');address.textContent=(member.address||'Address not recorded')+' · '+member.locationLabel;
  content.append(label,status,site,address);li.append(content);list.append(li);
 };
 sorted.slice(0,18).forEach(append);
 if(sorted.length>18){
  const show=document.createElement('button');show.type='button';show.className='cos-compact-show-all';
  show.textContent='Show all '+sorted.length+' equipment';
  show.addEventListener('click',()=>{sorted.slice(18).forEach(append);show.remove();});
  root.append(show);
 }
 return root;
}

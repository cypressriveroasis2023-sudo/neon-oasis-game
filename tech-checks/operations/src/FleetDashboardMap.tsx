import {useEffect,useRef,useState} from 'react';
import L from 'leaflet';
import {addFieldMapBasemap} from './fieldMapBasemap';
import {checkedAddressEstimate} from './fieldAddressEstimates';
import {clusterMapPoints,clusterReticleMarkup,mapReticleMarkup,type ReticleState} from './fieldMapMarkers';
import type {FleetDashboardRow,FleetFilters} from './fleetDashboardModel';
type Pin={row:FleetDashboardRow;point:[number,number];kind:'current'|'estimate'|'recorded'};
export default function FleetDashboardMap({rows,layer,onSelect}:{rows:FleetDashboardRow[];layer:FleetFilters['layer'];onSelect:(id:string)=>void}){
 const node=useRef<HTMLDivElement>(null),panel=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),markers=useRef<L.LayerGroup|null>(null),select=useRef(onSelect),pinRef=useRef<Pin[]>([]);
 const [pins,setPins]=useState<Pin[]>([]),[revision,setRevision]=useState(0),[expanded,setExpanded]=useState(false);select.current=onSelect;
 useEffect(()=>{let alive=true;void Promise.all(rows.filter(r=>r.placement==='field'&&!r.retired).map(async row=>{
  if(row.locationVerified)return {row,point:[Number(row.unit.latitude),Number(row.unit.longitude)] as [number,number],kind:'current' as const};
  const estimate=await checkedAddressEstimate(row.unit).catch(()=>null);return estimate?{row,point:[estimate.latitude,estimate.longitude] as [number,number],kind:estimate.confidence==='source_recorded_unverified'?'recorded' as const:'estimate' as const}:null;
 })).then(values=>{if(alive)setPins(values.filter((v):v is Pin=>v!==null));});return()=>{alive=false;};},[rows]);
 pinRef.current=pins;
 useEffect(()=>{if(!node.current)return;const instance=L.map(node.current,{zoomControl:true}).setView([31,-99],5);map.current=instance;addFieldMapBasemap(instance);markers.current=L.layerGroup().addTo(instance);const resize=new ResizeObserver(()=>instance.invalidateSize());resize.observe(node.current);instance.on('zoomend',()=>setRevision(v=>v+1));return()=>{resize.disconnect();instance.remove();map.current=null;markers.current=null;};},[]);
 useEffect(()=>{const instance=map.current,group=markers.current;if(!instance||!group)return;group.clearLayers();
  const groups=clusterMapPoints(pins.map(pin=>{const p=instance.latLngToContainerPoint(pin.point);return {item:pin,x:p.x,y:p.y};}),46,18);
  for(const items of groups){const first=items[0].item,counts={online:0,offline:0,unknown:0,support:0};
   const state=(row:FleetDashboardRow):ReticleState=>row.support?'support':(['online','offline'].includes(row[layer+'State' as 'cameraState'|'routerState'|'batteryState'])?row[layer+'State' as 'cameraState'|'routerState'|'batteryState']:'unknown') as ReticleState;
   items.forEach(p=>counts[state(p.item.row)]++);
   const marker=L.marker(first.point,{icon:L.divIcon({className:'cos-dashboard-marker',html:items.length>1?clusterReticleMarkup(counts,items.filter(p=>p.item.kind==='estimate').length,0,items.filter(p=>p.item.kind==='recorded').length):mapReticleMarkup(first.row.name,state(first.row),first.kind),iconSize:[72,82],iconAnchor:[36,54]}),title:items.length>1?items.length+' units at this location':first.row.name+' · '+state(first.row)}).addTo(group);
   if(items.length===1)marker.on('click',()=>select.current(first.row.id));else{const list=document.createElement('div');list.className='cos-dashboard-cluster-list';for(const item of items){const b=document.createElement('button');b.type='button';b.textContent=item.item.row.name+' · '+state(item.item.row);b.onclick=()=>select.current(item.item.row.id);list.append(b);}marker.bindPopup(list);}
  }
 },[pins,layer,revision]);
 const fit=()=>{const values=pinRef.current;if(values.length)map.current?.fitBounds(L.latLngBounds(values.map(p=>p.point)),{padding:[45,45],maxZoom:15});};
 const previousIds=useRef('');useEffect(()=>{const key=pins.map(p=>p.row.id).join('|');if(key!==previousIds.current){previousIds.current=key;fit();}},[pins]);
 // Map-only expansion keeps the authenticated unit drawer visible on phones and desktops.
 const full=()=>setExpanded(value=>!value);
 useEffect(()=>{if(!expanded)return;const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!document.querySelector('.cos-fleet-drawer'))setExpanded(false);};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[expanded]);
 return <div ref={panel} className={'cos-fleet-map-panel'+(expanded?' cos-fleet-map-expanded':'')}>
  <div className='cos-fleet-map-toolbar'><div><strong>Field view</strong><small>{pins.length} unit pins · {pins.filter(p=>p.kind==='current').length} verified · {pins.filter(p=>p.kind!=='current').length} estimates</small></div><div><button onClick={fit} disabled={!pins.length}>Fit pins</button><button onClick={full} aria-label={expanded?'Exit fullscreen fleet map':'Fullscreen fleet map'}>{expanded?'Close fullscreen':'⛶ Fullscreen'}</button></div></div>
  <div ref={node} className='cos-fleet-map-canvas' aria-label='Interactive fleet installation map'/>
  {!pins.length&&<p className='cos-fleet-map-note'>{rows.length?'These units have no currently verified pins or approved address estimates. Open Location verification.':'No units match the current filters.'}</p>}
  <div className='cos-fleet-map-legend'><strong>{layer.toUpperCase()} HEALTH</strong><span className='cos-signal-online'>● Online</span><span className='cos-signal-offline'>● Offline</span><span className='cos-signal-unknown'>● Unverified</span><span className='cos-signal-support'>● Solar support</span><small>Dashed ring: installation needs verification</small></div>
 </div>;
}

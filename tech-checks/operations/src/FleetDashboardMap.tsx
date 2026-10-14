import {useEffect,useRef,useState} from 'react';
import L from 'leaflet';
import {addFieldMapBasemap} from './fieldMapBasemap';
import type {FleetLocationPin as Pin} from './fleetLocationPins';
import {clusterMapPoints,clusterReticleMarkup,expandedGroupOffsets,mapReticleMarkup,type ReticleState} from './fieldMapMarkers';
import {readFieldMapView,saveFieldMapView} from './fieldMapViewState';
import {useFieldMapDisplay} from './fieldMapDisplay';
import type {FleetDashboardRow,FleetFilters} from './fleetDashboardModel';
import 'leaflet/dist/leaflet.css';
type Props={rows:FleetDashboardRow[];pins:Pin[];locationsReady:boolean;layer:FleetFilters['layer'];onSelect:(id:string)=>void;selectedId?:string;pickLocation?:((point:[number,number]|null)=>void)|null};
export default function FleetDashboardMap({rows,pins,locationsReady,layer,onSelect,selectedId='',pickLocation}:Props){
 const node=useRef<HTMLDivElement>(null),panel=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),markers=useRef<L.LayerGroup|null>(null),select=useRef(onSelect),picker=useRef(pickLocation),pinRef=useRef<Pin[]>([]);
 const restored=useRef(readFieldMapView(history.state)),viewportChanged=useRef(false);
 const [revision,setRevision]=useState(0),[expandedIds,setExpandedIds]=useState<string[]>([]);
 const {active:expanded,toggle:full}=useFieldMapDisplay(panel,()=>({...readFieldMapView(history.state),selectedId,selectionExplicit:Boolean(selectedId),...(map.current?{center:[map.current.getCenter().lat,map.current.getCenter().lng],zoom:map.current.getZoom()}:{})}),{native:false,allow:'.cos-fleet-drawer,.cos-fleet-drawer-backdrop'});
 select.current=onSelect;picker.current=pickLocation;
 pinRef.current=pins;
 useEffect(()=>{if(!node.current)return;const instance=L.map(node.current,{zoomControl:true}).setView(restored.current.center||[31,-99],restored.current.zoom||5);map.current=instance;addFieldMapBasemap(instance);markers.current=L.layerGroup().addTo(instance);const resize=new ResizeObserver(()=>instance.invalidateSize());resize.observe(node.current);
  instance.on('zoomend moveend',()=>{viewportChanged.current=true;const center=instance.getCenter();saveFieldMapView({center:[center.lat,center.lng],zoom:instance.getZoom()});setRevision(v=>v+1);});instance.on('click',(event:L.LeafletMouseEvent)=>{if(picker.current)picker.current([event.latlng.lat,event.latlng.lng]);else setExpandedIds([]);});
  return()=>{resize.disconnect();instance.remove();map.current=null;markers.current=null;};},[]);
 useEffect(()=>{const instance=map.current,group=markers.current;if(!instance||!group)return;group.clearLayers();
  const groups=clusterMapPoints(pins.map(pin=>{const p=instance.latLngToContainerPoint(pin.point);return {item:pin,x:p.x,y:p.y};}),48,16);
  const state=(row:FleetDashboardRow):ReticleState=>row.support?'support':(['online','offline'].includes(row[layer+'State' as 'cameraState'|'routerState'|'batteryState'])?row[layer+'State' as 'cameraState'|'routerState'|'batteryState']:'unknown') as ReticleState;
  const individual=(pin:Pin,point:[number,number],peer=false)=>{
   const health=state(pin.row),healthLabel=health==='unknown'?'Unverified':health==='support'?'Solar support':health==='online'?'Online':'Offline',name=pin.row.displayName||pin.row.name;
   const address=pin.row.displayAddress,addressLabel=address?address.label+': '+(address.text||'Not supplied'):pin.row.unit.address?'Installation address: '+pin.row.unit.address:'';
   const label=name+' · '+healthLabel+(pin.kind==='current'?'':' · '+(pin.kind==='estimate'?'Estimated location':'Source-recorded location'))+(peer?' · expanded group position':'')+(addressLabel?' · '+addressLabel:'');
   const marker=L.marker(point,{bubblingMouseEvents:false,icon:L.divIcon({className:'cos-dashboard-marker cos-field-pin-wrap'+(peer?' cos-dashboard-peer':''),html:mapReticleMarkup(pin.row.displayName||pin.row.name,state(pin.row),pin.kind),iconSize:[44,58],iconAnchor:[22,22]}),title:label,alt:label}).addTo(group);
   marker.getElement()?.setAttribute('data-unit-id',pin.row.id);marker.getElement()?.setAttribute('aria-label',label);marker.on('click',()=>{if(!picker.current)select.current(pin.row.id);});return marker;
  };
  for(const items of groups){const first=items[0].item,counts={online:0,offline:0,unknown:0,support:0};items.forEach(p=>counts[state(p.item.row)]++);
   if(items.length===1){individual(first,first.point);continue;}
   const marker=L.marker(first.point,{bubblingMouseEvents:false,icon:L.divIcon({className:'cos-dashboard-marker cos-dashboard-cluster cos-field-cluster-wrap',html:clusterReticleMarkup(counts,items.filter(p=>p.item.kind==='estimate').length,0,items.filter(p=>p.item.kind==='recorded').length),iconSize:[44,58],iconAnchor:[22,22]}),title:'Expand '+items.length+' units',alt:'Expand '+items.length+' units'}).addTo(group);
   const ids=items.map(p=>p.item.row.id),isExpanded=ids.length===expandedIds.length&&ids.every(id=>expandedIds.includes(id));
   marker.getElement()?.setAttribute('aria-label','Expand '+items.length+' units');const element=marker.getElement();element?.setAttribute('aria-expanded',String(isExpanded));element?.classList.toggle('cos-field-cluster-expanded',isExpanded);element?.setAttribute('data-unit-ids',JSON.stringify(ids));element?.setAttribute('data-estimate-unit-ids',JSON.stringify(items.filter(p=>p.item.kind==='estimate').map(p=>p.item.row.id)));element?.setAttribute('data-recorded-unit-ids',JSON.stringify(items.filter(p=>p.item.kind==='recorded').map(p=>p.item.row.id)));element?.setAttribute('data-health',counts.offline?'offline':counts.unknown?'unknown':counts.online?'online':'support');
   marker.on('click',()=>{if(!picker.current)setExpandedIds(isExpanded?[]:ids);});
   if(isExpanded){const anchor=instance.latLngToContainerPoint(first.point),size=instance.getSize();const offsets=expandedGroupOffsets(items.length,1,{width:size.x,height:size.y,anchorX:anchor.x,anchorY:anchor.y,bottomInset:20,occupied:groups.filter(g=>g!==items).map(g=>({x:g[0].x-anchor.x,y:g[0].y-anchor.y}))});
    items.forEach((item,i)=>{const offset=offsets[i],display=instance.containerPointToLatLng(L.point(anchor.x+offset.x,anchor.y+offset.y));L.polyline([first.point,display],{color:'#aebcd0',weight:1,opacity:.7,interactive:false,dashArray:'3 3'}).addTo(group);individual(item.item,[display.lat,display.lng],true);});
   }
  }
 },[pins,layer,revision,expandedIds]);
 const fit=()=>{setExpandedIds([]);const values=pinRef.current;if(values.length)map.current?.fitBounds(L.latLngBounds(values.map(p=>p.point)),{padding:[40,50],maxZoom:15});};
 // Pending proof validation hides markers, but is not a settled population change.
 const previousIds=useRef('');useEffect(()=>{if(!locationsReady)return;const key=pins.map(p=>p.row.id).join('|');if(key!==previousIds.current){const first=!previousIds.current;previousIds.current=key;if(!(first&&(restored.current.center||viewportChanged.current)))fit();}},[pins,locationsReady]);
 const focused=useRef('');useEffect(()=>{if(!selectedId){focused.current='';return;}const pin=pins.find(p=>p.row.id===selectedId);if(pin&&focused.current!==selectedId){focused.current=selectedId;map.current?.setView(pin.point,Math.max(map.current.getZoom(),14));}},[selectedId,pins]);
 return <div ref={panel} className={'cos-fleet-map-panel field-map-workspace'+(expanded?' cos-fleet-map-expanded':'')+(pickLocation?' cos-fleet-picking':'')}>
  <div className='cos-fleet-map-toolbar'><div><strong>Fleet map</strong><small>{locationsReady?<>{pins.length} unit pins · {pins.filter(p=>p.kind==='current').length} verified · {pins.filter(p=>p.kind!=='current').length} estimated / source recorded</>:'Checking saved map locations…'}</small></div><div><button onClick={fit} disabled={!pins.length}>Fit pins</button><button className={expanded?'field-map-fullscreen-exit':''} onClick={full} aria-label={expanded?'Exit fullscreen fleet map':'Fullscreen fleet map'}>{expanded?'Close fullscreen':'⛶ Fullscreen'}</button></div></div>
  {pickLocation&&<div className='cos-fleet-pick-note' role='status'>Tap the verified installation point. This selects a candidate; confirm the address before saving. <button onClick={()=>pickLocation(null)}>Cancel pin selection</button></div>}
  <div ref={node} className='cos-fleet-map-canvas' aria-label='Interactive fleet installation map'/>
  {locationsReady&&!pins.length&&!pickLocation&&<p className='cos-fleet-map-note'>{rows.length?'These units have no currently verified pins or approved address estimates. Open Location verification.':'No linked unit pins match these filters. Recorded equipment can remain in the list without a verified location.'}</p>}
  <div className='cos-fleet-map-legend'><strong>{layer.toUpperCase()} HEALTH</strong><span className='cos-signal-online'>● Online</span><span className='cos-signal-offline'>● Offline</span><span className='cos-signal-unknown'>● Unverified</span><span className='cos-signal-support'>● Solar support</span><small>EST / SRC: installation needs verification{expandedIds.length>0?' · Expanded pins are display offsets; saved GPS stays unchanged.':''}</small></div>
 </div>;
}

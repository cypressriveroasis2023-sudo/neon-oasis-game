import {useEffect,useRef,useState} from 'react';
import L from 'leaflet';
import {addFieldMapBasemap} from './fieldMapBasemap';
import {fleetLocationPinId,type FleetMapPin as Pin} from './fleetLocationPins';
import {recordedAddressText} from './fleetDisplayAddress';
import {sourceEquipmentMarkerMarkup} from './sourceEquipmentMarker';
import type {MhelpAddressMapPin,MhelpAddressMapReview} from './mhelpAddressMapPins';
import './mhelpAddressMap.css';
import {clusterMapPoints,clusterReticleMarkup,expandedGroupOffsets,mapReticleMarkup,type ReticleState} from './fieldMapMarkers';
import {readFieldMapView,saveFieldMapView} from './fieldMapViewState';
import {useFieldMapDisplay} from './fieldMapDisplay';
import {observeFleetMapResize} from './fleetMapResize';
import type {FleetDashboardRow,FleetFilters} from './fleetDashboardModel';
import 'leaflet/dist/leaflet.css';
type Props={rows:FleetDashboardRow[];pins:Pin[];locationsReady:boolean;layer:FleetFilters['layer'];onSelect:(id:string)=>void;selectedId?:string;pickLocation?:((point:[number,number]|null)=>void)|null;mhelpAddressPins?:MhelpAddressMapPin[];mhelpAddressReviews?:MhelpAddressMapReview[];onSelectMhelpAddress?:(productId:string)=>void;onSelectMhelpAddressGroup?:(productIds:string[])=>void;};
export default function FleetDashboardMap({rows,pins,locationsReady,layer,onSelect,selectedId='',pickLocation,mhelpAddressPins=[],mhelpAddressReviews=[],onSelectMhelpAddress,onSelectMhelpAddressGroup}:Props){
 const node=useRef<HTMLDivElement>(null),panel=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),markers=useRef<L.LayerGroup|null>(null),addressMarkers=useRef<L.LayerGroup|null>(null),select=useRef(onSelect),selectAddress=useRef(onSelectMhelpAddress),selectAddressGroup=useRef(onSelectMhelpAddressGroup),picker=useRef(pickLocation),pinRef=useRef<Pin[]>([]);
 const restored=useRef(readFieldMapView(history.state)),viewportChanged=useRef(false);
 const [revision,setRevision]=useState(0),[expandedIds,setExpandedIds]=useState<string[]>([]);
 const {active:expanded,toggle:full}=useFieldMapDisplay(panel,()=>({...readFieldMapView(history.state),selectedId,selectionExplicit:Boolean(selectedId),...(map.current?{center:[map.current.getCenter().lat,map.current.getCenter().lng],zoom:map.current.getZoom()}:{})}),{native:false,allow:'.cos-fleet-drawer,.cos-fleet-drawer-backdrop'});
 select.current=onSelect;selectAddress.current=onSelectMhelpAddress;selectAddressGroup.current=onSelectMhelpAddressGroup;picker.current=pickLocation;
 pinRef.current=pins;
 useEffect(()=>{if(!node.current)return;const instance=L.map(node.current,{zoomControl:true,trackResize:false}).setView(restored.current.center||[31,-99],restored.current.zoom||5);map.current=instance;addFieldMapBasemap(instance);markers.current=L.layerGroup().addTo(instance);addressMarkers.current=L.layerGroup().addTo(instance);let resizing=false;const stopResize=observeFleetMapResize(instance,active=>{resizing=active;});
  // A layout-only reset must not suppress the first location fit or replace a
  // restored viewport. Keep marker projection current without recording a move.
  instance.on('zoomend moveend',()=>{if(!resizing){viewportChanged.current=true;const center=instance.getCenter();saveFieldMapView({center:[center.lat,center.lng],zoom:instance.getZoom()});}setRevision(v=>v+1);});instance.on('click',(event:L.LeafletMouseEvent)=>{if(picker.current)picker.current([event.latlng.lat,event.latlng.lng]);else setExpandedIds([]);});
  return()=>{stopResize();instance.remove();map.current=null;markers.current=null;addressMarkers.current=null;};},[]);
 useEffect(()=>{const instance=map.current,group=markers.current;if(!instance||!group)return;group.clearLayers();
  const groups=clusterMapPoints(pins.map(pin=>{const p=instance.latLngToContainerPoint(pin.point);return {item:pin,x:p.x,y:p.y};}),48,16);
  const state=(row:FleetDashboardRow):ReticleState=>row.support?'support':(['online','offline'].includes(row[layer+'State' as 'cameraState'|'routerState'|'batteryState'])?row[layer+'State' as 'cameraState'|'routerState'|'batteryState']:'unknown') as ReticleState;
  const individual=(pin:Pin,point:[number,number],peer=false)=>{
   if(pin.kind==='source_equipment_estimate'){
    const name=pin.record.displayUnitNumber||pin.record.unitNumber,address=recordedAddressText(pin.record.sourceAddress),label=name+' · Unlinked equipment · Estimated address'+(peer?' · expanded group position':'')+(address?' · MHelp address: '+address:'');
    const html=sourceEquipmentMarkerMarkup(name);
    const marker=L.marker(point,{bubblingMouseEvents:false,icon:L.divIcon({className:'cos-dashboard-marker cos-field-pin-wrap cos-source-equipment-marker'+(peer?' cos-dashboard-peer':''),html,iconSize:[44,58],iconAnchor:[22,22]}),title:label,alt:label}).addTo(group);
    marker.getElement()?.setAttribute('data-record-id',pin.record.id);marker.getElement()?.setAttribute('aria-label',label);
    const tooltip=document.createElement('span');tooltip.textContent=label;marker.bindTooltip(tooltip);marker.on('click',()=>{if(!picker.current)select.current(pin.record.id);});return marker;
   }
   const health=state(pin.row),healthLabel=health==='unknown'?'Unverified':health==='support'?'Solar support':health==='online'?'Online':'Offline',name=pin.row.displayName||pin.row.name;
   const address=pin.row.displayAddress,addressLabel=address?address.label+': '+(address.text||'Not supplied'):pin.row.unit.address?'Installation address: '+pin.row.unit.address:'';
   const label=name+' · '+healthLabel+(pin.kind==='current'?'':' · '+(pin.kind==='estimate'?'Estimated location':'Source-recorded location'))+(peer?' · expanded group position':'')+(addressLabel?' · '+addressLabel:'');
   const marker=L.marker(point,{bubblingMouseEvents:false,icon:L.divIcon({className:'cos-dashboard-marker cos-field-pin-wrap'+(peer?' cos-dashboard-peer':''),html:mapReticleMarkup(pin.row.displayName||pin.row.name,state(pin.row),pin.kind),iconSize:[44,58],iconAnchor:[22,22]}),title:label,alt:label}).addTo(group);
   marker.getElement()?.setAttribute('data-unit-id',pin.row.id);marker.getElement()?.setAttribute('aria-label',label);marker.on('click',()=>{if(!picker.current)select.current(pin.row.id);});return marker;
  };
  for(const items of groups){const first=items[0].item,counts={online:0,offline:0,unknown:0,support:0};items.forEach(p=>{if(p.item.kind!=='source_equipment_estimate')counts[state(p.item.row)]++;});
   if(items.length===1){individual(first,first.point);continue;}
   const sourcePins=items.filter(p=>p.item.kind==='source_equipment_estimate'),nativePins=items.filter(p=>p.item.kind!=='source_equipment_estimate');
   const clusterLabel='Expand '+items.length+(sourcePins.length?' equipment records':' units')+(sourcePins.length?' · '+sourcePins.length+' Unlinked equipment · Estimated address':'');
   const marker=L.marker(first.point,{bubblingMouseEvents:false,icon:L.divIcon({className:'cos-dashboard-marker cos-dashboard-cluster cos-field-cluster-wrap',html:clusterReticleMarkup(counts,items.filter(p=>p.item.kind==='estimate'||p.item.kind==='source_equipment_estimate').length,0,items.filter(p=>p.item.kind==='recorded').length,sourcePins.length),iconSize:[44,58],iconAnchor:[22,22]}),title:clusterLabel,alt:clusterLabel}).addTo(group);
   const ids=items.map(p=>fleetLocationPinId(p.item)),isExpanded=ids.length===expandedIds.length&&ids.every(id=>expandedIds.includes(id));
   marker.getElement()?.setAttribute('aria-label',clusterLabel);const element=marker.getElement();element?.setAttribute('aria-expanded',String(isExpanded));element?.classList.toggle('cos-field-cluster-expanded',isExpanded);element?.setAttribute('data-unit-ids',JSON.stringify(nativePins.map(p=>fleetLocationPinId(p.item))));element?.setAttribute('data-record-ids',JSON.stringify(sourcePins.map(p=>fleetLocationPinId(p.item))));element?.setAttribute('data-estimate-unit-ids',JSON.stringify(items.filter(p=>p.item.kind==='estimate').map(p=>fleetLocationPinId(p.item))));element?.setAttribute('data-recorded-unit-ids',JSON.stringify(items.filter(p=>p.item.kind==='recorded').map(p=>fleetLocationPinId(p.item))));if(nativePins.length)element?.setAttribute('data-health',sourcePins.length?'mixed':counts.offline?'offline':counts.unknown?'unknown':counts.online?'online':'support');
   marker.on('click',()=>{if(!picker.current)setExpandedIds(isExpanded?[]:ids);});
   if(isExpanded){const anchor=instance.latLngToContainerPoint(first.point),size=instance.getSize();const offsets=expandedGroupOffsets(items.length,1,{width:size.x,height:size.y,anchorX:anchor.x,anchorY:anchor.y,bottomInset:20,occupied:groups.filter(g=>g!==items).map(g=>({x:g[0].x-anchor.x,y:g[0].y-anchor.y}))});
    items.forEach((item,i)=>{const offset=offsets[i],display=instance.containerPointToLatLng(L.point(anchor.x+offset.x,anchor.y+offset.y));L.polyline([first.point,display],{color:'#aebcd0',weight:1,opacity:.7,interactive:false,dashArray:'3 3'}).addTo(group);individual(item.item,[display.lat,display.lng],true);});
   }
  }
 },[pins,layer,revision,expandedIds]);
 // Product-ID-specific MHelp service address layer, deliberately independent of
 // GPS verification, camera links, source held state and native health filters.
 // The Census coordinates are interpolated ADDRESS evidence, not live GPS.
 useEffect(()=>{
  const group=addressMarkers.current;if(!group)return;
  group.clearLayers();
  const atPoint=new Map<string,MhelpAddressMapPin[]>();
  for(const pin of mhelpAddressPins){
   const key=pin.point[0].toFixed(6)+','+pin.point[1].toFixed(6);
   atPoint.set(key,[...(atPoint.get(key)||[]),pin]);
  }
  for(const siblings of atPoint.values()){
   const first=siblings[0],review=siblings.some(x=>x.state==='address_review'),count=siblings.length;
   const label=count===1?first.unitNumber+' · MHelp customer address':count+' MHelp Field units at this address';
   const html='<span class="cos-mhelp-address-pin'+(review?' cos-mhelp-address-review':'')+'" aria-hidden="true"><svg class="cos-address-pin-art" viewBox="0 0 30 38" focusable="false"><path d="M15 36C12 31 2 23 2 15a13 13 0 1 1 26 0c0 8-10 16-13 21Z"/><circle cx="15" cy="15" r="9"/>'+(count>1?'':'<circle class="cos-address-pin-center" cx="15" cy="15" r="3"/>')+'</svg>'+(count>1?'<b class="cos-address-pin-count">'+String(count)+'</b>':'')+'</span>';
   const marker=L.marker(first.point,{bubblingMouseEvents:false,zIndexOffset:250,
    icon:L.divIcon({className:'cos-mhelp-address-marker',html,iconSize:[44,58],iconAnchor:[22,38]}),
    title:label,alt:label}).addTo(group);
   marker.getElement()?.setAttribute('data-mhelp-product-ids',JSON.stringify(siblings.map(p=>p.productId)));
   marker.getElement()?.setAttribute('aria-label',label);
   if(count===1){
    const tooltip=document.createElement('span');
    tooltip.textContent=first.unitNumber+' · '+first.customer+' · MHelp address (not GPS)'+(review?' · Address match needs review':'');
    marker.bindTooltip(tooltip);
   }
   if(selectAddressGroup.current){marker.on('click',()=>{if(picker.current)return;if(count===1)selectAddress.current?.(first.productId);else selectAddressGroup.current?.(siblings.map(p=>p.productId));});continue;}
   const popup=document.createElement('div');popup.className='cos-mhelp-address-popup';
   const heading=document.createElement('strong');heading.textContent=count===1?'MHelp Field address':count+' Field units at this address';popup.appendChild(heading);
   const detail=document.createElement('small');detail.textContent='Address-based marker · GPS not required or inferred';popup.appendChild(detail);
   for(const unit of siblings){
    const item=document.createElement('div');item.className='cos-mhelp-address-popup-item';
    const button=document.createElement('button');button.type='button';
    button.textContent=unit.unitNumber+' · Product '+unit.productId;button.addEventListener('click',()=>{
     selectAddress.current?.(unit.productId);marker.closePopup();
    });item.appendChild(button);
    const source=document.createElement('small');source.textContent='MHelp: '+unit.address;item.appendChild(source);
    if(unit.state==='address_review'){
     const warning=document.createElement('small');warning.className='cos-mhelp-address-warning';
     warning.textContent='Returned address differs: '+unit.matchedAddress+' · Check before dispatch';item.appendChild(warning);
    }
    popup.appendChild(item);
   }
   marker.bindPopup(popup,{maxWidth:340});
   marker.on('click',()=>{if(!picker.current&&count===1)selectAddress.current?.(first.productId);});
  }
 },[mhelpAddressPins]);
 const fit=()=>{setExpandedIds([]);const values=[...pinRef.current.map(p=>p.point),...mhelpAddressPins.map(p=>p.point)];if(values.length)map.current?.fitBounds(L.latLngBounds(values),{padding:[40,50],maxZoom:15});};
 // Pending proof validation hides markers, but is not a settled population change.
 const previousIds=useRef('');useEffect(()=>{if(!locationsReady)return;const key=[...pins.map(fleetLocationPinId),...mhelpAddressPins.map(p=>'mhelp:'+p.productId)].join('|');if(key!==previousIds.current){const first=!previousIds.current;previousIds.current=key;if(!(first&&(restored.current.center||viewportChanged.current)))fit();}},[pins,mhelpAddressPins,locationsReady]);
 const focused=useRef('');useEffect(()=>{if(!selectedId){focused.current='';return;}const pin=pins.find(p=>fleetLocationPinId(p)===selectedId);if(pin&&focused.current!==selectedId){focused.current=selectedId;map.current?.setView(pin.point,Math.max(map.current.getZoom(),14));}},[selectedId,pins]);
 return <div ref={panel} className={'cos-fleet-map-panel field-map-workspace'+(expanded?' cos-fleet-map-expanded':'')+(pickLocation?' cos-fleet-picking':'')}>
  <div className='cos-fleet-map-toolbar'><div><strong>Fleet map</strong><small>{locationsReady?<>{pins.length} {pins.some(pin=>pin.kind==='source_equipment_estimate')?'equipment':'unit'} pins · {pins.filter(p=>p.kind==='current').length} verified · {pins.filter(p=>p.kind!=='current').length} estimated / source recorded{mhelpAddressPins.length>0&&<> · {mhelpAddressPins.length} MHelp customer address units</>}</>:'Checking saved map locations…'}</small></div><div><button onClick={fit} disabled={!pins.length&&!mhelpAddressPins.length}>Fit pins</button><button className={expanded?'field-map-fullscreen-exit':''} onClick={full} aria-label={expanded?'Exit fullscreen fleet map':'Fullscreen fleet map'}>{expanded?'Close fullscreen':'⛶ Fullscreen'}</button></div></div>
  {pickLocation&&<div className='cos-fleet-pick-note' role='status'>Tap the verified installation point. This selects a candidate; confirm the address before saving. <button onClick={()=>pickLocation(null)}>Cancel pin selection</button></div>}
  <div ref={node} className='cos-fleet-map-canvas' aria-label='Interactive fleet installation map'/>
  {locationsReady&&!pins.length&&!mhelpAddressPins.length&&!pickLocation&&<p className='cos-fleet-map-note'>{rows.length?'These units have no currently verified pins or approved address estimates. Open Location verification.':'No linked unit pins match these filters. Recorded equipment can remain in the list without a verified location.'}</p>}
  <div className='cos-fleet-map-legend'><strong>{layer.toUpperCase()} HEALTH</strong><span className='cos-signal-online'>● Online</span><span className='cos-signal-offline'>● Offline</span><span className='cos-signal-unknown'>● Unverified</span><span className='cos-signal-support'>● Solar support</span><details className='cos-fleet-pin-key'><summary>Location key</summary><span>◇ Unlinked equipment · Estimated address</span><span>⌖ MHelp Field address (not GPS)</span><span>⌖ Amber: address match needs review</span><small>EST / SRC: installation needs verification{expandedIds.length>0?' · Expanded pins are display offsets; saved GPS stays unchanged.':''}</small></details></div>
  {locationsReady&&mhelpAddressReviews.length>0&&<details className='cos-mhelp-address-followups'>
   <summary>{mhelpAddressReviews.length} MHelp Field equipment records need address coordinates (no GPS required)</summary>
   <p>These equipment records are still in mHelpDesk Field. Their recorded service addresses still need usable coordinates; no guessed marker is placed.</p>
   <ul>{mhelpAddressReviews.map(item=><li key={item.id}>
    <strong>{item.unitNumber}</strong> · Product {item.productId} · {item.customer} · {item.address||'Address incomplete'}
    <small>{item.state==='no_match'?'Census did not match the recorded street address':item.reason}</small>
    <button type='button' onClick={()=>onSelectMhelpAddress?.(item.productId)}>Open unit record</button>
    {item.address&&<a href={'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(item.address)} target='_blank' rel='noopener noreferrer'>Search address on map ↗</a>}
   </li>)}</ul>
  </details>}
 </div>;
}

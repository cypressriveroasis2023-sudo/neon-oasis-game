import {fleetIndividualPinPositions} from './fleetMapGroups';
import {fleetUnitPinMarkup,fleetSourcePinMarkup,fleetAddressPinMarkup,addressGroupHealth,addressPinStatusLabel} from './fleetStatusPins';
import {useEffect,useRef,useState} from 'react';
import L from 'leaflet';
import {addFieldMapBasemap} from './fieldMapBasemap';
import {fleetLocationPinId,type FleetMapPin as Pin} from './fleetLocationPins';
import {recordedAddressText} from './fleetDisplayAddress';
import type {MhelpAddressMapPin,MhelpAddressMapReview} from './mhelpAddressMapPins';
import './mhelpAddressMap.css';
import {type ReticleState} from './fieldMapMarkers';
import {readFieldMapView,saveFieldMapView} from './fieldMapViewState';
import {useFieldMapDisplay} from './fieldMapDisplay';
import {observeFleetMapResize} from './fleetMapResize';
import type {FleetDashboardRow,FleetFilters} from './fleetDashboardModel';
import 'leaflet/dist/leaflet.css';
type Props={rows:FleetDashboardRow[];pins:Pin[];locationsReady:boolean;layer:FleetFilters['layer'];onSelect:(id:string)=>void;selectedId?:string;pickLocation?:((point:[number,number]|null)=>void)|null;mhelpAddressHealth?:ReadonlyMap<string,ReticleState>;mhelpAddressUnits?:ReadonlyMap<string,string>;mhelpAddressPins?:MhelpAddressMapPin[];mhelpAddressReviews?:MhelpAddressMapReview[];onSelectMhelpAddress?:(productId:string)=>void;};
export default function FleetDashboardMap({rows,pins,locationsReady,layer,onSelect,selectedId='',pickLocation,mhelpAddressHealth,mhelpAddressUnits,mhelpAddressPins=[],mhelpAddressReviews=[],onSelectMhelpAddress}:Props){
 const node=useRef<HTMLDivElement>(null),panel=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),markers=useRef<L.LayerGroup|null>(null),select=useRef(onSelect),selectAddress=useRef(onSelectMhelpAddress),picker=useRef(pickLocation),pinRef=useRef<Pin[]>([]);
 const restored=useRef(readFieldMapView(history.state)),viewportChanged=useRef(false);
 const [revision,setRevision]=useState(0);
 const {active:expanded,toggle:full}=useFieldMapDisplay(panel,()=>({...readFieldMapView(history.state),selectedId,selectionExplicit:Boolean(selectedId),...(map.current?{center:[map.current.getCenter().lat,map.current.getCenter().lng],zoom:map.current.getZoom()}:{})}),{native:false,allow:'.cos-fleet-drawer,.cos-fleet-drawer-backdrop'});
 select.current=onSelect;selectAddress.current=onSelectMhelpAddress;picker.current=pickLocation;
 // Prefer the current mHelp address for uniquely reviewed Product-ID bindings.
 // Saved installation/GPS evidence remains available in unit details.
 const addressUnitIds=new Set(mhelpAddressPins.map(p=>mhelpAddressUnits?.get(p.productId)).filter(Boolean));
 const displayedPins=pins.filter(p=>!addressUnitIds.has(fleetLocationPinId(p)));
 pinRef.current=displayedPins;
 type Entry={kind:'address';pin:MhelpAddressMapPin}|{kind:'native';pin:Pin};

 useEffect(()=>{if(!node.current)return;const instance=L.map(node.current,{zoomControl:true,trackResize:false}).setView(restored.current.center||[31,-99],restored.current.zoom||5);map.current=instance;addFieldMapBasemap(instance);markers.current=L.layerGroup().addTo(instance);let resizing=false;const stopResize=observeFleetMapResize(instance,active=>{resizing=active;});
  // A layout-only reset must not suppress the first location fit or replace a
  // restored viewport. Keep marker projection current without recording a move.
  instance.on('zoomend moveend',()=>{if(!resizing){viewportChanged.current=true;const center=instance.getCenter();saveFieldMapView({center:[center.lat,center.lng],zoom:instance.getZoom()});}setRevision(v=>v+1);});instance.on('click',(event:L.LeafletMouseEvent)=>{if(picker.current)picker.current([event.latlng.lat,event.latlng.lng]);});
  return()=>{stopResize();instance.remove();map.current=null;markers.current=null;};},[]);
 useEffect(()=>{
  const instance=map.current,group=markers.current;if(!instance||!group)return;group.clearLayers();
  const entries=[...mhelpAddressPins.map(pin=>({item:{kind:'address' as const,pin},...instance.latLngToContainerPoint(pin.point)})),...displayedPins.map(pin=>({item:{kind:'native' as const,pin},...instance.latLngToContainerPoint(pin.point)}))];
  const size=instance.getSize(),positions=fleetIndividualPinPositions<Entry>(entries,{width:size.x,height:size.y});
  const state=(row:FleetDashboardRow):ReticleState=>row.support?'support':(['online','offline'].includes(row[layer+'State' as 'cameraState'|'routerState'|'batteryState'])?row[layer+'State' as 'cameraState'|'routerState'|'batteryState']:'unknown') as ReticleState;
  for(const entry of positions){
   const item=entry.item,pin=item.pin,display=instance.containerPointToLatLng(L.point(entry.x,entry.y)),offset=Math.abs(entry.x-entry.sourceX)>1||Math.abs(entry.y-entry.sourceY)>1;
   if(offset)L.polyline([pin.point,display],{color:'#9eacbd',weight:1,opacity:.55,interactive:false}).addTo(group);
   let name:string,label:string,html:string,health:ReticleState,classes:string;
   if(item.kind==='address'){
    const address=item.pin,status=addressGroupHealth([address],mhelpAddressHealth||new Map());health=status.state==='mixed'?'unknown':status.state;name=address.unitNumber;
    label=name+' · Product '+address.productId+' · '+addressPinStatusLabel(status.counts)+' · MHelp address: '+address.address;
    html=fleetAddressPinMarkup(name,health);classes='cos-mhelp-address-marker';
   }else if(item.pin.kind==='source_equipment_estimate'){
    const source=item.pin.record;name=source.displayUnitNumber||source.unitNumber;health='unknown';label=name+' · Unlinked equipment · Estimated address · MHelp address: '+recordedAddressText(source.sourceAddress);
    html=fleetSourcePinMarkup(name);classes='cos-dashboard-marker cos-field-pin-wrap cos-source-equipment-marker';
   }else{
    const native=item.pin;name=native.row.displayName||native.row.name;health=state(native.row);const address=native.row.displayAddress;
    label=name+' · '+(health==='unknown'?'Unverified':health==='support'?'Solar support':health==='online'?'Online':'Offline')+(native.kind==='current'?'':native.kind==='estimate'?' · Estimated address':' · Source-recorded location')+' · '+(address?address.label+': '+(address.text||'Not supplied'):native.row.unit.address||'Address not supplied');
    html=fleetUnitPinMarkup(name,health,native.kind);classes='cos-dashboard-marker cos-field-pin-wrap';
   }
   if(offset)label+=' · Display offset; recorded location unchanged';
   const marker=L.marker(display,{bubblingMouseEvents:false,autoPanOnFocus:false,zIndexOffset:item.kind==='address'?250:0,icon:L.divIcon({className:classes+(offset?' cos-dashboard-peer':''),html,iconSize:[44,56],iconAnchor:[22,34]}),title:label,alt:label}).addTo(group),element=marker.getElement();
   element?.setAttribute('aria-label',label);element?.setAttribute('data-health',health);element?.setAttribute('data-source-point',JSON.stringify(pin.point));element?.setAttribute('data-display-offset',String(offset));
   if(item.kind==='address'){
    element?.setAttribute('data-mhelp-product-ids',JSON.stringify([item.pin.productId]));element?.setAttribute('data-mhelp-product-id',item.pin.productId);
    marker.on('click',()=>{if(!picker.current)selectAddress.current?.(item.pin.productId);});
   }else{
    const id=fleetLocationPinId(item.pin);element?.setAttribute(item.pin.kind==='source_equipment_estimate'?'data-record-id':'data-unit-id',id);marker.on('click',()=>{if(!picker.current)select.current(id);});
   }
   const tooltip=document.createElement('span');tooltip.textContent=name+' · '+({online:'Online',offline:'Offline',unknown:'Unverified',support:'Solar support'}[health]);marker.bindTooltip(tooltip,{direction:'top',offset:[0,-24],className:'cos-fleet-pin-tooltip'});marker.on('click',()=>marker.closeTooltip());
  }
 },[pins,layer,revision,mhelpAddressPins,mhelpAddressHealth,mhelpAddressUnits]);
 const fit=()=>{const values=[...pinRef.current.map(p=>p.point),...mhelpAddressPins.map(p=>p.point)];if(values.length)map.current?.fitBounds(L.latLngBounds(values),{padding:[40,50],maxZoom:15});};
 // Pending proof validation hides markers, but is not a settled population change.
 const previousIds=useRef('');useEffect(()=>{if(!locationsReady)return;const key=[...pinRef.current.map(fleetLocationPinId),...mhelpAddressPins.map(p=>'mhelp:'+p.productId)].join('|');if(key!==previousIds.current){const first=!previousIds.current;previousIds.current=key;if(!(first&&(restored.current.center||viewportChanged.current)))fit();}},[pins,mhelpAddressPins,mhelpAddressUnits,locationsReady]);
 const focused=useRef('');useEffect(()=>{if(!selectedId){focused.current='';return;}const pin=pins.find(p=>fleetLocationPinId(p)===selectedId);if(pin&&focused.current!==selectedId){focused.current=selectedId;map.current?.setView(pin.point,Math.max(map.current.getZoom(),14));}},[selectedId,pins,mhelpAddressPins,mhelpAddressUnits]);
 return <div ref={panel} aria-busy={!locationsReady} className={'cos-fleet-map-panel field-map-workspace cos-fleet-individual-pins'+(expanded?' cos-fleet-map-expanded':'')+(pickLocation?' cos-fleet-picking':'')}>
  <div className='cos-fleet-map-toolbar'><div><details className='cos-fleet-map-details'><summary aria-label='Fleet map details'><strong>Fleet map</strong></summary><small>{locationsReady?<>{pins.length} {pins.some(pin=>pin.kind==='source_equipment_estimate')?'equipment':'unit'} pins · {pins.filter(p=>p.kind==='current').length} verified · {pins.filter(p=>p.kind!=='current').length} estimated / source recorded{mhelpAddressPins.length>0&&<> · {mhelpAddressPins.length} MHelp customer address units</>}</>:'Checking saved map locations…'}</small>{mhelpAddressPins.length>0&&<label className='cos-fleet-map-find'>Find a mapped unit<select aria-label='Find mapped equipment' defaultValue='' onChange={event=>{if(event.currentTarget.value)onSelectMhelpAddress?.(event.currentTarget.value);event.currentTarget.value='';}}><option value=''>Choose unit</option>{mhelpAddressPins.map(pin=><option key={pin.productId} value={pin.productId}>{pin.unitNumber} · Product {pin.productId}</option>)}</select></label>}</details></div><div><button onClick={fit} disabled={!pins.length&&!mhelpAddressPins.length}>Fit pins</button><button className={expanded?'field-map-fullscreen-exit':''} onClick={full} aria-label={expanded?'Exit fullscreen fleet map':'Fullscreen fleet map'}>{expanded?'Close fullscreen':'⛶ Fullscreen'}</button></div></div>
  {pickLocation&&<div className='cos-fleet-pick-note' role='status'>Tap the verified installation point. This selects a candidate; confirm the address before saving. <button onClick={()=>pickLocation(null)}>Cancel pin selection</button></div>}
  <div ref={node} className='cos-fleet-map-canvas' aria-label='Interactive fleet installation map'/>
  {locationsReady&&!pins.length&&!mhelpAddressPins.length&&!pickLocation&&<p className='cos-fleet-map-note'>{rows.length?'These units have no currently verified pins or approved address estimates. Open Location verification.':'No linked unit pins match these filters. Recorded equipment can remain in the list without a verified location.'}</p>}
  <div className='cos-fleet-map-legend'><strong>{layer.toUpperCase()} HEALTH</strong><span className='cos-signal-online'>● Online</span><span className='cos-signal-offline'>● Offline</span><span className='cos-signal-unknown'>● Unverified</span><span className='cos-signal-support'>● Solar support</span><details className='cos-fleet-pin-key'><summary>Location key</summary><span>◇ Unlinked equipment · Estimated address</span><span>⌖ MHelp Field address (not GPS)</span><span>Current mHelp service addresses supply the map locations.</span><small>EST / SRC: installation needs verification · Nearby units may use display offsets; saved locations stay unchanged.</small></details></div>
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

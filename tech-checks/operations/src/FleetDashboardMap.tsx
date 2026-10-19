import {fleetIndividualPinPositions} from './fleetMapGroups';
import {compactMapGroups,compactMapStatusCounts,compactGroupMarkup,compactGroupDescription,compactGroupPopup,type CompactMapMember,COMPACT_MAP_GROUP_THRESHOLD} from './fleetCompactMap';
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
type Props={rows:FleetDashboardRow[];pins:Pin[];locationsReady:boolean;layer:FleetFilters['layer'];onSelect:(id:string)=>void;selectedId?:string;pickLocation?:((point:[number,number]|null)=>void)|null;mhelpAddressHealth?:ReadonlyMap<string,ReticleState>;mhelpAddressUnits?:ReadonlyMap<string,string>;mhelpAddressPins?:MhelpAddressMapPin[];mhelpAddressReviews?:MhelpAddressMapReview[];onSelectMhelpAddress?:(productId:string)=>void;filters?:FleetFilters;};
export default function FleetDashboardMap({rows,pins,locationsReady,layer,onSelect,selectedId='',pickLocation,mhelpAddressHealth,mhelpAddressUnits,mhelpAddressPins=[],mhelpAddressReviews=[],onSelectMhelpAddress,filters}:Props){
 const node=useRef<HTMLDivElement>(null),panel=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),markers=useRef<L.LayerGroup|null>(null),select=useRef(onSelect),selectAddress=useRef(onSelectMhelpAddress),picker=useRef(pickLocation),pinRef=useRef<Pin[]>([]);
 const restored=useRef(readFieldMapView(history.state)),viewportChanged=useRef(false);
 const [revision,setRevision]=useState(0);
 const {active:expanded,toggle:full}=useFieldMapDisplay(panel,()=>({...readFieldMapView(history.state),selectedId,selectionExplicit:Boolean(selectedId),...(map.current?{center:[map.current.getCenter().lat,map.current.getCenter().lng],zoom:map.current.getZoom()}:{})}),{native:false,allow:'.cos-fleet-drawer,.cos-fleet-drawer-backdrop'});
 select.current=onSelect;selectAddress.current=onSelectMhelpAddress;picker.current=pickLocation;
 // Prefer the current mHelp address for uniquely reviewed Product-ID bindings.
 // Saved installation/GPS evidence remains available in unit details.
 const scopedIds=new Set([...rows.map(row=>row.id),...pins.map(fleetLocationPinId)]);
 const query=filters?.query?.trim().toLowerCase()||'';
 const showWholeAddressSource=!filters||(!query&&['all',''].includes(filters.status)&&filters.family==='all'&&filters.provider==='all'&&(!filters.nearbyId)&&(!filters.installationStatus||filters.installationStatus==='all')&&!filters.retired);
 const visibleMhelpPins=mhelpAddressPins.filter(pin=>{
  if(filters&&!['field','all'].includes(filters.placement))return false;
  if(showWholeAddressSource)return true;
  const id=mhelpAddressUnits?.get(pin.productId),status=mhelpAddressHealth?.get(pin.productId)||'unknown';
  if(id&&scopedIds.has(id)){
   if(!filters||filters.status==='all'||filters.status==='unknown'&&status==='unknown'||filters.status==='operational'&&['online','offline','support'].includes(status)||filters.status===status)return true;
  }
  if(!filters||filters.status!=='all'||(filters.family!=='all'||filters.provider!=='all'||Boolean(filters.nearbyId)))return false;
  return Boolean(query&&[pin.unitNumber,pin.productId,pin.customer,pin.address].join(' ').toLowerCase().includes(query));
 });
 // Suppress a native duplicate only when its mHelp Product-ID pin is visible.
 const addressUnitIds=new Set(visibleMhelpPins.map(p=>mhelpAddressUnits?.get(p.productId)).filter(Boolean));
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
  const entries=[
   ...visibleMhelpPins.map(pin=>({item:{kind:'address' as const,pin},...instance.latLngToContainerPoint(pin.point)})),
   ...displayedPins.map(pin=>({item:{kind:'native' as const,pin},...instance.latLngToContainerPoint(pin.point)}))
  ];
  const size=instance.getSize(),compact=entries.length>=COMPACT_MAP_GROUP_THRESHOLD&&!picker.current;
  const layout=compact?compactMapGroups<Entry>(entries):
   fleetIndividualPinPositions<Entry>(entries,{width:size.x,height:size.y}).map(position=>[position]);
  const state=(row:FleetDashboardRow):ReticleState=>row.support?'support':(['online','offline'].includes(row[layer+'State' as 'cameraState'|'routerState'|'batteryState'])?row[layer+'State' as 'cameraState'|'routerState'|'batteryState']:'unknown') as ReticleState;
  const describe=(item:Entry)=>{
   let name:string,label:string,html:string,health:ReticleState,classes:string,member:CompactMapMember;
   if(item.kind==='address'){
    const address=item.pin,status=addressGroupHealth([address],mhelpAddressHealth||new Map());health=status.state==='mixed'?'unknown':status.state;name=address.unitNumber;
    label=name+' · Product '+address.productId+' · '+addressPinStatusLabel(status.counts)+' · MHelp address: '+address.address;
    html=fleetAddressPinMarkup(name,health);classes='cos-mhelp-address-marker';
    member={key:'mhelp:'+address.productId,label:name+' · Product '+address.productId,health,site:address.customer,address:address.address,locationLabel:'MHelp customer address · not GPS',productId:address.productId,select:()=>{if(!picker.current){instance.closePopup();selectAddress.current?.(address.productId);}}};
   }else if(item.pin.kind==='source_equipment_estimate'){
    const source=item.pin.record;name=source.displayUnitNumber||source.unitNumber;health='unknown';label=name+' · Unlinked equipment · Estimated address · MHelp address: '+recordedAddressText(source.sourceAddress);
    html=fleetSourcePinMarkup(name);classes='cos-dashboard-marker cos-field-pin-wrap cos-source-equipment-marker';
    const id=fleetLocationPinId(item.pin);
    member={key:id,label:name,health,site:source.customer||'',address:recordedAddressText(source.sourceAddress),locationLabel:'Source-recorded estimate · not installation GPS',select:()=>{if(!picker.current){instance.closePopup();select.current(id);}}};
   }else{
    const native=item.pin;name=native.row.displayName||native.row.name;health=state(native.row);const address=native.row.displayAddress;
    label=name+' · '+(health==='unknown'?'Unverified':health==='support'?'Solar support':health==='online'?'Online':'Offline')+(native.kind==='current'?'':native.kind==='estimate'?' · Estimated address':' · Source-recorded location')+' · '+(address?address.label+': '+(address.text||'Not supplied'):native.row.unit.address||'Address not supplied');
    html=fleetUnitPinMarkup(name,health,native.kind);classes='cos-dashboard-marker cos-field-pin-wrap';
    const id=fleetLocationPinId(item.pin);
    member={key:id,label:name,health,site:native.row.displayCustomer||native.row.unit.site||native.row.unit.customer||'',address:address?.text||native.row.unit.address||'',locationLabel:native.kind==='current'?'GPS / installation verified':native.kind==='recorded'?'Source-recorded location · not GPS':'Estimated address · not GPS',select:()=>{if(!picker.current){instance.closePopup();select.current(id);}}};
   }
   return {name,label,html,health,classes,member};
  };
  for(const members of layout){
   if(members.length>1){
    const described=members.map(entry=>describe(entry.item).member),counts=compactMapStatusCounts(described);
    const center={x:members.reduce((n,p)=>n+p.x,0)/members.length,y:members.reduce((n,p)=>n+p.y,0)/members.length};
    const location=instance.containerPointToLatLng(L.point(center.x,center.y));
    const marker=L.marker(location,{
     bubblingMouseEvents:false,zIndexOffset:counts.offline?300:100,
     icon:L.divIcon({className:'cos-compact-group-marker',html:compactGroupMarkup(counts),iconSize:[52,52],iconAnchor:[26,26]}),
     title:members.length+' equipment · '+compactGroupDescription(counts),alt:members.length+' equipment · '+compactGroupDescription(counts)
    }).addTo(group);
    const element=marker.getElement();
    element?.setAttribute('data-group-count',String(members.length));
    element?.setAttribute('data-offline-count',String(counts.offline));
    element?.setAttribute('data-group-member-ids',JSON.stringify(described.map(item=>item.key)));
    element?.setAttribute('data-mhelp-product-ids',JSON.stringify(described.flatMap(item=>item.productId?[item.productId]:[])));
    element?.setAttribute('aria-label',members.length+' grouped equipment · '+compactGroupDescription(counts));
    const coordinateKeys=new Set(members.map(point=>point.item.pin.point.join(',')));
    const zoom=coordinateKeys.size>1&&instance.getZoom()<17?()=>{
     instance.closePopup();
     instance.fitBounds(L.latLngBounds(members.map(point=>point.item.pin.point)),{padding:[72,72],maxZoom:16,animate:false});
    }:undefined;
    const popupContent=compactGroupPopup(described,zoom);
    L.DomEvent.disableClickPropagation(popupContent);
    marker.bindPopup(popupContent,{className:'cos-compact-group-popup-wrap',maxWidth:420,minWidth:300,autoPan:false});
    marker.on('click',()=>{if(picker.current)instance.closePopup();});
    continue;
   }
   const entry=members[0],item=entry.item,pin=item.pin,description=describe(item);
   const display=instance.containerPointToLatLng(L.point(entry.x,entry.y));
   const sourceX='sourceX' in entry?Number(entry.sourceX):entry.x,sourceY='sourceY' in entry?Number(entry.sourceY):entry.y;
   const offset=Math.abs(entry.x-sourceX)>1||Math.abs(entry.y-sourceY)>1;
   if(offset)L.polyline([pin.point,display],{color:'#9eacbd',weight:1,opacity:.55,interactive:false}).addTo(group);
   const label=description.label+(offset?' · Display offset; recorded location unchanged':'');
   const marker=L.marker(display,{bubblingMouseEvents:false,autoPanOnFocus:false,zIndexOffset:item.kind==='address'?250:0,icon:L.divIcon({className:description.classes+(offset?' cos-dashboard-peer':''),html:description.html,iconSize:[44,56],iconAnchor:[22,34]}),title:label,alt:label}).addTo(group),element=marker.getElement();
   element?.setAttribute('aria-label',label);element?.setAttribute('data-health',description.health);
   element?.setAttribute('data-source-point',JSON.stringify(pin.point));element?.setAttribute('data-display-offset',String(offset));
   if(item.kind==='address'){
    element?.setAttribute('data-mhelp-product-ids',JSON.stringify([item.pin.productId]));
    element?.setAttribute('data-mhelp-product-id',item.pin.productId);
   }else{
    const id=fleetLocationPinId(item.pin);element?.setAttribute(item.pin.kind==='source_equipment_estimate'?'data-record-id':'data-unit-id',id);
   }
   marker.on('click',()=>description.member.select?.());
   const tooltip=document.createElement('span');tooltip.textContent=description.name+' · '+({online:'Online',offline:'Offline',unknown:'Unverified',support:'Solar support'}[description.health]);marker.bindTooltip(tooltip,{direction:'top',offset:[0,-24],className:'cos-fleet-pin-tooltip'});marker.on('click',()=>marker.closeTooltip());
  }
 },[pins,layer,revision,mhelpAddressPins,mhelpAddressHealth,mhelpAddressUnits,filters,pickLocation]);

 const fit=()=>{const values=[...pinRef.current.map(p=>p.point),...visibleMhelpPins.map(p=>p.point)];if(values.length)map.current?.fitBounds(L.latLngBounds(values),{padding:[40,50],maxZoom:15});};
 // Pending proof validation hides markers, but is not a settled population change.
 const previousIds=useRef('');useEffect(()=>{if(!locationsReady)return;const key=[...pinRef.current.map(fleetLocationPinId),...visibleMhelpPins.map(p=>'mhelp:'+p.productId)].join('|');if(key!==previousIds.current){const first=!previousIds.current;previousIds.current=key;if(!(first&&(restored.current.center||viewportChanged.current)))fit();}},[pins,mhelpAddressPins,mhelpAddressUnits,filters,locationsReady]);
 const focused=useRef('');useEffect(()=>{if(!selectedId){focused.current='';return;}const pin=pins.find(p=>fleetLocationPinId(p)===selectedId);if(pin&&focused.current!==selectedId){focused.current=selectedId;map.current?.setView(pin.point,Math.max(map.current.getZoom(),14));}},[selectedId,pins,mhelpAddressPins,mhelpAddressUnits]);
 return <div ref={panel} aria-busy={!locationsReady} className={'cos-fleet-map-panel field-map-workspace cos-fleet-individual-pins cos-fleet-compact-groups'+(expanded?' cos-fleet-map-expanded':'')+(pickLocation?' cos-fleet-picking':'')}>
  <div className='cos-fleet-map-toolbar'><div><details className='cos-fleet-map-details'><summary aria-label='Fleet map details'><strong>Fleet map</strong></summary><small>{locationsReady?<>{pins.length} {pins.some(pin=>pin.kind==='source_equipment_estimate')?'equipment':'unit'} pins · {pins.filter(p=>p.kind==='current').length} verified · {pins.filter(p=>p.kind!=='current').length} estimated / source recorded{visibleMhelpPins.length>0&&<> · {visibleMhelpPins.length} MHelp customer address units</>}</>:'Checking saved map locations…'}</small>{visibleMhelpPins.length>0&&<label className='cos-fleet-map-find'>Find a mapped unit<select aria-label='Find mapped equipment' defaultValue='' onChange={event=>{if(event.currentTarget.value)onSelectMhelpAddress?.(event.currentTarget.value);event.currentTarget.value='';}}><option value=''>Choose unit</option>{visibleMhelpPins.map(pin=><option key={pin.productId} value={pin.productId}>{pin.unitNumber} · Product {pin.productId}</option>)}</select></label>}</details></div><div><button onClick={fit} disabled={!pins.length&&!visibleMhelpPins.length}>Fit pins</button><button className={expanded?'field-map-fullscreen-exit':''} onClick={full} aria-label={expanded?'Exit fullscreen fleet map':'Fullscreen fleet map'}>{expanded?'Close fullscreen':'⛶ Fullscreen'}</button></div></div>
  {pickLocation&&<div className='cos-fleet-pick-note' role='status'>Tap the verified installation point. This selects a candidate; confirm the address before saving. <button onClick={()=>pickLocation(null)}>Cancel pin selection</button></div>}
  <div ref={node} className='cos-fleet-map-canvas' aria-label='Interactive fleet installation map'/>
  {locationsReady&&!pins.length&&!visibleMhelpPins.length&&!pickLocation&&<p className='cos-fleet-map-note'>{rows.length?'These units have no currently verified pins or approved address estimates. Open Location verification.':'No linked unit pins match these filters. Recorded equipment can remain in the list without a verified location.'}</p>}
  <div className='cos-fleet-map-legend'><strong>{layer.toUpperCase()} HEALTH</strong><span className='cos-signal-online'>● Online</span><span className='cos-signal-offline'>● Offline</span><span className='cos-signal-unknown'>● Unverified</span><span className='cos-signal-support'>● Solar support</span><details className='cos-fleet-pin-key'><summary>Location key</summary><span>◇ Unlinked equipment · Estimated address</span><span>⌖ MHelp Field address (not GPS)</span><span>Compact rings show grouped equipment status · select a group to view its units.</span><small>EST / SRC: installation needs verification · Nearby units may use display offsets; saved locations stay unchanged.</small></details></div>
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

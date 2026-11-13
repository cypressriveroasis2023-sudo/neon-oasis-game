import {useEffect,useRef,useState} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {addFieldMapBasemap} from './fieldMapBasemap';
import {unitPins,type SavedAddressPin,type UnitPin} from './unitStatusPins';
import {fleetIndividualPinPositions} from './fleetMapGroups';
import {compactMapGroups,compactMapStatusCounts,compactGroupMarkup,compactGroupPopup,COMPACT_MAP_GROUP_THRESHOLD,type CompactMapMember} from './fleetCompactMap';
import {fleetUnitPinMarkup} from './fleetStatusPins';
import type {ReticleState} from './fieldMapMarkers';
import './fleetCompactSheet.css';
import type {UnitCameraStatus} from '../shared/starUnitStatus';

// The Fleet map's own grouping and pin shapes, so the two maps look and behave
// alike. Camera status keeps its four colours; a unit with some cameras down
// counts with the ones needing attention, and its own line still says so.
const RETICLE:Record<UnitCameraStatus['state'],ReticleState>={GREEN:'online',YELLOW:'offline',RED:'offline',UNKNOWN:'unknown'};
const LOCATION_LABEL={hand:'Address typed by hand',saved:'Address on file · nobody has confirmed it on site'} as const;

/** The Fleet pin, repainted with this page's camera-status colour. */
export function unitPinMarkup(pin:UnitPin):string{
 return fleetUnitPinMarkup(pin.unit,RETICLE[pin.state],pin.source==='saved'?'estimate':'current')
  .replace(/--pin:[^;"]*/,'--pin:'+pin.colour);
}
export function unitMember(pin:UnitPin,select?:(unit:string)=>void):CompactMapMember{
 return {key:pin.unit,label:pin.unit+' · '+pin.label,health:RETICLE[pin.state],
  site:pin.site||'',address:pin.address||'',locationLabel:LOCATION_LABEL[pin.source],
  select:select?()=>select(pin.unit):undefined};
}
/** Plain words for the marker's title, with the real four-way counts. */
export function groupTitle(pins:readonly UnitPin[]):string{
 const counts=new Map<string,number>();
 for(const pin of pins)counts.set(pin.label,(counts.get(pin.label)||0)+1);
 return pins.length+' units here · '+[...counts].map(([label,n])=>n+' '+label.toLowerCase()).join(', ');
}

/** Field units with a point, one pin each, grouped the way the Fleet map groups. */
export default function UnitStatusMap({units,savedAddresses,onSelect}:{units:readonly UnitCameraStatus[];savedAddresses?:readonly SavedAddressPin[]|null;onSelect?:(unit:string)=>void}){
 const node=useRef<HTMLDivElement>(null),groupHost=useRef<HTMLDivElement>(null);
 const map=useRef<L.Map|null>(null),layer=useRef<L.LayerGroup|null>(null),select=useRef(onSelect);
 const [revision,setRevision]=useState(0);
 const [groupDetails,setGroupDetails]=useState<{members:CompactMapMember[];zoom?:()=>void}|null>(null);
 select.current=onSelect;
 const {pins,fieldUnits,withoutPin,handPins,savedPins}=unitPins(units,savedAddresses);
 const key=pins.map(pin=>pin.unit+pin.state+pin.source+pin.latitude+','+pin.longitude).join('|');
 useEffect(()=>{
  if(!node.current)return;
  const created=L.map(node.current,{zoomControl:true,attributionControl:true}).setView([31.0,-97.5],6);
  addFieldMapBasemap(created);
  layer.current=L.layerGroup().addTo(created);map.current=created;
  // Positions are worked out in pixels, so a zoom or pan redraws them.
  created.on('zoomend moveend',()=>setRevision(value=>value+1));
  return ()=>{created.remove();map.current=null;layer.current=null;};
 },[]);
 // The member list lives in a panel of its own: a popup taller than the map
 // gets clipped or torn down mid-click.
 useEffect(()=>{
  const host=groupHost.current;
  if(!host||!groupDetails)return;
  host.replaceChildren(compactGroupPopup(groupDetails.members,groupDetails.zoom));
  return ()=>{host.replaceChildren();};
 },[groupDetails]);
 useEffect(()=>{setGroupDetails(null);},[key]);
 useEffect(()=>{
  if(!groupDetails)return;
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setGroupDetails(null);};
  window.addEventListener('keydown',escape);
  return ()=>window.removeEventListener('keydown',escape);
 },[groupDetails]);
 useEffect(()=>{
  const group=layer.current,current=map.current;
  if(!group||!current)return;
  group.clearLayers();
  const entries=pins.map(pin=>({item:pin,...current.latLngToContainerPoint([pin.latitude,pin.longitude])}));
  const size=current.getSize();
  const layout=entries.length>=COMPACT_MAP_GROUP_THRESHOLD?compactMapGroups(entries)
   :fleetIndividualPinPositions(entries,{width:size.x,height:size.y}).map(position=>[position]);
  for(const members of layout){
   if(members.length>1){
    const described=members.map(entry=>unitMember(entry.item,select.current));
    const counts=compactMapStatusCounts(described);
    const centre={x:members.reduce((n,p)=>n+p.x,0)/members.length,y:members.reduce((n,p)=>n+p.y,0)/members.length};
    const title=groupTitle(members.map(entry=>entry.item));
    const marker=L.marker(current.containerPointToLatLng(L.point(centre.x,centre.y)),{
     bubblingMouseEvents:false,zIndexOffset:counts.offline?300:100,
     icon:L.divIcon({className:'cos-compact-group-marker',html:compactGroupMarkup(counts),iconSize:[52,52],iconAnchor:[26,26]}),
     title,alt:title,
    }).addTo(group);
    const element=marker.getElement();
    element?.setAttribute('data-group-count',String(members.length));
    element?.setAttribute('data-group-member-ids',JSON.stringify(described.map(item=>item.key)));
    element?.setAttribute('aria-label',title);
    const places=new Set(members.map(entry=>entry.item.latitude+','+entry.item.longitude));
    // Units at genuinely different places can be zoomed apart; units at one
    // address cannot, so no zoom is offered there.
    const zoom=places.size>1&&current.getZoom()<17?()=>{
     current.fitBounds(L.latLngBounds(members.map(entry=>[entry.item.latitude,entry.item.longitude] as [number,number])),{padding:[72,72],maxZoom:16,animate:false});
    }:undefined;
    marker.on('click',()=>setGroupDetails({members:described,zoom:zoom?()=>{setGroupDetails(null);zoom();}:undefined}));
    continue;
   }
   const entry=members[0],pin=entry.item;
   const display=current.containerPointToLatLng(L.point(entry.x,entry.y));
   const sourceX='sourceX' in entry?Number(entry.sourceX):entry.x,sourceY='sourceY' in entry?Number(entry.sourceY):entry.y;
   const offset=Math.abs(entry.x-sourceX)>1||Math.abs(entry.y-sourceY)>1;
   // A moved pin keeps a thread back to the place it really is.
   if(offset)L.polyline([[pin.latitude,pin.longitude],display],{color:'#9eacbd',weight:1,opacity:.55,interactive:false}).addTo(group);
   const title=pin.unit+' · '+pin.label+' · '+pin.online+' of '+pin.cameras+' up'
    +(pin.site?' · '+pin.site:'')+(pin.address?' · '+pin.address:'')
    +(pin.source==='saved'?' · '+LOCATION_LABEL.saved:'')
    +(offset?' · Moved aside so it can be clicked; the place it is has not changed':'');
   const marker=L.marker(display,{bubblingMouseEvents:false,autoPanOnFocus:false,
    icon:L.divIcon({className:'cos-dashboard-marker cos-field-pin-wrap'+(offset?' cos-dashboard-peer':''),html:unitPinMarkup(pin),iconSize:[44,56],iconAnchor:[22,18]}),
    title,alt:title}).addTo(group);
   const element=marker.getElement();
   element?.setAttribute('aria-label',title);
   element?.setAttribute('data-unit-id',pin.unit);
   element?.setAttribute('data-health',RETICLE[pin.state]);
   element?.setAttribute('data-pin-source',pin.source);
   marker.on('click',()=>{marker.closeTooltip();select.current?.(pin.unit);});
  }
 },[key,revision]);
 const fitted=useRef('');
 useEffect(()=>{
  const current=map.current;
  if(!current||!pins.length||fitted.current===key)return;
  fitted.current=key;
  current.fitBounds(L.latLngBounds(pins.map(pin=>[pin.latitude,pin.longitude] as [number,number])),{padding:[30,30],maxZoom:13});
 },[key]);
 return <div className='cos-camera-status-map'>
  <div ref={node} className='cos-camera-status-map-canvas' role='region' aria-label='Map of field units by camera status'/>
  <div ref={groupHost} className='cos-camera-status-map-group'/>
  <p className='cos-camera-status-map-key'>
   <span><i style={{background:'#2e9e5b'}}/>All up</span><span><i style={{background:'#e0a52a'}}/>Some down</span>
   <span><i style={{background:'#d64545'}}/>All down</span><span><i style={{background:'#8a8f98'}}/>Not verified</span>
   <span><i className='cos-camera-status-key-saved'/>Address on file</span>
   <small>{pins.length} of {fieldUnits} field units on the map &middot; {handPins} typed by hand, {savedPins} from the address already on the unit list{withoutPin?' · '+withoutPin+' have no address yet (Edit by hand → Address)':''}</small>
  </p>
 </div>;
}

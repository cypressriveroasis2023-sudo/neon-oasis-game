import {useEffect,useRef} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {addFieldMapBasemap} from './fieldMapBasemap';
import {unitPins,type SavedAddressPin} from './unitStatusPins';
import type {UnitCameraStatus} from '../shared/starUnitStatus';

const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'} as Record<string,string>)[c]);

/** Field units with a recorded address, one pin each, coloured by camera status. */
export default function UnitStatusMap({units,savedAddresses,onSelect}:{units:readonly UnitCameraStatus[];savedAddresses?:readonly SavedAddressPin[]|null;onSelect?:(unit:string)=>void}){
 const node=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),layer=useRef<L.LayerGroup|null>(null),select=useRef(onSelect);
 select.current=onSelect;
 const {pins,fieldUnits,withoutPin,handPins,savedPins}=unitPins(units,savedAddresses);
 useEffect(()=>{
  if(!node.current)return;
  const created=L.map(node.current,{zoomControl:true,attributionControl:true}).setView([31.0,-97.5],6);
  addFieldMapBasemap(created);
  layer.current=L.layerGroup().addTo(created);map.current=created;
  return ()=>{created.remove();map.current=null;layer.current=null;};
 },[]);
 useEffect(()=>{
  const group=layer.current,current=map.current;
  if(!group||!current)return;
  group.clearLayers();
  for(const pin of pins){
   // A typed address is a solid pin; an address already on the unit list is hollow,
   // because nobody has confirmed that one on site.
   const saved=pin.source==='saved';
   L.circleMarker([pin.latitude,pin.longitude],{radius:9,color:saved?pin.colour:'#111',weight:saved?3:1.5,
    fillColor:pin.colour,fillOpacity:saved?0.25:0.95,dashArray:saved?'3 3':undefined})
    .bindTooltip(escape(pin.unit)+' · '+escape(pin.label)+(saved?' · address on file':''))
    .bindPopup('<strong>'+escape(pin.unit)+'</strong><br>'+escape(pin.label)+' · '+pin.online+' of '+pin.cameras+' up'
     +(pin.site?'<br>'+escape(pin.site):'')+(pin.address?'<br>'+escape(pin.address):'')
     +(saved?'<br>Address on file — nobody has confirmed it on site.':''))
    .on('click',()=>select.current?.(pin.unit))
    .addTo(group);
  }
  if(pins.length)current.fitBounds(L.latLngBounds(pins.map(pin=>[pin.latitude,pin.longitude] as [number,number])),{padding:[30,30],maxZoom:13});
 },[pins.map(pin=>pin.unit+pin.state+pin.source+pin.latitude+','+pin.longitude).join('|')]);
 return <div className='cos-camera-status-map'>
  <div ref={node} className='cos-camera-status-map-canvas' role='region' aria-label='Map of field units by camera status'/>
  <p className='cos-camera-status-map-key'>
   <span><i style={{background:'#2e9e5b'}}/>All up</span><span><i style={{background:'#e0a52a'}}/>Some down</span>
   <span><i style={{background:'#d64545'}}/>All down</span><span><i style={{background:'#8a8f98'}}/>Not verified</span><span><i className='cos-camera-status-key-saved'/>Address on file</span>
   <small>{pins.length} of {fieldUnits} field units on the map · {handPins} typed by hand, {savedPins} from the address already on the unit list{withoutPin?' · '+withoutPin+' have no address yet (Edit by hand → Address)':''}</small>
  </p>
 </div>;
}

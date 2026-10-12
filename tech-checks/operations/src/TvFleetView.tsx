import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './fieldMap.css';
import './tvBoardExtensions.css';
import {checkedFieldMap} from './gpsPersistence';
import {validateCameraHealth,fieldCameraHealth,cameraTime,type Health,type FieldHealthUnit} from './fieldCameraHealth';
import {fieldReachability,fieldReachabilityLabels,isCurrentFieldPin,locationTag,type FieldLocation} from './fieldLocations';
import {readRouterSnapshot,type RouterSnapshot} from '../../supabase/functions/cos-operations-pages/routers';
import {automaticRefreshDue} from './refreshCadence';
import {mapReticleMarkup} from './fieldMapMarkers';
import {checkedAddressEstimate,addressEstimateLabel,type AddressEstimate} from './fieldAddressEstimates';
type Unit=FieldHealthUnit&FieldLocation&{activeJobNumber?:string};
type Snapshot={units:Unit[];health:Health|null;routers:RouterSnapshot|null;readAt:number|null;estimates:Map<string,AddressEstimate>};
type Api={get:(path:string)=>Promise<{data:any}>};
const empty:Snapshot={units:[],health:null,routers:null,readAt:null,estimates:new Map()};
export default function TvFleetView({api,enabled,mode,rotation,height,refreshId}:{api:Api;enabled:boolean;mode:'camera'|'map'|null;rotation:number;height:number;refreshId:number}){
  const [data,setData]=useState<Snapshot>(empty),[error,setError]=useState(''),[clock,setClock]=useState(Date.now());
  const generation=useRef(0),running=useRef(false),lastAttempt=useRef(0),alive=useRef(false);
  const refresh=useCallback(async()=>{
    if(running.current)return;
    running.current=true;lastAttempt.current=Date.now();const request=generation.current;
    try{
      const [field,health,routers]=await Promise.all([api.get('/api/field-map'),api.get('/api/camera-health/summary-v3'),api.get('/api/routers')]);
      const units=checkedFieldMap(field.data).items as Unit[];
      const points=await Promise.all(units.map(async unit=>({id:unit.id,point:await checkedAddressEstimate(unit)})));
      const next={units,health:validateCameraHealth(health.data),routers:readRouterSnapshot(routers.data),readAt:Date.now(),estimates:new Map(points.filter(row=>row.point!==null).map(row=>[row.id,row.point!]))};
      if(alive.current&&request===generation.current){setData(next);setClock(Date.now());setError('');}
    }catch(cause){if(alive.current&&request===generation.current)setError(cause instanceof Error?cause.message:'Fleet information is unavailable.');}
    finally{running.current=false;}
  },[api]);
  useEffect(()=>{
    if(!enabled){setData(empty);return;}
    alive.current=true;void refresh();
    const tick=()=>{setClock(Date.now());if(automaticRefreshDue(lastAttempt.current,Date.now(),document.hidden))void refresh();};
    const timer=window.setInterval(tick,60000);
    const invalid=()=>{generation.current++;setData(empty);setError('Sign in again to load fleet information.');};
    document.addEventListener('visibilitychange',tick);window.addEventListener('cos-private-data-invalidated',invalid);
    return()=>{alive.current=false;generation.current++;window.clearInterval(timer);document.removeEventListener('visibilitychange',tick);window.removeEventListener('cos-private-data-invalidated',invalid);};
  },[enabled,refresh]);
  useEffect(()=>{if(enabled&&refreshId>0)void refresh();},[refreshId,enabled,refresh]);
  const rows=useMemo(()=>data.units.map(unit=>({unit,health:fieldCameraHealth(unit,data.units,data.health,clock),router:fieldReachability(unit,data.routers?.items,clock),point:isCurrentFieldPin(unit)?{latitude:Number(unit.latitude),longitude:Number(unit.longitude)}:data.estimates.get(unit.id),estimate:data.estimates.get(unit.id)})).sort((a,b)=>({offline:0,unknown:1,online:2,support:3}[a.health.state]-{offline:0,unknown:1,online:2,support:3}[b.health.state])||a.unit.unitNumber.localeCompare(b.unit.unitNumber)),[data,clock]);
  const mapNode=useRef<HTMLDivElement|null>(null),mapRef=useRef<L.Map|null>(null),layer=useRef<L.LayerGroup|null>(null);
  useEffect(()=>{
    if(!enabled||!mapNode.current)return;
    const map=L.map(mapNode.current,{zoomControl:false,attributionControl:true}).setView([31,-99],6);mapRef.current=map;
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{maxZoom:19,attribution:'© OpenStreetMap © CARTO'}).addTo(map);
    layer.current=L.layerGroup().addTo(map);
    return()=>{map.remove();mapRef.current=null;layer.current=null;};
  },[enabled]);
  useEffect(()=>{
    const map=mapRef.current,group=layer.current;if(!map||!group)return;
    group.clearLayers();const bounds:L.LatLngExpression[]=[];
    for(const {unit,health,router,point,estimate} of rows.filter(row=>row.point)){
      const coordinate:L.LatLngExpression=[point!.latitude,point!.longitude];bounds.push(coordinate);
      const marker=L.marker(coordinate,{title:unit.unitNumber+' · '+health.state,icon:L.divIcon({className:'cos-field-pin-wrap',html:mapReticleMarkup(unit.unitNumber,health.state,isCurrentFieldPin(unit)?'current':estimate?.confidence==='source_recorded_unverified'?'recorded':'estimate'),iconSize:[48,48],iconAnchor:[24,24]})});
      const popup=document.createElement('div');const title=document.createElement('strong');title.textContent=unit.unitNumber;popup.append(title);
      for(const text of [unit.site||unit.customer||'Site not linked',unit.address||'Address not recorded','Camera / connection: '+health.state.toUpperCase(),fieldReachabilityLabels[router],!isCurrentFieldPin(unit)&&estimate?addressEstimateLabel(estimate)+' · needs verification':locationTag(unit)]){const p=document.createElement('p');p.textContent=text;popup.append(p);}
      marker.bindPopup(popup);group.addLayer(marker);
    }
    if(bounds.length)map.fitBounds(L.latLngBounds(bounds),{padding:[32,32],maxZoom:13});
  },[rows]);
  useEffect(()=>{if(mode==='map')requestAnimationFrame(()=>{const map=mapRef.current;if(!map)return;map.invalidateSize();const points=rows.filter(row=>row.point).map(row=>[row.point!.latitude,row.point!.longitude] as L.LatLngTuple);if(points.length)map.fitBounds(L.latLngBounds(points),{padding:[32,32],maxZoom:13});});},[mode,height,rows]);
  const count=window.innerWidth<900?1:window.innerWidth<1500?4:height<900?3:6,parts=Math.max(1,Math.ceil(rows.length/count)),shown=rows.slice((rotation%parts)*count,(rotation%parts+1)*count);
  const totals={online:rows.filter(r=>r.health.state==='online').length,offline:rows.filter(r=>r.health.state==='offline').length,unknown:rows.filter(r=>r.health.state==='unknown').length,mapped:rows.filter(r=>isCurrentFieldPin(r.unit)).length};
  return <div className='tv-fleet-view' data-enabled={String(enabled)} data-running={String(running.current)} hidden={!mode} aria-label={mode==='map'?'TV Field Map':'TV Camera Health'}>
    <div className='tv-fleet-summary'><b className='tv-online'>{totals.online} online</b><b className='tv-offline'>{totals.offline} offline</b><b>{totals.unknown} unverified</b><b>{totals.mapped} verified pins</b><small>Saved data · refresh 15 min{data.readAt?' · '+cameraTime(data.health?.refreshedAt,clock):''}</small></div>
    {error&&<p className='tv-fleet-warning' role='status'>Fleet updates delayed. {error}</p>}
    {!data.readAt&&<p className='tv-fleet-loading'>{error?'Fleet information is unavailable.':'Loading Camera Health and field locations…'}</p>}
    <div className='tv-fleet-map-wrap field-map-workspace' hidden={mode!=='map'}><div ref={mapNode} className='tv-fleet-map' aria-label='Field unit locations'/><div className='tv-map-legend'><span className='tv-online'>● Online</span><span className='tv-offline'>● Offline</span><span>● Unverified</span><span className='tv-solar'>● Solar / support</span><span>EST / SRC: location needs verification</span><span>{rows.length-totals.mapped} locations need verification</span></div></div>
    {mode==='camera'&&data.readAt&&<div className='tv-fleet-records'>{shown.map(({unit,health,router})=><article key={unit.id} className={'tv-fleet-record tv-state-'+health.state}><div><h3>{unit.unitNumber}</h3><b>{health.state==='support'?'SUPPORT EQUIPMENT':health.state.toUpperCase()}</b></div><p>{unit.site||unit.customer||'Site not linked'}</p><p>{unit.address||'Address not recorded'}</p><div><span>{fieldReachabilityLabels[router]}</span><span>{locationTag(unit)}</span></div><small>{unit.activeJobNumber||'No linked job'} · {health.basis==='connection'?'IP / port observation':health.basis==='recorder'?'Recorder observation':'Camera / detector observation'} · {cameraTime(health.checkedAt,clock)}</small></article>)}{!rows.length&&<p>No field units are available in the saved map.</p>}</div>}
  </div>;
}

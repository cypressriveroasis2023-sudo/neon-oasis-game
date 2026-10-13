import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './fieldMap.css';
import './tvBoardExtensions.css';
import {fieldCameraHealth,cameraTime,type Health,type FieldHealthUnit} from './fieldCameraHealth';
import {fieldReachability,fieldReachabilityLabels,isCurrentFieldPin,locationTag,type FieldLocation} from './fieldLocations';
import type {RouterSnapshot} from '../../supabase/functions/cos-operations-pages/routers';
import {addFieldMapBasemap} from './fieldMapBasemap';
import {loadTvFleetFeeds} from './tvFleetFeeds';
import {automaticRefreshDue} from './refreshCadence';
import {mapReticleMarkup} from './fieldMapMarkers';
import {checkedAddressEstimate,addressEstimateLabel,type AddressEstimate} from './fieldAddressEstimates';
import {tvMapTour,tvOutageRows,tvCameraPageSize} from './tvMapTour';
import type {FleetPages} from './tvBoardData';
type Unit=FieldHealthUnit&FieldLocation&{activeJobNumber?:string};
type Snapshot={units:Unit[];inventory:Unit[];health:Health|null;routers:RouterSnapshot|null;readAt:number|null;estimates:Map<string,AddressEstimate>};
type Api={get:(path:string)=>Promise<{data:any}>};
const empty:Snapshot={units:[],inventory:[],health:null,routers:null,readAt:null,estimates:new Map()};
export default function TvFleetView({api,enabled,mode,page,width,height,refreshId,onPages}:{api:Api;enabled:boolean;mode:'camera'|'map'|null;page:number;width:number;height:number;refreshId:number;onPages:(pages:FleetPages)=>void}){
  const [data,setData]=useState<Snapshot>(empty),[error,setError]=useState(''),[clock,setClock]=useState(Date.now());
  const generation=useRef(0),running=useRef(false),lastAttempt=useRef(0),alive=useRef(false);
  const refresh=useCallback(async(force=false)=>{
    if(running.current)return;
    running.current=true;lastAttempt.current=Date.now();const request=generation.current;
    try{
      const current=()=>alive.current&&request===generation.current;
      const errors=await loadTvFleetFeeds(api,{
        healthUnavailable:()=>{if(current())setData(previous=>({...previous,health:null}));},
        routersUnavailable:()=>{if(current())setData(previous=>({...previous,routers:null}));},
        field:async field=>{
          const units=field.items as Unit[];
          const points=await Promise.all(units.map(async unit=>({id:unit.id,point:await checkedAddressEstimate(unit)})));
          if(current())setData(previous=>({...previous,units,inventory:(Array.isArray((field as any).inventoryItems)?(field as any).inventoryItems:units) as Unit[],readAt:Date.now(),estimates:new Map(points.filter(row=>row.point!==null).map(row=>[row.id,row.point!]))}));
        },
        health:health=>{if(current())setData(previous=>({...previous,health}));},
        routers:routers=>{if(current())setData(previous=>({...previous,routers}));}
      },force);
      if(current()){setClock(Date.now());setError(errors.join(' '));}
    }catch(cause){if(alive.current&&request===generation.current)setError(cause instanceof Error?cause.message:'Fleet information is unavailable.');}
    finally{running.current=false;}
  },[api]);
  useEffect(()=>{
    if(!enabled){setData(empty);return;}
    alive.current=true;void refresh();
    const tick=()=>{setClock(Date.now());if(automaticRefreshDue(lastAttempt.current,Date.now(),document.hidden))void refresh(true);};
    const timer=window.setInterval(tick,60000);
    const invalid=()=>{generation.current++;setData(empty);setError('Sign in again to load fleet information.');};
    document.addEventListener('visibilitychange',tick);window.addEventListener('cos-private-data-invalidated',invalid);
    return()=>{alive.current=false;generation.current++;window.clearInterval(timer);document.removeEventListener('visibilitychange',tick);window.removeEventListener('cos-private-data-invalidated',invalid);};
  },[enabled,refresh]);
  useEffect(()=>{if(enabled&&refreshId>0)void refresh(true);},[refreshId,enabled,refresh]);
  const rows=useMemo(()=>data.units.map(unit=>({unit,health:fieldCameraHealth(unit,data.inventory,data.health,clock),router:fieldReachability(unit,data.routers?.items,clock),point:isCurrentFieldPin(unit)?{latitude:Number(unit.latitude),longitude:Number(unit.longitude)}:data.estimates.get(unit.id),estimate:data.estimates.get(unit.id)})).sort((a,b)=>({offline:0,unknown:1,online:2,support:3}[a.health.state]-{offline:0,unknown:1,online:2,support:3}[b.health.state])||a.unit.unitNumber.localeCompare(b.unit.unitNumber)),[data,clock]);
  const outages=useMemo(()=>tvOutageRows(rows),[rows]);
  const areas=useMemo(()=>tvMapTour(rows),[rows]);
  const count=tvCameraPageSize(width,height),parts=Math.max(1,Math.ceil(outages.length/count));
  const shown=outages.slice((page%parts)*count,(page%parts+1)*count),area=areas[page%areas.length];
  useEffect(()=>onPages({camera:parts,map:areas.map(area=>area.label)}),[parts,areas,onPages]);
  const mapNode=useRef<HTMLDivElement|null>(null),mapRef=useRef<L.Map|null>(null),layer=useRef<L.LayerGroup|null>(null);
  useEffect(()=>{
    if(!enabled||!mapNode.current)return;
    const map=L.map(mapNode.current,{zoomControl:false,attributionControl:true}).setView([31,-99],6);mapRef.current=map;
    addFieldMapBasemap(map);
    layer.current=L.layerGroup().addTo(map);
    return()=>{map.remove();mapRef.current=null;layer.current=null;};
  },[enabled]);
  useEffect(()=>{
    const map=mapRef.current,group=layer.current;if(!map||!group)return;
    group.clearLayers();
    for(const {unit,health,router,point,estimate} of rows.filter(row=>row.point)){
      const coordinate:L.LatLngExpression=[point!.latitude,point!.longitude];
      const marker=L.marker(coordinate,{title:unit.unitNumber+' · '+health.state,icon:L.divIcon({className:'cos-field-pin-wrap',html:mapReticleMarkup(unit.unitNumber,health.state,isCurrentFieldPin(unit)?'current':estimate?.confidence==='source_recorded_unverified'?'recorded':'estimate'),iconSize:[48,48],iconAnchor:[24,24]})});
      const popup=document.createElement('div');const title=document.createElement('strong');title.textContent=unit.unitNumber;popup.append(title);
      for(const text of [unit.site||unit.customer||'Site not linked',unit.address||'Address not recorded','Camera / connection: '+health.state.toUpperCase(),fieldReachabilityLabels[router],!isCurrentFieldPin(unit)&&estimate?addressEstimateLabel(estimate)+' · needs verification':locationTag(unit)]){const p=document.createElement('p');p.textContent=text;popup.append(p);}
      marker.bindPopup(popup);group.addLayer(marker);
    }
  },[rows]);
  useEffect(()=>{
    if(mode!=='map')return;
    const frame=requestAnimationFrame(()=>{
      const map=mapRef.current;if(!map)return;map.invalidateSize();
      const points=area.points.map(point=>[point.latitude,point.longitude] as L.LatLngTuple);
      if(points.length)map.fitBounds(L.latLngBounds(points),{padding:[48,48],maxZoom:13,animate:false});
      if(mapNode.current)mapNode.current.dataset.zoom=String(map.getZoom());
    });
    return()=>cancelAnimationFrame(frame);
  },[mode,height,width,area]);
  const totals={online:rows.filter(r=>r.health.state==='online').length,offline:rows.filter(r=>r.health.state==='offline').length,unknown:rows.filter(r=>r.health.state==='unknown').length,mapped:rows.filter(r=>isCurrentFieldPin(r.unit)).length};
  return <div className='tv-fleet-view' hidden={!mode} aria-label={mode==='map'?'TV Field Map':'TV Camera Health'}>
    <div className='tv-fleet-summary'>{mode==='camera'?<><b className='tv-offline'>{outages.length} down units</b><b>Red units only · {page%parts+1} / {parts}</b></>:<><b className='tv-online'>{totals.online} online</b><b className='tv-offline'>{totals.offline} offline</b><b>{totals.unknown} unverified</b><b>{totals.mapped} verified pins</b></>}<small>Saved data · refresh 15 min{data.readAt?' · '+cameraTime(data.health?.refreshedAt,clock):''}</small></div>
    {error&&<p className='tv-fleet-warning' role='status'>Fleet updates delayed. {error}</p>}
    {!data.readAt&&<p className='tv-fleet-loading'>{error?'Fleet information is unavailable.':'Loading Camera Health and field locations…'}</p>}
    <div className='tv-fleet-map-wrap field-map-workspace' hidden={mode!=='map'} data-area-kind={area.kind}><div ref={mapNode} className='tv-fleet-map' aria-label='Field unit locations'/><div className='tv-map-area' aria-label='Current map area'><strong>{area.label}</strong><span>{area.ids.length} units · <b className='tv-offline'>{area.offline} down</b> · <b className='tv-online'>{area.online} online</b></span></div><div className='tv-map-legend'><span className='tv-online'>● Online</span><span className='tv-offline'>● Offline</span><span>● Unverified</span><span className='tv-solar'>● Solar / support</span><span>EST / SRC: location needs verification</span><span>{rows.length-totals.mapped} locations need verification</span></div></div>
    {mode==='camera'&&data.readAt&&<div className='tv-fleet-records'>{shown.map(({unit,health,router})=><article key={unit.id} className='tv-fleet-record tv-state-offline'><div><h3>{unit.unitNumber}</h3><b>OFFLINE</b></div><p>{unit.site||unit.customer||'Site not linked'}</p><p>{unit.address||'Address not recorded'}</p><div><span>{fieldReachabilityLabels[router]}</span><span>{locationTag(unit)}</span></div><small>{unit.activeJobNumber||'No linked job'} · {health.basis==='connection'?'IP / port observation':health.basis==='recorder'?'Recorder observation':'Camera / detector observation'} · {cameraTime(health.checkedAt,clock)}</small></article>)}{!outages.length&&<p>{data.health?'No confirmed red outages in the available records.':'Camera Health is unavailable. Waiting for outage records.'}</p>}</div>}
  </div>;
}

import {fieldMapLabelMatches} from './fieldMapNavigation';
import {automaticRefreshDue} from './refreshCadence';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { locationLink } from './visionAreas';
import { locationTag, locationExplanation, installationAddressLink, locationVerificationNote, locationHistoryNote, isCurrentFieldPin, historicalFieldCoordinates, parseLocationCoordinates } from './fieldLocations';
import { checkedAddressEstimate, addressEstimateHumanNote, type AddressEstimate } from './fieldAddressEstimates';
import { readFieldMapView,saveFieldMapView } from './fieldMapViewState';
import { useCameraHealth } from './useCameraHealth';
import { fieldCameraHealth, cameraColors, unitHealthLabel, cameraTime } from './fieldCameraHealth';
import { unitEvidenceLabel, serviceEvidenceLabel } from './cameraEvidence';
import { useRouters } from './useRouters';
import { RouterBadge, routerTime } from './RouterWorkspace';
import { routerLabels, routerStatus } from '../../supabase/functions/cos-operations-pages/routers';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './fieldMap.css';
import './fieldLocationVerification.css';
import { gpsWrite, hasGpsCoordinates } from '../shared/gpsValidation';
import { checkedFieldMap, createGpsSaver, gpsPopup } from './gpsPersistence';

type FieldUnit = {
  id:string;
  placementAuditId?:string; placementUnitKey?:string; locationGeocode?:Record<string,any>;
  unitNumber:string;
  modelName?:string;
  category?:string;
  status:string;
  currentLocationType?:string;
  installedSiteId?:string;
  site?:string;
  customer?:string;
  address?:string;
  latitude?:number|string|null;
  longitude?:number|string|null;
  coordinateSource?:string|null;
  gpsAccuracyM?:number|string|null;
  gpsRecordedAt?:string|null;
  activeJobNumber?:string|null;
  hasUnitGps?:boolean;
  readOnly?:boolean;
  recordSource?:string;
  sourceVerifiedAt?:string|null;
  snapshotImportedAt?:string|null;
  locationNote?:string|null;
  addressSource?:string|null;
  addressUpdatedAt?:string|null;
  locationVerification?:string|null;
  locationVerifiedAt?:string|null;
  historicalLatitude?:number|string|null;
  historicalLongitude?:number|string|null;
  historicalCoordinateSource?:string|null;
};

type Snapshot = {
  items:FieldUnit[];
  placementReviews?:{unitNumber:string;reason:string;placementAuditId:string|null}[];
  summary:{fieldUnits:number;mappedUnits:number;unitGps:number;missingGps:number};
  generatedAt:string;
  trackerSnapshot?:{source:string;importedAt:string;fieldRows:number};
};

type Props = { show:(message:string)=>void; initialUnitId?:string; initialUnitLabel?:string; openWorkspace?:(name:string)=>void; openUnitHealth?:(unitId:string)=>void; locationWritesEnabled?:boolean };

const hasCoords = (unit: FieldUnit) => isCurrentFieldPin(unit);
const noEstimates = new Map<string,AddressEstimate>();
const sourceLabel=(source?:string|null)=>source?source.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase()):'No coordinates';

export default function FieldMap({show,initialUnitId='',initialUnitLabel='',openWorkspace,openUnitHealth,locationWritesEnabled=false}:Props){
  const restored=useRef(readFieldMapView(window.history.state));
  const restoreViewport=useRef(Boolean(restored.current.center&&restored.current.zoom));
  const programmaticViewport=useRef(false);
  const moveViewport=(move:()=>void)=>{programmaticViewport.current=true;try{move();}finally{programmaticViewport.current=false;}};
  const routers=useRouters();
  const cameras=useCameraHealth();
  const [data,setData]=useState<Snapshot|null>(null);
  const [error,setError]=useState('');
  const [estimateState,setEstimateState]=useState<{snapshot:Snapshot;points:Map<string,AddressEstimate>}|null>(null);
  const estimates=estimateState?.snapshot===data?estimateState.points:noEstimates;
  useEffect(()=>{
    if(!data)return;
    let current=true;
    void Promise.all(data.items.map(async unit=>({id:unit.id,point:await checkedAddressEstimate(unit)}))).then(rows=>{
      if(current)setEstimateState({snapshot:data,points:new Map(rows.filter(row=>row.point!==null).map(row=>[row.id,row.point!]))});
    });
    return()=>{current=false;};
  },[data]);
  const [search,setSearch]=useState(restored.current.search||'');
  const [status,setStatus]=useState(restored.current.status||'field');
  const [selectedId,setSelectedId]=useState(initialUnitId||restored.current.selectedId||'');
  const [focusSelected,setFocusSelected]=useState(Boolean(initialUnitId||initialUnitLabel));
  const [lat,setLat]=useState('');
  const [lon,setLon]=useState('');
  const [accuracy,setAccuracy]=useState('');
  const [source,setSource]=useState('manual');
  const [note,setNote]=useState('');
  const [confirmedLocation,setConfirmedLocation]=useState(false);
  const [health,setHealth]=useState(restored.current.health||'all');
  const [nearbyId,setNearbyId]=useState(restored.current.nearbyId||'');
  const [showHistorical,setShowHistorical]=useState(restored.current.showHistorical||false);
  const [radius,setRadius]=useState(restored.current.radius||10);
  const [coordinatePaste,setCoordinatePaste]=useState('');
  const [pickingPin,setPickingPin]=useState(false);
  const pickingRef=useRef(false);
  useEffect(()=>{if(!locationWritesEnabled){pickingRef.current=false;setPickingPin(false);setConfirmedLocation(false);}},[locationWritesEnabled]);
  const [busy,setBusy]=useState(false);
  const [refreshRequired,setRefreshRequired]=useState(false);
  const [history,setHistory]=useState<any[]>([]);
  const [historyError,setHistoryError]=useState('');
  const [historyLoading,setHistoryLoading]=useState(false);
  const [gpsMessage,setGpsMessage]=useState('');
  const working = useRef(false);
  const lastAttemptAt = useRef(0);
  const automaticReadPaused = useRef(false);
  const gpsSaver = useRef(createGpsSaver(api));
  const hasMapContainer = Boolean(data || error);
  const mapNode=useRef<HTMLDivElement|null>(null);
  const mapRef=useRef<L.Map|null>(null);
  const layerRef=useRef<L.LayerGroup|null>(null);
  const markersRef=useRef(new Map<string,L.Marker>());

  const load=async()=>{
    if (working.current) return;
    working.current = true;
    lastAttemptAt.current = Date.now();
    setBusy(true);
    setError('');
    try{
      const response=await api.get('/api/field-map');
      const snapshot = checkedFieldMap(response.data) as unknown as Snapshot;
      setData(snapshot);
      gpsSaver.current.acknowledgeRefresh(snapshot);
      setRefreshRequired(gpsSaver.current.needsRefresh);
      const matches = initialUnitLabel ? fieldMapLabelMatches(snapshot.items,initialUnitLabel) : [];
      const first = initialUnitId ? snapshot.items.find(unit => unit.id === initialUnitId) : initialUnitLabel ? matches.length===1?matches[0]:undefined : snapshot.items.find(hasCoords) || snapshot.items[0];
      if(initialUnitLabel && matches.length!==1)show(matches.length>1?'This unit has conflicting field records. Select the verified installation.':'This unit is not currently in the field map. Shop units stay off the installed field map.');
      if (initialUnitId && !snapshot.items.some(unit => unit.id === initialUnitId)) show('This unit is not in the current field map. Refresh or select another field unit.');
      setSelectedId(current => (initialUnitId||initialUnitLabel)?first?.id||'':snapshot.items.some(unit => unit.id === current) ? current : first?.id || '');
      if(initialUnitLabel){setSearch(first?.unitNumber||initialUnitLabel);setStatus('all');setHealth('all');setNearbyId('');}
    }catch(e:any){
      setError(e?.response?.data?.error||e?.message||'Field Map could not be loaded.');
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  const loadRef=useRef(load);loadRef.current=load;
  useEffect(()=>{
    void loadRef.current();
    const check=()=>{if(!automaticReadPaused.current&&automaticRefreshDue(lastAttemptAt.current,Date.now(),document.hidden))void loadRef.current();};
    const timer=window.setInterval(check,60000);document.addEventListener('visibilitychange',check);
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',check);};
  },[]);

  useEffect(()=>{if(!data)return;if(initialUnitId){setSelectedId(data.items.some(unit=>unit.id===initialUnitId)?initialUnitId:'');setFocusSelected(true);}else if(initialUnitLabel){const matches=fieldMapLabelMatches(data.items,initialUnitLabel),unit=matches.length===1?matches[0]:null;setSelectedId(unit?.id||'');setSearch(unit?.unitNumber||initialUnitLabel);setStatus('all');setHealth('all');setNearbyId('');setFocusSelected(true);}},[initialUnitId,initialUnitLabel,Boolean(data)]);

  useEffect(()=>{if(data)saveFieldMapView({search,status,health,selectedId,nearbyId,radius,showHistorical});},[search,status,health,selectedId,nearbyId,radius,showHistorical,Boolean(data)]);

  const items=data?.items||[];
  const selected=items.find(x=>x.id===selectedId)||null;
  const healthById=useMemo(()=>new Map(items.map(unit=>[unit.id,fieldCameraHealth(unit,items,cameras.data,cameras.now)])),[items,cameras.data,cameras.now]);
  automaticReadPaused.current=Boolean(locationWritesEnabled&&selected&&!selected.readOnly&&(pickingPin||coordinatePaste.trim()||note.trim()||confirmedLocation||lat!==(hasCoords(selected)?String(selected.latitude):'')||lon!==(hasCoords(selected)?String(selected.longitude):'')||accuracy!==(selected.gpsAccuracyM==null?'':String(selected.gpsAccuracyM))||source!==(selected.hasUnitGps?(selected.coordinateSource||'manual'):'manual')));
  const selectedHealth=selected?healthById.get(selected.id):null;
  const estimateFor=(unit:FieldUnit)=>estimates.get(unit.id)||null;
  const mapPoint=(unit:FieldUnit)=>hasCoords(unit)?{latitude:Number(unit.latitude),longitude:Number(unit.longitude)}:estimateFor(unit);
  const tag=(unit:FieldUnit)=>estimateFor(unit)?'ADDRESS ESTIMATE':locationTag(unit);
  const selectedEstimate=selected?estimateFor(selected):null;
  const nearby=items.find(unit=>unit.id===nearbyId&&hasCoords(unit));
  const distance=(unit:FieldUnit)=>nearby&&hasCoords(unit)?L.latLng(Number(nearby.latitude),Number(nearby.longitude)).distanceTo(L.latLng(Number(unit.latitude),Number(unit.longitude)))/1609.344:null;
  const selectedRouters=routers.data?.items.filter(row=>row.match==='exact_name' && row.candidateUnit?.id===selectedId)||[];
  const filtered=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return items.filter(unit=>{
      const text=[unit.unitNumber,unit.modelName,unit.customer,unit.site,unit.activeJobNumber,unit.address].filter(Boolean).join(' ').toLowerCase();
      const statusOk=status==='all'||(status==='field'&&['field','assigned','in_transit','installed','returning'].includes(unit.status))||status==='tracker'&&unit.readOnly===true||status===unit.status||status==='missing'&&!hasCoords(unit);
      const healthOk=health==='all'||healthById.get(unit.id)?.state===health;
      const miles=distance(unit);
      return statusOk&&healthOk&&(!nearby||miles!==null&&miles<=radius)&&(!q||text.includes(q));
    });
  },[items,search,status,health,health==='all'?null:healthById,nearbyId,radius]);

  useEffect(()=>{
    if(!selected)return;
    setLat(hasCoords(selected)?String(selected.latitude):'');
    setLon(hasCoords(selected)?String(selected.longitude):'');
    setAccuracy(selected.gpsAccuracyM == null ? '' : String(selected.gpsAccuracyM));
    setSource(selected.hasUnitGps?(selected.coordinateSource||'manual'):'manual');
    setNote('');
    setConfirmedLocation(false);
    setPickingPin(false);
    pickingRef.current=false;
    setCoordinatePaste('');
    setHistory([]);
    setHistoryError('');
    setHistoryLoading(Boolean(selected.hasUnitGps));
    let current = true;
    if (selected.hasUnitGps) {
      api.get('/api/field-map/' + selected.id + '/history').then(response => {
        if (!Array.isArray(response.data?.items)) throw new Error('GPS history returned an incomplete response.');
        if (current) setHistory(response.data.items);
      }).catch(() => {
        if (current) setHistoryError('GPS history could not be loaded. Refresh to retry; this does not mean the history is empty.');
      }).finally(() => { if (current) setHistoryLoading(false); });
    }
    return () => { current = false; };
  },[selectedId,data?.generatedAt]);

  useEffect(()=>{
    if(!mapNode.current||mapRef.current)return;
    const map=L.map(mapNode.current,{zoomControl:true}).setView(restored.current.center||[29.7604,-95.3698],restored.current.zoom||8);
    map.on('moveend',()=>{const center=map.getCenter();saveFieldMapView({center:[center.lat,center.lng],zoom:map.getZoom()});});
    map.on('dragstart zoomstart',()=>{if(!programmaticViewport.current)restoreViewport.current=true;});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19,
      attribution:'&copy; OpenStreetMap contributors'
    }).addTo(map);
    mapRef.current=map;
    layerRef.current=L.layerGroup().addTo(map);
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => map.invalidateSize());
    resize?.observe(mapNode.current);
    const frame = window.requestAnimationFrame(() => map.invalidateSize());
    return () => {
      window.cancelAnimationFrame(frame);
      resize?.disconnect();
      map.remove();mapRef.current=null;layerRef.current=null;
    };
  },[hasMapContainer]);

  useEffect(()=>{
    const map=mapRef.current;
    const layer=layerRef.current;
    if(!map||!layer)return;
    layer.clearLayers();
    markersRef.current.clear();
    const mapped=filtered.filter(unit=>hasCoords(unit)||!nearby&&estimateFor(unit)||showHistorical&&!nearby&&historicalFieldCoordinates(unit));
    const bounds:L.LatLngExpression[]=[];
    for(const unit of mapped){
      const estimate=estimateFor(unit);
      const historic=!hasCoords(unit)&&!estimate?historicalFieldCoordinates(unit):null;
      const latitude=estimate?.latitude??historic?.latitude??Number(unit.latitude);
      const longitude=estimate?.longitude??historic?.longitude??Number(unit.longitude);
      bounds.push([latitude,longitude]);
      const marker=L.marker([latitude,longitude],{
        zIndexOffset:unit.id===selectedId?1000:0,
        title:unit.unitNumber+(estimate?' · Address estimate - needs verification':historic?' · Unverified historical location':' · '+unitHealthLabel(healthById.get(unit.id))),
        icon:L.divIcon({
          className:'cos-field-pin-wrap',
          html:'<span class="cos-field-pin'+(estimate?' cos-field-pin-estimate':historic?' cos-field-pin-historical':'')+'" style="--pin:'+cameraColors[healthById.get(unit.id)?.state||'unknown']+'"><b>'+(estimate?'EST · ':historic?'OLD · ':'')+unit.unitNumber.replace(/[<>&"']/g,'')+'</b></span>',
          iconSize:[54,38],
          iconAnchor:[27,34]
        })
      });
      marker.bindPopup(gpsPopup(document, unit));
      markersRef.current.set(unit.id,marker);
      marker.on('click',()=>{ if (!working.current&&!pickingRef.current) {setSelectedId(unit.id);saveFieldMapView({selectedId:unit.id});openUnitHealth?.(unit.id);} });
      marker.addTo(layer);
    }
    // Do not consume restored/user viewport intent before this snapshot's asynchronous validation settles.
    if(estimateState?.snapshot!==data)return;
    if(restoreViewport.current){restoreViewport.current=false;return;}
    if(focusSelected&&selected&&mapPoint(selected)){
      const point=mapPoint(selected)!;moveViewport(()=>map.setView([point.latitude,point.longitude],Math.max(map.getZoom(),14),{animate:false}));
    }else if(bounds.length===1){
      moveViewport(()=>map.setView(bounds[0],14,{animate:false}));
    }else if(bounds.length>1){
      moveViewport(()=>map.fitBounds(bounds as L.LatLngBoundsExpression,{padding:[40,40],maxZoom:14,animate:false}));
    }
  },[filtered,selectedId,data?.generatedAt,focusSelected,showHistorical,estimates]);

  const fitAllLocations=()=>{
    restoreViewport.current=false;
    setFocusSelected(false);
    const map=mapRef.current, bounds=filtered.map(mapPoint).filter(point=>point!==null).map(point=>[point!.latitude,point!.longitude] as L.LatLngTuple);
    if(!map||!bounds.length)return;
    if(bounds.length===1)moveViewport(()=>map.setView(bounds[0],14,{animate:false}));
    else moveViewport(()=>map.fitBounds(bounds,{padding:[40,40],maxZoom:14,animate:false}));
  };

  // Updating health observations must not clear an open popup or recenter a map the owner panned.
  useEffect(()=>{
    for(const unit of filtered){
      const marker=markersRef.current.get(unit.id);
      if(!marker)continue;
      const estimate=estimateFor(unit);
      const element=marker.getElement();if(element)element.title=unit.unitNumber+(estimate?' · Address estimate - needs verification':!hasCoords(unit)?' · Unverified historical location':' · '+unitHealthLabel(healthById.get(unit.id)));
      const popup=gpsPopup(document,unit);
      popup.append(document.createElement('br'),document.createTextNode(unit.address||'Installation address missing'),document.createElement('br'),document.createTextNode(tag(unit)+' · '+unitHealthLabel(healthById.get(unit.id))));
      marker.getElement()?.querySelector<HTMLElement>('.cos-field-pin')?.style.setProperty('--pin',cameraColors[healthById.get(unit.id)?.state||'unknown']);
      popup.append(document.createElement('br'),document.createTextNode(estimate?'Census address estimate · '+routerTime(estimate.geocodedAt)+' · '+estimate.matchedAddress:'Stored COS coordinates · '+routerTime(unit.gpsRecordedAt||null)));
      if(estimate)popup.append(document.createElement('br'),document.createTextNode('ADDRESS ESTIMATE - needs verification. Approximate site location, not live GPS; excluded from nearby results.'));
      else if(!hasCoords(unit))popup.append(document.createElement('br'),document.createTextNode('HISTORICAL LOCATION — unverified; excluded from nearby results.'));
      popup.append(document.createElement('br'),document.createTextNode('Latest camera observation: '+cameraTime(healthById.get(unit.id)?.checkedAt,cameras.now)));
      const router=routers.data?.items.find(row=>row.match==='exact_name'&&row.candidateUnit?.id===unit.id);
      if(router)popup.append(document.createElement('br'),document.createTextNode('Same-name router: '+routerLabels[routerStatus(router,routers.now)]+' · '+(router.publicIp||router.unitIp||'IP not recorded')+' · checked '+routerTime(router.checkedAt)+' · link unconfirmed, no router GPS'));
      const openPopup=marker.getPopup();
      if(openPopup){
        const autoPan=openPopup.options.autoPan;
        openPopup.options.autoPan=false;
        try{openPopup.setContent(popup);}finally{openPopup.options.autoPan=autoPan;}
      }
    }
  },[filtered,selectedId,data?.generatedAt,routers.data,routers.now,healthById,estimates]);

  useEffect(()=>{
    const map=mapRef.current;
    if(!locationWritesEnabled||!map||!pickingPin||!selected||selected.readOnly)return;
    const pick=(event:L.LeafletMouseEvent)=>{
      if(working.current)return;
      setLat(event.latlng.lat.toFixed(6));setLon(event.latlng.lng.toFixed(6));setSource('site');setAccuracy('');setConfirmedLocation(false);
      setPickingPin(false);pickingRef.current=false;setGpsMessage('Candidate pin selected. Review it against the installation address and confirm before saving.');
    };
    map.on('click',pick);map.getContainer().style.cursor='crosshair';
    return()=>{map.off('click',pick);map.getContainer().style.cursor='';};
  },[pickingPin,selectedId,locationWritesEnabled]);
  useEffect(()=>{
    const map=mapRef.current;
    if(!locationWritesEnabled||!map||!hasGpsCoordinates({latitude:lat,longitude:lon})||!selected||selected.readOnly)return;
    const marker=L.circleMarker([Number(lat),Number(lon)],{radius:10,color:'#f0bd57',fillOpacity:0.25,dashArray:'4 4'}).addTo(map).bindTooltip('Unsaved location candidate');
    return()=>{marker.remove();};
  },[lat,lon,selectedId,hasMapContainer]);
  const usePastedCoordinates=()=>{
    if(!locationWritesEnabled)return;
    try{const point=parseLocationCoordinates(coordinatePaste);setLat(String(point.latitude));setLon(String(point.longitude));setSource('site');setAccuracy('');setConfirmedLocation(false);setGpsMessage('Candidate coordinates loaded. Confirm the recorded installation address before saving.');mapRef.current?.setView([point.latitude,point.longitude],16);}
    catch(cause){setGpsMessage(cause instanceof Error?cause.message:'Coordinates could not be read.');}
  };

  const captureGps=()=>{
    if(!locationWritesEnabled || !selected || selected.readOnly || working.current)return;
    if(!('geolocation' in navigator)){show('This device does not provide browser GPS. Enter coordinates manually.');return}
    working.current=true;
    setBusy(true);
    setGpsMessage('');
    navigator.geolocation.getCurrentPosition(
      position=>{
        setLat(position.coords.latitude.toFixed(6));
        setLon(position.coords.longitude.toFixed(6));
        setAccuracy(Number(position.coords.accuracy||0).toFixed(1));
        setSource('phone_gps');
        setConfirmedLocation(false);
        working.current=false;
        setBusy(false);
        show('Current device GPS captured. Review and save it to '+selected.unitNumber+'.');
      },
      ()=>{
        working.current=false;
        setBusy(false);
        show('GPS permission was not available. Enter coordinates manually.');
      },
      {enableHighAccuracy:true,timeout:15000,maximumAge:0}
    );
  };

  const saveGps = async () => {
    if (!locationWritesEnabled || !selected || selected.readOnly || working.current || gpsSaver.current.needsRefresh || !confirmedLocation) return;
    working.current = true;
    setBusy(true);
    setGpsMessage('');
    setError('');
    try {
      const verificationNote=await locationVerificationNote(selected.address,note);
      const payload = gpsWrite({ latitude: lat, longitude: lon, accuracyM: accuracy, source, note:verificationNote }, 'owner', true);
      const saved = await gpsSaver.current.owner(selected.id, payload);
      setData(saved as unknown as Snapshot);
      const message = selected.unitNumber + ' location saved and read back successfully.';
      setGpsMessage(message);
      show(message);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'GPS location could not be verified.';
      setError(message);
      show(message);
    } finally {
      working.current = false;
      setBusy(false);
      setRefreshRequired(gpsSaver.current.needsRefresh);
    }
  };

  return <section className='field-map-workspace'>
    <section className='field-map-kpis'>
      <article><b>{data?.summary?.fieldUnits??'—'}</b><span>FIELD UNITS</span></article>
      <article><b className='green'>{data?items.filter(hasCoords).length:'—'}</b><span>VERIFIED MAP PINS</span></article>
      <article><b>{data?items.filter(unit=>healthById.get(unit.id)?.state==='online').length:'—'}</b><span>ONLINE</span></article>
      <article className={items.some(unit=>healthById.get(unit.id)?.state==='offline')?'attention':''}><b>{data?items.filter(unit=>healthById.get(unit.id)?.state==='offline').length:'—'}</b><span>OFFLINE</span></article>
    </section>

    {!!data?.placementReviews?.length&&<section className='panel' aria-label='Placement records needing review'><h3>Placement needs review ({data.placementReviews.length})</h3><p>These units remain in inventory. Their map pins are held until the unit mapping is resolved.</p><ul>{data.placementReviews.filter(row=>!search||[row.unitNumber,row.reason].some(value=>value.toLowerCase().includes(search.toLowerCase()))).map((row,index)=><li key={row.unitNumber+'-'+index}><strong>{row.unitNumber}</strong> · {row.reason} <a href={'../../camera-health.html?q='+encodeURIComponent(row.unitNumber)} target='_top'>Open Camera Health →</a></li>)}</ul></section>}
    <div className='field-map-toolbar'>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder='Search unit, customer, site, job…' aria-label='Search field units'/>
      <select value={status} onChange={e=>setStatus(e.target.value)} aria-label='Field map filter'>
        <option value='field'>Field units</option>
        <option value='all'>All returned field records</option>
        <option value='installed'>Installed</option>
        <option value='tracker'>Tracker field units</option>
        <option value='assigned'>Assigned</option>
        <option value='in_transit'>In transit</option>
        <option value='returning'>Returning</option>
        <option value='missing'>Coordinates pending</option>
      </select>
      <select value={health} onChange={e=>setHealth(e.target.value)} aria-label='Field health filter'><option value='all'>All connection / camera states</option><option value='online'>Online</option><option value='offline'>Offline</option><option value='unknown'>Stale / unknown</option></select>
      <button className='secondary' disabled={busy} onClick={()=>{void load();void routers.refresh();void cameras.refresh()}}>Refresh</button>
      <button className='secondary' disabled={busy||!filtered.some(unit=>mapPoint(unit))} onClick={fitAllLocations}>{estimates.size?'Show all map pins':'Show all verified pins'}</button>
    </div>

    <div className='field-map-nearby'>
      <label>Nearby a job / unit<select aria-label='Nearby unit center' value={nearbyId} onChange={e=>{setNearbyId(e.target.value);setFocusSelected(false)}}><option value=''>Entire field fleet</option>{items.filter(hasCoords).map(unit=><option key={unit.id} value={unit.id}>{unit.activeJobNumber?unit.activeJobNumber+' · ':''}{unit.unitNumber} · {unit.site||unit.address}</option>)}</select></label>
      <label><input type='checkbox' aria-label='Review unverified historical locations' checked={showHistorical} disabled={Boolean(nearby)} onChange={e=>setShowHistorical(e.target.checked)}/>Review unverified historical locations ({items.filter(unit=>!estimateFor(unit)&&historicalFieldCoordinates(unit)).length})</label>
      {nearby&&<label>Within<select aria-label='Nearby distance' value={radius} onChange={e=>setRadius(Number(e.target.value))}>{[5,10,25,50].map(n=><option key={n} value={n}>{n} miles</option>)}</select></label>}
    </div>
    {estimates.size>0&&<p className='field-map-estimate-notice' role='status'>{estimates.size} address estimates available as dashed EST pins outside nearby mode. Each exact address match is a Census address-range estimate that needs verification. Shared-address units use the same approximate site point. Connection colors are independent; estimates are excluded from nearby distances.</p>}
    <div className='router-map-note'><b>Unit connection and camera observations · separate locations</b><p>Sniper/CAM V green and red show recent saved IP / port connection results. Other units use reported camera/detector observations. Gray means older, missing or unmatched evidence. Service reachability does not verify video. The 20-minute presentation window allows for the 15-minute refresh cadence and timing jitter; it is not an expected heartbeat; silence is not an outage. Reported records do not establish full camera coverage. Location confidence is separate.</p><p>{data?items.filter(unit=>!hasCoords(unit)).length+' units need verified coordinates. ':''}Historical pins are excluded from the map and nearby results. Select a listed job / unit with verified coordinates to see its neighbors.</p>{cameras.data&&<p>Automatic saved-data refresh every 15 minutes while visible. Camera records refreshed {cameraTime(cameras.data.refreshedAt,cameras.now)}. {items.filter(unit=>healthById.get(unit.id)?.state==='unknown').length} units without verified current camera status.</p>}{cameras.error&&<p role='alert'>Camera Health unavailable: {cameras.error}</p>}{data?.trackerSnapshot?.importedAt&&<p>{data.trackerSnapshot.source} snapshot · imported {new Date(data.trackerSnapshot.importedAt).toLocaleString()}. Locations are recorded addresses, not live router GPS.</p>}</div>
    {error&&<div className='field-map-error' role='alert'>{error}</div>}
    {refreshRequired&&<p role='status'>Refresh the Field Map before saving GPS again.</p>}
    {gpsMessage&&<p role='status'>{gpsMessage}</p>}
    {!data&&!error?<div className='loading'>Loading production field units…</div>:<div className='field-map-layout'>
      <aside className='field-map-list' aria-label='Field units'>
        {filtered.length?filtered.map(unit=><button key={unit.id} disabled={busy} className={unit.id===selectedId?'selected':''} onClick={()=>{restoreViewport.current=false;setGpsMessage('');setFocusSelected(true);setSelectedId(unit.id)}}>
          <div><strong>{unit.unitNumber}</strong><small>{unit.modelName||'Equipment'} · {unit.status.replaceAll('_',' ')}</small></div>
          <span className={hasCoords(unit)?'mapped':'missing'}>{tag(unit)}</span>
          <small>{[unit.customer,unit.site].filter(Boolean).join(' · ')||'No installed site'}</small><small>{unit.address||(!hasCoords(unit)?'Location missing — needs follow-up':'GPS recorded')}</small><small className='field-unit-health' style={{color:cameraColors[healthById.get(unit.id)?.state||'unknown']}}>{unitHealthLabel(healthById.get(unit.id))} · Latest observation {cameraTime(healthById.get(unit.id)?.checkedAt,cameras.now)}{nearby&&distance(unit)!==null?' · '+distance(unit)!.toFixed(1)+' mi':''}</small><small>{unit.locationVerifiedAt?'Location verified '+routerTime(unit.locationVerifiedAt):'Location verification pending'}</small>
        </button>):<div className='field-map-empty'>No units match this filter.</div>}
      </aside>

      <section className='field-map-center'>
        <div ref={mapNode} className='field-map-canvas' aria-label='COS field unit map'/>
        <div className='field-map-legend'>
          <span><i style={{background:cameraColors.online}}/>Camera records online</span>
          <span><i style={{background:cameraColors.offline}}/>Camera outage observed</span>
          <span><i style={{background:cameraColors.unknown}}/>Camera status unverified</span>{estimates.size>0&&!nearby&&<span>Dashed EST pin: address estimate</span>}{showHistorical&&!nearby&&<span>Dashed OLD pin: unverified historical location</span>}
        </div>
      </section>

      <aside className='field-map-detail'>
        {selected?<><small>FIELD UNIT</small><h2>{selected.unitNumber}</h2>
          <p>{selected.modelName||'Equipment'} · <b>{selected.status.replaceAll('_',' ')}</b></p>
          <section className='field-camera-status' aria-label='Selected unit camera health'><b style={{color:cameraColors[selectedHealth?.state||'unknown']}}>{unitHealthLabel(selectedHealth)}</b><p>{selectedHealth?.reason}</p>{selectedHealth?.classification&&<p>{unitEvidenceLabel(selectedHealth.classification)} · {serviceEvidenceLabel(selectedHealth.classification.serviceState)}</p>}<p>Latest source observation: {cameraTime(selectedHealth?.checkedAt,cameras.now)}</p>{openUnitHealth&&<button onClick={()=>openUnitHealth(selected.id)}>Open Camera Health</button>}</section>
          <dl>
            <div><dt>Customer</dt><dd>{selected.customer||'—'}</dd></div>
            <div><dt>Site</dt><dd>{selected.site||'—'}</dd></div>
            <div><dt>Installation address</dt><dd>{selected.address||'Not recorded'}</dd></div>
            <div><dt>Location status</dt><dd>{tag(selected)}<br/>{selectedEstimate?'Exact matched address; approximate site location, not live GPS. Needs verification.':locationExplanation(selected)}</dd></div>
            <div><dt>Address source</dt><dd>{selected.addressSource||selected.recordSource||(selected.installedSiteId?'Installed site record':'Not recorded')}</dd></div>
            <div><dt>Location verified</dt><dd>{selected.locationVerifiedAt?routerTime(selected.locationVerifiedAt):'Not yet verified for this address'}</dd></div>
            <div><dt>Active job</dt><dd>{selected.activeJobNumber||'—'}</dd></div>
            <div><dt>Map source</dt><dd>{selectedEstimate?'U.S. Census address-range estimate':sourceLabel(selected.coordinateSource)}</dd></div>
            <div><dt>Last unit GPS</dt><dd>{selected.gpsRecordedAt?new Date(selected.gpsRecordedAt).toLocaleString():'Not recorded'}</dd></div>
            {selected.recordSource && <div><dt>Location record</dt><dd>{selected.recordSource}</dd></div>}
            {selected.readOnly && <div><dt>Placement verified</dt><dd>{selected.sourceVerifiedAt?new Date(selected.sourceVerifiedAt).toLocaleString():'Not recorded'}</dd></div>}
          </dl>

          <section className='field-router-context' aria-label='Router context for selected unit'><h3>InHand router context</h3><p>Router checks do not supply live locations.</p>{openWorkspace&&<button className='secondary' onClick={()=>openWorkspace('InHand Routers')}>View all InHand routers</button>}
            {!routers.data ? <p>{routers.error?'Router data could not be verified.':'Loading router records…'}</p> : selectedRouters.length ? selectedRouters.map(row=><div key={row.id}><RouterBadge row={row} now={routers.now}/><p>{row.name} · {row.publicIp||row.unitIp||'IP not recorded'}{row.port?' · port '+row.port:''}</p><p>Checked: {routerTime(row.checkedAt)}</p><p>Same-name match only. Router-to-unit link is unconfirmed. No router GPS.</p></div>) : <p>No unique same-name router is available for this COS unit. Nothing is automatically assigned from aliases or duplicate names.</p>}
          </section>
          {selected.locationGeocode&&!selectedEstimate&&<section aria-label='Automatic address lookup'><h3>Automatic address lookup</h3><p role='status'>{locationExplanation(selected)}</p>{openUnitHealth&&<button className='secondary' onClick={()=>openUnitHealth(selected.id)}>Open Camera Health to correct address</button>}</section>}
          {selectedEstimate&&<section className='field-map-estimate-detail' aria-label='Address estimate'><h3>Address estimate - needs verification</h3><p>{selectedEstimate.matchedAddress}</p><p>{selectedEstimate.latitude}, {selectedEstimate.longitude} · Source result {routerTime(selectedEstimate.geocodedAt)}</p><p>This is an interpolated address point, not a verified unit position. Units sharing this address share this approximate location.</p></section>}
          {!selectedEstimate&&historicalFieldCoordinates(selected)&&<details className='field-map-historical'><summary>Historical coordinates (excluded from current map)</summary><p>{historicalFieldCoordinates(selected)!.latitude}, {historicalFieldCoordinates(selected)!.longitude} · {historicalFieldCoordinates(selected)!.source}</p><p>Do not use for routing until the current installation address has been verified.</p></details>}
          <div className='field-map-coordinate-form'>
            {selected.readOnly ? <><h3>Tracker location</h3><p>This tracker record does not have a unique registered equipment match. Correct its address in the source tracker; register or resolve the unit identity before saving a pin here.</p>{addressEstimateHumanNote(selected.locationNote) && <p role='alert'>{addressEstimateHumanNote(selected.locationNote)}</p>}{hasCoords(selected) && <p>Imported coordinates retain their original source. Their GPS observation date is not recorded.</p>}</> : !locationWritesEnabled ? <><h3>Location verification</h3><p role='status'>Verified location editing is not enabled for this backend yet. Existing addresses and location history remain available; no GPS save can be submitted from this view.</p></> : <>
            <h3>Verify or update location</h3>
            <p>Check the installation address above, look it up if needed, then enter the pin coordinates or capture your device GPS while on site. Saving records your verification time and location history.</p>
            <label>Paste coordinates or a Google Maps point link<input disabled={busy} value={coordinatePaste} onChange={e=>setCoordinatePaste(e.target.value)} placeholder='Latitude, longitude'/></label><div className='field-map-actions'><button className='secondary' disabled={busy||!coordinatePaste.trim()} onClick={usePastedCoordinates}>Use pasted coordinates</button><button className='secondary' disabled={busy} aria-pressed={pickingPin} onClick={()=>{pickingRef.current=!pickingPin;setPickingPin(!pickingPin)}}>{pickingPin?'Cancel pin selection':'Choose pin on map'}</button></div>{pickingPin&&<p role='status'>Click the map at the verified installation address. This selects an unsaved candidate only.</p>}
            <div className='field-map-coordinate-grid'>
              <label>Latitude<input disabled={busy} inputMode='decimal' value={lat} onChange={e=>{setLat(e.target.value);setConfirmedLocation(false)}} placeholder='29.760400'/></label>
              <label>Longitude<input disabled={busy} inputMode='decimal' value={lon} onChange={e=>{setLon(e.target.value);setConfirmedLocation(false)}} placeholder='-95.369800'/></label>
              <label>Accuracy (meters)<input disabled={busy} inputMode='decimal' value={accuracy} onChange={e=>setAccuracy(e.target.value)} placeholder='Optional'/></label>
              <label>Source<select aria-label='Location source' disabled={busy} value={source} onChange={e=>{setSource(e.target.value);setConfirmedLocation(false)}}><option value='manual'>Manual</option><option value='site'>Verified address pin</option><option value='phone_gps'>Phone GPS</option><option value='device_gps'>Device GPS</option><option value='router'>Router</option><option value='import'>Import</option></select></label>
            </div>
            <label>Verification note<input disabled={busy} value={note} onChange={e=>setNote(e.target.value)} placeholder='Pole, gate, entrance, move reason…'/></label>
            <label className='field-map-confirm'><input type='checkbox' disabled={busy||!selected.address?.trim()} checked={confirmedLocation} onChange={e=>setConfirmedLocation(e.target.checked)}/>I checked that these coordinates match {selected.unitNumber}{selected.address?.trim()?' at the recorded installation address':''}.</label>
            <div className='field-map-actions'>
              <button className='secondary' disabled={busy} onClick={captureGps}>Use My Current GPS</button>
              <button disabled={busy||refreshRequired||!confirmedLocation||!selected.address?.trim()} onClick={()=>void saveGps()}>{busy?'Saving…':'Save verified location'}</button>
            </div>
            </>}
            {installationAddressLink(selected)&&<a className='field-map-open' href={installationAddressLink(selected)!} target='_blank' rel='noopener noreferrer'>Look up recorded installation address ↗</a>}
            {hasCoords(selected)&&locationLink(selected)&&<a className='field-map-open' href={locationLink(selected)!} target='_blank' rel='noopener noreferrer'>{hasCoords(selected)?'Open verified installation pin in Google Maps':'Open installed address in Google Maps'} ↗</a>}{!hasCoords(selected)&&!selectedEstimate&&<p role='status'>{selected.address?.trim()?'Installed address available. A map pin needs verified coordinates.':'GPS and installed address are missing. Add the unit location for follow-up.'}</p>}
          </div>

          {!selected.readOnly && <div className='field-map-history'>
            <h3>GPS history</h3>
            {historyError ? <p role='alert'>{historyError}</p> : historyLoading ? <p role='status'>Loading GPS history…</p> : history.length?history.slice(0,8).map(row=><div key={row.id}><b>{Number(row.latitude).toFixed(6)}, {Number(row.longitude).toFixed(6)}</b><small>{sourceLabel(row.source)} · {new Date(row.recordedAt).toLocaleString()}{row.recordedBy?' · '+row.recordedBy:''}</small>{row.note&&<span>{locationHistoryNote(row.note)}</span>}</div>):<p>No unit-level GPS history yet.</p>}
          </div>}
        </>:<div className='field-map-empty'>Select a field unit.</div>}
      </aside>
    </div>}
    <footer className='field-map-footer'>Map tiles © OpenStreetMap contributors. Unit GPS is operational location data only and never changes equipment lifecycle placement automatically.</footer>
  </section>;
}

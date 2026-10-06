import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { locationLink } from './visionAreas';
import { useRouters } from './useRouters';
import { RouterBadge, routerTime } from './RouterWorkspace';
import { routerLabels, routerStatus } from '../../supabase/functions/cos-operations-pages/routers';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './fieldMap.css';
import { gpsWrite, hasGpsCoordinates } from '../shared/gpsValidation';
import { checkedFieldMap, createGpsSaver, gpsPopup } from './gpsPersistence';

type FieldUnit = {
  id:string;
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
};

type Snapshot = {
  items:FieldUnit[];
  summary:{fieldUnits:number;mappedUnits:number;unitGps:number;missingGps:number};
  generatedAt:string;
};

type Props = { show:(message:string)=>void; initialUnitId?:string; openWorkspace?:(name:string)=>void };

const hasCoords = (unit: FieldUnit) => hasGpsCoordinates(unit);
const statusColor=(status:string)=>status==='installed'?'#35d48a':status==='in_transit'?'#f0bd57':status==='returning'?'#ff8b5c':'#56b8ff';
const sourceLabel=(source?:string|null)=>source?source.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase()):'No coordinates';

export default function FieldMap({show,initialUnitId='',openWorkspace}:Props){
  const routers=useRouters();
  const [data,setData]=useState<Snapshot|null>(null);
  const [error,setError]=useState('');
  const [search,setSearch]=useState('');
  const [status,setStatus]=useState('field');
  const [selectedId,setSelectedId]=useState('');
  const [lat,setLat]=useState('');
  const [lon,setLon]=useState('');
  const [accuracy,setAccuracy]=useState('');
  const [source,setSource]=useState('manual');
  const [note,setNote]=useState('');
  const [busy,setBusy]=useState(false);
  const [refreshRequired,setRefreshRequired]=useState(false);
  const [history,setHistory]=useState<any[]>([]);
  const [historyError,setHistoryError]=useState('');
  const [historyLoading,setHistoryLoading]=useState(false);
  const [gpsMessage,setGpsMessage]=useState('');
  const working = useRef(false);
  const gpsSaver = useRef(createGpsSaver(api));
  const hasMapContainer = Boolean(data || error);
  const mapNode=useRef<HTMLDivElement|null>(null);
  const mapRef=useRef<L.Map|null>(null);
  const layerRef=useRef<L.LayerGroup|null>(null);
  const markersRef=useRef(new Map<string,L.Marker>());

  const load=async()=>{
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    try{
      const response=await api.get('/api/field-map');
      const snapshot = checkedFieldMap(response.data) as unknown as Snapshot;
      setData(snapshot);
      gpsSaver.current.acknowledgeRefresh(snapshot);
      setRefreshRequired(gpsSaver.current.needsRefresh);
      const first = snapshot.items.find(unit => unit.id === initialUnitId) || snapshot.items.find(hasCoords) || snapshot.items[0];
      if (initialUnitId && !snapshot.items.some(unit => unit.id === initialUnitId)) show('The same-name COS unit is not in the field map records. No router GPS is available.');
      setSelectedId(current => snapshot.items.some(unit => unit.id === current) ? current : first?.id || '');
    }catch(e:any){
      setError(e?.response?.data?.error||e?.message||'Field Map could not be loaded.');
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  useEffect(()=>{void load()},[]);

  const items=data?.items||[];
  const selected=items.find(x=>x.id===selectedId)||null;
  const selectedRouters=routers.data?.items.filter(row=>row.match==='exact_name' && row.candidateUnit?.id===selectedId)||[];
  const filtered=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return items.filter(unit=>{
      const text=[unit.unitNumber,unit.modelName,unit.customer,unit.site,unit.activeJobNumber,unit.address].filter(Boolean).join(' ').toLowerCase();
      const statusOk=status==='all'||(status==='field'&&['assigned','in_transit','installed','returning'].includes(unit.status))||status===unit.status||status==='missing'&&!hasCoords(unit);
      return statusOk&&(!q||text.includes(q));
    });
  },[items,search,status]);

  useEffect(()=>{
    if(!selected)return;
    setLat(hasCoords(selected)?String(selected.latitude):'');
    setLon(hasCoords(selected)?String(selected.longitude):'');
    setAccuracy(selected.gpsAccuracyM == null ? '' : String(selected.gpsAccuracyM));
    setSource(selected.hasUnitGps?(selected.coordinateSource||'manual'):'manual');
    setNote('');
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
    const map=L.map(mapNode.current,{zoomControl:true}).setView([29.7604,-95.3698],8);
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
    const mapped=filtered.filter(hasCoords);
    const bounds:L.LatLngExpression[]=[];
    for(const unit of mapped){
      const latitude=Number(unit.latitude);
      const longitude=Number(unit.longitude);
      bounds.push([latitude,longitude]);
      const marker=L.marker([latitude,longitude],{
        icon:L.divIcon({
          className:'cos-field-pin-wrap',
          html:'<span class="cos-field-pin" style="--pin:'+statusColor(unit.status)+'"><b>'+unit.unitNumber.replace(/[<>&"']/g,'')+'</b></span>',
          iconSize:[54,38],
          iconAnchor:[27,34]
        })
      });
      marker.bindPopup(gpsPopup(document, unit));
      markersRef.current.set(unit.id,marker);
      marker.on('click',()=>{ if (!working.current) setSelectedId(unit.id); });
      marker.addTo(layer);
    }
    if(selected&&hasCoords(selected)){
      map.setView([Number(selected.latitude),Number(selected.longitude)],Math.max(map.getZoom(),14));
    }else if(bounds.length===1){
      map.setView(bounds[0],14);
    }else if(bounds.length>1){
      map.fitBounds(bounds as L.LatLngBoundsExpression,{padding:[40,40],maxZoom:14});
    }
  },[filtered,selectedId,data?.generatedAt]);

  // Updating router observations must not clear an open popup or recenter a map the owner panned.
  useEffect(()=>{
    for(const unit of filtered){
      const marker=markersRef.current.get(unit.id);
      if(!marker)continue;
      const popup=gpsPopup(document,unit);
      popup.append(document.createElement('br'),document.createTextNode('Stored COS coordinates · '+routerTime(unit.gpsRecordedAt||null)));
      const router=routers.data?.items.find(row=>row.match==='exact_name'&&row.candidateUnit?.id===unit.id);
      if(router)popup.append(document.createElement('br'),document.createTextNode('Same-name router: '+routerLabels[routerStatus(router,routers.now)]+' · '+(router.publicIp||router.unitIp||'IP not recorded')+' · checked '+routerTime(router.checkedAt)+' · link unconfirmed, no router GPS'));
      const openPopup=marker.getPopup();
      if(openPopup){
        const autoPan=openPopup.options.autoPan;
        openPopup.options.autoPan=false;
        try{openPopup.setContent(popup);}finally{openPopup.options.autoPan=autoPan;}
      }
    }
  },[filtered,selectedId,data?.generatedAt,routers.data,routers.now]);

  const captureGps=()=>{
    if(!selected || working.current)return;
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
    if (!selected || working.current || gpsSaver.current.needsRefresh) return;
    working.current = true;
    setBusy(true);
    setGpsMessage('');
    setError('');
    try {
      const payload = gpsWrite({ latitude: lat, longitude: lon, accuracyM: accuracy, source, note }, 'owner', true);
      const saved = await gpsSaver.current.owner(selected.id, payload);
      setData(saved as unknown as Snapshot);
      const message = selected.unitNumber + ' GPS location saved and verified.';
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
      <article><b className='green'>{data?.summary?.mappedUnits??'—'}</b><span>ON MAP</span></article>
      <article><b>{data?.summary?.unitGps??'—'}</b><span>UNIT GPS</span></article>
      <article className={(data?.summary?.missingGps||0)>0?'attention':''}><b>{data?.summary?.missingGps??'—'}</b><span>MISSING GPS</span></article>
    </section>

    <div className='field-map-toolbar'>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder='Search unit, customer, site, job…' aria-label='Search field units'/>
      <select value={status} onChange={e=>setStatus(e.target.value)} aria-label='Field map filter'>
        <option value='field'>Field units</option>
        <option value='all'>All returned field records</option>
        <option value='installed'>Installed</option>
        <option value='assigned'>Assigned</option>
        <option value='in_transit'>In transit</option>
        <option value='returning'>Returning</option>
        <option value='missing'>Missing GPS</option>
      </select>
      <button className='secondary' disabled={busy} onClick={()=>void load()}>Refresh</button>
    </div>

    <div className='router-map-note'><b>Router GPS feed not connected</b><p>Map pins show stored COS coordinates with their original source and timestamp. Router IPs and port checks do not supply live locations.</p>{routers.error&&<p role='alert'>Router information unavailable: {routers.error}</p>}{openWorkspace&&<button className='secondary' onClick={()=>openWorkspace('InHand Routers')}>View all InHand routers</button>}</div>
    {error&&<div className='field-map-error' role='alert'>{error}</div>}
    {refreshRequired&&<p role='status'>Refresh the Field Map before saving GPS again.</p>}
    {gpsMessage&&<p role='status'>{gpsMessage}</p>}
    {!data&&!error?<div className='loading'>Loading production field units…</div>:<div className='field-map-layout'>
      <aside className='field-map-list' aria-label='Field units'>
        {filtered.length?filtered.map(unit=><button key={unit.id} disabled={busy} className={unit.id===selectedId?'selected':''} onClick={()=>{setGpsMessage('');setSelectedId(unit.id)}}>
          <div><strong>{unit.unitNumber}</strong><small>{unit.modelName||'Equipment'} · {unit.status.replaceAll('_',' ')}</small></div>
          <span className={hasCoords(unit)?'mapped':'missing'}>{hasCoords(unit)?'MAP':unit.address?.trim()?'ADDRESS':'LOCATION?'}</span>
          <small>{[unit.customer,unit.site].filter(Boolean).join(' · ')||'No installed site'}</small><small>{unit.address||(!hasCoords(unit)?'Location missing — needs follow-up':'GPS recorded')}</small>
        </button>):<div className='field-map-empty'>No units match this filter.</div>}
      </aside>

      <section className='field-map-center'>
        <div ref={mapNode} className='field-map-canvas' aria-label='COS field unit map'/>
        <div className='field-map-legend'>
          <span><i style={{background:'#35d48a'}}/>Installed</span>
          <span><i style={{background:'#56b8ff'}}/>Assigned</span>
          <span><i style={{background:'#f0bd57'}}/>In transit</span>
          <span><i style={{background:'#ff8b5c'}}/>Returning</span>
        </div>
      </section>

      <aside className='field-map-detail'>
        {selected?<><small>FIELD UNIT</small><h2>{selected.unitNumber}</h2>
          <p>{selected.modelName||'Equipment'} · <b>{selected.status.replaceAll('_',' ')}</b></p>
          <dl>
            <div><dt>Customer</dt><dd>{selected.customer||'—'}</dd></div>
            <div><dt>Site</dt><dd>{selected.site||'—'}</dd></div>
            <div><dt>Address</dt><dd>{selected.address||'—'}</dd></div>
            <div><dt>Active job</dt><dd>{selected.activeJobNumber||'—'}</dd></div>
            <div><dt>Map source</dt><dd>{sourceLabel(selected.coordinateSource)}</dd></div>
            <div><dt>Last unit GPS</dt><dd>{selected.gpsRecordedAt?new Date(selected.gpsRecordedAt).toLocaleString():'Not recorded'}</dd></div>
          </dl>

          <section className='field-router-context' aria-label='Router context for selected unit'><h3>InHand router context</h3>
            {!routers.data ? <p>{routers.error?'Router data could not be verified.':'Loading router records…'}</p> : selectedRouters.length ? selectedRouters.map(row=><div key={row.id}><RouterBadge row={row} now={routers.now}/><p>{row.name} · {row.publicIp||row.unitIp||'IP not recorded'}{row.port?' · port '+row.port:''}</p><p>Checked: {routerTime(row.checkedAt)}</p><p>Same-name match only. Router-to-unit link is unconfirmed. No router GPS.</p></div>) : <p>No unique same-name router is available for this COS unit. Nothing is automatically assigned from aliases or duplicate names.</p>}
          </section>
          <div className='field-map-coordinate-form'>
            <h3>Update unit GPS</h3>
            <p>Coordinates only. This does not change site, unit status, FIELD/ROOT/shop placement, or job assignment.</p>
            <div className='field-map-coordinate-grid'>
              <label>Latitude<input disabled={busy} inputMode='decimal' value={lat} onChange={e=>setLat(e.target.value)} placeholder='29.760400'/></label>
              <label>Longitude<input disabled={busy} inputMode='decimal' value={lon} onChange={e=>setLon(e.target.value)} placeholder='-95.369800'/></label>
              <label>Accuracy (meters)<input disabled={busy} inputMode='decimal' value={accuracy} onChange={e=>setAccuracy(e.target.value)} placeholder='Optional'/></label>
              <label>Source<select disabled={busy} value={source} onChange={e=>setSource(e.target.value)}><option value='manual'>Manual</option><option value='phone_gps'>Phone GPS</option><option value='device_gps'>Device GPS</option><option value='router'>Router</option><option value='import'>Import</option></select></label>
            </div>
            <label>Note<input disabled={busy} value={note} onChange={e=>setNote(e.target.value)} placeholder='Pole, gate, entrance, move reason…'/></label>
            <div className='field-map-actions'>
              <button className='secondary' disabled={busy} onClick={captureGps}>Use My Current GPS</button>
              <button disabled={busy||refreshRequired} onClick={()=>void saveGps()}>{busy?'Saving…':'Save Unit GPS'}</button>
            </div>
            {locationLink(selected)&&<a className='field-map-open' href={locationLink(selected)!} target='_blank' rel='noopener noreferrer'>{hasCoords(selected)?'Open this unit GPS in Google Maps':'Open installed address in Google Maps'} ↗</a>}{!hasCoords(selected)&&<p role='status'>{selected.address?.trim()?'Installed address available. A map pin needs verified coordinates.':'GPS and installed address are missing. Add the unit location for follow-up.'}</p>}
          </div>

          <div className='field-map-history'>
            <h3>GPS history</h3>
            {historyError ? <p role='alert'>{historyError}</p> : historyLoading ? <p role='status'>Loading GPS history…</p> : history.length?history.slice(0,8).map(row=><div key={row.id}><b>{Number(row.latitude).toFixed(6)}, {Number(row.longitude).toFixed(6)}</b><small>{sourceLabel(row.source)} · {new Date(row.recordedAt).toLocaleString()}{row.recordedBy?' · '+row.recordedBy:''}</small>{row.note&&<span>{row.note}</span>}</div>):<p>No unit-level GPS history yet.</p>}
          </div>
        </>:<div className='field-map-empty'>Select a field unit.</div>}
      </aside>
    </div>}
    <footer className='field-map-footer'>Map tiles © OpenStreetMap contributors. Unit GPS is operational location data only and never changes equipment lifecycle placement automatically.</footer>
  </section>;
}

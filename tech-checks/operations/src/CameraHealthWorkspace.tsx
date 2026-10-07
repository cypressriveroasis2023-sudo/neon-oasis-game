import { useCallback,useEffect,useRef,useState } from 'react';
import { api,openLegacy } from './api';
import { checkedFieldMap } from './gpsPersistence';
import { fieldCameraHealth,cameraColors,unitHealthLabel,unitDiagnosticsPath,cameraTime,type FieldHealthUnit } from './fieldCameraHealth';
import { useCameraHealth } from './useCameraHealth';
import CameraHealthOverview,{CameraResourceObservations,UnitEvidenceDetails} from './CameraHealthOverview';
export { validateCameraHealth } from './fieldCameraHealth';
type Props={initialUnitId?:string;backToMap?:(unitId:string)=>void;createTicket?:(type:'SERVICE'|'PICKUP'|'DELIVERY'|'SWAP',unitId:string)=>void};
export default function CameraHealthWorkspace({initialUnitId='',backToMap,createTicket}:Props){
  const {data:health,error,loading,refresh,now}=useCameraHealth();
  const [units,setUnits]=useState<FieldHealthUnit[]|null>(null),[unitError,setUnitError]=useState(''),[ticketType,setTicketType]=useState<'SERVICE'|'PICKUP'|'DELIVERY'|'SWAP'>('SERVICE');
  const revision=useRef(0);
  const loadUnits=useCallback(async()=>{
    const request=++revision.current;setUnits(null);setUnitError('');
    try{const snapshot=checkedFieldMap((await api.get('/api/field-map')).data);if(request===revision.current)setUnits(snapshot.items as unknown as FieldHealthUnit[]);}
    catch(cause){if(request===revision.current)setUnitError(cause instanceof Error?cause.message:'Field unit could not be verified.');}
  },[initialUnitId]);
  useEffect(()=>{void loadUnits();setTicketType('SERVICE');return()=>{revision.current++;};},[loadUnits]);
  const selected=units?.find(unit=>unit.id===initialUnitId);
  const detail=selected?fieldCameraHealth(selected,units||[],health,now):null;
  const rows=initialUnitId?detail?.rows||[]:health?.rows||[];
  return <section className='panel module camera-health-native' aria-label='Camera Health'>
    <div className='panelhead'><div><h2>Camera Health</h2><span>{selected?selected.unitNumber:'Camera Health source observations'}</span></div><div className='purchase-actions'>{initialUnitId&&backToMap&&<button className='secondary' onClick={()=>backToMap(initialUnitId)}>Back to Field Map</button>}<button disabled={loading} onClick={()=>{void refresh();void loadUnits();}}>{loading?'Refreshing…':'Refresh Camera Health'}</button><button className='secondary' onClick={()=>openLegacy('camera-health')}>Open Camera Health diagnostics</button></div></div>
    {error&&<div className='operations-error' role='alert'>{error} Current camera state cannot be verified.</div>}
    {unitError&&<div className='operations-error' role='alert'>{unitError}</div>}
    {initialUnitId&&<section className='camera-unit-detail' aria-label='Selected field unit Camera Health'>
      {!units&&!unitError?<p role='status'>Verifying the selected field unit…</p>:!selected?<p role='alert'>This unit is not in the current field records. Return to the map and select a current unit.</p>:<>
        <h3>{selected.unitNumber}</h3><p>{[selected.customer,selected.site].filter(Boolean).join(' · ')||'Customer / site not linked'}</p><p>{selected.address||'Installation address not recorded'}</p>
        <b className={'camera-unit-state camera-status-'+(detail?.state||'unknown')} style={{color:cameraColors[detail?.state||'unknown']}}>{unitHealthLabel(detail)}</b><p>{detail?.reason}</p>
        <UnitEvidenceDetails classification={detail?.classification||null}/><p>Latest source observation: {cameraTime(detail?.checkedAt,now)}. Review each device below for stale or missing observations.</p>
        {detail?.identity==='matched'&&<p>Matched by unique equipment family and unit number. Camera Health unit: <b>{detail.unitKey}</b>. No persistent cross-system association is created.</p>}
        {createTicket&&<section className='camera-unit-ticket' aria-label='Create ticket for selected field unit'><h4>Create a ticket</h4><label>Work needed<select aria-label='Camera unit ticket type' value={ticketType} onChange={event=>setTicketType(event.target.value as typeof ticketType)}><option value='SERVICE'>Service / repair</option><option value='PICKUP'>Pick up</option><option value='DELIVERY'>Install / Delivery</option><option value='SWAP'>Swap out</option></select></label><button onClick={()=>createTicket(ticketType,selected.id)}>Create ticket</button><p>Review the ticket before saving. Customer and site are filled only when current Operations records verify them; the unit is a ticket reference, not an equipment assignment.</p>{selected.readOnly&&<p>This tracker-only unit needs manual customer / site selection unless its registered equipment identity is resolved.</p>}</section>}
      </>}
    </section>}
    {!health&&!error?<p role='status'>Loading Camera Health…</p>:health&&<>
      {!initialUnitId&&<CameraHealthOverview health={health} now={now} units={units} createTicket={createTicket}/>}
      {initialUnitId&&<>
      <p>The 15-minute window marks recent observations; it is not an expected heartbeat or proof of outage. Last reported states and their ages remain below. Refresh reads saved observations and does not run a probe.</p><p>Records refreshed: <b>{cameraTime(health.refreshedAt,now)}</b> · Source refresh every minute</p>
      <CameraResourceObservations rows={rows} now={now} trusted={health.evidenceVersion===2}/>
      </>}
      {initialUnitId&&selected&&!rows.length&&<p>No matching saved camera record is available for this field unit. {unitDiagnosticsPath(selected)&&<a href={unitDiagnosticsPath(selected)!} target='_blank' rel='noopener noreferrer'>Find this unit in Camera Health diagnostics ↗</a>}</p>}
    </>}
  </section>;
}

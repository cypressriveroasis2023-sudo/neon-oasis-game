import FleetCardIcon from './FleetCardIcon';
import {vrmPortalUrl} from '../../supabase/functions/cos-operations-pages/vrm';
import FleetCameraTools from './FleetCameraTools';
import {cameraColors,cameraTime,unitHealthLabel} from './fieldCameraHealth';
import {powerTimestamp} from './cameraEvidence';
import {healthObservationLabel} from './healthObservationTime';
import {inhandRouterReading} from './inhandRouterStatus';
import type {FleetDashboardRow,Signal} from './fleetDashboardModel';
import FleetBatterySummary from './FleetBatterySummary';
import LastKnownCameraStatus from './LastKnownCameraStatus';
import type {LastKnownCamera} from './cameraLastKnown';

const stateLabels:Record<Signal,string>={online:'Online',offline:'Offline',unknown:'Unverified',support:'Solar support',not_available:'Not available'};
const powerLabels:Record<string,string>={solar_power:'Solar output',load_power:'DC system load',battery_power:'Battery power',battery_voltage:'Battery voltage',battery_current:'Battery current',low_voltage_alarm:'Low voltage alarm',low_soc_alarm:'Low charge alarm',high_voltage_alarm:'High voltage alarm'};
const sourceLabel=(source:string,instance:number)=>`${source==='solarcharger'?'Solar charger':source==='system'?'System':'Battery'} ${instance}`;
function Status({state,label,color}:{state:Signal;label?:string;color?:string|null}){return <span className={'cos-fleet-badge cos-signal-'+state} style={color?{color}:undefined}><i aria-hidden='true'>●</i>{label||stateLabels[state]}</span>;}

/** Present only the already reconciled row. This card never fetches or associates devices. */
export default function FleetUnitHealth({row,now,editing=false,lastKnown=null}:{row:FleetDashboardRow;now:number;editing?:boolean;lastKnown?:LastKnownCamera|null}){
 const metrics=row.power?.measurements.filter(m=>m.metric in powerLabels)||[];
 const recent=row.batteryReadIssue?[]:metrics.filter(m=>powerTimestamp(m.observedAt,now).fresh);
 return <><FleetCameraTools key={row.id} row={row}/><div className='cos-fleet-unit-health-grid'>
  <section className='cos-fleet-unit-health-section cos-fleet-camera-card' aria-label={editing?'Unit health signals':'Selected unit camera health'}>
   <h3><FleetCardIcon kind="camera"/>Camera health</h3><b className={'camera-unit-state cos-fleet-badge camera-status-'+row.cameraState+' cos-signal-'+row.cameraState} style={{color:cameraColors[row.camera.state]}}>{unitHealthLabel(row.camera)}</b>
   <small>{healthObservationLabel(row.camera.basis,row.camera.state)}: {cameraTime(row.camera.checkedAt,now)}</small>
   <LastKnownCameraStatus observation={lastKnown} now={now}/>
   <details><summary>{row.cameraState==='unknown'?'Why is this unverified?':'Camera source details'}</summary><p>{row.camera.reason}</p><p>Camera troubleshooting contains the matched devices and saved checks.</p></details>
  </section>
  <section className='cos-fleet-unit-health-section cos-fleet-router-card' aria-label='Selected unit router health'>
   <h3><FleetCardIcon kind="router"/>Router &amp; connection</h3><Status state={row.routerState} label={row.routerLabel} color={row.routerColor}/>
   {row.routers.length>0&&<small>InHand live status. Camera health is separate.</small>}
   {row.routers.length?<div className="cos-router-readable">{row.routers.map(router=>{
    const reading=inhandRouterReading({placement:row.placement,matched:true,routerType:(router as {routerType?:string|null}).routerType,model:router.model,reportedStatus:router.reportedStatus,reportedAt:router.reportedAt,statusSource:router.reportedSource},now);
    return <article key={router.id}>
    <strong>{router.name}{router.model?' · '+router.model:''}</strong>
    <p style={reading.color?{color:reading.color}:undefined}>{reading.label} · {cameraTime(router.reportedAt,now)}</p>
    <small>Exact unit key only. A MOFI or Cradlepoint router, a stale reading, or a missing feed stays Unknown.</small>
    <details><summary>Router source evidence</summary><p>InHand reported time: {cameraTime(router.reportedAt,now)}.</p><p>Feed: {router.reportedSource||'Not recorded'}.</p><p>This reading does not establish camera or video health, and it supplies no GPS.</p></details>
   </article>;})}</div>:<p>Unknown. No exact InHand router is linked to this unit.</p>}
  </section>
  <section className='cos-fleet-unit-health-section cos-fleet-power-card' aria-label='Selected unit power'>
   <h3><FleetCardIcon kind='battery'/>{row.family==='RECON2'?'Reconeyez battery':row.family==='HELIOS'?'Battery · Victron':'Power'}</h3>
   {row.power&&<><small>Victron installation #{row.power.installationId}</small><a className='cos-card-pill' href={vrmPortalUrl(row.power.installationId)} target='_blank' rel='noopener noreferrer'><FleetCardIcon kind='battery'/>Open Victron ↗</a></>}
   {row.batteryState==='not_available'?<p>Power measurements are not available for this unit family.</p>:<FleetBatterySummary row={row} now={now}/>}
   {row.family==='HELIOS'&&<>
    <dl className='cos-fleet-power-metrics' aria-label='Recent power measurements'>{['battery_voltage','battery_current','solar_power','load_power','battery_power'].map(metric=>{
     const readings=recent.filter(m=>m.metric===metric);
     return <div key={metric}><dt>{powerLabels[metric]}</dt><dd>{readings.length?readings.map(m=><span key={m.source+'|'+m.instance}><strong>{m.value} {m.unit}</strong><small>{sourceLabel(m.source,m.instance)} · {cameraTime(m.observedAt,now)}</small></span>):<span className='cos-signal-unknown'>Unverified</span>}</dd></div>;
    })}</dl>
    <small>W = watts. DC system load is the reported DC load, not total site consumption. Separate source readings are not added together.</small>
    {metrics.length>0&&<details className='cos-fleet-power-evidence'><summary>All saved power readings</summary><dl>{metrics.map((m,index)=><div key={m.metric+'|'+m.source+'|'+m.instance+'|'+index}><dt>{powerLabels[m.metric]} · {sourceLabel(m.source,m.instance)}</dt><dd>{m.unit==='state'?(m.value>0?'Alarm '+m.value:'No alarm reported'):m.value+' '+m.unit} · {row.batteryReadIssue?'Current reading unverified':powerTimestamp(m.observedAt,now).fresh?'Recent observation':'Stale / unverified'}<small>Measured {cameraTime(m.observedAt,now)}</small></dd></div>)}</dl><p>Signed battery values retain the source reading. They do not establish remaining runtime.</p></details>}
   </>}
  </section>
 </div></>;
}

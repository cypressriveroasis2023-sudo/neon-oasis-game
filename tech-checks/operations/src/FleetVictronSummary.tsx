import VrmReadOnlyDashboard from './VrmReadOnlyDashboard';
import {cameraTime} from './fieldCameraHealth';
import {cameraTimestamp} from './cameraEvidence';
import {vrmPortalUrl} from '../../supabase/functions/cos-operations-pages/vrm';
import type {FleetDashboardRow} from './fleetDashboardModel';

const labels:Record<string,string>={battery_voltage:'Battery voltage',battery_current:'Battery current',battery_power:'Battery power',solar_power:'Solar output',load_power:'DC system load',low_voltage_alarm:'Low voltage alarm',low_soc_alarm:'Low charge alarm',high_voltage_alarm:'High voltage alarm'};

/** Keep the exact installation's energy dashboard inside its Helios card. */
export default function FleetVictronSummary({row,now}:{row:FleetDashboardRow;now:number}){
 const measurements=row.power?.measurements||[];
 if(!row.power)return <div className='cos-helios-victron'><strong>Victron</strong><small>{row.batteryReadIssue||'No unique Victron installation linked'}</small></div>;
 const newest=(metric:string)=>measurements.filter(item=>item.metric===metric).sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt))[0];
 const compact=['solar_power','load_power','battery_voltage'].map(metric=>({metric,item:newest(metric)})).filter(entry=>entry.item);
 return <div className='cos-helios-victron'>
  <strong>Victron #{row.power.installationId}</strong>
  <small role='status'>{row.vrmInstallation?.sharingEnabled===true?'Dashboard sharing enabled':row.vrmInstallation?.sharingEnabled===false?'Dashboard sharing disabled':'Dashboard sharing not yet verified'} · last sync {cameraTime(row.vrmInstallation?.lastSeenAt,now)}</small>
  {row.vrmInstallation&&<VrmReadOnlyDashboard unit={row.vrmInstallation} rows={[row.power]} now={now} readFailed={Boolean(row.batteryReadIssue)} embedded/>}
  {row.vrmInstallation?.embedUrl?<details className='cos-helios-shared-dashboard'><summary>Open shared Victron dashboard inside this card</summary><iframe title={row.displayName+' shared Victron dashboard'} src={row.vrmInstallation.embedUrl} loading='lazy' sandbox='allow-scripts allow-same-origin allow-forms allow-popups' referrerPolicy='no-referrer' allowFullScreen/><small>Approved dashboard link available. Victron controls its refresh interval; a sign-in or access error does not mean this unit is offline.</small></details>:<small>No approved shared dashboard link. Saved telemetry remains available inside this card.</small>}
  {!row.vrmInstallation&&(compact.length?<ul>{compact.map(({metric,item})=><li key={metric}>{labels[metric]}: {item!.value} {item!.unit}</li>)}</ul>:<small>No saved power readings</small>)}
  <details><summary>All Victron readings · {measurements.length}</summary>
   {measurements.length?<ul>{measurements.map((item,index)=><li key={item.metric+'|'+item.source+'|'+item.instance+'|'+index}>
    {labels[item.metric]||item.metric}: {item.unit==='state'?(item.value>0?'Alarm '+item.value:'No alarm reported'):item.value+' '+item.unit}
    <small>{item.source} {item.instance} · {cameraTimestamp(item.observedAt,now).fresh?'Recent':'Stale / unverified'} · {cameraTime(item.observedAt,now)}</small>
   </li>)}</ul>:<small>No saved power readings</small>}
   <small>Last Victron read attempt: {cameraTime(row.power.lastAttemptAt,now)}</small>
  </details>
  <a href={vrmPortalUrl(row.power.installationId)} target='_blank' rel='noopener noreferrer'>Open Victron ↗</a>
 </div>;
}

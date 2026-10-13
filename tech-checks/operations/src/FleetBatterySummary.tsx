import {cameraTime} from './fieldCameraHealth';
import {cameraTimestamp} from './cameraEvidence';
import type {FleetDashboardRow} from './fleetDashboardModel';

/** The minimum is an alert-focused summary of source readings, never aggregate capacity. */
export default function FleetBatterySummary({row,now,compact=false}:{row:FleetDashboardRow;now:number;compact?:boolean}){
 if(row.batteryState==='not_available')return null;
 const readings=row.batteryReadings;
 const minimum=row.batteryPercent===null?null:readings.filter(r=>r.fresh&&r.percent===row.batteryPercent).sort((a,b)=>Date.parse(a.observedAt!)-Date.parse(b.observedAt!))[0];
 const alarm=!row.batteryReadIssue&&row.power?.measurements.some(m=>m.unit==='state'&&m.value>0&&cameraTimestamp(m.observedAt,now).fresh);
 const unavailable=row.batteryReadIssue||(readings.length?'Charge is stale or unverified':'No verified charge reading');
 if(compact)return <small className='cos-fleet-battery-compact'>{minimum?<>Lowest reported charge {minimum.percent}% · {minimum.source}<br/>Measured {cameraTime(minimum.observedAt,now)}</>:unavailable}</small>;
 return <section className='cos-fleet-battery-summary' aria-label='Selected unit battery charge'>
  <div className='cos-fleet-eyebrow'>{row.family==='HELIOS'?'VICTRON':'RECONEYEZ'} BATTERY CHARGE</div>
  <strong className={minimum?'cos-signal-'+row.batteryState:'cos-signal-unknown'}>{minimum?minimum.percent+'%':'Unverified'}</strong>
  <p>{minimum?'Lowest reported charge across recent source readings':unavailable}</p>
  {alarm&&<p className='cos-signal-offline'>Recent Victron battery alarm reported. Review the power evidence below.</p>}
  {minimum&&<small>{minimum.source} · Measured {cameraTime(minimum.observedAt,now)}</small>}
  {row.batteryReadIssue&&<small>Saved readings below do not establish current charge.</small>}
  {readings.length>0&&<details><summary>{readings.length} reported charge {readings.length===1?'source':'sources'}</summary><dl aria-label='Battery charge source readings'>{readings.map((reading,index)=><div key={reading.source+'|'+index}>
   <dt>{reading.source}</dt><dd><b>{reading.percent}%</b> · {row.batteryReadIssue?'Current charge unverified':reading.fresh?'Recent observation':'Stale / unverified'}<small>Measured {cameraTime(reading.observedAt,now)}</small></dd>
  </div>)}</dl></details>}
  {row.power&&<small>Victron last read attempt {cameraTime(row.power.lastAttemptAt,now)}. Measurements retain their own times.</small>}
 </section>;
}

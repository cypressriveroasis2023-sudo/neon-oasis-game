import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import FleetCardIcon from './FleetCardIcon';
import {readConnectionCheck,connectionCheckState} from './connectionCheckResult';
import type {CameraRow} from './cameraEvidence';
import type {FleetDashboardRow} from './fleetDashboardModel';
import type {CameraDiagnosticResult} from '../../supabase/functions/cos-operations-pages/cameraDiagnostics';
function ConnectionTools({device}:{device:CameraRow}){
 const [pending,setPending]=useState(false),[result,setResult]=useState<CameraDiagnosticResult|null>(null),[error,setError]=useState('');
 const active=useRef<AbortController|null>(null);
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{const tick=()=>setNow(Date.now()),timer=window.setInterval(tick,60000);document.addEventListener('visibilitychange',tick);return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',tick);};},[]);
 const outcome=connectionCheckState(result,device,now);
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
 const run=async(mode:'quick'|'ports')=>{
  if(active.current||!device.connection)return;
  const controller=new AbortController();active.current=controller;setPending(true);setError('');setResult(null);
  try{
   const response=await api.post<CameraDiagnosticResult>('/api/camera-health/devices/'+device.id+'/check',{unitKey:device.unit,publicIp:device.connection.publicIp,ports:device.connection.ports,mode},{signal:controller.signal});
   if(active.current===controller&&!controller.signal.aborted){const acceptedAt=Date.now();setResult(readConnectionCheck(response.data,device,mode,acceptedAt));setNow(acceptedAt);}
  }catch(e){if(active.current===controller&&!controller.signal.aborted)setError(e instanceof Error?e.message:'The connection check could not be completed.');}
  finally{if(active.current===controller){active.current=null;setPending(false);}}
 };
 return <article className='cos-camera-connection' aria-label={'Connection tools for '+device.name}>
  <strong>{device.name}</strong><p><b>{device.connection!.publicIp}</b> · {device.connection!.ports.length?'Ports '+device.connection!.ports.join(' · '):'Saved monitoring profile ports'}</p>
  <div className='cos-card-quick-actions'><button className='cos-card-pill' disabled={pending} onClick={()=>void run('quick')}><FleetCardIcon kind='tools'/>Ping</button><button className='cos-card-pill' disabled={pending} onClick={()=>void run('ports')}><FleetCardIcon kind='ports'/>Scan ports</button></div>
  {pending&&<p role='status'>Checking this saved connection…</p>}{error&&<p role='alert'><strong>Unknown · </strong>{error}</p>}{!pending&&!result&&!error&&<p>No completed check · Unknown</p>}
  {result&&<div role='status' className='cos-camera-test-result'><strong>{outcome.state==='online'?'Online':outcome.state==='offline'?'Offline':'Unknown'} · {outcome.reason}</strong><small>Saved TCP / service-port check · Device {result.deviceId} · {result.publicIp} · {new Date(result.checkedAt).toLocaleString('en-US',{timeZone:'America/Chicago'})} Central · Video unverified</small><div>{result.ports.map(p=><span key={p.port} className={'cos-camera-port-result '+(outcome.state==='unknown'?'unknown':p.reachable?'responded':'no-response')}>{p.port} · {outcome.state==='unknown'?'Saved: ':''}{p.reachable?'Responded':'No response'}{p.latencyMs!==null?' · '+p.latencyMs+' ms':''}</span>)}</div></div>}
 </article>;
}
export default function FleetCameraTools({row}:{row:FleetDashboardRow}){
 const devices=row.camera.rows.filter(d=>!d.trackerOnly&&d.connection&&/^[1-9]\d{0,14}$/.test(String(d.id)));
 return <section className='cos-camera-tools' aria-label='Camera connection tools'><h3><FleetCardIcon kind='tools'/>Quick troubleshooting</h3><p className='cos-card-tool-note'>Ping checks saved TCP service ports. Scan ports checks the saved port list. Video health is separate.</p>{devices.length?devices.map(device=><ConnectionTools key={JSON.stringify([row.id,device.id,device.unit,device.connection])} device={device}/>):<p>No saved public camera connection is linked to this unit. Check the source details below.</p>}</section>;
}

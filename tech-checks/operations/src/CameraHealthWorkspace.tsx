import { useCallback, useEffect, useRef, useState } from 'react';
import { api, openLegacy } from './api';
type Health = { totalDevices:number;online:number;offline:number;review:number;shopRoot:number;healthRows:number;fieldDevices:number;refreshedAt:string;rows:any[] };
export function validateCameraHealth(value: any): Health {
  if (!value || ['totalDevices','online','offline','review','shopRoot','healthRows','fieldDevices'].some(key => !Number.isInteger(value[key]) || value[key] < 0) || !Array.isArray(value.rows) || value.rows.some((row:any) => !row || (typeof row.id !== 'string' && typeof row.id !== 'number') || typeof row.name !== 'string' || !['online','offline','review'].includes(row.status)) || value.rows.length !== value.fieldDevices || value.online + value.offline + value.review !== value.fieldDevices || !Number.isFinite(Date.parse(value.refreshedAt)))
    throw new Error('Camera Health returned an incomplete summary.');
  return value;
}
export default function CameraHealthWorkspace() {
  const [health,setHealth] = useState<Health|null>(null), [error,setError] = useState(''), [loading,setLoading] = useState(false);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++revision.current; setLoading(true);
    try { const fresh = validateCameraHealth((await api.get('/api/camera-health/summary')).data); if(request===revision.current){setHealth(fresh);setError('');} }
    catch(cause){if(request===revision.current)setError(cause instanceof Error?cause.message:'Camera Health could not be loaded.');}
    finally{if(request===revision.current)setLoading(false);}
  },[]);
  useEffect(()=>{void refresh();return()=>{revision.current++;};},[refresh]);
  return <section className='panel module camera-health-native' aria-label='Camera Health'>
    <div className='panelhead'><div><h2>Camera Health</h2><span>Live Camera Health source</span></div><div className='purchase-actions'><button disabled={loading} onClick={()=>void refresh()}>{loading?'Refreshing…':'Refresh Camera Health'}</button><button className='secondary' onClick={()=>openLegacy('camera-health')}>Open Camera Health diagnostics</button></div></div>
    {error&&<div className='operations-error' role='alert'>{error}{health&&<p>Showing the last successful summary.</p>}</div>}
    {!health&&!error?<p role='status'>Loading Camera Health…</p>:health&&<>
      <div className='stats camera-health-summary'>{[['CAMERAS / DEVICES',health.totalDevices,''],['ONLINE',health.online,'green'],['CONFIRMED OFFLINE',health.offline,'red'],['NEEDS REVIEW',health.review,'yellow'],['SHOP / ROOT',health.shopRoot,'']].map(([label,count,color])=><div className='stat' key={label}><b className={String(color)}>{count}</b><span>{label}</span></div>)}</div>
      <p>SHOP / ROOT is excluded from field counts. Camera Health remains the health engine of record.</p><p>Health records: <b>{health.healthRows}</b> · Field devices: <b>{health.fieldDevices}</b> · Refreshed: <b>{new Date(health.refreshedAt).toLocaleString()}</b></p>
      <div className='records'>{health.rows.map(row=><article className='record' key={row.id}><div><strong>{row.name}</strong><small>{[row.unit,row.type,row.organization].filter(Boolean).join(' · ')} · {row.checkedAt?new Date(row.checkedAt).toLocaleString():'Last seen unavailable'}</small></div><em>{String(row.status).toUpperCase()}</em></article>)}</div>
    </>}
  </section>;
}

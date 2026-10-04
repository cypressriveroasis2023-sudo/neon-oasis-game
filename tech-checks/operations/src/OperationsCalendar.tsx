import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { chicagoDay } from './dailyBoardData';
import { calendarDays, jobItems, moveCalendar, scheduledDay, type OperationsRecord } from './operationsWorkflowData';
import './operationsWorkflows.css';
type Props={show:(message:string)=>void;onOpenJob?:(jobId:string)=>void};
type View='Month'|'Week'|'Year';
const date=(day:string)=>new Date(day+'T12:00:00Z');
export default function OperationsCalendar({show,onOpenJob}:Props) {
  const [jobs,setJobs]=useState<OperationsRecord[]|null>(null);
  const [view,setView]=useState<View>('Month');
  const [cursor,setCursor]=useState(()=>chicagoDay(new Date()));
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [selected,setSelected]=useState<OperationsRecord|null>(null);
  const revision=useRef(0);
  const refresh=useCallback(async()=>{
    const request=++revision.current;setLoading(true);
    try{const rows=jobItems((await api.get('/api/jobs')).data);if(request===revision.current){setJobs(rows);setError('');}}
    catch(cause){if(request===revision.current){const message=cause instanceof Error?cause.message:'Calendar could not be loaded.';setError(message);show(message);}}
    finally{if(request===revision.current)setLoading(false);}
  },[show]);
  useEffect(()=>{void refresh();const updated=()=>void refresh();window.addEventListener('cos-board-updated',updated);return()=>{revision.current+=1;window.removeEventListener('cos-board-updated',updated);};},[refresh]);
  const scheduled=(jobs||[]).filter(job=>Boolean(scheduledDay(job.scheduled)));
  const year=Number(cursor.slice(0,4)),month=cursor.slice(0,7);
  const weekStart=calendarDays(cursor,'Week')[0];
  const days=view==='Year'?[]:calendarDays(cursor,view);
  const label=view==='Year'?String(year):view==='Week'?'Week of '+date(weekStart).toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}):date(cursor).toLocaleDateString('en-US',{timeZone:'UTC',month:'long',year:'numeric'});
  const open=(job:OperationsRecord)=>{if(onOpenJob)onOpenJob(job.id);else setSelected(job);show(job.jobNumber+' · '+job.customer+' · '+(job.stage||job.status)+' · '+(job.technician||'Unassigned'));};
  return <div className='ops-calendar ops-workflows' aria-label='COS Operations Calendar' aria-busy={loading}>
    <div className='calendar-toolbar'><div><button aria-label='Previous calendar period' onClick={()=>setCursor(current=>moveCalendar(current,view,-1))}>‹</button><button onClick={()=>setCursor(chicagoDay(new Date()))}>Today</button><button aria-label='Next calendar period' onClick={()=>setCursor(current=>moveCalendar(current,view,1))}>›</button><strong>{label}</strong><small>CT</small></div><div>{(['Month','Week','Year'] as const).map(item=><button key={item} className={view===item?'selected':''} aria-pressed={view===item} onClick={()=>setView(item)}>{item}</button>)}<button disabled={loading} onClick={()=>void refresh()}>{loading?'Refreshing…':'Refresh calendar'}</button></div></div>
    {error&&<div className='daily-board-error' role='alert'>{error}{jobs&&<p>Showing the last successful job schedule.</p>}</div>}
    {!jobs&&!error?<div className='loading' role='status'>Loading production job schedule…</div>:jobs&&<>
      {view==='Year'?<div className='calendar-year'>{Array.from({length:12},(_,index)=>{const monthKey=String(year)+'-'+String(index+1).padStart(2,'0');return <button key={monthKey} onClick={()=>{setCursor(monthKey+'-01');setView('Month');}}><b>{date(monthKey+'-01').toLocaleDateString('en-US',{timeZone:'UTC',month:'long'})}</b><span>{scheduled.filter(job=>scheduledDay(job.scheduled).startsWith(monthKey)).length} scheduled</span></button>;})}</div>:<div className={'calendar-grid '+view.toLowerCase()} role='grid' aria-label={label}>{days.map(day=>{const items=scheduled.filter(job=>scheduledDay(job.scheduled)===day);return <div role='gridcell' aria-label={day} className={'calendar-day '+(view==='Month'&&day.slice(0,7)!==month?'muted':'')} key={day}><b>{date(day).toLocaleDateString('en-US',{timeZone:'UTC',weekday:view==='Week'?'short':undefined,day:'numeric'})}</b>{items.map(job=><button key={job.id} aria-label={job.jobNumber+' · '+job.customer} onClick={()=>open(job)}><strong>{job.jobNumber}</strong><span>{job.customer}</span><small>{job.stage||job.status} · {job.technician||'Unassigned'}</small></button>)}</div>;})}</div>}
      {scheduled.length===0&&<p>No jobs in the loaded records currently have a valid schedule.</p>}
    </>}
    {selected&&<section className='quote-card' aria-label='Calendar job details'><div className='quote-section-head'><h3>{selected.jobNumber} · {selected.customer}</h3><button className='secondary' onClick={()=>setSelected(null)}>Close details</button></div><p>{selected.site} · {selected.jobType} · {selected.stage||selected.status}</p><p>{selected.scheduled} CT · {selected.technician||'Unassigned'} · {selected.equipmentUnitTag||selected.equipment||'Equipment not assigned'}</p></section>}
  </div>;
}

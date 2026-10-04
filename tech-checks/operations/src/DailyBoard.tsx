import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { boardDateLabel, chicagoDay, dailyBoardCards, isTestRecord, readinessSummary, type BoardCard, type BoardScope } from './dailyBoardData';
import './dailyBoard.css';
import { createBoardReader, createBoardAssignmentSaver, type BoardSnapshot } from './boardPersistence';
import { validateLocalSchedule } from '../shared/scheduleValidation';

type Props = { api: {get: (path: string) => Promise<{data: any}>; post: (path:string, body?:any)=>Promise<{data:any}>}; openWorkspace: (name:string)=>void };
type AssignmentDraft={date:string;startTime:string;endTime:string;technician:string};
const statusKey=(value:unknown)=>String(value||'').trim().toLowerCase().replaceAll('_',' ');
const plusTwoHours=(value:string)=>{
  const [hour,minute]=value.split(':').map(Number);
  const total=((hour||0)*60+(minute||0)+120)%(24*60);
  return String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0');
};
const jobNotes=(card:BoardCard)=>{
  if(card.kind==='task')return String(card.record.instructions||card.record.ownerNotes||'');
  const notes=Array.isArray(card.record.notes)?card.record.notes:[];
  return String(notes.at(-1)?.text||card.record.instructions||card.record.siteAddress||'');
};

export default function DailyBoard({api,openWorkspace}:Props) {
  const [snapshot,setSnapshot]=useState<BoardSnapshot>({jobs:[],tasks:[],readiness:[]});
  const [lastSuccess,setLastSuccess]=useState<Date|null>(null);
  const [error,setError]=useState('');
  const [actionError,setActionError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [saving,setSaving]=useState(false);
  const [now,setNow]=useState(()=>new Date());
  const [person,setPerson]=useState('');
  const [department,setDepartment]=useState('');
  const [scope,setScope]=useState<BoardScope>('day');
  const [showTest,setShowTest]=useState(false);
  const [tv,setTv]=useState(false);
  const [rotation,setRotation]=useState(0);
  const [selected,setSelected]=useState<BoardCard|null>(null);
  const [dragged,setDragged]=useState<BoardCard|null>(null);
  const [assigning,setAssigning]=useState<BoardCard|null>(null);
  const [assignment,setAssignment]=useState<AssignmentDraft>({date:'',startTime:'08:00',endTime:'10:00',technician:''});
  const running=useRef(0);
  const mounted=useRef(false);
  const detail=useRef<HTMLDialogElement|null>(null);
  const assignDialog=useRef<HTMLDialogElement|null>(null);

  useEffect(()=>{if(selected&&detail.current&&!detail.current.open)detail.current.showModal();},[selected]);
  useEffect(()=>{if(assigning&&assignDialog.current&&!assignDialog.current.open)assignDialog.current.showModal();},[assigning]);

  const readBoard = useMemo(() => createBoardReader(api), [api]);
  const load = useCallback(async (fresh = false): Promise<BoardSnapshot | null> => {
    running.current += 1;
    if (mounted.current) setBusy(true);
    try {
      const data = await readBoard(fresh);
      if (mounted.current) { setSnapshot(data); setLastSuccess(new Date()); setError(''); }
      return data;
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'The daily board could not refresh.');
      return null;
    } finally {
      running.current -= 1;
      if (mounted.current) setBusy(running.current > 0);
    }
  }, [readBoard]);
  const assignmentSaver = useMemo(() => createBoardAssignmentSaver(api, () => load(true)), [api, load]);

  useEffect(()=>{
    mounted.current=true;void load();
    const timer=window.setInterval(()=>void load(),60000);
    const clock=window.setInterval(()=>setNow(new Date()),10000);
    const focus=()=>void load(true);window.addEventListener('focus',focus);
    return()=>{mounted.current=false;window.clearInterval(timer);window.clearInterval(clock);window.removeEventListener('focus',focus);};
  },[load]);

  useEffect(()=>{
    if(!tv)return;
    const timer=window.setInterval(()=>setRotation(n=>n+1),15000);
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!detail.current?.open&&!assignDialog.current?.open)setTv(false);};
    window.addEventListener('keydown',escape);
    const previous=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{window.clearInterval(timer);window.removeEventListener('keydown',escape);document.body.style.overflow=previous;};
  },[tv]);

  const today=chicagoDay(now);
  const cards=useMemo(()=>dailyBoardCards(snapshot.jobs,snapshot.tasks,now,scope),[snapshot,today,scope]);
  const technicians=useMemo(()=>snapshot.readiness.map(r=>({name:r.name,department:String(r.department||'').toLowerCase()})).sort((a,b)=>a.name.localeCompare(b.name)),[snapshot.readiness]);
  const technicianMap=useMemo(()=>new Map(technicians.map(t=>[t.name,t])),[technicians]);
  const allPeople=useMemo(()=>Array.from(new Set(['Unassigned',...technicians.map(t=>t.name),...cards.map(c=>c.assignee)])).filter(Boolean),[cards,technicians]);
  const visible=cards.filter(c=>(showTest||!isTestRecord(c.record))&&(!person||c.assignee===person)&&(!department||c.department===department));
  const laneNames=allPeople.filter(name=>(!person||name===person)&&(!department||!technicianMap.get(name)?.department||technicianMap.get(name)?.department===department||visible.some(c=>c.assignee===name)));
  const sameDay=Boolean(snapshot.asOf&&chicagoDay(snapshot.asOf)===today);
  const readiness=sameDay?snapshot.readiness.filter(r=>(!person||r.name===person)&&(!department||r.department===department)):[];
  const hiddenTests=showTest?0:cards.filter(c=>isTestRecord(c.record)).length;
  const stale=Boolean(lastSuccess&&(now.getTime()-lastSuccess.getTime()>120000||!sameDay));
  const counts=useMemo(()=>({
    unassigned:visible.filter(c=>c.assignee==='Unassigned').length,
    scheduled:visible.filter(c=>statusKey(c.status)==='scheduled').length,
    field:visible.filter(c=>['dispatched','in progress','accepted','en route','on site','working'].includes(statusKey(c.status))).length,
    correction:visible.filter(c=>['correction required','needs correction'].includes(statusKey(c.status))).length,
    review:visible.filter(c=>statusKey(c.status)==='owner review').length,
    complete:visible.filter(c=>c.lane==='complete').length
  }),[visible]);

  const open=(name:string)=>{setTv(false);setSelected(null);openWorkspace(name);};
  const canManage=(card:BoardCard)=>{
    const status=statusKey(card.status);
    return card.kind==='job'&&card.record.completionKind!=='visit'&&!['owner review','completed','complete','closed','billing ready','paid','cancelled','canceled'].includes(status);
  };
  const startAssignment=(card:BoardCard,technician?:string)=>{
    if(!canManage(card))return;
    const start=String(card.record.scheduled||'').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    const end=String(card.record.scheduledEnd||'').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    const allowed=technicians.filter(t=>!card.department||!t.department||t.department===card.department);
    const current=technician||((card.assignee!=='Unassigned'&&technicianMap.has(card.assignee))?card.assignee:'')||allowed[0]?.name||'';
    const startTime=start?.[2]||'08:00';
    setAssignment({date:start?.[1]||today,startTime,endTime:end&&start&&end[1]===start[1]?end[2]:plusTwoHours(startTime),technician:current});
    setActionError('');
    setAssigning(card);
    setSelected(null);
  };
  const dropOn = async (name: string) => {
    if (!dragged || assignmentSaver.busy) return;
    const card = dragged, target = technicianMap.get(name);
    setDragged(null);
    if (!target || !canManage(card)) return;
    if (card.department && target.department && card.department !== target.department) {
      setActionError(`${card.department.toUpperCase()} work must be assigned to a ${card.department.toUpperCase()} technician.`);
      return;
    }
    setSaving(true); setActionError(''); setNotice('');
    try {
      const result = await assignmentSaver.save('/api/jobs/' + card.record.id + '/assign', { technician: name }, {
        jobId: card.record.id, technician: name, visitId: card.record.visitId,
      });
      if (result.status === 'confirmed') {
        setNotice((card.reference || 'COS Job') + ' assignment saved and verified.');
        window.dispatchEvent(new Event('cos-board-updated'));
      } else if (result.status !== 'busy') setActionError(result.message);
    } finally { setSaving(false); }
  };
  const saveAssignment = async () => {
    if (assignmentSaver.busy) return;
    if (!assigning || !assignment.date || !assignment.startTime || !assignment.endTime || !assignment.technician) {
      setActionError('Date, start time, end time and technician are required.'); return;
    }
    const schedule = validateLocalSchedule(assignment.date + ' ' + assignment.startTime, assignment.date + ' ' + assignment.endTime);
    if (!schedule.valid) { setActionError(schedule.error); return; }
    const card = assigning;
    setSaving(true); setActionError(''); setNotice('');
    try {
      const result = await assignmentSaver.save('/api/jobs/' + card.record.id + '/schedule', {
        start: schedule.start, end: schedule.end, technician: assignment.technician,
      }, {
        jobId: card.record.id, visitId: card.record.visitId, technician: assignment.technician,
        start: schedule.start || undefined, end: schedule.end || undefined,
      });
      if (result.status === 'confirmed') {
        setAssigning(null);
        setNotice('Schedule and technician assignment saved and verified.');
        window.dispatchEvent(new Event('cos-board-updated'));
      } else if (result.status !== 'busy') {
        if (result.status === 'accepted_unverified') setAssigning(null);
        setActionError(result.message);
      }
    } finally { setSaving(false); }
  };

  return <section className={'cos-daily-board'+(tv?' cos-daily-board-tv':'')} aria-label='COS Daily Board'>
    <header className='daily-board-header'>
      <div><small>CAMERAS ON SITE · DAILY OPERATIONS</small><h2>Daily Board</h2><p>{now.toLocaleDateString('en-US',{timeZone:'America/Chicago',weekday:'long',month:'long',day:'numeric',year:'numeric'})} · {now.toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'})} CT</p></div>
      <div className='daily-board-actions'><button className='secondary' disabled={busy} onClick={()=>void load()}>{busy?'Refreshing…':'Refresh'}</button><button className='secondary' aria-pressed={tv} onClick={()=>{setTv(v=>!v);setRotation(0);setSelected(null);}}>{tv?'Exit TV View':'TV View'}</button>{!tv&&<button onClick={()=>open('Owner Tasks')}>+ Assign Task</button>}</div>
    </header>

    <div className='daily-board-range' aria-label='Board range'><button className={scope==='day'?'active':''} onClick={()=>setScope('day')}>Day</button><button className={scope==='week'?'active':''} onClick={()=>setScope('week')}>Week</button><span>{scope==='day'?'Today + overdue / unscheduled work':'Next 7 days + overdue / unscheduled work'}</span></div>

    <div className='daily-board-toolbar'>
      <label>Technician<select aria-label='Technician' value={person} onChange={e=>{setPerson(e.target.value);setRotation(0);}}><option value=''>Everyone</option>{allPeople.map(p=><option key={p}>{p}</option>)}</select></label>
      <label>Department<select aria-label='Department' value={department} onChange={e=>{setDepartment(e.target.value);setRotation(0);}}><option value=''>All departments</option><option value='it'>IT</option><option value='service'>Service</option><option value='owner'>Owner</option></select></label>
      <label className='daily-board-test-toggle'><input type='checkbox' checked={showTest} onChange={e=>setShowTest(e.target.checked)}/>Show test records{hiddenTests>0?' ('+hiddenTests+' hidden)':''}</label>
      <span>{visible.length} jobs / tasks · Refreshes every minute<br/>{lastSuccess?'Last successful refresh '+lastSuccess.toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'})+' CT':'Waiting for live records'}</span>
    </div>

    <section className='daily-board-status' aria-label='Workflow status summary'>
      <article><b>{counts.unassigned}</b><span>UNASSIGNED</span></article>
      <article><b>{counts.scheduled}</b><span>SCHEDULED</span></article>
      <article><b>{counts.field}</b><span>FIELD / WORKING</span></article>
      <article className={counts.correction?'attention':''}><b>{counts.correction}</b><span>CORRECTION</span></article>
      <article><b>{counts.review}</b><span>OWNER REVIEW</span></article>
      <article><b>{counts.complete}</b><span>COMPLETED TODAY</span></article>
    </section>

    {(error||stale)&&<div className='daily-board-error' role='alert'><strong>{lastSuccess?'Showing the last successful snapshot.':'Live records are unavailable.'}</strong> {error||'Refresh is delayed.'} <button className='secondary' disabled={busy} onClick={()=>void load()}>Retry</button></div>}
    {actionError&&<div className='daily-board-error' role='alert'>{actionError}</div>}
    {notice&&<div className='daily-board-notice' role='status'>{notice}</div>}

    {lastSuccess&&<section className='daily-board-readiness' aria-label='Daily truck readiness'><h3>Daily Truck Readiness <small>Today’s recorded checks</small></h3><div>{readiness.map(row=>{const summary=readinessSummary(row);return <article key={row.userId}><strong>{row.name} <small>{row.department.toUpperCase()}</small></strong>{(['truck','trailer','inventory'] as const).map(key=><p key={key}><span>{key==='truck'?'Truck inspection':key==='trailer'?'Trailer inspection':'Inventory record'}</span><b className={'daily-readiness-'+summary[key].state}>{summary[key].label}</b></p>)}<small>{row.completedAt?'Completed '+boardDateLabel(row.completedAt):row.startedAt?'Started '+boardDateLabel(row.startedAt):'No check recorded today'}</small></article>;})}</div>{!readiness.length&&<p>{sameDay?'No technicians match these filters.':'Refresh required before showing today’s readiness.'}</p>}</section>}

    {!tv&&<p className='daily-board-drag-hint'>Owner: drag an active COS Job onto a technician to assign it immediately. Click the job to schedule it. Once it is scheduled under a technician, the card turns green.</p>}

    {!lastSuccess&&!error?<p role='status'>Loading jobs and assigned tasks…</p>:<div className='daily-board-people'>{laneNames.map(name=>{
      const items=visible.filter(c=>c.assignee===name);
      const pages=Math.max(1,Math.ceil(items.length/3));
      const page=rotation%pages;
      const shown=tv?items.slice(page*3,page*3+3):items;
      const technician=technicianMap.get(name);
      const dropReady=Boolean(dragged&&technician&&canManage(dragged)&&(!dragged.department||!technician.department||dragged.department===technician.department));
      return <section key={name} className={'daily-board-person'+(name==='Unassigned'?' unassigned':'')+(dropReady?' drop-ready':'')} aria-label={name} onDragOver={e=>{if(dropReady)e.preventDefault();}} onDrop={()=>dropOn(name)}>
        <h3><span>{name}</span><b>{items.length}</b>{technician&&<small>{technician.department.toUpperCase()}</small>}</h3>
        {tv&&pages>1&&<small className='daily-board-page'>Page {page+1} of {pages} · Rotates every 15 seconds</small>}
        {shown.map(card=><button type='button' className={'daily-board-card daily-board-'+card.lane+(statusKey(card.status)==='scheduled'&&card.assignee!=='Unassigned'?' daily-board-scheduled':'')} key={card.id} disabled={saving} draggable={!tv&&!saving&&canManage(card)} onDragStart={()=>setDragged(card)} onDragEnd={()=>setDragged(null)} onClick={()=>setSelected(card)}>
          <div className='daily-board-card-meta'><span>{isTestRecord(card.record)?'TEST · ':''}{card.kind==='job'?(card.record.completionKind==='visit'?'COMPLETED VISIT':'COS JOB'):'ASSIGNED TASK'}</span><b>{card.overdue?'OVERDUE':card.priority==='high'?'HIGH PRIORITY':card.status}</b></div>
          <strong>{card.title}</strong>
          <span>{[card.reference,card.site].filter(Boolean).join(' · ')||'General work'}</span>
          <span>{card.kind==='job'?[card.record.jobType,card.record.equipment,card.record.equipmentUnitTag].filter(Boolean).join(' · '):card.record.instructions||''}</span>
          {jobNotes(card)&&<span className='daily-board-card-note'>{jobNotes(card)}</span>}
          <footer><b>{card.status}</b><span>{boardDateLabel(card.date)}</span></footer>
        </button>)}
        {!items.length&&<p className='daily-board-empty'>{name==='Unassigned'?'No unassigned work.':'No work in this view.'}</p>}
      </section>;
    })}</div>}

    <p className='daily-board-note'>Unfinished and overdue work stays visible until management reschedules or completes it. Completed visits stay visible after a handoff. Truck, trailer and inventory readiness remain controlled through Tech Check.</p>
    {!tv&&<div className='daily-board-actions'><button className='secondary' onClick={()=>open('Jobs')}>Jobs workspace</button><button className='secondary' onClick={()=>open('Tech Check')}>Truck / trailer readiness</button><button className='secondary' onClick={()=>open('Calendar')}>Calendar</button></div>}

    {selected&&<dialog ref={detail} className='daily-board-detail' aria-label='Work details' onCancel={()=>setSelected(null)}><section>
      <button className='secondary' onClick={()=>setSelected(null)}>Close details</button>
      <small>{selected.kind==='job'?'COS JOB':'OWNER TASK'} · {selected.priority.toUpperCase()}</small>
      <h3>{selected.title}</h3>
      <p>{[selected.reference,selected.site].filter(Boolean).join(' · ')}</p>
      <p>{selected.assignee} · {selected.status} · {boardDateLabel(selected.date)}</p>
      <p>{selected.kind==='job'?[selected.record.jobType,selected.record.equipment,selected.record.equipmentUnitTag].filter(Boolean).join(' · '):selected.record.instructions||''}</p>
      {jobNotes(selected)&&<p className='daily-board-detail-note'>{jobNotes(selected)}</p>}
      <div className='daily-board-actions'>{canManage(selected)&&<button onClick={()=>startAssignment(selected)}>Schedule / Reassign</button>}{selected.kind==='job'&&selected.record.completionKind!=='visit'&&<button className='secondary' onClick={()=>{const card=selected;setSelected(null);window.dispatchEvent(new CustomEvent('cos-owner-job-action',{detail:{jobId:card.record.id,jobNumber:card.reference,action:'close'}}))}}>Close Job</button>}{selected.kind==='job'&&selected.record.completionKind!=='visit'&&<button className='danger' onClick={()=>{const card=selected;setSelected(null);window.dispatchEvent(new CustomEvent('cos-owner-job-action',{detail:{jobId:card.record.id,jobNumber:card.reference,action:'remove'}}))}}>Delete Job</button>}<button className='secondary' onClick={()=>open(selected.kind==='job'?'Jobs':'Owner Tasks')}>Open {selected.kind==='job'?'Jobs':'Owner Tasks'} workspace</button></div>
    </section></dialog>}

    {assigning&&<dialog ref={assignDialog} className='daily-board-detail daily-board-assignment' aria-label='Schedule and reassign job' onCancel={event=>{if(saving)event.preventDefault();else setAssigning(null);}}><section>
      <button className='secondary' disabled={saving} onClick={()=>setAssigning(null)}>Close</button>
      <small>MANAGEMENT SCHEDULING</small>
      <h3>{assigning.reference} · {assigning.title}</h3>
      <p>{assigning.site} · {assigning.record.jobType||'COS Job'} · {assigning.record.equipmentUnitTag||assigning.record.equipment||'Equipment pending'}</p>
      {actionError&&<div className='daily-board-error' role='alert'>{actionError}</div>}
      <div className='daily-board-assignment-grid'>
        <label>Service date<input type='date' disabled={saving} value={assignment.date} onChange={e=>setAssignment({...assignment,date:e.target.value})}/></label>
        <label>Start time<input type='time' disabled={saving} value={assignment.startTime} onChange={e=>setAssignment({...assignment,startTime:e.target.value})}/></label>
        <label>End time<input type='time' disabled={saving} value={assignment.endTime} onChange={e=>setAssignment({...assignment,endTime:e.target.value})}/></label>
        <label>Technician<select disabled={saving} value={assignment.technician} onChange={e=>setAssignment({...assignment,technician:e.target.value})}><option value=''>Select technician</option>{technicians.filter(t=>!assigning.department||!t.department||t.department===assigning.department).map(t=><option key={t.name} value={t.name}>{t.name} · {t.department.toUpperCase()}</option>)}</select></label>
      </div>
      <p className='daily-board-assignment-note'>Saving updates the existing production visit. Drag-and-drop never bypasses scheduling or department validation.</p>
      <div className='daily-board-actions'><button className='secondary' disabled={saving} onClick={()=>setAssigning(null)}>Cancel</button><button disabled={saving||!assignment.technician} onClick={saveAssignment}>{saving?'Saving…':'Save Schedule & Assignment'}</button></div>
    </section></dialog>}
  </section>;
}

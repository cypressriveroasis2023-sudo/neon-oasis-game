import ApprovedBoardActions from './ApprovedBoardActions';
import { DeliveryGoBackSummary } from './DeliveryGoBack';
import { hasOpenGoBack } from './deliveryGoBackData';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { boardDateLabel, chicagoDay, dailyBoardCards, equipmentHandoffJobs, isTestRecord, type BoardCard, type BoardScope } from './dailyBoardData';
import './dailyBoard.css';
import BoardRecordDetails from './BoardRecordDetails';
import {captureBoardSelection} from './boardRecordDetails';
import { createBoardReader, createBoardAssignmentSaver, type BoardSnapshot } from './boardPersistence';
import { validateLocalSchedule } from '../shared/scheduleValidation';
import TechCheckTvBoard from './TechCheckTvBoard';
import BoardsDoor from './BoardsDoor';
import FleetDashboard from './FleetDashboard';
import { TV_REFRESH_MS, tvBoardLink, tvBoardOptions } from './tvBoardData';
import {useTvBoardSettings} from './useTvBoardSettings';
import TvBoardControls from './TvBoardControls';
import {setTvSessionHold,tvSessionHold} from './tvSessionHold';
import {tvUpdatesDelayed} from './boardFreshStatus';

type Props = { api: {get: (path: string) => Promise<{data: any}>; post: (path:string, body?:any)=>Promise<{data:any}>}; session: Record<string, any>; openWorkspace: (name:string)=>void; onTvChange?: (enabled:boolean)=>void;initialTv?:boolean;createTicket?:never };
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

export default function DailyBoard({api,session,openWorkspace,onTvChange,initialTv}:Props) {
  const launch = useMemo(() => tvBoardOptions(location.search), []);
  const tvSettings=useTvBoardSettings(api);
  const [snapshot,setSnapshot]=useState<BoardSnapshot>({jobs:[],tasks:[],readiness:[]});
  const [lastSuccess,setLastSuccess]=useState<Date|null>(null);
  const [error,setError]=useState('');
  const [actionError,setActionError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [saving,setSaving]=useState(false);
  const [refreshRequired,setRefreshRequired]=useState(false);
  const [now,setNow]=useState(()=>new Date());
  const [person,setPerson]=useState('');
  const [department,setDepartment]=useState(launch.department);
  const [scope,setScope]=useState<BoardScope>(launch.scope);
  const [showTest,setShowTest]=useState(false);
  const [tv,setTv]=useState(initialTv??launch.enabled);
  const [reconnecting,setReconnecting]=useState(false);
  const sessionStale=useRef(false);
  const tvRef=useRef(tv);
  tvRef.current=tv;
  const [rotation,setRotation]=useState(0);
  useEffect(()=>setRotation(0),[tvSettings.settings.sections.join(','),tvSettings.settings.rotationSeconds]);
  const [selected,setSelected]=useState<(BoardCard & {detailAsOf:string|null})|null>(null);
  const [dragged,setDragged]=useState<BoardCard|null>(null);
  const [assigning,setAssigning]=useState<BoardCard|null>(null);
  const [assignment,setAssignment]=useState<AssignmentDraft>({date:'',startTime:'08:00',endTime:'10:00',technician:''});
  const running=useRef(0);
  const mounted=useRef(false);
  const generation=useRef(0);
  const requireFreshRead=useRef(false);
  const detail=useRef<HTMLDialogElement|null>(null);
  const assignDialog=useRef<HTMLDialogElement|null>(null);

  useEffect(()=>{if(selected&&detail.current&&!detail.current.open)detail.current.showModal();},[selected]);
  useEffect(()=>{if(assigning&&assignDialog.current&&!assignDialog.current.open)assignDialog.current.showModal();},[assigning]);

  const readBoard = useMemo(() => createBoardReader(api), [api]);
  const load = useCallback(async (fresh = false): Promise<BoardSnapshot | null> => {
    if(sessionStale.current)return null;
    const currentGeneration = generation.current;
    running.current += 1;
    if (mounted.current) setBusy(true);
    try {
      const data = await readBoard(fresh || requireFreshRead.current);
      if (currentGeneration !== generation.current) return null;
      requireFreshRead.current = false;
      if (mounted.current) { setSnapshot(data); setLastSuccess(new Date()); setError(''); setReconnecting(false); }
      return data;
    } catch (cause) {
      if (mounted.current && currentGeneration === generation.current) setError(cause instanceof Error ? cause.message : 'The daily board could not refresh.');
      return null;
    } finally {
      running.current -= 1;
      if (mounted.current) setBusy(running.current > 0);
    }
  }, [readBoard]);
  const assignmentSaver = useMemo(() => createBoardAssignmentSaver(api, () => load(true)), [api, load]);

  const refresh = async () => {
    if (assignmentSaver.busy) return;
    const data = await load(true);
    if (!data) return;
    assignmentSaver.acknowledgeRefresh(data);
    setRefreshRequired(assignmentSaver.needsRefresh);
    setActionError('');
  };

  useEffect(()=>{
    mounted.current=true;void load();
    const timer=window.setInterval(()=>void load(),TV_REFRESH_MS);
    const clock=window.setInterval(()=>setNow(new Date()),10000);
    const focus=()=>void load(true);
    const visible=()=>{if(!document.hidden)focus();};
    const invalidated=(event:Event)=>{
      const detail=(event as CustomEvent<{reason?:string;path?:string}>).detail;
      const dataDenial=detail?.reason==='authentication-denied'&&typeof detail.path==='string'&&detail.path!=='/api/session';
      if(tvRef.current&&dataDenial){generation.current+=1;sessionStale.current=true;setReconnecting(true);return;}
      generation.current+=1;requireFreshRead.current=true;sessionStale.current=false;setReconnecting(false);setSnapshot({jobs:[],tasks:[],readiness:[]});setLastSuccess(null);setSelected(null);setAssigning(null);setError('Return to Tech Check and sign in again.');
    };
    const resumed=()=>{sessionStale.current=false;};
    window.addEventListener('focus',focus);window.addEventListener('online',focus);window.addEventListener('cos-board-updated',focus);window.addEventListener('cos-private-data-invalidated',invalidated);window.addEventListener('cos-tv-session-resumed',resumed);document.addEventListener('visibilitychange',visible);
    return()=>{mounted.current=false;generation.current+=1;window.clearInterval(timer);window.clearInterval(clock);window.removeEventListener('focus',focus);window.removeEventListener('online',focus);window.removeEventListener('cos-board-updated',focus);window.removeEventListener('cos-private-data-invalidated',invalidated);window.removeEventListener('cos-tv-session-resumed',resumed);document.removeEventListener('visibilitychange',visible);};
  },[load]);

  useEffect(()=>{setTvSessionHold(tv);},[tv]);
  useEffect(()=>{
    if(tv||!sessionStale.current)return;
    sessionStale.current=false;
    window.dispatchEvent(Object.assign(new Event('cos-private-data-invalidated'),{detail:{reason:'authentication-denied'}}));
  },[tv]);
  useEffect(()=>{
    onTvChange?.(tv);
    if(!tv&&new URLSearchParams(location.search).get('tvBoard')==='1'){
      const url=new URL(location.href);for(const key of ['tvBoard','tvScope','tvDepartment'])url.searchParams.delete(key);history.replaceState(history.state,'',url);
    }
    if(window.parent!==window)window.parent.postMessage({type:'COS_TV_BOARD_DISPLAY_MODE',active:tv},location.origin);
    return()=>{if(tv&&window.parent!==window&&!tvSessionHold())window.parent.postMessage({type:'COS_TV_BOARD_DISPLAY_MODE',active:false},location.origin);};
  },[tv,onTvChange]);

  useEffect(()=>{
    if(!tv)return;
    const timer=window.setInterval(()=>setRotation(n=>n+1),tvSettings.settings.rotationSeconds*1000);
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!detail.current?.open&&!assignDialog.current?.open)setTv(false);};
    window.addEventListener('keydown',escape);
    const previous=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{window.clearInterval(timer);window.removeEventListener('keydown',escape);document.body.style.overflow=previous;};
  },[tv,tvSettings.settings.rotationSeconds]);

  const today=chicagoDay(now);
  const handoffJobs=useMemo(()=>equipmentHandoffJobs(snapshot.jobs),[snapshot.jobs]);
  const cards=useMemo(()=>dailyBoardCards(handoffJobs,[],now,scope),[handoffJobs,now,scope]);
  const tvCards=useMemo(()=>dailyBoardCards(handoffJobs,[],now,scope,true).filter(c=>!isTestRecord(c.record)&&(!department||c.department===department)),[handoffJobs,now,scope,department]);
  const technicians=useMemo(()=>snapshot.readiness.map(r=>({name:r.name,department:String(r.department||'').toLowerCase()})).sort((a,b)=>a.name.localeCompare(b.name)),[snapshot.readiness]);
  const technicianMap=useMemo(()=>new Map(technicians.map(t=>[t.name,t])),[technicians]);
  const allPeople=useMemo(()=>Array.from(new Set(['Unassigned',...technicians.map(t=>t.name),...cards.map(c=>c.assignee)])).filter(Boolean),[cards,technicians]);
  const visible=cards.filter(c=>(showTest||!isTestRecord(c.record))&&(!person||c.assignee===person)&&(!department||c.department===department));
  const laneNames=allPeople.filter(name=>(!person||name===person)&&(!department||!technicianMap.get(name)?.department||technicianMap.get(name)?.department===department||visible.some(c=>c.assignee===name)));
  const sameDay=Boolean(snapshot.asOf&&chicagoDay(snapshot.asOf)===today);
  const readiness=sameDay?snapshot.readiness.filter(r=>(!person||r.name===person)&&(!department||r.department===department)):[];
  const hiddenTests=showTest?0:cards.filter(c=>isTestRecord(c.record)).length;
  const stale=tvUpdatesDelayed({lastSuccessAt:lastSuccess?lastSuccess.getTime():null,now:now.getTime(),sameDay,watchfulOldestObservedAt:null});
  const counts=useMemo(()=>({
    unassigned:visible.filter(c=>c.assignee==='Unassigned').length,
    scheduled:visible.filter(c=>statusKey(c.status)==='scheduled').length,
    field:visible.filter(c=>['dispatched','in progress','accepted','en route','on site','working'].includes(statusKey(c.status))).length,
    correction:visible.filter(c=>['correction required','needs correction'].includes(statusKey(c.status))).length,
    review:visible.filter(c=>statusKey(c.status)==='owner review').length,
    complete:visible.filter(c=>c.lane==='complete').length
  }),[visible]);
  const tvLink=tvBoardLink(window.parent!==window?window.parent.location.href:location.href,scope,department);
  const copyTvLink=async()=>{
    try{await navigator.clipboard.writeText(tvLink);setNotice('TV link copied. Open it on the display computer and sign in to Tech Check.');}
    catch{setNotice('Open the TV link below on the display computer and sign in to Tech Check.');}
  };

  const open=(name:string)=>{setTv(false);setSelected(null);openWorkspace(name);};
  const canManage=(card:BoardCard)=>{
    const status=statusKey(card.status);
    return card.kind==='job'&&card.record.completionKind!=='visit'&&!['owner review','completed','complete','closed','billing ready','paid','cancelled','canceled'].includes(status);
  };
  const startAssignment=(card:BoardCard,technician?:string)=>{
    if(!canManage(card)||assignmentSaver.needsRefresh||running.current>0)return;
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
    if (!dragged || assignmentSaver.busy || assignmentSaver.needsRefresh || running.current>0) return;
    const card = dragged, target = technicianMap.get(name);
    setDragged(null);
    if (!target || !canManage(card)) return;
    if (card.department && target.department && card.department !== target.department) {
      setActionError(`${card.department.toUpperCase()} work must be assigned to a ${card.department.toUpperCase()} technician.`);
      return;
    }
    setDragged(null);
  };
  const saveAssignment = () => { setAssigning(null); };

  // The TV already reads fleet through TvFleetView. Mounting the dashboard here
  // would publish that first read into the shared fleet cache and hide the
  // sample TvFleetView takes when Camera Health or the map actually opens.
  if(tv)return <BoardsDoor><TechCheckTvBoard counts={null} cards={tvCards} names={laneNames} readiness={readiness} scope={scope} now={now} lastSuccess={lastSuccess} error={error} stale={stale} busy={busy} rotation={rotation} rotationSeconds={tvSettings.settings.rotationSeconds} exit={()=>setTv(false)} refresh={()=>{void refresh();void tvSettings.refresh();}} sections={tvSettings.settings.sections} settingsError={tvSettings.error} reconnecting={reconnecting} api={api}/></BoardsDoor>;
  const fleetCounts=<FleetDashboard countsOnly session={session} navigate={openWorkspace} onSelectUnit={()=>undefined} openUnitHealth={()=>undefined} show={()=>undefined} historyReadEnabled={false} locationWritesEnabled={false} ownerManagementEnabled={false} ownerCensusEnabled={false} registerEquipment={()=>undefined}/>;
  return <BoardsDoor><section className='cos-daily-board' aria-label='COS Daily Board'>
    <header className='daily-board-header'>
      <div><small>CAMERAS ON SITE · DAILY OPERATIONS</small><h2>Daily Board</h2><p>{now.toLocaleDateString('en-US',{timeZone:'America/Chicago',weekday:'long',month:'long',day:'numeric',year:'numeric'})} · {now.toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'})} CT</p></div>
      <div className='daily-board-actions'><button className='secondary' disabled={busy||saving} onClick={()=>void refresh()}>{busy?'Refreshing…':'Refresh'}</button><button className='secondary' aria-pressed={tv} onClick={()=>{setTv(true);setRotation(0);setSelected(null);}}>TV View</button><button className='secondary' onClick={()=>void copyTvLink()}>Copy TV link</button></div>
    </header>

    <details className='cos-workspace-settings'><summary>TV display & settings</summary><div className='daily-board-tv-setup'><strong>Update here. Show it on the TV.</strong><p>The TV refreshes saved camera changes every minute. Open this link on the TV computer, sign in to Tech Check, then select Full screen.</p><a href={tvLink} target='_blank' rel='noopener'>Open Tech Check TV Board</a></div>
    <TvBoardControls control={tvSettings}/></details>
    <div className='daily-board-range' aria-label='Board range'><button className={scope==='day'?'active':''} onClick={()=>setScope('day')}>Day</button><button className={scope==='week'?'active':''} onClick={()=>setScope('week')}>Week</button><span>{scope==='day'?'Today + overdue / unscheduled work':'Next 7 days + overdue / unscheduled work'}</span></div>

    <div className='daily-board-toolbar'>
      <label>Technician<select aria-label='Technician' value={person} onChange={e=>{setPerson(e.target.value);setRotation(0);}}><option value=''>Everyone</option>{allPeople.map(p=><option key={p}>{p}</option>)}</select></label>
      <label>Department<select aria-label='Department' value={department} onChange={e=>{setDepartment(e.target.value);setRotation(0);}}><option value=''>All departments</option><option value='it'>IT</option><option value='service'>Service</option></select></label>
      <label className='daily-board-test-toggle'><input type='checkbox' checked={showTest} onChange={e=>setShowTest(e.target.checked)}/>Show test records{hiddenTests>0?' ('+hiddenTests+' hidden)':''}</label>
      <span>Fleet counts · same tiles as the map<br/>{lastSuccess?'Board checked '+lastSuccess.toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'})+' CT':'Waiting for live records'}</span>
    </div>

    {fleetCounts}

    {(error||stale)&&<div className='daily-board-error' role='alert'><strong>{lastSuccess?'Showing the last successful snapshot.':'Live records are unavailable.'}</strong> {error||'Refresh is delayed.'} <button className='secondary' disabled={busy||saving} onClick={()=>void refresh()}>Retry</button></div>}
    {actionError&&<div className='daily-board-error' role='alert'>{actionError}{refreshRequired&&<button className='secondary' disabled={busy||saving} onClick={()=>void refresh()}>Refresh before another assignment</button>}</div>}
    {notice&&<div className='daily-board-notice' role='status'>{notice}</div>}

    <p className='daily-board-note'>Job and task cards are not on this board. The counts above are the same tiles as the fleet map. <span className='cos-in-shop'>In Shop</span> units add 0 and raise no alerts. Missing or stale readings stay Unknown.</p>
    {!tv&&<div className='daily-board-actions'><button className='secondary' onClick={()=>open('Tech Check')}>Truck / trailer readiness</button></div>}

    {selected&&<dialog ref={detail} className='daily-board-detail' aria-label='Work details' onCancel={()=>setSelected(null)}><section>
      <button className='secondary' onClick={()=>setSelected(null)}>Close details</button>
      <small>{String(selected.record.jobType||'HANDOFF').toUpperCase()} · {selected.priority.toUpperCase()}</small>
      <h3>{selected.title}</h3>
      <p>{[selected.reference,selected.site].filter(Boolean).join(' · ')}</p>
      <BoardRecordDetails card={selected} sourceUnavailable={Boolean(error||stale)} close={()=>setSelected(null)}/>
      {selected.record.completionKind!=='visit'&&<DeliveryGoBackSummary job={selected.record}/>}
      <ApprovedBoardActions><button className='secondary' onClick={()=>open('Tech Check')}>Truck / trailer readiness</button></ApprovedBoardActions>
    </section></dialog>}

    {assigning&&<dialog ref={assignDialog} className='daily-board-detail daily-board-assignment' aria-label='Schedule and reassign job' onCancel={event=>{if(saving)event.preventDefault();else setAssigning(null);}}><section>
      <button className='secondary' disabled={saving} onClick={()=>setAssigning(null)}>Close</button>
      <small>MANAGEMENT SCHEDULING</small>
      <h3>{assigning.reference} · {assigning.title}</h3>
      <p>{assigning.site} · {assigning.record.jobType||'COS Job'} · {assigning.record.equipmentUnitTag||assigning.record.equipment||'Equipment pending'}</p>
      {actionError&&<div className='daily-board-error' role='alert'>{actionError}{refreshRequired&&<button className='secondary' disabled={busy||saving} onClick={()=>void refresh()}>Refresh before another assignment</button>}</div>}
      <div className='daily-board-assignment-grid'>
        <label>Service date<input type='date' disabled={saving} value={assignment.date} onChange={e=>setAssignment({...assignment,date:e.target.value})}/></label>
        <label>Start time<input type='time' disabled={saving} value={assignment.startTime} onChange={e=>setAssignment({...assignment,startTime:e.target.value})}/></label>
        <label>End time<input type='time' disabled={saving} value={assignment.endTime} onChange={e=>setAssignment({...assignment,endTime:e.target.value})}/></label>
        <label>Technician<select disabled={saving} value={assignment.technician} onChange={e=>setAssignment({...assignment,technician:e.target.value})}><option value=''>Select technician</option>{technicians.filter(t=>!assigning.department||!t.department||t.department===assigning.department).map(t=><option key={t.name} value={t.name}>{t.name} · {t.department.toUpperCase()}</option>)}</select></label>
      </div>
      <p className='daily-board-assignment-note'>Saving updates the existing production visit. Drag-and-drop never bypasses scheduling or department validation.</p>
      <div className='daily-board-actions'><button className='secondary' disabled={saving} onClick={()=>setAssigning(null)}>Cancel</button><button disabled={busy||saving||refreshRequired||!assignment.technician} onClick={saveAssignment}>{saving?'Saving…':'Save Schedule & Assignment'}</button></div>
    </section></dialog>}
  </section></BoardsDoor>;
}

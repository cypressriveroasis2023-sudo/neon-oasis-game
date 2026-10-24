import CustodyOverview from './CustodyOverview';
import {operationsPlatformEntry} from './operationsPlatformEntry';
import AnimatedEye from './AnimatedEye';
import {fleetVrmReadAllowed} from './fleetDashboardModel';
import { AreaIcon } from './VisionAreas';
import OperationsAreas from './OperationsAreas';
import UnitsOnHand from './UnitsOnHand';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, openLegacy } from './api';
import {useOperationsSession} from './useOperationsSession';
import TodayDashboard from './TodayDashboard';
import TechChecksWorkspace from './TechChecksWorkspace';
import DailyBoard from './DailyBoard';
import FleetDashboard from './FleetDashboard';
import {ownerCensusSessionAllowed} from './ownerCensusOnce';
import UnitTrackerWorkspace from './UnitTrackerWorkspace';
import {trackerAccess} from './unitTracker';
import OwnerBoardControls from './OwnerBoardControls';
import MhelpTicketImport from './MhelpTicketImport';
import type { TicketType } from './ticketTypes';
import {isTicketUnitId} from './ticketContext';
import ProductionAssignments from './ProductionAssignments';
import CameraHealthWorkspace from './CameraHealthWorkspace';
import VrmWorkspace from './VrmWorkspace';
import RouterWorkspace from './RouterWorkspace';
import ITDashboard from './ITDashboard';
import ITDailyDashboard from './ITDailyDashboard';
import {IT_DAILY_ONLY, IT_DAILY_WORKSPACES, itDailyLabel} from '../../it-feature-availability';
import ITMhelpWorkspace from './ITMhelpWorkspace';
import OperationsJobs from './OperationsJobs';
import OperationsCalendar from './OperationsCalendar';
import HandoffsWorkspace from './HandoffsWorkspace';
import DirectoryWorkspace from './DirectoryWorkspace';
import EquipmentWorkspace from './EquipmentWorkspace';
import TeamWorkspace from './TeamWorkspace';
import { QuotesWorkspace, InvoicesWorkspace, PurchasingWorkspace } from './FinanceWorkspaces';
import FleetInventoryOverview from './FleetInventoryOverview';
import TicketActions from './TicketActions';
import OwnerWatchfulShortcut from './OwnerWatchfulShortcut';
import HomeFieldView from './HomeFieldView';
import CosCompactOverview from './CosCompactOverview';
import {areaSelected,itNavigation,ownerAdvancedAreas,ownerNavigation} from './simpleCosNavigation';
import {tvBoardLink} from './tvBoardData';
import './continuation.css';
import { workspaces as nav, itWorkspaces, workspaceLabel, canonicalWorkspace, readWorkspaceRoute, workspaceHash, type WorkspaceRoute } from './workspaceNavigation';

type Row = Record<string, any>;
type NativeWorkspace = 'Today' | 'Daily Board' | 'Fleet Dashboard' | 'Unit Tracker' | 'Owner Tasks' | 'Jobs' | 'Tech Check' | 'Camera Health' | 'InHand Routers' | 'Victron VRM' | 'Unscheduled' | 'Dispatch' | 'Owner Review' | 'Calendar' | 'Handoffs' | 'Customers' | 'Sites' | 'Equipment' | 'Team' | 'Quotes' | 'Invoices' | 'Billing' | 'Purchasing';
const native: NativeWorkspace[] = ["Today","Daily Board","Fleet Dashboard","Unit Tracker","Owner Tasks","Jobs","Tech Check","Camera Health","InHand Routers","Victron VRM","Unscheduled","Dispatch","Owner Review","Calendar","Handoffs","Customers","Sites","Equipment","Team","Quotes","Invoices","Billing","Purchasing"];
const legacy: Record<string,string> = { Vision:'vision' };
const baseFleetWorkspaces = ['Fleet Dashboard','IT Dashboard','InHand Routers','Camera Health','Victron VRM','Unit Tracker','MHelp','Tech Check'];
const referenceUrl = 'https://cos-operations-platform-preview-wpbf1y.v2.appdeploy.ai/';
const descriptions: Record<string,string> = {
  'IT Dashboard':'Your field, connectivity, power, tracker and ticket information in one place.',
  MHelp:'Your existing Tech Check MHelpDesk ticket references and operational details.',
  'Daily Board':'Today’s jobs, assigned tasks, readiness and TV view.',
  'Unit Tracker':'Review current COS units and their 2027 tracker information.',
  'Fleet Dashboard':'Find field units using recorded GPS, installed-site coordinates or their site address.',
  'Units On Hand':'Shop and yard inventory, availability and preparation status.',
  Operations:'Jobs, scheduling, customers and finance in your existing workflows.',
  'Owner Tasks':'Assign auditable daily work to IT and Service technicians.',
  Jobs:'Authoritative COS operational jobs and their current field assignments.',
  Unscheduled:'Schedule and assign native Operations visits.',
  Dispatch:'Review readiness and dispatch assigned field work.',
  'Owner Review':'Review completed work and release eligible jobs to billing.',
  Calendar:'Month, week and year views of scheduled Operations jobs.',
  Handoffs:'Department routing for the next authorized work stage.',
  Customers:'Customer records in the Operations system of record.',
  Sites:'Operational sites and access information.',
  Equipment:'Physical equipment registry and placement.',
  Team:'Existing Operations technicians, workload and readiness.',
  Quotes:'Owner quote review and live document details.',
  Invoices:'Invoice review and issuing.',
  Billing:'Invoice records and Owner approval.',
  Purchasing:'Purchase requests, three-way matching and AP decisions.',
  'Camera Health':'Live camera status and existing diagnostics.',
  'InHand Routers':'Router inventory, IP addresses and timestamped management-port observations.',
  'Victron VRM':'Battery, solar and power dashboards for the connected Victron fleet.',
  'Tech Check':'IT and Service checklists, check assignments and technician access in one place.',
};
const errorMessage = (cause:unknown, fallback:string) => cause instanceof Error ? cause.message : fallback;
const collection = (data:any) => {
  if (!data || !Array.isArray(data.items) || data.items.some((row:any)=>!row||typeof row!=='object'||Array.isArray(row))) throw new Error('Operations returned an incomplete record list.');
  return data.items as Row[];
};
function localInput(value:string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad=(n:number)=>String(n).padStart(2,'0');
  return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())+'T'+pad(date.getHours())+':'+pad(date.getMinutes());
}
type TaskDraft={id?:string;title:string;instructions:string;priority:string;assignedUserId:string;assignedDepartment:string;relatedJobId:string;relatedSiteId:string;dueAt:string;ownerNotes:string};
const emptyTask=():TaskDraft=>({title:'',instructions:'',priority:'medium',assignedUserId:'',assignedDepartment:'it',relatedJobId:'',relatedSiteId:'',dueAt:'',ownerNotes:''});
function OwnerTasksWorkspace({show}:{show:(message:string)=>void}) {
  const [items,setItems]=useState<Row[]|null>(null);
  const [draft,setDraft]=useState<TaskDraft|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [needsRefresh,setNeedsRefresh]=useState(false);
  const [team,setTeam]=useState<Row[]>([]);
  const [sites,setSites]=useState<Row[]>([]);
  const [jobs,setJobs]=useState<Row[]>([]);
  const [optionsError,setOptionsError]=useState('');
  const running=useRef(false);
  const activeTaskReads=useRef(0);
  const revision=useRef(0);
  const refresh=useCallback(async(fromSave=false)=>{
    if(running.current&&!fromSave)return null;
    activeTaskReads.current++;
    const request=++revision.current;
    setLoading(true);
    try { const rows=collection((await api.get('/api/owner-tasks')).data); if(request===revision.current){setItems(rows);setError('');setNeedsRefresh(false);} return rows; }
    catch(cause){if(request===revision.current)setError(errorMessage(cause,'Owner Tasks could not be loaded.'));return null;}
    finally{activeTaskReads.current--;if(request===revision.current)setLoading(false);}
  },[]);
  useEffect(()=>{
    void refresh();
    let live=true;
    void Promise.allSettled([api.get('/api/team-production'),api.get('/api/sites'),api.get('/api/jobs')]).then(results=>{
      if(!live)return;
      const setters=[setTeam,setSites,setJobs];
      const unavailable:string[]=[];
      results.forEach((result,index)=>{
        if(result.status==='fulfilled'){try{setters[index](collection(result.value.data));}catch{unavailable.push(['Technician','Site','Job'][index]);}}
        else unavailable.push(['Technician','Site','Job'][index]);
      });
      setOptionsError(unavailable.length?unavailable.join(', ')+' selections could not be loaded. Department assignments remain available.':'');
    });
    return()=>{live=false;revision.current+=1;};
  },[refresh]);
  const edit=(row:Row)=>setDraft({
    id:String(row.id),title:String(row.title||''),instructions:String(row.instructions||''),priority:String(row.priority||'medium'),
    assignedUserId:String(row.assignedUserId||''),assignedDepartment:row.assignedUserId?'':String(row.assignedDepartment||'it'),
    relatedJobId:String(row.relatedJobId||''),relatedSiteId:String(row.relatedSiteId||''),dueAt:row.dueAt?localInput(String(row.dueAt)):'',ownerNotes:String(row.ownerNotes||''),
  });
  const save=async()=>{
    if(running.current||activeTaskReads.current>0||!draft||needsRefresh)return;
    if(!draft.title.trim()){setError('Task title is required.');return;}
    if(!draft.assignedUserId&&!['it','service'].includes(draft.assignedDepartment)){setError('Select an IT or Service department.');return;}
    const parsedDue=draft.dueAt?new Date(draft.dueAt):null;
    if(parsedDue&&!Number.isFinite(parsedDue.getTime())){setError('Enter a valid due date and time.');return;}
    const dueAt=parsedDue?parsedDue.toISOString():null;
    const payload={...draft,assignedDepartment:draft.assignedUserId?'':draft.assignedDepartment,title:draft.title.trim(),instructions:draft.instructions.trim(),ownerNotes:draft.ownerNotes.trim(),dueAt};
    const previousIds=new Set((items||[]).map(row=>row.id));
    running.current=true;setSaving(true);setError('');setNotice('');
    let accepted=false;
    try {
      const response=await api.post('/api/owner-tasks',payload);
      accepted=true;setDraft(null);
      const fresh=await refresh(true);
      const savedId=response.data?.id||response.data?.taskId||response.data?.task_id||draft.id;
      const candidates=(fresh||[]).filter(row=>savedId?row.id===savedId:!previousIds.has(row.id));
      const confirmed=candidates.length===1&&candidates[0].title===payload.title&&String(candidates[0].instructions||'').trim()===payload.instructions&&candidates[0].priority===payload.priority&&String(candidates[0].assignedUserId||'')===payload.assignedUserId&&String(candidates[0].assignedDepartment||'')===payload.assignedDepartment&&String(candidates[0].relatedJobId||'')===payload.relatedJobId&&String(candidates[0].relatedSiteId||'')===payload.relatedSiteId&&String(candidates[0].ownerNotes||'').trim()===payload.ownerNotes&&(!dueAt?!candidates[0].dueAt:Date.parse(candidates[0].dueAt)===Date.parse(dueAt));
      if(!confirmed){setNeedsRefresh(true);setError('Save accepted, but the task could not be verified. Refresh Owner Tasks before saving again.');return;}
      setNotice('Owner Task saved and verified.');show('Owner Task saved and verified.');
      window.dispatchEvent(new Event('cos-board-updated'));
    } catch(cause) {
      setNeedsRefresh(true);
      setError(accepted?'Save accepted, but confirmation is unavailable. Refresh Owner Tasks before saving again.':errorMessage(cause,'The task save could not be confirmed. Refresh before trying again.'));
    } finally {running.current=false;setSaving(false);}
  };
  const set=(key:keyof TaskDraft,value:string)=>setDraft(current=>current?{...current,[key]:value}:current);
  const open=(items||[]).filter(row=>!['complete','cancelled'].includes(row.status));
  return <section className='panel module owner-task-workspace' aria-label='Owner Tasks'>
    <div className='panelhead'><h2>Owner Tasks</h2><button className='secondary' disabled={loading||saving} onClick={()=>void refresh()}>{loading?'Refreshing…':'Refresh tasks'}</button></div>
    <div className='purchase-actions'><button disabled={saving||loading||needsRefresh} onClick={()=>{setDraft(emptyTask());setError('');}}>+ New Owner Task</button><span>{items?open.length+' open · '+open.filter(row=>row.priority==='high').length+' high priority':'Task counts unavailable'}</span></div>
    {error&&<div className='operations-error' role='alert'>{error}</div>}{notice&&<p className='operations-notice' role='status'>{notice}</p>}
    {draft&&<section className='quote-card directory-editor'><div className='quote-section-head'><div><h3>{draft.id?'Edit':'New'} Owner Task</h3><small>Assigned work remains auditable after completion.</small></div><div><button className='secondary' disabled={saving} onClick={()=>setDraft(null)}>Cancel</button><button disabled={saving||loading||needsRefresh} onClick={()=>void save()}>{saving?'Saving…':'Save task'}</button></div></div>
      {optionsError&&<p role='status'>{optionsError}</p>}
      <div className='quote-detail-grid'>
        <label>Task Title *<input disabled={saving} value={draft.title} onChange={event=>set('title',event.target.value)}/></label>
        <label>Priority<select disabled={saving} value={draft.priority} onChange={event=>set('priority',event.target.value)}><option value='high'>High</option><option value='medium'>Medium</option><option value='low'>Low</option></select></label>
        <label>Technician<select disabled={saving} value={draft.assignedUserId} onChange={event=>setDraft(current=>current?{...current,assignedUserId:event.target.value,assignedDepartment:event.target.value?'':current.assignedDepartment||'it'}:current)}><option value=''>Assign by department</option>{draft.assignedUserId&&!team.some(row=>row.userId===draft.assignedUserId)&&<option value={draft.assignedUserId}>Current assigned technician</option>}{team.filter(row=>row.active&&['it','service'].includes(String(row.department).toLowerCase())).map(row=><option key={row.userId} value={row.userId}>{row.displayName||row.name}</option>)}</select></label>
        <label>Department<select disabled={saving||Boolean(draft.assignedUserId)} value={draft.assignedDepartment} onChange={event=>set('assignedDepartment',event.target.value)}><option value='it'>IT</option><option value='service'>Service</option></select></label>
        <label>Due Date / Time (your local time)<input disabled={saving} type='datetime-local' value={draft.dueAt} onChange={event=>set('dueAt',event.target.value)}/></label>
        <label>Related Job<select disabled={saving} value={draft.relatedJobId} onChange={event=>set('relatedJobId',event.target.value)}><option value=''>No job</option>{draft.relatedJobId&&!jobs.some(row=>row.id===draft.relatedJobId)&&<option value={draft.relatedJobId}>Current related job</option>}{jobs.filter(row=>row.status!=='Closed').map(row=><option key={row.id} value={row.id}>{row.jobNumber} · {row.customer}</option>)}</select></label>
        <label>Related Site<select disabled={saving} value={draft.relatedSiteId} onChange={event=>set('relatedSiteId',event.target.value)}><option value=''>No site</option>{draft.relatedSiteId&&!sites.some(row=>row.id===draft.relatedSiteId)&&<option value={draft.relatedSiteId}>Current related site</option>}{sites.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className='wide'>Detailed Instructions<textarea disabled={saving} value={draft.instructions} onChange={event=>set('instructions',event.target.value)}/></label>
        <label className='wide'>Owner Notes<textarea disabled={saving} value={draft.ownerNotes} onChange={event=>set('ownerNotes',event.target.value)}/></label>
      </div>
    </section>}
    {!items&&!error?<p role='status'>Loading Owner Tasks…</p>:<div className='records'>{(items||[]).map(row=><button disabled={saving} type='button' className='record op-record' key={row.id} onClick={()=>edit(row)}><div><strong>{row.title}</strong><small>{String(row.priority||'').toUpperCase()} · {row.assignedTo||String(row.assignedDepartment||'').toUpperCase()} · {row.jobNumber||row.siteName||'General'}{row.dueAt?' · Due '+new Date(row.dueAt).toLocaleString():''}</small></div><em>{String(row.status||'').replaceAll('_',' ').toUpperCase()}</em></button>)}{items?.length===0&&<p>No Owner Tasks in the current records. Create a daily assignment for IT or Service.</p>}</div>}
  </section>;
}
function OwnerApp() {
  const [registerUnitName,setRegisterUnitName]=useState('');
  const [heliosUnit,setHeliosUnit]=useState(1);
  // Keep old layout bookmarks compatible with the single responsive workspace.
  useEffect(()=>{
    const url=new URL(location.href);
    if(url.searchParams.get('theme')==='vision'){
      url.searchParams.delete('theme');
      history.replaceState(history.state,'',url);
    }
  },[]);
  const [route,setRoute]=useState(readWorkspaceRoute);
  const [fleetEntryRevision,setFleetEntryRevision]=useState(0);
  const [trackerConnectionOpen,setTrackerConnectionOpen]=useState(false);
  const [tvDisplay,setTvDisplay]=useState(()=>new URLSearchParams(location.search).get('tvBoard')==='1');
  const lastRouteHash=useRef(location.hash);
  // Current role-scoped routes; a direct hash edit must never mount a paused workspace.
  const allowedFleetRoutes=useRef<string[]|null>(null);
  const active=route.workspace;
  useEffect(()=>{if(/^#(?:field-map|field-view)(?:\?|$)/.test(location.hash)){const hash=workspaceHash(route);history.replaceState(history.state,'',hash);lastRouteHash.current=hash;}},[route]);
  useEffect(()=>{
    if(window.parent!==window)window.parent.postMessage({type:'COS_OPERATIONS_WORKSPACE_ACTIVE',workspace:active},location.origin);
  },[active]);
  const focusedJob=route.jobId;
  const setRouteLocation=useCallback((next:WorkspaceRoute,replace=false,state:unknown=null)=>{
    const hash=workspaceHash(next);
    lastRouteHash.current=hash;
    if(location.hash!==hash){
      window.dispatchEvent(new Event('cos-workspace-navigation'));
      if(replace)history.replaceState(state,'',hash);else history.pushState(state,'',hash);
    }
    setRoute({...next,workspace:canonicalWorkspace(next.workspace)});
  },[]);
  useEffect(()=>{
    const returnToChecks=(event:MessageEvent)=>{
      if(window.parent===window||event.origin!==location.origin||event.source!==window.parent||event.data?.type!=='COS_OPERATIONS_TECH_CHECK_HOME')return;
      setMenu(false);
      setRouteLocation({workspace:'Tech Check',jobId:'',detail:false},true);
    };
    window.addEventListener('message',returnToChecks);
    return()=>window.removeEventListener('message',returnToChecks);
  },[setRouteLocation]);
  const {session, checking, error:sessionError, reloadRequired, generation:sessionGeneration, check, guardCurrent}=useOperationsSession(()=>{
    setMenu(false);setToast('');setRegisterUnitName('');setHeliosUnit(1);setTvDisplay(false);
    setRouteLocation({workspace:active,jobId:'',detail:false},true);
    // Discard selection/history payloads as well as the mounted private views.
    history.replaceState(null,'',location.href);
  });
  // DailyBoard owns the host display lifecycle. Keep its guarded notification
  // stable within this session so an ordinary shell render cannot simulate exit.
  const onTvChange=useCallback(guardCurrent(setTvDisplay),[guardCurrent]);
  const dailyOnly=IT_DAILY_ONLY&&(session?.legacyOwner===false&&session?.features?.fleetAccess===true||['fleet','it-daily'].includes(new URLSearchParams(location.search).get('mode')||''));
  const fleetWorkspaces = useMemo(()=>(dailyOnly?[...IT_DAILY_WORKSPACES]:baseFleetWorkspaces).filter(name=>(name!=='Unit Tracker'||trackerAccess(session))&&(name!=='Victron VRM'||session?.features?.vrmRead===true)),[session,dailyOnly]);
  const fleetOnly=session?.authorized===true&&(dailyOnly||session?.legacyOwner===false&&session?.features?.fleetAccess===true);
  allowedFleetRoutes.current=fleetOnly?fleetWorkspaces:null;
  const label=(name:string)=>({'COS Overview':'Overview','Units On Hand':'Inventory & Transfers','Fleet Dashboard':'Fleet Map','Victron VRM':'Power & Routers','InHand Routers':'Power & Routers',Team:'Team & Tech Check'} as Record<string,string>)[name]||(dailyOnly?itDailyLabel(name):workspaceLabel(name));
  const [now,setNow]=useState(()=>new Date());
  const [toast,setToast]=useState('');
  const [menu,setMenu]=useState(false);
  const menuRef=useRef<HTMLElement|null>(null);
  const openMenu=useCallback(()=>{setMenu(true);},[]);
  useEffect(()=>{
    if(!menu)return;
    const previous=document.activeElement as HTMLElement|null;
    const panel=menuRef.current;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    panel?.querySelector<HTMLButtonElement>('.operations-menu-close')?.focus();
    const keyboard=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();setMenu(false);}
      if(event.key==='Tab'&&panel){
        const controls=Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled)')).filter(element=>element.getClientRects().length>0);
        const first=controls[0],last=controls[controls.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    window.addEventListener('keydown',keyboard);
    return()=>{window.removeEventListener('keydown',keyboard);document.body.style.overflow=previousOverflow;if(previous?.isConnected)previous.focus();};
  },[menu]);
  const [weather,setWeather]=useState<Row|null>(null);
  const [weatherStatus,setWeatherStatus]=useState('Local weather');
  const toastTimer=useRef<number|null>(null);
  const show=useCallback(guardCurrent((message:string)=>{setToast(message);if(toastTimer.current!==null)window.clearTimeout(toastTimer.current);toastTimer.current=window.setTimeout(()=>setToast(''),5000);}),[guardCurrent]);
  useEffect(()=>{document.documentElement.dataset.theme='dark';localStorage.setItem('cos-operations-pages-theme','dark');},[]);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(new Date()),30000);const change=()=>{
      if(lastRouteHash.current===location.hash)return;
      const next=readWorkspaceRoute();
      const allowed=allowedFleetRoutes.current;
      if(allowed&&!allowed.includes(next.workspace)){
        const safe={workspace:'Fleet Dashboard',jobId:'',detail:false};
        const hash=workspaceHash(safe);
        lastRouteHash.current=hash;
        history.replaceState(null,'',hash);
        setRoute(safe);
        window.dispatchEvent(new Event('cos-workspace-navigation'));
        return;
      }
      lastRouteHash.current=location.hash;
      window.dispatchEvent(new Event('cos-workspace-navigation'));
      setRoute(next);
    };window.addEventListener('hashchange',change);window.addEventListener('popstate',change);return()=>{window.clearInterval(timer);window.removeEventListener('hashchange',change);window.removeEventListener('popstate',change);if(toastTimer.current!==null)window.clearTimeout(toastTimer.current);};},[]);
  const requestWeather=useCallback(()=>{
    if(!navigator.geolocation){setWeatherStatus('Location unavailable');return;}
    setWeatherStatus('Locating…');
    navigator.geolocation.getCurrentPosition(async position=>{
      try{const response=await fetch('https://api.open-meteo.com/v1/forecast?latitude='+position.coords.latitude+'&longitude='+position.coords.longitude+'&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto');if(!response.ok)throw new Error('Weather unavailable');const data=await response.json();if(!data.current||!Number.isFinite(data.current.temperature_2m))throw new Error('Weather unavailable');setWeather(data.current);setWeatherStatus('Current location');}catch{setWeather(null);setWeatherStatus('Weather unavailable');}
    },()=>{setWeather(null);setWeatherStatus('Enable local weather');},{enableHighAccuracy:false,timeout:10000,maximumAge:300000});
  },[]);
  const navigate=useCallback(guardCurrent((name:string)=>{
    name=canonicalWorkspace(name);
    setTrackerConnectionOpen(false);
    setMenu(false);
    if(fleetOnly&&!fleetWorkspaces.includes(name))return;
    if(legacy[name]){openLegacy(legacy[name]);return;}
    const next=name==='COS Overview'||nav.includes(name)||fleetOnly&&itWorkspaces.includes(name)?name:'Fleet Dashboard';
    if(next==='Camera Health'||next==='Fleet Dashboard')setFleetEntryRevision(value=>value+1);
    setRouteLocation({workspace:next,jobId:'',detail:false},active==='Operations');
    window.scrollTo({top:0,behavior:'instant'});
  }),[guardCurrent,setRouteLocation,active,fleetOnly,fleetWorkspaces]);
  const openUnitHealth=useCallback(guardCurrent((unitId:string)=>{
    setMenu(false);
    if(active==='Fleet Dashboard')setRouteLocation({workspace:'Fleet Dashboard',jobId:'',detail:false,unitId},true,history.state);
    setRouteLocation({workspace:'Camera Health',jobId:'',detail:false,unitId},false,active==='Fleet Dashboard'?{cosUnitHealthFromMap:unitId}:null);
    window.scrollTo({top:0,behavior:'instant'});
  }),[guardCurrent,active,setRouteLocation]);
  const returnToMap=useCallback(guardCurrent((unitId:string)=>{
    setMenu(false);
    if(history.state?.cosUnitHealthFromMap===unitId)history.back();
    else{setRouteLocation({workspace:'Fleet Dashboard',jobId:'',detail:false,unitId});window.scrollTo({top:0,behavior:'instant'});}
  }),[guardCurrent,setRouteLocation]);
  const createTicket=useCallback(guardCurrent((createType:TicketType,unitId?:string)=>{
    setMenu(false);
    // A label route reaches this callback only after the shared drawer resolves one saved unit.
    const fromUnitHealth=isTicketUnitId(unitId)&&(['Camera Health','Fleet Dashboard'].includes(active)&&route.unitId===unitId||active==='Fleet Dashboard'&&!route.unitId&&Boolean(route.unitLabel));
    setRouteLocation({workspace:'Daily Board',jobId:'',detail:false,createType,...(unitId?{unitId}:{})},false,fromUnitHealth?{cosTicketFromUnitHealth:unitId}:null);
    window.scrollTo({top:0,behavior:'instant'});
  }),[guardCurrent,setRouteLocation,active,route.unitId,route.unitLabel]);
  const cancelCreateTicket=useCallback(guardCurrent(()=>{
    if(route.unitId){if(history.state?.cosTicketFromUnitHealth===route.unitId)history.back();else openUnitHealth(route.unitId);}
    else navigate('Today');
  }),[guardCurrent,route.unitId,openUnitHealth,navigate]);
  const openJob=useCallback(guardCurrent((id:string,workspace:'Jobs'|'Unscheduled'|'Owner Review'|'Dispatch'='Jobs')=>{
    setMenu(false);
    setRouteLocation({workspace,jobId:id,detail:false});
    window.scrollTo({top:0,behavior:'instant'});
  }),[guardCurrent,setRouteLocation]);
  const selectOverviewJob=useCallback(guardCurrent((id:string)=>{
    const list={workspace:'Today',jobId:id,detail:false};
    setRouteLocation(list,true);
    setRouteLocation({...list,detail:true},false,{cosOverviewDetail:true});
    if(window.matchMedia('(max-width:700px)').matches)window.scrollTo({top:0,behavior:'instant'});
  }),[guardCurrent,setRouteLocation]);
  const openLifecycle=useCallback(guardCurrent((id:string)=>{
    setMenu(false);
    setRouteLocation({workspace:'Today',jobId:id,detail:true},false,{cosOverviewDetail:true,cosLifecycleOrigin:'Jobs'});
    window.scrollTo({top:0,behavior:'instant'});
  }),[guardCurrent,setRouteLocation]);
  const backToOverviewJobs=useCallback(guardCurrent(()=>{
    if(history.state?.cosOverviewDetail)history.back();
    else setRouteLocation({workspace:'Today',jobId:route.jobId,detail:false},true);
  }),[guardCurrent,route.jobId,setRouteLocation]);
  const authorized=session?.authorized===true;
  const standaloneEntry=window.parent===window?operationsPlatformEntry(location.pathname):null;
  useEffect(()=>{
    if(fleetOnly&&!fleetWorkspaces.includes(active)) setRouteLocation({workspace:'Fleet Dashboard',jobId:'',detail:false},true);
  },[fleetOnly,dailyOnly,active,setRouteLocation,fleetWorkspaces]);
  const condition=weather?(weather.weather_code===0?'Clear':weather.weather_code<=3?'Partly cloudy':weather.weather_code<=48?'Fog':weather.weather_code<=67?'Rain':weather.weather_code<=77?'Wintry':weather.weather_code<=82?'Showers':'Storms'):'Weather unavailable';
  const asset=(path:string)=>import.meta.env.BASE_URL+'resources/'+path;
  const simpleAreas=fleetOnly||dailyOnly?itNavigation(fleetWorkspaces):ownerNavigation(trackerAccess(session));
  const ownerInitials=String(session?.name||'Owner').split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
  return <div className={'shell operations-shell company-shell'+(active==='Fleet Dashboard'?' operations-field-view':'')}>
    {menu&&<button type='button' className='operations-menu-backdrop' aria-label='Dismiss menu' tabIndex={-1} onClick={()=>setMenu(false)}/>}
    <aside ref={menuRef} role={menu?'dialog':undefined} aria-modal={menu?true:undefined} className={'operations-sidebar'+(menu?' operations-sidebar-open':'')} aria-label='Operations navigation'>
      <div className='company-brand'><AnimatedEye full/></div>
      <button type='button' className='secondary operations-menu-close' onClick={()=>setMenu(false)}>Close menu <span aria-hidden='true'>×</span></button>
      <p className='company-nav-heading'>Your workspace</p>
      <nav className='operations-area-nav' aria-label='COS Operations'>{simpleAreas.map(area=><button type='button' key={area.workspace} className={areaSelected(active,area.workspace)?'active':''} onClick={()=>navigate(area.workspace)} aria-current={areaSelected(active,area.workspace)?'page':undefined}><AreaIcon name={area.icon}/>{area.label}</button>)}</nav>
       {authorized&&!fleetOnly&&!dailyOnly&&session?.role==='Owner'&&<>
         <a className='cos-tv-mode-link' href={tvBoardLink(window.parent!==window?window.parent.location.href:location.href,'day','')} target='_blank' rel='noopener noreferrer'>TV Mode ↗</a>
         <details className='cos-owner-advanced'><summary>Advanced · Owner only</summary><div>{ownerAdvancedAreas.map(area=><button type='button' key={area.workspace} onClick={()=>navigate(area.workspace)}>{area.label}</button>)}</div></details>
       </>}
       <div className='company-sidebar-footer'><div className='company-sidebar-actions'><button type='button' onClick={()=>{setMenu(false);openLegacy('logout');}}>Sign out</button></div><div className='company-owner'><span aria-hidden='true'>{ownerInitials}</span><div><strong>{session?.name||'Owner'}</strong><small>COS workspace</small></div></div></div>
     </aside>
    <main className='owner-it-main' inert={menu}>
      <section className='company-utility-bar' aria-label='Workspace utilities'>
        <div className='company-mobile-brand'><AnimatedEye full/></div><span className='company-breadcrumb'>{route.createType?'Create ticket':label(active)}</span>
       
        <span className={'company-connection'+(!authorized?' company-connection-pending':'')} role='status'><i aria-hidden='true'/>{authorized?'OPERATIONS CONNECTED':checking?'VERIFYING ACCESS':'ACCESS UNAVAILABLE'}</span>
        <button type='button' className='operations-open-menu' aria-label='More' aria-expanded={menu} onClick={openMenu}>Menu <span aria-hidden='true'>☰</span></button>
      </section>

      {active!=='Today'&&active!=='IT Dashboard'&&active!=='Fleet Dashboard'&&(active!=='Camera Health'||route.diagnostics)&&!route.createType&&<header className='command-page-header'><div><label>{active==='Fleet Dashboard'?'FIELD ASSET LOCATION':active==='Daily Board'?'DAILY OPERATIONS':'COS OPERATIONS'}</label><h1>{label(active)}</h1><p>{descriptions[active]||'Open this existing Operations workspace in AppDeploy.'}</p></div></header>}
      {checking&&!session?<section className='panel module' role='status'><p>{sessionError||'Verifying your current Operations account…'}</p><button type='button' onClick={()=>window.location.reload()}>Reload app</button></section>:!authorized?<section className='panel module operations-access' role='alert'><h2>{standaloneEntry?'Open COS from its sign-in page':'Operations access needs attention'}</h2><p>{standaloneEntry?'This Operations page needs your signed-in COS platform. Open the sign-in page on this same site, then enter your workspace.':session?.reason||sessionError||'This Owner account is not linked to COS Operations.'}</p><div className='purchase-actions'>{standaloneEntry?<a className='button' href={standaloneEntry}>Open COS sign-in</a>:reloadRequired?<button type='button' onClick={()=>window.location.reload()}>Reload COS Operations</button>:!reloadRequired&&<button onClick={()=>void check()} disabled={checking}>{checking?'Checking…':'Retry Operations access'}</button>}</div>{!standaloneEntry&&!dailyOnly&&<TechChecksWorkspace/>}</section>
        :<Fragment key={sessionGeneration}>{fleetOnly&&!fleetWorkspaces.includes(active)?<p role='status'>Opening Fleet Dashboard…</p>:active==='IT Dashboard'?(dailyOnly?<ITDailyDashboard session={session} navigate={navigate}/>:<ITDashboard session={session} navigate={navigate}/>):active==='MHelp'?<ITMhelpWorkspace/>:active==='COS Overview'?<CosCompactOverview session={session!} navigate={navigate}/>
        :active==='Today'?<>{!route.detail&&<>{!fleetOnly&&<HomeFieldView open={()=>navigate('Fleet Dashboard')}/>}<FleetInventoryOverview navigate={navigate}/><nav className='cos-daily-shortcuts' aria-label='Daily work shortcuts'><button onClick={()=>navigate('Daily Board')}>Today’s work</button><button onClick={()=>navigate('Units On Hand')}>Shop / ROOT</button><button onClick={()=>openLegacy('it')}>IT check out / check in</button><button onClick={()=>openLegacy('service')}>Service work & returns</button>{trackerAccess(session)&&<button onClick={()=>navigate('Unit Tracker')}>2027 Unit Tracker</button>}</nav><TicketActions createTicket={createTicket}/>{!fleetOnly&&!dailyOnly&&session?.role==='Owner'&&<OwnerWatchfulShortcut/>}</>}<TodayDashboard setActive={navigate} openJob={openJob} openUnit={guardCurrent(unit=>{setHeliosUnit(unit);navigate('Victron VRM');})} selectedJobId={route.jobId} detailOpen={route.detail} selectJob={selectOverviewJob} backToJobs={backToOverviewJobs}/></>
        :active==='Operations'?<OperationsAreas navigate={navigate}/>
        :active==='Units On Hand'?<><section className='panel module' aria-label='Inventory transfers'><h2>Equipment transfers</h2><p>Choose the existing signed handoff process. A transfer remains pending until the correct person accepts it.</p><div className='cos-simple-actions'><button type='button' onClick={()=>openLegacy('it')}>IT: Check out / Check in</button><button type='button' onClick={()=>openLegacy('service')}>Service: Receive / Return</button><button type='button' onClick={()=>openLegacy('handoffs')}>Review pending handoffs</button></div></section>{session?.role==='Owner'&&<CustodyOverview/>}<UnitsOnHand api={api} navigate={navigate} openUnit={guardCurrent(unitId=>setRouteLocation({workspace:'Fleet Dashboard',jobId:'',detail:false,unitId}))}/></>
        :active==='Daily Board'?<>{!route.createType&&<DailyBoard api={api} openWorkspace={navigate} onTvChange={onTvChange} createTicket={createTicket}/>} {!tvDisplay&&(route.createType?<OwnerBoardControls key={'create-ticket-'+(route.unitId||'')} show={show} createType={route.createType} unitId={route.unitId} cancelCreateLabel={route.unitId?'Back to unit health':'Back to dashboard'} cancelCreate={cancelCreateTicket} openCreatedJob={id=>openJob(id,'Unscheduled')}/>:<details className='cos-workspace-settings'><summary>Owner tools · import, create and manage jobs</summary>{session?.features?.mhelpTicketImport===true&&<MhelpTicketImport show={show} openJob={id=>openJob(id,'Unscheduled')}/>}<OwnerBoardControls key='board-controls' show={show} unitId={route.unitId} cancelCreateLabel='Back to dashboard' cancelCreate={cancelCreateTicket} openCreatedJob={id=>openJob(id,'Unscheduled')}/></details>)}</>
        :(active==='Fleet Dashboard'||active==='Camera Health'&&(!route.diagnostics||dailyOnly))?<FleetDashboard session={session!} navigate={navigate} openMhelpConnection={guardCurrent(()=>{navigate('Unit Tracker');setTrackerConnectionOpen(true);})} initialView={active==='Camera Health'?'fleet':'map'} entryRevision={fleetEntryRevision} openAdvancedDiagnostics={!fleetOnly&&!dailyOnly?guardCurrent(()=>setRouteLocation({workspace:'Camera Health',jobId:'',detail:false,diagnostics:true,...(route.unitId?{unitId:route.unitId}:{})})):undefined} createTicket={fleetOnly?undefined:createTicket} initialUnitId={route.unitId} initialUnitLabel={route.unitLabel} onSelectUnit={guardCurrent(unitId=>setRouteLocation({workspace:active==='Camera Health'?'Camera Health':'Fleet Dashboard',jobId:'',detail:false,...(unitId?{unitId}:{})},true,history.state))} show={show} openUnitHealth={openUnitHealth} historyReadEnabled={!fleetOnly} locationWritesEnabled={!fleetOnly&&!dailyOnly&&session?.features?.fieldLocationVerification===true} ownerManagementEnabled={!fleetOnly&&!dailyOnly} ownerCensusEnabled={!fleetOnly&&!dailyOnly&&ownerCensusSessionAllowed(session)} registerEquipment={guardCurrent(name=>{setRegisterUnitName(name);navigate('Equipment');})}/>
        :active==='Unit Tracker'?<UnitTrackerWorkspace session={session} show={show} initialConnectionOpen={trackerConnectionOpen} initialUnitId={route.unitId} onSelectUnit={guardCurrent(unitId=>setRouteLocation({workspace:'Unit Tracker',jobId:'',detail:false,unitId},true))} openMap={guardCurrent(unitId=>setRouteLocation({workspace:'Fleet Dashboard',jobId:'',detail:false,unitId}))} openHealth={openUnitHealth}/>
        :active==='Owner Tasks'?<OwnerTasksWorkspace show={show}/>
        :active==='Jobs'?<OperationsJobs key='jobs' mode='jobs' show={show} openLifecycle={openLifecycle} initialJobId={focusedJob} clearFocusedJob={guardCurrent(()=>setRouteLocation({workspace:'Jobs',jobId:'',detail:false},true))}/>
        :active==='Unscheduled'?<OperationsJobs key='unscheduled' mode='unscheduled' show={show} initialJobId={focusedJob} clearFocusedJob={guardCurrent(()=>setRouteLocation({workspace:'Unscheduled',jobId:'',detail:false},true))}/>
        :active==='Dispatch'?<OperationsJobs key='dispatch' mode='dispatch' show={show} initialJobId={focusedJob} clearFocusedJob={guardCurrent(()=>setRouteLocation({workspace:'Dispatch',jobId:'',detail:false},true))}/>
        :active==='Owner Review'?<OperationsJobs key='review' mode='review' show={show} legacyInstallEvidenceEnabled={session?.features?.legacyInstallEvidence===true} initialJobId={focusedJob} clearFocusedJob={guardCurrent(()=>setRouteLocation({workspace:'Owner Review',jobId:'',detail:false},true))}/>
        :active==='Calendar'?<OperationsCalendar show={show}/>
        :active==='Handoffs'?<HandoffsWorkspace show={show}/>
        :active==='Customers'||active==='Sites'?<DirectoryWorkspace kind={active} show={show}/>
        :active==='Equipment'?<EquipmentWorkspace show={show} initialUnitName={registerUnitName}/>
        :active==='Team'?<><nav className='cos-section-switcher' aria-label='Technician views'><button type='button' aria-current='page'>Team overview</button><button type='button' onClick={()=>navigate('Tech Check')}>Tech Checks & transfers</button></nav><TeamWorkspace show={show} openWorkspace={navigate}/></>
        :active==='Quotes'?<QuotesWorkspace show={show}/>
        :active==='Invoices'||active==='Billing'?<InvoicesWorkspace show={show}/>
        :active==='Purchasing'?<PurchasingWorkspace show={show}/>
        :active==='Tech Check'?(fleetOnly?<section className='panel module'><h2>Inventory & Transfers</h2><p>Use your existing IT account to check equipment out or receive returned equipment.</p><button type='button' onClick={()=>openLegacy('it')}>Open IT equipment transfers</button></section>:<><nav className='cos-section-switcher' aria-label='Technician views'><button type='button' onClick={()=>navigate('Team')}>Team overview</button><button type='button' aria-current='page'>Tech Checks & transfers</button></nav><TechChecksWorkspace/></>)
        :active==='Camera Health'?<CameraHealthWorkspace powerReadEnabled={fleetVrmReadAllowed(session||{})} initialUnitId={route.unitId} backToMap={returnToMap} createTicket={fleetOnly?undefined:createTicket} canEditPlacement={session?.features?.fleetPlacementEdit===true} canEditConnection={session?.features?.fleetConnectionEdit===true} canReviewIdentity={session?.features?.ownerIdentityReview===true}/>
        :active==='InHand Routers'?<><nav className='cos-section-switcher' aria-label='Power and router tabs'>{(!fleetOnly||fleetWorkspaces.includes('Victron VRM'))&&<button type='button' onClick={()=>navigate('Victron VRM')}>Victron Power</button>}<button type='button' aria-current='page'>InHand Routers</button></nav><RouterWorkspace openMap={guardCurrent(unitId=>setRouteLocation({workspace:'Fleet Dashboard',jobId:'',detail:false,unitId}))}/></>
        :active==='Victron VRM'?<><nav className='cos-section-switcher' aria-label='Power and router tabs'><button type='button' aria-current='page'>Victron Power</button>{(!fleetOnly||fleetWorkspaces.includes('InHand Routers'))&&<button type='button' onClick={()=>navigate('InHand Routers')}>InHand Routers</button>}</nav><VrmWorkspace canDiscover={!fleetOnly} initialUnit={heliosUnit} initialInstallationId={route.installationId} onSelectInstallation={guardCurrent(installationId=>setRouteLocation({workspace:'Victron VRM',jobId:'',detail:false,installationId},true))}/></>
        :<section className='panel module operations-reference' aria-label={active+' workspace'}><h2>{active}</h2><p>This workspace remains available in AppDeploy COS Operations. Open the platform and select <b>{active}</b> from its navigation. AppDeploy may ask you to sign in separately.</p><a className='operations-reference-link' href={referenceUrl} target='_blank' rel='noopener noreferrer'>Open AppDeploy COS Operations ↗</a><p>Your existing IT and Service workspaces remain accessible here.</p><button className='secondary' onClick={()=>navigate('Today')}>Back to Overview</button></section>}</Fragment>}
    </main>
    <nav className='operations-bottom-nav' aria-label='Mobile Operations navigation' inert={menu}>{(dailyOnly?[{label:'Fleet Dashboard',workspace:'Fleet Dashboard'},{label:'Camera Health',workspace:'Camera Health'}]:fleetOnly?[{label:'Fleet Dashboard',workspace:'Fleet Dashboard'},{label:'IT overview',workspace:'IT Dashboard'},{label:'Tech Checks',workspace:'Tech Check'}]:[{label:'Overview',workspace:'COS Overview'},{label:'Inventory',workspace:'Units On Hand'},{label:'Cameras',workspace:'Camera Health'}]).filter(area=>!fleetOnly||fleetWorkspaces.includes(area.workspace)).map(area=><button type='button' key={area.workspace} className={active===area.workspace?'active':''} aria-current={active===area.workspace?'page':undefined} onClick={()=>navigate(area.workspace)}>{area.label}</button>)}<button type='button' aria-label='More' aria-expanded={menu} onClick={openMenu}>Menu</button></nav>
    {toast&&<div className='toast operations-toast' role='status'>{toast}</div>}
  </div>;
}

export default function App() {
  return new URLSearchParams(location.search).get('mode') === 'production-assignments' ? <ProductionAssignments/> : <OwnerApp/>;
}

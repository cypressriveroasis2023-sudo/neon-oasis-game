import AnimatedEye from './AnimatedEye';
import VisionAreas, { AreaIcon, primaryWorkspace } from './VisionAreas';
import OperationsAreas from './OperationsAreas';
import UnitsOnHand from './UnitsOnHand';
import { primaryAreas } from './visionAreas';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, openLegacy } from './api';
import TodayDashboard from './TodayDashboard';
import TechChecksWorkspace from './TechChecksWorkspace';
import DailyBoard from './DailyBoard';
import FieldMap from './FieldMap';
import OwnerBoardControls from './OwnerBoardControls';
import TicketActions from './TicketActions';
import HomeFieldView from './HomeFieldView';
import MhelpTicketImport from './MhelpTicketImport';
import type { TicketType } from './ticketTypes';
import ProductionAssignments from './ProductionAssignments';
import CameraHealthWorkspace from './CameraHealthWorkspace';
import VrmWorkspace from './VrmWorkspace';
import RouterWorkspace from './RouterWorkspace';
import OperationsJobs from './OperationsJobs';
import OperationsCalendar from './OperationsCalendar';
import HandoffsWorkspace from './HandoffsWorkspace';
import DirectoryWorkspace from './DirectoryWorkspace';
import EquipmentWorkspace from './EquipmentWorkspace';
import TeamWorkspace from './TeamWorkspace';
import { QuotesWorkspace, InvoicesWorkspace, PurchasingWorkspace } from './FinanceWorkspaces';
import './continuation.css';
import { workspaces as nav, workspaceGroups, workspaceLabel, workspaceGroup, readWorkspaceRoute, workspaceHash, type WorkspaceRoute } from './workspaceNavigation';

type Row = Record<string, any>;
type NativeWorkspace = 'Today' | 'Daily Board' | 'Field Map' | 'Owner Tasks' | 'Jobs' | 'Tech Check' | 'Camera Health' | 'InHand Routers' | 'Victron VRM' | 'Unscheduled' | 'Dispatch' | 'Owner Review' | 'Calendar' | 'Handoffs' | 'Customers' | 'Sites' | 'Equipment' | 'Team' | 'Quotes' | 'Invoices' | 'Billing' | 'Purchasing';
const native: NativeWorkspace[] = ["Today","Daily Board","Field Map","Owner Tasks","Jobs","Tech Check","Camera Health","InHand Routers","Victron VRM","Unscheduled","Dispatch","Owner Review","Calendar","Handoffs","Customers","Sites","Equipment","Team","Quotes","Invoices","Billing","Purchasing"];
const legacy: Record<string,string> = { Vision:'vision' };
const fleetWorkspaces = ['Camera Health','Field Map','InHand Routers','Tech Check'];
const referenceUrl = 'https://cos-operations-platform-preview-wpbf1y.v2.appdeploy.ai/';
const descriptions: Record<string,string> = {
  'Daily Board':'Today’s jobs, assigned tasks, readiness and TV view.',
  'Field Map':'Find field units using recorded GPS, installed-site coordinates or their site address.',
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
  'Victron VRM':'Battery, solar and power dashboards for Helios units 1–9.',
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
  const [mapUnitId, setMapUnitId] = useState('');
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
  const active=route.workspace;
  useEffect(()=>{
    if(window.parent!==window)window.parent.postMessage({type:'COS_OPERATIONS_WORKSPACE_ACTIVE',workspace:active},location.origin);
  },[active]);
  const group=workspaceGroup(active);
  const focusedJob=route.jobId;
  const setRouteLocation=useCallback((next:WorkspaceRoute,replace=false,state:unknown=null)=>{
    const hash=workspaceHash(next);
    if(location.hash!==hash){
      window.dispatchEvent(new Event('cos-workspace-navigation'));
      if(replace)history.replaceState(state,'',hash);else history.pushState(state,'',hash);
    }
    setRoute(next);
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
  const [session,setSession]=useState<Row|null>(null);
  const fleetOnly=session?.authorized===true&&session?.legacyOwner===false&&session?.features?.fleetAccess===true;
  const [sessionError,setSessionError]=useState('');
  const [checking,setChecking]=useState(true);
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
  const checkRevision=useRef(0);
  const show=useCallback((message:string)=>{setToast(message);if(toastTimer.current!==null)window.clearTimeout(toastTimer.current);toastTimer.current=window.setTimeout(()=>setToast(''),5000);},[]);
  const check=useCallback(async()=>{
    const revision=++checkRevision.current;setChecking(true);
    try {const data=(await api.get('/api/session')).data;if(revision!==checkRevision.current)return;if(!data||typeof data.authorized!=='boolean')throw new Error('Operations authorization could not be verified.');setSession(data);setSessionError('');}
    catch(cause){if(revision===checkRevision.current){setSession(null);setSessionError(errorMessage(cause,'Operations authorization could not be verified.'));}}
    finally{if(revision===checkRevision.current)setChecking(false);}
  },[]);
  useEffect(()=>{void check();return()=>{checkRevision.current+=1;};},[check]);
  useEffect(()=>{document.documentElement.dataset.theme='dark';localStorage.setItem('cos-operations-pages-theme','dark');},[]);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(new Date()),30000);const change=()=>{window.dispatchEvent(new Event('cos-workspace-navigation'));setRoute(readWorkspaceRoute());};window.addEventListener('hashchange',change);window.addEventListener('popstate',change);return()=>{window.clearInterval(timer);window.removeEventListener('hashchange',change);window.removeEventListener('popstate',change);if(toastTimer.current!==null)window.clearTimeout(toastTimer.current);};},[]);
  const requestWeather=useCallback(()=>{
    if(!navigator.geolocation){setWeatherStatus('Location unavailable');return;}
    setWeatherStatus('Locating…');
    navigator.geolocation.getCurrentPosition(async position=>{
      try{const response=await fetch('https://api.open-meteo.com/v1/forecast?latitude='+position.coords.latitude+'&longitude='+position.coords.longitude+'&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto');if(!response.ok)throw new Error('Weather unavailable');const data=await response.json();if(!data.current||!Number.isFinite(data.current.temperature_2m))throw new Error('Weather unavailable');setWeather(data.current);setWeatherStatus('Current location');}catch{setWeather(null);setWeatherStatus('Weather unavailable');}
    },()=>{setWeather(null);setWeatherStatus('Enable local weather');},{enableHighAccuracy:false,timeout:10000,maximumAge:300000});
  },[]);
  const navigate=useCallback((name:string)=>{
    setMenu(false);
    if(fleetOnly&&!fleetWorkspaces.includes(name))return;
    if(legacy[name]){openLegacy(legacy[name]);return;}
    const next=nav.includes(name)?name:'Today';
    setRouteLocation({workspace:next,jobId:'',detail:false},active==='Operations');
    window.scrollTo({top:0,behavior:'instant'});
  },[setRouteLocation,active,fleetOnly]);
  const openUnitHealth=useCallback((unitId:string)=>{
    setMenu(false);
    if(active==='Field Map')setRouteLocation({workspace:'Field Map',jobId:'',detail:false,unitId},true,history.state);
    setRouteLocation({workspace:'Camera Health',jobId:'',detail:false,unitId},false,active==='Field Map'?{cosUnitHealthFromMap:unitId}:null);
    window.scrollTo({top:0,behavior:'instant'});
  },[active,setRouteLocation]);
  const returnToMap=useCallback((unitId:string)=>{
    setMenu(false);
    if(history.state?.cosUnitHealthFromMap===unitId)history.back();
    else{setRouteLocation({workspace:'Field Map',jobId:'',detail:false,unitId});window.scrollTo({top:0,behavior:'instant'});}
  },[setRouteLocation]);
  const createTicket=useCallback((createType:TicketType,unitId?:string)=>{
    setMenu(false);
    setRouteLocation({workspace:'Daily Board',jobId:'',detail:false,createType,...(unitId?{unitId}:{})},false,unitId&&active==='Camera Health'&&route.unitId===unitId?{cosTicketFromUnitHealth:unitId}:null);
    window.scrollTo({top:0,behavior:'instant'});
  },[setRouteLocation,active,route.unitId]);
  const cancelCreateTicket=useCallback(()=>{
    if(route.unitId){if(history.state?.cosTicketFromUnitHealth===route.unitId)history.back();else openUnitHealth(route.unitId);}
    else navigate('Today');
  },[route.unitId,openUnitHealth,navigate]);
  const openJob=useCallback((id:string,workspace:'Jobs'|'Unscheduled'|'Owner Review'|'Dispatch'='Jobs')=>{
    setMenu(false);
    setRouteLocation({workspace,jobId:id,detail:false});
    window.scrollTo({top:0,behavior:'instant'});
  },[setRouteLocation]);
  const selectOverviewJob=useCallback((id:string)=>{
    const list={workspace:'Today',jobId:id,detail:false};
    setRouteLocation(list,true);
    setRouteLocation({...list,detail:true},false,{cosOverviewDetail:true});
    if(window.matchMedia('(max-width:700px)').matches)window.scrollTo({top:0,behavior:'instant'});
  },[setRouteLocation]);
  const openLifecycle=useCallback((id:string)=>{
    setMenu(false);
    setRouteLocation({workspace:'Today',jobId:id,detail:true},false,{cosOverviewDetail:true,cosLifecycleOrigin:'Jobs'});
    window.scrollTo({top:0,behavior:'instant'});
  },[setRouteLocation]);
  const backToOverviewJobs=useCallback(()=>{
    if(history.state?.cosOverviewDetail)history.back();
    else setRouteLocation({workspace:'Today',jobId:route.jobId,detail:false},true);
  },[route.jobId,setRouteLocation]);
  const authorized=session?.authorized===true;
  useEffect(()=>{
    if(fleetOnly&&!fleetWorkspaces.includes(active)) setRouteLocation({workspace:'Field Map',jobId:'',detail:false},true);
  },[fleetOnly,active,setRouteLocation]);
  const condition=weather?(weather.weather_code===0?'Clear':weather.weather_code<=3?'Partly cloudy':weather.weather_code<=48?'Fog':weather.weather_code<=67?'Rain':weather.weather_code<=77?'Wintry':weather.weather_code<=82?'Showers':'Storms'):'Weather unavailable';
  const asset=(path:string)=>import.meta.env.BASE_URL+'resources/'+path;
  const selectedArea=primaryWorkspace(active);
  const ownerInitials=String(session?.name||'Owner').split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
  return <div className={'shell operations-shell company-shell'+(active==='Field Map'?' operations-field-view':'')}>
    {menu&&<button type='button' className='operations-menu-backdrop' aria-label='Dismiss menu' tabIndex={-1} onClick={()=>setMenu(false)}/>}
    <aside ref={menuRef} role={menu?'dialog':undefined} aria-modal={menu?true:undefined} className={'operations-sidebar'+(menu?' operations-sidebar-open':'')} aria-label='Operations navigation'>
      <div className='company-brand'><AnimatedEye/><span className='company-brand-copy'><strong>VISION</strong><small>COS Operations</small></span></div>
      <button type='button' className='secondary operations-menu-close' onClick={()=>setMenu(false)}>Close menu <span aria-hidden='true'>×</span></button>
      <p className='company-nav-heading'>Your workspace</p>
      <nav className='operations-area-nav' aria-label='COS Operations'>{(fleetOnly?fleetWorkspaces.map(workspace=>({workspace,label:workspace,icon:'camera' as const})):primaryAreas).map(area=><button type='button' key={area.workspace} className={selectedArea===area.workspace?'active':''} onClick={()=>navigate(area.workspace)} aria-current={selectedArea===area.workspace?'page':undefined}><AreaIcon name={area.icon}/>{area.label}</button>)}</nav>
      <div className='company-sidebar-footer'><div className='company-sidebar-actions'><button type='button' onClick={()=>navigate('Tech Check')}>Tech Checks</button>{!fleetOnly&&<button type='button' onClick={()=>navigate('Vision')}>Vision assistant</button>}<button type='button' onClick={()=>{setMenu(false);openLegacy('logout');}}>Sign out</button></div><div className='company-owner'><span aria-hidden='true'>{ownerInitials}</span><div><strong>{session?.name||'Owner'}</strong><small>COS workspace</small></div></div></div>
    </aside>
    <main className='owner-it-main' inert={menu}>
      <section className='company-utility-bar' aria-label='Workspace utilities'>
        <div className='company-mobile-brand'><AnimatedEye/><span className='company-brand-copy'><strong>VISION</strong><small>COS Operations</small></span></div><span className='company-breadcrumb'>{route.createType?'Create ticket':workspaceLabel(active)}</span>
        {!fleetOnly&&<button type='button' className='company-search-trigger vision-nav-return' onClick={()=>navigate('Daily Board')}>Open dispatch board</button>}
        <span className={'company-connection'+(!authorized?' company-connection-pending':'')} role='status'><i aria-hidden='true'/>{authorized?'OPERATIONS CONNECTED':checking?'VERIFYING ACCESS':'ACCESS UNAVAILABLE'}</span>
        <button type='button' className='operations-open-menu' aria-label='More' aria-expanded={menu} onClick={openMenu}>Menu <span aria-hidden='true'>☰</span></button>
      </section>

      {active!=='Today'&&!route.createType&&<header className='command-page-header'><div><label>{active==='Field Map'?'FIELD ASSET LOCATION':active==='Daily Board'?'DAILY OPERATIONS':'COS OPERATIONS'}</label><h1>{workspaceLabel(active)}</h1><p>{descriptions[active]||'Open this existing Operations workspace in AppDeploy.'}</p></div></header>}
      {checking&&!session?<section className='panel module' role='status'>Verifying your current Operations account…</section>:!authorized?<section className='panel module operations-access' role='alert'><h2>Operations access needs attention</h2><p>{session?.reason||sessionError||'This Owner account is not linked to COS Operations.'}</p><div className='purchase-actions'><button onClick={()=>void check()} disabled={checking}>{checking?'Checking…':'Retry Operations access'}</button></div><TechChecksWorkspace/></section>
        :fleetOnly&&!fleetWorkspaces.includes(active)?<p role='status'>Opening Field Map…</p>:active==='Today'?<>{!route.detail&&<>{session?.legacyOwner===true&&<HomeFieldView open={()=>navigate('Field Map')}/>}<TicketActions createTicket={createTicket}/><VisionAreas api={api} navigate={navigate}/></>}<TodayDashboard setActive={navigate} openJob={openJob} openUnit={unit=>{setHeliosUnit(unit);navigate('Victron VRM');}} selectedJobId={route.jobId} detailOpen={route.detail} selectJob={selectOverviewJob} backToJobs={backToOverviewJobs}/></>
        :active==='Operations'?<OperationsAreas navigate={navigate}/>
        :active==='Units On Hand'?<UnitsOnHand api={api} navigate={navigate}/>
        :active==='Daily Board'?<>{!route.createType&&session?.features?.mhelpTicketImport===true&&<MhelpTicketImport show={show} openJob={id=>openJob(id,'Unscheduled')}/>}<OwnerBoardControls key={route.createType?'create-ticket-'+(route.unitId||''):'board-controls'} show={show} createType={route.createType} unitId={route.unitId} cancelCreateLabel={route.unitId?'Back to unit health':'Back to dashboard'} cancelCreate={cancelCreateTicket} openCreatedJob={id=>openJob(id,'Unscheduled')}/>{!route.createType&&<DailyBoard api={api} openWorkspace={navigate}/>}</>
        :active==='Field Map'?<section className='panel module field-map-module'><FieldMap show={show} initialUnitId={route.unitId||mapUnitId} initialUnitLabel={route.unitLabel} openWorkspace={navigate} openUnitHealth={openUnitHealth} historyReadEnabled={!fleetOnly} locationWritesEnabled={session?.features?.fieldLocationVerification===true}/></section>
        :active==='Owner Tasks'?<OwnerTasksWorkspace show={show}/>
        :active==='Jobs'?<OperationsJobs key='jobs' mode='jobs' show={show} openLifecycle={openLifecycle} initialJobId={focusedJob} clearFocusedJob={()=>setRouteLocation({workspace:'Jobs',jobId:'',detail:false},true)}/>
        :active==='Unscheduled'?<OperationsJobs key='unscheduled' mode='unscheduled' show={show} initialJobId={focusedJob} clearFocusedJob={()=>setRouteLocation({workspace:'Unscheduled',jobId:'',detail:false},true)}/>
        :active==='Dispatch'?<OperationsJobs key='dispatch' mode='dispatch' show={show} initialJobId={focusedJob} clearFocusedJob={()=>setRouteLocation({workspace:'Dispatch',jobId:'',detail:false},true)}/>
        :active==='Owner Review'?<OperationsJobs key='review' mode='review' show={show} initialJobId={focusedJob} clearFocusedJob={()=>setRouteLocation({workspace:'Owner Review',jobId:'',detail:false},true)}/>
        :active==='Calendar'?<OperationsCalendar show={show}/>
        :active==='Handoffs'?<HandoffsWorkspace show={show}/>
        :active==='Customers'||active==='Sites'?<DirectoryWorkspace kind={active} show={show}/>
        :active==='Equipment'?<EquipmentWorkspace show={show}/>
        :active==='Team'?<TeamWorkspace show={show} openWorkspace={navigate}/>
        :active==='Quotes'?<QuotesWorkspace show={show}/>
        :active==='Invoices'||active==='Billing'?<InvoicesWorkspace show={show}/>
        :active==='Purchasing'?<PurchasingWorkspace show={show}/>
        :active==='Tech Check'?(fleetOnly?<section className='panel module'><h2>IT Tech Checks</h2><button onClick={()=>openLegacy('it')}>Return to my IT Tech Checks</button></section>:<TechChecksWorkspace/>)
        :active==='Camera Health'?<CameraHealthWorkspace initialUnitId={route.unitId} backToMap={returnToMap} createTicket={fleetOnly?undefined:createTicket} canEditPlacement={session?.features?.fleetPlacementEdit===true} canEditConnection={session?.features?.fleetConnectionEdit===true} canReviewIdentity={session?.features?.ownerIdentityReview===true}/>
        :active==='InHand Routers'?<RouterWorkspace openMap={id=>{setMapUnitId(id);navigate('Field Map');}}/>
        :active==='Victron VRM'?<VrmWorkspace initialUnit={heliosUnit}/>
        :<section className='panel module operations-reference' aria-label={active+' workspace'}><h2>{active}</h2><p>This workspace remains available in AppDeploy COS Operations. Open the platform and select <b>{active}</b> from its navigation. AppDeploy may ask you to sign in separately.</p><a className='operations-reference-link' href={referenceUrl} target='_blank' rel='noopener noreferrer'>Open AppDeploy COS Operations ↗</a><p>Your existing IT and Service workspaces remain accessible here.</p><button className='secondary' onClick={()=>navigate('Today')}>Back to Overview</button></section>}
    </main>
    <nav className='operations-bottom-nav' aria-label='Mobile Operations navigation' inert={menu}>{(fleetOnly?[{label:'Camera Health',workspace:'Camera Health'},{label:'Field View',workspace:'Field Map'},{label:'Tech Checks',workspace:'Tech Check'}]:[{label:'Dashboard',workspace:'Today'},{label:'Field View',workspace:'Field Map'},{label:'Team',workspace:'Team'}]).map(area=><button type='button' key={area.workspace} className={active===area.workspace?'active':''} aria-current={active===area.workspace?'page':undefined} onClick={()=>navigate(area.workspace)}>{area.label}</button>)}<button type='button' aria-label='More' aria-expanded={menu} onClick={openMenu}>Menu</button></nav>
    {toast&&<div className='toast operations-toast' role='status'>{toast}</div>}
  </div>;
}

export default function App() {
  return new URLSearchParams(location.search).get('mode') === 'production-assignments' ? <ProductionAssignments/> : <OwnerApp/>;
}

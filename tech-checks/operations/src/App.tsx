import SavedFleetReadingView from './SavedFleetReadingView';
import {fleetReadingKey,readFleetReading} from './savedFleetReading';
import ViewErrorBoundary from './ViewErrorBoundary';
import { savedFleetStatus } from './api';
import AnimatedEye from './AnimatedEye';
import {fleetVrmReadAllowed} from './fleetDashboardModel';
import { AreaIcon } from './VisionAreas';
import OperationsAreas from './OperationsAreas';
import UnitsOnHand from './UnitsOnHand';
import FleetInventoryOverview from './FleetInventoryOverview';
import ApprovedCosNavigation, {ApprovedCosIcon} from './ApprovedCosNavigation';
import {approvedArea,approvedWorkspaceLabel} from './approvedCosNavigation';
import './approvedCosNavigation.css';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, openLegacy } from './api';
import {useOperationsSession} from './useOperationsSession';
import TvSignedOutBoard from './TvSignedOutBoard';
import {setTvSessionHold} from './tvSessionHold';
import TodayDashboard from './TodayDashboard';
import TechChecksWorkspace from './TechChecksWorkspace';
import DailyBoard from './DailyBoard';
import FleetDashboard from './FleetDashboard';
import {ownerCensusSessionAllowed} from './ownerCensusOnce';
import UnitTrackerWorkspace from './UnitTrackerWorkspace';
import {trackerAccess} from './unitTracker';
import {can} from './cosCapabilities';
import OwnerWatchfulShortcut from './OwnerWatchfulShortcut';
import HomeFieldView from './HomeFieldView';
import ProductionAssignments from './ProductionAssignments';
import CameraHealthWorkspace from './CameraHealthWorkspace';
import VrmWorkspace from './VrmWorkspace';
import RouterWorkspace from './RouterWorkspace';
import ITDashboard from './ITDashboard';
import ITDailyDashboard from './ITDailyDashboard';
import {IT_DAILY_ONLY, IT_DAILY_WORKSPACES, itDailyLabel} from '../../it-feature-availability';
import ITMhelpWorkspace from './ITMhelpWorkspace';
import HandoffsWorkspace from './HandoffsWorkspace';
import EquipmentWorkspace from './EquipmentWorkspace';
import TeamWorkspace from './TeamWorkspace';
import LegacyInstallEvidence from './LegacyInstallEvidence';
import './continuation.css';
import { workspaces as nav, itWorkspaces, workspaceGroups, workspaceLabel, workspaceGroup, canonicalWorkspace, isRetiredBusinessWorkspace, readWorkspaceRoute, workspaceHash, type WorkspaceRoute } from './workspaceNavigation';

type Row = Record<string, any>;
type NativeWorkspace = 'Today' | 'Daily Board' | 'Fleet Dashboard' | 'Unit Tracker' | 'Owner Tasks' | 'Jobs' | 'Tech Check' | 'Camera Health' | 'InHand Routers' | 'Victron VRM' | 'Unscheduled' | 'Dispatch' | 'Owner Review' | 'Calendar' | 'Handoffs' | 'Customers' | 'Sites' | 'Equipment' | 'Team' | 'Quotes' | 'Invoices' | 'Billing' | 'Purchasing';
const native: NativeWorkspace[] = ["Today","Daily Board","Fleet Dashboard","Unit Tracker","Owner Tasks","Jobs","Tech Check","Camera Health","InHand Routers","Victron VRM","Unscheduled","Dispatch","Owner Review","Calendar","Handoffs","Customers","Sites","Equipment","Team","Quotes","Invoices","Billing","Purchasing"];
const legacy: Record<string,string> = {};
const baseFleetWorkspaces = ['Fleet Dashboard','IT Dashboard','InHand Routers','Camera Health','Victron VRM','Unit Tracker','MHelp','Tech Check'];
const referenceUrl = 'https://cos-operations-platform-preview-wpbf1y.v2.appdeploy.ai/';
const descriptions: Record<string,string> = {
  'IT Dashboard':'Your field, connectivity, power, tracker and ticket information in one place.',
  MHelp:'Your existing Tech Check MHelpDesk ticket references and operational details.',
  'Daily Board':'Fleet count tiles for the shop TV: camera units, cameras, units in the field, and stands. Same numbers as the map.',
  'Unit Tracker':'Review current COS units and their 2027 tracker information.',
  'Fleet Dashboard':'Find field units using recorded GPS, installed-site coordinates or their site address.',
  'Units On Hand':'Shop and yard inventory, availability and preparation status.',
  Operations:'Secondary tools in your existing COS app. Service jobs are created in mHelp.',
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
function FleetDisplayRecovery({retry, reference, session}: {retry: () => void; reference: string; session: Record<string,any>}) {
  const key = fleetReadingKey(session,new URLSearchParams(location.search).get('mode')||'');
  const saved = readFleetReading(window.localStorage,key);
  if(saved)return <><SavedFleetReadingView reading={saved} refresh={retry}/><p role="status">Fleet details could not display. The completed reading remains available. Reference {reference}.</p></>;

  const board = savedFleetStatus()?.latest?.payload;
  const counts = board?.contract === 'COS_SAVED_FLEET_BOARD_V1' ? board.counts : null;
  const checkedAt = board?.fleet?.readAt;
  return <section className="cos-fleet-message" role="alert" aria-label="Fleet display recovery">
    <h2>Fleet couldn’t display</h2>
    {counts && [counts.online, counts.offline, counts.unverified].every(Number.isSafeInteger) &&
      <p>Last saved camera units: {counts.online} online, {counts.offline} offline, {counts.unverified} unverified.
        {typeof checkedAt === 'string' && Number.isFinite(Date.parse(checkedAt)) && <> Checked {new Date(checkedAt).toLocaleString()}.</>}
      </p>}
    <p>Display reference {reference}</p>
    <button type="button" onClick={retry}>Reopen Fleet</button>
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
  // Only this display Boolean survives a recoverable private-view teardown.
  // The existing session controller must verify identical actor/mode/features
  // before DailyBoard can mount again; no records or callbacks are retained.
  const tvIntent=useRef(tvDisplay);
  const lastRouteHash=useRef(location.hash);
  // Current role-scoped routes; a direct hash edit must never mount a paused workspace.
  const allowedFleetRoutes=useRef<string[]|null>(null);
  const active=route.workspace;
  useEffect(()=>{if(/^#(?:field-map|field-view)(?:\?|$)/.test(location.hash)){const hash=workspaceHash(route);history.replaceState(history.state,'',hash);lastRouteHash.current=hash;}},[route]);
  useEffect(()=>{
    if(window.parent!==window)window.parent.postMessage({type:'COS_OPERATIONS_WORKSPACE_ACTIVE',workspace:active},location.origin);
  },[active]);
  const group=workspaceGroup(active);
  const setRouteLocation=useCallback((next:WorkspaceRoute,replace=false,state:unknown=null)=>{
    const workspace=canonicalWorkspace(next.workspace);
    const safe:WorkspaceRoute=isRetiredBusinessWorkspace(workspace)?{workspace:'Today',jobId:'',detail:false}:{...next,workspace,detail:false};
    delete safe.createType;
    const hash=workspaceHash(safe);
    lastRouteHash.current=hash;
    if(location.hash!==hash){
      window.dispatchEvent(new Event('cos-workspace-navigation'));
      if(replace)history.replaceState(state,'',hash);else history.pushState(state,'',hash);
    }
    setRoute(safe);
  },[]);
  useEffect(()=>{
    const hash=workspaceHash(route);
    if(location.hash===hash)return;
    lastRouteHash.current=hash;
    history.replaceState(history.state,'',hash);
  },[route]);
  useEffect(()=>{
    const returnToChecks=(event:MessageEvent)=>{
      if(window.parent===window||event.origin!==location.origin||event.source!==window.parent||event.data?.type!=='COS_OPERATIONS_TECH_CHECK_HOME')return;
      setMenu(false);
      setRouteLocation({workspace:'Tech Check',jobId:'',detail:false},true);
    };
    window.addEventListener('message',returnToChecks);
    return()=>window.removeEventListener('message',returnToChecks);
  },[setRouteLocation]);
  const {session, checking, error:sessionError, reloadRequired, generation:sessionGeneration, check, guardCurrent}=useOperationsSession((reason)=>{
    const keepTv=tvIntent.current;
    if(!keepTv&&reason!=='token-renewed'&&reason!=='parent-timeout')tvIntent.current=false;
    setMenu(false);setToast('');setRegisterUnitName('');setHeliosUnit(1);
    if(!keepTv)setTvDisplay(false);
    setRouteLocation({workspace:active,jobId:'',detail:false},true);
    // Discard selection/history payloads as well as the mounted private views.
    history.replaceState(null,'',location.href);
  });
  // DailyBoard owns the host display lifecycle. Keep its guarded notification
  // stable within this session so an ordinary shell render cannot simulate exit.
  const onTvChange=useCallback(guardCurrent((enabled:boolean)=>{tvIntent.current=enabled;setTvDisplay(enabled);}),[guardCurrent]);
  const leaveTv=useCallback(()=>{tvIntent.current=false;setTvDisplay(false);},[]);
  useEffect(()=>{if(active!=='Daily Board'){tvIntent.current=false;setTvDisplay(false);return;}if(reloadRequired&&!tvIntent.current){setTvDisplay(false);}},[reloadRequired,active]);
  setTvSessionHold(tvDisplay&&active==='Daily Board');
  const dailyOnly=IT_DAILY_ONLY&&(session?.legacyOwner===false&&session?.features?.fleetAccess===true||['fleet','it-daily'].includes(new URLSearchParams(location.search).get('mode')||''));
  const fleetWorkspaces = useMemo(()=>(dailyOnly?[...IT_DAILY_WORKSPACES]:baseFleetWorkspaces).filter(name=>(name!=='Unit Tracker'||trackerAccess(session))&&(name!=='Victron VRM'||session?.features?.vrmRead===true)),[session,dailyOnly]);
  const fleetOnly=session?.authorized===true&&(dailyOnly||session?.legacyOwner===false&&session?.features?.fleetAccess===true);
  allowedFleetRoutes.current=fleetOnly?fleetWorkspaces:null;
  const label=(name:string)=>dailyOnly?itDailyLabel(name):fleetOnly?workspaceLabel(name):approvedWorkspaceLabel(name,workspaceLabel(name));
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
        const controls=Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),summary')).filter(element=>element.getClientRects().length>0);
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
    const next=nav.includes(name)||fleetOnly&&itWorkspaces.includes(name)?name:'Fleet Dashboard';
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
  const authorized=session?.authorized===true;
  useEffect(()=>{
    if(fleetOnly&&!fleetWorkspaces.includes(active)) setRouteLocation({workspace:'Fleet Dashboard',jobId:'',detail:false},true);
  },[fleetOnly,dailyOnly,active,setRouteLocation,fleetWorkspaces]);
  const condition=weather?(weather.weather_code===0?'Clear':weather.weather_code<=3?'Partly cloudy':weather.weather_code<=48?'Fog':weather.weather_code<=67?'Rain':weather.weather_code<=77?'Wintry':weather.weather_code<=82?'Showers':'Storms'):'Weather unavailable';
  const asset=(path:string)=>import.meta.env.BASE_URL+'resources/'+path;
  const selectedArea=fleetOnly||dailyOnly?active:approvedArea(active);
  const ownerInitials=String(session?.name||'Owner').split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
  return <div className={'shell operations-shell company-shell'+(!fleetOnly&&!dailyOnly?' cos-approved-shell':'')+(active==='Fleet Dashboard'?' operations-field-view':'')}>
    {menu&&<button type='button' className='operations-menu-backdrop' aria-label='Dismiss menu' tabIndex={-1} onClick={()=>setMenu(false)}/>}
    <aside ref={menuRef} role={menu?'dialog':undefined} aria-modal={menu?true:undefined} className={'operations-sidebar'+(menu?' operations-sidebar-open':'')} aria-label='Operations navigation'>
      <div className='company-brand'><AnimatedEye full/></div>
      <button type='button' className='secondary operations-menu-close' onClick={()=>setMenu(false)}>Close menu <span aria-hidden='true'>×</span></button>
      <p className='company-nav-heading'>Your workspace</p>
      <nav className='operations-area-nav' aria-label='COS Operations'>{fleetOnly||dailyOnly?fleetWorkspaces.filter(workspace=>!dailyOnly||workspace!=='IT Dashboard').map(workspace=>({workspace,label:label(workspace),icon:({'IT Dashboard':'dashboard','Fleet Dashboard':'map','InHand Routers':'router','Camera Health':'camera','Victron VRM':'power','MHelp':'operations','Unit Tracker':'units','Tech Check':'operations'} as Record<string,string>)[workspace]||'dashboard'})).map(area=><button type='button' key={area.workspace} className={selectedArea===area.workspace?'active':''} onClick={()=>navigate(area.workspace)} aria-current={selectedArea===area.workspace?'page':undefined}><AreaIcon name={area.icon}/>{area.label}</button>):<ApprovedCosNavigation active={active} navigate={navigate}/>}</nav>
      {menu&&!fleetOnly&&!dailyOnly&&<div className='cos-approved-more-drawer'><h2>More</h2><OperationsAreas navigate={navigate} trackerVisible={trackerAccess(session)}/></div>}
      <div className='company-sidebar-footer'><div className='company-sidebar-actions'>{fleetOnly&&!dailyOnly&&<button type='button' onClick={()=>navigate('Tech Check')}>Tech Checks</button>}<button type='button' onClick={()=>{setMenu(false);openLegacy('logout');}}>Sign out</button></div><div className='company-owner'><span aria-hidden='true'>{ownerInitials}</span><div><strong>{session?.name||'Owner'}</strong><small>COS workspace</small></div></div></div>
    </aside>
    <main className='owner-it-main' inert={menu}>
      <section className='company-utility-bar' aria-label='Workspace utilities'>
        <div className='company-mobile-brand'><AnimatedEye full/></div><span className='company-breadcrumb'>{route.createType?'Create ticket':label(active)}</span>
        <span className={'company-connection'+(!authorized?' company-connection-pending':'')} role='status'><i aria-hidden='true'/>{authorized?'OPERATIONS CONNECTED':checking?'VERIFYING ACCESS':'ACCESS UNAVAILABLE'}</span>
        {(fleetOnly||dailyOnly)&&<button type='button' className='operations-open-menu' aria-label='More' aria-expanded={menu} onClick={openMenu}>Menu <span aria-hidden='true'>☰</span></button>}
      </section>

      {active!=='Today'&&active!=='IT Dashboard'&&active!=='Fleet Dashboard'&&(active!=='Camera Health'||route.diagnostics)&&!route.createType&&<header className='command-page-header'><div><label>{active==='Fleet Dashboard'?'FIELD ASSET LOCATION':active==='Daily Board'?'DAILY OPERATIONS':'COS OPERATIONS'}</label><h1>{label(active)}</h1><p>{descriptions[active]||'Open this existing Operations workspace in AppDeploy.'}</p></div></header>}
      {tvDisplay&&(reloadRequired||!authorized||(checking&&!session))?<TvSignedOutBoard note={reloadRequired?'Sign in again on Tech Check to resume':'Reconnecting'} exit={leaveTv}/>:checking&&!session?<section className='panel module' role='status'><p>{sessionError||'Verifying your current Operations account…'}</p><button type='button' onClick={()=>window.location.reload()}>Reload app</button></section>:!authorized?<section className='panel module operations-access' role='alert'><h2>Operations access needs attention</h2><p>{session?.reason||sessionError||'This Owner account is not linked to COS Operations.'}</p>{!reloadRequired&&<div className='purchase-actions'><button onClick={()=>void check()} disabled={checking}>{checking?'Checking…':'Retry Operations access'}</button></div>}{!dailyOnly&&<TechChecksWorkspace/>}</section>
        :<Fragment key={sessionGeneration}>{fleetOnly&&!fleetWorkspaces.includes(active)?<p role='status'>Opening Fleet Dashboard…</p>:active==='IT Dashboard'?(dailyOnly?<ITDailyDashboard session={session} navigate={navigate}/>:<ITDashboard session={session} navigate={navigate}/>):active==='MHelp'?<ITMhelpWorkspace/>:active==='Today'?<>{!route.detail&&<>{!fleetOnly&&<HomeFieldView open={()=>navigate('Fleet Dashboard')}/>}<FleetInventoryOverview navigate={navigate}/><nav className='cos-daily-shortcuts' aria-label='Daily work shortcuts'><button onClick={()=>navigate('Daily Board')}>Today’s work</button><button onClick={()=>navigate('Units On Hand')}>Shop / ROOT</button><button onClick={()=>openLegacy('it')}>IT check out / check in</button><button onClick={()=>openLegacy('service')}>Service work & returns</button>{trackerAccess(session)&&<button onClick={()=>navigate('Unit Tracker')}>2027 Unit Tracker</button>}</nav>{!fleetOnly&&!dailyOnly&&session?.role==='Owner'&&<OwnerWatchfulShortcut/>}</>}<TodayDashboard setActive={navigate}/></>
        :active==='Operations'?<OperationsAreas navigate={navigate} trackerVisible={trackerAccess(session)}/>
        :active==='Units On Hand'?<UnitsOnHand api={api} navigate={navigate} openUnit={guardCurrent(unitId=>setRouteLocation({workspace:'Fleet Dashboard',jobId:'',detail:false,unitId}))}/>
        :active==='Daily Board'?<DailyBoard api={api} session={session!} openWorkspace={navigate} initialTv={tvIntent.current} onTvChange={onTvChange}/>
        :(active==='Fleet Dashboard'||active==='Camera Health'&&(!route.diagnostics||dailyOnly))?<ViewErrorBoundary key={active} fallback={(retry, reference) => <FleetDisplayRecovery retry={retry} reference={reference} session={session!}/>}><FleetDashboard session={session!} navigate={navigate} openMhelpConnection={guardCurrent(()=>{navigate('Unit Tracker');setTrackerConnectionOpen(true);})} initialView={active==='Camera Health'?'fleet':'map'} entryRevision={fleetEntryRevision} openAdvancedDiagnostics={!fleetOnly&&!dailyOnly?guardCurrent(()=>setRouteLocation({workspace:'Camera Health',jobId:'',detail:false,diagnostics:true,...(route.unitId?{unitId:route.unitId}:{})})):undefined} createTicket={undefined} initialUnitId={route.unitId} initialUnitLabel={route.unitLabel} onSelectUnit={guardCurrent(unitId=>setRouteLocation({workspace:active==='Camera Health'?'Camera Health':'Fleet Dashboard',jobId:'',detail:false,...(unitId?{unitId}:{})},true,history.state))} show={show} openUnitHealth={openUnitHealth} historyReadEnabled={can(session,'equipment.history')} locationWritesEnabled={!fleetOnly&&!dailyOnly&&session?.features?.fieldLocationVerification===true} ownerManagementEnabled={!fleetOnly&&!dailyOnly} ownerCensusEnabled={!fleetOnly&&!dailyOnly&&ownerCensusSessionAllowed(session)} registerEquipment={guardCurrent(name=>{setRegisterUnitName(name);navigate('Equipment');})}/></ViewErrorBoundary>
        :active==='Unit Tracker'?<UnitTrackerWorkspace session={session} show={show} initialConnectionOpen={trackerConnectionOpen} initialUnitId={route.unitId} onSelectUnit={guardCurrent(unitId=>setRouteLocation({workspace:'Unit Tracker',jobId:'',detail:false,unitId},true))} openMap={guardCurrent(unitId=>setRouteLocation({workspace:'Fleet Dashboard',jobId:'',detail:false,unitId}))} openHealth={openUnitHealth}/>
        :active==='Owner Review'?<section className='panel module' aria-label='Legacy install evidence'>{session?.features?.legacyInstallEvidence===true?<LegacyInstallEvidence/>:<p role='status'>Legacy install evidence is not enabled for this account.</p>}</section>
        :isRetiredBusinessWorkspace(active)?<p role='status'>Opening Overview…</p>
        :active==='Handoffs'?<HandoffsWorkspace show={show}/>
        :active==='Equipment'?<EquipmentWorkspace show={show} initialUnitName={registerUnitName}/>
        :active==='Team'?<TeamWorkspace show={show} openWorkspace={navigate}/>
        :active==='Tech Check'?(fleetOnly?<section className='panel module'><h2>IT Tech Checks</h2><button onClick={()=>openLegacy('it')}>Return to my IT Tech Checks</button></section>:<TechChecksWorkspace/>)
        :active==='Camera Health'?<CameraHealthWorkspace manualRefreshEnabled={can(session,'equipment.refresh')} powerReadEnabled={fleetVrmReadAllowed(session||{})} initialUnitId={route.unitId} backToMap={returnToMap} createTicket={undefined} canEditPlacement={session?.features?.fleetPlacementEdit===true} canEditConnection={session?.features?.fleetConnectionEdit===true} canReviewIdentity={session?.features?.ownerIdentityReview===true}/>
        :active==='InHand Routers'?<RouterWorkspace openMap={guardCurrent(unitId=>setRouteLocation({workspace:'Fleet Dashboard',jobId:'',detail:false,unitId}))}/>
        :active==='Victron VRM'?<VrmWorkspace canDiscover={!fleetOnly} initialUnit={heliosUnit} initialInstallationId={route.installationId} onSelectInstallation={guardCurrent(installationId=>setRouteLocation({workspace:'Victron VRM',jobId:'',detail:false,installationId},true))}/>
        :<section className='panel module operations-reference' aria-label={active+' workspace'}><h2>{active}</h2><p>This workspace remains available in AppDeploy COS Operations. Open the platform and select <b>{active}</b> from its navigation. AppDeploy may ask you to sign in separately.</p><a className='operations-reference-link' href={referenceUrl} target='_blank' rel='noopener noreferrer'>Open AppDeploy COS Operations ↗</a><p>Your existing IT and Service workspaces remain accessible here.</p><button className='secondary' onClick={()=>navigate('Today')}>Back to Overview</button></section>}</Fragment>}
    </main>
    <nav className='operations-bottom-nav' aria-label='Mobile Operations navigation' inert={menu}>{fleetOnly||dailyOnly?(dailyOnly?[{label:'Fleet Dashboard',workspace:'Fleet Dashboard'},{label:'Camera Health',workspace:'Camera Health'}]:[{label:'Fleet Dashboard',workspace:'Fleet Dashboard'},{label:'IT overview',workspace:'IT Dashboard'},{label:'Tech Checks',workspace:'Tech Check'}]).filter(area=>!fleetOnly||fleetWorkspaces.includes(area.workspace)).map(area=><button type='button' key={area.workspace} className={active===area.workspace?'active':''} aria-current={active===area.workspace?'page':undefined} onClick={()=>navigate(area.workspace)}>{area.label}</button>):<ApprovedCosNavigation active={active} navigate={navigate} mobile/>}<button type='button' aria-label='More' aria-expanded={menu} className={!fleetOnly&&!dailyOnly&&(menu||selectedArea==='Operations')?'cos-approved-selected':''} onClick={openMenu}>{!fleetOnly&&!dailyOnly&&<ApprovedCosIcon name='more'/>}<span>{fleetOnly||dailyOnly?'Menu':'More'}</span></button></nav>
    {toast&&<div className='toast operations-toast' role='status'>{toast}</div>}
  </div>;
}

export default function App() {
  return new URLSearchParams(location.search).get('mode') === 'production-assignments' ? <ProductionAssignments/> : <OwnerApp/>;
}

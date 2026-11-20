import { useCallback,useEffect, useMemo, useState, type ReactNode } from 'react';
import {CAMERA_AUTO_REFRESH_MS} from './refreshCadence';
import { boardDateLabel,chicagoDay, readinessSummary, type BoardCard, type ReadinessRow, type BoardScope } from './dailyBoardData';
import {configuredTvPages,type FleetPages} from './tvBoardData';
import {tvSettingsNotice} from './tvSessionHold';
import FleetCountReadout from './FleetCountReadout';
import type {TvSharedCounts} from './TvFleetView';
import type {TvSection} from '../../supabase/functions/cos-operations-pages/tv-board-settings/index';
import {vehicleInspectionExempt} from './vehicleInspectionPolicy';
import TvFleetView from './TvFleetView';
import AnimatedEye from './AnimatedEye';
import './techCheckTvBoard.css';

type Props = { counts: ReactNode; cards: BoardCard[]; names: string[]; readiness: ReadinessRow[]; scope: BoardScope; now: Date; lastSuccess: Date | null; error: string; stale: boolean; busy: boolean; rotation: number;rotationSeconds:number; exit: () => void; refresh: () => void;sections:TvSection[];settingsError:string;reconnecting?:boolean;api:{get:(path:string)=>Promise<{data:any}>} };
const normalized = (status: string) => status.toLowerCase().replaceAll('_', ' ');
export default function TechCheckTvBoard({ counts, cards, names, readiness, scope, now, lastSuccess, error, stale, busy, rotation,rotationSeconds, exit, refresh,sections,settingsError,reconnecting=false,api }: Props) {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [fullscreenError, setFullscreenError] = useState('');
  const [fleetRefreshId,setFleetRefreshId]=useState(0);
  const [fleetPages,setFleetPages]=useState<FleetPages>({camera:1,map:['All field units']});
  const [sharedCounts,setSharedCounts]=useState<TvSharedCounts|null>(null);
  const [watchfulLate,setWatchfulLate]=useState(false);
  const updateFleetPages=useCallback((next:FleetPages)=>setFleetPages(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next),[]);
  useEffect(() => { const resize = () => setSize({ width: window.innerWidth, height: window.innerHeight }); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  const pages = useMemo(() => configuredTvPages(cards,names,readiness,sections,size.width,size.height,chicagoDay(now),fleetPages), [cards,names,readiness,sections,size,chicagoDay(now),fleetPages]);
  const settingsNotice = tvSettingsNotice(settingsError);
  const pageIndex = rotation % pages.length, page = pages[pageIndex];
  const summaryCards=Array.from(new Map(pages.flatMap(page=>page.kind==='work'?page.lanes.flatMap(lane=>lane.cards):[]).map(card=>[card.id,card])).values());
  const attention = summaryCards.filter(card => card.lane === 'attention').length;
  const working = summaryCards.filter(card => card.lane === 'progress').length;
  const fullscreen = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); setFullscreenError(''); }
    catch { setFullscreenError('Use Chrome’s full-screen option to fill the TV.'); }
  };
  const leave = () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); exit(); };
  return <section className='tech-check-tv' aria-label='Tech Check TV Board' data-page={pageIndex + 1} data-section={page.section||'empty'}>
    <header className='tech-check-tv-header'>
      <div className='tech-check-tv-brand'><span className='tech-check-tv-eye'><AnimatedEye variant='brand' full/></span><div><h1>TECH CHECK <span>TV BOARD</span></h1></div></div>
      <div className='tech-check-tv-clock'><b>{now.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })}</b><span>{now.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'short', day: 'numeric' })} · CT</span></div>
    </header>
    {page.kind==='work'&&<div className='tech-check-tv-fleet-counts' aria-label='TV fleet counts'>{counts??<section className='cos-fleet-dashboard cos-fleet-counts-only' data-fleet-view='map' aria-label='COS fleet counts'>
      <FleetCountReadout unitTitle={sharedCounts?.unitTitle??'Camera units'} showCameras={sharedCounts?.showCameras??true} units={sharedCounts?.units??null} cameras={sharedCounts?.cameras??null}/>
      <div className='cos-fleet-stats' aria-label='Fleet scope summary'>{[
        ['Units in the field',sharedCounts?.field??null],
        ['In Shop',sharedCounts?.shop??null],
        ['Stands',sharedCounts?.stands??null],
        [(sharedCounts?.unitTitle??'Camera units')+' online',sharedCounts?.units?.online??null],
        [(sharedCounts?.unitTitle??'Camera units')+' offline',sharedCounts?.units?.offline??null],
        [(sharedCounts?.unitTitle??'Camera units')+' unknown',sharedCounts?.units?.unknown??null],
      ].map(([label,count])=><div key={String(label)} className='cos-fleet-stat'><span>{label}</span><strong>{count??'—'}</strong></div>)}</div>
    </section>}</div>}
    {reconnecting&&<p className='tech-check-tv-reconnecting' role='status'>Reconnecting</p>}
    {(error || stale || watchfulLate) && <div className='tech-check-tv-warning' role='alert'>{lastSuccess ? 'UPDATES DELAYED · Showing the last saved snapshot.' : 'BOARD UNAVAILABLE · Waiting for live records.'} {error}</div>}
    {settingsNotice&&!(reconnecting&&settingsNotice==='Reconnecting…')&&<p className='tv-settings-notice' role='status'>TV settings: {settingsNotice}</p>}
    <div className='tech-check-tv-page-title'><h2>{page.kind==='work'?'Fleet counts':page.title}</h2><span>{page.kind==='work'?'SAME TILES AS THE MAP':page.section==='today'?'TODAY':page.section==='shop'?'TODAY + OVERDUE':'LIVE VIEW'} · {pageIndex + 1} / {pages.length}</span></div>
    <main className={'tech-check-tv-content' + (size.height < 900 ? ' tv-short' : '')}>
      {!lastSuccess ? <div className='tech-check-tv-empty' role='status'>{error ? 'Check the connection and Tech Check sign-in, then refresh.' : 'Loading fleet counts…'}</div> : page.kind === 'work' ? null : page.kind==='readiness'?<div className='tech-check-tv-readiness'>{page.rows.map(row => { const summary = readinessSummary(row),exempt=vehicleInspectionExempt(row); return <article key={row.userId}><h3>{row.name}<span>{row.department.toUpperCase()}</span></h3>{exempt?<p>No company vehicle · truck and trailer inspections do not apply.</p>:(['truck','trailer'] as const).map(key => <div key={key}><span>{key === 'truck' ? 'Truck inspection' : 'Trailer inspection'}</span><b className={'tv-readiness-' + summary[key].state}>{summary[key].label}</b></div>)}<div><span>{exempt?'IT shop inventory':'Inventory record'}</span><b className={'tv-readiness-'+summary.inventory.state}>{summary.inventory.label}</b></div><small>{row.completedAt ? 'Completed ' + boardDateLabel(row.completedAt) : row.startedAt ? 'Started ' + boardDateLabel(row.startedAt) : 'No check recorded today'}</small></article>; })}</div>:page.kind==='empty'?<div className='tech-check-tv-empty'>Exit TV and turn on a section in TV board settings.</div>:null}
      <TvFleetView api={api} enabled={Boolean(lastSuccess)&&sections.some(section=>section==='camera'||section==='map')} mode={lastSuccess&&(page.kind==='camera'||page.kind==='map')?page.kind:null} page={page.kind==='camera'||page.kind==='map'?page.fleetPage||0:0} width={size.width} height={size.height} refreshId={fleetRefreshId} onPages={updateFleetPages} onSharedCounts={setSharedCounts} onWatchfulLate={setWatchfulLate}/>
    </main>
    <footer className='tech-check-tv-footer'><div><span className={'tech-check-tv-live' + (error || stale || watchfulLate ? ' delayed' : '')} /><b>{error || stale || watchfulLate ? 'UPDATES DELAYED' : lastSuccess ? 'LIVE BOARD' : 'CONNECTING'}</b><span>{lastSuccess ? 'Fleet counts checked ' + lastSuccess.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) + ' CT' : 'Waiting for fleet counts'} · Board refresh 60s · Saved camera reads {Math.round(CAMERA_AUTO_REFRESH_MS/60000)} min · Page rotation {rotationSeconds}s</span></div><nav aria-label='TV controls'><button type='button' onClick={()=>{refresh();setFleetRefreshId(value=>value+1);}} aria-busy={busy}>Refresh</button><button type='button' onClick={() => void fullscreen()}>Full screen</button><button type='button' onClick={leave}>Exit TV</button></nav></footer>
    {fullscreenError && <p className='tech-check-tv-fullscreen-note' role='status'>{fullscreenError}</p>}
  </section>;
}

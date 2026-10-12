import { useEffect, useMemo, useState } from 'react';
import { boardDateLabel,chicagoDay, readinessSummary, type BoardCard, type ReadinessRow, type BoardScope } from './dailyBoardData';
import { TV_ROTATION_MS, configuredTvPages } from './tvBoardData';
import type {TvSection} from '../../supabase/functions/cos-operations-pages/tv-board-settings/index';
import {vehicleInspectionExempt} from './vehicleInspectionPolicy';
import TvFleetView from './TvFleetView';
import './techCheckTvBoard.css';

type Props = { cards: BoardCard[]; names: string[]; readiness: ReadinessRow[]; scope: BoardScope; now: Date; lastSuccess: Date | null; error: string; stale: boolean; busy: boolean; rotation: number; exit: () => void; refresh: () => void;sections:TvSection[];settingsError:string;api:{get:(path:string)=>Promise<{data:any}>} };
const normalized = (status: string) => status.toLowerCase().replaceAll('_', ' ');
export default function TechCheckTvBoard({ cards, names, readiness, scope, now, lastSuccess, error, stale, busy, rotation, exit, refresh,sections,settingsError,api }: Props) {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [fullscreenError, setFullscreenError] = useState('');
  const [fleetRefreshId,setFleetRefreshId]=useState(0);
  useEffect(() => { const resize = () => setSize({ width: window.innerWidth, height: window.innerHeight }); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  const pages = useMemo(() => configuredTvPages(cards,names,readiness,sections,size.width,size.height,chicagoDay(now)), [cards,names,readiness,sections,size,chicagoDay(now)]);
  const pageIndex = rotation % pages.length, page = pages[pageIndex];
  const summaryCards=Array.from(new Map(pages.flatMap(page=>page.kind==='work'?page.lanes.flatMap(lane=>lane.cards):[]).map(card=>[card.id,card])).values());
  const attention = summaryCards.filter(card => card.lane === 'attention').length;
  const working = summaryCards.filter(card => card.lane === 'progress').length;
  const fullscreen = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); setFullscreenError(''); }
    catch { setFullscreenError('Use Chrome’s full-screen option to fill the TV.'); }
  };
  const leave = () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); exit(); };
  return <section className='tech-check-tv' aria-label='Tech Check TV Board' data-page={pageIndex + 1} data-fleet-refresh={fleetRefreshId} data-section={page.section||'empty'}>
    <header className='tech-check-tv-header'>
      <div className='tech-check-tv-brand'><span className='tech-check-tv-eye' aria-hidden='true'><i /></span><div><small>CAMERAS ONSITE</small><h1>TECH CHECK <span>TV BOARD</span></h1></div></div>
      <div className='tech-check-tv-clock'><b>{now.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })}</b><span>{now.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'short', day: 'numeric' })} · CT</span></div>
    </header>
    {page.kind==='work'&&<div className='tech-check-tv-totals' aria-label='TV work summary'>
      <div><b>{summaryCards.filter(card => card.kind === 'job').length}</b><span>JOBS</span></div><div><b>{summaryCards.filter(card => card.kind === 'task').length}</b><span>SHOP TASKS</span></div><div><b>{summaryCards.filter(card => card.assignee === 'Unassigned').length}</b><span>UNASSIGNED</span></div><div><b>{working}</b><span>WORKING</span></div><div className={attention ? 'tv-attention' : ''}><b>{attention}</b><span>NEEDS ATTENTION</span></div><div><b>{summaryCards.filter(card => card.lane === 'complete').length}</b><span>DONE TODAY</span></div>
    </div>}
    {(error || stale) && <div className='tech-check-tv-warning' role='alert'>{lastSuccess ? 'UPDATES DELAYED · Showing the last saved snapshot.' : 'BOARD UNAVAILABLE · Waiting for live records.'} {error}</div>}
    {settingsError&&<p className='tv-settings-notice' role='status'>TV settings: {settingsError}</p>}
    <div className='tech-check-tv-page-title'><h2>{page.title}</h2><span>{['pickup','swap','delivery','service'].includes(page.section||'')?'ALL PENDING':page.section==='today'?'TODAY':page.section==='shop'?'TODAY + OVERDUE':'LIVE VIEW'} · {pageIndex + 1} / {pages.length}</span></div>
    <main className={'tech-check-tv-content' + (size.height < 900 ? ' tv-short' : '')}>
      {!lastSuccess ? <div className='tech-check-tv-empty' role='status'>{error ? 'Check the connection and Tech Check sign-in, then refresh.' : 'Loading saved jobs and shop tasks…'}</div> : page.kind === 'work' ? <div className='tech-check-tv-lanes' style={{ gridTemplateColumns: `repeat(${Math.max(1, page.lanes.length)}, minmax(0, 1fr))` }}>
        {page.lanes.map(lane => <section className='tech-check-tv-lane' key={lane.name}><h3>{lane.name}</h3><div className='tech-check-tv-cards'>{lane.cards.map(card => <article key={card.id} className={'tech-check-tv-card tv-' + card.lane + (normalized(card.status) === 'scheduled' ? ' tv-scheduled' : '')}>
          <div className='tech-check-tv-card-meta'><span>{card.kind === 'task' ? 'SHOP TASK' : card.reference || 'COS JOB'}</span><b>{card.overdue ? 'OVERDUE' : card.priority === 'high' ? 'HIGH PRIORITY' : card.status}</b></div>
          <h4>{card.title}</h4><p>{card.site || (card.kind === 'task' ? card.department.toUpperCase() + ' TEAM' : 'Site not assigned')}</p>
          {card.kind === 'job' && <strong className='tech-check-tv-unit'>{[card.record.jobType, card.record.equipment, card.record.equipmentUnitTag].filter(Boolean).join(' · ')}</strong>}
          {card.record.goBack?.required && <strong className='tech-check-tv-go-back'>GO-BACK REQUIRED</strong>}
          <p className='tech-check-tv-instructions'>{String(card.kind === 'task' ? card.record.instructions || card.record.ownerNotes || '' : card.record.instructions || '')}</p>
          <footer><b>{card.status}</b><span>{boardDateLabel(card.date)}</span></footer>
        </article>)}</div></section>)}
        {!page.lanes.length && <div className='tech-check-tv-empty'>No jobs or shop tasks in this view.</div>}
      </div> : page.kind==='readiness'?<div className='tech-check-tv-readiness'>{page.rows.map(row => { const summary = readinessSummary(row),exempt=vehicleInspectionExempt(row); return <article key={row.userId}><h3>{row.name}<span>{row.department.toUpperCase()}</span></h3>{exempt?<p>No company vehicle · truck and trailer inspections do not apply.</p>:(['truck','trailer'] as const).map(key => <div key={key}><span>{key === 'truck' ? 'Truck inspection' : 'Trailer inspection'}</span><b className={'tv-readiness-' + summary[key].state}>{summary[key].label}</b></div>)}<div><span>{exempt?'IT shop inventory':'Inventory record'}</span><b className={'tv-readiness-'+summary.inventory.state}>{summary.inventory.label}</b></div><small>{row.completedAt ? 'Completed ' + boardDateLabel(row.completedAt) : row.startedAt ? 'Started ' + boardDateLabel(row.startedAt) : 'No check recorded today'}</small></article>; })}</div>:page.kind==='empty'?<div className='tech-check-tv-empty'>Exit TV and turn on a section in TV board settings.</div>:null}
      <TvFleetView api={api} enabled={Boolean(lastSuccess)&&sections.some(section=>section==='camera'||section==='map')} mode={lastSuccess&&(page.kind==='camera'||page.kind==='map')?page.kind:null} rotation={Math.floor(rotation/pages.length)} height={size.height} refreshId={fleetRefreshId}/>
    </main>
    <footer className='tech-check-tv-footer'><div><span className={'tech-check-tv-live' + (error || stale ? ' delayed' : '')} /><b>{error || stale ? 'UPDATES DELAYED' : lastSuccess ? 'LIVE BOARD' : 'CONNECTING'}</b><span>{lastSuccess ? 'Updated ' + lastSuccess.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) + ' CT' : 'Waiting for first update'} · Refresh 60s · Rotate {TV_ROTATION_MS / 1000}s</span></div><nav aria-label='TV controls'><button type='button' onClick={()=>{refresh();setFleetRefreshId(value=>value+1);}} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button><button type='button' onClick={() => void fullscreen()}>Full screen</button><button type='button' onClick={leave}>Exit TV</button></nav></footer>
    {fullscreenError && <p className='tech-check-tv-fullscreen-note' role='status'>{fullscreenError}</p>}
  </section>;
}

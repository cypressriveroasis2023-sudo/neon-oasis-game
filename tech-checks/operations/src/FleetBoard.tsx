import {useEffect, useState} from 'react';
import {CameraMarks, StatusWord} from './FleetCameraStatusMarks';
import {BOARD_NOT_AVAILABLE, boardSearch, type BoardSite, type BoardView} from './fleetBoard';

type Props = {
  view: BoardView;
  interactive: boolean;
  siteKey: string | null;
  onSite: (key: string | null) => void;
};

const timeText = (value: string | null) => {
  if (!value) return null;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  return new Date(at).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const pair = (up: number | null, total: number | null) => up === null || total === null
  ? <strong>—</strong>
  : <strong>{up}<small> / {total}</small></strong>;

export function BoardMapNotes({view}: {view: BoardView}) {
  return <>
    <p className='cos-board-note'>Address estimates · {view.unplaced} sites not on the map</p>
    <p className='cos-board-legend'><i className='is-green'/>All good <i className='is-red'/>Needs attention <i className='is-grey'/>Unknown</p>
    <p className='cos-board-foot'>In Watchful, not armed today: {view.notArmedToday === null ? BOARD_NOT_AVAILABLE : view.notArmedToday} · In shop: {view.inShop === null ? BOARD_NOT_AVAILABLE : view.inShop}</p>
  </>;
}

export default function FleetBoard({view, interactive, siteKey, onSite}: Props) {
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const site = siteKey ? view.sites.find(item => item.key === siteKey) || null : null;
  const open = Boolean(site || problemsOpen);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setProblemsOpen(false); onSite(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onSite]);
  const results = interactive && query.trim() ? boardSearch(view.sites, query) : [];
  const read = timeText(view.readAt);
  const problemsLabel = view.stale ? '?' : String(view.problems.length);
  const openSite = (key: string) => { setProblemsOpen(false); onSite(key); };
  return <div className={'cos-stage cos-board' + (view.stale ? ' is-stale' : '') + (interactive ? '' : ' cos-board-wall')} data-board-mode={interactive ? 'desktop' : 'wall'}>
    <p className='cos-board-read'>{view.stale ? 'Last good read' : 'Last read'} <b>{read || BOARD_NOT_AVAILABLE}</b></p>
    {view.stale && <p className='cos-board-banner' role='status'>Data is late. Showing Unknown (grey) until the next read.</p>}
    <div className='cos-board-boxes' aria-label='Fleet board counts'>
      <div className='cos-board-box' data-board-box='units'><span>Units online</span>{pair(view.unitsOnline.up, view.unitsOnline.total)}<small>{view.stale ? 'Unknown' : 'in the field'}</small></div>
      <div className='cos-board-box' data-board-box='cameras'><span>Cameras online</span>{pair(view.camerasOnline.up, view.camerasOnline.total)}<small>{view.stale ? 'Unknown' : ''}</small></div>
      <div className='cos-board-box' data-board-box='sites'><span>Sites armed</span>{pair(view.sitesArmed.up, view.sitesArmed.total)}<small>{view.immixSites === null ? BOARD_NOT_AVAILABLE : '+ ' + view.immixSites + ' Immix'}</small></div>
      {interactive && !view.stale
        ? <button type='button' className={'cos-board-box cos-board-problems' + (view.problems.length ? '' : ' is-clear')} data-board-box='problems' onClick={() => setProblemsOpen(true)}><span>Problems</span><strong>{problemsLabel}</strong><small>tap to see list</small></button>
        : <div className='cos-board-box cos-board-problems' data-board-box='problems' aria-disabled='true'><span>Problems</span><strong>{problemsLabel}</strong><small>{view.stale ? 'unknown while data is late' : 'see red dots'}</small></div>}
    </div>
    {interactive && <label className='cos-board-search'>Search
      <input aria-label='Search sites, units, cameras, and EYE numbers' value={query} onChange={event => setQuery(event.target.value)}/>
    </label>}
    {interactive && query.trim() && <ul className='cos-board-results' aria-label='Search results'>
      {results.length ? results.map(hit => <li key={hit.siteKey}><button type='button' onClick={() => openSite(hit.siteKey)}>{hit.label}</button></li>) : <li>No matching site, unit, camera, or EYE number.</li>}
    </ul>}
    {(problemsOpen || site) && <div className='cos-board-overlay' onClick={event => { if (event.target === event.currentTarget) { setProblemsOpen(false); onSite(null); } }}>
      <section className='cos-board-card' role='dialog' aria-label={site ? site.name : 'Problems'}>
        <button type='button' className='cos-board-close' onClick={() => { setProblemsOpen(false); onSite(null); }}>Close</button>
        {site ? <SiteCard site={site} stale={view.stale}/> : <>
          <h2>{view.problems.length} problems need action</h2>
          <ul className='cos-board-problems-list'>{view.problems.map(problem => (
            <li key={problem.siteKey + problem.unit + problem.what}><button type='button' onClick={() => openSite(problem.siteKey)}>
              <i data-problem={problem.what}/>
              <span>{problem.site}</span>
              <span>{problem.unit}</span>
              <strong>{problem.what}</strong>
              <em>{problem.since ? 'since ' + (timeText(problem.since) || BOARD_NOT_AVAILABLE) : BOARD_NOT_AVAILABLE}</em>
            </button></li>
          ))}</ul>
        </>}
      </section>
    </div>}
  </div>;
}

function SiteCard({site, stale}: {site: BoardSite; stale: boolean}) {
  const schedule = site.units.find(unit => unit.schedule)?.schedule || null;
  const alarms = site.units.flatMap(unit => unit.alarms || []);
  const contacts = site.units.flatMap(unit => unit.contacts || []);
  return <>
    <h2>{site.name}{site.immix && <span className='cos-board-immix'>Immix</span>}</h2>
    <ul className='cos-board-units'>{site.units.map(unit => (
      <li key={unit.id}><span>{unit.name}</span><StatusWord state={unit.status} stale={stale} cameraDown={unit.cameraDown}/><CameraMarks cameras={unit.cameras} stale={stale}/></li>
    ))}</ul>
    <div className='cos-board-meta'>
      <div><h3>Armed schedule (Watchful)</h3>{schedule ? schedule.map(line => <p key={line.day}><b>{line.day}</b> {line.window}</p>) : <p className='cos-board-missing'>{BOARD_NOT_AVAILABLE}</p>}</div>
      <div><h3>Site contacts</h3>{contacts.length ? contacts.map(contact => <p key={contact.name}>{contact.name}{contact.phone ? ' · ' + contact.phone : ''}{contact.email ? ' · ' + contact.email : ''}</p>) : <p className='cos-board-missing'>{BOARD_NOT_AVAILABLE}</p>}</div>
      <div><h3>Last alarm</h3>{alarms.length ? alarms.map(alarm => <p key={alarm.label + alarm.at}>{alarm.label} · {timeText(alarm.at) || BOARD_NOT_AVAILABLE}</p>) : <p className='cos-board-missing'>{BOARD_NOT_AVAILABLE}</p>}</div>
    </div>
  </>;
}

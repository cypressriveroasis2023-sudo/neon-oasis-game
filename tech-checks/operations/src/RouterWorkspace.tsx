import { useEffect, useRef, useState } from 'react';
import { useRouters } from './useRouters';
import { type RouterRow } from '../../supabase/functions/cos-operations-pages/routers';
import { api } from './api';
import { inventoryPlacement } from './fleetSnapshot';
import { INHAND_ROUTER_FRESHNESS_MS, routerLiveReading } from './inhandRouterStatus';
import { readRouterDetails, linkRouter, suggestUnit, type RouterDetails } from './routerDetails';
import './routers.css';
export const routerTime = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not recorded';
export { routerLiveReading };
export function RouterBadge({ row, now, placement }: { row: RouterRow; now: number; placement?: string | null }) {
  const reading = routerLiveReading(row, placement, now);
  return <span className={'router-badge router-' + reading.state} style={reading.color ? {color: reading.color} : undefined}>{reading.label}</span>;
}
function useExactPlacements() {
  const [byId, setById] = useState<Map<string, 'field' | 'shop' | 'unknown'>>(new Map());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    const clear = () => { if (live) { setById(new Map()); setReady(true); } };
    api.get('/api/field-map').then(result => {
      if (!live) return;
      const next = new Map<string, 'field' | 'shop' | 'unknown'>();
      const rows = [...(result.data?.inventoryItems || []), ...(result.data?.items || [])];
      for (const row of rows) if (row && typeof row.id === 'string' && !next.has(row.id)) next.set(row.id, inventoryPlacement(row));
      setById(next);
      setReady(true);
    }).catch(() => { if (live) { setById(new Map()); setReady(true); } });
    window.addEventListener('cos-private-data-invalidated', clear);
    return () => { live = false; window.removeEventListener('cos-private-data-invalidated', clear); };
  }, []);
  return {byId, ready};
}
function placementFor(row: RouterRow, placements: Map<string, 'field' | 'shop' | 'unknown'>) {
  if (row.match !== 'exact_name' || !row.candidateUnit?.id) return null;
  return placements.get(row.candidateUnit.id) || null;
}
function summarizeLive(rows: RouterRow[], placements: Map<string, 'field' | 'shop' | 'unknown'>, now: number) {
  const counts = {online: 0, offline: 0, unknown: 0, inShop: 0, outages: 0};
  for (const row of rows) {
    const reading = routerLiveReading(row, placementFor(row, placements), now);
    if (reading.state === 'in_shop') counts.inShop += 1;
    else counts[reading.state] += 1;
    counts.outages += reading.outageCount;
  }
  return counts;
}
export function RouterOverview({ openWorkspace }: { openWorkspace: (name: string) => void }) {
  const { data, error, loading, refresh, now } = useRouters();
  const placements = useExactPlacements();
  const summary = data && placements.ready ? summarizeLive(data.items, placements.byId, now) : null;
  return <section className='panel router-overview' aria-label='InHand router overview'>
    <div className='panelhead'><div><h2>InHand routers</h2><span>Live InHand status</span></div><button className='secondary' disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing routers…' : 'Refresh routers'}</button></div>
    {error && <p role='alert'>{error}{data ? ' Showing the previous inventory; status is aged from each InHand time.' : ''}</p>}
    <div className='router-metrics'>{[['ROUTERS', data?.items.length], ['ONLINE', summary?.online], ['OFFLINE', summary?.offline], ['UNKNOWN', summary?.unknown], ['IN SHOP', summary?.inShop]].map(([label, count]) => <div key={label}><b>{count ?? '—'}</b><span>{label}</span></div>)}</div>
    <p>Shop units show In Shop and add 0 to the offline count. GPS is not part of this feed. Location pins use stored COS coordinates.</p>
    <div className='purchase-actions'><button onClick={() => openWorkspace('InHand Routers')}>View routers</button><button className='secondary' onClick={() => openWorkspace('Field Map')}>Open location map</button></div>
  </section>;
}
const FILTERS: Array<[string, string]> = [['all', 'All'], ['online', 'Online'], ['offline', 'Offline'], ['unknown', 'Unknown'], ['in_shop', 'In Shop'], ['needs_link', 'No COS match']];
/** Short, phone-friendly age of an InHand reading: "4 min ago", "2 days ago". */
export function routerAge(value: string | null | undefined, now: number) {
  const at = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(at)) return 'No InHand time';
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return minutes + ' min ago';
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + ' hr ago';
  const days = Math.round(hours / 24);
  return days + (days === 1 ? ' day ago' : ' days ago');
}
function newestReading(rows: RouterRow[]) {
  let best = NaN;
  for (const row of rows) { const at = row.reportedAt ? Date.parse(row.reportedAt) : NaN; if (Number.isFinite(at) && !(at <= best)) best = at; }
  return Number.isFinite(best) ? best : null;
}
const matchNote = (row: RouterRow) => row.match === 'exact_name' ? null : row.match === 'ambiguous' ? 'Duplicate name · review' : 'No COS unit match';
export default function RouterWorkspace({ openMap }: { openMap: (unitId: string) => void }) {
  const { data, error, loading, refresh, now } = useRouters();
  const placements = useExactPlacements();
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [selectedId, setSelectedId] = useState('');
  const detailRef = useRef<HTMLElement>(null);
  const items = data?.items || [];
  const readingOf = (row: RouterRow) => routerLiveReading(row, placementFor(row, placements.byId), now);
  const filtered = items.filter(row => {
    const reading = readingOf(row);
    const statusOk = filter === 'all' || reading.state === filter || filter === 'needs_link' && row.match !== 'exact_name';
    const haystack = [row.unitKey, row.name, row.model].filter(Boolean).join(' ').toLowerCase();
    return statusOk && haystack.includes(query.trim().toLowerCase());
  });
  const selected = filtered.find(row => row.id === selectedId) || filtered[0];
  const selectedReading = selected ? readingOf(selected) : null;
  const ready = Boolean(data && placements.ready);
  const summary = ready ? summarizeLive(items, placements.byId, now) : null;
  const newest = ready ? newestReading(items) : null;
  const feedStale = ready && items.length > 0 && (newest === null || now - newest > INHAND_ROUTER_FRESHNESS_MS);
  const freshMinutes = Math.round(INHAND_ROUTER_FRESHNESS_MS / 60000);
  const choose = (id: string) => {
    setSelectedId(id);
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 700px)').matches) requestAnimationFrame(() => detailRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'}));
  };
  const tiles: Array<[string, string, number | undefined]> = [['online', 'Online', summary?.online], ['offline', 'Offline', summary?.offline], ['unknown', 'Unknown', summary?.unknown], ['in_shop', 'In Shop', summary?.inShop]];
  return <section className='panel module router-workspace' aria-label='InHand Routers workspace'>
    <div className='panelhead'><div><h2>InHand router status</h2><span>{data ? items.length + ' router records' : 'InHand feed'}{newest !== null ? ' · last reading ' + routerAge(new Date(newest).toISOString(), now).toLowerCase() : ''}</span></div><button disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing routers…' : 'Refresh routers'}</button></div>
    {error && <p className='operations-error' role='alert'>{error}{data && ' Showing the last successful inventory.'}</p>}
    {feedStale && <div className='router-stale' role='status'><b>InHand feed is behind</b><span>{newest === null ? 'No router has an InHand time yet.' : 'Newest reading is from ' + routerTime(new Date(newest).toISOString()) + ' (' + routerAge(new Date(newest).toISOString(), now) + ').'} Routers show Unknown until a reading less than {freshMinutes} minutes old comes in. Unknown is not Offline.</span></div>}
    {summary && <div className='router-tiles' role='group' aria-label='Router status counts'>{tiles.map(([key, label, count]) => <button type='button' key={key} className={'router-tile router-tile-' + key + (filter === key ? ' on' : '')} aria-pressed={filter === key} onClick={() => setFilter(filter === key ? 'all' : key)}><b>{count ?? '—'}</b><span>{label}</span></button>)}</div>}
    <div className='router-toolbar'><input aria-label='Search routers' enterKeyHint='search' value={query} onChange={e => setQuery(e.target.value)} placeholder='Search unit, router, or model'/><select aria-label='Router status filter' value={filter} onChange={e => setFilter(e.target.value)}>{FILTERS.map(([value, label]) => <option key={value} value={value}>{value === 'all' ? 'All routers' : value === 'needs_link' ? 'No unique same-name COS unit' : label}</option>)}</select></div>
    {(!data && !error || data && !placements.ready) && <p role='status'>Loading router inventory…</p>}
    {ready && <div className='router-layout'><div className='router-list' aria-label='Router records'>
      {filtered.map(row => { const reading = readingOf(row), note = matchNote(row); return <button type='button' className={'router-row router-row-' + reading.state + (selected?.id === row.id ? ' selected' : '')} key={row.id} onClick={() => choose(row.id)} aria-pressed={selected?.id === row.id}>
        <span className='router-row-main'><strong>{row.unitKey}</strong><small>{row.model || 'Model not recorded'} · {routerAge(row.reportedAt, now)}</small>{note && <small className='router-row-note'>{note}</small>}</span>
        <RouterBadge row={row} now={now} placement={placementFor(row, placements.byId)}/>
      </button>; })}
      {!filtered.length && <p className='router-empty'>No routers match this search or filter.</p>}
    </div><section ref={detailRef} className={'router-detail router-detail-' + (selectedReading?.state || 'none')} aria-label='Selected router details'>{selected && selectedReading ? <>
      <div className='router-detail-title'><div><h3>{selected.unitKey}</h3><small>{selected.name}</small></div><RouterBadge row={selected} now={now} placement={placementFor(selected, placements.byId)}/></div>
      <dl><div><dt>Model</dt><dd>{selected.model || 'Not recorded'}</dd></div><div><dt>InHand status</dt><dd>{selectedReading.label}</dd></div><div><dt>InHand time</dt><dd>{routerTime(selected.reportedAt)} <small>({routerAge(selected.reportedAt, now)})</small></dd></div><div><dt>Feed</dt><dd>{selected.reportedSource || 'Not recorded'}</dd></div><div><dt>GPS</dt><dd>Not available from this source</dd></div></dl>
      <section className='router-match'><b>COS unit</b><p>{selected.match === 'exact_name' ? 'Matched to the COS unit with the same name.' : selected.match === 'ambiguous' ? 'This name is duplicated. No unit is selected automatically.' : 'No exact same-name COS unit was found. Nothing is guessed from a partial name.'}</p>{selected.candidateUnit && <button className='secondary' onClick={() => openMap(selected.candidateUnit!.id)}>View same-name COS unit</button>}</section>
    </> : <p>Select a router.</p>}</section></div>}
    <UnlinkedRouters/>
    <details className='router-help'><summary><b>Live InHand status</b><span>How these colors work</span></summary><ul><li>Online and Offline come straight from the InHand feed.</li><li>Unknown means the reading is older than {freshMinutes} minutes, the router is MOFI or Cradlepoint, or no single COS unit has the same name. Unknown is never counted as Offline.</li><li>Shop units show In Shop and are not outages. Only a field unit can be Offline.</li><li>Router status is not camera health. Refresh only re-reads the saved feed; this page does not show network addresses.</li></ul>{data && <p className='router-caption'>Inventory loaded {routerTime(data.generatedAt)}.</p>}</details>
  </section>;
}

/* InHand routers that no COS unit has yet. Owner and IT link each one to its unit here; Tech Check writes who linked
   it, when and why into the camera inventory audit. Anyone else sees nothing, because the read itself is refused. */
export function UnlinkedRouters({ read = readRouterDetails, link = linkRouter }: { read?: typeof readRouterDetails; link?: typeof linkRouter } = {}) {
  const [data, setData] = useState<RouterDetails | null>(null), [note, setNote] = useState(''), [busy, setBusy] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>({}), [said, setSaid] = useState<Record<string, {ok: boolean; text: string}>>({});
  const load = async () => { const res = await read(); if (res.ok) { setData(res.data); setNote(''); } else setNote(res.denied ? '' : res.message); };
  useEffect(() => { void load(); }, []);
  if (!data) return note ? <p className='router-caption'>InHand routers not linked to a unit: {note}</p> : null;
  const units = data.units;
  const go = async (serial: string, unit: string) => {
    setBusy(serial);
    const res = await link(unit, serial);
    setSaid(s => ({...s, [serial]: {ok: res.ok, text: res.message}}));
    setBusy('');
    if (res.ok) void load();
  };
  return <section className='router-unlinked' aria-label='InHand routers not linked to a unit'>
    <h3>InHand routers not linked to a unit <small>{data.unmatched.length}</small></h3>
    <p className='router-caption'>Owner and IT only. Pick the COS unit each router is on and press Link. COS saves your name, the time and the router serial. Nothing changes in InHand. Shop spares can stay unlinked.</p>
    {!data.unmatched.length && <p className='router-empty'>Every InHand router is linked to a unit.</p>}
    <datalist id='router-unit-list'>{units.map(u => <option key={u} value={u}/>)}</datalist>
    <ul>{data.unmatched.map(r => {
      const value = picked[r.serial] ?? suggestUnit(r.name, units) ?? '';
      const valid = units.includes(value);
      const msg = said[r.serial];
      return <li key={r.serial} className={'router-unlinked-row ' + (r.online ? 'on' : 'off')}>
        <span className='router-row-main'><strong>{r.name || 'No name in InHand'}</strong><small>{[r.model, r.serial, r.online ? 'Online' : 'Offline'].filter(Boolean).join(' · ')}</small></span>
        <span className='router-unlinked-pick'>
          <input aria-label={'COS unit for router ' + r.serial} list='router-unit-list' value={value} placeholder='COS unit name' onChange={e => setPicked(p => ({...p, [r.serial]: e.target.value}))}/>
          <button type='button' disabled={!valid || busy !== ''} onClick={() => void go(r.serial, value)}>{busy === r.serial ? 'Linking…' : 'Link'}</button>
        </span>
        {msg && <small className={msg.ok ? 'router-ok' : 'operations-error'} role='status'>{msg.text}</small>}
      </li>;
    })}</ul>
  </section>;
}

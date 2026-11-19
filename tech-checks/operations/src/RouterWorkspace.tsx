import { useEffect, useState } from 'react';
import { useRouters } from './useRouters';
import { type RouterRow } from '../../supabase/functions/cos-operations-pages/routers';
import { api } from './api';
import { inventoryPlacement } from './fleetSnapshot';
import { INHAND_ROUTER_FRESHNESS_MS, routerLiveReading } from './inhandRouterStatus';
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
export default function RouterWorkspace({ openMap }: { openMap: (unitId: string) => void }) {
  const { data, error, loading, refresh, now } = useRouters();
  const placements = useExactPlacements();
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [selectedId, setSelectedId] = useState('');
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
  return <section className='panel module router-workspace' aria-label='InHand Routers workspace'>
    <div className='panelhead'><div><h2>InHand router status</h2><span>{data ? items.length + ' router records' : 'InHand feed'}</span></div><button disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing routers…' : 'Refresh routers'}</button></div>
    <div className='router-notice'><b>Live InHand status</b><p>Online and Offline come from the InHand feed. A MOFI or Cradlepoint router, a unit with no exact InHand match, and a reading older than {Math.round(INHAND_ROUTER_FRESHNESS_MS / 60000)} minutes show Unknown. Shop units show In Shop and are not outages. Refresh only reads the saved feed.</p></div>
    {error && <p className='operations-error' role='alert'>{error}{data && ' Showing the last successful inventory.'}</p>}
    {data && <p className='router-caption'>Inventory loaded {routerTime(data.generatedAt)}. Status is aged from each InHand reported time. A missing or stale time is Unknown, never Offline.</p>}
    <div className='router-toolbar'><input aria-label='Search routers' value={query} onChange={e => setQuery(e.target.value)} placeholder='Search router, unit, or model…'/><select aria-label='Router status filter' value={filter} onChange={e => setFilter(e.target.value)}><option value='all'>All router records</option><option value='online'>Online</option><option value='offline'>Offline</option><option value='unknown'>Unknown</option><option value='in_shop'>In Shop</option><option value='needs_link'>No unique same-name COS unit</option></select></div>
    {(!data && !error || data && !placements.ready) && <p role='status'>Loading router inventory…</p>}
    {data && placements.ready && <div className='router-layout'><div className='router-list' aria-label='Router records'>
      {filtered.map(row => <button className={selected?.id === row.id ? 'selected' : ''} key={row.id} onClick={() => setSelectedId(row.id)} aria-pressed={selected?.id === row.id}><div><strong>{row.unitKey}</strong><RouterBadge row={row} now={now} placement={placementFor(row, placements.byId)}/></div><small>{row.model || 'Model not recorded'}</small><small>InHand time: {routerTime(row.reportedAt)}</small><small>{row.match === 'exact_name' ? 'Exact unit key' : row.match === 'ambiguous' ? 'Ambiguous unit name · review needed' : 'No exact COS unit name'} · No GPS</small></button>)}
      {!filtered.length && <p>No router records match this filter.</p>}
    </div><section className='router-detail' aria-label='Selected router details'>{selected && selectedReading ? <>
      <div className='router-detail-title'><h3>{selected.name}</h3><RouterBadge row={selected} now={now} placement={placementFor(selected, placements.byId)}/></div>
      <dl><div><dt>Unit label</dt><dd>{selected.unitKey}</dd></div><div><dt>Model</dt><dd>{selected.model || 'Not recorded'}</dd></div><div><dt>InHand status</dt><dd style={selectedReading.color ? {color: selectedReading.color} : undefined}>{selectedReading.label}</dd></div><div><dt>InHand time</dt><dd>{routerTime(selected.reportedAt)}</dd></div><div><dt>Feed</dt><dd>{selected.reportedSource || 'Not recorded'}</dd></div><div><dt>GPS coordinates</dt><dd>Not available from this source</dd></div></dl>
      <p className='router-caption'>Shop counts as 0. A router-offline to-do is only for a field unit. This page does not show network addresses.</p>
      <section className='router-notice'><b>COS unit association</b><p>{selected.match === 'exact_name' ? 'A unique COS unit has the same key (ignoring case and whitespace). Partial names are not used.' : selected.match === 'ambiguous' ? 'This name is duplicated. No unit is selected automatically.' : 'No exact same-name COS unit was found. Nothing is guessed from a partial name.'}</p>{selected.candidateUnit && <button className='secondary' onClick={() => openMap(selected.candidateUnit!.id)}>View same-name COS unit</button>}</section>
    </> : <p>Select a router record.</p>}</section></div>}
  </section>;
}

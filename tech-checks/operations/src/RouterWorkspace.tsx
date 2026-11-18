import { useState } from 'react';
import { useRouters } from './useRouters';
import { routerLabels, routerStatus, summarizeRouters, type RouterRow } from '../../supabase/functions/cos-operations-pages/routers';
import { displayedRouterStatus } from '../../supabase/functions/cos-operations-pages/routerBoardJoin.mjs';
import { portUnreachableTally, routerRowView } from './shopReader';
import './routers.css';
export const routerTime = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not recorded';
const asRouterView = (row: RouterRow, role?: string | null) => routerRowView({ probeStatus: row.probeStatus, checkedAt: row.checkedAt, boardStatus: (row as RouterRow & { boardStatus?: string }).boardStatus, candidateUnit: row.candidateUnit }, role);
export function RouterBadge({ row, now }: { row: RouterRow; now: number }) {
  const shop = asRouterView(row);
  if (shop) return <span className='router-badge router-shop' style={{color:shop.color}}>{shop.primary}</span>;
  const status = routerStatus(row, now); const board = row.boardStatus ? displayedRouterStatus(row.boardStatus, row.boardCheckedAt || row.checkedAt, now) : null; const shopBoard = board === 'In Shop'; return <span className={'router-badge ' + (shopBoard ? 'router-shop' : 'router-' + status)}>{board || routerLabels[status]}</span>;
}
export function RouterOverview({ openWorkspace }: { openWorkspace: (name: string) => void }) {
  const { data, error, loading, refresh, now } = useRouters();
  const summary = data ? summarizeRouters(data.items, now) : null;
  const unreachable = data ? portUnreachableTally(data.items, now) : undefined;
  return <section className='panel router-overview' aria-label='InHand router overview'>
    <div className='panelhead'><div><h2>InHand routers</h2><span>Camera Health management-port observations</span></div><button className='secondary' disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing routers…' : 'Refresh routers'}</button></div>
    {error && <p role='alert'>{error}{data ? ' Showing the previous inventory; status is aged from each check.' : ''}</p>}
    <div className='router-metrics'>{[['ROUTERS', data?.items.length], ['PORT REACHABLE', summary?.reachable], ['PORT UNREACHABLE', unreachable], ['STALE / UNKNOWN', summary ? summary.stale + summary.unknown : undefined]].map(([label, count]) => <div key={label}><b>{count ?? '—'}</b><span>{label}</span></div>)}</div>
    <p>GPS feed not connected. Location pins use stored COS coordinates. A failed port check does not establish cellular or cloud offline status.</p>
    <div className='purchase-actions'><button onClick={() => openWorkspace('InHand Routers')}>View routers & IPs</button><button className='secondary' onClick={() => openWorkspace('Field Map')}>Open location map</button></div>
  </section>;
}
export default function RouterWorkspace({ openMap, role }: { openMap: (unitId: string) => void; role?: string | null }) {
  const { data, error, loading, refresh, now } = useRouters();
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [selectedId, setSelectedId] = useState('');
  const items = data?.items || [];
  const filtered = items.filter(row => (filter === 'all' || routerStatus(row, now) === filter || filter === 'needs_link' && row.match !== 'exact_name') && [row.unitKey, row.name, row.model, row.publicIp, row.unitIp].filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  const selected = filtered.find(row => row.id === selectedId) || filtered[0];
  return <section className='panel module router-workspace' aria-label='InHand Routers workspace'>
    <div className='panelhead'><div><h2>Router inventory & reachability</h2><span>{data ? items.length + ' Camera Health router records' : 'Camera Health source'}</span></div><button disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing routers…' : 'Refresh routers'}</button></div>
    <div className='router-notice'><b>InHand GPS feed not connected</b><p>These records provide saved IPs and management-port checks. They contain no GPS, cellular signal, SIM, or cloud online/offline telemetry. Refresh reads existing observations; it does not run a router probe.</p></div>
    {error && <p className='operations-error' role='alert'>{error}{data && ' Showing the last successful inventory.'}</p>}
    {data && <p className='router-caption'>Inventory loaded {routerTime(data.generatedAt)}. Saved records reload every 15 minutes while visible. Checks older than 20 minutes are marked stale; this includes timing allowance and does not establish an outage.</p>}
    <div className='router-toolbar'><input aria-label='Search routers' value={query} onChange={e => setQuery(e.target.value)} placeholder='Search router, unit, model, or IP…'/><select aria-label='Router status filter' value={filter} onChange={e => setFilter(e.target.value)}><option value='all'>All router records</option><option value='reachable'>Port reachable</option><option value='unreachable'>Port unreachable</option><option value='stale'>Stale check</option><option value='unknown'>Not verified</option><option value='needs_link'>No unique same-name COS unit</option></select></div>
    {!data && !error && <p role='status'>Loading router inventory…</p>}
    {data && <div className='router-layout'><div className='router-list' aria-label='Router records'>
      {filtered.map(row => <button className={selected?.id === row.id ? 'selected' : ''} key={row.id} onClick={() => setSelectedId(row.id)} aria-pressed={selected?.id === row.id}><div><strong>{row.unitKey}</strong>{row.doNotUse&&<b className='cos-do-not-use-badge'>DO NOT USE</b>}<RouterBadge row={row} now={now}/></div><small>{row.model || 'Model not recorded'} · {row.publicIp || row.unitIp || 'IP not recorded'}</small><small>Last check: {routerTime(row.checkedAt)}</small><small>{row.match === 'exact_name' ? 'Same-name COS unit · unconfirmed link' : row.match === 'ambiguous' ? 'Ambiguous unit name · review needed' : 'No exact COS unit name'} · No GPS</small></button>)}
      {!filtered.length && <p>No router records match this filter.</p>}
    </div><section className='router-detail' aria-label='Selected router details'>{selected ? <>
      <div className='router-detail-title'><h3>{selected.name}</h3>{selected.doNotUse&&<b className='cos-do-not-use-badge'>DO NOT USE</b>}<RouterBadge row={selected} now={now}/></div>
      <dl><div><dt>Unit label</dt><dd>{selected.unitKey}</dd></div><div><dt>Model</dt><dd>{selected.model || 'Not recorded'}</dd></div><div><dt>Router public IP</dt><dd>{selected.publicIp || 'Not recorded'}</dd></div><div><dt>Unit IP in source</dt><dd>{selected.unitIp || 'Not recorded'}</dd></div><div><dt>Management port</dt><dd>{selected.port ?? 'Not recorded'} {selected.protocol || ''}</dd></div><div><dt>Last TCP check</dt><dd>{routerTime(selected.checkedAt)}</dd></div><div><dt>Saved probe result</dt><dd>{asRouterView(selected, role)?.visibleProbe || selected.probeStatus}</dd></div>{asRouterView(selected, role)?.detail && <p className='router-caption'>{asRouterView(selected, role)?.detail}</p>}<div><dt>Last recorded recovery</dt><dd>{routerTime(selected.lastRecoveredAt)}</dd></div><div><dt>GPS coordinates</dt><dd>Not available from this source</dd></div></dl>
      <p className='router-caption'>Recovery time is not last seen. Saved IP addresses are inventory values, not a verified current WAN address. Port reachability is separate from camera health and InHand cloud connectivity.</p>
      <details><summary>Imported status & observation source</summary><dl><div><dt>Reported status</dt><dd>{selected.reportedStatus}</dd></div><div><dt>Reported at</dt><dd>{routerTime(selected.reportedAt)}</dd></div><div><dt>Source</dt><dd>{selected.reportedSource}</dd></div></dl><p>Imported status is historical context and never determines current reachability. Saved latency is omitted because the source may retain it after a failed check.</p></details>
      <section className='router-notice'><b>COS unit association</b><p>{selected.match === 'exact_name' ? 'A unique COS unit has the same name (ignoring case and whitespace). This is a display suggestion, not a verified router-to-unit link.' : selected.match === 'ambiguous' ? 'This name is duplicated. No unit is selected automatically.' : 'No exact same-name COS unit was found. Alias and number-format matches need review.'}</p>{selected.candidateUnit && <button className='secondary' onClick={() => openMap(selected.candidateUnit!.id)}>View same-name COS unit</button>}</section>
    </> : <p>Select a router record.</p>}</section></div>}
  </section>;
}

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { api } from './api';
import { checkedFieldMap } from './gpsPersistence';
import { isCurrentFieldPin, type FieldLocation } from './fieldLocations';
import { cameraDashboardSummary } from './cameraDashboardSummary';
import { checkedTrackerSnapshot, trackerAccess } from './unitTracker';
import { readRouterSnapshot, summarizeRouters } from '../../supabase/functions/cos-operations-pages/routers';
import { readVrmFleetConfig } from '../../supabase/functions/cos-operations-pages/vrm';
import { readITMhelpInfo, readITAssignments } from './itMhelpBridge';
import './itDashboard.css';

type ReadState<T> = { data: T | null; loading: boolean; error: string; readAt: number | null };
type Summary = {
  count: number; label: string; metrics: { label: string; value: number | string }[];
  note: string; detail?: string; caution?: boolean;
};

/** A card owns its pending read. No global gate, settled cache, or write retry.
 * Deferring connect's first read avoids StrictMode's discarded setup request.
 * Every completion is tied to the exact connection and request generation. */
export function createITSourceReader<T>(load: () => Promise<T>, enabled = true, keepPrevious = true) {
  let state: ReadState<T> = { data: null, loading: enabled, error: '', readAt: null };
  let connected = false, revision = 0, pending: number | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: ReadState<T>) => { state = next; listeners.forEach(listener => listener()); };
  const refresh = async () => {
    if (!connected || !enabled || pending !== null) return;
    const request = ++revision;
    pending = request;
    publish({ ...state, ...(!keepPrevious ? { data: null, readAt: null } : {}), loading: true, error: '' });
    try {
      const data = await load();
      if (connected && request === revision) publish({ data, loading: false, error: '', readAt: Date.now() });
    } catch (cause) {
      if (connected && request === revision) {
        const status = (cause as { response?: { status?: number } } | null)?.response?.status;
        const denied = status === 401 || status === 403;
        publish({ ...state, ...(denied ? { data: null, readAt: null } : {}), loading: false,
          error: cause instanceof Error ? cause.message : 'These records could not be verified. Try again.' });
      }
    } finally { if (request === revision) pending = null; }
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    connect: () => {
      connected = true;
      const connection = ++revision;
      queueMicrotask(() => { if (connected && connection === revision) void refresh(); });
      return () => { connected = false; revision++; pending = null; };
    },
  };
}

export function summarizeITFieldMap(value: unknown): Summary {
  const field = checkedFieldMap(value);
  const rows = field.items as FieldLocation[];
  return { count: rows.length, label: 'field units', metrics: [
    { label: 'Saved addresses', value: rows.filter(row => typeof row.address === 'string' && row.address.trim()).length },
    { label: 'Owner-verified pins', value: rows.filter(isCurrentFieldPin).length },
  ], note: 'Saved installation locations. Live router GPS is not connected.' };
}

export function summarizeITRouters(value: unknown, now = Date.now()): Summary {
  const routers = readRouterSnapshot(value), counts = summarizeRouters(routers.items, now);
  return { count: routers.items.length, label: 'router records', metrics: [
    { label: 'Port reachable', value: counts.reachable },
    { label: 'Port unreachable', value: counts.unreachable },
    { label: 'Stale / unverified', value: counts.stale + counts.unknown },
  ], caution: counts.unreachable > 0 || counts.stale + counts.unknown > 0,
  note: 'Saved management-port checks, separate from cellular and cloud status.' };
}

export function summarizeITCameras(value: unknown, now = Date.now()): Summary {
  const cameras = cameraDashboardSummary(value, now);
  if (!cameras.available || !cameras.coverage) throw new Error('Source-separated Camera Health could not be verified.');
  const coverage = cameras.coverage;
  return { count: coverage.total, label: 'active / unresolved units', metrics: [
    { label: 'Provider online', value: coverage.online },
    { label: 'Provider offline', value: coverage.offline },
    { label: 'Provider review', value: coverage.review },
  ], caution: (cameras.attention ?? 0) > 0, detail: cameras.cameraCoverage,
  note: 'Reported resources do not verify every camera or video. Older observations stay unverified.' };
}

export function summarizeITVrm(value: unknown): Summary {
  const fleet = readVrmFleetConfig(value);
  const sync = {
    not_configured: 'Automatic fleet sync is not configured.', idle: 'Fleet sync is waiting for its first run.',
    syncing: 'Fleet sync is in progress.', current: 'Fleet sync is up to date.',
    stale: 'Fleet sync is delayed; these are the last saved installations.', error: 'Fleet sync could not complete.',
  }[fleet.sync.state];
  return { count: fleet.items.length, label: 'power installations', metrics: [
    { label: 'Shared dashboards', value: fleet.items.filter(item => item.embedUrl !== null).length },
  ], caution: ['stale', 'error'].includes(fleet.sync.state), detail: sync,
  note: 'Open an authorized Victron dashboard for battery, solar and power readings.' };
}

export function summarizeITTracker(value: unknown): Summary {
  const tracker = checkedTrackerSnapshot(value);
  if (tracker.availability === 'unavailable') throw new Error('Tracker source and pending request summaries are unavailable. Open Unit Tracker to review current COS inventory.');
  return { count: tracker.sources.length, label: tracker.sourcesTruncated ? 'linked tracker rows shown' : 'linked tracker rows', metrics: [
    { label: tracker.requestsTruncated ? 'Recent requests shown' : 'Pending requests', value: tracker.requests.length },
    { label: 'Source review needed', value: tracker.sourcesHeld ?? 0 },
  ], caution: Boolean(tracker.sourcesHeld || tracker.sourcesTruncated || tracker.requestsTruncated),
  detail: tracker.sourcesTruncated || tracker.requestsTruncated ? 'This summary is limited. Open the tracker to review saved source and request details.' : undefined,
  note: 'Sheets connection required. Pending requests are saved in COS and have not been published.' };
}

export function summarizeITMhelp(value: Awaited<ReturnType<typeof readITMhelpInfo>>): Summary {
  return { count: value.items.length, label: 'your Tech Check tickets', metrics: [
    { label: 'Unfinished', value: value.items.filter(item => !item.finished).length },
    { label: 'Finished', value: value.items.filter(item => item.finished).length },
  ], detail: value.items.length ? value.items.slice(0, 2).map(item => [item.ticketNumber, item.site].filter(Boolean).join(' · ')).join(' / ') : 'No tickets returned for your current Ticket Lead account.',
  note: 'MHelp ticket information already available to your signed-in IT account.' };
}

export function summarizeITAssignments(value: Awaited<ReturnType<typeof readITAssignments>>): Summary {
  return { count: value.items.length, label: 'active IT assignments', metrics: [
    { label: 'Assigned to you', value: value.items.filter(item => item.audience === 'mine').length },
    { label: 'Department queue', value: value.items.filter(item => item.audience === 'department').length },
  ], note: 'Your assigned or started work and unclaimed IT department work. A Ticket Lead is not required.' };
}

function ITAssignmentSummary({ session }: { session: Record<string, any> }) {
  const reader = useMemo(() => createITSourceReader(readITAssignments, true, false), [session]);
  const state = useSyncExternalStore(reader.subscribe, reader.getSnapshot, reader.getSnapshot);
  useEffect(() => reader.connect(), [reader]);
  const summary = state.data ? summarizeITAssignments(state.data) : null;
  return <section className='it-dashboard-assignment-summary' aria-label='IT assignment queue summary' aria-busy={state.loading}>
    <h3>Your IT assignments and department queue</h3>
    {summary ? <><div className='it-dashboard-assignment-count'><strong>{summary.count.toLocaleString()}</strong> {summary.label}</div><dl className='it-dashboard-metrics'>{summary.metrics.map(metric => <div key={metric.label}><dd>{metric.value}</dd><dt>{metric.label}</dt></div>)}</dl><p className='it-dashboard-note'>{summary.note}</p><p className='it-dashboard-note'>Queue read {new Date(state.data!.generatedAt).toLocaleString()}</p></> : <p className='it-dashboard-note' role='status'>{state.loading ? 'Loading IT assignment queue…' : 'IT assignment count unavailable.'}</p>}
    {state.error && <p className='it-dashboard-error' role='alert'>{state.error}</p>}
    <button type='button' className='it-dashboard-refresh' disabled={state.loading} onClick={() => void reader.refresh()}>{state.loading ? 'Loading IT queue…' : 'Refresh IT queue'}</button>
  </section>;
}

type Source = {
  id: string; label: string; route: string; description: string; icon: string;
  read: () => Promise<unknown>; summarize: (value: any, now: number) => Summary;
  allowed?: (session: Record<string, any>) => boolean; unavailable?: string;
};
const read = (path: string) => async () => (await api.get(path)).data;
const sources: Source[] = [
  { id: 'field', label: 'Field View', route: 'Field Map', description: 'Locate units and review saved installation details.', icon: 'map', read: read('/api/field-map'), summarize: summarizeITFieldMap },
  { id: 'routers', label: 'InHand Routers', route: 'InHand Routers', description: 'Router inventory and timestamped connection checks.', icon: 'router', read: read('/api/routers'), summarize: summarizeITRouters },
  { id: 'cameras', label: 'Camera Health', route: 'Camera Health', description: 'Provider observations and camera coverage by unit.', icon: 'camera', read: read('/api/camera-health/summary-v3'), summarize: summarizeITCameras },
  { id: 'victron', label: 'Victron', route: 'Victron VRM', description: 'Solar, battery and power dashboards for your fleet.', icon: 'power', read: read('/api/vrm-fleet'), summarize: summarizeITVrm,
    allowed: session => session.features?.vrmRead === true, unavailable: 'Victron access is not enabled for this account.' },
  { id: 'tracker', label: 'Unit Tracker', route: 'Unit Tracker', description: 'Unit records and pending changes for the 2027 tracker.', icon: 'units', read: read('/api/unit-tracker'), summarize: summarizeITTracker,
    allowed: trackerAccess, unavailable: 'Unit Tracker access is not enabled for this account.' },
  { id: 'mhelp', label: 'MHelp information', route: 'MHelp', description: 'Your ticket numbers, sites and assigned equipment.', icon: 'tickets', read: readITMhelpInfo, summarize: summarizeITMhelp },
];

function DashboardIcon({ name }: { name: string }) {
  // Keep this landing page independent of full workspaces, maps and provider embeds.
  const paths: Record<string, string> = {
    map: 'M9 18l-6 3V5l6-3 6 3 6-3v16l-6 3-6-3z M9 2v16 M15 5v16',
    router: 'M3 14h18v6H3z M7 14V9 M17 14V9 M7 17h.01 M11 17h.01 M8 6a6 6 0 0 1 8 0 M5 3a10 10 0 0 1 14 0',
    camera: 'M3 7h12v10H3z M15 10l6-3v10l-6-3',
    power: 'M13 2L4 14h7l-1 8 10-13h-7z',
    units: 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10 M7 5l10 4',
    tickets: 'M7 3h10v3h3v15H4V6h3z M7 3v5h10V3 M8 12h8 M8 16h5',
  };
  return <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d={paths[name]}/></svg>;
}

function ITSourceCard({ source, session, now, navigate }: { source: Source; session: Record<string, any>; now: number; navigate: (workspace: string) => void }) {
  const enabled = !source.allowed || source.allowed(session);
  // A different verified session gets a new, empty store synchronously. An old
  // account's late response can never populate the new account's cards.
  const reader = useMemo(() => createITSourceReader(async () => {
    const value = await source.read();
    source.summarize(value, Date.now());
    return value;
  }, enabled), [source, session, enabled]);
  const state = useSyncExternalStore(reader.subscribe, reader.getSnapshot, reader.getSnapshot);
  useEffect(() => reader.connect(), [reader]);
  const summary = useMemo(() => state.data === null ? null : source.summarize(state.data, now), [source, state.data, now]);
  const status = !enabled ? 'Access not enabled' : state.loading ? summary ? 'Refreshing' : 'Loading' : state.error ? summary ? 'Previous snapshot' : 'Unavailable' : summary?.caution ? 'Review details' : 'Snapshot loaded';
  return <article className={'it-dashboard-card it-dashboard-card-' + source.id} aria-labelledby={'it-card-' + source.id} data-source={source.id}>
    <div className='it-dashboard-card-top'><span className='it-dashboard-icon'><DashboardIcon name={source.icon}/></span><span className={'it-dashboard-status' + (state.error || summary?.caution ? ' it-dashboard-status-caution' : '')} role='status'>{status}</span></div>
    <h2 id={'it-card-' + source.id}>{source.label}</h2>
    <p className='it-dashboard-description'>{source.description}</p>
    <div className='it-dashboard-snapshot' aria-busy={state.loading}>
      {!enabled ? <p className='it-dashboard-empty'>{source.unavailable}</p> : summary ? <>
        <div className='it-dashboard-count'><strong>{summary.count.toLocaleString()}</strong><span>{summary.label}</span></div>
        <dl className='it-dashboard-metrics'>{summary.metrics.map(metric => <div key={metric.label}><dd>{typeof metric.value === 'number' ? metric.value.toLocaleString() : metric.value}</dd><dt>{metric.label}</dt></div>)}</dl>
        {summary.detail && <p className='it-dashboard-detail'>{summary.detail}</p>}
        <p className='it-dashboard-note'>{summary.note}</p>
      </> : <p className='it-dashboard-empty'>{state.loading ? 'Checking authorized records…' : 'Summary unavailable. Open this view or retry.'}</p>}
      {state.error && <p className='it-dashboard-error' role='alert'>{state.error}{summary ? ' Showing the last successful snapshot.' : ''}</p>}
    </div>
    {source.id === 'mhelp' && <ITAssignmentSummary session={session} />}
    <div className='it-dashboard-card-bottom'>
      <span className='it-dashboard-read-time'>{state.readAt ? <>Read <time dateTime={new Date(state.readAt).toISOString()}>{new Date(state.readAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></> : 'Source status kept separate'}</span>
      <div className='it-dashboard-actions'>
        <button type='button' className='it-dashboard-open' disabled={!enabled} onClick={() => navigate(source.route)}>Open {source.label}<span aria-hidden='true'>↗</span></button>
        {enabled && <button type='button' className='it-dashboard-refresh' aria-label={(state.error ? 'Retry ' : 'Refresh ') + source.label} disabled={state.loading} onClick={() => void reader.refresh()}>{state.loading ? 'Checking…' : state.error ? 'Retry' : 'Refresh'}</button>}
      </div>
    </div>
  </article>;
}

export default function ITDashboard({ session, navigate }: { session: Record<string, any>; navigate: (workspace: string) => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const age = () => { if (!document.hidden) setNow(Date.now()); };
    const timer = window.setInterval(age, 60_000);
    document.addEventListener('visibilitychange', age);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', age); };
  }, []);
  return <section className='it-dashboard' aria-label='IT Dashboard'>
    <header className='it-dashboard-heading'><div><p className='it-dashboard-eyebrow'>CAMERAS ONSITE · IT</p><h1>Your IT dashboard</h1><p>Fleet views, connection checks and ticket information in one place.</p></div><span className='it-dashboard-mode'>Read-only overview</span></header>
    <div className='it-dashboard-grid'>{sources.map(source => <ITSourceCard key={source.id} source={source} session={session} now={now} navigate={navigate}/>)}</div>
    <p className='it-dashboard-footnote'>Each source loads independently. Refresh reads saved records; it does not run device probes. Opening a view keeps its existing permissions.</p>
  </section>;
}

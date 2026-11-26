import { useCallback, useEffect, useRef, useState } from 'react';
import { api, OperationsApiError } from './api';
import { getVrmFleet } from './vrmFleetApi';
import { readVrmFleetConfig, type VrmUnit } from '../../supabase/functions/cos-operations-pages/vrm';
import './vrm.css';
import VrmReadOnlyDashboard from './VrmReadOnlyDashboard';
import { readDashboardPower, shortDate, unitTileSummary } from './vrmReadOnlyModel';
import { heliosPlacement, placementLabel, victronNeedsAttention } from './victronAttention';
import { canonicalCameraUnit } from './fieldCameraHealth';
import { mpptLine, readVrmMppt, type Mppt } from './vrmMppt';
import { cloudyWarning, heliosSpots, outlookLine, readSunForecast, sunOutlook, type SunDay } from './vrmWeather';
import { dayPeak, historyFlags, isNightForecastTime, nightLoad, last24h, overnightLow, readVrmHistory, solarVsYesterday, tonightBasis, tonightForecast, tonightHeadline, tonightSteps, type HistoryPoint, type Tonight } from './vrmHistory';
import VrmTechGuide from './VrmTechGuide';
import VrmNightReport, { nightLevel } from './VrmNightReport';
import { nightReport } from './vrmNightReport';
import VrmHistoryChart from './VrmHistoryChart';

type FleetSync = ReturnType<typeof readVrmFleetConfig>['sync'];
type SelectionHint = { initialUnit?:number; initialInstallationId?:number };
function requestedInstallation(items:VrmUnit[], hint:SelectionHint) {
  if (hint.initialInstallationId !== undefined) return items.find(item => item.installationId === hint.initialInstallationId)?.installationId ?? null;
  // Old dashboard shortcuts name a unit. Resolve only an exact, unique label;
  // the installation ID remains the identity after the first selection.
  if (!Number.isSafeInteger(hint.initialUnit) || (hint.initialUnit ?? 0) < 1) return null;
  const matches = items.filter(item => item.name === 'HELIOS ' + String(hint.initialUnit).padStart(3, '0'));
  return matches.length === 1 ? matches[0].installationId : null;
}
function syncDescription(sync:FleetSync) {
  return {
    not_configured:'Automatic fleet sync is not configured.',
    idle:'Fleet sync is waiting for its first run.',
    syncing:'Fleet sync is in progress.',
    current:'Fleet is up to date.',
    stale:'Fleet sync is delayed. Showing the last saved installations.',
    error:'Fleet sync could not complete.',
  }[sync.state];
}
function workspaceVisible() {
  if (document.visibilityState !== 'visible') return false;
  const frame = window.frameElement;
  return !frame || (frame.getClientRects().length > 0 && getComputedStyle(frame).visibility !== 'hidden');
}
function shortTime(value:string|null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString(undefined, {hour:'numeric',minute:'2-digit'}) : null;
}
const toneLabel = {good:'Charged',fair:'Half or less',low:'Low battery',stale:'Stale reading',none:'No reading',unavailable:'Unavailable'};
function readableTime(value:string|null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, {timeZoneName:'short'}) : null;
}

export default function VrmWorkspace({initialUnit,initialInstallationId,onSelectInstallation,canDiscover=true}:{canDiscover?:boolean;initialUnit?:number;initialInstallationId?:number;onSelectInstallation?:(installationId:number)=>void}) {
  const [privateInvalidated, setPrivateInvalidated] = useState(false);
  const valid = useRef(true);
  const [power, setPower] = useState<ReturnType<typeof readDashboardPower>>({rows:[],invalid:false});
  const [now, setNow] = useState(Date.now());
  const [units, setUnits] = useState<VrmUnit[]>([]);
  const [sync, setSync] = useState<FleetSync|null>(null);
  const [selected, setSelected] = useState<number|null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  // Field or Shop per mHelp, read once. Until it loads (or if it fails) every unit stays "Placement unknown" and nothing is flagged.
  const [inventory, setInventory] = useState<{unitNumber?: string}[] | null>(null);
  // Sun forecast for Field Helios units (best-effort, every 3 hours). Nothing is stored.
  const [sky, setSky] = useState<Map<string, SunDay[]> | null>(null);
  const spotsKey = inventory ? [...heliosSpots(inventory)].map(([k, v]) => k + '@' + v.lat + ',' + v.lon).join(';') : '';
  useEffect(() => {
    if (!spotsKey || !inventory) return;
    let live = true;
    const read = () => { void readSunForecast(heliosSpots(inventory)).then(map => { if (live && map) setSky(map); }); };
    read();
    const timer = window.setInterval(() => { if (workspaceVisible()) read(); }, 3 * 3600_000);
    return () => { live = false; window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotsKey]);
  // Saved Victron history by installation, read separately and best-effort. Absent = no history shown.
  const [history, setHistory] = useState<Map<number, HistoryPoint[]> | null>(null);
  const [mppt, setMppt] = useState<Map<number, Mppt> | null>(null);
  const mounted = useRef(false);
  const running = useRef(false);
  const request = useRef(0);
  const hint = useRef<SelectionHint>({initialUnit,initialInstallationId});
  const latestUnits = useRef<VrmUnit[]>([]);
  const refresh = useCallback(async (discover = false) => {
    if (!mounted.current || !valid.current || running.current) return;
    running.current = true;
    const current = ++request.current;
    setLoading(true);
    try {
      const data = (await getVrmFleet(api, discover && canDiscover)).data;
      const fleet = readVrmFleetConfig(data);
      if (!mounted.current || !valid.current || current !== request.current) return;
      latestUnits.current = fleet.items;
      setUnits(fleet.items);
      setPower(readDashboardPower(data.power, fleet.items));
      setNow(Date.now());
      setSync(fleet.sync);
      setSelected(previous => fleet.items.some(item => item.installationId === previous)
        ? previous : requestedInstallation(fleet.items, hint.current) ?? fleet.items[0]?.installationId ?? null);
      setLoaded(true);
      setError('');
    } catch (cause) {
      if (!mounted.current || !valid.current || current !== request.current) return;
      // A transient read failure retains the last successful fleet. Failed
      // authorization clears all installation details and approved sharing links.
      if (cause instanceof OperationsApiError && [401,403].includes(cause.response.status)) {
        latestUnits.current = []; setUnits([]); setPower({rows:[],invalid:false}); setSelected(null); setSync(null); setLoaded(false);
      }
      setError(cause instanceof Error ? cause.message : 'The Victron fleet could not be loaded.');
    } finally {
      if (current === request.current) {
        running.current = false;
        if (mounted.current) setLoading(false);
      }
    }
  }, [canDiscover]);
  useEffect(() => {
    mounted.current = true; valid.current = true; setPrivateInvalidated(false);
    let active = true;
    const clear = () => {
      valid.current = false; request.current += 1; running.current = false;
      latestUnits.current = []; setUnits([]); setPower({rows:[],invalid:false}); setSelected(null); setSync(null); setLoaded(false); setLoading(false); setPrivateInvalidated(true);
      setError('Your session changed. Reload COS Operations to verify the current account.');
    };
    const parentMessage = (event:MessageEvent) => { if (event.origin === location.origin && event.source === window.parent && event.data?.type === 'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE') clear(); };
    window.addEventListener('cos-private-data-invalidated',clear);
    window.addEventListener('message',parentMessage);
    // Defer the initial read so StrictMode's setup/cleanup probe cannot create
    // an orphaned request or leave the single-flight guard locked.
    queueMicrotask(() => { if (active) void refresh(); });
    api.get('/api/field-map').then(response => {
      if (!active) return;
      const data = response.data as {inventoryItems?: unknown; items?: unknown};
      const items = Array.isArray(data?.inventoryItems) ? data.inventoryItems : Array.isArray(data?.items) ? data.items : null;
      setInventory(items ? items.filter((item): item is {unitNumber?: string} => Boolean(item) && typeof item === 'object') : null);
    }).catch(() => { if (active) setInventory(null); });
    const readHistory = () => { void readVrmHistory().then(units => { if (active && units) setHistory(new Map(units.map(u => [u.installationId, u.points]))); }); };
    const readMppt = () => { void readVrmMppt().then(map => { if (active && map) setMppt(map); }); };
    readHistory(); readMppt();
    const historyTimer = window.setInterval(() => { if (workspaceVisible()) { readHistory(); readMppt(); } }, 15 * 60_000);
    const dropHistory = () => { setHistory(null); setMppt(null); };
    window.addEventListener('cos-private-data-invalidated', dropHistory);
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (workspaceVisible()) void refresh();
    }, 60_000);
    return () => { window.clearInterval(historyTimer); window.removeEventListener('cos-private-data-invalidated', dropHistory); active = false; valid.current = false; mounted.current = false; request.current += 1; running.current = false; window.clearInterval(timer); window.removeEventListener('cos-private-data-invalidated',clear); window.removeEventListener('message',parentMessage); };
  }, [refresh]);
  useEffect(() => {
    hint.current = {initialUnit,initialInstallationId};
    const requested = requestedInstallation(latestUnits.current, hint.current);
    if (requested !== null) setSelected(requested);
    // A refresh must preserve the selected ID, even if names or order change.
    // This effect handles only an incoming navigation target.
  }, [initialUnit,initialInstallationId]);
  const select = (installationId:number) => { setSelected(installationId); onSelectInstallation?.(installationId); };
  const index = units.findIndex(item => item.installationId === selected);
  const unit = index < 0 ? null : units[index];
  const enabled = units.filter(item => item.embedUrl).length;
  const nameCounts = new Map<string,number>();
  for (const item of units) nameCounts.set(item.name, (nameCounts.get(item.name) ?? 0) + 1);
  const tiles0 = (item: typeof units[number]) => unitTileSummary(item, power.rows, now).fresh;
  const tonight = new Map<number, Tonight>();
  for (const item of units) { const t = history && tiles0(item) ? tonightForecast(history.get(item.installationId) ?? [], now) : null; if (t) tonight.set(item.installationId, t); }
  const weather = new Map<string, ReturnType<typeof sunOutlook>>();
  if (sky) for (const [key, days] of sky) { const o = sunOutlook(days, now); if (o.length) weather.set(key, o); }
  const night = units.length > 0 && history ? nightReport(units, history, now, name => heliosPlacement(name, inventory) === 'shop') : null;
  const nightRows = new Map((night?.rows ?? []).map(r => [r.installationId, r]));
  const attention = victronNeedsAttention(units, power.rows, inventory, now, history, tonight, weather, mppt);
  // Only speak about Field power once at least one unit's Field/Shop is known from mHelp.
  const placed = units.filter(item => heliosPlacement(item.name, inventory) !== 'unknown').length;
  const tiles = new Map(units.map(item => [item.installationId, unitTileSummary(item, power.rows, now)]));
  const tally = (tones:string[]) => [...tiles.values()].filter(tile => tones.includes(tile.tone)).length;
  const summary = [
    {key:'good', label:'Reporting', value:tally(['good','fair','low'])},
    {key:'low', label:'Low battery', value:tally(['low'])},
    {key:'stale', label:'Stale / no reading', value:tally(['stale','none'])},
    {key:'unavailable', label:'Unavailable', value:tally(['unavailable'])},
  ];
  const syncTone = !sync ? 'stale' : error || sync.state === 'error' ? 'low' : sync.state === 'current' ? 'good' : 'stale';
  const lastSuccess = readableTime(sync?.lastSuccessAt ?? null);
  const nextSync = readableTime(sync?.nextSyncAt ?? null);
  return <section className={'panel module vrm-workspace' + (expanded ? ' vrm-expanded' : '')} aria-label='Victron VRM Helios fleet'>
    <div className='panelhead vrm-fleet-heading'><div><span className='vrm-eyebrow'>HELIOS · ENERGY SYSTEMS</span><h2>Helios power monitoring</h2><span>Victron Remote Management · {loaded ? units.length + (units.length === 1 ? ' installation' : ' installations') : loading ? 'Loading fleet…' : 'Fleet unavailable'}</span></div>
      <div className='purchase-actions'><a className='operations-reference-link' href='https://vrm.victronenergy.com/installation-overview' target='_blank' rel='noopener noreferrer'>Open VRM fleet ↗</a><button className='secondary' onClick={() => void refresh(canDiscover)} disabled={loading || privateInvalidated}>{loading ? 'Checking fleet…' : canDiscover ? 'Refresh fleet' : 'Reload saved fleet'}</button></div>
    </div>
    {error && <p role='alert'>{error}{privateInvalidated ? '' : loaded ? ' Showing the last successfully loaded fleet; it may be out of date.' : ' Reload the fleet to try again.'}</p>}
    {sync && <div className={'vrm-sync-status vrm-tone-'+syncTone} role='status'>
      <p className='vrm-sync-line'><i aria-hidden='true'/><strong>{error ? 'Saved sync status, not reverified: ' : ''}{syncDescription(sync)}</strong>{sync.error ? <span> {sync.error}</span> : null}</p>
      <p className='vrm-sync-times'>{lastSuccess ? <span title={lastSuccess}>Synced {shortTime(sync.lastSuccessAt ?? null)}</span> : <span>No successful sync yet</span>}{nextSync && <span title={nextSync}>Next {shortTime(sync.nextSyncAt ?? null)}</span>}<span>{sync.scheduleActive ? 'Auto every 15 min' : 'Auto sync off'}</span></p>
    </div>}
    {units.length > 0 && <ul className='vrm-fleet-summary' aria-label='Fleet power summary'>{summary.map(item => <li key={item.key} className={'vrm-tone-'+item.key}><strong>{item.value}</strong><span>{item.label}</span></li>)}</ul>}
    {units.length > 0 && placed > 0 && <section className={'vrm-attention' + (attention.length ? '' : ' vrm-attention-clear')} aria-label='Needs attention'>
      <h3>{attention.length ? 'Needs attention · Field units' : 'No Field power issues'}</h3>
      {attention.length > 0 && <ul>{attention.map(item => <li key={item.installationId}><button type='button' className={'vrm-attn-'+item.kind} onClick={() => select(item.installationId)}><strong>{item.name}</strong><span>{item.line}</span></button></li>)}</ul>}
    </section>}
    {night && <VrmNightReport report={night}/>}
    {units.length > 0 && <VrmTechGuide/>}
    {!loaded && loading && <p role='status'>Loading your Victron installations…</p>}
    {loaded && units.length === 0 && <div className='vrm-awaiting' role='status'><h3>No installations in the saved fleet</h3><p>{canDiscover ? 'Refresh the fleet to check the connected Victron account.' : 'No saved installations are available. Ask an Owner to check the fleet sync.'} No installation IDs or dashboards are assumed.</p></div>}
    {units.length > 0 && <nav className='tabs vrm-unit-grid' aria-label='Helios installations'>{units.map(item => <button key={item.installationId} className={(selected === item.installationId ? 'selected' : 'secondary') + ' vrm-tone-' + tiles.get(item.installationId)!.tone} aria-pressed={selected === item.installationId} onClick={() => select(item.installationId)}>
      <span className='vrm-tile-head'><strong>{item.name}</strong>{heliosPlacement(item.name, inventory) !== 'unknown' && <em aria-hidden='true' className={'vrm-place vrm-place-'+heliosPlacement(item.name, inventory)}>{placementLabel(heliosPlacement(item.name, inventory))}</em>}</span>{(nameCounts.get(item.name) ?? 0) > 1 && <small>Installation {item.installationId}</small>}<small className={item.available === false ? 'vrm-tile-status' : 'vrm-sr-only'}>{item.available === false ? 'Unavailable in latest sync' : item.embedUrl ? 'Dashboard enabled' : 'Read-only power'}</small>
      {(() => { const tile = tiles.get(item.installationId)!; if (tile.tone === 'unavailable') return tile.lastSeen ? <span className='vrm-tile-reading' aria-hidden='true'><span className='vrm-tile-solar vrm-tile-seen'>Last seen {shortDate(tile.lastSeen, now)}</span></span> : null; return <span className='vrm-tile-reading' aria-hidden='true' title={toneLabel[tile.tone]}>
        <span className='vrm-tile-soc'><i/>{tile.soc ? Math.round(tile.soc.value) + '%' : '—'}</span>
        <span className='vrm-tile-bar'><b style={{width: (tile.soc ? Math.max(0, Math.min(100, tile.soc.value)) : 0) + '%'}}/></span>
        {tile.tone === 'stale' || tile.tone === 'none'
          ? <span className='vrm-tile-solar vrm-tile-seen'>{tile.lastSeen ? 'Last seen ' + shortDate(tile.lastSeen, now) : 'Never connected'}</span>
          : <span className='vrm-tile-solar'>☀ {tile.solar ? Math.round(tile.solar.value) + ' ' + tile.solar.unit : '—'}</span>}
        {tile.alarms.length > 0
          ? <span className={'vrm-tile-alarm vrm-alarm-' + tile.alarms[0].level}>⚠ {tile.alarms[0].kind}{tile.alarms[0].level === 1 ? ' warning' : ''}</span>
          : (t => t && (t.verdict === 'low' || t.verdict === 'tight')
            ? <span className={'vrm-tile-night vrm-night-' + t.verdict} title={tonightHeadline(t)}>{t.verdict === 'low' ? (t.floorAt !== null ? '🌙 20% by ' + new Date(t.floorAt * 1000).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'}) : '🌙 Low tonight') : '🌙 Tight tonight'}</span>
            : null)(tonight.get(item.installationId)) || tile.flow && <span className={'vrm-tile-flow vrm-flow-' + tile.flow.state} title={tile.flow.state === 'charging' ? 'Charging' : tile.flow.state === 'draining' ? 'Draining' : 'Idle'}>{tile.flow.state === 'idle' ? 'Idle' : (tile.flow.state === 'charging' ? '↑ ' : '↓ ') + (tile.flow.watts !== null ? Math.abs(tile.flow.watts) + ' W' : tile.flow.amps !== null ? Math.abs(tile.flow.amps) + ' A' : '') + (tile.flow.state === 'charging' ? ' in' : ' out')}</span>}
        {(r => r && r.status !== 'none' && <span className={'vrm-tile-low vrm-lvl-' + nightLevel(r)} title={night?.done ? 'Lowest battery last night (5 PM–7 AM)' : 'Lowest battery so far tonight'}>{r.status === 'power' ? '🔌 Plugged in' : '🌙 Low ' + r.low + '%'}</span>)(nightRows.get(item.installationId))}
      </span>; })()}
    </button>)}</nav>}
    {unit && <>
    <div className='vrm-dashboard-heading'><div className='vrm-selected-unit'><span className='vrm-eyebrow'>SELECTED INSTALLATION</span><h3>{unit.name}</h3><span className='vrm-access-status'>{unit.available === false ? 'Unavailable in the latest fleet sync' : unit.embedUrl ? 'Read-only dashboard' : 'Read-only power dashboard'}</span></div>
      <div className='vrm-view-actions' aria-label='Dashboard controls'>
        <div className='vrm-step-controls'><button className='secondary' aria-label='Previous Helios unit' disabled={index <= 0} onClick={() => select(units[index - 1].installationId)}>←</button><span>{index + 1} / {units.length}</span><button className='secondary' aria-label='Next Helios unit' disabled={index >= units.length - 1} onClick={() => select(units[index + 1].installationId)}>→</button></div>
        {unit.embedUrl && <><button className='secondary' onClick={() => setRevision(value => value + 1)}>Reload view</button><button className='secondary' aria-expanded={expanded} aria-controls='vrm-dashboard' onClick={() => setExpanded(value => !value)}>{expanded ? 'Compact view' : 'Expand dashboard'}</button></>}
        <a className='operations-reference-link' href={unit.portalUrl} target='_blank' rel='noopener noreferrer'>Open {unit.name} in VRM ↗</a>
      </div>
    </div>
    <div className='vrm-dashboard-stage'>
    <dl className='vrm-installation-info' aria-label='Selected installation information'>
      <div><dt>Unit</dt><dd>{unit.name}</dd></div>
      <div><dt>VRM installation</dt><dd>{unit.installationId}</dd></div>
      <div><dt>Dashboard access</dt><dd>{loading ? 'Checking access' : error ? 'Last saved access' : unit.available === false ? 'Unavailable' : 'Read-only enabled'}</dd></div>
      <div><dt>Embedded dashboards</dt><dd>{enabled} / {units.length} configured</dd></div>
    </dl>
    {unit.available === false && <p className='vrm-note'>This installation was not available in the latest fleet sync.{readableTime(unit.lastSeenAt ?? null) ? ' Last seen: ' + readableTime(unit.lastSeenAt ?? null) + '.' : ''} Its saved portal link may require restored access in Victron.</p>}
    {unit.embedUrl ? <iframe id='vrm-dashboard' key={unit.installationId + '-' + revision} className='vrm-dashboard' title={unit.name + ' Victron dashboard'} src={unit.embedUrl} referrerPolicy='no-referrer' sandbox='allow-scripts allow-same-origin allow-forms allow-popups' allow='fullscreen'/>
      : <VrmReadOnlyDashboard unit={unit} rows={power.rows} invalid={power.invalid} readFailed={Boolean(error)} now={now}/> }
    </div>
    {history && (() => {
      const points = history.get(unit.installationId) ?? [];
      const day = last24h(points, now);
      if (day.length < 2) return <section className='vrm-history'><h4>Last 24 hours</h4><p className='vrm-note'>History is building up. It starts from when it was switched on and fills in with each Victron sync.</p></section>;
      const night = overnightLow(points, now), sun = solarVsYesterday(points, now), flags = historyFlags(points, now);
      const t = tonightForecast(points, now), steps = t ? tonightSteps(t) : [];
      return <section className='vrm-history'>
        <div className={'vrm-tonight vrm-tonight-' + (t ? t.verdict : 'none')}>
          <h4>Tonight</h4>
          {t ? <>
            <p className='vrm-tonight-headline'>{tonightHeadline(t)}</p>
            <p className='vrm-tonight-basis'>{tonightBasis(t)}</p>
            {steps.length > 0 && <><p className='vrm-tonight-todo'>What to do</p><ol>{steps.map(step => <li key={step}>{step}</li>)}</ol></>}
          </> : <p className='vrm-tonight-basis'>{isNightForecastTime(now) ? 'Not enough recent readings to estimate tonight yet. It needs about an hour of readings from this unit.' : 'The tonight estimate starts at 5 PM, when the sun stops charging the battery.'}</p>}
        </div>
        <h4>Last 24 hours</h4>
        <VrmHistoryChart points={day} now={now}/>
        <ul className='vrm-history-facts'>
          <li className={night && night.low < 30 ? 'bad' : ''}><span>Overnight low</span><b>{night ? night.low + '%' : '—'}</b></li>
          <li className={sun && sun.share < 0.5 ? 'warn' : ''}><span>Solar vs yesterday</span><b>{sun ? Math.round(sun.share * 100) + '%' : '—'}</b></li>
          {(() => { const peak = dayPeak(points, now); return <li className={peak && peak.peak < 95 ? 'warn' : ''}><span>{peak ? 'Best battery ' + peak.label : 'Best battery today'}</span><b>{peak ? peak.peak + '%' : '—'}</b></li>; })()}
          {(() => { const load = nightLoad(points, now); return <li className={load?.high ? 'warn' : ''}><span>Night power use</span><b>{load ? load.recent + ' W' + (load.high ? ' (normal ' + load.normal + ')' : '') : '—'}</b></li>; })()}
        </ul>
        {(() => {
          const key = canonicalCameraUnit(unit.name), o = key ? weather.get(key) : undefined;
          if (!o?.length) return null;
          const tile = unitTileSummary(unit, power.rows, now), warn = cloudyWarning(o, tile.soc?.value);
          return <p className={'vrm-sky' + (warn ? ' vrm-sky-warn' : '')}><span>Sun ahead</span><b>{outlookLine(o)}</b>{warn && <em>{warn}</em>}</p>;
        })()}
        {(line => line && <p className='vrm-sky vrm-mppt'><span>Panels</span><b>{line}</b></p>)(mpptLine(mppt?.get(unit.installationId), now))}
        {flags.length > 0 && <p className='vrm-history-flag'>{flags.map(f => f.line).join(' · ')}</p>}
      </section>;
    })()}
    <p className='vrm-note'>{enabled} embedded dashboards · {units.length-enabled} COS read-only power views. New installations appear automatically after discovery. Installation names and portal links come from the saved fleet; battery and solar readings come from Victron.</p>
    </>}
    <details className='vrm-help'><summary>Dashboard help &amp; reporting</summary><p>Battery, solar, and load readings are supplied by Victron. Additional measurements depend on the equipment reporting from this installation. Use its VRM portal for history, alarms, and detailed charts. Tile colors: green 50% and up, amber 20–49%, red under 20%, grey when the reading is older than 45 minutes or missing.</p><p>Readings update at this unit’s configured VRM reporting interval. Check the dashboard’s last-update time before treating a reading as current. Reload view reloads the selected dashboard. {canDiscover ? 'Refresh fleet asks the server to discover installations now.' : 'Reload saved fleet reads the current saved installations. Fleet discovery and sharing settings remain with your Owner.'} This visible workspace checks the saved fleet every minute; automatic discovery runs separately every 15 minutes when configured.</p><p>For history, alarms, trends, and installation settings, use Open in VRM with your Victron account. COS displays existing approved Victron embeds or its own read-only power view. New installations do not need public sharing for the COS view. Neither view changes equipment settings.</p></details>
  </section>;
}

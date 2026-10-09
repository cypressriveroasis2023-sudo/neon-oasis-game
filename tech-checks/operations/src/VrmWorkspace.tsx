import { useCallback, useEffect, useRef, useState } from 'react';
import { api, OperationsApiError } from './api';
import { getVrmFleet } from './vrmFleetApi';
import { readVrmFleetConfig, type VrmUnit } from '../../supabase/functions/cos-operations-pages/vrm';
import './vrm.css';

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
function readableTime(value:string|null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, {timeZoneName:'short'}) : null;
}

export default function VrmWorkspace({initialUnit,initialInstallationId,onSelectInstallation,canDiscover=true}:{canDiscover?:boolean;initialUnit?:number;initialInstallationId?:number;onSelectInstallation?:(installationId:number)=>void}) {
  const [units, setUnits] = useState<VrmUnit[]>([]);
  const [sync, setSync] = useState<FleetSync|null>(null);
  const [selected, setSelected] = useState<number|null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const mounted = useRef(false);
  const running = useRef(false);
  const request = useRef(0);
  const hint = useRef<SelectionHint>({initialUnit,initialInstallationId});
  const latestUnits = useRef<VrmUnit[]>([]);
  const refresh = useCallback(async (discover = false) => {
    if (!mounted.current || running.current) return;
    running.current = true;
    const current = ++request.current;
    setLoading(true);
    try {
      const fleet = readVrmFleetConfig((await getVrmFleet(api, discover && canDiscover)).data);
      if (!mounted.current || current !== request.current) return;
      latestUnits.current = fleet.items;
      setUnits(fleet.items);
      setSync(fleet.sync);
      setSelected(previous => fleet.items.some(item => item.installationId === previous)
        ? previous : requestedInstallation(fleet.items, hint.current) ?? fleet.items[0]?.installationId ?? null);
      setLoaded(true);
      setError('');
    } catch (cause) {
      if (!mounted.current || current !== request.current) return;
      // A transient read failure retains the last successful fleet. Failed
      // authorization clears all installation details and approved sharing links.
      if (cause instanceof OperationsApiError && [401,403].includes(cause.response.status)) {
        latestUnits.current = []; setUnits([]); setSelected(null); setSync(null); setLoaded(false);
      }
      setError(cause instanceof Error ? cause.message : 'The Victron fleet could not be loaded.');
    } finally {
      running.current = false;
      if (mounted.current && current === request.current) setLoading(false);
    }
  }, [canDiscover]);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    // Defer the initial read so StrictMode's setup/cleanup probe cannot create
    // an orphaned request or leave the single-flight guard locked.
    queueMicrotask(() => { if (active) void refresh(); });
    const timer = window.setInterval(() => {
      if (workspaceVisible()) void refresh();
    }, 60_000);
    return () => { active = false; mounted.current = false; request.current += 1; window.clearInterval(timer); };
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
  const lastSuccess = readableTime(sync?.lastSuccessAt ?? null);
  const nextSync = readableTime(sync?.nextSyncAt ?? null);
  return <section className={'panel module vrm-workspace' + (expanded ? ' vrm-expanded' : '')} aria-label='Victron VRM Helios fleet'>
    <div className='panelhead vrm-fleet-heading'><div><span className='vrm-eyebrow'>HELIOS · ENERGY SYSTEMS</span><h2>Helios power monitoring</h2><span>Victron Remote Management · {loaded ? units.length + (units.length === 1 ? ' installation' : ' installations') : loading ? 'Loading fleet…' : 'Fleet unavailable'}</span></div>
      <div className='purchase-actions'><a className='operations-reference-link' href='https://vrm.victronenergy.com/installation-overview' target='_blank' rel='noopener noreferrer'>Open VRM fleet ↗</a><button className='secondary' onClick={() => void refresh(canDiscover)} disabled={loading}>{loading ? 'Checking fleet…' : canDiscover ? 'Refresh fleet' : 'Reload saved fleet'}</button></div>
    </div>
    {error && <p role='alert'>{error}{loaded ? ' Showing the last successfully loaded fleet; it may be out of date.' : ' Reload the fleet to try again.'}</p>}
    {sync && <div className='vrm-sync-status' role='status'><p>{error ? 'Saved sync status, not reverified: ' : ''}{syncDescription(sync)} {sync.error || ''}</p><p>{lastSuccess ? 'Last successful fleet sync: ' + lastSuccess + '. ' : 'No successful fleet sync recorded. '}{sync.scheduleActive ? 'Automatic discovery runs every 15 minutes.' : 'Automatic discovery is not active.'}{nextSync ? ' Next scheduled sync: ' + nextSync + '.' : ''}</p></div>}
    {!loaded && loading && <p role='status'>Loading your Victron installations…</p>}
    {loaded && units.length === 0 && <div className='vrm-awaiting' role='status'><h3>No installations in the saved fleet</h3><p>{canDiscover ? 'Refresh the fleet to check the connected Victron account.' : 'No saved installations are available. Ask an Owner to check the fleet sync.'} No installation IDs or dashboards are assumed.</p></div>}
    {units.length > 0 && <nav className='tabs vrm-unit-grid' aria-label='Helios installations'>{units.map(item => <button key={item.installationId} className={selected === item.installationId ? 'selected' : 'secondary'} aria-pressed={selected === item.installationId} onClick={() => select(item.installationId)}>
      <strong>{item.name}</strong>{(nameCounts.get(item.name) ?? 0) > 1 && <small>Installation {item.installationId}</small>}<small>{item.available === false ? 'Unavailable in latest sync' : item.embedUrl ? 'Dashboard enabled' : 'VRM portal'}</small>
    </button>)}</nav>}
    {unit && <>
    <div className='vrm-dashboard-heading'><div className='vrm-selected-unit'><span className='vrm-eyebrow'>SELECTED INSTALLATION</span><h3>{unit.name}</h3><span className='vrm-access-status'>{unit.available === false ? 'Unavailable in the latest fleet sync' : unit.embedUrl ? 'Read-only dashboard' : 'Victron portal access'}</span></div>
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
      <div><dt>Dashboard access</dt><dd>{loading ? 'Checking access' : error ? 'Last saved access' : unit.embedUrl ? 'Read-only enabled' : 'Open in VRM'}</dd></div>
      <div><dt>Embedded dashboards</dt><dd>{enabled} / {units.length} configured</dd></div>
    </dl>
    {unit.available === false && <p className='vrm-note'>This installation was not available in the latest fleet sync.{readableTime(unit.lastSeenAt ?? null) ? ' Last seen: ' + readableTime(unit.lastSeenAt ?? null) + '.' : ''} Its saved portal link may require restored access in Victron.</p>}
    {unit.embedUrl ? <iframe id='vrm-dashboard' key={unit.installationId + '-' + revision} className='vrm-dashboard' title={unit.name + ' Victron dashboard'} src={unit.embedUrl} referrerPolicy='no-referrer' sandbox='allow-scripts allow-same-origin allow-forms allow-popups' allow='fullscreen'/>
      : <div className='vrm-awaiting' role='status'><h3>Open this unit in VRM</h3><p>The full portal is available with your Victron sign-in. Displaying its dashboard here awaits approval of VRM’s read-only sharing settings.</p><a className='operations-reference-link' href={unit.portalUrl} target='_blank' rel='noopener noreferrer'>View {unit.name} dashboard ↗</a></div>}
    <p className='vrm-reporting-context'>Battery, solar, and load readings are supplied by Victron. Additional measurements depend on the equipment reporting from this installation. Use its VRM portal for history, alarms, and detailed charts.</p>
    </div>
    <p className='vrm-note'>{enabled} of {units.length} dashboards enabled inside COS. Installation names and portal links come from the saved fleet; battery and solar readings come from Victron.</p>
    </>}
    <details className='vrm-help'><summary>Dashboard help &amp; reporting</summary><p>Readings update at this unit’s configured VRM reporting interval. Check the dashboard’s last-update time before treating a reading as current. Reload view reloads the selected dashboard. {canDiscover ? 'Refresh fleet asks the server to discover installations now.' : 'Reload saved fleet reads the current saved installations. Fleet discovery and sharing settings remain with your Owner.'} This visible workspace checks the saved fleet every minute; automatic discovery runs separately every 15 minutes when configured.</p><p>For history, alarms, trends, and installation settings, use Open in VRM with your Victron account. COS shows Victron’s read-only dashboard; it does not change equipment settings.</p></details>
  </section>;
}

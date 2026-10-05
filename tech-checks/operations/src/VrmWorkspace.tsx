import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { heliosVrmUnits, readVrmPortalConfig, vrmPortalUrl, type VrmUnit } from '../../supabase/functions/cos-operations-pages/vrm';
import './vrm.css';

export default function VrmWorkspace() {
  const [units, setUnits] = useState<VrmUnit[]>(() => heliosVrmUnits.map(unit => ({ ...unit, portalUrl: vrmPortalUrl(unit.installationId), embedUrl: null })));
  const [selected, setSelected] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    setError('');
    // Remove any prior sharing links while fresh authorization/configuration is checked.
    setUnits(heliosVrmUnits.map(unit => ({ ...unit, portalUrl: vrmPortalUrl(unit.installationId), embedUrl: null })));
    try {
      const items = readVrmPortalConfig((await api.get('/api/vrm-portal')).data);
      if (current === request.current) { setUnits(items); setRevision(value => value + 1); }
    } catch (cause) {
      if (current === request.current) setError(cause instanceof Error ? cause.message : 'VRM dashboard links could not be loaded.');
    } finally { if (current === request.current) setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); return () => { request.current += 1; }; }, [refresh]);
  const unit = units.find(item => item.number === selected)!;
  const enabled = units.filter(item => item.embedUrl).length;
  return <section className={'panel module vrm-workspace' + (expanded ? ' vrm-expanded' : '')} aria-label='Victron VRM Helios fleet'>
    <div className='panelhead vrm-fleet-heading'><div><span className='vrm-eyebrow'>HELIOS · ENERGY SYSTEMS</span><h2>Helios power monitoring</h2><span>Victron Remote Management · 9 installations</span></div>
      <div className='purchase-actions'><a className='operations-reference-link' href='https://vrm.victronenergy.com/installation-overview' target='_blank' rel='noopener noreferrer'>Open VRM fleet ↗</a><button className='secondary' onClick={() => void refresh()} disabled={loading}>{loading ? 'Checking dashboards…' : 'Refresh dashboards'}</button></div>
    </div>
    {error && <p role='alert'>{error} Your signed-in VRM portal links remain available.</p>}
    <nav className='tabs vrm-unit-grid' aria-label='Helios installations'>{units.map(item => <button key={item.number} className={selected === item.number ? 'selected' : 'secondary'} aria-pressed={selected === item.number} onClick={() => setSelected(item.number)}>
      <strong>{item.name}</strong><small>{item.embedUrl ? 'Dashboard enabled' : 'VRM portal'}</small>
    </button>)}</nav>
    <div className='vrm-dashboard-heading'><div className='vrm-selected-unit'><span className='vrm-eyebrow'>SELECTED INSTALLATION</span><h3>{unit.name}</h3><span className='vrm-access-status'>{unit.embedUrl ? 'Read-only dashboard' : 'Victron portal access'}</span></div>
      <div className='vrm-view-actions' aria-label='Dashboard controls'>
        <div className='vrm-step-controls'><button className='secondary' aria-label='Previous Helios unit' disabled={selected === 1} onClick={() => setSelected(value => value - 1)}>←</button><span>{selected} / 9</span><button className='secondary' aria-label='Next Helios unit' disabled={selected === 9} onClick={() => setSelected(value => value + 1)}>→</button></div>
        {unit.embedUrl && <><button className='secondary' onClick={() => setRevision(value => value + 1)}>Reload view</button><button className='secondary' aria-expanded={expanded} aria-controls='vrm-dashboard' onClick={() => setExpanded(value => !value)}>{expanded ? 'Compact view' : 'Expand dashboard'}</button></>}
        <a className='operations-reference-link' href={unit.portalUrl} target='_blank' rel='noopener noreferrer'>Open {unit.name} in VRM ↗</a>
      </div>
    </div>
    <div className='vrm-dashboard-stage'>
    <dl className='vrm-installation-info' aria-label='Selected installation information'>
      <div><dt>Unit</dt><dd>{unit.name}</dd></div>
      <div><dt>VRM installation</dt><dd>{unit.installationId}</dd></div>
      <div><dt>Dashboard access</dt><dd>{loading ? 'Checking access' : error ? 'Check unavailable' : unit.embedUrl ? 'Read-only enabled' : 'Open in VRM'}</dd></div>
      <div><dt>Embedded dashboards</dt><dd>{loading || error ? 'Not verified' : enabled + ' / 9 configured'}</dd></div>
    </dl>
    {unit.embedUrl ? <>
      <iframe id='vrm-dashboard' key={unit.installationId + '-' + revision} className='vrm-dashboard' title={unit.name + ' Victron dashboard'} src={unit.embedUrl} referrerPolicy='no-referrer' sandbox='allow-scripts allow-same-origin allow-forms allow-popups' allow='fullscreen'/>
    </> : <div className='vrm-awaiting' role='status'><h3>{loading ? 'Checking embedded dashboard access…' : 'Open this unit in VRM'}</h3><p>The full portal is available with your Victron sign-in. Displaying its dashboard here awaits approval of VRM’s read-only sharing settings.</p><a className='operations-reference-link' href={unit.portalUrl} target='_blank' rel='noopener noreferrer'>View {unit.name} dashboard ↗</a></div>}
    <p className='vrm-reporting-context'>Battery, solar, and load readings are supplied by Victron below. Additional measurements depend on the equipment reporting from this installation. Use its VRM portal for history, alarms, and detailed charts.</p>
    </div>
    {!loading && !error && <p className='vrm-note'>{enabled} of 9 dashboards enabled inside COS. Unit names and portal links are verified; battery and solar readings come from Victron.</p>}
    <details className='vrm-help'><summary>Dashboard help &amp; reporting</summary><p>Readings update at this unit’s configured VRM reporting interval. Check the dashboard’s last-update time before treating a reading as current. Reload view reloads the selected dashboard; Refresh dashboards checks access to all nine installations.</p><p>For history, alarms, trends, and installation settings, use Open in VRM with your Victron account. COS shows Victron’s read-only dashboard; it does not change equipment settings.</p></details>
  </section>;
}

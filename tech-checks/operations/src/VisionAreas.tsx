import { useEffect, useRef, useState } from 'react';
import { primaryAreas, visionAreas, onHandInventory } from './visionAreas';
import './visionAreas.css';

type Api = { get(path: string): Promise<{ data: any }> };
export function AreaIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    camera: 'M3 7h12v10H3z M15 10l6-3v10l-6-3',
    router: 'M3 14h18v6H3z M7 14V8 M17 14V8 M7 17h.01 M11 17h.01 M8 5a6 6 0 0 1 8 0 M5 2a10 10 0 0 1 14 0',
    power: 'M13 2L4 14h7l-1 8 10-13h-7z',
    units: 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10 M7 5l10 4',
    map: 'M9 18l-6 3V5l6-3 6 3 6-3v16l-6 3-6-3z M9 2v16 M15 5v16',
    team: 'M15 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M23 21v-2a4 4 0 0 0-3-4 M17 3a4 4 0 0 1 0 8',
    operations: 'M4 5h16v16H4z M8 3v4 M16 3v4 M8 12h8 M8 16h5',
  };
  return <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d={paths[name] || paths.dashboard}/></svg>;
}
export function primaryWorkspace(active: string) {
  return primaryAreas.some(area => area.workspace === active) ? active : 'Operations';
}
const records = (data: any) => {
  if (!Array.isArray(data?.items) || data.items.some((row: any) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Records unavailable');
  return data.items as Record<string, any>[];
};
const sources: Record<string, string> = {
  'Camera Health': '/api/camera-health/summary', 'InHand Routers': '/api/routers',
  'Victron VRM': '/api/vrm-portal', 'Units On Hand': '/api/equipment',
  'Field Map': '/api/field-map', Team: '/api/team-production',
};
function summary(workspace: string, data: any): string {
  if (workspace === 'Camera Health') {
    if (!['online', 'offline', 'review', 'fieldDevices'].every(key => Number.isInteger(data?.[key]) && data[key] >= 0) || data.online + data.offline + data.review !== data.fieldDevices) throw new Error('Health unavailable');
    return `${data.online} online · ${data.offline} offline · ${data.review} to review`;
  }
  const rows = records(data);
  if (workspace === 'Units On Hand') {
    const { units, unknown } = onHandInventory(data);
    return `${units.length} confirmed on hand · ${unknown} placement not recorded`;
  }
  if (workspace === 'Field Map') {
    const { fieldUnits, mappedUnits } = data.summary || {};
    if (!Number.isInteger(fieldUnits) || !Number.isInteger(mappedUnits) || mappedUnits < 0 || mappedUnits > fieldUnits || fieldUnits !== rows.length) throw new Error('Locations unavailable');
    return `${fieldUnits} field units · ${mappedUnits} mapped · ${rows.filter(row => row.address?.trim()).length} with addresses`;
  }
  if (workspace === 'Victron VRM') return `${rows.length} power installations · open dashboards`;
  if (workspace === 'Team') return `${rows.filter(row => row.active === true).length} active team members`;
  return `${rows.length} routers · view connection checks`;
}
export default function VisionAreas({ api, navigate }: { api: Api; navigate(workspace: string): void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const revision = useRef(0);
  const refresh = async () => {
    const request = ++revision.current;
    setLoading(true);
    const entries = await Promise.all(visionAreas.map(async area => {
      try { return [area.workspace, summary(area.workspace, (await api.get(sources[area.workspace])).data)]; }
      catch { return [area.workspace, 'Status unavailable · open to check']; }
    }));
    if (request !== revision.current) return;
    setValues(Object.fromEntries(entries));
    setLoading(false);
  };
  useEffect(() => { void refresh(); return () => { revision.current += 1; }; }, []);
  return <section className='vision-areas' aria-label='VISION dashboard'>
    <header className='vision-areas-heading'><div><small>CAMERAS ONSITE</small><h1>VISION Operations</h1><p>Your fleet, power, locations and team in one place.</p></div><button className='secondary' disabled={loading} onClick={() => void refresh()}>{loading ? 'Checking fleet…' : 'Refresh fleet'}</button></header>
    <div className='vision-area-grid'>{visionAreas.map(area => <button type='button' className='vision-area-card' key={area.workspace} onClick={() => navigate(area.workspace)}>
      <span className='vision-area-icon'><AreaIcon name={area.icon}/></span><span className='vision-area-arrow' aria-hidden='true'>↗</span>
      <strong>{area.label}</strong><span>{area.description}</span><small role='status'>{loading ? 'Checking connected records…' : values[area.workspace]}</small>
    </button>)}</div>
  </section>;
}

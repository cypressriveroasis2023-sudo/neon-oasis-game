import { useEffect, useRef, useState } from 'react';
import { onHandInventory } from './visionAreas';
type Api = { get(path: string): Promise<{ data: any }> };
export default function UnitsOnHand({ api, navigate }: { api: Api; navigate(workspace: string): void }) {
  const [units, setUnits] = useState<Record<string, any>[] | null>(null);
  const [unknown, setUnknown] = useState(0);
  const [snapshot, setSnapshot] = useState<{ source: string; importedAt: string } | null>(null);
  const [query, setQuery] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const revision = useRef(0);
  const load = async () => {
    const request = ++revision.current;
    setLoading(true);
    try {
      const data = (await api.get('/api/equipment')).data;
      const inventory = onHandInventory(data);
      if (request === revision.current) { setUnits(inventory.units); setUnknown(inventory.unknown); setSnapshot(inventory.snapshot || null); setError(''); }
    } catch (cause) { if (request === revision.current) setError(cause instanceof Error ? cause.message : 'Inventory unavailable.'); }
    finally { if (request === revision.current) setLoading(false); }
  };
  useEffect(() => { void load(); return () => { revision.current += 1; }; }, []);
  const shown = (units || []).filter(unit => [unit.unitNumber, unit.modelName, unit.status, unit.currentLocationType].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  return <section className='panel module' aria-label='Units On Hand'>
    <div className='panelhead'><h2>Units On Hand</h2><span>{units ? `${units.length} at the shop / yard · ${units.filter(unit => unit.status === 'available').length} available` : 'Checking placement'}</span></div>
    <div className='purchase-actions'><input aria-label='Search units on hand' value={query} onChange={event => setQuery(event.target.value)} placeholder='Search unit, model or status…'/><button className='secondary' disabled={loading} onClick={() => void load()}>Refresh inventory</button><button className='secondary' onClick={() => navigate('Equipment')}>Manage equipment registry</button></div>
    {snapshot && <p>{snapshot.source} snapshot · imported {new Date(snapshot.importedAt).toLocaleString()}. Shop placement does not confirm deployment readiness.</p>}
    {units && unknown > 0 && <p role='status'>{unknown} registry units have no recorded placement. Confirm their shop or field location in the equipment registry.</p>}
    {error && <p role='alert'>{error}{units && ' Showing the last successful inventory.'}</p>}
    {!units && !error && <p role='status'>Loading inventory…</p>}
    {units && <div className='records'>{shown.map(unit => <article className='record' key={unit.id}><div><strong>{unit.unitNumber}</strong><small>{unit.modelName} · {unit.currentLocationType}{unit.recordSource && ` · ${unit.recordSource}`}</small>{unit.sourceVerifiedAt && <small>Placement verified {new Date(unit.sourceVerifiedAt).toLocaleString()}</small>}</div><em>{unit.status.replaceAll('_', ' ')}</em></article>)}{!shown.length && <p>No units match this view.</p>}</div>}
  </section>;
}

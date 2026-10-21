import { useEffect, useRef, useState } from 'react';
import { onHandInventory } from './visionAreas';
import {useFleetInventory} from './useFleetInventory';
import './dailyWorkspace.css';
type Api = { fleetSource?:(source:'fieldMap',force?:boolean)=>Promise<any>; get(path: string): Promise<{ data: any }> };
function RegistryReadiness({ api, navigate }: { api: Api; navigate(workspace: string): void }) {
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
  return <section className='panel module' aria-label='Registry readiness records'>
    <div className='panelhead'><h2>Registry readiness records</h2><span>{units ? `${units.length} registry shop records · ${units.filter(unit => unit.status === 'available').length} available` : 'Checking placement'}</span></div>
    <div className='purchase-actions'><input aria-label='Search units on hand' value={query} onChange={event => setQuery(event.target.value)} placeholder='Search unit, model or status…'/><button className='secondary' disabled={loading} onClick={() => void load()}>Refresh inventory</button><button className='secondary' onClick={() => navigate('Equipment')}>Manage equipment registry</button></div>
    {snapshot && <p>{snapshot.source} snapshot · imported {new Date(snapshot.importedAt).toLocaleString()}. Shop placement does not confirm deployment readiness.</p>}
    {units && unknown > 0 && <p role='status'>{unknown} registry units have no recorded placement. Confirm their shop or field location in the equipment registry.</p>}
    {error && <p role='alert'>{error}{units && ' Showing the last successful inventory.'}</p>}
    {!units && !error && <p role='status'>Loading inventory…</p>}
    {units && <div className='records'>{shown.map(unit => <article className='record' key={unit.id}><div><strong>{unit.unitNumber}</strong><small>{unit.modelName} · {unit.currentLocationType}{unit.recordSource && ` · ${unit.recordSource}`}</small>{unit.sourceVerifiedAt && <small>Placement verified {new Date(unit.sourceVerifiedAt).toLocaleString()}</small>}</div><em>{unit.status.replaceAll('_', ' ')}</em></article>)}{!shown.length && <p>No units match this view.</p>}</div>}
  </section>;
}

export default function UnitsOnHand({api,navigate,openUnit}:{api:Api;navigate(workspace:string):void;openUnit?:(id:string)=>void}){
 const {value,error,loading,refresh}=useFleetInventory(api),[query,setQuery]=useState(''),[limit,setLimit]=useState(40),[registry,setRegistry]=useState(false);
 const shop=value?.records.filter(r=>r.placement==='SHOP')||[], q=query.trim().toLowerCase();
 const shown=shop.filter(r=>[r.unitNumber,r.productId,r.category,r.customer,r.site,r.uploadLifecycle].join(' ').toLowerCase().includes(q));
 return <section className='cos-inventory-overview' aria-label='Units On Hand'>
  <header><div><h2>Shop / ROOT</h2><p>{value?value.authority.shop+' equipment records · same inventory as Fleet':'Reading reviewed inventory…'}</p></div><button disabled={loading} onClick={()=>void refresh(true)}>Refresh inventory</button></header>
  <p>At the shop does not mean ready to deploy. Readiness requires the recorded IT checks.</p>
  {value&&<p>Inventory saved {new Date(value.authority.receivedAt).toLocaleString('en-US',{timeZone:'America/Chicago'})} CT{value.authority.stale?' · Update delayed; showing saved inventory':''}.</p>}
  {error&&<p role='alert'>{error}{value?' Showing the last successful inventory.':''}</p>}
  <label>Find shop equipment<input aria-label='Search units on hand' value={query} onChange={e=>{setQuery(e.target.value);setLimit(40);}} placeholder='Unit, Product ID, family or status…'/></label>
  <div className='cos-shop-products'>{shown.slice(0,limit).map(r=>{
   const matches=value?.roster?.items.filter(i=>i.kind==='unit'&&i.placement==='shop'&&i.productIds.includes(r.productId))||[];
   const linked=matches.length===1&&matches[0].productIds.length===1&&r.binding?.state==='linked'&&r.binding?.unitIds?.includes(matches[0].unitId)?matches[0]:null;
   return <article key={r.productId}><div><strong>{r.unitNumber||'Product '+r.productId}</strong><small>Product {r.productId} · {r.category||'Equipment'} · Shop / ROOT</small><small>{r.uploadLifecycle==='UNFLAGGED'?'Readiness not established by placement':r.uploadLifecycle==='MISSING'?'Marked missing':'Do not use'}</small></div>{linked?.unitId&&openUnit?<button onClick={()=>openUnit(linked.unitId!)}>Open unit card</button>:<small>Device link needs review</small>}</article>;
  })}</div>
  {value&&!shown.length&&<p>No shop equipment matches this search.</p>}
  {shown.length>limit&&<button onClick={()=>setLimit(n=>n+40)}>Show more shop equipment ({shown.length-limit})</button>}
  <details className='cos-workspace-settings' onToggle={e=>setRegistry(e.currentTarget.open)}><summary>IT readiness and older tracker records</summary><p>Registry and tracker records are a separate subset. They do not replace the reviewed Shop / ROOT inventory above.</p>{registry&&<RegistryReadiness api={api} navigate={navigate}/>}</details>
 </section>;
}

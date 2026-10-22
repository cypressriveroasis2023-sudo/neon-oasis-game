import {useCallback,useEffect,useRef,useState} from 'react';
import {readOwnerCustody,type OwnerCustody} from './ownerCustody';
import {openLegacy} from './api';
export function useOwnerCustody(){
 const [data,setData]=useState<OwnerCustody|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),generation=useRef(0);
 const refresh=useCallback(async()=>{const turn=++generation.current;setLoading(true);try{const value=await readOwnerCustody();if(turn===generation.current){setData(value);setError('');}}catch(cause){if(turn===generation.current){setData(null);setError(cause instanceof Error?cause.message:'Custody unavailable.');}}finally{if(turn===generation.current)setLoading(false);}},[]);
 useEffect(()=>{void refresh();const invalidate=()=>{generation.current++;setData(null);setError('Session changed. Reopen custody from the signed-in Owner page.');};window.addEventListener('cos-private-data-invalidated',invalidate);return()=>{generation.current++;window.removeEventListener('cos-private-data-invalidated',invalidate);};},[refresh]);
 return {data,error,loading,refresh};
}
export default function CustodyOverview(){
 const {data,error,loading,refresh}=useOwnerCustody();const [search,setSearch]=useState('');
 const pending=data?.sources.handoffs.value?.items.filter(row=>['awaiting_service','discrepancy'].includes(row.state));
 return <section className='cos-custody-overview' aria-label='Equipment custody and pending receipts'>
  <header><h2>Equipment custody & receipts</h2><button disabled={loading} onClick={()=>void refresh()}>{loading?'Reading saved custody…':'Refresh custody'}</button></header>
  <p>Placement and custody overlap. Do not add these counts to Field or Shop totals. Shop placement does not establish IT custody or readiness.</p>
  {error&&<p role='alert'>{error}</p>}
  {data&&<><p>Read {new Date(data.readAt).toLocaleString()} · Saved records, not a physical stock count.</p>
   {Object.entries(data.sources).map(([source,value])=>value.error&&<p key={source} role='alert'>{value.error}</p>)}
   <p>Awaiting receipt / review in the loaded handoffs: <b>{pending?.length??'Unavailable'}</b>{data.sources.handoffs.value?.limited?' · Feed limit reached; this is not the complete queue.':''}. Waiting for IT return intake: <b>{data.sources.returns.value?.pending??'Unavailable'}</b>.</p>
   <p>Authoritative equipment held by IT / Service: unavailable as a reconciled Product-ID total. Signed handoffs and permanent truck stock are separate sources; accepted handoffs alone do not establish current custody.</p>
   <label>Find technician or equipment <input value={search} onChange={event=>setSearch(event.target.value)} placeholder='Technician, exact unit number or SIM'/></label>
   <div className='records'>{data.sources.trucks.value?.filter(truck=>JSON.stringify(truck).toLowerCase().includes(search.trim().toLowerCase())).map(truck=><article className='record' key={truck.id}><div><h3>{truck.name||'Unnamed technician'}</h3><p>Saved truck inventory · identity {truck.id||'unavailable'}</p>
    <ul>{truck.units.map((unit,index)=><li key={index}>{unit.family} {unit.tag||'Unit identity missing'} · {unit.state||'State unavailable'}{unit.key?' · '+unit.key:''}</li>)}</ul>
    <p>SIM cards: {truck.sims.map(sim=>(sim.number||'Missing number')+' ('+(sim.state||'state unavailable')+')').join(' · ')||'No SIM rows in this saved record'}</p>
    <p>Battery stock: {Object.entries(truck.stock).map(([key,value])=>key.replaceAll('_qty','').replaceAll('_',' ')+' '+(value??'Unavailable')).join(' · ')}</p>
    <p>Pending receipts: {pending?.filter(row=>row.receiverId===truck.id).map(row=>row.units.map(unit=>unit.family+' '+unit.tag).join(', ')).join(' · ')|| (pending?'None in loaded handoffs':'Unavailable')}</p>
    <p>Returns awaiting IT: {data.sources.returns.value?.items.filter(row=>row.receiverId===truck.id&&row.state==='waiting_it').map(row=>row.unit.family+' '+row.unit.tag).join(' · ')||(data.sources.returns.value?'None in saved queue':'Unavailable')}</p>
   </div></article>)}</div>
  </>}
  <button onClick={()=>openLegacy('handoffs')}>Open signed handoffs and return controls</button>
 </section>;
}

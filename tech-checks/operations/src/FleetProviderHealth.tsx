import {useMemo,useState} from 'react';
import {mhelpProviderFleet,providerTitles,type ProviderProduct,type ProviderSummary,type ProviderHealthStatus} from './mhelpProviderFleet';
import type {FieldProduct} from './mhelpFieldHealth';
import './fleetProviderHealth.css';

type Props={
 uploadInventory:unknown;
 fieldHealth:{total:number;items:FieldProduct[]}|null;
 healthReadSucceeded:boolean;
 now:number;
 onOpen:(product:ProviderProduct)=>void;
};
type StatusFilter='all'|ProviderHealthStatus;
const statusText:Record<ProviderHealthStatus,string>={
 online:'Online',offline:'Offline',unverified:'Unverified',not_applicable:'No camera'
};

function ProviderSection({group,onOpen}:{group:ProviderSummary;onOpen:(product:ProviderProduct)=>void}){
 const [filter,setFilter]=useState<StatusFilter>('all');
 const [search,setSearch]=useState('');
 const [limit,setLimit]=useState(8);
 const isSupport=group.provider==='support';
 const rows=group.items.filter(item=>(filter==='all'||item.healthStatus===filter)
  &&(item.unitNumber+' '+item.productId+' '+item.customer).toLowerCase().includes(search.trim().toLowerCase()));
 const title=providerTitles[group.provider];
 return <article className='cos-provider-panel' aria-label={title+' Field equipment'}>
  <header className='cos-provider-panel-head'>
   <div><h3>{title}</h3><p>{group.count} Field equipment records</p></div>
   <strong className='cos-provider-total'>{group.count}</strong>
  </header>
  {isSupport?<p className='cos-provider-note'>Support equipment is not a camera outage. Track its power separately.</p>:
   <div className='cos-provider-statuses' aria-label={title+' connection status summary'}>
    {(['online','offline','unverified'] as const).map(state=>
     <button key={state} type='button' className={'cos-provider-status cos-provider-status-'+state}
       aria-pressed={filter===state}
       onClick={()=>{setFilter(previous=>previous===state?'all':state);setLimit(8);}}>
      <b>{group.counts[state]}</b><span>{statusText[state]}</span>
     </button>)}
   </div>}
  <div className='cos-provider-controls'>
   <label>{title} status
    <select aria-label={title+' status filter'} value={filter} onChange={event=>{setFilter(event.target.value as StatusFilter);setLimit(8);}}>
     <option value='all'>All ({group.count})</option>
     {!isSupport&&<><option value='online'>Online ({group.counts.online})</option><option value='offline'>Offline ({group.counts.offline})</option><option value='unverified'>Unverified ({group.counts.unverified})</option></>}
     {isSupport&&<option value='not_applicable'>No camera ({group.counts.not_applicable})</option>}
    </select>
   </label>
   <label>Find equipment
    <input aria-label={'Search '+title+' equipment'} value={search} placeholder='Unit or Product ID'
     onChange={event=>{setSearch(event.target.value);setLimit(8);}}/>
   </label>
  </div>
  <p className='cos-provider-results'>{rows.length} {title} equipment record{rows.length===1?'':'s'} match.</p>
  <ul className='cos-provider-list'>
   {rows.slice(0,limit).map(item=><li key={item.productId}>
    <div className='cos-provider-unit-line'>
     <div><strong>{item.unitNumber}</strong><span>Product {item.productId}</span></div>
     <span className={'cos-provider-pill cos-provider-pill-'+item.healthStatus}>{statusText[item.healthStatus]}</span>
    </div>
    {item.customer&&<small>{item.customer}</small>}
    {(filter!=='all'||item.healthStatus==='offline')&&<p className='cos-provider-reason'>{item.reason}</p>}
    <button type='button' className='cos-provider-open' onClick={()=>onOpen(item)}>Review unit →</button>
   </li>)}
  </ul>
  {!rows.length&&<p className='cos-provider-empty'>{filter==='offline'?'No confirmed offline equipment is recorded in this category. This does not establish that every unit is healthy.':'No equipment matches this filter.'}</p>}
  {rows.length>limit&&<button className='cos-provider-more' onClick={()=>setLimit(current=>current+40)}>Show {Math.min(40,rows.length-limit)} more · {rows.length-limit} remaining</button>}
 </article>;
}

/** Distinct Field equipment families, with independent Offline filters.
 * The complete Product-ID census is retained even when Camera Health fails. */
export default function FleetProviderHealth({uploadInventory,fieldHealth,healthReadSucceeded,now,onOpen}:Props){
 const data=useMemo(()=>mhelpProviderFleet(uploadInventory,fieldHealth,healthReadSucceeded,now),
  [uploadInventory,fieldHealth,healthReadSucceeded,now]);
 if(!data)return null;
 const starred=data.groups.filter(group=>['star4live','avigilon'].includes(group.provider));
 const others=data.groups.filter(group=>!['star4live','avigilon'].includes(group.provider)&&group.count>0);
 return <section className='cos-fleet-provider-health' aria-label='Field equipment by provider'>
  <div className='cos-provider-title'>
   <h2>Camera systems — separate status lists</h2>
   <p><strong>{data.total} Field Product IDs</strong> from mHelpDesk. Camera health is a separate reading; a missing check is not an outage.</p>
  </div>
  {!data.healthVerified&&<p className='cos-provider-warning' role='status'>Current camera-health evidence is unavailable or incomplete. All camera-capable equipment remains Unverified until a valid health read succeeds. The Field inventory is retained.</p>}
  {data.stale&&<p className='cos-provider-warning' role='status'>mHelpDesk inventory updates are delayed. These are the last validated equipment assignments, not a fresh vendor read.</p>}
  <div className='cos-provider-grid'>
   {starred.map(group=><ProviderSection key={group.provider} group={group} onOpen={onOpen}/>)}
  </div>
  {others.length>0&&<details className='cos-provider-other'>
   <summary>Other Field equipment · {others.reduce((n,group)=>n+group.count,0)} records (Recon II, Wall-E and support)</summary>
   <div className='cos-provider-grid'>
    {others.map(group=><ProviderSection key={group.provider} group={group} onOpen={onOpen}/>)}
   </div>
  </details>}
  <p className='cos-provider-legend'>Each record appears once by its exact mHelpDesk Product ID. Star4Live / Avigilon names are equipment-family assignments, not proof of an active provider connection. Online can mean a confirmed recorder or IP/port observation; camera video must be checked separately.</p>
 </section>;
}

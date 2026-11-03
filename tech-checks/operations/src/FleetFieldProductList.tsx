import {useState} from 'react';
import type {FleetDashboardRow} from './fleetDashboardModel';
import VrmEnergyFlow from './VrmEnergyFlow';
import FleetVictronSummary from './FleetVictronSummary';
import type {FleetCommandProduct} from './fleetCommandCenterModel';
type Props={rows?:FleetDashboardRow[];now?:number;products:FleetCommandProduct[];status:string;query:string;onOpen:(product:FleetCommandProduct)=>void};
/** Compact Product-ID inventory. It consumes the reconciled status; it never tests or guesses health. */
export default function FleetFieldProductList({products,status,query,onOpen,rows=[],now=Date.now()}:Props){
 const [limit,setLimit]=useState(40),term=query.trim().toLowerCase();
 const entries=products.filter(p=>(!term||[p.unitNumber,p.productId,p.customer,p.address].join(' ').toLowerCase().includes(term))&&(status==='all'||status==='operational'&&p.status!=='unverified'||p.status===(status==='unknown'?'unverified':status==='support'?'not_applicable':status)));
 return <div className='cos-field-product-cards' aria-label='Field equipment cards'><p className='cos-field-product-count'>{entries.length} Field equipment records</p>{entries.slice(0,limit).map(p=><article key={p.productId} data-product-id={p.productId}>
  <button onClick={()=>onOpen(p)} aria-label={'Open '+p.unitNumber+' Product '+p.productId}><div><strong>{p.unitNumber}</strong><span className={'cos-product-status cos-product-status-'+p.status}><i aria-hidden='true'/>{p.status==='online'?'Online':p.status==='offline'?'Offline':p.status==='not_applicable'?'No cameras':'Unverified'}</span></div><small>{p.customer||'Customer not supplied'}</small><p>{p.address||'Service address not supplied'}</p><small>MHelp customer address · Product {p.productId}</small></button>
  <details><summary>Status evidence</summary><p>{p.reason}</p></details>
  {(()=>{const linked=rows.filter(row=>row.id===p.linked?.unitId);const row=linked.length===1&&linked[0].family.toUpperCase().startsWith('HELIOS')?linked[0]:null;return row?<div className='cos-field-helios-energy'><VrmEnergyFlow row={row.power||undefined} now={now} paused={Boolean(row.batteryReadIssue)}/><details><summary>Victron dashboard & all readings</summary><FleetVictronSummary row={row} now={now}/></details></div>:null;})()}
 </article>)}{!entries.length&&<p>No Field equipment matches these filters.</p>}{entries.length>limit&&<button onClick={()=>setLimit(n=>n+40)}>Show more equipment ({entries.length-limit})</button>}</div>;
}

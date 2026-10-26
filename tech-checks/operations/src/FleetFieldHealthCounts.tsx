import {useState} from 'react';
import {fieldHealthLabels,type FieldProduct,type mhelpFieldHealth} from './mhelpFieldHealth';
import FieldProductEvidence from './FieldProductEvidence';
import {fieldProductEvidenceCsv} from './fieldProductEvidence';

type Props={value:NonNullable<ReturnType<typeof mhelpFieldHealth>>;onOpen:(item:FieldProduct)=>void;expanded?:boolean;sourceRecords?:Record<string,any>[]};
export default function FleetFieldHealthCounts({value,onOpen,expanded=false,sourceRecords=[]}:Props){
 const [filter,setFilter]=useState('all'),[query,setQuery]=useState(''),[limit,setLimit]=useState(40);
 const sourceById=new Map(sourceRecords.map(r=>[r.productId,r]));
 const entries=Object.entries(value.counts) as [keyof typeof fieldHealthLabels,number][];
 const items=value.items.filter(item=>(filter==='all'||item.state===filter)&&[item.productId,item.unitNumber].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
 const exportEvidence=()=>{const url=URL.createObjectURL(new Blob([fieldProductEvidenceCsv(value.items,value.sourceSha256,value.receivedAt)],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='cos-field-product-health-evidence.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),0);};
 return <section className='cos-fleet-count-note' aria-label='Field inventory health breakdown'>
  <h2>All {value.total} Field equipment records accounted for</h2>
  <p>Field placement comes from accepted inventory and tracker records, independently of connectivity. Online, offline, unlinked and unverified equipment stays in this Field list. Existing review and lifecycle holds remain in place.</p>
  <button type='button' onClick={exportEvidence}>Export every Field Product ID and health evidence</button>
  <p>{entries.filter(([,count])=>count>0).map(([state,count])=>count+' '+fieldHealthLabels[state].toLowerCase()).join(' + ')} = <strong>{value.total} Field records</strong>.</p>
  <p>These counts use each mHelpDesk Product ID once. The linked-unit health tiles above cover camera-capable COS units; solar support, unlinked products, protected reviews and inactive inventory have separate categories. Online includes recorder or IP / port evidence and does not verify camera video.</p>
  <details open={expanded||undefined}><summary>Review every Field product and its status</summary>
   <label>Field record status <select aria-label='Field inventory status' value={filter} onChange={event=>{setFilter(event.target.value);setLimit(40);}}><option value='all'>All Field products ({value.total})</option>{entries.map(([state,count])=><option key={state} value={state}>{fieldHealthLabels[state]} ({count})</option>)}</select></label>
   <label>Find a Field product <input aria-label='Search Field inventory' value={query} placeholder='Unit number or Product ID' onChange={event=>{setQuery(event.target.value);setLimit(40);}}/></label>
   <p>{items.length} Field product records in this list.</p>
   <ul>{items.slice(0,limit).map(item=><li key={item.productId}><strong>{item.unitNumber}</strong> · Product {item.productId} · <b>FIELD</b> · <b>{fieldHealthLabels[item.state]}</b><p>{item.reason}</p>{sourceById.has(item.productId)&&<p>mHelp customer / site: {sourceById.get(item.productId)?.customer||'Not supplied'} · Source service address: {['street','city','state','zip'].map(k=>sourceById.get(item.productId)?.sourceAddress?.[k]).filter(v=>typeof v==='string'&&v.trim()).join(', ')||'Not supplied'}</p>}<FieldProductEvidence value={item.evidence} now={Date.now()}/>{(item.unitId||item.recordId)&&<button onClick={()=>onOpen(item)}>{item.unitId?'Unit details and troubleshooting':'Review source record'}</button>}</li>)}</ul>
   {items.length>limit&&<button onClick={()=>setLimit(previous=>previous+40)}>Show more Field products ({items.length-limit})</button>}
  </details>
 </section>;
}

import {useState} from 'react';
import {fieldHealthLabels,type FieldProduct,type mhelpFieldHealth} from './mhelpFieldHealth';

type Props={value:NonNullable<ReturnType<typeof mhelpFieldHealth>>;onOpen:(item:FieldProduct)=>void};
export default function FleetFieldHealthCounts({value,onOpen}:Props){
 const [filter,setFilter]=useState('all'),[query,setQuery]=useState(''),[limit,setLimit]=useState(40);
 const entries=Object.entries(value.counts) as [keyof typeof fieldHealthLabels,number][];
 const items=value.items.filter(item=>(filter==='all'||item.state===filter)&&[item.productId,item.unitNumber].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
 return <section className='cos-fleet-count-note' aria-label='Field inventory health breakdown'>
  <h2>All {value.total} Field equipment records accounted for</h2>
  <p>{entries.filter(([,count])=>count>0).map(([state,count])=>count+' '+fieldHealthLabels[state].toLowerCase()).join(' + ')} = <strong>{value.total} Field records</strong>.</p>
  <p>These counts use each mHelpDesk Product ID once. The linked-unit health tiles above cover camera-capable COS units; solar support, unlinked products, protected reviews and inactive inventory have separate categories. Online includes recorder or IP / port evidence and does not verify camera video.</p>
  <details><summary>Review every Field product and its status</summary>
   <label>Field record status <select aria-label='Field inventory status' value={filter} onChange={event=>{setFilter(event.target.value);setLimit(40);}}><option value='all'>All Field products ({value.total})</option>{entries.map(([state,count])=><option key={state} value={state}>{fieldHealthLabels[state]} ({count})</option>)}</select></label>
   <label>Find a Field product <input aria-label='Search Field inventory' value={query} placeholder='Unit number or Product ID' onChange={event=>{setQuery(event.target.value);setLimit(40);}}/></label>
   <p>{items.length} Field product records in this list.</p>
   <ul>{items.slice(0,limit).map(item=><li key={item.productId}><strong>{item.unitNumber}</strong> · Product {item.productId} · <b>{fieldHealthLabels[item.state]}</b><p>{item.reason}</p>{(item.unitId||item.recordId)&&<button onClick={()=>onOpen(item)}>{item.unitId?'Unit details and troubleshooting':'Review source record'}</button>}</li>)}</ul>
   {items.length>limit&&<button onClick={()=>setLimit(previous=>previous+40)}>Show more Field products ({items.length-limit})</button>}
  </details>
 </section>;
}

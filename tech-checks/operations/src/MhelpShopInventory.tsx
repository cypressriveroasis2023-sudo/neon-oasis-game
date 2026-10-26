import {useState} from 'react';
import {readMhelpInventoryAuthority} from './mhelpInventoryAuthority';

/** Accepted Product IDs remain visible even without a COS/device association. */
export default function MhelpShopInventory({value,now}:{value:unknown;now:number}){
 const [query,setQuery]=useState(''),[limit,setLimit]=useState(40);
 const authority=readMhelpInventoryAuthority(value,now);if(!authority)return null;
 const source=(value as {records:Record<string,any>[]}).records.filter(r=>r.placement==='SHOP');
 const rows=source.filter(r=>[r.productId,r.unitNumber,r.customer].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
 return <section className='cos-fleet-count-note' aria-label='Shop Product-ID inventory'>
  <h2>All {authority.shop} Shop / ROOT equipment records accounted for</h2>
  <p>Accepted mHelp placement is independent of camera identity, connectivity and GPS. Shop equipment is excluded from customer Field outages. Existing holds remain in place.</p>
  <label>Find Shop equipment <input aria-label='Search Shop inventory' value={query} onChange={e=>{setQuery(e.target.value);setLimit(40);}}/></label>
  <p>{rows.length} matching Shop Product IDs.</p>
  <ul>{rows.slice(0,limit).map(r=><li key={r.productId}><strong>{r.unitNumber||'Product '+r.productId}</strong> · Product {r.productId} · <b>SHOP / ROOT</b><p>mHelp customer / site: {r.customer||'Not supplied'}</p>{r.uploadLifecycle!=='UNFLAGGED'&&<p>Source lifecycle: {r.uploadLifecycle}</p>}{(r.binding?.state==='held'||r.binding?.placementHeld===true)&&<p>Saved association or placement review hold remains; Shop census membership is unchanged.</p>}</li>)}</ul>
  {rows.length>limit&&<button onClick={()=>setLimit(n=>n+40)}>Show more Shop products ({rows.length-limit})</button>}
 </section>;
}

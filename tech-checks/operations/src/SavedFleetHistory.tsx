import {useEffect,useState} from 'react';
import {api,savedFleetStatus} from './api';
import {cameraTime} from './fieldCameraHealth';
const historyTime=(value:any)=>cameraTime(value,Math.max(Date.now(),Date.parse(value)||0));
export default function SavedFleetHistory(){
 const [value,setValue]=useState(savedFleetStatus),[selected,setSelected]=useState<any>(null);
 useEffect(()=>{const update=()=>setValue(savedFleetStatus());const clear=()=>{setValue(null);setSelected(null);};window.addEventListener('cos-durable-fleet-status',update);window.addEventListener('cos-private-data-invalidated',clear);return()=>{window.removeEventListener('cos-durable-fleet-status',update);window.removeEventListener('cos-private-data-invalidated',clear);};},[]);
 if(!value)return null;
 const state=value.refresh?.state;
 return <section aria-label='Saved fleet updates' className='cos-fleet-message'>
 <p role='status'>{['running','queued'].includes(state)?'Updating in the background.':state==='failed'?'Latest update incomplete.':'Saved update history.'} {value.latest&&<>Last historical completed board: {historyTime(value.latest.payload?.fleet?.readAt)}.</>}</p>
 {state==='failed'&&<p>Historical counts remain available below for reference, but they are not current Fleet totals.{value.refresh?.products?.length?` ${value.refresh.products.length} products need current verification.`:''}</p>}
 <details><summary>Update history</summary><div style={{overflowX:'auto'}}><table><thead><tr><th>Time</th><th>Result</th><th>Online</th><th>Offline</th><th>Unverified</th><th>Unit log</th></tr></thead><tbody>{(value.history||[]).map((run:any)=><tr key={run.id}><td>{historyTime(run.finished_at||run.started_at)}</td><td>{run.state}</td><td>{run.counts?.online??'—'}</td><td>{run.counts?.offline??'—'}</td><td>{run.counts?.unverified??'—'}</td><td>{run.state==='completed'&&<button onClick={()=>{void api.get('/api/fleet-saved-board/history/'+run.id).then(({data})=>setSelected(data)).catch(()=>setSelected(null));}}>View units</button>}</td></tr>)}</tbody></table></div>{selected&&<section aria-label='Saved unit statuses'><h3>Unit log · {historyTime(selected.completedAt)}</h3><button onClick={()=>setSelected(null)}>Close unit log</button><ul>{(selected.units||[]).map((unit:any)=><li key={unit.productId}>{unit.unitNumber} · Product {unit.productId}: <b>{unit.status}</b> · checked {historyTime(unit.checkedAt)}</li>)}</ul></section>}</details>
 </section>;
}

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
 <p role='status'>{state==='running'?'Updating in the background.':state==='failed'?'Update incomplete. The last completed board remains displayed.':'Saved completed board.'} {value.latest&&<>Last completed: {historyTime(value.latest.payload?.fleet?.readAt)}. Closing the app keeps this record.</>}</p>
 {state==='failed'&&<p>Some checks could not be completed. They have not replaced the saved counts.{value.refresh?.products?.length?` ${value.refresh.products.length} previously confirmed units need a completed check.`:''}</p>}
 <details><summary>Update history</summary><div style={{overflowX:'auto'}}><table><thead><tr><th>Time</th><th>Result</th><th>Online</th><th>Offline</th><th>Unverified</th><th>Unit log</th></tr></thead><tbody>{(value.history||[]).map((run:any)=><tr key={run.id}><td>{historyTime(run.finished_at||run.started_at)}</td><td>{run.state}</td><td>{run.counts?.online??'—'}</td><td>{run.counts?.offline??'—'}</td><td>{run.counts?.unverified??'—'}</td><td>{run.state==='completed'&&<button onClick={()=>{void api.get('/api/fleet-saved-board/history/'+run.id).then(({data})=>setSelected(data)).catch(()=>setSelected(null));}}>View units</button>}</td></tr>)}</tbody></table></div>{selected&&<section aria-label='Saved unit statuses'><h3>Unit log · {historyTime(selected.completedAt)}</h3><button onClick={()=>setSelected(null)}>Close unit log</button><ul>{(selected.units||[]).map((unit:any)=><li key={unit.productId}>{unit.unitNumber} · Product {unit.productId}: <b>{unit.status}</b> · checked {historyTime(unit.checkedAt)}</li>)}</ul></section>}</details>
 </section>;
}

import {api} from './api';
import {useFleetInventory} from './useFleetInventory';
import './dailyWorkspace.css';
export default function FleetInventoryOverview({navigate}:{navigate:(workspace:string)=>void}){
 const {value,error,loading,refresh}=useFleetInventory(api),a=value?.authority;
 return <section className='cos-inventory-overview' aria-label='Shared equipment inventory'>
  <header><div><h2>Equipment inventory</h2><p>Same reviewed inventory as Fleet · each Product ID counted once</p></div><button disabled={loading} onClick={()=>void refresh(true)}>{loading?'Reading inventory…':'Refresh inventory'}</button></header>
  <div className='cos-inventory-totals'>{[['Field equipment',a?.field,'Fleet Dashboard'],['Shop / ROOT',a?.shop,'Units On Hand'],['Total inventory',a?.total,'Fleet Dashboard']].map(([label,count,workspace])=><button key={label} onClick={()=>navigate(String(workspace))}><strong>{count??'—'}</strong><span>{label}</span></button>)}</div>
  {a&&<p>Inventory saved {new Date(a.receivedAt).toLocaleString('en-US',{timeZone:'America/Chicago'})} CT{a.stale?' · Update delayed; showing saved inventory':''}. Placement does not establish camera health or deployment readiness.</p>}
  {error&&<p role='alert'>{error}{value?' Showing the last successful inventory.':''}</p>}
 </section>;
}

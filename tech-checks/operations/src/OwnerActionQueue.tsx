import {useMemo,useState} from 'react';
import {buildOwnerActionQueue,type OwnerQueueArea} from './ownerActionQueueData';
import type {DashboardData} from './todayDashboardData';
import './ownerActionQueue.css';
const labels:Record<OwnerQueueArea,string>={approval:'My approvals',it:'IT',service:'Service',customers:'Customers',overdue:'Overdue',paperwork:'Paperwork'};
const tabs:OwnerQueueArea[]=['approval','it','service','customers','overdue','paperwork'];
type Props={ownerAuthorized:boolean;data:DashboardData;openWorkspace:(workspace:string)=>void;
 openJob?:(id:string,workspace?:'Jobs'|'Unscheduled'|'Owner Review'|'Dispatch')=>void};
/** Read-only projection of existing Owner-authorized sources. Never writes inventory or task status. */
export default function OwnerActionQueue({ownerAuthorized,data,openWorkspace,openJob}:Props){
 const[category,setCategory]=useState<OwnerQueueArea>('approval');
 const queue=useMemo(()=>buildOwnerActionQueue(data),[data]);
 // Keep this defense-in-depth check even if a parent calls the panel incorrectly.
 if(!ownerAuthorized||data.tasks===null&&/Owner access|sign-in/i.test(data.errors.tasks||''))return null;
 const selected=queue.items.filter(item=>item.areas.includes(category)),count=queue.counts[category];
 const open=(item:typeof queue.items[number])=>{
  if(item.jobId&&openJob&&(item.route==='Jobs'||item.route==='Owner Review'))openJob(item.jobId,item.route);
  else openWorkspace(item.route);
 };
 return <section className="cos-owner-queue" aria-label="Owner Action Queue">
  <div className="cos-owner-queue-head"><div><p className="cos-owner-queue-eyebrow">VISION · Owner Operations</p>
   <h2>What needs attention</h2><p>Saved approvals, assigned work, explicit review flags and incomplete records. Unknown sources are never counted as zero.</p></div>
   <button className="cos-owner-queue-open" type="button" onClick={()=>openWorkspace('Daily Board')}>Open Daily Board</button></div>
  {queue.sourceUnavailable.length>0&&<p className="cos-owner-queue-warning" role="status">Some action sources are unverified ({queue.sourceUnavailable.join(', ')}). These counts are known minimums, not the company total.</p>}
  {queue.rejectedIdentityCount>0&&<p className="cos-owner-queue-warning" role="status">{queue.rejectedIdentityCount} source record(s) lack a stable identifier and require review before linking an action.</p>}
  <div className="cos-owner-queue-tabs" aria-label="Action responsibility filters">
   {tabs.map(tab=><button type="button" key={tab} aria-pressed={category===tab} onClick={()=>setCategory(tab)}>
    <span>{labels[tab]}</span><strong>{queue.counts[tab].complete?queue.counts[tab].observed:'≥'+queue.counts[tab].observed}</strong>
   </button>)}
  </div>
  <div className="cos-owner-queue-results" aria-live="polite">
   <div className="cos-owner-queue-results-head"><h3>{labels[category]}</h3>
    <span>{count.complete?count.observed+' saved action(s)':count.observed+' identified; verification incomplete'}</span></div>
   {selected.length===0?<p className="cos-owner-queue-empty">{count.complete?'No saved item currently meets this filter. This is not a live camera or paperwork audit.':'No action verified in the available records. Other sources still need checking.'}</p>:
    <div className="cos-owner-queue-list">{selected.slice(0,12).map(item=><article className="cos-owner-queue-item" key={item.key}>
     <div className="cos-owner-queue-item-main"><div className="cos-owner-queue-item-line"><strong>{item.title}</strong>{item.urgency==='high'&&<span className="cos-owner-queue-high">High priority / overdue</span>}</div>
      <p>{item.detail}</p>
      <small>Responsible: {item.owner} · {item.site||'Site not linked'}{item.dueAt?' · Due: '+item.dueAt:''}</small>
      <small>Saved source: {item.source} · Record: {item.sourceId}</small>
      <div className="cos-owner-queue-evidence">{item.evidenceUrl&&<a href={item.evidenceUrl} target="_blank" rel="noopener noreferrer">Open evidence</a>}
       {item.photoUrl&&<a href={item.photoUrl} target="_blank" rel="noopener noreferrer">View photo</a>}
       {!item.evidenceUrl&&!item.photoUrl&&<span>External evidence link not provided</span>}</div>
     </div><button type="button" className="cos-owner-queue-open" onClick={()=>open(item)}>Open in COS</button>
    </article>)}{selected.length>12&&<p className="cos-owner-queue-more">Showing the first 12 recorded actions. Open the relevant COS workspace for additional records.</p>}</div>}
  </div>
 </section>;
}

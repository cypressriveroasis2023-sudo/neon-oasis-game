
import { useEffect, useRef, useState } from 'react';
import type { DashboardRow } from './todayDashboardData';
import { ownerJobSelection } from './ownerJobSelection';

type Props = {
  jobs: DashboardRow[] | null;
  openWorkspace: (name:string)=>void;
  openJob?: (id:string)=>void;
  openUnit?: (unit:number)=>void;
  selectedJobId?:string;
  detailOpen?:boolean;
  selectJob?:(id:string)=>void;
  backToJobs?:()=>void;
};
const value=(input:unknown,fallback:string)=>typeof input==='string'&&input.trim()?input:fallback;

/** Present existing records and delegate every operation to the established workflows. */
export default function WorkspaceOverview({jobs,openWorkspace,openJob,openUnit,selectedJobId='',detailOpen=false,selectJob,backToJobs}:Props){
  const [requested,setRequested]=useState('');
  const [search,setSearch]=useState('');
  const [unit,setUnit]=useState(1);
  const requestedId=selectJob?selectedJobId:requested;
  const {options,selected}=ownerJobSelection(jobs||[],requestedId);
  // A stale link must never switch the action target to another job.
  const job=requestedId?selected:options[0];
  const visible=options.filter(item=>[item.jobNumber,item.customer,item.site,item.jobType,item.technician,item.equipment,item.equipmentUnitTag,item.status].some(field=>String(field||'').toLowerCase().includes(search.trim().toLowerCase())));
  const buttons=useRef(new Map<string,HTMLButtonElement>());
  const heading=useRef<HTMLHeadingElement>(null);
  const previousDetail=useRef(false);
  useEffect(()=>{
    if(window.matchMedia('(max-width:700px)').matches){
      if(detailOpen)heading.current?.focus({preventScroll:true});
      else if(previousDetail.current&&requestedId){
        const button=buttons.current.get(requestedId);
        button?.focus({preventScroll:true});
        button?.scrollIntoView({block:'center'});
      }
    }
    previousDetail.current=detailOpen;
  },[detailOpen,requestedId,job?.id]);
  return <section className='workspace-overview' aria-label='Daily workspace' data-detail-open={detailOpen?'true':'false'}>
    <div className='workspace-work'>
      <header className='workspace-title'><p>OPERATIONS WORKSPACE</p><h1>Overview</h1></header>
      <nav className='workspace-tabs' aria-label='Daily workspace views'><button aria-current='page'>Work</button><button onClick={()=>openWorkspace('Calendar')}>Schedule</button><button onClick={()=>openWorkspace('Owner Review')}>Reviews</button></nav>
      <label className='workspace-search'>Find an active job<input type='search' value={search} onChange={event=>setSearch(event.target.value)} placeholder='Job, customer, site, unit or technician'/></label>
      <h2 className='workspace-list-title'>Operational Timeline</h2>
      <div className='workspace-job-list'>
        {jobs===null?<p role='status'>Jobs could not be loaded. Retry before relying on this view.</p>:options.length===0?<p>No active jobs in the loaded records.</p>:visible.length===0?<p role='status'>No active jobs match this search.</p>:visible.map(item=><button key={String(item.id)} ref={element=>{if(element)buttons.current.set(String(item.id),element);else buttons.current.delete(String(item.id));}} className={'workspace-job'+(item.id===job?.id?' selected':'')} aria-pressed={item.id===job?.id} onClick={()=>selectJob?selectJob(String(item.id)):setRequested(String(item.id))}>
          <span className='workspace-record-icon' aria-hidden='true'>▤</span><span><strong>{value(item.jobType,'Job')} · {value(item.jobNumber,'Number unavailable')}</strong><small>{value(item.customer,'Customer unavailable')} · {value(item.site,'Site unavailable')}</small><small>{value(item.status,'Status unavailable')}</small></span><span aria-hidden='true'>›</span>
        </button>)}
      </div>
      <div className='workspace-shortcuts'><h2>Quick access</h2><div><button onClick={()=>openWorkspace('Daily Board')}>Dispatch Board</button><button onClick={()=>openWorkspace('Tech Check')}>Tech Check ↗</button><button onClick={()=>openWorkspace('Owner Tasks')}>Owner tasks ↗</button><button onClick={()=>openWorkspace('Purchasing')}>Purchasing ↗</button></div></div>
    </div>
    <aside className='workspace-detail' aria-label='Selected job details'>
      <button type='button' className='workspace-back' onClick={backToJobs}>← Back to jobs</button>
      {job?<><p className='workspace-kicker'>SELECTED JOB</p><h2 ref={heading} tabIndex={-1}>{value(job.jobType,'Job details')}</h2><p>{value(job.jobNumber,'Number unavailable')} · {value(job.customer,'Customer unavailable')}</p><dl><div><dt>Site</dt><dd>{value(job.site,'Not supplied')}</dd></div><div><dt>Technician</dt><dd>{value(job.technician,'Unassigned')}</dd></div><div><dt>Schedule</dt><dd>{value(job.scheduled,'Not set')}</dd></div><div><dt>Equipment</dt><dd>{value(job.equipmentUnitTag,value(job.equipment,'Not assigned'))}</dd></div><div><dt>Status</dt><dd>{value(job.status,'Unavailable')}</dd></div></dl><button className='workspace-primary' onClick={()=>openJob?openJob(String(job.id)):openWorkspace('Jobs')}>{openJob?'Open job & actions':'Open Jobs'} →</button></>:<><h2 ref={heading} tabIndex={-1}>{jobs===null?'Job details unavailable':requestedId?'Selected job is unavailable':'Ready for the next job'}</h2><p>{jobs===null?'Refresh Overview to verify the current jobs.':requestedId?'This job is no longer in the loaded active records. Return to the list to choose a current job.':'Select a job when work is available.'}</p>{!detailOpen&&<button onClick={()=>openWorkspace('Jobs')}>Open Jobs ↗</button>}</>}
      <section className='workspace-helios' aria-label='Helios fleet shortcuts'><h3>Helios fleet</h3><div className='workspace-units'>{Array.from({length:9},(_,index)=><button key={index} aria-label={'Select Helios '+(index+1)} aria-pressed={unit===index+1} onClick={()=>setUnit(index+1)}>{index+1}</button>)}</div><p>Helios {unit} · Victron VRM</p><button onClick={()=>openUnit?openUnit(unit):openWorkspace('Victron VRM')}>Open monitoring ↗</button></section>
    </aside>
  </section>;
}

import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {cosPrompt,cosConfirm} from './cosDialog';
import {ownerJobSelection} from './ownerJobSelection';
import {checkedOwnerSnapshot,createOwnerActionSaver,truckApprovalDetails,type OwnerAction,type OwnerSnapshot} from './ownerActionPersistence';
const chicagoToday=()=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=(type:string)=>parts.find(p=>p.type===type)?.value||'';return get('year')+'-'+get('month')+'-'+get('day')};
export default function OwnerBoardControls({show}:{show:(m:string)=>void}) {
  const [jobs,setJobs]=useState<any[]>([]);
  const [control,setControl]=useState<any>({sites:[],truckChecks:[],serviceTechnicians:[],itTechnicians:[]});
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [refreshing,setRefreshing]=useState(false);
  const [needsRefresh,setNeedsRefresh]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [selectedJobId,setSelectedJobId]=useState('');
  const [assignTech,setAssignTech]=useState('');
  const [newJob,setNewJob]=useState<any>({siteId:'',jobType:'DELIVERY',title:'',description:'',priority:'normal',shopPrep:false});
  const [advance,setAdvance]=useState<any>({unitNumber:'',serviceTechnician:'',date:chicagoToday(),startTime:'08:00',endTime:'10:00',note:''});
  const loadRevision=useRef(0), activeReads=useRef(0), actionRunning=useRef(false), mounted=useRef(true);
  const snapshotRef=useRef<OwnerSnapshot>({jobs:[],control:{sites:[],truckChecks:[],serviceTechnicians:[],itTechnicians:[]}});
  const load=async()=>{
    const revision=++loadRevision.current;
    activeReads.current++;
    try {
    const [jobResponse,controlResponse]=await Promise.all([api.get('/api/jobs'),api.get('/api/owner/control-data')]);
    const snapshot=checkedOwnerSnapshot(jobResponse.data,controlResponse.data);
    if(revision!==loadRevision.current||!mounted.current)throw new Error('Owner controls changed while the result was loading. Refresh before another action.');
    snapshotRef.current=snapshot;
    setJobs(snapshot.jobs);setControl(snapshot.control);setLoaded(true);
    setSelectedJobId(current=>ownerJobSelection(snapshot.jobs,current).selectedId);
    return snapshot;
    } finally { activeReads.current--; }
  };
  const saver=useRef<ReturnType<typeof createOwnerActionSaver>|null>(null);
  if(!saver.current)saver.current=createOwnerActionSaver(api,load);
  const refresh=async(initial=false)=>{
    if(actionRunning.current||(!initial&&activeReads.current>0))return;
    const request=loadRevision.current+1;
    setRefreshing(true);
    try{const snapshot=await load();saver.current!.acknowledgeRefresh(snapshot);setNeedsRefresh(false);setError('');window.dispatchEvent(new Event('focus'));}
    catch(cause){if(mounted.current&&request===loadRevision.current)setError(cause instanceof Error?cause.message:'Owner controls could not be refreshed.');}
    finally{if(mounted.current&&request===loadRevision.current)setRefreshing(false);}
  };
  useEffect(()=>{
    mounted.current=true;
    void refresh(true);
    const updated=()=>{if(!actionRunning.current)void load().catch(()=>setError('Owner controls could not be refreshed.'));};
    window.addEventListener('cos-board-updated',updated);
    return()=>{mounted.current=false;loadRevision.current++;window.removeEventListener('cos-board-updated',updated);};
  },[]);
  const selection=ownerJobSelection(jobs,selectedJobId), selected=selection.selected;
  useEffect(()=>{setAssignTech('');setAdvance((current:any)=>({...current,unitNumber:'',note:''}));},[selection.selectedId]);
  const blocked=!!busy||refreshing||needsRefresh||!loaded;
  const run=async(key:string,prepare:()=>Promise<{action:OwnerAction;message:string}|null>)=>{
    if(actionRunning.current||saver.current!.needsRefresh||activeReads.current>0||!mounted.current)return;
    actionRunning.current=true;setBusy(key);setError('');
    try{
      const prepared=await prepare();
      if(!prepared||!mounted.current)return;
      const result=await saver.current!.save(prepared.action);
      if(!mounted.current)return;
      if(result.status==='confirmed'){
        if(prepared.action.kind==='create'){
          setSelectedJobId(result.response.job_id);
          setNewJob((current:any)=>({...current,title:'',description:''}));
        }
        show(prepared.action.kind==='create'?result.response.job_number+' created and found in current jobs.':prepared.message+' · saved and verified');
        window.dispatchEvent(new Event('focus'));
      }else if('message' in result){setError(result.message);setNeedsRefresh(true);}
    }catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:'Owner action could not be completed.');}
    finally{actionRunning.current=false;if(mounted.current)setBusy('');}
  };
  const lifecycle=(job:any,kind:'close'|'remove')=>run(kind,async()=>{
    if(kind==='close'){
      const reason=await cosPrompt('Close reason (optional)');
      if(reason===null||!await cosConfirm('Close '+job.jobNumber+'? History will be kept.'))return null;
      return {action:{kind,job,body:{reason}},message:job.jobNumber+' closed'};
    }
    const confirmation=await cosPrompt('Type DELETE '+job.jobNumber+' to permanently remove this job');
    if(confirmation===null)return null;
    if(confirmation.trim()!=='DELETE '+job.jobNumber)throw new Error('Type DELETE followed by the exact COS Job number.');
    if(!await cosConfirm('Permanently delete '+job.jobNumber+'? This cannot be undone. Jobs with protected billing or dependency history will be blocked.'))return null;
    return {action:{kind,job,body:{confirmation:confirmation.trim()}},message:job.jobNumber+' permanently deleted'};
  });
  useEffect(()=>{
    const jobAction=(event:Event)=>{
      const detail=(event as CustomEvent).detail;
      if(!detail||!['close','remove'].includes(detail.action))return;
      const job=ownerJobSelection(snapshotRef.current.jobs,detail.jobId).selected;
      if(job&&job.jobNumber===detail.jobNumber)void lifecycle(job,detail.action);
    };
    const boardAssign=(event:Event)=>{
      const detail=(event as CustomEvent).detail;
      const job=detail&&ownerJobSelection(snapshotRef.current.jobs,detail.jobId).selected;
      if(!job||!detail.technician)return;
      const roster=String(job.department).toLowerCase()==='it'?snapshotRef.current.control.itTechnicians:snapshotRef.current.control.serviceTechnicians;
      if(!roster.includes(detail.technician))return;
      void run('board-assign',async()=>({action:{kind:'assign',job,body:{technician:detail.technician}},message:job.jobNumber+' assigned to '+detail.technician}));
    };
    window.addEventListener('cos-owner-job-action',jobAction);window.addEventListener('cos-owner-assign',boardAssign);
    return()=>{window.removeEventListener('cos-owner-job-action',jobAction);window.removeEventListener('cos-owner-assign',boardAssign);};
  },[]);
  const createJob=()=>{
    if(!newJob.siteId||!newJob.title.trim()){setError('Choose a site and enter a job title');return;}
    const body={...newJob,title:newJob.title.trim()};
    void run('create',async()=>({action:{kind:'create',body,previousIds:snapshotRef.current.jobs.map(job=>job.id)},message:'COS Job created by Owner'}));
  };
  const assign=()=>{if(selected&&assignTech)void run('assign',async()=>({action:{kind:'assign',job:selected,body:{technician:assignTech}},message:selected.jobNumber+' assigned to '+assignTech}));};
  const close=()=>{if(selected)void lifecycle(selected,'close');};
  const remove=()=>{if(selected)void lifecycle(selected,'remove');};
  const advanceIt=()=>{
    if(!selected)return;
    const unit=String(advance.unitNumber||selected.equipmentUnitTag||'').trim();
    if(!unit){setError('Physical unit number is required before pushing IT work to Service');return;}
    if(!advance.serviceTechnician||!advance.date||!advance.startTime||!advance.endTime){setError('Service technician, date, start time and end time are required');return;}
    if(advance.endTime<=advance.startTime){setError('Service end time must be after the start time');return;}
    void run('advance',async()=>{
      if(!await cosConfirm('Owner verified IT prep for '+selected.jobNumber+' and schedule it to '+advance.serviceTechnician+' for Service?'))return null;
      return {action:{kind:'advance',job:selected,body:{note:advance.note,unitNumber:unit,serviceTechnician:advance.serviceTechnician,start:advance.date+' '+advance.startTime,end:advance.date+' '+advance.endTime}},message:selected.jobNumber+' advanced from IT and scheduled to '+advance.serviceTechnician};
    });
  };
  const approveTruck=(check:any)=>run('truck-'+check.id,async()=>{
    const note=await cosPrompt('Owner truck stock approval note (optional)');
    if(note===null||!await cosConfirm('Approve '+check.technician+' truck stock / check as Owner verified?'))return null;
    return {action:{kind:'truck',check,body:{note}},message:'Truck stock approved'};
  });
  useEffect(()=>{const roster=control.serviceTechnicians||[];setAdvance((current:any)=>current.serviceTechnician&&!roster.includes(current.serviceTechnician)?{...current,serviceTechnician:''}:current);},[control.serviceTechnicians]);
  const jobTechs=selected?.department?.toLowerCase()==='it'?(control.itTechnicians||[]):selected?.department?.toLowerCase()==='service'?(control.serviceTechnicians||[]):[...(control.itTechnicians||[]),...(control.serviceTechnicians||[])];
  return <section className='panel module owner-board-controls'>
    <div className='panelhead'><div><h2>Owner Controls</h2><span>Owner-only overrides are audit-marked in production.</span></div><button className='secondary' disabled={!!busy||refreshing} onClick={()=>void refresh()}>REFRESH</button></div>
    {error&&<div role='alert' className='operations-error'>{error}</div>}
    <div className='quote-detail-grid'>
      <label>Selected COS Job
        <select value={selection.selectedId} disabled={blocked} onChange={e => setSelectedJobId(e.target.value)}>
          <option value=''>{selection.options.length ? 'Choose a COS Job' : 'No active jobs available'}</option>
          {selection.options.map(job => <option key={job.id} value={job.id}>{job.jobNumber} · {job.customer} · {job.stage}</option>)}
        </select>
      </label>
      <label>Assign technician<select value={assignTech} disabled={!selected || blocked} onChange={e=>setAssignTech(e.target.value)}><option value=''>Choose technician</option>{jobTechs.map((t:string)=><option key={t}>{t}</option>)}</select></label>
    </div>
    {!selected && <p role='status'>Choose a COS Job before assigning, closing or deleting. The selected job number and details will appear here.</p>}
    {selected&&<div className='purchase-actions'>
      <span><b>{selected.jobNumber}</b> · {selected.customer} · {selected.site} · {selected.stage} · {selected.status}</span>
      <button disabled={blocked||!assignTech} onClick={assign}>ASSIGN</button>
      <button className='secondary' disabled={blocked} onClick={close}>CLOSE JOB</button>
      <button className='danger' disabled={blocked} onClick={remove}>DELETE JOB</button>
    </div>}
    {selected&&String(selected.stage||'').toLowerCase()==='it prep'&&<section className='quote-card'>
      <div className='quote-section-head'><div><h3>Owner Verified IT → Service</h3><small>Use this when you personally checked the unit/process. The normal IT Tech Check is cancelled as an Owner override, the IT visit is completed, and the Service handoff becomes authoritative.</small></div></div>
      <div className='quote-detail-grid'>
        <label>Physical unit number<input disabled={!!busy} value={advance.unitNumber||selected.equipmentUnitTag||''} onChange={e=>setAdvance({...advance,unitNumber:e.target.value})}/></label>
        <label>Service technician<select disabled={!!busy} value={advance.serviceTechnician} onChange={e=>setAdvance({...advance,serviceTechnician:e.target.value})}><option value="">Choose technician</option>{(control.serviceTechnicians||[]).map((t:string)=><option key={t}>{t}</option>)}</select></label>
        <label>Service date<input disabled={!!busy} type='date' required value={advance.date} onChange={e=>setAdvance({...advance,date:e.target.value})}/></label>
        <label>Start time<input disabled={!!busy} type='time' required value={advance.startTime} onChange={e=>setAdvance({...advance,startTime:e.target.value})}/></label>
        <label>End time<input disabled={!!busy} type='time' required value={advance.endTime} onChange={e=>setAdvance({...advance,endTime:e.target.value})}/></label>
        <label>Owner note<input disabled={!!busy} value={advance.note} onChange={e=>setAdvance({...advance,note:e.target.value})} placeholder='What you verified'/></label>
      </div>
      <button disabled={blocked} onClick={advanceIt}>{busy==='advance'?'ADVANCING…':'OWNER VERIFIED · SCHEDULE TO SERVICE'}</button>
    </section>}
    <section className='quote-card'>
      <div className='quote-section-head'><div><h3>Add COS Job</h3><small>Owner-created jobs bypass quote/MHelpDesk conversion but are explicitly audit-marked as Owner-created.</small></div></div>
      <div className='quote-detail-grid'>
        <label>Customer / Site<select disabled={!!busy} value={newJob.siteId} onChange={e=>setNewJob({...newJob,siteId:e.target.value})}><option value=''>Choose site</option>{(control.sites||[]).map((s:any)=><option key={s.id} value={s.id}>{s.customers?.name||'Customer'} · {s.name}</option>)}</select></label>
        <label>Job type<select disabled={!!busy} value={newJob.jobType} onChange={e=>setNewJob({...newJob,jobType:e.target.value})}>{['DELIVERY','SWAP','PICKUP','SERVICE'].map(x=><option key={x}>{x}</option>)}</select></label>
        <label>Title<input disabled={!!busy} value={newJob.title} onChange={e=>setNewJob({...newJob,title:e.target.value})}/></label>
        <label>Priority<select disabled={!!busy} value={newJob.priority} onChange={e=>setNewJob({...newJob,priority:e.target.value})}><option value='normal'>Normal</option><option value='high'>High</option><option value='urgent'>Urgent</option></select></label>
      </div>
      <label>Description / instructions<textarea disabled={!!busy} rows={3} value={newJob.description} onChange={e=>setNewJob({...newJob,description:e.target.value})}/></label>
      {newJob.jobType==='SERVICE'&&<label className='tc-primary'><input disabled={!!busy} type='checkbox' checked={newJob.shopPrep} onChange={e=>setNewJob({...newJob,shopPrep:e.target.checked})}/> SERVICE REQUIRES IT SHOP PREP</label>}
      <button disabled={blocked} onClick={createJob}>{busy==='create'?'CREATING…':'ADD COS JOB'}</button>
    </section>
    <section className='quote-card'>
      <div className='quote-section-head'><div><h3>Truck Stock / Check Approval</h3><small>Truck Check → Owner Approval / Override → Shortage → Purchasing → Receipt → AP. Approval never means inventory was received.</small></div></div>
      <div className='records'>{(control.truckChecks||[]).length?(control.truckChecks||[]).slice(0,8).map((c:any)=>{const {missing,override}=truckApprovalDetails(c);return <div className='record op-record' key={c.id}><div><strong>{c.technician||'Technician'} · {String(c.department||'').toUpperCase()}</strong><small>{c.vehicleRef||'Vehicle not named'} · {c.status} · {c.ownerApproved?'OWNER APPROVED':'Awaiting Owner approval'}</small>{c.ownerApproved&&override&&<span className='owner-techcheck'>OWNER OVERRIDE · {missing.length?missing.join(', ')+' missing':'Missing fields were override-approved'}</span>}{missing.length>0&&<div className='audit-mini'><b>SHORTAGE / IDENTIFIERS TO RESOLVE</b>{missing.map((item:string)=><small key={item}>{item}</small>)}<small>Approval does not mark these items received.</small></div>}</div><div className='row-actions'><em>{c.ownerApproved?(missing.length?'APPROVED · SHORT':'APPROVED'):'CHECK'}</em>{!c.ownerApproved&&<button disabled={blocked} onClick={()=>approveTruck(c)}>APPROVE / OVERRIDE</button>}</div></div>}):<div className='loading'>No truck checks recorded in the last 7 days.</div>}</div>
    </section>
  </section>;
}

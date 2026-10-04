import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {cosPrompt,cosConfirm} from './cosDialog';
import {ownerJobSelection} from './ownerJobSelection';
const chicagoToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export default function OwnerBoardControls({show}:{show:(m:string)=>void}) {
  const chicagoToday=()=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=(type:string)=>parts.find(p=>p.type===type)?.value||'';return get('year')+'-'+get('month')+'-'+get('day')};
  const [jobs,setJobs]=useState<any[]>([]);
  const [control,setControl]=useState<any>({sites:[],truckChecks:[],serviceTechnicians:[],itTechnicians:[]});
  const [busy,setBusy]=useState('');
  const [selectedJobId,setSelectedJobId]=useState('');
  const [assignTech,setAssignTech]=useState('');
  const [newJob,setNewJob]=useState<any>({siteId:'',jobType:'DELIVERY',title:'',description:'',priority:'normal',shopPrep:false});
  const [advance,setAdvance]=useState<any>({unitNumber:'',serviceTechnician:'',date:chicagoToday(),startTime:'08:00',endTime:'10:00',note:''});
  const loadRevision = useRef(0);
  const load = async () => {
    const revision = ++loadRevision.current;
    const [jobResponse, controlResponse] = await Promise.all([api.get('/api/jobs'), api.get('/api/owner/control-data')]);
    if (revision !== loadRevision.current) return;
    const nextJobs = jobResponse.data?.items;
    if (!Array.isArray(nextJobs) || !controlResponse.data || typeof controlResponse.data !== 'object') {
      throw new Error('Owner controls received an incomplete response.');
    }
    setJobs(nextJobs);
    setControl(controlResponse.data);
    setSelectedJobId(current => ownerJobSelection(nextJobs, current).selectedId);
  };
  useEffect(()=>{load().catch(()=>show('Owner controls could not be loaded'))},[]);
  useEffect(() => {
    const updated = () => { void load().catch(() => show('Owner controls could not be refreshed')); };
    window.addEventListener('cos-board-updated', updated);
    return () => window.removeEventListener('cos-board-updated', updated);
  }, []);
  const selection = ownerJobSelection(jobs, selectedJobId);
  const selected = selection.selected;
  useEffect(() => {
    setAssignTech('');
    setAdvance((current: any) => ({ ...current, unitNumber: '', note: '' }));
  }, [selection.selectedId]);
  const refresh=async()=>{await load();window.dispatchEvent(new Event('focus'))};
  useEffect(()=>{const handleBoardAssign=(event:Event)=>{const detail=(event as CustomEvent<{jobId:string;technician:string;jobNumber?:string}>).detail;if(!detail?.jobId||!detail.technician)return;setBusy('board-assign');api.post('/api/jobs/'+detail.jobId+'/assign',{technician:detail.technician}).then(async()=>{await load();window.dispatchEvent(new Event('focus'));show((detail.jobNumber||'COS Job')+' assigned to '+detail.technician)}).catch((e:any)=>show(e?.response?.data?.error||e?.message||'Job could not be assigned')).finally(()=>setBusy(''))};window.addEventListener('cos-owner-assign',handleBoardAssign);return()=>window.removeEventListener('cos-owner-assign',handleBoardAssign)},[]);
  useEffect(()=>{const handleJobAction=async(event:Event)=>{const detail=(event as CustomEvent<{jobId:string;jobNumber:string;action:'close'|'remove'}>).detail;if(!detail?.jobId||!detail.jobNumber)return;if(detail.action==='close'){const reason=await cosPrompt('Close reason (optional)');if(reason===null||!await cosConfirm('Close '+detail.jobNumber+'? History will be kept.'))return;setBusy('board-close');try{await api.post('/api/jobs/'+detail.jobId+'/close',{reason});await load();window.dispatchEvent(new Event('focus'));show(detail.jobNumber+' closed')}catch(e:any){show(e?.response?.data?.error||e?.message||'Job could not be closed')}finally{setBusy('')}}else{const confirmation=await cosPrompt('Type DELETE '+detail.jobNumber+' to permanently remove this job');if(confirmation===null||!await cosConfirm('Permanently delete '+detail.jobNumber+'? This cannot be undone. Protected billing/dependency jobs will be blocked.'))return;setBusy('board-remove');try{await api.post('/api/jobs/'+detail.jobId+'/remove',{confirmation:confirmation.trim()});await load();window.dispatchEvent(new Event('focus'));show(detail.jobNumber+' permanently deleted')}catch(e:any){show(e?.response?.data?.error||e?.message||'Job could not be deleted')}finally{setBusy('')}}};window.addEventListener('cos-owner-job-action',handleJobAction);return()=>window.removeEventListener('cos-owner-job-action',handleJobAction)},[]);
  const createJob=async()=>{if(!newJob.siteId||!newJob.title.trim()){show('Choose a site and enter a job title');return}setBusy('create');try{const r=await api.post('/api/owner/jobs/manual',newJob);await refresh();setSelectedJobId(r.data.job_id||'');setNewJob({...newJob,title:'',description:''});show((r.data.job_number||'COS Job')+' created by Owner')}catch(e:any){show(e?.response?.data?.error||e?.message||'Owner job could not be created')}finally{setBusy('')}};
  const assign=async()=>{if(!selected||!assignTech)return;setBusy('assign');try{await api.post('/api/jobs/'+selected.id+'/assign',{technician:assignTech});await refresh();show(selected.jobNumber+' assigned to '+assignTech)}catch(e:any){show(e?.response?.data?.error||e?.message||'Job could not be assigned')}finally{setBusy('')}};
  const close=async()=>{if(!selected)return;const reason=await cosPrompt('Close reason (optional)');if(reason===null)return;if(!await cosConfirm('Close '+selected.jobNumber+'? History will be kept.'))return;setBusy('close');try{await api.post('/api/jobs/'+selected.id+'/close',{reason});await refresh();show(selected.jobNumber+' closed')}catch(e:any){show(e?.response?.data?.error||e?.message||'Job could not be closed')}finally{setBusy('')}};
  const remove=async()=>{if(!selected)return;const confirmation=await cosPrompt('Type DELETE '+selected.jobNumber+' to permanently remove this job');if(confirmation===null)return;if(!await cosConfirm('Permanently delete '+selected.jobNumber+'? This cannot be undone. Jobs with protected billing or dependency history will be blocked.'))return;setBusy('remove');try{await api.post('/api/jobs/'+selected.id+'/remove',{confirmation:confirmation.trim()});setSelectedJobId('');await refresh();show(selected.jobNumber+' permanently deleted')}catch(e:any){show(e?.response?.data?.error||e?.message||'Job could not be deleted')}finally{setBusy('')}};
  const advanceIt=async()=>{if(!selected)return;const unit=String(advance.unitNumber||selected.equipmentUnitTag||'').trim();if(!unit){show('Physical unit number is required before pushing IT work to Service');return}if(!advance.serviceTechnician||!advance.date||!advance.startTime||!advance.endTime){show('Service technician, date, start time and end time are required');return}if(advance.endTime<=advance.startTime){show('Service end time must be after the start time');return}if(!await cosConfirm('Owner verified IT prep for '+selected.jobNumber+' and schedule it to '+advance.serviceTechnician+' for Service?'))return;setBusy('advance');try{await api.post('/api/owner/jobs/'+selected.id+'/advance-it',{note:advance.note,unitNumber:unit,serviceTechnician:advance.serviceTechnician,start:advance.date+' '+advance.startTime,end:advance.date+' '+advance.endTime});await refresh();show(selected.jobNumber+' advanced from IT and scheduled to '+advance.serviceTechnician)}catch(e:any){show(e?.response?.data?.error||e?.message||'IT-to-Service advance failed')}finally{setBusy('')}};
  const approveTruck=async(check:any)=>{const note=await cosPrompt('Owner truck stock approval note (optional)');if(note===null)return;if(!await cosConfirm('Approve '+check.technician+' truck stock / check as Owner verified?'))return;setBusy('truck-'+check.id);try{const r=await api.post('/api/owner/truck-checks/'+check.id+'/approve',{note});await refresh();const missing=r.data.missing_fields||[];show('Truck stock approved'+(missing.length?' · '+missing.length+' identifier field(s) were missing and logged':'') )}catch(e:any){show(e?.response?.data?.error||e?.message||'Truck stock approval failed')}finally{setBusy('')}};
  useEffect(()=>{
    const roster=control.serviceTechnicians||[];
    setAdvance((current:any)=>current.serviceTechnician&&!roster.includes(current.serviceTechnician)?{...current,serviceTechnician:''}:current);
  },[control.serviceTechnicians]);
  const jobTechs=selected?.department?.toLowerCase()==='it'?(control.itTechnicians||[]):selected?.department?.toLowerCase()==='service'?(control.serviceTechnicians||[]):[...(control.itTechnicians||[]),...(control.serviceTechnicians||[])];
  return <section className='panel module owner-board-controls'>
    <div className='panelhead'><div><h2>Owner Controls</h2><span>Owner-only overrides are audit-marked in production.</span></div><button className='secondary' onClick={()=>refresh().catch(()=>show('Owner controls could not be refreshed. Please retry.'))}>REFRESH</button></div>
    <div className='quote-detail-grid'>
      <label>Selected COS Job
        <select value={selection.selectedId} disabled={!!busy} onChange={e => setSelectedJobId(e.target.value)}>
          <option value=''>{selection.options.length ? 'Choose a COS Job' : 'No active jobs available'}</option>
          {selection.options.map(job => <option key={job.id} value={job.id}>{job.jobNumber} · {job.customer} · {job.stage}</option>)}
        </select>
      </label>
      <label>Assign technician<select value={assignTech} disabled={!selected || !!busy} onChange={e=>setAssignTech(e.target.value)}><option value=''>Choose technician</option>{jobTechs.map((t:string)=><option key={t}>{t}</option>)}</select></label>
    </div>
    {!selected && <p role='status'>Choose a COS Job before assigning, closing or deleting. The selected job number and details will appear here.</p>}
    {selected&&<div className='purchase-actions'>
      <span><b>{selected.jobNumber}</b> · {selected.customer} · {selected.site} · {selected.stage} · {selected.status}</span>
      <button disabled={!!busy||!assignTech} onClick={assign}>ASSIGN</button>
      <button className='secondary' disabled={!!busy} onClick={close}>CLOSE JOB</button>
      <button className='danger' disabled={!!busy} onClick={remove}>DELETE JOB</button>
    </div>}
    {selected&&String(selected.stage||'').toLowerCase()==='it prep'&&<section className='quote-card'>
      <div className='quote-section-head'><div><h3>Owner Verified IT → Service</h3><small>Use this when you personally checked the unit/process. The normal IT Tech Check is cancelled as an Owner override, the IT visit is completed, and the Service handoff becomes authoritative.</small></div></div>
      <div className='quote-detail-grid'>
        <label>Physical unit number<input value={advance.unitNumber||selected.equipmentUnitTag||''} onChange={e=>setAdvance({...advance,unitNumber:e.target.value})}/></label>
        <label>Service technician<select value={advance.serviceTechnician} onChange={e=>setAdvance({...advance,serviceTechnician:e.target.value})}><option value="">Choose technician</option>{(control.serviceTechnicians||[]).map((t:string)=><option key={t}>{t}</option>)}</select></label>
        <label>Service date<input type='date' required value={advance.date} onChange={e=>setAdvance({...advance,date:e.target.value})}/></label>
        <label>Start time<input type='time' required value={advance.startTime} onChange={e=>setAdvance({...advance,startTime:e.target.value})}/></label>
        <label>End time<input type='time' required value={advance.endTime} onChange={e=>setAdvance({...advance,endTime:e.target.value})}/></label>
        <label>Owner note<input value={advance.note} onChange={e=>setAdvance({...advance,note:e.target.value})} placeholder='What you verified'/></label>
      </div>
      <button disabled={!!busy} onClick={advanceIt}>{busy==='advance'?'ADVANCING…':'OWNER VERIFIED · SCHEDULE TO SERVICE'}</button>
    </section>}
    <section className='quote-card'>
      <div className='quote-section-head'><div><h3>Add COS Job</h3><small>Owner-created jobs bypass quote/MHelpDesk conversion but are explicitly audit-marked as Owner-created.</small></div></div>
      <div className='quote-detail-grid'>
        <label>Customer / Site<select value={newJob.siteId} onChange={e=>setNewJob({...newJob,siteId:e.target.value})}><option value=''>Choose site</option>{(control.sites||[]).map((s:any)=><option key={s.id} value={s.id}>{s.customers?.name||'Customer'} · {s.name}</option>)}</select></label>
        <label>Job type<select value={newJob.jobType} onChange={e=>setNewJob({...newJob,jobType:e.target.value})}>{['DELIVERY','SWAP','PICKUP','SERVICE'].map(x=><option key={x}>{x}</option>)}</select></label>
        <label>Title<input value={newJob.title} onChange={e=>setNewJob({...newJob,title:e.target.value})}/></label>
        <label>Priority<select value={newJob.priority} onChange={e=>setNewJob({...newJob,priority:e.target.value})}><option value='normal'>Normal</option><option value='high'>High</option><option value='urgent'>Urgent</option></select></label>
      </div>
      <label>Description / instructions<textarea rows={3} value={newJob.description} onChange={e=>setNewJob({...newJob,description:e.target.value})}/></label>
      {newJob.jobType==='SERVICE'&&<label className='tc-primary'><input type='checkbox' checked={newJob.shopPrep} onChange={e=>setNewJob({...newJob,shopPrep:e.target.checked})}/> SERVICE REQUIRES IT SHOP PREP</label>}
      <button disabled={!!busy} onClick={createJob}>{busy==='create'?'CREATING…':'ADD COS JOB'}</button>
    </section>
    <section className='quote-card'>
      <div className='quote-section-head'><div><h3>Truck Stock / Check Approval</h3><small>Approve a recorded truck check when you personally verified the stock. Missing identifiers remain visible in the audit result.</small></div></div>
      <div className='records'>{(control.truckChecks||[]).length?(control.truckChecks||[]).slice(0,8).map((c:any)=><div className='record op-record' key={c.id}><div><strong>{c.technician||'Technician'} · {String(c.department||'').toUpperCase()}</strong><small>{c.vehicleRef||'Vehicle not named'} · {c.status} · {c.ownerApproved?'OWNER APPROVED':'Awaiting Owner approval'}</small></div><div className='row-actions'><em>{c.ownerApproved?'APPROVED':'CHECK'}</em>{!c.ownerApproved&&<button disabled={!!busy} onClick={()=>approveTruck(c)}>APPROVE STOCK</button>}</div></div>):<div className='loading'>No truck checks recorded in the last 7 days.</div>}</div>
    </section>
  </section>;
}

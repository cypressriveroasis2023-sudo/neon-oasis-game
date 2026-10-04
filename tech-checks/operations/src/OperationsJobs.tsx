import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { chicagoDay } from './dailyBoardData';
import { validateLocalSchedule } from '../shared/scheduleValidation';
import JobEvidence from './JobEvidence';
import { assignmentTechnicians, canDispatch, confirmedDispatch, confirmedReview, confirmedSchedule, createJobActionSaver, jobDepartment, jobItems, recordItems, statusKey, technicianLocationUrl, visibleJobs, type JobsMode, type OperationsRecord } from './operationsWorkflowData';
import './operationsWorkflows.css';

type Props={mode:JobsMode;show:(message:string)=>void};
type ScheduleDraft={date:string;startTime:string;endTime:string;technician:string;department:string};
const message=(cause:unknown,fallback:string)=>cause instanceof Error?cause.message:fallback;
export default function OperationsJobs({mode,show}:Props) {
  const [rows,setRows]=useState<OperationsRecord[]|null>(null);
  const [team,setTeam]=useState<OperationsRecord[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [teamError,setTeamError]=useState('');
  const [actionError,setActionError]=useState('');
  const [notice,setNotice]=useState('');
  const [saving,setSaving]=useState(false);
  const [refreshRequired,setRefreshRequired]=useState(false);
  const [scheduleJob,setScheduleJob]=useState<OperationsRecord|null>(null);
  const [scheduleForm,setScheduleForm]=useState<ScheduleDraft>({date:'',startTime:'08:00',endTime:'10:00',technician:'',department:'service'});
  const [correctionJob,setCorrectionJob]=useState<OperationsRecord|null>(null);
  const [correctionReason,setCorrectionReason]=useState('');
  const revision=useRef(0);
  const mounted=useRef(false);
  const scheduleDialog=useRef<HTMLDialogElement|null>(null);
  const correctionDialog=useRef<HTMLDialogElement|null>(null);
  const saver=useMemo(()=>createJobActionSaver(api),[]);
  const load=useCallback(async()=>{
    const request=++revision.current;setLoading(true);
    try {
      const data=jobItems((await api.get(mode==='review'?'/api/owner-review':'/api/jobs')).data);
      if(mounted.current&&request===revision.current){setRows(data);setError('');setRefreshRequired(false);setActionError('');}
    } catch(cause){if(mounted.current&&request===revision.current){const detail=message(cause,mode==='review'?'Owner Review could not be loaded.':'Jobs could not be loaded.');setError(detail);show(detail);}}
    finally{if(mounted.current&&request===revision.current)setLoading(false);}
  },[mode,show]);
  const loadTeam=useCallback(async()=>{
    try{const data=recordItems((await api.get('/api/team-production')).data);if(mounted.current){setTeam(data);setTeamError('');}}
    catch(cause){if(mounted.current)setTeamError(message(cause,'The current technician roster could not be loaded. Retry before assigning work.'));}
  },[]);
  useEffect(()=>{
    mounted.current=true;void load();void loadTeam();
    const focus=()=>void load();
    window.addEventListener('focus',focus);
    return()=>{mounted.current=false;revision.current+=1;window.removeEventListener('focus',focus);};
  },[load,loadTeam]);
  useEffect(()=>{if(scheduleJob&&scheduleDialog.current&&!scheduleDialog.current.open)scheduleDialog.current.showModal();},[scheduleJob]);
  useEffect(()=>{if(correctionJob&&correctionDialog.current&&!correctionDialog.current.open)correctionDialog.current.showModal();},[correctionJob]);
  const available=assignmentTechnicians(team,scheduleForm.department);
  const openSchedule=(job:OperationsRecord)=>{
    const department=jobDepartment(job);
    const technicians=assignmentTechnicians(team,department);
    const start=String(job.scheduled||'').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    const end=String(job.scheduledEnd||'').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    const current=technicians.some(person=>person.name===job.technician)?job.technician:'';
    setScheduleForm({date:start?.[1]||chicagoDay(new Date()),startTime:start?.[2]||'08:00',endTime:end?.[2]||'10:00',technician:current||technicians[0]?.name||'',department});
    setActionError('');setScheduleJob(job);
  };
  const perform=async(path:string,body:unknown,confirmed:(items:OperationsRecord[])=>boolean,success:string)=>{
    if(saver.busy||refreshRequired)return false;
    setSaving(true);setActionError('');setNotice('');
    try {
      const result=await saver.save(path,body,confirmed);
      if(!mounted.current)return false;
      if(result.status==='confirmed'){
        revision.current+=1;setLoading(false);setRows(mode==='review'?visibleJobs(result.rows,'review'):result.rows);setError('');setNotice(success);show(success);
        window.dispatchEvent(new Event('cos-board-updated'));return true;
      }
      if(result.status!=='busy'){setRefreshRequired(true);setActionError(result.message);show(result.message);}
      return false;
    } finally{if(mounted.current)setSaving(false);}
  };
  const saveSchedule=async()=>{
    if(!scheduleJob||!scheduleForm.technician){setActionError('Date, start time, end time and technician are required.');return;}
    if(!available.some(person=>person.name===scheduleForm.technician)){setActionError('Select an active technician in the current job department.');return;}
    const schedule=validateLocalSchedule(scheduleForm.date+' '+scheduleForm.startTime,scheduleForm.date+' '+scheduleForm.endTime);
    if(schedule.valid===false){setActionError(schedule.error);return;}
    const job=scheduleJob;
    const saved=await perform('/api/jobs/'+job.id+'/schedule',{start:schedule.start,end:schedule.end,technician:scheduleForm.technician},
      items=>confirmedSchedule(items,{id:job.id,visitId:job.visitId,technician:scheduleForm.technician,start:schedule.start!,end:schedule.end!}),
      'Visit schedule and technician assignment saved and verified.');
    if(saved)setScheduleJob(null);
  };
  const dispatch=async(job:OperationsRecord)=>{
    if(!canDispatch(job))return;
    await perform('/api/jobs/'+job.id+'/dispatch',{},items=>confirmedDispatch(items,job.id,String(job.technician||''),job.visitId),'Job dispatched to '+job.technician+' and verified.');
  };
  const approve=async(job:OperationsRecord)=>{
    await perform('/api/jobs/'+job.id+'/owner-review',{action:'approve'},items=>confirmedReview(items,job.id,'approve'),'Operational closeout approved and verified · released to Billing.');
  };
  const returnCorrection=async()=>{
    if(!correctionJob||!correctionReason.trim()){setActionError('A correction reason is required.');return;}
    const job=correctionJob;
    const saved=await perform('/api/jobs/'+job.id+'/owner-review',{action:'return',reason:correctionReason.trim()},items=>confirmedReview(items,job.id,'return'),'Job returned for correction and verified.');
    if(saved){setCorrectionJob(null);setCorrectionReason('');}
  };
  const visible=visibleJobs(rows||[],mode);
  const disabled=saving||refreshRequired;
  const refresh=()=>{void load();void loadTeam();};
  const label=mode==='review'?'Owner Review':mode==='dispatch'?'Dispatch':mode==='unscheduled'?'Unscheduled COS Jobs':'COS Jobs';
  return <div className='ops-workflows' aria-label={label} aria-busy={loading}>
    <div className='purchase-actions'><span>{mode==='jobs'?'COS Jobs are the authoritative operational records.':mode==='review'?'Completed field work waiting for Owner closeout.':mode==='unscheduled'?'Schedule and assign work before dispatch.':'Only properly scheduled work can be dispatched.'}</span><span>{rows?visible.length+' '+(mode==='jobs'?'authoritative job records':'jobs'):'Counts unavailable'}</span><button className='secondary' disabled={loading||saving} onClick={refresh}>{loading?'Refreshing…':'Refresh jobs'}</button></div>
    {error&&<div className='daily-board-error' role='alert'>{error}{rows&&<p>Showing the last successful records.</p>}</div>}
    {actionError&&<div className='daily-board-error' role='alert'>{actionError}{refreshRequired&&<button className='secondary' disabled={loading||saving} onClick={refresh}>Refresh before another action</button>}</div>}
    {notice&&<div className='daily-board-notice' role='status'>{notice}</div>}
    {!rows&&!error?<div className='loading' role='status'>Loading COS Jobs…</div>:<div className='records'>{visible.map(job=>{
      const location=technicianLocationUrl(job.lastLocation);
      const correction=Array.isArray(job.activity)?job.activity.filter((entry:unknown)=>typeof entry==='string'&&entry.startsWith('Returned by Owner:')).at(-1):'';
      return <div className='record op-record' key={job.id}>
        <div><strong>{job.jobNumber} · {job.customer}</strong><small>{job.site} · {job.jobType} · {job.equipment||'Equipment not assigned'}{job.equipmentUnitTag?' · '+(String(job.jobType).toUpperCase()==='SWAP'?'Site / returned ':'Unit ')+job.equipmentUnitTag:' · UNIT TAG REQUIRED'}{String(job.jobType).toUpperCase()==='SERVICE'?' · '+(job.shopPrep?'Shop prep required':'Direct Service'):''} · Stage: {job.stage||'Legacy workflow'} · {job.scheduled||'Not scheduled'} · {job.technician||'Unassigned'}{statusKey(job.status)==='en route'?' · LIVE GPS':''}</small>
          {statusKey(job.status)==='unscheduled'&&correction&&<span className='owner-techcheck'>OWNER CORRECTION · {String(correction).replace('Returned by Owner: ','')}</span>}
          {location&&<a className='owner-location' href={location} target='_blank' rel='noopener noreferrer'>View technician location · {Number(job.lastLocation.latitude).toFixed(4)}, {Number(job.lastLocation.longitude).toFixed(4)}</a>}
          {job.techCheck&&<span className='owner-techcheck'>Tech Check · {job.techCheck.complete?'Complete':'Step '+(Number(job.techCheck.step||0)+1)}</span>}
          {mode==='review'&&<JobEvidence job={job}/>}
        </div>
        <div className='row-actions'><em>{job.status}</em>
          {mode==='unscheduled'&&<button disabled={disabled} onClick={()=>openSchedule(job)}>Schedule + Assign</button>}
          {mode==='dispatch'&&canDispatch(job)&&<button disabled={disabled} onClick={()=>void dispatch(job)}>{statusKey(job.status)==='assigned'?'Dispatch Handoff':'Dispatch'}</button>}
          {mode==='dispatch'&&['scheduled','assigned'].includes(statusKey(job.status))&&!canDispatch(job)&&<small>Awaiting physical-unit identification by the assigned IT technician before dispatch.</small>}
          {mode==='review'&&<><button disabled={disabled} onClick={()=>void approve(job)}>Approve + Release to Billing</button><button className='secondary' disabled={disabled} onClick={()=>{setActionError('');setCorrectionJob(job);setCorrectionReason('');}}>Return for Correction</button></>}
        </div>
      </div>;
    })}{rows&&visible.length===0&&<div className='loading'>No {mode==='review'?'completed jobs are waiting for Owner Review':mode==='unscheduled'?'jobs are currently waiting to be scheduled':mode==='dispatch'?'jobs are currently in the dispatch queue':'COS Jobs are in the current records'}.</div>}</div>}
    {scheduleJob&&<dialog ref={scheduleDialog} className='schedule-overlay' aria-label='Schedule and assign job' onCancel={event=>{if(saving)event.preventDefault();else setScheduleJob(null);}}><section className='schedule-card'><div className='schedule-head'><div><small>SCHEDULE & ASSIGN</small><h2>{scheduleJob.jobNumber}</h2><p>{scheduleJob.customer} · {scheduleJob.site}</p></div><button aria-label='Close scheduling' disabled={saving} onClick={()=>setScheduleJob(null)}>×</button></div><div className='schedule-context'><span><b>JOB TYPE</b>{scheduleJob.jobType}</span><span><b>WORKFLOW STAGE</b>{scheduleJob.stage||scheduleForm.department.toUpperCase()}</span><span><b>EQUIPMENT</b>{scheduleJob.equipment||'Not assigned yet'}</span><span><b>DEPARTMENT</b>{scheduleForm.department.toUpperCase()}</span></div>
      {teamError&&<div className='daily-board-error' role='alert'>{teamError}<button className='secondary' onClick={()=>void loadTeam()}>Retry technician roster</button></div>}
      {actionError&&<div className='daily-board-error' role='alert'>{actionError}{refreshRequired&&<button className='secondary' disabled={loading||saving} onClick={refresh}>Refresh jobs</button>}</div>}
      <div className='schedule-form'><label>Service date<span>Choose the day the technician should arrive.</span><input disabled={saving} type='date' value={scheduleForm.date} onChange={event=>setScheduleForm({...scheduleForm,date:event.target.value})}/></label><label>Start time<span>Planned arrival time · CT.</span><input disabled={saving} type='time' value={scheduleForm.startTime} onChange={event=>setScheduleForm({...scheduleForm,startTime:event.target.value})}/></label><label>End time<span>Expected completion time · CT.</span><input disabled={saving} type='time' value={scheduleForm.endTime} onChange={event=>setScheduleForm({...scheduleForm,endTime:event.target.value})}/></label><label>Assign technician<span>Correct department technicians only.</span><select disabled={saving} value={scheduleForm.technician} onChange={event=>setScheduleForm({...scheduleForm,technician:event.target.value})}><option value=''>Choose technician</option>{available.map(person=><option key={person.userId||person.name} value={person.name}>{person.name}</option>)}</select></label></div><div className='schedule-summary'><b>READY TO SCHEDULE</b><span>{scheduleForm.date||'Choose a date'} · {scheduleForm.startTime}–{scheduleForm.endTime} CT · {scheduleForm.technician||'Choose technician'}</span><small>Customer and site remain tied to this authoritative COS Job. Saving controls which technician receives the work.</small></div><div className='schedule-actions'><button className='secondary' disabled={saving} onClick={()=>setScheduleJob(null)}>CANCEL</button><button disabled={disabled||!scheduleForm.technician} onClick={()=>void saveSchedule()}>{saving?'SAVING…':'SAVE SCHEDULE & ASSIGN'}</button></div></section></dialog>}
    {correctionJob&&<dialog ref={correctionDialog} className='schedule-overlay' aria-label='Return for Correction' onCancel={event=>{if(saving)event.preventDefault();else setCorrectionJob(null);}}><section className='schedule-card'><div className='schedule-head'><div><small>OWNER REVIEW</small><h2>Return for Correction</h2><p>{correctionJob.jobNumber} · {correctionJob.customer}</p></div><button aria-label='Close correction' disabled={saving} onClick={()=>setCorrectionJob(null)}>×</button></div><div className='schedule-summary'><b>CORRECTION REQUIRED</b><span>The completed evidence and audit history will be preserved.</span><small>This job will leave Billing readiness, return to scheduling, and require a fresh Tech Check before it can come back to Owner Review.</small></div>{actionError&&<div className='daily-board-error' role='alert'>{actionError}{refreshRequired&&<button className='secondary' disabled={loading||saving} onClick={refresh}>Refresh jobs</button>}</div>}<div className='schedule-form'><label>Correction reason<span>Tell the technician exactly what must be corrected before this job can be approved.</span><textarea disabled={saving} rows={5} value={correctionReason} onChange={event=>setCorrectionReason(event.target.value)} placeholder='Describe the correction required…'/></label></div><div className='schedule-actions'><button className='secondary' disabled={saving} onClick={()=>setCorrectionJob(null)}>CANCEL</button><button disabled={disabled||!correctionReason.trim()} onClick={()=>void returnCorrection()}>{saving?'RETURNING…':'RETURN JOB FOR CORRECTION'}</button></div></section></dialog>}
  </div>;
}

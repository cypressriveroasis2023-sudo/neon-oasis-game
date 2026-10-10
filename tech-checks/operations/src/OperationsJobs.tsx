import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { api } from './api';
import { chicagoDay } from './dailyBoardData';
import { validateLocalSchedule } from '../shared/scheduleValidation';
import JobEvidence from './JobEvidence';
import LegacyInstallEvidence from './LegacyInstallEvidence';
import { DeliveryGoBackDialog, DeliveryGoBackSummary } from './DeliveryGoBack';
import { canRequestGoBack, confirmedGoBack, emptyGoBackDraft, goBackBlockedReason, hasOpenGoBack, validGoBackDraft, type GoBackDraft } from './deliveryGoBackData';
import { assignmentTechnicians, canDispatch, confirmedDispatch, confirmedQueueRelease, confirmedReview, confirmedSchedule, createJobActionSaver, jobDepartment, isItQueue, jobItems, recordItems, statusKey, technicianLocationUrl, visibleJobs, type JobsMode, type OperationsRecord } from './operationsWorkflowData';
import './operationsWorkflows.css';

function useModalDialog(ref:RefObject<HTMLDialogElement|null>,visible:unknown) {
  useEffect(()=>{
    const dialog=ref.current;
    if(!visible||!dialog)return;
    const previous=document.activeElement;
    if(!dialog.open)dialog.showModal();
    return()=>{if(dialog.open)dialog.close();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
  },[visible,ref]);
}
type Props={mode:JobsMode;show:(message:string)=>void;initialJobId?:string;clearFocusedJob?:()=>void;openLifecycle?:(id:string)=>void;legacyInstallEvidenceEnabled?:boolean};
type ScheduleDraft={date:string;startTime:string;endTime:string;technician:string;department:string;assignmentMode:'it_queue'|'technician'};
const message=(cause:unknown,fallback:string)=>cause instanceof Error?cause.message:fallback;
export default function OperationsJobs({mode,show,initialJobId='',clearFocusedJob,openLifecycle,legacyInstallEvidenceEnabled=false}:Props) {
  const [search,setSearch]=useState('');
  const [focusedId,setFocusedId]=useState(initialJobId);
  useEffect(()=>setFocusedId(initialJobId),[initialJobId]);
  const [statusFilter,setStatusFilter]=useState('');
  useEffect(()=>{setSearch('');setStatusFilter('');},[mode]);
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
  const [scheduleForm,setScheduleForm]=useState<ScheduleDraft>({date:'',startTime:'08:00',endTime:'10:00',technician:'',department:'service',assignmentMode:'technician'});

  const [goBackJob,setGoBackJob]=useState<OperationsRecord|null>(null);
  const [goBackDraft,setGoBackDraft]=useState<GoBackDraft|null>(null);
  const goBackDialog=useRef<HTMLDialogElement|null>(null);
  const [correctionJob,setCorrectionJob]=useState<OperationsRecord|null>(null);
  const [correctionReason,setCorrectionReason]=useState('');
  const [lifecycleJob,setLifecycleJob]=useState<OperationsRecord|null>(null);
  const [lifecycleAction,setLifecycleAction]=useState<'close'|'remove'|null>(null);
  const [lifecycleInput,setLifecycleInput]=useState('');
  const revision=useRef(0);
  const activeReads=useRef(0);
  const recoveryReads=useRef(0);
  const mounted=useRef(false);
  const scheduleDialog=useRef<HTMLDialogElement|null>(null);
  const correctionDialog=useRef<HTMLDialogElement|null>(null);
  const lifecycleDialog=useRef<HTMLDialogElement|null>(null);
  const saver=useMemo(()=>createJobActionSaver(api),[]);
  const load=useCallback(async(acknowledge=false)=>{
    if(saver.busy)return;
    const request=++revision.current;activeReads.current+=1;setLoading(true);
    if(acknowledge)recoveryReads.current+=1;
    try {
      const data=jobItems((await api.get(mode==='review'?'/api/owner-review':'/api/jobs')).data);
      if(mounted.current&&request===revision.current){
        setRows(data);setError('');
        if(acknowledge)saver.acknowledgeRefresh({items:data});
        setRefreshRequired(saver.needsRefresh);
        if(!saver.needsRefresh)setActionError('');
      }
    } catch(cause){if(mounted.current&&request===revision.current){const detail=message(cause,mode==='review'?'Owner Review could not be loaded.':'Jobs could not be loaded.');setError(detail);show(detail);}}
    finally{activeReads.current-=1;if(acknowledge)recoveryReads.current-=1;if(mounted.current)setLoading(activeReads.current>0);}
  },[mode,show,saver]);
  const loadTeam=useCallback(async()=>{
    try{const data=recordItems((await api.get('/api/team-production')).data);if(mounted.current){setTeam(data);setTeamError('');}}
    catch(cause){if(mounted.current)setTeamError(message(cause,'The current technician roster could not be loaded. Retry before assigning work.'));}
  },[]);
  useEffect(()=>{
    mounted.current=true;void load();void loadTeam();
    const focus=()=>{if(!activeReads.current)void load();};
    window.addEventListener('focus',focus);
    return()=>{mounted.current=false;revision.current+=1;window.removeEventListener('focus',focus);};
  },[load,loadTeam]);
  useModalDialog(scheduleDialog,scheduleJob);
  useModalDialog(goBackDialog,goBackJob);
  useModalDialog(correctionDialog,correctionJob);
  useModalDialog(lifecycleDialog,lifecycleJob);
  const available=assignmentTechnicians(team,scheduleForm.department);
  const openSchedule=(job:OperationsRecord)=>{
    const department=jobDepartment(job);
    const technicians=assignmentTechnicians(team,department);
    const start=String(job.scheduled||'').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    const end=String(job.scheduledEnd||'').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    const current=technicians.some(person=>person.name===job.technician)?job.technician:'';
    const named=Boolean(job.technicianUserId||job.technicianId)||Boolean(String(job.technician||'').trim()&&!['unassigned','it shared queue','it queue'].includes(statusKey(job.technician)));
    const assignmentMode=department==='it'&&(isItQueue(job)||!named)?'it_queue':'technician';
    setScheduleForm({date:start?.[1]||chicagoDay(new Date()),startTime:start?.[2]||'08:00',endTime:end?.[2]||'10:00',technician:current||(named?'':technicians[0]?.name)||'',department,assignmentMode});
    setActionError('');setScheduleJob(job);
  };
  const perform=async(path:string,body:unknown,confirmed:(items:OperationsRecord[])=>boolean,success:string)=>{
    if(saver.busy||saver.needsRefresh||recoveryReads.current>0||!mounted.current)return false;
    revision.current+=1;
    setSaving(true);setActionError('');setNotice('');
    try {
      const result=await saver.save(path,body,confirmed);
      if(!mounted.current)return false;
      if(result.status==='confirmed'){
        revision.current+=1;setLoading(false);setRows(mode==='review'?visibleJobs(result.rows,'review'):result.rows);setError('');setNotice(success);show(success);
        window.dispatchEvent(new Event('cos-board-updated'));return true;
      }
      if('message' in result){setRefreshRequired(true);setActionError(result.message);show(result.message);}
      return false;
    } finally{if(mounted.current)setSaving(false);}
  };
  const saveSchedule=async()=>{
    const shared=scheduleForm.assignmentMode==='it_queue'&&scheduleForm.department==='it';
    if(!scheduleJob||!shared&&!scheduleForm.technician){setActionError('Date, start time, end time and assignment destination are required.');return;}
    if(!shared&&!available.some(person=>person.name===scheduleForm.technician)){setActionError('Select an active technician in the current job department.');return;}
    const schedule=validateLocalSchedule(scheduleForm.date+' '+scheduleForm.startTime,scheduleForm.date+' '+scheduleForm.endTime);
    if(schedule.valid===false){setActionError(schedule.error);return;}
    const job=scheduleJob;
    const saved=await perform('/api/jobs/'+job.id+'/schedule',{start:schedule.start,end:schedule.end,...(shared?{assignmentMode:'it_queue'}:{technician:scheduleForm.technician,...(scheduleForm.department==='it'?{assignmentMode:'technician'}:{})})},
      items=>confirmedSchedule(items,{id:job.id,visitId:job.visitId,technician:shared?undefined:scheduleForm.technician,assignmentMode:shared?'it_queue':'technician',start:schedule.start!,end:schedule.end!}),
      shared?'IT shared queue schedule saved and verified. Use Send to IT queue in Dispatch when ready.':'Visit schedule and technician assignment saved and verified.');
    if(saved)setScheduleJob(null);
  };
  const dispatch=async(job:OperationsRecord)=>{
    if(!canDispatch(job))return;
    const release=isItQueue(job)&&job.queueStatus==='scheduled';
    await perform('/api/jobs/'+job.id+(release?'/release-it':'/dispatch'),{},items=>release?confirmedQueueRelease(items,job.id,job.visitId):confirmedDispatch(items,job.id,String(job.technician||''),job.visitId,isItQueue(job)?'it_queue':'technician'),release?'Job sent to the shared IT queue and verified. An IT technician can now take ownership; required setup must be finished before work starts.':'Job dispatched to '+job.technician+' and verified.');
  };
  const approve=async(job:OperationsRecord)=>{
    await perform('/api/jobs/'+job.id+'/owner-review',{action:'approve'},items=>confirmedReview(items,job.id,'approve'),'Operational closeout approved and verified · released to Billing.');
  };
  const lifecycle=async()=>{
    if(!lifecycleJob||!lifecycleAction)return;
    const job=lifecycleJob;
    if(lifecycleAction==='close'){
      if(!lifecycleInput.trim()){setActionError('Enter a close reason.');return;}
      const saved=await perform('/api/jobs/'+job.id+'/close',{reason:lifecycleInput.trim()},items=>{
        const current=items.find(item=>item.id===job.id);return Boolean(current)&&statusKey(current!.status)==='closed';
      },'Job closed and verified.');
      if(saved){setLifecycleJob(null);setLifecycleAction(null);setLifecycleInput('');}
      return;
    }
    const confirmation='DELETE '+job.jobNumber;
    if(lifecycleInput.trim()!==confirmation){setActionError('Type '+confirmation+' exactly to delete this job.');return;}
    const saved=await perform('/api/jobs/'+job.id+'/remove',{confirmation},items=>!items.some(item=>item.id===job.id),'Test job removed and verified.');
    if(saved){setLifecycleJob(null);setLifecycleAction(null);setLifecycleInput('');}
  };
  const saveGoBack=async()=>{
    if(!goBackJob||!goBackDraft||!validGoBackDraft(goBackDraft))return;
    const job=goBackJob,draft=goBackDraft;
    const saved=await perform('/api/jobs/'+job.id+'/go-back',draft,items=>confirmedGoBack(items,job.id,draft),'Go-back saved and verified. Ticket open · return visit ready to schedule.');
    if(saved){setGoBackJob(null);setGoBackDraft(null);}
  };
  const returnCorrection=async()=>{
    if(!correctionJob||!correctionReason.trim()){setActionError('A correction reason is required.');return;}
    const job=correctionJob;
    const saved=await perform('/api/jobs/'+job.id+'/owner-review',{action:'return',reason:correctionReason.trim()},items=>confirmedReview(items,job.id,'return'),'Job returned for correction and verified.');
    if(saved){setCorrectionJob(null);setCorrectionReason('');}
  };
  const candidates=visibleJobs(rows||[],mode);
  const statuses=[...new Set(candidates.map(job=>statusKey(job.status)))].sort();
  const query=search.trim().toLowerCase();
  const visible=candidates.filter(job=>(!focusedId||job.id===focusedId)&&(!statusFilter||statusKey(job.status)===statusFilter)&&(!query||[job.jobNumber,job.customer,job.site,job.equipmentUnitTag,job.technician].some(value=>String(value||'').toLowerCase().includes(query))));
  const durationMinutes=Number(scheduleForm.endTime.slice(0,2))*60+Number(scheduleForm.endTime.slice(3))-Number(scheduleForm.startTime.slice(0,2))*60-Number(scheduleForm.startTime.slice(3));
  const disabled=!rows||recoveryReads.current>0||saving||refreshRequired;
  const refresh=()=>{if(saver.busy||activeReads.current>0)return;void load(true);void loadTeam();};
  const label=mode==='review'?'Owner Review':mode==='dispatch'?'Dispatch':mode==='unscheduled'?'Unscheduled COS Jobs':'COS Jobs';
  return <div className='ops-workflows' aria-label={label} aria-busy={loading}>
    {mode==='review'&&legacyInstallEvidenceEnabled&&<LegacyInstallEvidence/>}
    <div className='purchase-actions'><span>{mode==='jobs'?'COS Jobs are the authoritative operational records.':mode==='review'?'Completed field work waiting for Owner closeout.':mode==='unscheduled'?'Schedule and assign work before dispatch.':'Only properly scheduled work can be dispatched.'}</span><span>{rows?visible.length+' '+(mode==='jobs'?'authoritative job records':'jobs'):'Counts unavailable'}</span><button className='secondary' disabled={loading||saving} onClick={refresh}>{loading?'Refreshing…':'Refresh jobs'}</button></div>
    {focusedId&&<div className='purchase-actions'><span>Selected job</span><button className='secondary' onClick={()=>{setFocusedId('');clearFocusedJob?.();}}>Show all jobs</button></div>}
    <div className='operations-job-filters'><label>Find a job<input type='search' placeholder='Job, customer, site, unit or technician' value={search} onChange={event=>setSearch(event.target.value)}/></label><label>Status<select value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value=''>All statuses</option>{statuses.map(status=><option value={status} key={status}>{status}</option>)}</select></label></div>
    {rows&&!loading&&candidates.length>0&&visible.length===0&&<p role='status'>No jobs match these filters.</p>}
    {error&&<div className='daily-board-error' role='alert'>{error}{rows&&<p>Showing the last successful records.</p>}</div>}
    {actionError&&<div className='daily-board-error' role='alert'>{actionError}{refreshRequired&&<button className='secondary' disabled={loading||saving} onClick={refresh}>Refresh before another action</button>}</div>}
    {notice&&<div className='daily-board-notice' role='status'>{notice}</div>}
    {!rows&&!error?<div className='loading' role='status'>Loading COS Jobs…</div>:<div className='records'>{visible.map(job=>{
      const location=technicianLocationUrl(job.lastLocation);
      const correction=Array.isArray(job.activity)?job.activity.filter((entry:unknown)=>typeof entry==='string'&&entry.startsWith('Returned by Owner:')).at(-1):'';
      const reviewBlockers=mode==='review'?[...(!job.equipmentUnitTag?['Physical unit identification is missing.']:[]),...(job.techCheck&&!job.techCheck.complete?['Technician workflow / Tech Check is incomplete.']:[]),...(job.damageReported?['Returned-unit damage requires review.']:[]),...((job.needsAttention===true||Array.isArray(job.needsAttention)&&job.needsAttention.length)?['Needs Attention items remain open.']:[]),...(Array.isArray(job.photos)&&job.photos.length===0?['No field photos are attached to this response.']:[])]:[];
      return <div className='record op-record' key={job.id}>
        <div><strong>{job.jobNumber} · {job.customer}</strong><small>{job.site} · {job.jobType} · {job.equipment||'Equipment not assigned'}{job.equipmentUnitTag?' · '+(String(job.jobType).toUpperCase()==='SWAP'?'Site / returned ':'Unit ')+job.equipmentUnitTag:' · UNIT TAG REQUIRED'}{String(job.jobType).toUpperCase()==='SERVICE'?' · '+(job.shopPrep?'Shop prep required':'Direct Service'):''} · Stage: {job.stage||'Legacy workflow'} · {job.scheduled||'Not scheduled'} · {isItQueue(job)?'IT shared queue · '+(job.queueStatus==='claimed'?'Claimed by '+job.technician:job.queueStatus==='ready'?'Ready to take':'Scheduled · not sent'):job.technician||'Unassigned'}{statusKey(job.status)==='en route'?' · LIVE GPS':''}</small>
          {statusKey(job.status)==='unscheduled'&&correction&&<span className='owner-techcheck'>OWNER CORRECTION · {String(correction).replace('Returned by Owner: ','')}</span>}
          <DeliveryGoBackSummary job={job}/>
          {location&&<a className='owner-location' href={location} target='_blank' rel='noopener noreferrer'>View technician location · {Number(job.lastLocation.latitude).toFixed(4)}, {Number(job.lastLocation.longitude).toFixed(4)}</a>}
          {job.techCheck&&<span className='owner-techcheck'>Tech Check · {job.techCheck.complete?'Complete':'Step '+(Number(job.techCheck.step||0)+1)}</span>}
          {mode==='review'&&reviewBlockers.length>0&&<div className='daily-board-error owner-review-blockers' role='status'><b>Review before approval</b>{reviewBlockers.map(blocker=><small key={blocker}>{blocker}</small>)}<small>The backend remains the final billing-readiness authority.</small></div>}
          {mode==='review'&&<JobEvidence job={job}/>}
        </div>
        <div className='row-actions'><em>{job.status}</em>
          {mode==='jobs'&&openLifecycle&&!['closed','cancelled','canceled','deleted'].includes(statusKey(job.status))&&<button className='secondary' onClick={()=>openLifecycle(String(job.id))}>View lifecycle</button>}
          {(mode==='unscheduled'||mode==='dispatch'&&hasOpenGoBack(job)&&statusKey(job.status)==='unscheduled')&&<button disabled={disabled} onClick={()=>openSchedule(job)}>Schedule + Assign</button>}
          {(mode==='jobs'||mode==='review')&&canRequestGoBack(job)&&<button className='secondary' disabled={disabled} onClick={()=>{setActionError('');setGoBackDraft(emptyGoBackDraft());setGoBackJob(job);}}>Go-back required</button>}
          {mode==='jobs'&&goBackBlockedReason(job)&&<small className='go-back-blocked'>{goBackBlockedReason(job)}</small>}
          {mode==='jobs'&&statusKey(job.status)!=='closed'&&!hasOpenGoBack(job)&&<button className='secondary' disabled={disabled} onClick={()=>{setActionError('');setLifecycleJob(job);setLifecycleAction('close');setLifecycleInput('');}}>Close Job</button>}
          {mode==='dispatch'&&canDispatch(job)&&<button disabled={disabled} onClick={()=>void dispatch(job)}>{isItQueue(job)&&job.queueStatus==='scheduled'?'Send to IT queue':statusKey(job.status)==='assigned'?'Dispatch Handoff':'Dispatch'}</button>}
          {mode==='dispatch'&&['scheduled','assigned'].includes(statusKey(job.status))&&!canDispatch(job)&&<small>{isItQueue(job)?job.queueStatus==='ready'?'Shared IT queue · waiting for an IT technician to take ownership.':job.queueStatus==='claimed'?'Claimed · finish physical-unit and Tech Check setup before dispatch.':'A complete schedule is required before sending to the IT queue.':'Awaiting physical-unit identification by the assigned '+(jobDepartment(job)==='it'?'IT':'Service')+' technician before dispatch.'}</small>}
          {mode==='jobs'&&/test|e2e/i.test(String(job.jobNumber)+' '+String(job.customer)+' '+String(job.site))&&<button className='secondary' disabled={disabled} onClick={()=>{setActionError('');setLifecycleJob(job);setLifecycleAction('remove');setLifecycleInput('');}}>Delete Test Job</button>}
          {mode==='review'&&<><button disabled={disabled||hasOpenGoBack(job)} onClick={()=>void approve(job)}>Approve + Release to Billing</button><button className='secondary' disabled={disabled} onClick={()=>{setActionError('');setCorrectionJob(job);setCorrectionReason('');}}>Return for Correction</button></>}
        </div>
      </div>;
    })}{rows&&visible.length===0&&<div className='loading'>No {mode==='review'?'completed jobs are waiting for Owner Review':mode==='unscheduled'?'jobs are currently waiting to be scheduled':mode==='dispatch'?'jobs are currently in the dispatch queue':'COS Jobs are in the current records'}.</div>}</div>}
    {goBackJob&&goBackDraft&&<DeliveryGoBackDialog job={goBackJob} draft={goBackDraft} setDraft={setGoBackDraft} dialogRef={goBackDialog} saving={saving} disabled={disabled} error={actionError} refreshRequired={refreshRequired} refresh={refresh} close={()=>{setGoBackJob(null);setGoBackDraft(null);}} save={()=>void saveGoBack()}/>}
    {scheduleJob&&<dialog ref={scheduleDialog} className='schedule-overlay' aria-label='Schedule and assign job' onCancel={event=>{if(saving)event.preventDefault();else setScheduleJob(null);}}><section className='schedule-card'><div className='schedule-head'><div><small>SCHEDULE & ASSIGN</small><h2>{scheduleJob.jobNumber}</h2><p>{scheduleJob.customer} · {scheduleJob.site}</p></div><button aria-label='Close scheduling' disabled={saving} onClick={()=>setScheduleJob(null)}>×</button></div><div className='schedule-context'><span><b>JOB TYPE</b>{scheduleJob.jobType}</span><span><b>WORKFLOW STAGE</b>{scheduleJob.stage||scheduleForm.department.toUpperCase()}</span><span><b>EQUIPMENT</b>{scheduleJob.equipment||'Not assigned yet'}</span><span><b>DEPARTMENT</b>{scheduleForm.department.toUpperCase()}</span></div>
      {teamError&&<div className='daily-board-error' role='alert'>{teamError}<button className='secondary' onClick={()=>void loadTeam()}>Retry technician roster</button></div>}
      {actionError&&<div className='daily-board-error' role='alert'>{actionError}{refreshRequired&&<button className='secondary' disabled={loading||saving} onClick={refresh}>Refresh jobs</button>}</div>}
      <div className='schedule-form'><label>Service date<span>Choose the day the technician should arrive.</span><input disabled={saving} type='date' value={scheduleForm.date} onChange={event=>setScheduleForm({...scheduleForm,date:event.target.value})}/></label><label>Start time<span>Planned arrival time · CT.</span><input disabled={saving} type='time' value={scheduleForm.startTime} onChange={event=>setScheduleForm({...scheduleForm,startTime:event.target.value})}/></label><label>End time<span>Expected completion time · CT.</span><input disabled={saving} type='time' value={scheduleForm.endTime} onChange={event=>setScheduleForm({...scheduleForm,endTime:event.target.value})}/></label>{scheduleForm.department==='it'&&<label>Assignment destination<span>Choose the shared queue or one IT technician.</span><select disabled={saving} value={scheduleForm.assignmentMode} onChange={event=>setScheduleForm({...scheduleForm,assignmentMode:event.target.value as 'it_queue'|'technician'})}><option value='it_queue'>IT shared queue</option><option value='technician'>Named IT technician</option></select></label>}{scheduleForm.assignmentMode==='technician'&&<label>Assign technician<span>Correct department technicians only.</span><select disabled={saving} value={scheduleForm.technician} onChange={event=>setScheduleForm({...scheduleForm,technician:event.target.value})}><option value=''>Choose technician</option>{available.map(person=><option key={person.userId||person.name} value={person.name}>{person.name}</option>)}</select></label>}</div><div className='schedule-summary'><b>VISIT DURATION · {Number.isFinite(durationMinutes)&&durationMinutes>0?`${Math.floor(durationMinutes/60)} hr ${durationMinutes%60} min`:'Choose an end time after the start'}</b><span>{scheduleForm.date||'Choose a date'} · {scheduleForm.startTime}–{scheduleForm.endTime} CT · {scheduleForm.assignmentMode==='it_queue'?'IT shared queue':scheduleForm.technician||'Choose technician'}</span><small>{scheduleForm.assignmentMode==='it_queue'?'Saving records the schedule only. Use Send to IT queue in Dispatch to make this visit available to every IT technician; one person can then take ownership. Physical-unit and Tech Check setup can be completed afterward, before work starts.':'Customer and site remain tied to this authoritative COS Job. Saving controls which technician receives the work.'}</small></div><div className='schedule-actions'><button className='secondary' disabled={saving} onClick={()=>setScheduleJob(null)}>CANCEL</button><button disabled={disabled||scheduleForm.assignmentMode==='technician'&&!scheduleForm.technician} onClick={()=>void saveSchedule()}>{saving?'SAVING…':scheduleForm.assignmentMode==='it_queue'?'SAVE QUEUE SCHEDULE':'SAVE SCHEDULE & ASSIGN'}</button></div></section></dialog>}
    {lifecycleJob&&lifecycleAction&&<dialog ref={lifecycleDialog} className='schedule-overlay' aria-label={lifecycleAction==='close'?'Close Job':'Delete Test Job'} onCancel={event=>{if(saving)event.preventDefault();else setLifecycleJob(null);}}><section className='schedule-card'><div className='schedule-head'><div><small>OWNER JOB CONTROL</small><h2>{lifecycleAction==='close'?'Close Job':'Delete Test Job'}</h2><p>{lifecycleJob.jobNumber} · {lifecycleJob.customer}</p></div><button aria-label='Close job control' disabled={saving} onClick={()=>setLifecycleJob(null)}>×</button></div><div className='schedule-summary'><b>{lifecycleAction==='close'?'CLOSE WITH AUDIT HISTORY':'PERMANENT TEST-JOB REMOVAL'}</b><span>{lifecycleAction==='close'?'Closing preserves the COS record and audit trail.':'Deletion is only exposed for records visibly identified as TEST/E2E.'}</span><small>{lifecycleAction==='remove'?'Type DELETE '+lifecycleJob.jobNumber+' exactly.':'Enter the operational reason for closing this job.'}</small></div>{actionError&&<div className='daily-board-error' role='alert'>{actionError}</div>}<div className='schedule-form'><label>{lifecycleAction==='close'?'Close reason':'Confirmation'}<input disabled={saving} value={lifecycleInput} onChange={event=>setLifecycleInput(event.target.value)} placeholder={lifecycleAction==='close'?'Reason for closing…':'DELETE '+lifecycleJob.jobNumber}/></label></div><div className='schedule-actions'><button className='secondary' disabled={saving} onClick={()=>setLifecycleJob(null)}>CANCEL</button><button disabled={disabled||!lifecycleInput.trim()} onClick={()=>void lifecycle()}>{saving?'SAVING…':lifecycleAction==='close'?'CLOSE JOB':'DELETE TEST JOB'}</button></div></section></dialog>}
    {correctionJob&&<dialog ref={correctionDialog} className='schedule-overlay' aria-label='Return for Correction' onCancel={event=>{if(saving)event.preventDefault();else setCorrectionJob(null);}}><section className='schedule-card'><div className='schedule-head'><div><small>OWNER REVIEW</small><h2>Return for Correction</h2><p>{correctionJob.jobNumber} · {correctionJob.customer}</p></div><button aria-label='Close correction' disabled={saving} onClick={()=>setCorrectionJob(null)}>×</button></div><div className='schedule-summary'><b>CORRECTION REQUIRED</b><span>The completed evidence and audit history will be preserved.</span><small>This job will leave Billing readiness, return to scheduling, and require a fresh Tech Check before it can come back to Owner Review.</small></div>{actionError&&<div className='daily-board-error' role='alert'>{actionError}{refreshRequired&&<button className='secondary' disabled={loading||saving} onClick={refresh}>Refresh jobs</button>}</div>}<div className='schedule-form'><label>Correction reason<span>Tell the technician exactly what must be corrected before this job can be approved.</span><textarea disabled={saving} rows={5} value={correctionReason} onChange={event=>setCorrectionReason(event.target.value)} placeholder='Describe the correction required…'/></label></div><div className='schedule-actions'><button className='secondary' disabled={saving} onClick={()=>setCorrectionJob(null)}>CANCEL</button><button disabled={disabled||!correctionReason.trim()} onClick={()=>void returnCorrection()}>{saving?'RETURNING…':'RETURN JOB FOR CORRECTION'}</button></div></section></dialog>}
  </div>;
}

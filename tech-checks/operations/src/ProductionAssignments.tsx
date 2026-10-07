import { useCallback, useEffect, useRef, useState } from 'react';
import { api, openLegacy } from './api';
import { confirmedItClaim, productionDay, productionItQueue, productionTasks, productionVisit, queueStatus, queueTime, type ItQueue } from './productionQueueData';
type Row = Record<string, any>;
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Operations could not verify these records.';
export default function ProductionAssignments() {
  const [session, setSession] = useState<Row | null>(null);
  const [day, setDay] = useState<ReturnType<typeof productionDay> | null>(null);
  const [tasks, setTasks] = useState<Row[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Row | null>(null);
  const [opening, setOpening] = useState(false);
  const [sharedQueue, setSharedQueue] = useState<ItQueue | null>(null);
  const [claiming, setClaiming] = useState('');
  const [claimNotice, setClaimNotice] = useState('');
  const [refreshRequired, setRefreshRequired] = useState(false);
  const mounted = useRef(false), claimRunning = useRef(false), needsReadback = useRef(false), identityRef = useRef('');
  const pendingClaim = useRef<{ visitId: string; actorId: string } | null>(null);
  const sequence = useRef(0), detailSequence = useRef(0), refreshRunning = useRef(false);
  const refresh = useCallback(async (acknowledge = false, fromClaim = false) => {
    if (!mounted.current || refreshRunning.current || claimRunning.current && !fromClaim) return null;
    const request = ++sequence.current;
    refreshRunning.current = true;
    detailSequence.current++; setDetail(null); setOpening(false);
    setLoading(true);
    const clear = () => { identityRef.current = ''; setSession(null); setDay(null); setTasks(null); setSharedQueue(null); setClaimNotice(''); };
    try {
      const identity = (await api.get('/api/tech/session')).data;
      if (request !== sequence.current) return null;
      if (!identity || identity.legacyTechnician !== true || typeof identity.authorized !== 'boolean' || !['it','service'].includes(identity.department))
        throw new Error('Your technician identity could not be verified.');
      const actorId = String(identity.productionTechnicianUserId || '');
      const identityKey = identity.department + ':' + actorId;
      if (identityRef.current !== identityKey) { setDay(null); setTasks(null); setSharedQueue(null); setClaimNotice(''); }
      identityRef.current = identityKey;
      setSession(identity);
      if (!identity.authorized) { clear(); setErrors({ session: identity.reason || 'This technician is not linked to Operations.' }); return null; }
      const responses = await Promise.allSettled([api.get('/api/tech/assignments'), api.get('/api/tech/tasks'),
        ...(identity.department === 'it' ? [api.get('/api/tech/it-queue')] : [])]);
      if (request !== sequence.current) return null;
      // Access revocation is never shown as a stale but usable assignment snapshot.
      const denied = responses.find(response => response.status === 'rejected' && [401,403].includes(response.reason?.response?.status));
      if (denied?.status === 'rejected') throw denied.reason;
      const next: Record<string, string> = {};
      let freshDay: ReturnType<typeof productionDay> | null = null, freshQueue: ItQueue | null = null;
      for (const [index, response] of responses.entries()) {
        const key = ['day','tasks','queue'][index];
        try {
          if (response.status === 'rejected') throw response.reason;
          if (index === 2) { freshQueue = productionItQueue(response.value.data, actorId); setSharedQueue(freshQueue); }
          else if (index === 1) setTasks(productionTasks(response.value.data));
          else { freshDay = productionDay(response.value.data); setDay(freshDay); }
        } catch (cause) { next[key] = message(cause); if (key === 'queue') setSharedQueue(null); }
      }
      if (identity.department !== 'it') setSharedQueue(null);
      if (acknowledge && freshDay && (identity.department !== 'it' || freshQueue)) {
        const pending = pendingClaim.current;
        const own = pending && freshQueue?.items.find(item => item.visitId === pending.visitId && item.claimOwnerId === actorId);
        if (pending && own && freshQueue && !confirmedItClaim(freshQueue, freshDay, pending.visitId, actorId)) {
          next.claim = 'Ownership appears saved, but your assignment could not be verified. Refresh before taking more work.';
        } else { pendingClaim.current = null; needsReadback.current = false; setRefreshRequired(false); }
      }
      setErrors(next);
      return { identity, day: freshDay, queue: freshQueue };
    } catch (cause) { if (request === sequence.current) { clear(); setErrors({ session: message(cause) }); } return null; }
    finally { if (request === sequence.current) { refreshRunning.current = false; setLoading(false); } }
  }, []);
  useEffect(() => {
    mounted.current = true; void refresh();
    let focusTimer = 0;
    const focus = () => {
      window.clearTimeout(focusTimer);
      const interaction = detailSequence.current;
      // Let the click that focused this iframe run. Opening/claiming already
      // verifies fresh authorized records and must not be swallowed by a refresh.
      focusTimer = window.setTimeout(() => { if (interaction === detailSequence.current) void refresh(); }, 150);
    };
    window.addEventListener('focus', focus);
    return () => { mounted.current = false; refreshRunning.current = false; sequence.current++; detailSequence.current++; window.clearTimeout(focusTimer); window.removeEventListener('focus', focus); };
  }, [refresh]);
  const claim = async (visitId: string) => {
    const actorId = session?.productionTechnicianUserId;
    const item = sharedQueue?.items.find(item => item.visitId === visitId);
    if (claimRunning.current || refreshRunning.current || needsReadback.current || session?.department !== 'it' || !actorId || !item?.claimable || item.queueStatus !== 'ready') return;
    pendingClaim.current = { visitId, actorId };
    claimRunning.current = true; setClaiming(visitId); setClaimNotice('');
    detailSequence.current++; setDetail(null); setOpening(false);
    let failure = '';
    try {
      try { await api.post('/api/tech/it-queue/' + visitId + '/claim', {}); }
      catch (cause) { failure = message(cause); }
      // A response alone, including an uncertain timeout, never confirms ownership.
      if (!mounted.current) return;
      const fresh = await refresh(false, true);
      if (!mounted.current) return;
      if (!fresh || fresh.identity.productionTechnicianUserId !== actorId || fresh.identity.department !== 'it') { needsReadback.current = true; setRefreshRequired(true); return; }
      if (fresh.queue && fresh.day && confirmedItClaim(fresh.queue, fresh.day, visitId, actorId)) {
        pendingClaim.current = null; needsReadback.current = false; setRefreshRequired(false);
        setClaimNotice('Job taken and verified in your assigned jobs.');
      } else if (fresh.queue && fresh.day) {
        const current = fresh.queue.items.find(item => item.visitId === visitId);
        const missingOwnAssignment = current?.claimOwnerId === actorId;
        if (!missingOwnAssignment) pendingClaim.current = null;
        needsReadback.current = missingOwnAssignment; setRefreshRequired(missingOwnAssignment);
        setErrors(previous => ({ ...previous, claim: missingOwnAssignment ? 'Ownership appears saved, but your assignment could not be verified. Refresh before taking more work.' : current?.claimOwnerId && current.claimOwnerId !== actorId ? 'This job was taken by ' + (current.claimOwner || 'another IT technician') + '. It is no longer available.' : failure || 'Taking this job could not be verified. Review the refreshed queue before trying again.' }));
      } else {
        needsReadback.current = true; setRefreshRequired(true);
        setErrors(previous => ({ ...previous, claim: 'The claim could not be verified. Refresh the queue and your assignments before taking another job.' }));
      }
    } finally { claimRunning.current = false; if (mounted.current) setClaiming(''); }
  };
  const open = async (visitId: string) => {
    if (claimRunning.current || refreshRunning.current || loading || opening) return;
    const snapshot = sequence.current;
    const request = ++detailSequence.current;
    setOpening(true); setErrors(current => ({ ...current, detail: '' }));
    try {
      const record = productionVisit((await api.get('/api/tech/visits/' + visitId)).data, visitId);
      if (request === detailSequence.current && snapshot === sequence.current) setDetail(record);
    } catch (cause) {
      if (request === detailSequence.current) {
        const status = (cause as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 403) { identityRef.current = ''; setSession(null); setDay(null); setTasks(null); setSharedQueue(null); setDetail(null); setClaimNotice(''); }
        setErrors(current => ({ ...current, detail: message(cause) }));
      }
    }
    finally { if (request === detailSequence.current) setOpening(false); }
  };
  return <main className='production-assignment-view operations-shell' aria-label='Your Operations assignments'>
    <header className='panelhead'><div><small>CAMERAS ONSITE · OPERATIONS</small><h1>{session?.name || 'Your'} assignments</h1><p>{session?.department ? String(session.department).toUpperCase() + ' · ' : ''}Separate Operations queue</p></div><button className='secondary' onClick={() => openLegacy('production-return')}>Return to Tech Check</button></header>
    <section className='panel module'><p>These are your assignments and tasks in the Operations system of record. Your existing Tech Check assignments remain in their current workspace. Opening this view does not copy assignments or mark work complete.</p><button disabled={loading || opening || Boolean(claiming)} onClick={() => void refresh(true)}>{loading ? 'Refreshing…' : 'Refresh assignments'}</button></section>
    {Object.entries(errors).filter(([,value]) => value).map(([key,value]) => <div className='operations-error' role='alert' key={key}>{value}{!['session','claim'].includes(key) && <p>Any displayed records are from the last successful load.</p>}</div>)}
    {loading && !day && !session && <p role='status'>Verifying your Operations identity…</p>}
    {claimNotice && <p role='status'>{claimNotice}</p>}
    {session?.authorized && <>
      {session.department === 'it' && <section className='panel module' aria-label='Shared IT queue'>
        <div className='panelhead'><div><h2>Shared IT queue</h2><p>IT work sent to this queue is visible to every IT technician. Take a job to add it to your assignments.</p></div><span>{sharedQueue ? sharedQueue.items.filter(item => item.claimable).length + ' available' : 'Unavailable'}</span></div>
        {refreshRequired && <p role='alert'>Refresh assignments to verify the previous claim before taking more work.</p>}
        {!sharedQueue ? <p role='status'>{errors.queue ? 'Shared queue unavailable. Refresh to retry.' : 'Loading shared IT queue…'}</p> : sharedQueue.items.length === 0 ? <p>No work waiting in the shared IT queue.</p> : <div className='records'>{sharedQueue.items.map(item => <article className='record op-record' key={item.visitId}>
          <div><strong>{item.jobNumber} · {item.customer}</strong><small>{item.site} · {queueStatus(item.visitType)} · {queueTime(item.scheduledStart)}</small>{item.setupNeeded && <p><strong>Setup needed</strong> · {item.readinessNote || 'Ownership can be taken now. Finish physical-unit and Tech Check setup before work starts.'}</p>}<p>{item.queueStatus === 'claimed' ? item.claimOwnerId === sharedQueue.actorId ? day && confirmedItClaim(sharedQueue, day, item.visitId, sharedQueue.actorId) ? 'Taken by you · see Assigned jobs' : 'Ownership recorded · assignment verification pending' : 'Taken by ' + (item.claimOwner || 'another IT technician') : item.claimable ? 'Ready for an IT technician' : 'Currently unavailable'}</p></div>
          <button type='button' disabled={!item.claimable || item.queueStatus !== 'ready' || loading || opening || Boolean(claiming) || refreshRequired} onClick={() => void claim(item.visitId)}>{claiming === item.visitId ? 'Taking job…' : item.queueStatus === 'claimed' ? 'Already taken' : 'Take job'}</button>
        </article>)}</div>}
      </section>}
      <section className='panel module' aria-label='Operations job assignments'><div className='panelhead'><h2>Assigned jobs</h2><span>{day ? day.visits.length + ' visits' : 'Unavailable'}</span></div>
        {!day ? <p role='status'>{errors.day ? 'Assignment records unavailable.' : 'Loading assignments…'}</p> : day.visits.length === 0 ? <p>No assigned Operations visits.</p> : <div className='records'>{day.visits.map(visit => <button type='button' disabled={opening || loading || Boolean(claiming)} className='record op-record' key={visit.visit_id} onClick={() => void open(visit.visit_id)}><div><strong>{visit.job_number} · {visit.customer_name}</strong><small>{visit.site_name} · {queueStatus(visit.visit_type)} · {queueTime(visit.scheduled_start || visit.scheduled_start_at || visit.scheduled_start_local)}</small></div><em>{queueStatus(visit.dispatch_status || visit.status)}</em></button>)}</div>}
      </section>
      <section className='panel module' aria-label='Operations owner tasks'><div className='panelhead'><h2>Owner Tasks</h2><span>{tasks ? tasks.length + ' tasks' : 'Unavailable'}</span></div>{!tasks ? <p role='status'>{errors.tasks ? 'Task records unavailable.' : 'Loading tasks…'}</p> : tasks.length === 0 ? <p>No assigned Operations tasks.</p> : <div className='records'>{tasks.map(task => <article className='record' key={task.id}><div><strong>{task.title}</strong><small>{String(task.priority || '').toUpperCase()} · {task.dueAt || task.due_at ? 'Due ' + queueTime(task.dueAt || task.due_at) : 'No due date'}</small><p>{task.instructions}</p></div><em>{queueStatus(task.status)}</em></article>)}</div>}</section>
      {detail && <section className='panel module operations-job-detail' aria-label='Assigned visit details'><div className='panelhead'><h2>{detail.job.job_number || detail.job.title || detail.visit.visit_number}</h2><button className='secondary' onClick={() => { detailSequence.current++; setDetail(null); }}>Close visit details</button></div><dl>{[['Customer',detail.job.customer_name],['Site',detail.site?.name || detail.job.site_name],['Address',[detail.site?.address_line1,detail.site?.city,detail.site?.state_region,detail.site?.postal_code].filter(Boolean).join(', ')],['Visit',queueStatus(detail.visit.visit_type)],['Dispatch',queueStatus(detail.visit.dispatch_status)],['Workflow',detail.pendingWorkflow ? 'NOT STARTED · SETUP PENDING' : queueStatus(detail.execution?.status)],['MHelpDesk',detail.job.mhelpdesk_reference],['Instructions',detail.visit.instructions || detail.job.instructions || detail.job.description]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>{detail.current_step?.title && <p>Current Operations command: <strong>{detail.current_step.title}</strong></p>}{detail.pendingWorkflow && <div className='operations-error' role='status'><strong>Assigned · Tech Check setup pending</strong><p>{['dispatched','accepted'].includes(String(detail.visit.dispatch_status)) ? 'Operations must finish Tech Check setup before work can start.' : 'Not dispatched. Operations must finish any required physical-unit setup and dispatch this visit before work can start.'}</p><p>Your assignment is saved. No work has been started or marked complete.</p></div>}<p>This view displays assigned records. Native Operations workflow completion remains in the existing AppDeploy application.</p><a className='operations-reference-link' href='https://cos-operations-platform-preview-wpbf1y.v2.appdeploy.ai/' target='_blank' rel='noopener noreferrer'>Open Operations workflow ↗</a></section>}
    </>}
  </main>;
}

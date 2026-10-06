import { useCallback, useEffect, useRef, useState } from 'react';
import { api, openLegacy } from './api';
import { productionDay, productionTasks, productionVisit, queueStatus, queueTime } from './productionQueueData';
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
  const sequence = useRef(0), detailSequence = useRef(0), refreshRunning = useRef(false);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    refreshRunning.current = true;
    detailSequence.current++; setDetail(null); setOpening(false);
    setLoading(true);
    try {
      const identity = (await api.get('/api/tech/session')).data;
      if (request !== sequence.current) return;
      if (!identity || identity.legacyTechnician !== true || typeof identity.authorized !== 'boolean')
        throw new Error('Your technician identity could not be verified.');
      setSession(identity);
      if (!identity.authorized) { setDay(null); setTasks(null); setErrors({ session: identity.reason || 'This technician is not linked to Operations.' }); return; }
      const responses = await Promise.allSettled([api.get('/api/tech/assignments'), api.get('/api/tech/tasks')]);
      if (request !== sequence.current) return;
      const next: Record<string, string> = {};
      responses.forEach((response, index) => {
        const key = index ? 'tasks' : 'day';
        try {
          if (response.status === 'rejected') throw response.reason;
          if (index) setTasks(productionTasks(response.value.data));
          else setDay(productionDay(response.value.data));
        } catch (cause) { next[key] = message(cause); }
      });
      setErrors(next);
    } catch (cause) { if (request === sequence.current) { setSession(null); setDay(null); setTasks(null); setErrors({ session: message(cause) }); } }
    finally { if (request === sequence.current) { refreshRunning.current = false; setLoading(false); } }
  }, []);
  useEffect(() => { void refresh(); return () => { sequence.current++; detailSequence.current++; }; }, [refresh]);
  const open = async (visitId: string) => {
    if (refreshRunning.current || loading || opening) return;
    const snapshot = sequence.current;
    const request = ++detailSequence.current;
    setOpening(true); setErrors(current => ({ ...current, detail: '' }));
    try {
      const record = productionVisit((await api.get('/api/tech/visits/' + visitId)).data, visitId);
      if (request === detailSequence.current && snapshot === sequence.current) setDetail(record);
    } catch (cause) { if (request === detailSequence.current) setErrors(current => ({ ...current, detail: message(cause) })); }
    finally { if (request === detailSequence.current) setOpening(false); }
  };
  return <main className='production-assignment-view operations-shell' aria-label='Your Operations assignments'>
    <header className='panelhead'><div><small>CAMERAS ONSITE · OPERATIONS</small><h1>{session?.name || 'Your'} assignments</h1><p>{session?.department ? String(session.department).toUpperCase() + ' · ' : ''}Separate Operations queue</p></div><button className='secondary' onClick={() => openLegacy('production-return')}>Return to Tech Check</button></header>
    <section className='panel module'><p>These are your assignments and tasks in the Operations system of record. Your existing Tech Check assignments remain in their current workspace. Opening this view does not copy assignments or mark work complete.</p><button disabled={loading || opening} onClick={() => void refresh()}>{loading ? 'Refreshing…' : 'Refresh assignments'}</button></section>
    {Object.entries(errors).filter(([,value]) => value).map(([key,value]) => <div className='operations-error' role='alert' key={key}>{value}{key !== 'session' && <p>Any displayed records are from the last successful load.</p>}</div>)}
    {loading && !day && !session && <p role='status'>Verifying your Operations identity…</p>}
    {session?.authorized && <>
      <section className='panel module' aria-label='Operations job assignments'><div className='panelhead'><h2>Assigned jobs</h2><span>{day ? day.visits.length + ' visits' : 'Unavailable'}</span></div>
        {!day ? <p role='status'>{errors.day ? 'Assignment records unavailable.' : 'Loading assignments…'}</p> : day.visits.length === 0 ? <p>No assigned Operations visits.</p> : <div className='records'>{day.visits.map(visit => <button type='button' disabled={opening || loading} className='record op-record' key={visit.visit_id} onClick={() => void open(visit.visit_id)}><div><strong>{visit.job_number} · {visit.customer_name}</strong><small>{visit.site_name} · {queueStatus(visit.visit_type)} · {queueTime(visit.scheduled_start || visit.scheduled_start_at || visit.scheduled_start_local)}</small></div><em>{queueStatus(visit.dispatch_status || visit.status)}</em></button>)}</div>}
      </section>
      <section className='panel module' aria-label='Operations owner tasks'><div className='panelhead'><h2>Owner Tasks</h2><span>{tasks ? tasks.length + ' tasks' : 'Unavailable'}</span></div>{!tasks ? <p role='status'>{errors.tasks ? 'Task records unavailable.' : 'Loading tasks…'}</p> : tasks.length === 0 ? <p>No assigned Operations tasks.</p> : <div className='records'>{tasks.map(task => <article className='record' key={task.id}><div><strong>{task.title}</strong><small>{String(task.priority || '').toUpperCase()} · {task.dueAt || task.due_at ? 'Due ' + queueTime(task.dueAt || task.due_at) : 'No due date'}</small><p>{task.instructions}</p></div><em>{queueStatus(task.status)}</em></article>)}</div>}</section>
      {detail && <section className='panel module operations-job-detail' aria-label='Assigned visit details'><div className='panelhead'><h2>{detail.job.job_number || detail.job.title || detail.visit.visit_number}</h2><button className='secondary' onClick={() => { detailSequence.current++; setDetail(null); }}>Close visit details</button></div><dl>{[['Customer',detail.job.customer_name],['Site',detail.site?.name || detail.job.site_name],['Address',[detail.site?.address_line1,detail.site?.city,detail.site?.state_region,detail.site?.postal_code].filter(Boolean).join(', ')],['Visit',queueStatus(detail.visit.visit_type)],['Dispatch',queueStatus(detail.visit.dispatch_status)],['Workflow',detail.pendingWorkflow ? 'NOT STARTED · SETUP PENDING' : queueStatus(detail.execution?.status)],['MHelpDesk',detail.job.mhelpdesk_reference],['Instructions',detail.visit.instructions || detail.job.instructions || detail.job.description]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>{detail.current_step?.title && <p>Current Operations command: <strong>{detail.current_step.title}</strong></p>}{detail.pendingWorkflow && <div className='operations-error' role='status'><strong>Assigned · Tech Check setup pending</strong><p>{['dispatched','accepted'].includes(String(detail.visit.dispatch_status)) ? 'Operations must finish Tech Check setup before work can start.' : 'Not dispatched. Operations must finish any required physical-unit setup and dispatch this visit before work can start.'}</p><p>Your assignment is saved. No work has been started or marked complete.</p></div>}<p>This view displays assigned records. Native Operations workflow completion remains in the existing AppDeploy application.</p><a className='operations-reference-link' href='https://cos-operations-platform-preview-wpbf1y.v2.appdeploy.ai/' target='_blank' rel='noopener noreferrer'>Open Operations workflow ↗</a></section>}
    </>}
  </main>;
}

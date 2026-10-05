import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { RouterOverview } from './RouterWorkspace';
import { dashboardSources, loadTodayDashboard, summarizeTodayDashboard, type DashboardData } from './todayDashboardData';

type Props = { setActive: (workspace: string) => void; vision?: boolean };
const metric = (count: number | null) => count === null ? '—' : count;
const text = (value: unknown) => value == null ? '' : String(value);

export default function LiveTodayDashboard({ setActive, vision = false }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const revision = useRef(0);
  const refresh = async () => {
    const request = ++revision.current;
    setLoading(true);
    const next = await loadTodayDashboard(api);
    if (request !== revision.current) return;
    setData(next);
    setLoading(false);
  };
  useEffect(() => {
    void refresh();
    return () => { revision.current += 1; };
  }, []);
  if (!data) return <div className='loading' role='status'>Loading owner operations…</div>;
  const summary = summarizeTodayDashboard(data);
  const failed = dashboardSources.filter(([key]) => Boolean(data.errors[key]));
  const complete = failed.length === 0;
  const groups = [
    { title: 'AP Match Exceptions', count: summary.apExceptions.length, message: 'Purchasing packets require review before payment.', workspace: 'Purchasing' },
    { title: 'Purchase Requests', count: summary.poApprovals.length, message: 'Waiting for Owner PO approval.', workspace: 'Purchasing' },
    { title: 'Job Issues', count: summary.jobIssues.length, message: 'These jobs are flagged for Owner attention. Review their details.', workspace: 'Needs Attention' },
    { title: 'Operational Reviews', count: summary.ownerJobs.length, message: 'Completed field work is waiting for Owner closeout.', workspace: 'Owner Review' },
    { title: 'Quote Approvals', count: summary.quoteApprovals.length, message: 'Sales quotes are waiting for Owner decision.', workspace: 'Quotes' },
    { title: 'Invoice Approvals', count: summary.invoiceApprovals.length, message: 'Customer invoices are waiting for Owner approval.', workspace: 'Invoices' },
  ];
  if (vision) return <div className='vision-today' aria-busy={loading}>
    <h1>Today</h1><p>The decisions that need you next</p>
    <button disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing…' : 'Refresh Today'}</button>
    {failed.length > 0 && <section className='operations-error' role='alert'><h2>Some information is unavailable</h2><p>Missing information is not zero. Available work is shown below.</p>{failed.map(([key]) => <p key={key}>{data.errors[key]}</p>)}</section>}
    <RouterOverview openWorkspace={setActive}/>
    <section className='panel vision-decisions'><h2>Needs your decision</h2>
      {summary.unscheduled !== null && summary.unscheduled > 0 && <article><h3>{summary.unscheduled} {summary.unscheduled === 1 ? 'job' : 'jobs'} ready to schedule</h3><p>Choose a technician and visit window.</p><button onClick={() => setActive('Unscheduled')}>Schedule visits</button></article>}
      {groups.filter(group => group.count > 0).map(group => <article key={group.title}><h3>{group.title} · {group.count}</h3><p>{group.message}</p><button onClick={() => setActive(group.workspace)}>Review {group.title.toLowerCase()}</button></article>)}
      {summary.attention === 0 && summary.unscheduled === 0 && <p>No scheduling or review items in the loaded sources.</p>}
      {!complete && <p>Some decisions may be missing until all sources load.</p>}
    </section>
    <div className='purchase-actions'><button onClick={() => setActive('Calendar')}>View schedule</button><button onClick={() => setActive('Owner Tasks')}>Owner tasks{summary.openTasks === null ? '' : ' · ' + summary.openTasks}</button><button onClick={() => setActive('Daily Board')}>Daily board</button></div>
  </div>;
  return <div className='owner-command-home' aria-busy={loading}>
    <div className='purchase-actions'>
      <span>{loading ? 'Refreshing dashboard. Values below are from the previous response.' : complete ? 'Dashboard sources loaded.' : 'Dashboard partially unavailable. Missing values are not zero.'}</span>
      <button disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing…' : complete ? 'Refresh Today' : 'Retry dashboard'}</button>
    </div>
    {failed.length > 0 && <section className='panel' role='alert' aria-label='Dashboard data unavailable'>
      <div className='panelhead'><h2>Some dashboard information is unavailable</h2></div>
      <p>Available sections remain visible. A dash means unverified information, not no work.</p>
      {failed.map(([key]) => <p key={key}>{data.errors[key]}</p>)}
      <button className='secondary' onClick={() => setActive('Daily Board')}>Open Daily Board</button>
    </section>}
    <section className='stats'>
      <article><span>OWNER TASKS</span><b>{metric(summary.openTasks)}</b><i>{summary.openTasks === null ? 'Unavailable' : summary.highPriorityTasks + ' high priority'}</i><button onClick={() => setActive('Owner Tasks')}>MANAGE TASKS</button></article>
      <article><span>ACTIVE JOBS</span><b>{metric(summary.activeJobs)}</b><i>{summary.activeJobs === null ? 'Unavailable' : 'Scheduled + assigned + field'}</i></article>
      <article><span>IN FIELD</span><b>{metric(summary.inField)}</b><i>{summary.inField === null ? 'Unavailable' : 'Dispatched + field work'}</i></article>
      <article><span>UNSCHEDULED</span><b>{metric(summary.unscheduled)}</b><i>{summary.unscheduled === null ? 'Unavailable' : 'Ready to schedule'}</i></article>
      <article><span>NEEDS ATTENTION</span><b>{metric(summary.attention)}</b><i>{summary.attention === null ? 'Review total unverified' : 'Owner + financial review items'}</i></article>
    </section>
    <RouterOverview openWorkspace={setActive}/>
    <section className='grid'>
      <article className='panel'>
        <div className='panelhead'><h2>Operational Timeline</h2><span>{data.jobs === null ? 'Unavailable' : loading ? 'Refreshing' : 'Live jobs'}</span></div>
        {data.jobs === null ? <div className='loading'>Jobs could not be loaded. Retry before relying on this view.</div>
          : summary.timeline.length ? summary.timeline.map((job, index) => <div className='job' key={text(job.id || job.jobNumber) + ':' + index}>
            <b>{text(job.scheduled) || 'Not scheduled'}</b>
            <div><strong>{text(job.jobNumber)} · {text(job.customer)}</strong><small>{text(job.site)} · {text(job.stage || job.status)}</small></div>
            <em>{text(job.status)}</em>
          </div>) : <div className='loading'>No active jobs in the loaded records.</div>}
      </article>
      <article className='panel attention'>
        <div className='panelhead'><h2>Needs Attention</h2><span>{summary.attention === null ? 'Total unverified' : summary.attention + ' review items'}</span></div>
        {groups.filter(group => group.count > 0).map(group => <div className='alert' key={group.title}>
          <b>{group.title} · {group.count}</b><p>{group.message}</p>
          <button onClick={() => setActive(group.workspace)}>Review {group.workspace}</button>
        </div>)}
        {summary.attention === null && <div className='loading'>Some review sources did not load. Additional work may need attention.</div>}
        {summary.attention === 0 && <div className='loading'>Nothing currently needs Owner attention in the loaded review sources.</div>}
      </article>
    </section>
  </div>;
}

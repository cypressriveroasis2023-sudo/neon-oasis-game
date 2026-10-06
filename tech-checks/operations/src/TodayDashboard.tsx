import { useEffect, useRef, useState } from 'react';
import WorkspaceOverview from './WorkspaceOverview';
import { api } from './api';
import { RouterOverview } from './RouterWorkspace';
import { dashboardSources, loadTodayDashboard, summarizeTodayDashboard, type DashboardData } from './todayDashboardData';

type Props = { setActive: (workspace: string) => void; openJob?: (id:string)=>void; openUnit?: (unit:number)=>void; selectedJobId?:string; detailOpen?:boolean; selectJob?:(id:string)=>void; backToJobs?:()=>void };
const metric = (count: number | null) => count === null ? '—' : count;

export default function LiveTodayDashboard({ setActive, openJob, openUnit, selectedJobId, detailOpen, selectJob, backToJobs }: Props) {
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
  return <div className={'owner-command-home'+(detailOpen?' overview-detail-open':'')} aria-busy={loading}>
    <div className='purchase-actions'>
      <span>{loading ? 'Refreshing dashboard. Values below are from the previous response.' : complete ? 'Dashboard sources loaded.' : 'Dashboard partially unavailable. Missing values are not zero.'}</span>
      <button disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing…' : complete ? 'Refresh Overview' : 'Retry dashboard'}</button>
    </div>
    {failed.length > 0 && <section className='panel' role='alert' aria-label='Dashboard data unavailable'>
      <div className='panelhead'><h2>Some dashboard information is unavailable</h2></div>
      <p>Available sections remain visible. A dash means unverified information, not no work.</p>
      {failed.map(([key]) => <p key={key}>{data.errors[key]}</p>)}
      <button className='secondary' onClick={() => setActive('Daily Board')}>Open Dispatch Board</button>
    </section>}
    <WorkspaceOverview jobs={data.jobs} openWorkspace={setActive} openJob={openJob} openUnit={openUnit} selectedJobId={selectedJobId} detailOpen={detailOpen} selectJob={selectJob} backToJobs={backToJobs}/>
    <section className='stats'>
      <article><span>OWNER TASKS</span><b>{metric(summary.openTasks)}</b><i>{summary.openTasks === null ? 'Unavailable' : summary.highPriorityTasks + ' high priority'}</i><button onClick={() => setActive('Owner Tasks')}>MANAGE TASKS</button></article>
      <article><span>ACTIVE JOBS</span><b>{metric(summary.activeJobs)}</b><i>{summary.activeJobs === null ? 'Unavailable' : 'Scheduled + assigned + field'}</i></article>
      <article><span>IN FIELD</span><b>{metric(summary.inField)}</b><i>{summary.inField === null ? 'Unavailable' : 'Dispatched + field work'}</i></article>
      <article><span>UNSCHEDULED</span><b>{metric(summary.unscheduled)}</b><i>{summary.unscheduled === null ? 'Unavailable' : 'Ready to schedule'}</i></article>
      <article><span>NEEDS ATTENTION</span><b>{metric(summary.attention)}</b><i>{summary.attention === null ? 'Review total unverified' : 'Owner + financial review items'}</i></article>
    </section>
    <RouterOverview openWorkspace={setActive}/>
    <section className='grid'>
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

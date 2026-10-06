import { useEffect, useRef, useState } from 'react';
import WorkspaceOverview from './WorkspaceOverview';
import CompanyOverview from './CompanyOverview';
import { api } from './api';
import { dashboardSources, loadCompanyEquipment, loadTodayDashboard, type CompanyEquipmentData, type DashboardData } from './todayDashboardData';
import type { CompanyStageId } from './companyLifecycle';

type Props = { setActive: (workspace: string) => void; openJob?: (id:string, workspace?:'Jobs'|'Unscheduled'|'Owner Review'|'Dispatch')=>void; openUnit?: (unit:number)=>void; selectedJobId?:string; detailOpen?:boolean; selectJob?:(id:string)=>void; backToJobs?:()=>void };

export default function LiveTodayDashboard({ setActive, openJob, openUnit, selectedJobId, detailOpen, selectJob, backToJobs }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [equipment, setEquipment] = useState<CompanyEquipmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<CompanyStageId | null>(null);
  const revision = useRef(0), running = useRef(false);
  const jobsSection = useRef<HTMLDivElement>(null);
  const refresh = async () => {
    if (running.current) return;
    running.current = true;
    const request = ++revision.current;
    setLoading(true);
    const [next, health] = await Promise.all([loadTodayDashboard(api), loadCompanyEquipment(api)]);
    if (request !== revision.current) return;
    setData(next);
    setEquipment(health);
    running.current = false;
    setLoading(false);
  };
  useEffect(() => {
    void refresh();
    return () => { revision.current += 1; running.current = false; };
  }, []);
  if (!data) return <div className='loading' role='status'>Loading company overview…</div>;
  const failed = dashboardSources.filter(([key]) => Boolean(data.errors[key]));
  const complete = failed.length === 0 && !Object.keys(equipment?.errors || {}).length;
  const browseStage = (stage: CompanyStageId | null) => {
    setStageFilter(stage);
    window.requestAnimationFrame(() => {
      jobsSection.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
      jobsSection.current?.focus({ preventScroll: true });
    });
  };
  return <div className={'owner-command-home company-command-home'+(detailOpen?' overview-detail-open':'')} aria-busy={loading}>
    {!detailOpen && <>
      <CompanyOverview data={data} equipment={equipment} openWorkspace={setActive} openJob={openJob} browseStage={browseStage} stageFilter={stageFilter}/>
      <div className='company-source-status'>
        <span role='status'>{loading ? 'Refreshing overview. Values shown are from the previous response.' : complete ? 'Connected sources loaded. Agreement and signature tracking is not connected.' : 'Overview partially unavailable. Missing values are not zero.'}</span>
        <button type='button' className='secondary' disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing…' : complete ? 'Refresh Overview' : 'Retry dashboard'}</button>
      </div>
      {failed.length > 0 && <section className='company-source-error' role='alert' aria-label='Dashboard data unavailable'>
        <h2>Some dashboard information is unavailable</h2>
        <p>Available sections remain visible. A dash means unverified information, not no work.</p>
        {failed.map(([key]) => <p key={key}>{data.errors[key]}</p>)}
        <button className='secondary' onClick={() => setActive('Daily Board')}>Open Dispatch Board</button>
      </section>}
    </>}
    <div className='company-jobs-section' ref={jobsSection} tabIndex={-1}>
      {!detailOpen && stageFilter && <div className='company-job-filter'><span>Showing jobs for the selected stage</span><button className='secondary' onClick={() => setStageFilter(null)}>Show all active jobs</button></div>}
      <WorkspaceOverview jobs={data.jobs} openWorkspace={setActive} openJob={openJob} openUnit={openUnit} selectedJobId={selectedJobId} detailOpen={detailOpen} selectJob={selectJob} backToJobs={backToJobs} stageFilter={stageFilter}/>
    </div>
  </div>;
}

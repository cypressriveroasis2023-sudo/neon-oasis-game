import { useEffect, useRef, useState } from 'react';
import type { DashboardRow } from './todayDashboardData';
import { ownerJobSelection } from './ownerJobSelection';
import { COMPANY_STAGES, deriveJobLifecycle, type CompanyStageId } from './companyLifecycle';
import JobLifecycle, { type OpenLifecycleJob } from './JobLifecycle';
import './jobLifecycle.css';

type Props = {
  jobs: DashboardRow[] | null;
  openWorkspace: (name: string) => void;
  openJob?: OpenLifecycleJob;
  openUnit?: (unit: number) => void;
  selectedJobId?: string;
  detailOpen?: boolean;
  selectJob?: (id: string) => void;
  backToJobs?: () => void;
  stageFilter?: CompanyStageId | null;
};
const value = (input: unknown, fallback: string) => typeof input === 'string' && input.trim() ? input : fallback;

/** Exact selected identity is shared by detail and actions; stale links never retarget. */
export default function WorkspaceOverview({ jobs, openWorkspace, openJob, selectedJobId = '', detailOpen = false, selectJob, backToJobs, stageFilter = null }: Props) {
  const [requested, setRequested] = useState('');
  const [localDetail, setLocalDetail] = useState(false);
  const [search, setSearch] = useState('');
  useEffect(() => setSearch(''), [stageFilter]);
  const requestedId = selectJob ? selectedJobId : requested;
  const showingDetail = selectJob ? detailOpen : localDetail;
  const { options, selected } = ownerJobSelection(jobs || [], requestedId);
  const job = selected;
  const query = search.trim().toLowerCase();
  const visible = options.filter(item => (!stageFilter || deriveJobLifecycle(item).currentStageId === stageFilter) && [item.jobNumber, item.customer, item.site, item.jobType, item.technician, item.equipment, item.equipmentUnitTag, item.status].some(field => String(field || '').toLowerCase().includes(query)));
  const stageLabel = COMPANY_STAGES.find(stage => stage.id === stageFilter)?.label;
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const heading = useRef<HTMLHeadingElement>(null);
  const previousDetail = useRef(false);
  useEffect(() => {
    if (showingDetail) heading.current?.focus({ preventScroll: true });
    else if (previousDetail.current && requestedId) {
      const button = buttons.current.get(requestedId);
      button?.focus({ preventScroll: true });
      button?.scrollIntoView({ block: 'center' });
    }
    previousDetail.current = showingDetail;
  }, [showingDetail, requestedId, job?.id]);
  const back = () => { if (backToJobs) backToJobs(); else setLocalDetail(false); };
  return <section className='workspace-overview company-job-flow' aria-label='Daily workspace' data-detail-open={showingDetail ? 'true' : 'false'}>
    <div className='workspace-work' hidden={showingDetail}>
      <header className='company-flow-heading'><div><p>CONNECTED WORK</p><h2>Job flow</h2></div><span>{jobs === null ? 'Records unavailable' : options.length + ' active jobs'}</span></header>
      <label className='workspace-search'>Find an active job<input type='search' value={search} onChange={event => setSearch(event.target.value)} placeholder='Job, customer, site, unit or technician' /></label>
      <div className='company-flow-list-heading'><h3>Operational Timeline</h3><span>{stageLabel ? 'Showing ' + stageLabel : 'All active stages'}</span></div>
      <div className='workspace-job-list'>
        {jobs === null ? <p role='status'>Jobs could not be loaded. Retry before relying on this view.</p> : options.length === 0 ? <p>No active jobs in the loaded records.</p> : visible.length === 0 ? <p role='status'>{stageFilter && ['quote', 'agreement', 'signed'].includes(stageFilter) ? 'This stage is not connected to the current job snapshot.' : 'No active jobs match this search or stage.'}</p> : visible.map(item => {
          const flow = deriveJobLifecycle(item);
          return <button key={String(item.id)} ref={element => { if (element) buttons.current.set(String(item.id), element); else buttons.current.delete(String(item.id)); }} className={'workspace-job company-flow-row' + (item.id === requestedId ? ' selected' : '')} aria-pressed={item.id === requestedId} onClick={() => { if (selectJob) selectJob(String(item.id)); else { setRequested(String(item.id)); setLocalDetail(true); } }}>
            <span className='company-job-icon' aria-hidden='true'>▤</span><span className='company-job-identity'><strong>{value(item.jobType, 'Job')} · {value(item.jobNumber, 'Number unavailable')}</strong><small>{value(item.customer, 'Customer unavailable')} · {value(item.site, 'Site unavailable')}</small><small>{value(item.equipmentUnitTag, 'Unit not supplied')}</small></span><span className='company-job-stage'><strong>{flow.currentStageLabel}</strong><small>{value(item.status, 'Status unavailable')}</small></span><span className='company-job-team'><strong>{flow.responsibleTeam || 'Team unavailable'}</strong><small>{value(item.technician, 'Assignment unavailable')}</small></span><span aria-hidden='true'>›</span>
          </button>;
        })}
      </div>
      <div className='company-flow-shortcuts'><button onClick={() => openWorkspace('Jobs')}>All job records →</button><button onClick={() => openWorkspace('Daily Board')}>Dispatch Board →</button><button onClick={() => openWorkspace('Calendar')}>Schedule →</button></div>
    </div>
    {showingDetail && <aside className='workspace-detail company-lifecycle-detail' aria-label='Selected job details'>
      <button type='button' className='workspace-back' onClick={back}>← Back to jobs</button>
      {job ? <JobLifecycle job={job} openWorkspace={openWorkspace} openJob={openJob} headingRef={heading} /> : <div className='lifecycle-unavailable'><h2 ref={heading} tabIndex={-1}>{jobs === null ? 'Job details unavailable' : requestedId ? 'Selected job is unavailable' : 'Choose a job'}</h2><p>{jobs === null ? 'Refresh Overview to verify the current jobs.' : requestedId ? 'This job is no longer in the loaded active records. Return to the list to choose a current job.' : 'Return to the job list and select a record.'}</p></div>}
    </aside>}
  </section>;
}

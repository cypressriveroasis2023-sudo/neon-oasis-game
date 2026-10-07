import { DeliveryGoBackSummary } from './DeliveryGoBack';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import type { DashboardRow } from './todayDashboardData';
import { COMPANY_STAGES, deriveJobLifecycle, lifecycleText, type CompanyStageId, type LifecycleFact } from './companyLifecycle';
import JobEvidence from './JobEvidence';
import './jobLifecycle.css';

export type JobWorkspace = 'Jobs' | 'Unscheduled' | 'Owner Review' | 'Dispatch';
export type OpenLifecycleJob = (id: string, workspace?: JobWorkspace) => void;
type Props = { job: DashboardRow; openJob?: OpenLifecycleJob; openWorkspace: (name: string) => void; headingRef?: RefObject<HTMLHeadingElement | null> };
const tabs = ['Stage details', 'Documents', 'Parts', 'Tech Check', 'Billing', 'History'] as const;
type Tab = typeof tabs[number];
const value = (input: unknown, fallback: string) => lifecycleText(input) || fallback;
const rows = (input: unknown): DashboardRow[] => Array.isArray(input) ? input.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
function Facts({ items }: { items: LifecycleFact[] }) {
  return <div className='lifecycle-facts'>{items.map(item => <article key={item.id}><span className='lifecycle-check' aria-hidden='true'>✓</span><div><strong>{item.title}</strong><p>{item.detail}</p></div></article>)}</div>;
}
const stageDescriptions: Record<CompanyStageId, string> = {
  quote: 'A linked quote is shown when the job supplies its quote number. Acceptance and quote contents must be verified in Quotes.',
  agreement: 'Agreement documents are not connected to this job response. An operational job or field signature does not establish that an agreement exists.',
  signed: 'A signed agreement cannot be verified from this job response. Customer or technician field signatures are separate evidence.',
  schedule: 'Keep the current visit, assigned technician and physical unit connected. Parts readiness is not supplied by this response.',
  'it-prep': 'IT preparation and intake follow the actual visit type. Open the established workflow to verify required checks and handoffs.',
  'service-install': 'The current Service visit may be a delivery, service, swap or pickup. Its own workflow controls what must happen next.',
  closeout: 'Owner Review contains saved field evidence and the existing approve or return-for-correction actions.',
  billing: 'Billing readiness is separate from invoice approval, issuance and payment. Review the current financial records before acting.',
};

/** Read-only connected view. All actions stay in the existing authoritative workspaces. */
export default function JobLifecycle({ job, openJob, openWorkspace, headingRef }: Props) {
  const model = deriveJobLifecycle(job);
  const [selectedStage, setSelectedStage] = useState<CompanyStageId | null>(model.currentStageId);
  const [tab, setTab] = useState<Tab>('Stage details');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  useEffect(() => { setSelectedStage(model.currentStageId); setTab('Stage details'); }, [job.id, model.currentStageId]);
  const stage = COMPANY_STAGES.find(item => item.id === selectedStage);
  const current = selectedStage === model.currentStageId;
  const number = stage ? COMPANY_STAGES.findIndex(item => item.id === stage.id) + 1 : null;
  const backendStatus = lifecycleText(job.status).toLowerCase().replaceAll('_', ' ');
  const actionWorkspace: JobWorkspace = backendStatus === 'unscheduled' ? 'Unscheduled' : model.currentStageId === 'closeout' ? 'Owner Review' : ['scheduled', 'assigned'].includes(backendStatus) ? 'Dispatch' : 'Jobs';
  const actionLabel = actionWorkspace === 'Unscheduled' ? 'Schedule this job' : actionWorkspace === 'Owner Review' ? 'Review this job' : actionWorkspace === 'Dispatch' ? 'Open dispatch for this job' : 'Open job & actions';
  const evidence = ['photos', 'signatures', 'techCheckHistory'].some(field => rows(job[field]).length > 0);
  const history = Array.isArray(job.activity) ? job.activity.filter((entry): entry is string => typeof entry === 'string') : null;
  const notes = rows(job.notes);
  return <article className='job-lifecycle' aria-label='Connected job lifecycle'>
    <header className='lifecycle-header'>
      <div><p className='lifecycle-eyebrow'>ONE CONNECTED JOB</p><h2 ref={headingRef} tabIndex={-1}>{value(job.site, value(job.customer, 'Job details'))}</h2><p>{value(job.jobNumber, 'Job number unavailable')} · {value(job.jobType, 'Job type unavailable')} · {value(job.customer, 'Customer unavailable')}</p></div>
      <span className='lifecycle-current-badge'>{model.currentStageLabel}</span>
    </header>
    <DeliveryGoBackSummary job={job}/>
    <div className='lifecycle-mobile-summary'><span>Current view</span><strong>{model.currentStageLabel}</strong><small>Backend: {model.backendStage} · {model.backendStatus}</small></div>
    <div className='lifecycle-layout'>
      <nav className='lifecycle-rail' aria-label='Job lifecycle stages'><p>JOB LIFECYCLE</p><ol>{model.stages.map((item, index) => <li key={item.id} data-current={item.id === model.currentStageId ? 'true' : 'false'}><button type='button' aria-pressed={selectedStage === item.id} onClick={() => { setSelectedStage(item.id); setTab('Stage details'); }}><span className='lifecycle-stage-number'>{index + 1}</span><span><strong>{item.label}</strong><small>{item.detail}</small></span></button></li>)}</ol><small className='lifecycle-rail-note'>Stages are a company view. Each job keeps its existing workflow.</small></nav>
      <section className='lifecycle-card' aria-label='Stage information'>
        <div className='lifecycle-stage-heading'><p className='lifecycle-eyebrow'>{number ? `STAGE ${String(number).padStart(2, '0')} / ${stage!.label.toUpperCase()}` : 'CURRENT WORKFLOW'}</p><h3>{current && selectedStage === 'schedule' ? 'Get the current visit ready' : current ? model.backendStage === 'Unavailable' ? model.currentStageLabel : model.backendStage : stage?.label || 'Verify this job’s stage'}</h3><p>{current ? `Stage coordination: ${model.responsibleTeam || 'Not supplied'}` : 'Stage status is not verified in this response.'}</p><p className='lifecycle-backend-status'>Backend workflow: {model.backendStage} · {model.backendStatus}</p></div>
        <dl className='lifecycle-context'><div><dt>Site</dt><dd>{value(job.site, 'Not supplied')}</dd></div><div><dt>Unit</dt><dd>{value(job.equipmentUnitTag, 'Identity unavailable')}{lifecycleText(job.equipment) && <small>{lifecycleText(job.equipment)}</small>}</dd></div><div><dt>Source request</dt><dd>Not connected<small>No source request in this response</small></dd></div></dl>
        <div className='lifecycle-tabs' role='tablist' aria-label='Job information'>{tabs.map((name, index) => <button key={name} ref={element => { tabRefs.current[index] = element; }} type='button' role='tab' aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} id={id + '-tab-' + index} aria-controls={id + '-panel'} onClick={() => setTab(name)} onKeyDown={event => { const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null; if (next !== null) { event.preventDefault(); setTab(tabs[next]); tabRefs.current[next]?.focus(); } }}>{name}</button>)}</div>
        <div className='lifecycle-tabpanel' id={id + '-panel'} role='tabpanel' aria-labelledby={id + '-tab-' + tabs.indexOf(tab)} tabIndex={0}>
          {tab === 'Stage details' && <>
            {stage && <p className='lifecycle-explanation'>{stageDescriptions[stage.id]}</p>}
            <h4>Confirmed on this job</h4>
            {model.completed.length > 0 ? <Facts items={model.completed} /> : <p className='lifecycle-empty'>No completed or connected items can be verified from this response.</p>}
            {model.missing.length > 0 && <section className='lifecycle-missing' aria-label='Missing items and attention'><span className='lifecycle-amber-label'>NEEDS ATTENTION</span><h4>{model.missing[0].title}</h4><p>{model.missing[0].detail}</p>{model.missing.length > 1 && <ul>{model.missing.slice(1).map(item => <li key={item.id}><strong>{item.title}</strong><span>{item.detail}</span></li>)}</ul>}{openJob && <button className='lifecycle-primary' onClick={() => openJob(String(job.id), actionWorkspace)}>{actionLabel} →</button>}</section>}
            <section className='lifecycle-next'><div><span>STAGE COORDINATION</span><strong>{model.responsibleTeam || 'Verify in job workflow'}</strong><p>{model.nextStep}</p><p>Team shown coordinates this stage; the job workflow determines the next authorized action.</p></div><div><span>AUTHORITATIVE STATUS</span><strong>{model.backendStatus}</strong><p>{model.backendStage}. Later stages remain unverified until their records are available.</p></div></section>
            <details className='lifecycle-unknown'><summary>{model.unavailable.length} details not connected or unavailable</summary><ul>{model.unavailable.map(item => <li key={item.id}><strong>{item.title}</strong><p>{item.detail}</p></li>)}</ul></details>
          </>}
          {tab === 'Documents' && <><h4>Documents connected to this job</h4><div className='lifecycle-info'><strong>{lifecycleText(job.quoteNumber) ? `Linked quote · ${lifecycleText(job.quoteNumber)}` : 'Quote link unavailable'}</strong><p>{lifecycleText(job.quoteNumber) ? 'The job supplies this quote number. The quote document and acceptance status are not included.' : 'No linked quote number is supplied in this response.'}</p><button onClick={() => openWorkspace('Quotes')}>Open Quotes workspace ↗</button></div><div className='lifecycle-info'><strong>Agreement and signed agreement unavailable</strong><p>Agreement documents are not exposed here. A field signature is not proof of a signed agreement.</p></div>{evidence ? <JobEvidence job={job} /> : <p className='lifecycle-empty'>Saved field documents are not included in this jobs response. Open this job in Owner Review when it is awaiting closeout.</p>}</>}
          {tab === 'Parts' && <><h4>Parts for this job</h4><div className='lifecycle-info'><strong>Parts list not connected</strong><p>The job response does not contain parts requirements, ordered quantities or receipt status. Parts readiness cannot be verified here.</p><button onClick={() => openWorkspace('Purchasing')}>Open Purchasing workspace ↗</button></div></>}
          {tab === 'Tech Check' && <><h4>Tech Check and field evidence</h4>{evidence ? <JobEvidence job={job} /> : <div className='lifecycle-info'><strong>Detailed evidence is not supplied here</strong><p>The jobs response does not include full Tech Check history. Empty history or photo fields do not establish that evidence is missing.</p>{model.currentStageId === 'closeout' && openJob ? <button onClick={() => openJob(String(job.id), 'Owner Review')}>View this job in Owner Review →</button> : <button onClick={() => openWorkspace('Tech Check')}>Open Tech Check workspace ↗</button>}</div>}<p className='lifecycle-empty'>Existing IT and Service workflows control required checks, completion and handoffs.</p></>}
          {tab === 'Billing' && <><h4>Billing connected to this job</h4><dl className='lifecycle-data'><div><dt>Backend billing readiness</dt><dd>{job.billingReady === true ? 'Ready for billing' : job.billingReady === false ? 'Not marked ready' : 'Unavailable'}</dd></div><div><dt>Linked invoice</dt><dd>{value(job.invoiceNumber, 'Not supplied')}</dd></div></dl><p>Invoice approval, issuance, balance and payment are not supplied by this job response.</p><button onClick={() => openWorkspace('Billing')}>Open Billing workspace ↗</button></>}
          {tab === 'History' && <><h4>Recorded job history</h4>{history?.length ? <ol className='lifecycle-history'>{history.map((entry, index) => <li key={index}>{entry}</li>)}</ol> : <p className='lifecycle-empty'>No activity entries are supplied in this response. The full audit history may contain additional events.</p>}{notes.length > 0 && <><h4>Job notes</h4><ul className='lifecycle-history'>{notes.map((note, index) => <li key={index}><p>{value(note.text, 'Note text unavailable')}</p><small>{[lifecycleText(note.by), lifecycleText(note.at)].filter(Boolean).join(' · ')}</small></li>)}</ul></>}</>}
        </div>
        <footer className='lifecycle-footer'><p>Read-only company view. Existing workflow checks and permissions remain authoritative.</p>{openJob && actionWorkspace !== 'Jobs' && model.missing.length === 0 && <button className='lifecycle-primary' onClick={() => openJob(String(job.id), actionWorkspace)}>{actionLabel} →</button>}{openJob && <button className='lifecycle-primary' onClick={() => openJob(String(job.id))}>Open job & actions →</button>}</footer>
      </section>
    </div>
  </article>;
}

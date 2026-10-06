import { useState } from 'react';
import { COMPANY_STAGES, companyStageCounts, type CompanyStageId } from './companyLifecycle';
import { summarizeTodayDashboard, type CompanyEquipmentData, type DashboardData, type DashboardRow } from './todayDashboardData';
import './CompanyOverview.css';

type Props = {
  data: DashboardData;
  equipment: CompanyEquipmentData | null;
  openWorkspace: (name: string) => void;
  openJob?: (id: string, workspace?: 'Jobs' | 'Unscheduled' | 'Owner Review' | 'Dispatch') => void;
  browseStage: (stage: CompanyStageId | null) => void;
  stageFilter: CompanyStageId | null;
};
type AttentionItem = { key: string; reference: string; category: string; description: string; action: string; workspace: string; jobId?: string };
const recordText = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value : fallback;
const countLabel = (count: number, singular: string, plural = singular + 's') => count + ' ' + (count === 1 ? singular : plural);

/** Only saved review flags and existing status values create attention items. */
function attentionItems(data: DashboardData): AttentionItem[] {
  const summary = summarizeTodayDashboard(data);
  const items: AttentionItem[] = [];
  const add = (rows: DashboardRow[], category: string, description: string, action: string, workspace: string, job = false) => {
    rows.forEach((row, index) => items.push({
      key: category + ':' + String(row.id || index),
      reference: recordText(row.jobNumber || row.quoteNumber || row.invoiceNumber || row.po || row.poNumber, category),
      category, description, action, workspace,
      jobId: job && typeof row.id === 'string' && row.id.trim() ? row.id : undefined,
    }));
  };
  add(summary.jobIssues, 'Job review', 'Flagged for Owner attention.', 'Review job', 'Needs Attention', true);
  add(summary.ownerJobs, 'Closeout', 'Field work is waiting for Owner closeout.', 'Review closeout', 'Owner Review', true);
  add(summary.quoteApprovals, 'Quote', 'Quote is waiting for Owner approval.', 'Review quote', 'Quotes');
  add(summary.invoiceApprovals, 'Billing', 'Invoice is waiting for Owner approval.', 'Review invoice', 'Invoices');
  add(summary.apExceptions, 'Purchasing', 'Purchasing packet requires review before payment.', 'Review match', 'Purchasing');
  add(summary.poApprovals, 'Purchasing', 'Purchase request is waiting for Owner approval.', 'Review purchase', 'Purchasing');
  return items;
}

export default function CompanyOverview({ data, equipment, openWorkspace, openJob, browseStage, stageFilter }: Props) {
  const [unavailableStage, setUnavailableStage] = useState<CompanyStageId | null>(null);
  const counts = companyStageCounts(data.jobs);
  const summary = summarizeTodayDashboard(data);
  const attention = attentionItems(data);
  const camera = equipment?.camera;
  const cameraAttention = camera ? camera.offline + camera.review : null;
  const cameraMetric = camera ? camera.fieldDevices === 0 ? 'No field devices recorded' : cameraAttention === 0 ? 'No flagged field devices' : countLabel(cameraAttention!, 'field device') + ' need' + (cameraAttention === 1 ? 's' : '') + ' attention' : 'Health unavailable';
  const teams: { label: string; count: number | null; note?: string }[] = [
    { label: 'Sales & agreements', count: null, note: 'Not connected' },
    { label: 'Operations planning', count: counts.schedule },
    { label: 'IT Prep', count: counts['it-prep'] },
    { label: 'Service Install', count: counts['service-install'] },
    { label: 'Owner closeout', count: counts.closeout },
    { label: 'Billing', count: counts.billing },
  ];
  const selectStage = (id: CompanyStageId) => {
    setUnavailableStage(null);
    if (id === 'quote') openWorkspace('Quotes');
    else if (id === 'agreement' || id === 'signed') setUnavailableStage(id);
    else browseStage(id);
  };
  return <section className='company-overview' aria-label='Company overview'>
    <header className='company-overview-heading'>
      <div><h1>Company overview</h1><p><span className='company-overview-date'>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · </span>{data.jobs === null ? 'Job count unavailable' : countLabel(data.jobs.length, 'job record')} · Whole-company view</p></div>
      <div className='company-overview-actions'><button className='company-secondary' onClick={() => { setUnavailableStage(null); browseStage(null); }}>View all jobs</button><button className='company-primary' onClick={() => openWorkspace('Quotes')}>Open quotes <span aria-hidden='true'>→</span></button></div>
    </header>

    <div className='company-health-grid' aria-label='Equipment health'>
      <article className='company-health-card'>
        <h2>Camera Health</h2>
        <strong>{cameraMetric}</strong>
        <p>{camera ? countLabel(camera.fieldDevices, 'field device') + ' · ' + camera.online + ' online' : 'Open Camera Health to review the source'}</p>
        <small className={cameraAttention && cameraAttention > 0 ? 'company-attention-note' : ''}>{camera ? 'Source refreshed ' + new Date(camera.refreshedAt).toLocaleString() : 'SUMMARY NOT VERIFIED'}</small>
        {equipment?.errors.camera && <p className='company-card-error' role='alert'>{equipment.errors.camera}</p>}
        <button onClick={() => openWorkspace('Camera Health')}>Open Camera Health <span aria-hidden='true'>→</span></button>
      </article>
      <article className='company-health-card'>
        <h2>InHand Routers</h2>
        <strong>{equipment?.routers ? countLabel(equipment.routers.items.length, 'stored router record') : 'Router count unavailable'}</strong>
        <p>Live GPS setup pending</p>
        <small>STORED INVENTORY & PORT OBSERVATIONS</small>
        {equipment?.errors.routers && <p className='company-card-error' role='alert'>{equipment.errors.routers}</p>}
        <button onClick={() => openWorkspace('InHand Routers')}>Open router inventory <span aria-hidden='true'>→</span></button>
      </article>
      <article className='company-health-card'>
        <h2>Victron power</h2>
        <strong>Power monitoring</strong>
        <p>Battery and solar readings in Victron VRM</p>
        <small>POWER STATUS NOT AVAILABLE IN THIS VIEW</small>
        <button onClick={() => openWorkspace('Victron VRM')}>Open Victron info <span aria-hidden='true'>→</span></button>
      </article>
    </div>

    <section className='company-flow' aria-labelledby='company-flow-heading'>
      <div className='company-section-heading'><h2 id='company-flow-heading'><span className='company-desktop-label'>Jobs, from quote to billing</span><span className='company-mobile-label'>Job flow</span></h2><span className='company-flow-caption'>THE COMPLETE CUSTOMER JOURNEY</span></div>
      <p className='company-mobile-hint'>Tap a stage to find its work</p>
      <nav className='company-stage-grid' aria-label='Company job lifecycle'>
        {COMPANY_STAGES.map((stage, index) => {
          const count = stage.id === 'quote' ? data.quotes?.length ?? null : counts[stage.id];
          const unsupported = stage.id === 'agreement' || stage.id === 'signed';
          const label = count === null ? unsupported ? 'Not connected' : 'Unavailable' : countLabel(count, stage.id === 'quote' ? 'quote' : 'job');
          return <button key={stage.id} className='company-stage' onClick={() => selectStage(stage.id)} aria-pressed={stageFilter === stage.id || unavailableStage === stage.id} aria-label={stage.label + ': ' + label}>
            <small>{String(index + 1).padStart(2, '0')}</small><strong>{stage.label}</strong>
            <span className={'company-stage-total' + (count === null ? ' company-stage-unknown' : '')}>{count === null ? <span>{label}</span> : <><b>{count}</b><span>{stage.id === 'quote' ? count === 1 ? 'quote' : 'quotes' : count === 1 ? 'job' : 'jobs'}</span></>}<i aria-hidden='true'>→</i></span>
          </button>;
        })}
      </nav>
      {unavailableStage && <div className='company-connection-note' role='status'><strong>{unavailableStage === 'agreement' ? 'Agreement tracking' : 'Signature tracking'} is not connected.</strong><p>This view cannot verify agreements or customer signatures. Review available quote records for context.</p><button onClick={() => openWorkspace('Quotes')}>Open quotes <span aria-hidden='true'>→</span></button></div>}
      <p className='company-data-note'>Quote totals count quote records. Job stages use the current saved workflow; agreement and signature status are not connected.{counts.unknown !== null && counts.unknown > 0 ? ' ' + countLabel(counts.unknown, 'job') + ' cannot yet be classified in these stages.' : ''}</p>
    </section>

    <section className='company-attention-section' aria-labelledby='company-attention-heading'>
      <div className='company-section-heading'><h2 id='company-attention-heading'>What needs attention</h2><span>{summary.attention === null ? 'Total unverified' : countLabel(summary.attention, 'review item')}</span></div>
      <div className='company-attention-layout'>
        <div className='company-attention-list'>
          {attention.slice(0, 6).map(item => <div className='company-attention-row' key={item.key}>
            <div><small>{item.reference} / {item.category}</small><p>{item.description}</p></div>
            <button onClick={() => item.jobId && openJob ? openJob(item.jobId, item.workspace === 'Owner Review' ? 'Owner Review' : 'Jobs') : openWorkspace(item.workspace)}>{item.action} <span aria-hidden='true'>→</span></button>
          </div>)}
          {summary.attention === null && <p className='company-empty-state' role='status'>Some review sources did not load. Additional work may need attention.</p>}
          {summary.attention === 0 && <p className='company-empty-state'>Nothing currently needs Owner attention in the loaded review sources.</p>}
          {attention.length > 6 && <div className='company-attention-more'><span>{countLabel(attention.length - 6, 'additional review item')}</span><button onClick={() => openWorkspace('Needs Attention')}>Open attention workspace <span aria-hidden='true'>→</span></button></div>}
        </div>
        <section className='company-responsibility' aria-label='Stage responsibility'>
          <h3>Stage responsibility</h3><dl>{teams.map(team => <div key={team.label}><dt>{team.label}</dt><dd>{team.count === null ? team.note || 'Unavailable' : countLabel(team.count, 'job')}</dd></div>)}</dl>
          <p>Typical team by current company stage. The job workflow determines the next authorized action.</p>
        </section>
      </div>
    </section>
  </section>;
}

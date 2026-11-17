import {useState} from 'react';
import {emptyGuideRecord, issueGuide, type GuideRecord} from './issueGuide';
import type {TodayAudience, TodayIssue} from './todayIssues';
import {retryAddressMapPin} from './addressMapPinRetry';

/** The fix screen for one issue. Every step that needs a person has its control here. */
export default function IssueGuide({issue, role, address, onRefresh, onLink, onConfirmShop, onOpenMhelp, onEscalate}:{
  issue: TodayIssue;
  role: TodayAudience;
  address?: string;
  onRefresh?: () => void;
  onLink?: () => void;
  onConfirmShop?: () => void;
  onOpenMhelp?: () => void;
  onEscalate?: () => void;
}) {
  const [record, setRecord] = useState<GuideRecord>(emptyGuideRecord);
  const [saved, setSaved] = useState('');
  const steps = issueGuide(issue.kind, role);
  const save = (next: GuideRecord, label: string) => { setRecord(next); setSaved(label); };
  return <section className='cos-issue-guide' aria-label={'Troubleshooting '+issue.unit}>
    <h3>{issue.line}</h3>
    <ol>
      {steps.map((step, index) => <li key={step.id}>
        <p><b>{index + 1}.</b> {step.text}</p>
        {step.control === 'refresh' && <button type='button' onClick={() => onRefresh?.()}>Refresh reading</button>}
        {step.control === 'notes' && <label>Notes<textarea value={record.notes} onChange={event => setRecord({...record, notes: event.target.value})} /></label>}
        {step.control === 'readings' && <div className='cos-issue-readings'>
          <label>Voltage<input inputMode='decimal' value={record.voltage} onChange={event => setRecord({...record, voltage: event.target.value})} /></label>
          <label>Charge<input inputMode='decimal' value={record.charge} onChange={event => setRecord({...record, charge: event.target.value})} /></label>
        </div>}
        {step.control === 'photo' && <label>Photo<input type='file' accept='image/*' onChange={event => setRecord({...record, photoName: event.target.files?.[0]?.name || ''})} /></label>}
        {step.control === 'link' && <button type='button' onClick={() => onLink?.()}>Link camera</button>}
        {step.control === 'confirm-field' && <button type='button' onClick={() => save(record, 'Field confirmed. mHelp was not changed.')}>Confirm Field</button>}
        {step.control === 'confirm-shop' && <button type='button' onClick={() => onConfirmShop?.()}>Confirm Shop</button>}
        {step.control === 'retry-pin' && <button type='button' onClick={() => { if (!address) return; void retryAddressMapPin(address).then(result => save({...record, pin: result.pin ? result.pin.join(', ') : ''}, result.pin ? 'Map pin only. Not written to mHelp.' : 'No pin yet.')); }}>Retry map pin</button>}
        {step.control === 'mhelp' && <button type='button' onClick={() => onOpenMhelp?.()}>Open in mHelpDesk</button>}
        {step.control === 'outcome' && <div className='cos-issue-outcomes'>
          <button type='button' onClick={() => save({...record, outcome: 'resolved'}, 'Recorded: resolved. The board count changes when the next reading agrees.')}>Mark resolved</button>
          <button type='button' onClick={() => save({...record, outcome: 'broken'}, 'Recorded: still broken.')}>Still broken</button>
          <button type='button' onClick={() => { save({...record, outcome: 'escalate'}, 'Recorded: escalate to IT.'); onEscalate?.(); }}>Escalate to IT</button>
        </div>}
      </li>)}
    </ol>
    {record.photoName && <p>Photo: {record.photoName}</p>}
    {record.pin && <p>Pin: {record.pin}</p>}
    {saved && <p role='status'>{saved}</p>}
  </section>;
}

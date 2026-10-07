import type { RefObject } from 'react';
import { hasOpenGoBack, validGoBackDraft, type GoBackDraft } from './deliveryGoBackData';
import type { OperationsRecord } from './operationsWorkflowData';
import './deliveryGoBack.css';

export function DeliveryGoBackSummary({ job }: { job: OperationsRecord }) {
  const saved = job.goBack;
  if (!saved) return null;
  return <section className={'delivery-go-back-summary' + (hasOpenGoBack(job) ? ' is-required' : '')} aria-label='Delivery go-back details'>
    <strong>{hasOpenGoBack(job) ? 'GO-BACK REQUIRED' : 'Go-back visit completed'}</strong>
    <small>{hasOpenGoBack(job) ? 'Delivery visit completed · Ticket remains open until the return visit is finished.' : 'The return visit is complete. Owner Review and billing keep their own required checks.'}</small>
    {saved.reason && <p><b>Reason:</b> {saved.reason}</p>}
    {saved.remainingWork && <p><b>Remaining work:</b> {saved.remainingWork}</p>}
    {saved.partsNeeded && <p><b>Parts needed:</b> {saved.partsNeeded}</p>}
    {saved.returnNotes && <p><b>Return visit notes:</b> {saved.returnNotes}</p>}
    {hasOpenGoBack(job) && <small>{job.scheduled && job.scheduled !== 'Not scheduled' ? 'Return visit: ' + job.scheduled + ' · ' + (job.technician || 'Unassigned') : 'Return date and technician can be assigned in Schedule + Assign.'}</small>}
  </section>;
}

type Props = { job: OperationsRecord; draft: GoBackDraft; setDraft: (draft: GoBackDraft) => void; dialogRef: RefObject<HTMLDialogElement | null>; saving: boolean; disabled: boolean; error: string; refreshRequired: boolean; refresh: () => void; close: () => void; save: () => void };
export function DeliveryGoBackDialog({ job, draft, setDraft, dialogRef, saving, disabled, error, refreshRequired, refresh, close, save }: Props) {
  return <dialog ref={dialogRef} className='schedule-overlay' aria-label='Go-back required' onCancel={event => { if (saving) event.preventDefault(); else close(); }}><section className='schedule-card delivery-go-back-dialog'>
    <div className='schedule-head'><div><small>DELIVERY FOLLOW-UP</small><h2>Go-back required</h2><p>{job.jobNumber} · {job.customer}</p></div><button aria-label='Close go-back' disabled={saving} onClick={close}>×</button></div>
    <div className='schedule-summary'><b>KEEP THIS TICKET OPEN</b><span>The completed delivery and its evidence stay in the history. A new Service return visit will be added to this same ticket.</span><small>Closeout and billing stay blocked until the return is completed. Set the technician and time afterward in Schedule + Assign.</small></div>
    {error && <div className='daily-board-error' role='alert'>{error}{refreshRequired && <button className='secondary' disabled={saving} onClick={refresh}>Refresh jobs</button>}</div>}
    <div className='schedule-form'>
      <label>Reason<span>Add a reason or remaining work before saving.</span><input maxLength={4000} disabled={saving} value={draft.reason} onChange={event => setDraft({ ...draft, reason: event.target.value })} placeholder='For example, installation needs finishing'/></label>
      <label>Remaining work<textarea maxLength={4000} disabled={saving} rows={3} value={draft.remainingWork} onChange={event => setDraft({ ...draft, remainingWork: event.target.value })} placeholder='What needs to be finished on the return?'/></label>
      <label>Parts needed (optional)<textarea maxLength={4000} disabled={saving} rows={2} value={draft.partsNeeded} onChange={event => setDraft({ ...draft, partsNeeded: event.target.value })} placeholder='Parts or supplies to bring'/></label>
      <label>Return visit notes (optional)<textarea maxLength={4000} disabled={saving} rows={2} value={draft.returnNotes} onChange={event => setDraft({ ...draft, returnNotes: event.target.value })} placeholder='Access instructions or details for scheduling'/></label>
    </div>
    <div className='schedule-actions'><button className='secondary' disabled={saving} onClick={close}>CANCEL</button><button disabled={disabled || !validGoBackDraft(draft)} onClick={save}>{saving ? 'SAVING…' : 'SAVE GO-BACK'}</button></div>
  </section></dialog>;
}

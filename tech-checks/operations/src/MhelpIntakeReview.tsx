import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { checkedIntakeReview, intakeReviewAccess, intakeReviewErrors, intakeReviewErrorMessage, intakeReviewHealth, intakeReviewReasons, INTAKE_STATUS_STALE_MS, type IntakeReviewStatus } from './mhelpIntakeReviewModel';
import './mhelpIntakeReview.css';

const formatTime = (value: string | null) => value === null ? 'Not recorded' : new Date(value).toLocaleString('en-US', {
  timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
});
/** Only an explicit saved-status read. No vendor reads, retry execution or intake writes. */
export default function MhelpIntakeReview({ session }: { session: unknown }) {
  const allowed = intakeReviewAccess(session);
  const [status, setStatus] = useState<IntakeReviewStatus | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [checkedAt, setCheckedAt] = useState<number | null>(null), [now, setNow] = useState(Date.now);
  const sequence = useRef(0), pending = useRef(false);
  const clear = useCallback(() => {
    sequence.current++; pending.current = false;
    setStatus(null); setCheckedAt(null); setBusy(false); setError('');
  }, []);
  useEffect(() => {
    clear();
    const hidden = () => { if (document.visibilityState === 'hidden') clear(); };
    const parentHidden = (event: MessageEvent) => {
      if (window.parent !== window && event.origin === location.origin && event.source === window.parent &&
          event.data?.type === 'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE') clear();
    };
    window.addEventListener('pagehide', clear);
    window.addEventListener('message', parentHidden);
    document.addEventListener('visibilitychange', hidden);
    // Re-evaluate age locally. A clock tick never starts a network request.
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => {
      sequence.current++; pending.current = false;
      window.clearInterval(timer); window.removeEventListener('pagehide', clear);
      window.removeEventListener('message', parentHidden); document.removeEventListener('visibilitychange', hidden);
    };
  }, [session, clear]);
  const refresh = async () => {
    if (!allowed || pending.current) return;
    pending.current = true; const request = ++sequence.current;
    setBusy(true); setStatus(null); setCheckedAt(null); setError('');
    try {
      const result = checkedIntakeReview((await api.get('/api/mhelpdesk/intake/status')).data);
      if (request !== sequence.current) return;
      const readAt = Date.now(); setStatus(result); setCheckedAt(readAt); setNow(readAt);
    } catch (cause) {
      if (request === sequence.current) { setStatus(null); setCheckedAt(null); setError(intakeReviewErrorMessage(cause)); }
    } finally { if (request === sequence.current) { pending.current = false; setBusy(false); } }
  };
  if (!allowed) return null;
  const health = status ? intakeReviewHealth(status, now) : null;
  const oldRead = checkedAt !== null && now - checkedAt > INTAKE_STATUS_STALE_MS;
  return <section className='unit-tracker-connection mhelp-intake-review' aria-label='mHelpDesk automatic intake status' aria-busy={busy}>
    <h3>Automatic ticket intake</h3>
    <p>Saved COS status for new Service, Install, Swap and Pickup tickets. Unknown mappings are held for review; existing technician changes are preserved.</p>
    <button type='button' className='secondary' disabled={busy} onClick={() => void refresh()}>{busy ? 'Checking saved intake status…' : 'Refresh intake status'}</button>
    <p className='mhelp-intake-read-note'>Refresh reads saved status only. It does not contact mHelpDesk or start an intake run.</p>
    {error && <p className='operations-error' role='alert'>{error}</p>}
    {!status && !error && <p role='status'>{busy ? 'Checking saved intake status. Current state is unknown.' : 'Intake state unknown. Refresh to verify whether intake is enabled.'}</p>}
    {status && <>
      <p role='status'><strong>{status.enabled ? status.activationAt !== null && Date.parse(status.activationAt) <= now ? 'Active configuration · enabled' : 'Enabled configuration · activation unverified' : 'Disabled'}</strong> · {health?.text}</p>
      {oldRead && <p className='mhelp-intake-warning'>This status was read more than 15 minutes ago. Refresh to verify the current configuration and counts.</p>}
      <dl className='unit-tracker-values'>
        <div><dt>Activation date (UTC)</dt><dd>{formatTime(status.activationAt)}</dd></div>
        <div><dt>Last completed source scan (UTC)</dt><dd>{formatTime(status.lastSuccessAt)}</dd></div>
        <div><dt>Last poll attempt (UTC)</dt><dd>{formatTime(status.lastAttemptAt)}</dd></div>
        <div><dt>Next eligible poll (UTC)</dt><dd>{status.retryAfter === null ? 'No backoff recorded' : formatTime(status.retryAfter)}</dd></div>
        <div><dt>Consecutive failures</dt><dd>{status.failureCount}</dd></div>
        <div><dt>Last poll error</dt><dd>{status.lastErrorCode === null ? 'None recorded' : <>{intakeReviewErrors[status.lastErrorCode]}<small>{status.lastErrorCode}</small></>}</dd></div>
        <div><dt>Created by intake</dt><dd>{status.createdCount}</dd></div>
        <div><dt>Needs review</dt><dd>{status.pendingReviewCount}</dd></div>
      </dl>
      {status.createdCount === 0 && <p className='mhelp-intake-warning'>No Tech Check assignments have been created by this intake yet.</p>}
      <p>These are saved intake receipt counts, not live ticket totals. A created ticket can also need review if its source later changed.</p>
      <h4>Held tickets for review</h4>
      {status.held.length > 0 ? <ul className='mhelp-intake-held'>{status.held.map((ticket, index) => <li key={index}>
        <span>Printed ticket <strong>{ticket.ticketNumber}</strong></span>
        {ticket.reasonCodes.length > 0 ? <ul>{ticket.reasonCodes.map((code, reasonIndex) => <li key={reasonIndex}>{intakeReviewReasons[code]}<small>{code}</small></li>)}</ul> : <p>Reason not recorded.</p>}
      </li>)}</ul> : <p>{status.pendingReviewCount === 0 ? 'No tickets are held in this saved status.' : 'Held ticket references are unavailable in this saved status.'}</p>}
      {status.heldTruncated && <p>Showing {status.held.length} of {status.pendingReviewCount} tickets needing review. This panel shows at most 25 printed ticket references.</p>}
      <p className='mhelp-intake-read-note'>Status read {formatTime(checkedAt === null ? null : new Date(checkedAt).toISOString())}. Read-only Owner review.</p>
    </>}
  </section>;
}

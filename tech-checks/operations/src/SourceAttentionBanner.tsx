import {loudSourceAlerts, type SourceFacts} from './sourceAttention';
import {cameraTime} from './fieldCameraHealth';

/** Owner and IT see a failed or stale source by name, with when and what to do.
 * The banner never calls that condition an outage. */
export default function SourceAttentionBanner({facts, canReconnect, onReconnect}:{
  facts: SourceFacts; canReconnect?: boolean; onReconnect?: () => void;
}) {
  const alerts = loudSourceAlerts(facts);
  if (!alerts.length) return null;
  return <section className='cos-source-alerts' aria-label='Source attention' role='status'>
    {alerts.map(alert => <article key={alert.id} className={'cos-source-alert cos-source-alert-'+alert.state}>
      <strong>{alert.source}</strong>
      <p>{alert.state === 'reconnect_required' ? 'Authorization rejected.' : alert.state === 'failed' ? 'Last read failed.' : alert.state === 'stale' ? 'Stale.' : 'Not verified.'}
        {' '}{alert.since ? <>Since <time dateTime={alert.since}>{cameraTime(alert.since, facts.now)}</time>.</> : 'No successful time is on file.'}
        {' '}{alert.action}</p>
      {alert.state === 'reconnect_required' && (canReconnect && onReconnect
        ? <button type='button' className='secondary' onClick={onReconnect}>Reconnect mHelpDesk</button>
        : <p>Ask a COS Owner to reconnect mHelpDesk.</p>)}
    </article>)}
  </section>;
}

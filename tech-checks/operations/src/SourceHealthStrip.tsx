import {sourceHealth, type SourceFacts} from './sourceAttention';
import {cameraTime} from './fieldCameraHealth';

const LABEL: Record<string, string> = {
  current: 'Current', reconnect_required: 'Reconnect', failed: 'Failed', stale: 'Stale', unknown: 'Unknown', absent: 'Not on this view',
};

/** One chip: source, state, and the last good time. Unknown is never an outage. */
export function sourceStripText(row: {source: string; state: string; since: string | null}, now: number): string {
  return row.source+' '+(LABEL[row.state] ?? row.state)+' '+(row.since ? cameraTime(row.since, now) : 'No time');
}

/** Compact last-good time for each source. Unknown is a source state, not a unit outage. */
export default function SourceHealthStrip({facts}:{facts: SourceFacts}) {
  const rows = sourceHealth(facts);
  return <section className='cos-source-strip' aria-label='Source health'>
    <h2 className='sr-only'>Source health</h2>
    <ul>
      {rows.map(row => <li key={row.id}>
        <span>{row.source}</span>
        <b className={'cos-source-strip-'+row.state}>{LABEL[row.state]}</b>
        <time dateTime={row.since ?? undefined}>{row.since ? cameraTime(row.since, facts.now) : 'No time'}</time>
      </li>)}
    </ul>
  </section>;
}

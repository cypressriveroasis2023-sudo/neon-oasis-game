import type {NightReport} from './vrmNightReport';

const day = (s: number) => new Date(s * 1000).toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric'});
const ago = (s: number | null, now: number) => {
  if (s === null) return 'never';
  const mins = Math.round((now / 1000 - s) / 60);
  if (mins < 60) return mins + ' min ago';
  if (mins < 48 * 60) return Math.round(mins / 60) + ' h ago';
  return new Date(s * 1000).toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
};
const pct = (n: number | null) => n === null ? '—' : n + '%';

/** Last night's Helios power report, on the Victron page. Tap a unit to open it. */
export default function VrmNightReport({report, now, place, onOpen}: {report: NightReport; now: number; place: (name: string) => string; onOpen: (installationId: number) => void}) {
  const title = report.done ? 'Last night' : 'Tonight so far';
  return <details className='vrm-night' open>
    <summary><span className='vrm-night-title'>{title}</span><span className='vrm-night-when'>5 PM {day(report.from)} – 7 AM {day(report.to)}</span></summary>
    <ul className='vrm-night-nums'>
      <li><b>{report.reporting} / {report.rows.length}</b><span>Reporting</span></li>
      <li className={report.attention ? 'bad' : 'good'}><b>{report.attention}</b><span>Need a look</span></li>
      <li className={report.lowest && report.lowest.low < 30 ? 'bad' : ''}><b>{report.lowest ? report.lowest.low + '%' : '—'}</b><span>Lowest{report.lowest ? ' · ' + report.lowest.name : ''}</span></li>
      <li className='dim'><b>{report.silent}</b><span>Not reporting</span></li>
    </ul>
    <ul className='vrm-night-bottom'>{report.bottom.map(line => <li key={line}>{line}</li>)}</ul>
    <div className='vrm-night-scroll'>
      <table className='vrm-night-table'>
        <thead><tr><th>Unit</th><th>Status</th><th>5 PM</th><th>{report.done ? '7 AM' : 'Now'}</th><th>Low</th><th>Used / hr</th><th>Last report</th></tr></thead>
        <tbody>{report.rows.map(r => <tr key={r.installationId} className={'s-' + r.status}>
          <td><button type='button' onClick={() => onOpen(r.installationId)}>{r.name}</button>{place(r.name) && <small>{place(r.name)}</small>}</td>
          <td>{r.label}</td><td>{pct(r.start)}</td><td>{pct(r.end)}</td><td>{pct(r.low)}</td>
          <td>{r.perHour === null ? '—' : r.perHour + '%'}</td><td>{ago(r.lastSeen, now)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className='vrm-night-key'>Red = went under 20%. Amber = under 30%, or under 50% overnight. Grey = on outside power or not reporting. "5 PM" is the first saved reading after 5 PM.</p>
  </details>;
}

import type {NightReport, NightRow} from './vrmNightReport';

/** Battery color: bright green when healthy, yellow in the middle, red only when it got really low. */
export function nightLevel(row: Pick<NightRow, 'status' | 'low'>): 'good' | 'mid' | 'low' | 'none' {
  if (row.status === 'none' || row.low === null) return 'none';
  if (row.status === 'power' || row.low >= 50) return 'good';
  return row.low >= 20 ? 'mid' : 'low';
}

/** Last night's Helios report as one compact strip. The per-unit numbers are on the unit tiles below. */
export default function VrmNightReport({report}: {report: NightReport}) {
  const level = report.lowest === null ? 'none' : report.lowest.low >= 50 ? 'good' : report.lowest.low >= 20 ? 'mid' : 'low';
  return <section className='vrm-night' aria-label={report.done ? 'Last night' : 'Tonight so far'}>
    <span className='vrm-night-title'>{report.done ? 'Last night' : 'Tonight so far'}</span>
    <span className={'vrm-night-chip ' + (report.attention ? 'mid' : 'good')}><b>{report.attention ? report.attention : '✓'}</b>{report.attention ? ' need a look' : ' all OK'}</span>
    <span className={'vrm-night-chip ' + level}><b>{report.lowest ? report.lowest.low + '%' : '—'}</b> lowest{report.lowest ? ' · ' + report.lowest.name : ''}</span>
    <span className='vrm-night-chip good'><b>{report.reporting}</b> reporting</span>
    {report.silent > 0 && <span className='vrm-night-chip none'><b>{report.silent}</b> not reporting</span>}
    <span className='vrm-night-line'>{report.bottom[0]}{report.bottom[1] ? ' ' + report.bottom[1] : ''}</span>
  </section>;
}

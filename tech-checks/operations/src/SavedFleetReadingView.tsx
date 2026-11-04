import {CAMERA_AUTO_REFRESH_MS} from './refreshCadence';
import type {SavedFleetReading} from './savedFleetReading';

export default function SavedFleetReadingView({reading,refresh,busy=false}:{
  reading: SavedFleetReading;
  refresh: () => void;
  busy?: boolean;
}) {
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone:'America/Chicago', month:'short', day:'numeric', year:'numeric',
    hour:'numeric', minute:'2-digit', second:'2-digit', timeZoneName:'short'
  }).format(reading.checkedAt);
  return <section className="cos-fleet-dashboard cos-fleet-board cos-fleet-simple-map" aria-label="COS Fleet Dashboard">
    <div className="cos-fleet-content">
      <div className="cos-fleet-heading">
        <div><h1>Fleet Dashboard</h1><small>Last completed reading {time} · {CAMERA_AUTO_REFRESH_MS / 60000}-minute refresh</small></div>
        <button type="button" className="cos-fleet-refresh" onClick={refresh} disabled={busy}>
          {busy ? '↻ Reading data…' : '↻ Refresh data'}
        </button>
      </div>
      <div className="cos-fleet-stats" aria-label="Last completed Fleet counts">
        {([
          ['Field equipment', reading.field, 'field'], ['Units online', reading.online, 'online'],
          ['Units offline', reading.offline, 'offline'], ['Units unverified', reading.unverified, 'unknown'],
          ['Shop / ROOT', reading.shop, 'shop'], ['Total inventory', reading.field + reading.shop, 'total'],
        ] as const).map(([label, value, kind])=><div key={kind} className={'cos-fleet-stat cos-fleet-stat-'+kind}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
    </div>
  </section>;
}

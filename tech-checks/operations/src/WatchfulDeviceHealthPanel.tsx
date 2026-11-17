import {presentWatchfulDevices, type WatchfulRow, type WatchfulUnit} from '../../supabase/functions/cos-watchful-device-health/model';
import './watchfulDeviceHealth.css';

type Props = {units: readonly WatchfulUnit[]; rows?: readonly WatchfulRow[] | null; now?: number; runAt?: string | null};

/** Missing rows are Unknown. Shop matches add nothing to the counts. */
export default function WatchfulDeviceHealthPanel({units, rows, now = Date.now(), runAt = null}: Props) {
  if (!rows) {
    return <section className='cos-watchful-health' aria-label='Watchful device health'>
      <h3>Watchful device health</h3>
      <p>No Watchful reading is loaded, so this source is Unknown. Missing data is not an outage.</p>
      <p className='cos-watchful-counts'>Red 0 · Unknown 0 · Offline 0 · In Shop 0</p>
    </section>;
  }
  const view = presentWatchfulDevices(rows, units, now);
  const matched = view.devices.filter(device => device.match === 'exact');
  const unmatched = view.devices.filter(device => device.match === 'unmatched');
  return <section className='cos-watchful-health' aria-label='Watchful device health'>
    <h3>Watchful device health</h3>
    <p className='cos-watchful-counts'>Red {view.counts.red} · Unknown {view.counts.unknown} · Offline {view.counts.offline} · In Shop {view.counts.inShop}</p>
    {runAt && <p>Run {runAt}</p>}
    <ul>
      {matched.map(device => <li key={device.rowKey} style={{color: device.color}}>
        <strong>{device.unit}</strong> · {device.site} · {device.label} · {device.deviceName}
      </li>)}
    </ul>
    {unmatched.length > 0 && <div>
      <h4>Unmatched</h4>
      <ul aria-label='Unmatched Watchful devices'>
        {unmatched.map(device => <li key={device.rowKey} style={{color: device.color}}>{device.label} · {device.deviceName} · {device.site}</li>)}
      </ul>
    </div>}
  </section>;
}

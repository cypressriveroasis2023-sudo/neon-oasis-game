import {useEffect, useState} from 'react';
import {presentWatchfulDevices, type WatchfulUnit} from '../../supabase/functions/cos-watchful-device-health/model';
import {readLatestWatchfulRun, type WatchfulRun} from './watchfulDeviceHealthRead';
import './watchfulDeviceHealth.css';

type Props = {units: readonly WatchfulUnit[]; now?: number; run?: WatchfulRun | null};

function emptyReading() {
  return <section className='cos-watchful-health' aria-label='Watchful device health'>
    <h3>Watchful device health</h3>
    <p>No Watchful reading is loaded, so this source is Unknown. Missing data is not an outage.</p>
    <p className='cos-watchful-counts'>Red 0 · Unknown 0 · Offline 0 · In Shop 0</p>
  </section>;
}

/** One matched unit, then the devices from the latest run. Shop adds nothing to the counts. */
export function WatchfulDeviceHealthView({units, run, now = Date.now()}: {units: readonly WatchfulUnit[]; run: WatchfulRun | null; now?: number}) {
  if (!run) return emptyReading();
  const view = presentWatchfulDevices(run.rows, units, now);
  const matched = view.devices.filter(device => device.match === 'exact');
  const unmatched = view.devices.filter(device => device.match === 'unmatched');
  const byUnit = new Map<string, typeof matched>();
  for (const device of matched) {
    const key = device.unit || '';
    byUnit.set(key, [...byUnit.get(key) || [], device]);
  }
  return <section className='cos-watchful-health' aria-label='Watchful device health'>
    <h3>Watchful device health</h3>
    <p className='cos-watchful-counts'>Red {view.counts.red} · Unknown {view.counts.unknown} · Offline {view.counts.offline} · In Shop {view.counts.inShop}</p>
    {run.runAt && <p>Run {run.runAt}</p>}
    <ul>
      {[...byUnit].map(([unit, devices]) => <li key={unit}>
        <strong>{unit}</strong>
        <ul>
          {devices.map(device => <li key={device.rowKey} style={{color: device.color}}>{device.label} · {device.deviceName}</li>)}
        </ul>
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

/** Loads the latest watchful_device_health run for Owner and verified IT. */
export default function WatchfulDeviceHealthPanel({units, now = Date.now(), run}: Props) {
  const [loaded, setLoaded] = useState<WatchfulRun | null>(run === undefined ? null : run);
  useEffect(() => {
    if (run !== undefined) {
      setLoaded(run);
      return;
    }
    let cancel = false;
    readLatestWatchfulRun().then(value => { if (!cancel) setLoaded(value); });
    return () => { cancel = true; };
  }, [run]);
  return <WatchfulDeviceHealthView units={units} run={loaded} now={now}/>;
}

import {useEffect, useState} from 'react';
import {presentWatchfulDevices, type WatchfulUnit} from '../../supabase/functions/cos-watchful-device-health/model';
import {readLatestWatchfulRun, type WatchfulRun} from './watchfulDeviceHealthRead';
import './watchfulDeviceHealth.css';

type Props = {units: readonly WatchfulUnit[]; run?: WatchfulRun | null; clock?: () => number};

function unavailable() {
  return <section className='cos-watchful-health' aria-label='Watchful device health'>
    <h3>Watchful device health</h3>
    <p>Unknown. Watchful is unavailable.</p>
  </section>;
}

/** One matched unit, then the devices from the latest run. Shop adds nothing to the counts.
 * Freshness uses the clock argument, which production sets to Date.now. The board clock is not used. */
export function WatchfulDeviceHealthView({units, run, clock = Date.now}: {units: readonly WatchfulUnit[]; run: WatchfulRun | null; clock?: () => number}) {
  if (!run) return unavailable();
  const now = clock();
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

/** One quiet read for Owner and verified IT. A missing function stays Unknown: no spinner and no retry. */
export default function WatchfulDeviceHealthPanel({units, run, clock = Date.now}: Props) {
  const [loaded, setLoaded] = useState<WatchfulRun | null>(run === undefined ? null : run);
  useEffect(() => {
    if (run !== undefined) {
      setLoaded(run);
      return;
    }
    let cancel = false;
    readLatestWatchfulRun().then(value => { if (!cancel) setLoaded(value); }, () => { if (!cancel) setLoaded(null); });
    return () => { cancel = true; };
  }, [run]);
  return <WatchfulDeviceHealthView units={units} run={loaded} clock={clock}/>;
}

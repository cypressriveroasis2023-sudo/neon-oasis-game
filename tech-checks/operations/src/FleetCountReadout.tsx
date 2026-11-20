import type {CountTriple} from './sharedFleetCounts';
import {lastKnownLine} from './feedFreshness';

const text = (value: number | '—' | null | undefined) => value === null || value === undefined ? '—' : String(value);

/** Both labels are required. A bare "online" number is never shown alone. */
export default function FleetCountReadout({units, cameras, pending = false, unitTitle = 'Camera units', showCameras = true, placementReadAt}:{
  units: CountTriple | null;
  cameras: CountTriple | null;
  pending?: boolean;
  unitTitle?: string;
  showCameras?: boolean;
  /** Omit when placement is current. Null means the unit list is late and has no time. */
  placementReadAt?: number | null;
}) {
  const stale = placementReadAt !== undefined;
  const figure = (counts: CountTriple | null, part: 'online' | 'offline' | 'unknown') => {
    if (stale) return '?';
    return pending || !counts ? '—' : text(counts[part]);
  };
  const known = (counts: CountTriple | null) => counts ? counts.online+' / '+(counts.online+counts.offline+counts.unknown) : '';
  const row = (title: string, label: string, counts: CountTriple | null) => <section className={'cos-shared-count-block'+(stale?' cos-feed-stale':'')} aria-label={label}>
    <h3>{title}</h3>
    <p className='cos-camera-counts cos-phone-counts' role='group' aria-label={label}>
      <span><b className={stale?'cos-stale-figure':undefined}>{figure(counts,'online')}</b>online</span>
      <span><b className={stale?'cos-stale-figure':undefined}>{figure(counts,'offline')}</b>offline</span>
      <span><b className={stale?'cos-stale-figure':undefined}>{figure(counts,'unknown')}</b>unknown</span>
    </p>
    {stale&&counts&&<small className='cos-fleet-stat-explanation'>{lastKnownLine(known(counts), placementReadAt)}</small>}
  </section>;
  const unitLabel = unitTitle + ' online, offline and unknown';
  return <div className='cos-shared-counts'>
    {row(unitTitle, unitLabel, units)}
    {showCameras && row('Cameras', 'Cameras online, offline and unknown', cameras)}
  </div>;
}

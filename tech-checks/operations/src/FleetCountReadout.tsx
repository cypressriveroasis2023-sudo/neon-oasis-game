import type {CountTriple} from './sharedFleetCounts';

const text = (value: number | '—' | null | undefined) => value === null || value === undefined ? '—' : String(value);

/** Both labels are required. A bare "online" number is never shown alone. */
export default function FleetCountReadout({units, cameras, pending = false, unitTitle = 'Camera units', showCameras = true}:{
  units: CountTriple | null;
  cameras: CountTriple | null;
  pending?: boolean;
  unitTitle?: string;
  showCameras?: boolean;
}) {
  const row = (title: string, label: string, counts: CountTriple | null) => <section className='cos-shared-count-block' aria-label={label}>
    <h3>{title}</h3>
    <p className='cos-camera-counts cos-phone-counts' role='group' aria-label={label}>
      <span><b>{pending || !counts ? '—' : text(counts.online)}</b>online</span>
      <span><b>{pending || !counts ? '—' : text(counts.offline)}</b>offline</span>
      <span><b>{pending || !counts ? '—' : text(counts.unknown)}</b>unknown</span>
    </p>
  </section>;
  const unitLabel = unitTitle + ' online, offline and unknown';
  return <div className='cos-shared-counts'>
    {row(unitTitle, unitLabel, units)}
    {showCameras && row('Cameras', 'Cameras online, offline and unknown', cameras)}
  </div>;
}

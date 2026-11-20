import {fleetStatCount, presentValue, type FeedAge} from './feedFreshness';

/** The number and caption the Fleet screen renders for one stat. */
export default function FleetFreshFigure({quick, count, note, ages, now, censusFromUnitList}:{
  quick: string;
  count: string | number;
  note: string;
  ages: readonly FeedAge[];
  now: number;
  censusFromUnitList: boolean;
}) {
  const text = fleetStatCount(quick, count, ages, now, censusFromUnitList);
  const stale = text === '?';
  const mhelp = ages.find(age => age.id === 'mhelp');
  const listMissing = !mhelp || mhelp.reason === 'missing';
  const placementUnknown = listMissing && ['field', 'shop', 'total'].includes(quick);
  const caption = stale
    ? (presentValue(String(count), String(count), ages.filter(age => age.reason !== 'missing'), now).note ?? (placementUnknown ? 'Placement unknown' : ''))
    : placementUnknown ? 'Placement unknown' : note;
  const grey = stale && ['online', 'offline', 'unknown'].includes(quick);
  return <>
    <strong className={grey ? 'cos-stale-figure' : undefined} style={grey ? {color: '#8b97a8'} : undefined}>{text}</strong>
    <small className='cos-fleet-stat-explanation'>{caption}</small>
  </>;
}

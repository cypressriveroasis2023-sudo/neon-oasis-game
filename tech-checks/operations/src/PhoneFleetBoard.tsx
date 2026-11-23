import {lazy, Suspense, useSyncExternalStore} from 'react';
import ViewErrorBoundary from './ViewErrorBoundary';
import type {UnitCameraStatus} from '../shared/starUnitStatus';
import type {CosBoardLandingProps} from './CosBoardLanding';

const CosBoardLanding = lazy(() => import('./CosBoardLanding'));

const PHONE = '(max-width:700px)';
const watch = (notify: () => void) => {
  const query = window.matchMedia(PHONE);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};
const onPhone = () => window.matchMedia(PHONE).matches;

type Props = Omit<CosBoardLandingProps, 'feed'> & {feed: UnitCameraStatus[] | null};

/**
 * The COS Board screen at the top of Fleet on a phone. It waits for the camera
 * feed: with no feed there is nothing true to draw, and Fleet shows as before.
 * If the board itself cannot be shown it steps aside, and Fleet carries on.
 */
export default function PhoneFleetBoard({feed, ...rest}: Props) {
  const phone = useSyncExternalStore(watch, onPhone);
  if (!phone || !feed) return null;
  return <ViewErrorBoundary fallback={() => null}>
    <div className='cos-board-landing'><Suspense fallback={null}><CosBoardLanding feed={feed} {...rest}/></Suspense></div>
  </ViewErrorBoundary>;
}

import {lazy, Suspense, useState, useSyncExternalStore} from 'react';
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

type Props = Omit<CosBoardLandingProps, 'feed' | 'onReady'> & {feed: UnitCameraStatus[] | null};

/**
 * The COS Board screen at the top of Fleet.
 *
 * It waits for the camera feed: with no feed there is nothing true to draw,
 * and Fleet shows as before. If the board itself cannot be shown it steps
 * aside, and Fleet carries on.
 *
 * On a phone the board is the Fleet screen, and the older Fleet view waits
 * behind one button. On a wider screen there is room for both, so the older
 * view stays open underneath. The older view is only ever folded away once
 * the board is on screen.
 */
export default function FleetBoard({feed, ...rest}: Props) {
  const phone = useSyncExternalStore(watch, onPhone);
  const [ready, setReady] = useState(false), [chosen, setChosen] = useState<boolean | null>(null);
  if (!feed) return null;
  const older = chosen ?? !phone;
  // The older view's map measures itself when the window changes size. It was hidden, so tell it to measure again.
  const toggle = () => { setChosen(!older); window.setTimeout(() => window.dispatchEvent(new Event('resize')), 0); };
  return <ViewErrorBoundary fallback={() => null}>
    <div className='cos-board-landing' data-older-view={ready && !older ? 'closed' : 'open'}>
      <Suspense fallback={null}><CosBoardLanding feed={feed} {...rest} onReady={() => setReady(true)}/></Suspense>
      {ready && <button type='button' className='cos-board-older' aria-expanded={older} onClick={toggle}>{older ? 'Hide the older Fleet view' : 'Show the older Fleet view'}</button>}
    </div>
  </ViewErrorBoundary>;
}

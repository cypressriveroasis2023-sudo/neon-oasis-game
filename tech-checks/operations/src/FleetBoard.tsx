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

type Props = Omit<CosBoardLandingProps, 'feed' | 'onReady'> & {
  feed: UnitCameraStatus[] | null;
  /** What Fleet says when a unit asked for from another screen could not be opened. */
  notice?: string;
  /** True while a unit, record or address from the older Fleet view is open. */
  inUse?: boolean;
};

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
 *
 * Another screen can send a person to Fleet for one unit. That answer lives in
 * the older view, so the older view opens for it and stays open until the
 * person folds it. If the unit could not be opened, Fleet's own words for why
 * are shown above the board, where they are seen.
 */
export default function FleetBoard({feed, notice = '', inUse = false, ...rest}: Props) {
  const phone = useSyncExternalStore(watch, onPhone);
  const wanted = inUse || Boolean(notice);
  const [ready, setReady] = useState(false), [chosen, setChosen] = useState<boolean | null>(wanted ? true : null), [seen, setSeen] = useState(wanted);
  if (seen !== wanted) { setSeen(wanted); if (wanted) setChosen(true); }
  if (!feed) return null;
  const older = chosen ?? !phone;
  // The older view's map measures itself when the window changes size. It was hidden, so tell it to measure again.
  const toggle = () => { setChosen(!older); window.setTimeout(() => window.dispatchEvent(new Event('resize')), 0); };
  return <ViewErrorBoundary fallback={() => null}>
    <div className='cos-board-landing' data-older-view={ready && !older ? 'closed' : 'open'}>
      {notice && <p className='cos-board-notice' role='status'>{notice}</p>}
      <Suspense fallback={null}><CosBoardLanding feed={feed} {...rest} onReady={() => setReady(true)}/></Suspense>
      {ready && <button type='button' className='cos-board-older' aria-expanded={older} onClick={toggle}>{older ? 'Hide the older Fleet view' : 'Show the older Fleet view'}</button>}
    </div>
  </ViewErrorBoundary>;
}

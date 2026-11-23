import {lazy, Suspense, useEffect, useState} from 'react';
import ViewErrorBoundary from './ViewErrorBoundary';
import type {UnitCameraStatus} from '../shared/starUnitStatus';
import type {CosBoardLandingProps} from './CosBoardLanding';

const loadBoard = () => import('./CosBoardLanding');
const CosBoardLanding = lazy(loadBoard);

/** Whether the board has been on this device's Fleet screen before. A convenience only: nothing depends on it being kept. */
const SHOWN = 'cos.fleetBoard.shown';
const recall = () => { try { return window.localStorage.getItem(SHOWN) === '1'; } catch { return false; } };
const remember = (shown: boolean) => {
  try { if (shown) window.localStorage.setItem(SHOWN, '1'); else window.localStorage.removeItem(SHOWN); } catch { /* nothing depends on it */ }
};
/** How long the board may wait for the camera feed before Fleet falls back to the older screen. */
const WAIT_MS = 8000;
/**
 * A device can have the board switched off, which leaves it the older Fleet screen. There is no button for
 * it anywhere in COS: it is a support switch, and it is how the older screen's own tests still reach it.
 */
const OFF = 'cos.fleetBoard.off';
const switchedOff = () => { try { return window.localStorage.getItem(OFF) === '1'; } catch { return false; } };

function Forget() {
  useEffect(() => { remember(false); }, []);
  return null;
}

type Props = Omit<CosBoardLandingProps, 'feed' | 'onReady' | 'onNone'> & {
  feed: UnitCameraStatus[] | null;
  /** What Fleet says when a unit asked for from another screen could not be opened. */
  notice?: string;
};

/**
 * The COS Board is the Fleet screen.
 *
 * While the board is on screen nothing of the older Fleet screen is: not its
 * view, not its row of tabs, and no button to bring them back. That is James's
 * call, for every width and every sign-in that opens Fleet.
 *
 * The older screen is kept for one job only: standing in when the board cannot
 * be shown at all. With no camera feed there is nothing true to draw, and if
 * the board itself fails it steps aside; either way Fleet still opens.
 *
 * The first time on a device, the older screen gives way once the board is on
 * screen. After that the device is known to show the board, so Fleet opens
 * straight to it: the board shows its own "loading" line while the feed is
 * read, and the older screen never flashes up first. If the feed then cannot
 * be read, Fleet says so above the older screen and offers to try again.
 */
export default function FleetBoard(props: Props) {
  const [off] = useState(switchedOff);
  return off ? null : <Board {...props}/>;
}

function Board({feed, notice = '', ...rest}: Props) {
  const [ready, setReady] = useState(false), [known, setKnown] = useState(recall), [failed, setFailed] = useState(false);
  // Fetch the board's code while the feed is being read, so it is on screen as soon as there is something to draw.
  useEffect(() => { void loadBoard().catch(() => {}); }, []);
  useEffect(() => { if (feed && ready) { remember(true); setFailed(false); } }, [feed, ready]);
  const giveUp = () => { remember(false); setFailed(known); setKnown(false); };
  // A known device opens to the board before there is anything to draw. That only holds while the board is on its way.
  const waiting = known && !(feed && ready);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(giveUp, WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [waiting]);
  if (!feed && !known) {
    // Only a device that was shown the board before is told it is missing. Anywhere else this is simply Fleet.
    return failed ? <div className='cos-board-landing' data-board='off'>
      <p className='cos-board-notice' role='status'>The board could not be loaded, so this is the older Fleet screen. <button type='button' onClick={() => { setFailed(false); setKnown(true); }}>Try again</button></p>
    </div> : null;
  }
  return <ViewErrorBoundary fallback={() => <Forget/>}>
    <div className='cos-board-landing' data-board={ready || known ? 'on' : 'off'}>
      {notice && <p className='cos-board-notice' role='status'>{notice}</p>}
      <Suspense fallback={known ? <div className='cos-board-waiting' role='status' aria-label='Opening the board'/> : null}>
        <CosBoardLanding feed={feed} {...rest} onReady={() => setReady(true)} onNone={giveUp}/>
      </Suspense>
    </div>
  </ViewErrorBoundary>;
}

import {useEffect, useState, type ReactNode} from 'react';
import {boardShownHere} from './FleetBoard';
import {requestBoardView} from './managerBridge';
import {workspaceHash} from './workspaceNavigation';

/**
 * Boards is the TV board, and the TV board is the COS Board drawn large: the
 * same reading, the same count and the same map, sized to be read from across
 * the shop. It is a way of showing the board on Fleet, so it always has the
 * board's own data.
 *
 * A device that shows the board is taken to it. Any other device (the first
 * visit, or a device where the board cannot be shown) keeps this page as it
 * was, with the older TV display.
 */
export default function BoardsDoor({children}: {children: ReactNode}) {
  const [leaving] = useState(boardShownHere);
  useEffect(() => {
    if (!leaving) return;
    requestBoardView('tv');
    window.location.hash = workspaceHash({workspace: 'Fleet Dashboard', jobId: '', detail: false});
  }, []);
  return leaving ? <p className='cos-manager-door' role='status'>Opening the TV board…</p> : <>{children}</>;
}

import {useEffect, useState, type ReactNode} from 'react';
import {managerHello, managerHost, managerKnown, requestBoardView} from './managerBridge';
import {workspaceHash} from './workspaceNavigation';

/**
 * For the owner, Tech Check is the manager view on the board: who did today's
 * truck inspection, what each truck carries, and what IT and Service handed to
 * each other. The owner does not fill in a tech's check.
 *
 * The manager view needs the signed-in Tech Check app around this frame to read
 * those records. Wherever that app does not offer it, this is the Tech Check page
 * exactly as it was, so nothing is lost.
 */
export default function ManagerDoor({children}: {children: ReactNode}) {
  const [asking, setAsking] = useState(managerHost);
  useEffect(() => {
    if (!asking) return;
    let live = true;
    // The app answers at once when it is free. A device that has shown the manager view waits out a busy moment;
    // any other gets the page as it was without being kept waiting.
    // Once the page as it was is on screen it stays: a late answer never pulls the person away from it.
    const stay = () => { if (!live) return; live = false; window.clearTimeout(timer); setAsking(false); };
    const timer = window.setTimeout(stay, managerKnown() ? 5000 : 700);
    managerHello().then(() => {
      if (!live) return;
      live = false;
      window.clearTimeout(timer);
      requestBoardView('manager');
      window.location.hash = workspaceHash({workspace: 'Fleet Dashboard', jobId: '', detail: false});
    }, stay);
    return () => { live = false; window.clearTimeout(timer); };
  }, []);
  return asking ? <p className='cos-manager-door' role='status'>Opening the manager view…</p> : <>{children}</>;
}

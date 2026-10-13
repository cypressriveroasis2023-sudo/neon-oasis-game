import { useEffect, useState } from 'react';
import { ITSourceCard, sources } from './ITDashboard';
import { IT_DAILY_WORKSPACES, itDailyLabel } from '../../it-feature-availability';
import { trackerWorkbookId } from './unitTracker';
// Only these four sources mount or read. The paused workflow components stay unmounted.
const dailySources = IT_DAILY_WORKSPACES.map(route => {
  const source = sources.find(item => item.route === route)!;
  return { ...source, label: itDailyLabel(route), ...(route === 'Unit Tracker' ? {
    description: 'Open the original 2027 Google Sheet or review current COS inventory.',
    sourceLink: { href: 'https://docs.google.com/spreadsheets/d/' + trackerWorkbookId + '/edit', label: 'Open 2027 Google Sheet' },
    openLabel: 'Open COS inventory',
    summaryUnavailable: 'COS summary is unavailable. Open the 2027 Google Sheet for current tracker records.',
  } : {}) };
});
export default function ITDailyDashboard({ session, navigate }: {session: Record<string, any>; navigate: (workspace: string) => void}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  return <section className="it-dashboard it-daily-dashboard" aria-label="IT daily dashboard">
    <header className="it-dashboard-heading"><div><p className="it-dashboard-eyebrow">CAMERAS ONSITE · IT</p><h1>Daily views</h1><p>Camera Health, Field View, Victron View and the 2027 Unit Tracker.</p></div></header>
    <div className='cos-fleet-launch'><div><strong>COS Camera Health & Field Map</strong><p>Map, fleet health, current mHelpDesk locations and battery evidence in one view.</p></div><button onClick={()=>navigate('Fleet Dashboard')}>Open Fleet Dashboard →</button></div>
    <div className="it-dashboard-grid" aria-label="Daily IT views">{dailySources.map(source => <ITSourceCard key={source.id} source={source} session={session} now={now} navigate={navigate}/>)}</div>
    <p className="it-dashboard-footnote">Other IT features are paused until further notice. Connecting mHelpDesk will not turn them back on.</p>
  </section>;
}

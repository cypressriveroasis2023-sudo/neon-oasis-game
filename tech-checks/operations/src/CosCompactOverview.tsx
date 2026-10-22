import {useEffect,useState} from 'react';
import FleetInventoryOverview from './FleetInventoryOverview';
import {ITSourceCard,sources} from './ITDashboard';

/** Use existing independently validated evidence; never infer online cameras from placement. */
const fleetSources=sources.filter(source=>source.id!=='mhelp');
export default function CosCompactOverview({
  session,navigate
}:{session:Record<string,any>;navigate:(workspace:string)=>void}) {
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{
    const update=()=>{if(!document.hidden)setNow(Date.now());};
    const timer=window.setInterval(update,60000);
    document.addEventListener('visibilitychange',update);
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',update);};
  },[]);
  return <section className='cos-compact-overview' aria-label='COS fleet overview'>
    <header><h1>Overview</h1><p>Inventory placement, camera evidence, router reachability and verified power are separate readings. Missing information stays unavailable.</p></header>
    <FleetInventoryOverview navigate={navigate}/>
    <div className='it-dashboard-grid' aria-label='Fleet health and connectivity'>
      {fleetSources.map(source=><ITSourceCard key={source.id} source={source} session={session} now={now} navigate={navigate}/>)}
    </div>
  </section>;
}

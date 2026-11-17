import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { cameraDashboardSummary } from './cameraDashboardSummary';
import { loadCompanyEquipment, type CompanyEquipmentData } from './todayDashboardData';

type Props = { setActive: (workspace: string) => void };

const emptyEquipment = (): CompanyEquipmentData => ({ camera: null, routers: null, errors: {} });

/** Today keeps camera health and routers. Job, quote, invoice, purchasing and owner-task tiles are not loaded. */
export default function LiveTodayDashboard({ setActive }: Props) {
  const [equipment, setEquipment] = useState<CompanyEquipmentData>(emptyEquipment);
  const [loading, setLoading] = useState(true);
  const revision = useRef(0), running = useRef(false);
  const refresh = async () => {
    if (running.current) return;
    running.current = true;
    const request = ++revision.current;
    setLoading(true);
    setEquipment(emptyEquipment());
    await loadCompanyEquipment(api, next => { if (request === revision.current) setEquipment(next); });
    if (request !== revision.current) return;
    running.current = false;
    setLoading(false);
  };
  useEffect(() => {
    void refresh();
    return () => { revision.current += 1; running.current = false; };
  }, []);
  const summary = cameraDashboardSummary(equipment.camera);
  const cameraText = summary.available
    ? summary.headline
    : equipment.camera
      ? equipment.camera.online + ' online · ' + equipment.camera.offline + ' offline · ' + equipment.camera.review + ' need review'
      : equipment.errors.camera || (loading ? 'Checking camera health…' : 'Camera health is unavailable.');
  const routerText = equipment.routers
    ? equipment.routers.items.length + (equipment.routers.items.length === 1 ? ' router' : ' routers')
    : equipment.errors.routers || (loading ? 'Checking routers…' : 'Router inventory is unavailable.');
  return <div className='owner-command-home company-command-home' aria-busy={loading}>
    <section className='company-overview' aria-label='Company overview'>
      <header className='company-overview-heading'>
        <div><h1>Company overview</h1><p>Cameras, locations, troubleshooting and equipment handoff.</p></div>
      </header>
      <section aria-label='Camera health summary'>
        <h2>Camera health</h2>
        <p>{cameraText}</p>
        {summary.available && <p>{summary.systems}</p>}
        <p>{summary.note}</p>
        <button type='button' onClick={() => setActive('Camera Health')}>Open Camera Health</button>
      </section>
      <section aria-label='Router summary'>
        <h2>Routers</h2>
        <p>{routerText}</p>
        <button type='button' onClick={() => setActive('InHand Routers')}>Open routers</button>
      </section>
      {(equipment.errors.camera || equipment.errors.routers) && <section className='company-source-error' role='alert' aria-label='Dashboard data unavailable'>
        {equipment.errors.camera && <p>{equipment.errors.camera}</p>}
        {equipment.errors.routers && <p>{equipment.errors.routers}</p>}
      </section>}
      <div className='company-source-status'>
        <button type='button' className='secondary' disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing…' : 'Refresh Overview'}</button>
      </div>
    </section>
  </div>;
}

import { api } from '@appdeploy/client';
import VisionAreas, { AreaIcon, primaryWorkspace } from './VisionAreas';
import OperationsAreas from './OperationsAreas';
import UnitsOnHand from './UnitsOnHand';
import { primaryAreas } from './visionAreas';
import './visionAreas.css';
import AnimatedEye from './AnimatedEye';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export const companyGroups = [
  {
    label: 'Overview',
    home: 'Today',
    items: ['Today', 'Daily Board', 'Needs Attention', 'Activity'],
  },
  {
    label: 'Job flow',
    home: 'Jobs',
    items: ['Jobs', 'Owner Review', 'Handoffs', 'Tech Check'],
  },
  {
    label: 'Schedule',
    home: 'Calendar',
    items: ['Calendar', 'Unscheduled', 'Dispatch'],
  },
  {
    label: 'Equipment',
    home: 'Equipment',
    items: [
      'Equipment',
      'Field Map',
      'Camera Health',
      'InHand Routers',
      'Victron VRM',
    ],
  },
  {
    label: 'Customers',
    home: 'Customers',
    items: ['Customers', 'Sites', 'Work Requests', 'CRM'],
  },
  { label: 'Team', home: 'Team', items: ['Team', 'Owner Tasks'] },
  {
    label: 'Finance',
    home: 'Billing',
    items: [
      'Quotes',
      'Purchasing',
      'Billing',
      'Invoices',
      'Accounting',
      'Collections',
      'Payments',
      'History',
      'Reports',
    ],
  },
];
export const companyLabel = (name: string) =>
  (
    ({
      Today: 'Overview',
      'Field Map': 'Field View',
      'Victron VRM': 'Victron Power',
      Jobs: 'Job flow',
      'Daily Board': 'Dispatch Board',
      Billing: 'Billing & Invoices',
      Invoices: 'Invoice approvals',
    }) as Record<string, string>
  )[name] || name;
type CompanyRoute = { workspace: string; jobId: string; detail: boolean };
const slug = (name: string) => name.toLowerCase().replaceAll(' ', '-');

/** Local presentation history only. Session and backend authorization are unchanged. */
export function useCompanyRoute(workspaces: string[]) {
  const read = useCallback((): CompanyRoute => {
    const [raw, query = ''] = location.hash.replace(/^#/, '').split('?');
    const key =
      raw || new URLSearchParams(location.search).get('workspace') || 'today';
    const aliases: Record<string, string> = {
      overview: 'Today',
      'dispatch-board': 'Daily Board',
      'field-view': 'Field Map',
      'victron-power': 'Victron VRM',
      dashboard: 'Today',
    };
    const workspace =
      aliases[key] || workspaces.find((name) => slug(name) === key) || 'Today';
    const params = new URLSearchParams(query);
    return {
      workspace,
      jobId: params.get('job') || '',
      detail: workspace === 'Today' && params.get('detail') === '1',
    };
  }, [workspaces]);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const sync = () => {
      window.dispatchEvent(new Event('cos-workspace-navigation'));
      setRoute(read());
    };
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, [read]);
  const go = useCallback(
    (next: CompanyRoute, replace = false, state: unknown = null) => {
      const params = new URLSearchParams();
      if (next.jobId) params.set('job', next.jobId);
      if (next.detail) params.set('detail', '1');
      const hash =
        '#' + slug(next.workspace) + (params.size ? '?' + params : '');
      if (replace) history.replaceState(state, '', hash);
      else if (location.hash !== hash) history.pushState(state, '', hash);
      window.dispatchEvent(new Event('cos-workspace-navigation'));
      setRoute(next);
      window.scrollTo({ top: 0, behavior: 'instant' });
    },
    [],
  );
  return {
    route,
    navigate: (workspace: string) =>
      go({
        workspace: workspaces.includes(workspace) ? workspace : 'Today',
        jobId: '',
        detail: false,
      }, route.workspace === 'Operations'),
    openJob: (
      jobId: string,
      workspace: 'Jobs' | 'Unscheduled' | 'Owner Review' | 'Dispatch' = 'Jobs',
    ) => go({ workspace, jobId, detail: false }),
    selectJob: (jobId: string) => {
      go({ workspace: 'Today', jobId, detail: false }, true);
      go({ workspace: 'Today', jobId, detail: true }, false, {
        cosCompanyDetail: true,
      });
    },
    backToJobs: () => {
      if (history.state?.cosCompanyDetail) history.back();
      else go({ workspace: 'Today', jobId: route.jobId, detail: false }, true);
    },
  };
}

function Brand({ mobile = false }: { mobile?: boolean }) {
  return (
    <div className={mobile ? 'company-mobile-brand' : 'company-brand'}>
      <AnimatedEye />
      <span className="company-brand-copy">
        <strong>VISION</strong>
        <small>COS Operations</small>
      </span>
    </div>
  );
}

export default function CompanyShell({
  active, navigate, name, children, signOut,
}: {
  active: string; navigate: (name: string) => void; name: string;
  children: ReactNode; signOut: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menu) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLButtonElement>('.operations-menu-close')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMenu(false); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]') || []).filter(element => element.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', keyboard);
    return () => { window.removeEventListener('keydown', keyboard); document.body.style.overflow = overflow; (previous || trigger.current)?.focus(); };
  }, [menu]);
  useEffect(() => { setMenu(false); }, [active]);
  const choose = (workspace: string) => { setMenu(false); navigate(workspace); };
  const selected = primaryWorkspace(active);
  return <div className='operations-shell company-shell company-appdeploy-shell'>
    {menu && <button className='operations-menu-backdrop' aria-label='Dismiss menu' tabIndex={-1} onClick={() => setMenu(false)}/>}
    <aside ref={panel} role={menu ? 'dialog' : undefined} aria-modal={menu ? true : undefined} className={'operations-sidebar' + (menu ? ' operations-sidebar-open' : '')} aria-label='Operations navigation'>
      <Brand/>
      <button className='secondary operations-menu-close' onClick={() => setMenu(false)}>Close menu ×</button>
      <p className='company-nav-heading'>Your workspace</p>
      <nav className='operations-area-nav' aria-label='COS Operations'>{primaryAreas.map(area => <button key={area.workspace} className={selected === area.workspace ? 'active' : ''} aria-current={selected === area.workspace ? 'page' : undefined} onClick={() => choose(area.workspace)}><AreaIcon name={area.icon}/>{area.label}</button>)}</nav>
      <div className='company-sidebar-footer'><div className='company-sidebar-actions'><button onClick={() => choose('Tech Check')}>IT &amp; Service Tech Checks</button><button onClick={() => choose('Vision')}>Vision assistant</button><button onClick={signOut}>Sign out</button></div><div className='company-owner'><span aria-hidden='true'>{name.split(' ').map(part => part[0]).slice(0, 2).join('')}</span><div><strong>{name}</strong><small>COS workspace</small></div></div></div>
    </aside>
    <main className='owner-it-main' inert={menu}>
      <header className='company-utility-bar'><Brand mobile/><span className='company-breadcrumb'>{companyLabel(active)}</span><button className='company-search-trigger vision-nav-return' onClick={() => choose('Daily Board')}>Open dispatch board</button><span className='company-connection'><i/>OPERATIONS CONNECTED</span><button ref={trigger} className='operations-open-menu' aria-label='More' aria-expanded={menu} onClick={() => setMenu(true)}>Menu ☰</button></header>
      {active === 'Today' && <VisionAreas api={api} navigate={choose}/>}
      {active === 'Operations' ? <OperationsAreas navigate={choose}/> : active === 'Units On Hand' ? <UnitsOnHand api={api} navigate={choose}/> : children}
    </main>
    <nav className='company-app-mobile-nav' aria-label='Main workspaces' inert={menu}>{[{label:'Dashboard',workspace:'Today'},{label:'Field View',workspace:'Field Map'},{label:'Team',workspace:'Team'}].map(area => <button key={area.workspace} className={active === area.workspace ? 'active' : ''} aria-current={active === area.workspace ? 'page' : undefined} onClick={() => choose(area.workspace)}>{area.label}</button>)}<button aria-label='More' aria-expanded={menu} onClick={() => setMenu(true)}>Menu</button></nav>
  </div>;
}

export function NativeConnectedTool({ kind }: { kind: string }) {
  return (
    <section className="panel company-connected-tool">
      <h2>{kind}</h2>
      <p>
        {kind === 'InHand Routers'
          ? 'Stored router inventory and timestamped port observations are available in the main COS workspace. Live GPS setup remains pending.'
          : 'The main COS workspace contains the verified Helios fleet links and approved Victron dashboard access. Power readings are not supplied by this AppDeploy host.'}
      </p>
      <a
        href="https://cypressriveroasis2023-sudo.github.io/neon-oasis-game/tech-checks/"
        target="_blank"
        rel="noopener noreferrer"
      >
        Open main COS workspace ↗
      </a>
      <p>
        Use the {kind} area in the main menu. Your existing COS sign-in is required.
      </p>
    </section>
  );
}

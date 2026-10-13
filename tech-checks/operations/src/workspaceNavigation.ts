import { isTicketUnitId } from './ticketContext';
import { isTicketType, type TicketType } from './ticketTypes';

/** Presentation routes only. Authorization and actions stay in their existing workspaces. */
export const itWorkspaces = ['IT Dashboard','Fleet Dashboard','MHelp'];
export const workspaces = ['Operations','Units On Hand','Today','Daily Board','Fleet Dashboard','Unit Tracker','Vision','Camera Health','InHand Routers','Victron VRM','Dispatch','Calendar','Unscheduled','Customers','Sites','Work Requests','CRM','Quotes','Jobs','Tech Check','Owner Tasks','Handoffs','Owner Review','Equipment','Team','Purchasing','Billing','Invoices','Accounting','Collections','Payments','Needs Attention','History','Reports','Activity'];
export const workspaceGroups = [
  { label:'Overview', home:'Today', items:['Operations','Today','Daily Board','Needs Attention','Activity'] },
  { label:'Job flow', home:'Jobs', items:['Jobs','Owner Review','Handoffs','Tech Check'] },
  { label:'Schedule', home:'Calendar', items:['Calendar','Unscheduled','Dispatch'] },
  { label:'Equipment', home:'Equipment', items:['Fleet Dashboard','Units On Hand','Equipment','Unit Tracker','Camera Health','InHand Routers','Victron VRM'] },
  { label:'Customers', home:'Customers', items:['Customers','Sites','Work Requests','CRM'] },
  { label:'Team', home:'Team', items:['Team','Owner Tasks'] },
  { label:'Finance', home:'Billing', items:['Quotes','Purchasing','Billing','Accounting','Collections','Payments','History','Reports'] },
];
export const canonicalWorkspace = (name:string) => name==='Field Map'||name==='Field View'?'Fleet Dashboard':name;
export const workspaceLabel = (name:string) => ({'Tech Check':'Tech Checks',Today:'Overview','Daily Board':'Dispatch Board','Field Map':'Fleet Dashboard','Victron VRM':'Victron Power',Jobs:'Job flow',Calendar:'Calendar',Billing:'Billing & Invoices',Invoices:'Billing & Invoices'} as Record<string,string>)[name] || name;
export const workspaceGroup = (name:string) => workspaceGroups.find(group=>group.items.includes(name==='Invoices'?'Billing':name)) || workspaceGroups[0];
export type WorkspaceRoute = { workspace:string; jobId:string; detail:boolean; diagnostics?:boolean; createType?:TicketType; unitId?:string; unitLabel?:string; installationId?:number };
export function readWorkspaceRoute(hash:string=location.hash):WorkspaceRoute {
  const [key,query=''] = hash.replace(/^#/,'').split('?');
  const aliases:Record<string,string> = {overview:'Today','dispatch-board':'Daily Board','field-map':'Fleet Dashboard','field-view':'Fleet Dashboard','victron-power':'Victron VRM',dashboard:'Today'};
  const workspace = canonicalWorkspace(aliases[key] || [...workspaces,...itWorkspaces].find(name=>name.toLowerCase().replaceAll(' ','-')===key) || 'Today');
  const params = new URLSearchParams(query);
  const createType = params.get('create');
  const unitId=params.get('unit');
  const unitLabel=params.get('unitLabel');
  const installation = params.get('installationId');
  const installationId = installation && /^[1-9]\d*$/.test(installation) ? Number(installation) : NaN;
  const installationContext = workspace==='Victron VRM'&&!params.get('job')&&Number.isSafeInteger(installationId)?{installationId}:{};
  const labelContext=workspace==='Fleet Dashboard'&&!unitId&&unitLabel&&unitLabel.length<=120&&!/[\u0000-\u001f]/.test(unitLabel)?{unitLabel}:{};
  const unitContext=(!params.get('job')&&(['Fleet Dashboard','Camera Health','Unit Tracker'].includes(workspace)||(workspace==='Daily Board'&&isTicketType(createType)))&&isTicketUnitId(unitId))?{unitId}:{};
  return {workspace,...(workspace==='Camera Health'&&params.get('diagnostics')==='1'?{diagnostics:true}:{}),...unitContext,...labelContext,...installationContext,jobId:params.get('job')||'',detail:workspace==='Today'&&params.get('detail')==='1',...(workspace==='Daily Board'&&!params.get('job')&&isTicketType(createType)?{createType}:{})};
}
export function workspaceHash(route:WorkspaceRoute) {
  route={...route,workspace:canonicalWorkspace(route.workspace)};
  const params = new URLSearchParams();
  if(route.jobId)params.set('job',route.jobId);
  if(route.workspace==='Camera Health'&&route.diagnostics)params.set('diagnostics','1');
  if(route.workspace==='Victron VRM'&&!route.jobId&&Number.isSafeInteger(route.installationId)&&(route.installationId??0)>0)params.set('installationId',String(route.installationId));
  if(route.workspace==='Daily Board'&&!route.jobId&&isTicketType(route.createType))params.set('create',route.createType);
  if(!route.jobId&&(['Fleet Dashboard','Camera Health','Unit Tracker'].includes(route.workspace)||(route.workspace==='Daily Board'&&isTicketType(route.createType)))&&isTicketUnitId(route.unitId))params.set('unit',route.unitId);
  if(route.workspace==='Fleet Dashboard'&&!route.unitId&&route.unitLabel&&route.unitLabel.length<=120&&!/[\u0000-\u001f]/.test(route.unitLabel))params.set('unitLabel',route.unitLabel);
  if(route.workspace==='Today'&&route.detail&&route.jobId)params.set('detail','1');
  return '#'+route.workspace.toLowerCase().replaceAll(' ','-')+(params.size?'?'+params:'');
}


/** Presentation routes only. Authorization and actions stay in their existing workspaces. */
export const workspaces = ['Today','Daily Board','Field Map','Vision','Camera Health','InHand Routers','Victron VRM','Dispatch','Calendar','Unscheduled','Customers','Sites','Work Requests','CRM','Quotes','Jobs','Tech Check','Owner Tasks','Handoffs','Owner Review','Equipment','Team','Purchasing','Billing','Invoices','Accounting','Collections','Payments','Needs Attention','History','Reports','Activity'];
export const workspaceGroups = [
  { label:'Overview', home:'Today', items:['Today','Daily Board','Owner Tasks','Needs Attention','Activity'] },
  { label:'Jobs', home:'Jobs', items:['Jobs','Unscheduled','Dispatch','Calendar','Owner Review','Handoffs','Tech Check'] },
  { label:'Fleet & Map', home:'Field Map', items:['Field Map','Equipment','Camera Health','InHand Routers','Victron VRM'] },
  { label:'Customers', home:'Customers', items:['Customers','Sites','Work Requests','CRM','Quotes'] },
  { label:'Office', home:'Team', items:['Team','Purchasing','Billing','Accounting','Collections','Payments','History','Reports'] },
];
export const workspaceLabel = (name:string) => ({Today:'Overview','Daily Board':'Dispatch Board',Billing:'Billing & Invoices',Invoices:'Billing & Invoices'} as Record<string,string>)[name] || name;
export const workspaceGroup = (name:string) => workspaceGroups.find(group=>group.items.includes(name==='Invoices'?'Billing':name)) || workspaceGroups[0];
export type WorkspaceRoute = { workspace:string; jobId:string; detail:boolean };
export function readWorkspaceRoute(hash:string=location.hash):WorkspaceRoute {
  const [key,query=''] = hash.replace(/^#/,'').split('?');
  const aliases:Record<string,string> = {overview:'Today','dispatch-board':'Daily Board'};
  const workspace = aliases[key] || workspaces.find(name=>name.toLowerCase().replaceAll(' ','-')===key) || 'Today';
  const params = new URLSearchParams(query);
  return {workspace,jobId:params.get('job')||'',detail:workspace==='Today'&&params.get('detail')==='1'};
}
export function workspaceHash(route:WorkspaceRoute) {
  const params = new URLSearchParams();
  if(route.jobId)params.set('job',route.jobId);
  if(route.workspace==='Today'&&route.detail&&route.jobId)params.set('detail','1');
  return '#'+route.workspace.toLowerCase().replaceAll(' ','-')+(params.size?'?'+params:'');
}

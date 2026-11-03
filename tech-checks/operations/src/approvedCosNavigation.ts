/** Display metadata only. Canonical routes and authorization remain in App. */
export const approvedPrimaryAreas = [
  {workspace:'Fleet Dashboard', label:'Fleet', icon:'fleet'},
  {workspace:'Daily Board', label:'Boards', icon:'boards'},
  {workspace:'Tech Check', label:'Tech Check', icon:'checks'},
  {workspace:'Team', label:'Team', icon:'team'},
  {workspace:'Operations', label:'More', icon:'more'},
] as const;
export type ApprovedIcon = typeof approvedPrimaryAreas[number]['icon'];

const fleetAreas = new Set(['Fleet Dashboard','Camera Health','Unit Tracker','Units On Hand','InHand Routers','Victron VRM','Equipment']);
export function approvedArea(workspace:string):string {
  if(fleetAreas.has(workspace))return 'Fleet Dashboard';
  if(workspace==='Daily Board')return 'Daily Board';
  if(workspace==='Tech Check'||workspace==='Handoffs')return 'Tech Check';
  if(workspace==='Team'||workspace==='Owner Tasks')return 'Team';
  return 'Operations';
}
export function approvedWorkspaceLabel(workspace:string, fallback=workspace):string {
  return approvedPrimaryAreas.find(area=>area.workspace===workspace)?.label || fallback;
}

// These are the original workspace keys, not replacement pages or data sources.
export const approvedToolGroups = [
  {label:'Fleet tools', items:['Camera Health','Units On Hand','Unit Tracker','InHand Routers','Victron VRM','Equipment']},
  {label:'Daily review & calendar', items:['Today','Owner Tasks','Needs Attention','Calendar','Handoffs','History','Activity','Reports']},
  {label:'Customers & sites', items:['Customers','Sites','Work Requests','CRM']},
  {label:'Finance & purchasing', items:['Quotes','Purchasing','Billing','Accounting','Collections','Payments']},
  {label:'Existing workflows & assistant', items:['Jobs','Unscheduled','Dispatch','Owner Review','Vision']},
] as const;
export function visibleApprovedTools(items:readonly string[],trackerVisible:boolean):string[] {
  return items.filter(workspace=>workspace!=='Unit Tracker'||trackerVisible);
}

/** Display metadata only. Canonical routes and authorization remain in App. */
//
// James, 2026-11-12: "I am not going to be using this as a program like MHelp
// at all... remove things that would make it seem like an MHelp or revio
// program." COS is his camera fleet tool, so the ticketing, dispatch and
// billing workspaces are no longer offered anywhere in the menu. He asked to
// keep Customers, Sites and Calendar.
//
// This file is presentation only: nothing is deleted, no route is removed and
// no authorization changes. A workspace left out here is simply not offered;
// putting one back is one line in RETIRED_WORKSPACES and its group.
export const approvedPrimaryAreas = [
  {workspace:'Fleet Dashboard', label:'Fleet', icon:'fleet'},
  {workspace:'Tech Check', label:'Tech Check', icon:'checks'},
  {workspace:'Team', label:'Team', icon:'team'},
  {workspace:'Operations', label:'More', icon:'more'},
] as const;
export type ApprovedIcon = typeof approvedPrimaryAreas[number]['icon'];

/**
 * Workspaces COS no longer offers: the service-management side that made this
 * look like mHelpDesk or ReVio. The code and routes stay; only the menu stops
 * pointing at them.
 */
export const RETIRED_WORKSPACES = [
  'Jobs','Dispatch','Unscheduled','Work Requests','Quotes','CRM',
  'Billing','Invoices','Payments','Collections','Accounting','Purchasing','Reports',
  'Daily Board','Owner Review','Owner Tasks','Handoffs','Needs Attention',
] as const;

const fleetAreas = new Set(['Fleet Dashboard','Camera Health','Unit Tracker','Units On Hand','InHand Routers','Victron VRM','Equipment']);
export function approvedArea(workspace:string):string {
  if(fleetAreas.has(workspace))return 'Fleet Dashboard';
  if(workspace==='Tech Check')return 'Tech Check';
  if(workspace==='Team')return 'Team';
  return 'Operations';
}
export function approvedWorkspaceLabel(workspace:string, fallback=workspace):string {
  return approvedPrimaryAreas.find(area=>area.workspace===workspace)?.label || fallback;
}

// These are the original workspace keys, not replacement pages or data sources.
export const approvedToolGroups = [
  {label:'Fleet tools', items:['Camera Health','Units On Hand','Unit Tracker','InHand Routers','Victron VRM','Equipment']},
  {label:'Customers & sites', items:['Customers','Sites']},
  {label:'Calendar & history', items:['Today','Calendar','History','Activity']},
  {label:'Assistant', items:['Vision']},
] as const;
export function visibleApprovedTools(items:readonly string[],trackerVisible:boolean):string[] {
  return items.filter(workspace=>workspace!=='Unit Tracker'||trackerVisible);
}

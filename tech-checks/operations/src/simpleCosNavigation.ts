/**
 * Presentation-only COS navigation. Keep original workspace hashes and all
 * server-side role checks intact; hiding a link never changes authorization.
 */
export type CosSimpleArea = { workspace: string; label: string; icon: string };
export const ownerMainAreas: readonly CosSimpleArea[] = [
  {workspace:'COS Overview',label:'Overview',icon:'dashboard'},
  {workspace:'Units On Hand',label:'Inventory & Transfers',icon:'units'},
  {workspace:'Camera Health',label:'Camera Health',icon:'camera'},
  {workspace:'Fleet Dashboard',label:'Fleet Map',icon:'map'},
  {workspace:'Victron VRM',label:'Power & Routers',icon:'power'},
  {workspace:'Unit Tracker',label:'Unit Tracker',icon:'units'},
  {workspace:'Team',label:'Team & Tech Check',icon:'team'},
  {workspace:'Calendar',label:'Calendar',icon:'operations'},
];
export const ownerAdvancedAreas: readonly CosSimpleArea[] = [
  {workspace:'Today',label:'Legacy daily and job overview',icon:'dashboard'},
  {workspace:'Operations',label:'Existing Operations tools',icon:'operations'},
  {workspace:'Daily Board',label:'Existing TV and daily board controls',icon:'dashboard'},
  {workspace:'Owner Tasks',label:'Owner assignments',icon:'team'},
  {workspace:'Equipment',label:'Equipment administration',icon:'units'},
];
export function ownerNavigation(trackerAllowed:boolean):CosSimpleArea[] {
  return ownerMainAreas.filter(area=>area.workspace!=='Unit Tracker'||trackerAllowed);
}
/** No Fleet-only navigation destination may exceed the verified route allow-list. */
export function itNavigation(allowedWorkspaces:readonly string[]):CosSimpleArea[] {
  const allowed=new Set(allowedWorkspaces);
  const power=allowed.has('Victron VRM')?'Victron VRM':allowed.has('InHand Routers')?'InHand Routers':'';
  const candidates:CosSimpleArea[] = [
    {workspace:'IT Dashboard',label:'Overview',icon:'dashboard'},
    {workspace:'Tech Check',label:'Inventory & Transfers',icon:'units'},
    {workspace:'Camera Health',label:'Camera Health',icon:'camera'},
    {workspace:'Fleet Dashboard',label:'Fleet Map',icon:'map'},
    ...(power?[{workspace:power,label:'Power & Routers',icon:'power'}]:[]),
    {workspace:'Unit Tracker',label:'Unit Tracker',icon:'units'},
  ];
  return candidates.filter(area=>allowed.has(area.workspace));
}
export function areaSelected(active:string,areaWorkspace:string):boolean {
  return active===areaWorkspace||
    areaWorkspace==='Team'&&active==='Tech Check'||
    (areaWorkspace==='Victron VRM'||areaWorkspace==='InHand Routers')&&
      (active==='Victron VRM'||active==='InHand Routers');
}

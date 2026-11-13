import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {approvedPrimaryAreas,approvedArea,approvedWorkspaceLabel,approvedToolGroups,visibleApprovedTools,RETIRED_WORKSPACES} from '../src/approvedCosNavigation.ts';
const source=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const sha=value=>createHash('sha256').update(value).digest('hex');
// Protected baseline: reviewed main 12a2dff071ee545efb6e0d380a0f78abbb5c4088.
const app=source('App.tsx');

test('Owner navigation has exactly four unique destinations',()=>{
 // Boards went with the rest of the service-management side (James, 2026-11-12).
 assert.deepEqual(approvedPrimaryAreas.map(x=>x.label),['Fleet','Tech Check','Team','More']);
 assert.deepEqual(approvedPrimaryAreas.map(x=>x.workspace),['Fleet Dashboard','Tech Check','Team','Operations']);
 assert.equal(new Set(approvedPrimaryAreas.map(x=>x.workspace)).size,4);
});
test('mobile exposes three destinations plus the existing More dialog button',()=>{
 assert.deepEqual(approvedPrimaryAreas.filter(x=>x.workspace!=='Operations').map(x=>x.label),['Fleet','Tech Check','Team']);
 assert.match(source('ApprovedCosNavigation.tsx'),/!mobile\|\|area.workspace!=='Operations'/);
 assert.match(app,/<ApprovedCosNavigation active=\{active\} navigate=\{navigate\} mobile\/>/);
 assert.match(app,/aria-label='More' aria-expanded=\{menu\}/);
});
test('secondary workspaces select their primary area without redirecting',()=>{
 for(const key of ['Fleet Dashboard','Camera Health','Unit Tracker','Units On Hand','InHand Routers','Victron VRM','Equipment'])assert.equal(approvedArea(key),'Fleet Dashboard');
 assert.equal(approvedArea('Tech Check'),'Tech Check');
 assert.equal(approvedArea('Team'),'Team');
 // A retired workspace still resolves: its route works, it is just not offered.
 for(const key of ['Calendar','Vision','Daily Board','Handoffs','Owner Tasks','Jobs','Invoices'])assert.equal(approvedArea(key),'Operations');
});
test('short labels do not change canonical keys or secondary labels',()=>{
 assert.equal(approvedWorkspaceLabel('Daily Board','Dispatch Board'),'Dispatch Board');
 assert.equal(approvedWorkspaceLabel('Camera Health','Camera Health'),'Camera Health');
 assert.equal(approvedWorkspaceLabel('Victron VRM','Victron Power'),'Victron Power');
});
test('COS offers its own workspaces and none of the service-management ones',()=>{
 // James, 2026-11-12: COS is not to look like mHelpDesk or ReVio. He kept
 // Customers, Sites and Calendar; the ticketing, dispatch and billing
 // workspaces are offered nowhere, while their routes stay intact.
 const destinations=new Set([...approvedPrimaryAreas.map(x=>x.workspace),...approvedToolGroups.flatMap(x=>x.items)]);
 const offered=['Fleet Dashboard','Camera Health','Units On Hand','Unit Tracker','InHand Routers','Victron VRM','Equipment',
  'Customers','Sites','Today','Calendar','History','Activity','Vision','Tech Check','Team','Operations'];
 for(const key of offered)assert.ok(destinations.has(key),'should still be offered: '+key);
 for(const key of RETIRED_WORKSPACES)assert.ok(!destinations.has(key),'should no longer be offered: '+key);
 assert.equal(destinations.size,offered.length,'nothing unexpected in the menu');
 const secondary=approvedToolGroups.flatMap(x=>x.items);
 assert.equal(new Set(secondary).size,secondary.length);
});
test('tracker entry respects existing eligibility and does not mutate group metadata',()=>{
 const items=['Camera Health','Unit Tracker','Victron VRM'];
 assert.deepEqual(visibleApprovedTools(items,false),['Camera Health','Victron VRM']);
 assert.deepEqual(visibleApprovedTools(items,true),items);
 assert.deepEqual(items,['Camera Health','Unit Tracker','Victron VRM']);
 assert.equal((app.match(/trackerVisible=\{trackerAccess\(session\)\}/g)||[]).length,2);
});
test('presentation metadata and primary buttons do not read or write operational data',()=>{
 for(const file of ['approvedCosNavigation.ts','ApprovedCosNavigation.tsx'])
  assert.doesNotMatch(source(file),/\b(?:fetch|setInterval|setTimeout|localStorage|sessionStorage)\b|api\.(?:get|post)|history\.(?:pushState|replaceState)/);
});
test('native readers and Fleet/Board mounts have no added props or remount keys',()=>{
 const fleet=app.split('\n').find(x=>x.includes('<FleetDashboard session='));
 const board=app.split('\n').find(x=>x.includes('<DailyBoard api='));
 assert.equal(sha(fleet),"1cd46ebcc23761421cb39bad170b0e07ecf6999ecdb8e4e27c1cfe9cc523cf12");
 assert.equal(sha(board),"2060863c57ccd4f109fbaf828d1e5fcf15be2db635d7caba62698ffb88297285");
});
const preserved=[
  [
    "ownerTaskWorkflow",
    "function OwnerTasksWorkspace(",
    "function OwnerApp()",
    "8f84aee2187c3f970e7cb5fd7657850e3274c5392c951d6e4d87396275201f33"
  ],
  [
    "sessionAndTv",
    "  const {session, checking",
    "  const dailyOnly=",
    "5c7cfe4eb4da1389eb9ff64bc2cba5191be40358d112d4251699f47807a5f246"
  ],
  [
    "roleEligibility",
    "  const dailyOnly=",
    "  const label=",
    "ffeff39b054a1dc03093d8ee5184f1a429c8846ba9b7e92a2b2dbb4873712035"
  ],
  [
    "navigationAndUnitHandlers",
    "  const navigate=useCallback",
    "  const authorized=session",
    "00c8dc8e5e9f8a102d00fdb40cc93ff9446bd6f0ce7d1d4c6d2b08fcc7670220"
  ],
  [
    "sessionRedirect",
    "  const authorized=session",
    "  const condition=",
    "9a04a3dffed9ce714a9e99c0e9c485f786dd38441535c7c087d50a44cbc1846b"
  ]
];
for(const [name,start,end,digest] of preserved)test('unchanged protected source: '+name,()=>{
 const offset=app.indexOf(start); assert.ok(offset>=0);
 const stop=app.indexOf(end,offset); assert.ok(stop>offset);
 assert.equal(sha(app.slice(offset,stop)),digest);
});
test('existing equipment workflow destinations are preserved exactly',()=>{
 const text=source('TechChecksWorkspace.tsx');
 const routes=[...text.matchAll(/route:'([^']+)'/g)].map(x=>x[1]);
 assert.deepEqual(routes,['assign','team','review','handoffs','calendar','attention','units','history','activity','accounts','testcenter']);
 assert.match(text,/openLegacy\('it'\)/); assert.match(text,/openLegacy\('service'\)/);
 assert.match(text,/Service jobs are created in mHelp/);
 assert.doesNotMatch(text,/api\.(?:get|post)|fetch\(/);
});
test('More groups remain keyboard-operable under the existing focus trap',()=>{
 assert.match(app,/input:not\(:disabled\),summary/);
 assert.match(app,/if\(event.key==='Escape'\)/);
 assert.match(app,/if\(previous\?\.isConnected\)previous.focus\(\)/);
 assert.match(app,/<main className='owner-it-main' inert=\{menu\}/);
 assert.match(source('OperationsAreas.tsx'),/<summary>\{group.label\}<\/summary>/);
});
test('new style scope cannot change camera state, map, TV, or login selectors',()=>{
 const css=source('approvedCosNavigation.css');
 assert.doesNotMatch(css,/\.(?:cos-fleet|camera-health|cos-daily-board|cos-signal|leaflet|login|cos-tv)/);
 assert.ok(css.includes('grid-template-columns:repeat(5,minmax(0,1fr))'));
 assert.doesNotMatch(css,/^\s*(?::root|body|html)\s*[,{]/m);
});

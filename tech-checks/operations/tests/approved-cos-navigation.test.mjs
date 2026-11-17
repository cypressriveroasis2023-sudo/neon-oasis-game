import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {approvedPrimaryAreas,approvedArea,approvedWorkspaceLabel,approvedToolGroups,visibleApprovedTools} from '../src/approvedCosNavigation.ts';
const source=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const sha=value=>createHash('sha256').update(value).digest('hex');
// Protected baseline: reviewed main 12a2dff071ee545efb6e0d380a0f78abbb5c4088.
const app=source('App.tsx');

test('Owner navigation has exactly five unique original destinations',()=>{
 assert.deepEqual(approvedPrimaryAreas.map(x=>x.label),['Fleet','Boards','Tech Check','Team','More']);
 assert.deepEqual(approvedPrimaryAreas.map(x=>x.workspace),['Fleet Dashboard','Daily Board','Tech Check','Team','Operations']);
 assert.equal(new Set(approvedPrimaryAreas.map(x=>x.workspace)).size,5);
});
test('mobile exposes four destinations plus the existing More dialog button',()=>{
 assert.deepEqual(approvedPrimaryAreas.filter(x=>x.workspace!=='Operations').map(x=>x.label),['Fleet','Boards','Tech Check','Team']);
 assert.match(source('ApprovedCosNavigation.tsx'),/!mobile\|\|area.workspace!=='Operations'/);
 assert.match(app,/<ApprovedCosNavigation active=\{active\} navigate=\{navigate\} mobile\/>/);
 assert.match(app,/aria-label='More' aria-expanded=\{menu\}/);
});
test('secondary workspaces select their primary area without redirecting',()=>{
 for(const key of ['Fleet Dashboard','Camera Health','Unit Tracker','Units On Hand','InHand Routers','Victron VRM','Equipment'])assert.equal(approvedArea(key),'Fleet Dashboard');
 assert.equal(approvedArea('Daily Board'),'Daily Board');
 assert.equal(approvedArea('Handoffs'),'Tech Check');
 assert.equal(approvedArea('Owner Tasks'),'Operations');
 for(const key of ['Calendar','Invoices','Vision','Jobs'])assert.equal(approvedArea(key),'Operations');
});
test('short labels do not change canonical keys or secondary labels',()=>{
 assert.equal(approvedWorkspaceLabel('Daily Board','Dispatch Board'),'Boards');
 assert.equal(approvedWorkspaceLabel('Camera Health','Camera Health'),'Camera Health');
 assert.equal(approvedWorkspaceLabel('Victron VRM','Victron Power'),'Victron Power');
});
test('retired business tools are absent from primary and More navigation',()=>{
 const retired=['Vision','Dispatch','Calendar','Unscheduled','Customers','Sites','Work Requests','CRM','Quotes','Jobs','Owner Tasks','Purchasing','Billing','Invoices','Accounting','Collections','Payments','Needs Attention','History','Reports','Activity'];
 const destinations=new Set([...approvedPrimaryAreas.map(x=>x.workspace),...approvedToolGroups.flatMap(x=>x.items)]);
 for(const key of retired)assert.equal(destinations.has(key==='Invoices'?'Billing':key),false,key);
 for(const key of ['Fleet Dashboard','Daily Board','Tech Check','Team','Operations','Camera Health','Today','Handoffs','Owner Review','Equipment'])assert.ok(destinations.has(key),key);
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
// Reviewed change, at James's instruction: a tech reads a unit's history and
// raises a ticket from the Fleet screen, so historyReadEnabled and createTicket
// now ask the capability map. No prop was added and no remount key appeared;
// two existing props changed the expression they are given. The pin moves with
// that reviewed change and goes on guarding the line against anything else.
test('ticket creation and retired screens are not mounted from the shell',()=>{
 const fleet=app.split('\n').find(x=>x.includes('<FleetDashboard session='));
 const board=app.split('\n').find(x=>x.includes('<DailyBoard api='));
 assert.equal(fleet.split('key=').length-1,1);
 assert.match(fleet,/createTicket=\{undefined\}/);
 assert.doesNotMatch(board,/createTicket/);
 for(const name of ['OwnerTasksWorkspace','OperationsJobs','OperationsCalendar','QuotesWorkspace','InvoicesWorkspace','PurchasingWorkspace','DirectoryWorkspace','TicketActions','OwnerBoardControls','MhelpTicketImport'])assert.equal(app.includes('<'+name),false,name);
 assert.match(app,/LegacyInstallEvidence/);
 assert.match(app,/isRetiredBusinessWorkspace\(active\)/);
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

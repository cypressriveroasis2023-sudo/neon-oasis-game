import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {workspaces,workspaceGroups,hiddenWorkspaces,readWorkspaceRoute,workspaceHash} from '../src/workspaceNavigation.ts';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('every company route is either shown in a group or deliberately hidden',()=>{
  assert.deepEqual(workspaceGroups.map(g=>g.label),['Overview','Job flow','Schedule','Equipment','Customers','Team']);
  const destinations=workspaceGroups.flatMap(g=>g.items);
  assert.equal(new Set(destinations).size,destinations.length);
  // The owner does not use these, so they are off the navigation. They stay
  // routable, and this list is what stops one falling off unnoticed.
  assert.deepEqual([...destinations,...hiddenWorkspaces,'Vision','Invoices'].sort(),[...workspaces].sort());
  assert.equal(new Set([...destinations,...hiddenWorkspaces]).size,destinations.length+hiddenWorkspaces.length);
  for(const workspace of workspaces) assert.equal(readWorkspaceRoute(workspaceHash({workspace,jobId:'',detail:false})).workspace,workspace);
});

test('a hidden workspace still opens from an old link',()=>{
  // Hiding is not deleting: a bookmark must not land somewhere else silently.
  for(const workspace of hiddenWorkspaces)
   assert.equal(readWorkspaceRoute(workspaceHash({workspace,jobId:'',detail:false})).workspace,workspace);
});
test('native app uses exact approved dark palette and self-hosted Open Sans',()=>{
  const css=read('../src/companyTheme.css');
  for(const color of ['#172337','#0B111C','#C8102E','#E6EDF7','#A3B3CA','#2C3B51','#203456','#15352D','#83D6AD','#3B2D18','#EDC27B']) assert.ok(css.includes(color),color);
  assert.match(css,/grid-template-columns:184px minmax\(0,1fr\)/);
  assert.match(css,/height:76px/);
  for(const weight of ['regular','semibold','bold']) assert.ok(existsSync(new URL('../../resources/fonts/open-sans-'+weight+'.woff',import.meta.url)));
  const main=read('../src/main.tsx');
  assert.ok(!main.includes("import '../../vision-platform.css'"));
  assert.match(main,/dataset.theme = 'dark'/);
  const app=read('../src/App.tsx');
  assert.ok(!app.includes('setTheme'));
  assert.match(app,/localStorage.setItem\('cos-operations-pages-theme','dark'\)/);
});
test('dark host overlay is loaded last and does not import workflow code',()=>{
  const html=read('../../index.html');
  assert.ok(html.indexOf('company-host-theme.css')>html.indexOf('vision-platform.css'));
  const css=read('../../company-host-theme.css');
  assert.ok(css.includes('#view-it')&&css.includes('#view-svc'));
  assert.ok(!css.includes('@import'));
  assert.ok(!css.includes('display:none'));
});


test('Fleet uses the existing COS type and surface tokens without its own branded shell',()=>{
 const css=read('../src/fleetDashboard.css');
 for(const token of ['--cos-vision-bg','--cos-vision-panel','--cos-border','--cos-text','--cos-muted','--cos-selected','--cos-blue'])assert.ok(css.includes('var('+token+')'),token);
 assert.match(css,/\.cos-fleet-dashboard\{[^}]*font:inherit/);
 assert.doesNotMatch(css,/font:14px\/1.5 Arial|#ff354e|#d71935|\.cos-fleet-brand/);
 assert.match(css,/\.cos-fleet-unit-health-grid\{/);
 assert.match(css,/\.cos-fleet-power-metrics\{/);
});


test('unlinked source equipment uses COS surfaces and wraps its record identities at every size',()=>{
 const css=read('../src/fleetDashboard.css');
 assert.match(css,/\.cos-fleet-source-record\{[^}]*background:var\(--cos-vision-panel\)[^}]*overflow-wrap:anywhere/);
 assert.match(css,/\.cos-fleet-source-record li\{[^}]*overflow-wrap:anywhere/);
 assert.match(css,/\.cos-fleet-source-group-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(css,/@media\(max-width:750px\)\{\.cos-fleet-source-group-grid\{grid-template-columns:1fr/);
});

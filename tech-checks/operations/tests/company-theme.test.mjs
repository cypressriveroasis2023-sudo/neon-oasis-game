import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {workspaces,workspaceGroups,hiddenWorkspaces,retiredBusinessWorkspaces,readWorkspaceRoute,workspaceHash} from '../src/workspaceNavigation.ts';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('every company route is shown or retired to Today',()=>{
  assert.deepEqual(workspaceGroups.map(g=>g.label),['Overview','Cameras & handoff','Equipment','Team']);
  const destinations=workspaceGroups.flatMap(g=>g.items);
  assert.equal(new Set(destinations).size,destinations.length);
  assert.deepEqual([...destinations,...hiddenWorkspaces,...retiredBusinessWorkspaces].sort(),[...workspaces].sort());
  for(const workspace of destinations) assert.equal(readWorkspaceRoute(workspaceHash({workspace,jobId:'',detail:false})).workspace,workspace);
  for(const workspace of retiredBusinessWorkspaces) assert.equal(readWorkspaceRoute(workspaceHash({workspace,jobId:'job',detail:true})).workspace,'Today');
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

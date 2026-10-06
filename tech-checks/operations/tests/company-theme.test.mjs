import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {workspaces,workspaceGroups,workspaceGroup,readWorkspaceRoute,workspaceHash} from '../src/workspaceNavigation.ts';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('approved seven company areas preserve every route and billing alias',()=>{
  assert.deepEqual(workspaceGroups.map(g=>g.label),['Overview','Job flow','Schedule','Equipment','Customers','Team','Finance']);
  const destinations=workspaceGroups.flatMap(g=>g.items);
  assert.equal(new Set(destinations).size,destinations.length);
  assert.deepEqual([...destinations,'Vision','Invoices'].sort(),[...workspaces].sort());
  assert.equal(workspaceGroup('Invoices').label,'Finance');
  for(const workspace of workspaces) assert.equal(readWorkspaceRoute(workspaceHash({workspace,jobId:'',detail:false})).workspace,workspace);
});
test('native app uses exact approved dark palette and self-hosted Open Sans',()=>{
  const css=read('../src/companyTheme.css');
  for(const color of ['#172337','#0B111C','#315FDF','#E6EDF7','#A3B3CA','#2C3B51','#203456','#15352D','#83D6AD','#3B2D18','#EDC27B']) assert.ok(css.includes(color),color);
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


import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaces,workspaceGroups,workspaceGroup,workspaceLabel,workspaceHash,readWorkspaceRoute} from '../src/workspaceNavigation.ts';
test('seven company areas cover every canonical destination with only the deliberate invoice alias',()=>{
  assert.deepEqual(workspaceGroups.map(group=>group.label),['Overview','Job flow','Schedule','Equipment','Customers','Team','Finance']);
  const items=workspaceGroups.flatMap(group=>group.items);
  assert.equal(new Set(items).size,items.length);
  assert.deepEqual([...items,'Invoices','Vision'].sort(),[...workspaces].sort());
  assert.equal(workspaceGroup('Invoices').label,'Finance');
  assert.equal(workspaceLabel('Today'),'Overview');
  assert.equal(workspaceLabel('Daily Board'),'Dispatch Board');
  assert.equal(workspaceLabel('Invoices'),workspaceLabel('Billing'));
});
test('every existing workspace bookmark retains its canonical destination',()=>{
  for(const workspace of workspaces){
    const route={workspace,jobId:'',detail:false};
    assert.deepEqual(readWorkspaceRoute(workspaceHash(route)),route);
  }
  assert.equal(readWorkspaceRoute('#overview').workspace,'Today');
  assert.equal(readWorkspaceRoute('#dispatch-board').workspace,'Daily Board');
  assert.equal(readWorkspaceRoute('#unknown').workspace,'Today');
});
test('job identity and mobile detail survive URL encoding without creating another destination',()=>{
  const route={workspace:'Today',jobId:'job / 42?&',detail:true};
  assert.deepEqual(readWorkspaceRoute(workspaceHash(route)),route);
  assert.deepEqual(readWorkspaceRoute('#jobs?job=42&detail=1'),{workspace:'Jobs',jobId:'42',detail:false});
  assert.equal(workspaceHash({workspace:'Today',jobId:'',detail:true}),'#today');
});


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

test('ticket bookmarks use only existing job types on Dispatch Board without a job target',()=>{
  for(const createType of ['SERVICE','PICKUP','DELIVERY','SWAP']){
    const route={workspace:'Daily Board',jobId:'',detail:false,createType};
    assert.deepEqual(readWorkspaceRoute(workspaceHash(route)),route);
    assert.equal(workspaceHash(route),'#daily-board?create='+createType);
  }
  for(const hash of ['#daily-board?create=INSTALL','#jobs?create=SWAP','#today?create=SERVICE','#daily-board?job=42&create=PICKUP']){
    assert.equal(readWorkspaceRoute(hash).createType,undefined);
  }
});

test('map, unit health and ticket routes retain a validated stable unit identifier',()=>{
 const unitId='11111111-1111-4111-8111-111111111111';
 for(const workspace of ['Field Map','Camera Health','Daily Board']){
  const route={workspace,jobId:'',detail:false,unitId,...(workspace==='Daily Board'?{createType:'SWAP'}:{})};
  assert.deepEqual(readWorkspaceRoute(workspaceHash(route)),route);
 }
 for(const hash of ['#today?unit='+unitId,'#jobs?unit='+unitId,'#camera-health?unit=Some%20unit','#daily-board?unit='+unitId,'#camera-health?job=42&unit='+unitId])assert.equal(readWorkspaceRoute(hash).unitId,undefined);
});

test('legacy camera field links preserve full unit labels without treating numbers as IDs',()=>{const route=readWorkspaceRoute('#field-map?unitLabel=SNIPER%20312');assert.equal(route.unitLabel,'SNIPER 312');assert.equal(workspaceHash(route),'#field-map?unitLabel=SNIPER+312');assert.equal(readWorkspaceRoute('#camera-health?unitLabel=312').unitLabel,undefined);});

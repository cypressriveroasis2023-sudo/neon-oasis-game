
import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaces,workspaceGroups,hiddenWorkspaces,retiredBusinessWorkspaces,workspaceLabel,workspaceHash,readWorkspaceRoute} from '../src/workspaceNavigation.ts';
test('kept areas cover the camera workspace and retired screens are not shown',()=>{
  assert.deepEqual(workspaceGroups.map(group=>group.label),['Overview','Cameras & handoff','Equipment','Team']);
  const items=workspaceGroups.flatMap(group=>group.items);
  assert.equal(new Set(items).size,items.length);
  assert.deepEqual([...items,...hiddenWorkspaces,...retiredBusinessWorkspaces].sort(),[...workspaces].sort());
  for(const retired of retiredBusinessWorkspaces) assert.ok(!items.includes(retired),retired+' is still shown');
  assert.equal(workspaceLabel('Today'),'Overview');
  assert.equal(workspaceLabel('Daily Board'),'Dispatch Board');
});
test('retired business bookmarks open Today and do not keep a job or ticket target',()=>{
  for(const hash of ['#jobs','#unscheduled','#dispatch','#calendar','#quotes','#invoices','#billing','#purchasing','#crm','#customers','#sites','#work-requests','#owner-tasks','#jobs?job=42&detail=1','#today?job=42&detail=1','#daily-board?create=SERVICE']){
    const route=readWorkspaceRoute(hash);
    if(hash.startsWith('#daily-board')||hash.startsWith('#today')){
      assert.equal(route.workspace,hash.startsWith('#today')?'Today':'Daily Board');
      assert.equal(route.detail,false);
      assert.equal(route.createType,undefined);
      assert.equal(route.jobId,'');
    }else assert.deepEqual(route,{workspace:'Today',jobId:'',detail:false});
  }
  for(const workspace of retiredBusinessWorkspaces) assert.equal(workspaceHash({workspace,jobId:'42',detail:true}),'#today');
});

test('ticket bookmarks no longer open a job-create screen',()=>{
  for(const createType of ['SERVICE','PICKUP','DELIVERY','SWAP']){
    const route={workspace:'Daily Board',jobId:'',detail:false,createType};
    assert.equal(workspaceHash(route),'#daily-board');
    assert.equal(readWorkspaceRoute(workspaceHash(route)).createType,undefined);
  }
});

test('map and unit health retain a validated stable unit identifier',()=>{
 const unitId='11111111-1111-4111-8111-111111111111';
 for(const workspace of ['Fleet Dashboard','Camera Health','Unit Tracker']){
  const route={workspace,jobId:'',detail:false,unitId};
  assert.deepEqual(readWorkspaceRoute(workspaceHash(route)),route);
 }
 assert.equal(readWorkspaceRoute('#daily-board?unit='+unitId).unitId,undefined);
 for(const hash of ['#today?unit='+unitId,'#jobs?unit='+unitId,'#camera-health?unit=Some%20unit','#camera-health?job=42&unit='+unitId])assert.equal(readWorkspaceRoute(hash).unitId,undefined);
});

test('legacy camera field links preserve full unit labels without treating numbers as IDs',()=>{const route=readWorkspaceRoute('#field-map?unitLabel=SNIPER%20312');assert.equal(route.unitLabel,'SNIPER 312');assert.equal(workspaceHash(route),'#fleet-dashboard?unitLabel=SNIPER+312');assert.equal(readWorkspaceRoute('#camera-health?unitLabel=312').unitLabel,undefined);});

test('Victron bookmarks preserve only positive safe installation IDs',()=>{
 const route={workspace:'Victron VRM',jobId:'',detail:false,installationId:2048123};
 assert.deepEqual(readWorkspaceRoute(workspaceHash(route)),route);
 assert.deepEqual(readWorkspaceRoute('#victron-power?installationId=2048123'),route);
 for(const hash of ['#victron-vrm?installationId=0','#victron-vrm?installationId=-2','#victron-vrm?installationId=1.5','#victron-vrm?installationId=9007199254740993','#victron-vrm?installationId=HELIOS001','#victron-vrm?job=42&installationId=123','#today?installationId=123'])assert.equal(readWorkspaceRoute(hash).installationId,undefined);
});

test('IT-only dashboard and MHelp bookmarks do not change Owner workspace groups',()=>{for(const workspace of ['IT Dashboard','MHelp']){const route={workspace,jobId:'',detail:false};assert.deepEqual(readWorkspaceRoute(workspaceHash(route)),route);assert.equal(workspaces.includes(workspace),false);}});

test('advanced camera diagnostics is an explicit mode, not a new primary workspace',()=>{
 const unitId='11111111-1111-4111-8111-111111111111';
 const route={workspace:'Camera Health',jobId:'',detail:false,diagnostics:true,unitId};
 assert.deepEqual(readWorkspaceRoute(workspaceHash(route)),route);
 assert.equal(workspaceHash(route),'#camera-health?diagnostics=1&unit='+unitId);
 assert.equal(readWorkspaceRoute('#camera-health').diagnostics,undefined);
 for(const hash of ['#fleet-dashboard?diagnostics=1','#it-dashboard?diagnostics=1','#camera-health?diagnostics=yes'])assert.equal(readWorkspaceRoute(hash).diagnostics,undefined);
 assert.equal(workspaces.includes('Advanced camera diagnostics'),false);
});


test('an empty entry opens Fleet while explicit overview, job and TV bookmarks retain their intent',()=>{
  for(const hash of ['', '#', '#unrecognized'])assert.equal(readWorkspaceRoute(hash).workspace,'Fleet Dashboard');
  for(const hash of ['#today?job=42&detail=1','#overview?job=42&detail=1','#dashboard?job=42&detail=1']){
    assert.deepEqual(readWorkspaceRoute(hash),{workspace:'Today',jobId:'',detail:false});
  }
  assert.equal(readWorkspaceRoute('#daily-board').workspace,'Daily Board');
  assert.equal(readWorkspaceRoute('#tech-check').workspace,'Tech Check');
  assert.equal(readWorkspaceRoute('#it-dashboard').workspace,'IT Dashboard');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerMainAreas,ownerAdvancedAreas,ownerNavigation,itNavigation,areaSelected} from '../src/simpleCosNavigation.ts';

test('Owner sees exactly the eight everyday COS destinations in the requested order',()=>{
  assert.deepEqual(ownerMainAreas.map(area=>area.label),[
    'Overview','Inventory & Transfers','Camera Health','Fleet Map',
    'Power & Routers','Unit Tracker','Team & Tech Check','Calendar'
  ]);
  assert.equal(new Set(ownerMainAreas.map(area=>area.workspace)).size,8);
  assert.ok(ownerMainAreas.every(area=>area.icon));
  assert.ok(ownerAdvancedAreas.every(area=>!ownerMainAreas.some(main=>main.workspace===area.workspace)));
});
test('tracker authorization remains unchanged in the display',()=>{
  assert.equal(ownerNavigation(false).some(area=>area.workspace==='Unit Tracker'),false);
  assert.equal(ownerNavigation(true).some(area=>area.workspace==='Unit Tracker'),true);
});
test('IT menu never exposes a workspace missing from the pre-existing allowed routes',()=>{
  const allowed=['Fleet Dashboard','IT Dashboard','Camera Health','InHand Routers','Tech Check','MHelp'];
  const areas=itNavigation(allowed);
  assert.ok(areas.length>0);
  assert.ok(areas.every(area=>allowed.includes(area.workspace)));
  assert.equal(areas.find(area=>area.label==='Power & Routers')?.workspace,'InHand Routers');
  assert.equal(areas.some(area=>area.workspace==='Unit Tracker'),false);
  assert.equal(areas.some(area=>area.workspace==='MHelp'),false);
  assert.equal(itNavigation(['Fleet Dashboard','Camera Health']).length,2);
});
test('combined power and team destinations stay selected for their existing sub-views',()=>{
  assert.equal(areaSelected('Victron VRM','Victron VRM'),true);
  assert.equal(areaSelected('InHand Routers','Victron VRM'),true);
  assert.equal(areaSelected('Team','Team'),true);
  assert.equal(areaSelected('Tech Check','Team'),true);
  assert.equal(areaSelected('Camera Health','Fleet Dashboard'),false);
});

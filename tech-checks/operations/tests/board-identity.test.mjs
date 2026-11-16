import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const fleet=readFileSync(new URL('../src/FleetDashboard.tsx',import.meta.url),'utf8');
const camera=readFileSync(new URL('../src/FleetCameraStatus.tsx',import.meta.url),'utf8');
const totals=readFileSync(new URL('../src/FleetEquipmentTotals.tsx',import.meta.url),'utf8');

test('the Fleet board says it is inventory, not live health', () => {
 assert.match(fleet,/This board is inventory, not live health\./);
 assert.match(fleet,/from mHelp/);
});

test('Camera status says it is live evidence, not inventory', () => {
 assert.match(camera,/This board is live camera evidence, not inventory\./);
});

test('each board points at the other for what it does not cover', () => {
 // The failure this prevents is comparing two totals that count different
 // populations and concluding the app is wrong.
 assert.match(fleet,/use Camera status/);
 assert.match(camera,/use the Fleet board/);
});

test('both lines come before the detail, not buried under it', () => {
 const fleetIdentity=fleet.indexOf('This board is inventory');
 const fleetScope=fleet.indexOf('<strong>Scope:</strong>');
 assert.ok(fleetIdentity>-1&&fleetScope>-1&&fleetIdentity<fleetScope,'Fleet identity must precede Scope');
 const cameraIdentity=camera.indexOf('This board is live camera evidence');
 const cameraDetail=camera.indexOf('Every camera unit, one line each');
 assert.ok(cameraIdentity>-1&&cameraDetail>-1&&cameraIdentity<cameraDetail,'Camera identity must precede the detail');
});

test('the camera inventory total is marked as inventory where it is shown', () => {
 // 195 here against 179 on Camera status is what sent the owner looking for a
 // fault. The number now says which kind of count it is.
 assert.match(totals,/inventory count, not a live reading/);
});

test('both identity lines use the same styling hook', () => {
 for(const [name,src] of [['fleet',fleet],['camera',camera]])
  assert.match(src,/className='cos-board-identity'/,name+' is missing the hook');
});

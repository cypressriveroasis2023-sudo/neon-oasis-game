import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fieldCountMirrorsWatchful,fleetMapStageActive,fleetMapStageEnabled,fleetStageRead,STAGE_DOWN_COLOR,STAGE_SHOP_COLOR,STAGE_UNKNOWN_COLOR,stageBoardBoxes,stageIcon,stagePlacement,stageSharedBoxes,stageUnitsFromRows,unitsForBox} from '../src/fleetMapStage.ts';
import {censusFromDashboardRows,selectFleetCounts} from '../src/sharedFleetCounts.ts';
import {rollbackFleetMapStageSource} from './fleet-map-stage-rollback.mjs';
import {beforeFleetMapStageSource} from './fleet-map-stage-source.mjs';

const now = Date.parse('2026-11-19T17:48:00Z');
const fresh = new Date(now - 5 * 60 * 1000).toISOString();
const stale = new Date(now - 21 * 60 * 1000).toISOString();
const unit = (patch)=>stageUnitsFromRows([{
  id: patch.id, name: patch.name, site: 'Synthetic yard', placement: 'field', status: 'up', observedAt: fresh, point: [30, -95],
  inWatchful: true, immix: false, arming: 'Auto', armingObservedAt: fresh, ...patch,
}])[0];

test('a read older than 20 minutes, missing, or failed is Unknown and never Down',()=>{
  for(const sample of [
    unit({id:'stale',name:'Stale unit',status:'down',observedAt:stale}),
    unit({id:'missing',name:'Missing unit',status:'down',observedAt:null}),
    unit({id:'failed',name:'Failed unit',status:'down',readFailed:true}),
  ]){
    const icon = stageIcon(sample,now);
    assert.equal(icon.icon,'unknown');
    assert.equal(icon.label,'Unknown');
    assert.equal(icon.color,STAGE_UNKNOWN_COLOR);
    assert.equal(STAGE_UNKNOWN_COLOR,'#94a3b8');
    assert.notEqual(icon.label,'Down');
    assert.notEqual(icon.color,STAGE_DOWN_COLOR);
  }
  assert.equal(stageIcon(unit({id:'down',name:'Down unit',status:'down'}),now).label,'Down');
  assert.equal(stageIcon(unit({id:'up',name:'Up unit',status:'up'}),now).label,'Up');
});

test('an in-shop unit is never red, even when the reading says down',()=>{
  const icon = stageIcon(unit({id:'shop',name:'Shop bench',placement:'shop',status:'down'}),now);
  assert.equal(icon.icon,'shop');
  assert.equal(icon.label,'In shop');
  assert.equal(icon.color,STAGE_SHOP_COLOR);
  assert.notEqual(icon.color,STAGE_DOWN_COLOR);
});

const sharedCount = (patch)=>({
  fresh: true,
  oldestObservedAt: fresh,
  units: 3,
  sites: 2,
  cameras: {up: 4, down: 1, total: 5},
  armedUnits: 2,
  armedCameras: {up: 3, down: 1, total: 4},
  notInWatchful: [{name: 'Outside unit', productId: null, bucket: 'b', deployed: true}],
  immixUp: 1,
  immixDown: 0,
  immixUnknown: 0,
  monitoredOnImmix: [{name: 'Immix gate', source: 'immix', status: 'up'}],
  inShop: 1,
  ...patch,
});

test('Field and In shop use selectFleetCounts, and unknown placement is not Field',()=>{
  const rows = [
    {name: 'Field up', placement: 'field', cameraState: 'online', checkedAt: fresh},
    {name: 'Field down', placement: 'FIELD', cameraState: 'offline', checkedAt: fresh},
    {name: 'Shop bench', placement: 'shop', cameraState: 'offline', checkedAt: fresh},
    {name: 'Loose unit', placement: '', cameraState: 'offline', checkedAt: fresh},
  ];
  const placed = rows.filter(row=>stagePlacement(row.placement)!=='unknown');
  const shared = selectFleetCounts(censusFromDashboardRows(placed, now), now);
  const read = fleetStageRead(rows, now);
  assert.equal(read.shop, shared.inShopUnits);
  assert.equal(read.field, shared.units.online + shared.units.offline + shared.units.unknown);
  assert.equal(read.shop, 1);
  assert.equal(read.field, 2);
  assert.equal(read.unknownPlacement, 1);
  assert.equal(stagePlacement('REVIEW'), 'unknown');
  const boxes = stageBoardBoxes(read, null);
  assert.deepEqual(boxes.map(box=>box.id), ['field','unknown-placement','in-shop']);
  assert.equal(boxes.find(box=>box.id==='in-shop').value, '1');
  assert.equal(boxes.find(box=>box.id==='field').source, 'selectFleetCounts');
  const failed = stageBoardBoxes(fleetStageRead(null, now), null);
  assert.equal(failed.every(box=>box.value==='—'), true);
  assert.equal(failed.some(box=>box.value==='0'), false);
});

test('the Watchful boxes render only from the shared count shape and stay off the row until it exists',()=>{
  assert.deepEqual(stageSharedBoxes(null), []);
  const absent = stageBoardBoxes(fleetStageRead([{name:'Field up', placement:'field', cameraState:'online', checkedAt:fresh}], now), null);
  assert.equal(absent.some(box=>box.id==='monitored'||box.id==='immix'||box.id==='in-watchful'), false);
  assert.equal(absent.some(box=>box.label==='Arming read stale'), false);
  const live = stageBoardBoxes(fleetStageRead([{name:'Shop bench', placement:'shop', cameraState:'offline', checkedAt:fresh}], now), sharedCount());
  const monitored = live.find(box=>box.id==='monitored');
  assert.equal(monitored.label, 'Monitored');
  assert.equal(monitored.value, '2');
  assert.equal(monitored.saysMonitored, true);
  assert.equal(live.find(box=>box.id==='in-watchful').value, '3');
  assert.equal(live.find(box=>box.id==='not-in-watchful').value, '1');
  assert.equal(live.find(box=>box.id==='immix').value, '1');
  assert.equal(live.find(box=>box.id==='in-shop').value, '1');
  const mirror = fieldCountMirrorsWatchful(sharedCount());
  assert.equal(mirror.field, mirror.inWatchful);
  assert.equal(mirror.immix, 1);
  const staleRead = stageSharedBoxes(sharedCount({fresh:false, armedUnits:null, units:null, notInWatchful:[], immixUp:null, immixDown:null, immixUnknown:null, monitoredOnImmix:[], inShop:0}));
  assert.equal(staleRead.every(box=>box.value==='—'), true);
  assert.equal(staleRead.some(box=>box.label==='Arming read stale'||box.value==='0'), false);
  assert.equal(staleRead.find(box=>box.id==='monitored').saysMonitored, false);
  const tagged = [
    unit({id:'armed-up', name:'Armed up'}),
    unit({id:'immix', name:'Immix gate', immix:true, inWatchful:false}),
    unit({id:'shop', name:'Shop bench', placement:'shop'}),
    unit({id:'loose', name:'Loose unit', placement:'unknown', inWatchful:null}),
  ];
  assert.deepEqual(unitsForBox(tagged, 'monitored').map(item=>item.id), ['armed-up']);
  assert.equal(unitsForBox(tagged, 'in-watchful').some(item=>item.immix||item.placement==='shop'), false);
  assert.deepEqual(unitsForBox(tagged, 'unknown-placement').map(item=>item.id), ['loose']);
  assert.deepEqual(unitsForBox(tagged, 'in-shop').map(item=>item.id), ['shop']);
});

test('rollback turns the single-screen stage off and the reviewed board stays in place',()=>{
  assert.equal(fleetMapStageEnabled(),true);
  assert.equal(fleetMapStageActive(true),false);
  const previousLocation = globalThis.location;
  globalThis.location = {search: '?fleetBoard=1'};
  try {
    assert.equal(fleetMapStageActive(true),true);
    assert.equal(fleetMapStageActive(false),false);
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
  }
  assert.equal(fleetMapStageActive(true,false),false);
  const source = readFileSync(new URL('../src/fleetMapStage.ts',import.meta.url),'utf8');
  const rolled = rollbackFleetMapStageSource(source);
  assert.match(rolled,/export const FLEET_MAP_STAGE_LAYOUT = false;/);
  assert.equal(rolled.includes('FLEET_MAP_STAGE_LAYOUT = true'),false);
  assert.throws(()=>rollbackFleetMapStageSource(rolled),/stage layout flag/);
  const dashboard = readFileSync(new URL('../src/FleetDashboard.tsx',import.meta.url),'utf8');
  const restored = beforeFleetMapStageSource('FleetDashboard.tsx',dashboard);
  assert.equal(restored.includes('stageRows={rows}'),false);
  assert.match(restored,/rows=\{filtered\}/);
  const blob = value=>{const bytes = Buffer.from(value);return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');};
  const manifest = JSON.parse(readFileSync(new URL('./fleet-count-trust-preservation.json',import.meta.url),'utf8'));
  const candidate = manifest.files.find(file=>file.path==='FleetDashboard.tsx').candidateBlob;
  assert.equal(blob(restored),candidate);
});

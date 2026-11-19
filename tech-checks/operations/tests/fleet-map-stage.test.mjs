import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {armingReadFresh,fieldCountMirrorsWatchful,fleetMapStageActive,fleetMapStageEnabled,STAGE_DOWN_COLOR,STAGE_SHOP_COLOR,STAGE_UNKNOWN_COLOR,stageCountBoxes,stageIcon,stageUnitsFromRows,unitsForBox} from '../src/fleetMapStage.ts';
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

test('the monitored headline is armed field units, and a stale arming read never says monitored',()=>{
  const units = [
    unit({id:'armed-up',name:'Armed up'}),
    unit({id:'armed-down',name:'Armed down',status:'down'}),
    unit({id:'paused',name:'Paused unit',arming:'Paused'}),
    unit({id:'outside',name:'Outside unit',inWatchful:false}),
    unit({id:'immix',name:'Immix gate',immix:true,inWatchful:false,status:'down'}),
    unit({id:'shop',name:'Shop bench',placement:'shop',status:'down'}),
  ];
  const boxes = stageCountBoxes(units,now);
  const monitored = boxes.find(box=>box.id==='monitored');
  assert.equal(monitored.label,'Monitored');
  assert.equal(monitored.value,'2');
  assert.equal(monitored.saysMonitored,true);
  assert.equal(boxes.find(box=>box.id==='in-watchful').value,'3');
  assert.equal(boxes.find(box=>box.id==='not-in-watchful').value,'1');
  assert.equal(boxes.find(box=>box.id==='immix').value,'1');
  assert.equal(boxes.find(box=>box.id==='in-shop').value,'1');
  const field = fieldCountMirrorsWatchful(units,now);
  assert.equal(field.field,field.inWatchful);
  assert.equal(field.field,3);
  assert.equal(field.shop,1);
  assert.equal(field.immix,1);
  assert.equal(unitsForBox(units,'in-watchful',now).some(item=>item.immix||item.placement==='shop'),false);
  assert.deepEqual(unitsForBox(units,'monitored',now).map(item=>item.id),['armed-up','armed-down']);
  const staleUnits = units.map(item=>({...item,armingObservedAt:stale}));
  const fallback = stageCountBoxes(staleUnits,now).find(box=>box.id==='monitored');
  assert.equal(armingReadFresh(staleUnits,now),false);
  assert.equal(fallback.label,'Arming read stale');
  assert.equal(fallback.tone,'stale');
  assert.equal(fallback.saysMonitored,false);
  assert.equal(`${fallback.label} ${fallback.value} ${fallback.source}`.toLowerCase().includes('monitored'),false);
});

test('without a Watchful or Immix read the headline stays the stale fallback and does not invent those totals',()=>{
  const units = [unit({id:'one',name:'Field one',inWatchful:null,arming:null,armingObservedAt:null,status:'up'})];
  const boxes = stageCountBoxes(units,now);
  const fallback = boxes.find(box=>box.id==='monitored');
  assert.equal(fallback.label,'Arming read stale');
  assert.equal(fallback.saysMonitored,false);
  assert.equal(boxes.find(box=>box.id==='in-watchful').value,'—');
  assert.equal(boxes.find(box=>box.id==='not-in-watchful').value,'—');
  assert.equal(boxes.find(box=>box.id==='immix').value,'—');
  assert.equal(fieldCountMirrorsWatchful(units,now),null);
  assert.equal(unitsForBox(units,'in-watchful',now).length,0);
});

test('rollback turns the single-screen stage off and the reviewed board stays in place',()=>{
  assert.equal(fleetMapStageEnabled(),true);
  assert.equal(fleetMapStageActive(true),true);
  assert.equal(fleetMapStageActive(false),false);
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

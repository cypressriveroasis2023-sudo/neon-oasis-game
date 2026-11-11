// Owner decision 2026-11-11: a completed direct test at the tracker's address
// for a Product ID is counted when that Product ID is linked to exactly one
// active Field COS unit and the tested endpoint belongs to no other Product ID,
// even when the unit's camera device list has not been reviewed. It only ever
// gives a status to a unit that would otherwise have none.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
import {tvFieldCensus} from '../src/tvFieldCensus.ts';
import {cameraFieldProducts} from '../src/cameraFieldProducts.ts';
import {completedBoard} from '../durable-board/project.ts';
import {DEVICE_LINK_NOT_REVIEWED} from '../src/mhelpFieldHealth.ts';

const f=fieldProductFixture();
const tested=(status,resourceId)=>({basis:'tcp_service_port',status,resourceId,checkedAt:f.fresh,reason:'Completed synthetic saved TCP/service-port check; video not verified.'});
const withResults=results=>({...f.connections,items:f.connections.items.map(item=>results[item.productId]?{...item,...results[item.productId]}:item)});
const states=connections=>Object.fromEntries(tvFieldCensus({...f.field,productConnections:connections},f.units,f.health,null,null,f.now).products.items.map(p=>[p.productId,p]));
const base=states(f.connections);

test('baseline: the fixture has a linked unit with no status, plus units that must never be upgraded',()=>{
 assert.equal(base['1003'].state,'unverified');assert.equal(base['1005'].state,'unverified');assert.equal(base['1006'].state,'review');assert.equal(base['1007'].state,'inactive');assert.equal(base['1004'].state,'support');
});
test('a direct test at an address used by no other unit gives a linked unit its status, labelled as not device-reviewed',()=>{
 for(const status of ['online','offline']){
  const s=states(withResults({'1003':tested(status,'77')}));
  assert.equal(s['1003'].state,status);assert.ok(s['1003'].reason.endsWith(DEVICE_LINK_NOT_REVIEWED),s['1003'].reason);
  assert.equal(s['1003'].evidence.association,'exact_product_id_tracker_endpoint');
 }
});
test('every unit that already had a status keeps it, with its original reason and no new label',()=>{
 const s=states(withResults({'1003':tested('online','77')}));
 for(const id of ['1001','1002','1004','1006','1007']){assert.equal(s[id].state,base[id].state,id);assert.equal(s[id].reason,base[id].reason,id);assert.ok(!s[id].reason.includes('device link has not been reviewed'),id);}
});
test('an address shared by two Product IDs is credited to neither',()=>{
 const s=states(withResults({'1003':tested('online','77'),'1005':tested('online','77')}));
 for(const id of ['1003','1005'])assert.ok(!['online','offline'].includes(s[id].state),id+' '+s[id].state);
});
test('a unit that is not linked to exactly one COS record, is held for review, is Do Not Use, or is support equipment is never upgraded',()=>{
 const s=states(withResults({'1005':tested('online','81'),'1006':tested('online','82'),'1007':tested('online','83'),'1004':tested('online','84')}));
 assert.ok(!['online','offline'].includes(s['1005'].state),s['1005'].state);assert.equal(s['1006'].state,'review');assert.equal(s['1007'].state,'inactive');assert.equal(s['1004'].state,'support');
});
test('the Fleet census and the saved board count it the same way',()=>{
 const connections=withResults({'1003':tested('online','77')});
 const before=completedBoard(f.health,f.field,f.connections,null,f.now),after=completedBoard(f.health,f.field,connections,null,f.now);
 assert.equal(after.counts.online,before.counts.online+1);assert.equal(after.counts.unverified,before.counts.unverified-1);assert.equal(after.counts.offline,before.counts.offline);
 assert.equal(after.units.find(u=>u.productId==='1003').status,'online');
 assert.deepEqual(after.units.filter(u=>u.productId!=='1003'),before.units.filter(u=>u.productId!=='1003'));
 const live=cameraFieldProducts({...f.field,productConnections:connections},f.health,f.now,true);assert.equal(live.counts.online,after.counts.online);assert.equal(live.counts.unverified,after.counts.unverified);
});

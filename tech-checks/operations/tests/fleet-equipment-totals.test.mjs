import test from 'node:test';
import assert from 'node:assert/strict';
import {fleetEquipmentTotals} from '../src/fleetEquipmentTotalsModel.ts';
import {buildFleetCommandCenter} from '../src/fleetCommandCenterModel.ts';
import {mhelpFieldHealth} from '../src/mhelpFieldHealth.ts';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
function fixture(){const f=fieldProductFixture();const health=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now,f.connections);return {...f,data:buildFleetCommandCenter(f.upload,health,true,f.rows,null,null,f.now,f.fresh)};}
test('family totals reconcile unique Product IDs and Helios connectivity stays separate from missing Victron power',()=>{
 const f=fixture(),totals=fleetEquipmentTotals(f.upload,f.data,f.now),h=totals.find(x=>x.key==='helios'),s=totals.find(x=>x.key==='stands'),c=totals.find(x=>x.key==='cameras');
 assert.equal(h.total,1);assert.equal(h.online,1);assert.equal(h.offline,0);assert.equal(h.unverified,0);assert.equal(h.products.length,1);
 assert.equal(s.total,1);assert.equal(s.field,1);assert.equal(s.online+s.offline+s.unverified,0);
 assert.equal(c.total+s.total,f.upload.summary.totalRecords);assert.equal(c.online+c.offline+c.unverified,c.field);
 assert.equal(f.data.panels.find(x=>x.key==='victron').count,null);
});
test('all inventory totals retain Shop Helios while Field health never counts Shop as an outage',()=>{
 const f=fixture();Object.assign(f.upload.records.at(-1),{unitNumber:'Helios 099',category:'Helios'});
 const totals=fleetEquipmentTotals(f.upload,f.data,f.now),h=totals.find(x=>x.key==='helios');
 assert.equal(h.total,2);assert.equal(h.shop,1);assert.equal(h.field,1);assert.equal(h.online+h.offline+h.unverified,1);
});
test('missing and mismatched health cannot turn units online or offline',()=>{
 const f=fixture();for(const data of [null,{...f.data,items:f.data.items.slice(1)}]){
  const totals=fleetEquipmentTotals(f.upload,data,f.now),c=totals.find(x=>x.key==='cameras');assert.equal(c.online,0);assert.equal(c.offline,0);assert.equal(c.unverified,c.field);
 }
});
test('malformed or duplicate Product-ID source never supplies totals',()=>{
 const f=fixture();f.upload.records[1].productId=f.upload.records[0].productId;assert.equal(fleetEquipmentTotals(f.upload,f.data,f.now),null);
});

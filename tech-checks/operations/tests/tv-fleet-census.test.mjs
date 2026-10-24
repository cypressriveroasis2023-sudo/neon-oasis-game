import test from 'node:test';
import assert from 'node:assert/strict';
import {tvFleetCensus} from '../src/tvFleetCensus.ts';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
const read=f=>tvFleetCensus(f.field,f.units,f.health,null,null,f.now);
test('TV counts the same authoritative Product IDs, including unresolved Field equipment and separate support',()=>{
 const f=fieldProductFixture(),c=read(f);
 assert.ok(c);assert.equal(c.total,8);assert.equal(c.field,7);assert.equal(c.shop,1);
 assert.equal(c.items.length,7);assert.equal(new Set(c.items.map(p=>p.productId)).size,7);
 assert.deepEqual([c.counts.online,c.counts.offline,c.counts.unverified,c.counts.support],[1,1,4,1]);
 assert.deepEqual(c.items.filter(p=>p.status==='offline').map(p=>p.productId),['1002']);
 assert.ok(!c.items.some(p=>p.productId==='1008'));
});
test('unmatched native equipment cannot inflate TV totals or outages',()=>{
 const f=fieldProductFixture();f.units.push({...f.units[0],id:'unmatched',unitNumber:'Spotter 999'});
 const c=read(f);assert.equal(c.field,7);assert.equal(c.items.length,7);
 assert.ok(!c.items.some(p=>p.unitNumber==='Spotter 999'));
});
test('missing authority is unavailable; missing health retains the census with unknown cameras',()=>{
 const f=fieldProductFixture();assert.equal(tvFleetCensus(null,f.units,f.health,null,null,f.now),null);
 const c=tvFleetCensus(f.field,f.units,null,null,null,f.now);
 assert.equal(c.counts.online,0);assert.equal(c.counts.offline,0);assert.equal(c.counts.unverified,6);assert.equal(c.counts.support,1);
 assert.equal(c.items.find(p=>p.productId==='1001').locationUnitId,f.units[0].id);
});
test('a later saved read cannot refresh old camera evidence into current online or offline',()=>{
 const f=fieldProductFixture();f.now+=60*60*1000;f.health.refreshedAt=new Date(f.now).toISOString();
 const c=read(f);assert.equal(c.counts.online,0);assert.equal(c.counts.offline,0);assert.equal(c.counts.unverified,6);
});
test('connection and recorder observations do not prove camera status',()=>{
 for(const kind of ['recorder','service']){
  const f=fieldProductFixture();for(const row of f.health.rows){
   row.type=kind==='recorder'?'NVR':'tracker_unit';row.evidence.resource=kind;
   if(kind==='service'){row.evidence.kind='service_port';row.evidence.source='Saved connection';row.evidence.reachable=true;row.evidence.confirmedOutage=true;}
  }
  const c=read(f);assert.equal(c.counts.online,0);assert.equal(c.counts.offline,0);
 }
});

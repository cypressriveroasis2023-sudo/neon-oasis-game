import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldInventoryCensus} from '../src/fieldInventoryCensus.ts';
import {mhelpFieldHealth} from '../src/mhelpFieldHealth.ts';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';

test('every recorded Field Product ID survives missing identity and failed health; Shop remains excluded',()=>{
 const f=fieldProductFixture(),before=JSON.stringify(f.upload),ids=f.upload.records.filter(r=>r.placement==='FIELD').map(r=>r.productId);
 for(const healthAvailable of [true,false]){
  const r=fieldInventoryCensus(f.upload,null,healthAvailable,f.now);
  assert.deepEqual(r.items.map(p=>p.productId),ids);assert.equal(r.total,7);assert.equal(r.counts.online,0);assert.equal(r.counts.offline,0);assert.equal(r.counts.support,1);assert.equal(r.counts.review,1);assert.equal(r.counts.inactive,1);
  assert.ok(r.items.every(p=>p.unitId===null&&p.recordId===null));assert.equal(r.items.some(p=>p.productId==='1008'),false);
 }
 assert.equal(JSON.stringify(f.upload),before);
});
test('valid same-source connectivity is retained, then cleared without losing Field membership on failure',()=>{
 const f=fieldProductFixture(),health=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now);
 assert.equal(fieldInventoryCensus(f.upload,health,true,f.now),health);
 const unavailable=fieldInventoryCensus(f.upload,health,false,f.now);
 assert.equal(unavailable.total,health.total);assert.deepEqual(unavailable.items.map(p=>p.productId),health.items.map(p=>p.productId));assert.equal(unavailable.counts.online,0);assert.equal(unavailable.counts.offline,0);assert.ok(unavailable.items.every(p=>p.evidence===undefined));
 for(const changed of [{...health,sourceSha256:'b'.repeat(64)},{...health,items:health.items.slice(1)}])assert.equal(fieldInventoryCensus(f.upload,changed,true,f.now).counts.online,0);
});
test('complete 1001-record census retains all 284 Field products without provider identity or health',()=>{
 const f=fieldProductFixture(),records=Array.from({length:1001},(_,i)=>({recordId:'mhelp_product:'+String(i+1),productId:String(i+1),unitNumber:'Synthetic '+(i+1),category:i<83?'STANDS':'Spotter',placement:i<284?'FIELD':'SHOP',uploadLifecycle:'UNFLAGGED',binding:{state:'unlinked',unitIds:[]}}));
 const upload={...f.upload,records,summary:{totalRecords:1001,fieldRecords:284,shopRecords:717,unflaggedFieldRecords:284,unflaggedShopRecords:717,doNotUseRecords:0,missingRecords:0}};
 const result=fieldInventoryCensus(upload,null,false,f.now);
 assert.equal(result.total,284);assert.equal(new Set(result.items.map(p=>p.productId)).size,284);assert.equal(result.counts.unverified,201);assert.equal(result.counts.support,83);assert.equal(result.counts.offline,0);assert.equal(upload.records.filter(p=>p.placement==='SHOP').length,717);
});
test('invalid inventory cannot invent a census even when old health exists',()=>{
 const f=fieldProductFixture(),health=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now);
 assert.equal(fieldInventoryCensus({...f.upload,records:f.upload.records.slice(1)},health,true,f.now),null);
});

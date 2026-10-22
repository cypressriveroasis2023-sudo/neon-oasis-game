import test from 'node:test';
import assert from 'node:assert/strict';
import {mhelpProviderFleet} from '../src/mhelpProviderFleet.ts';
import {mhelpFieldHealth} from '../src/mhelpFieldHealth.ts';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
function fixture(){const f=fieldProductFixture();const health=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now);return {...f,health};}
function item(f){return mhelpProviderFleet(f.upload,f.health,true,f.now).groups.flatMap(g=>g.items).find(i=>i.productId===f.health.items[0].productId);}
test('camera summary never promotes connection, recorder or power evidence to video',()=>{
 for(const basis of ['connection','recorder','provider']){const f=fixture();f.health.items[0].evidence={association:'verified',basis,observations:[]};assert.equal(item(f).healthStatus,'unverified');assert.match(item(f).reason,/video is unverified/);}
});
test('only current complete attributed camera observations can supply Online or Offline',()=>{
 for(const state of ['online','offline']){
 const f=fixture();Object.assign(f.health.items[0],{state,evidence:{association:'verified',basis:'camera',observations:[{kind:'camera',observedAt:new Date(f.now).toISOString(),currentState:state}]}});
 assert.equal(item(f).healthStatus,state);
 f.health.items[0].evidence.observations[0].observedAt=new Date(f.now-21*60000).toISOString();assert.equal(item(f).healthStatus,'unverified');
 }
});
test('incomplete coverage, missing association, future observations and source failure remain Unverified',()=>{
 for(const change of [e=>e.association=null,e=>e.observations=[],e=>e.observations.push({kind:'detector',observedAt:null,currentState:'verifying'}),e=>e.observations[0].observedAt='2099-01-01T00:00:00Z']){
 const f=fixture();f.health.items[0].evidence={association:'verified',basis:'camera',observations:[{kind:'camera',observedAt:new Date(f.now).toISOString(),currentState:'online'}]};change(f.health.items[0].evidence);assert.equal(item(f).healthStatus,'unverified');
 }
 const f=fixture(),view=mhelpProviderFleet(f.upload,f.health,false,f.now);assert.equal(view.groups.reduce((n,g)=>n+g.count,0),7);assert(view.groups.flatMap(g=>g.items).every(i=>['unverified','not_applicable'].includes(i.healthStatus)));
});
test('Product IDs partition independently of channels and invalid receipts never show zero outages',()=>{
 const f=fixture(),view=mhelpProviderFleet(f.upload,f.health,true,f.now),rows=view.groups.flatMap(g=>g.items);assert.equal(rows.length,7);assert.equal(new Set(rows.map(r=>r.productId)).size,7);
 assert.equal(mhelpProviderFleet({...f.upload,records:[...f.upload.records,f.upload.records[0]]},f.health,true,f.now),null);
});

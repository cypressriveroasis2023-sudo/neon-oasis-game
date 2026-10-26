import test from 'node:test';
import assert from 'node:assert/strict';
import {currentOwnerPlacements as baseline} from './fixtures/placement-cpu-baseline.mjs';
import {currentOwnerPlacements as candidate} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';
import {fixture} from './fixtures/placement-cpu-population.mjs';
function outcome(fn,{audits,devices}){try{return {value:fn(audits,devices)}}catch(e){return {error:e.message,status:e.status}}}
function compare(f){const saved=structuredClone(f);assert.deepEqual(outcome(candidate,f),outcome(baseline,f));assert.deepEqual(f,saved);}
test('complete 1001-unit placement projection and inputs are unchanged',()=>compare(fixture()));
test('duplicate, malformed, alias, newer-history and invalid placement decisions match baseline',()=>{
 const mutations=[f=>f.devices.push({...f.devices[0]}),f=>f.devices[0].id=null,f=>f.devices[0].unit_key='RI 1',f=>f.devices.push({...f.devices[0],unit_key:'RECON 001'}),f=>f.audits.push({...f.audits[0],id:'9999',contract:null}),f=>f.audits[0].device_ids.push(f.audits[0].device_ids[0]),f=>f.audits[0].created_at='bad',f=>f.audits[0].control_id='bad',f=>f.audits[0].placement='bad',f=>f.audits[0].street_address='',f=>f.audits[0].id='bad',f=>f.devices.push(null),f=>f.devices.unshift(null),f=>f.devices.push(0,'text',{},[]),f=>f.audits=[],f=>f.devices=[],f=>f.audits.reverse(),f=>f.devices.reverse(),f=>f.devices[0].unit_key=' RECON 1 ',f=>delete f.devices[0]];
 for(const mutate of mutations){const f=fixture(5);mutate(f);compare(f);}
 const f=fixture(2);f.devices.unshift({id:'99',unit_key:'RI 1'});f.devices.push(null);compare(f);
});
test('request-local lookup never retains stale identities or audit changes',()=>{
 const f=fixture(2);compare(f);f.devices[0].id='999';compare(f);f.devices[0].unit_key='changed';compare(f);f.audits[0].device_ids=['999'];compare(f);
});
test('seeded permutations preserve whole outputs and denial precedence',()=>{
 let seed=123;const next=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
 for(let i=0;i<100;i++){const f=fixture(8);for(let j=0;j<10;j++){const d=f.devices[Math.floor(next()*f.devices.length)];if(next()<.5)d.unit_key=['RI 1','RECON 001','RECON 1.1','RECON 1HDC4','SNIPER 2-1','',null][Math.floor(next()*7)];else d.id=[null,'0','01','1',1,999][Math.floor(next()*6)];}compare(f);}
});

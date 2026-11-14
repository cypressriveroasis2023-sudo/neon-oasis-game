import test from 'node:test';
import assert from 'node:assert/strict';
import {handAddressPoint,geocodioPoint,checkedHandPoint} from '../../supabase/functions/cos-operations-pages/handAddressPoint.ts';
const typed='22725 Ashley Pines Dr, Spring, TX 77373-3257';
const body=value=>new Response(JSON.stringify(value));
const hit=matchedAddress=>({matchedAddress,coordinates:{x:-95.4,y:30.1}});
for(const matched of ['22725 ASHLEY PINES DR, SPRING, TX, 77373','22725 Ashley Pines Drive, Spring, TX 77373-3257']){
 test('exact or normalized result agrees: '+matched,async()=>{
  assert.equal((await handAddressPoint(typed,async()=>body({result:{addressMatches:[hit(matched)]}}))).status,'success');
 });
}
for(const matched of ['22726 ASHLEY PINES DR, SPRING, TX, 77373','Ashley Pines Dr, Spring, TX 77373','22725 Other Dr, Spring, TX 77373','22725 Ashley Pines Dr, Houston, TX 77373','22725 Ashley Pines Dr, Spring, LA 77373',null]){
 test('contradictory or unparseable result has no pin: '+matched,async()=>{
  let asks=0;
  const found=await handAddressPoint(typed,async()=>{asks++;return body({result:{addressMatches:[hit(matched)]}});},'synthetic-key');
  assert.equal(found.status,'unverified_match');assert.equal(found.latitude,undefined);assert.equal(asks,1);
  const second=await geocodioPoint(typed,'synthetic-key',async()=>body({results:[{formatted_address:matched,location:{lat:30.1,lng:-95.4},accuracy:1}]}));
  assert.equal(second.status,'unverified_match');assert.equal(second.latitude,undefined);
 });
}
test('missing, range or fractional supplied number stays unpinned',async()=>{
 for(const value of ['Ashley Pines Dr, Spring, TX 77373','22725-22726 Ashley Pines Dr, Spring, TX','22725 1/2 Ashley Pines Dr, Spring, TX'])
  assert.equal((await handAddressPoint(value,async()=>body({result:{addressMatches:[hit(typed)]}}))).status,'unverified_match');
});
test('write boundary refuses mismatched remote text or invalid coordinates',()=>{
 for(const data of [{matchedAddress:typed,latitude:'30',longitude:-95.4},{matchedAddress:typed,latitude:0,longitude:0},{matchedAddress:typed.replace('22725','22726'),latitude:30,longitude:-95.4},{latitude:30,longitude:-95.4}])
  assert.equal(checkedHandPoint(typed,{status:'success',reason:'synthetic',...data}).status,'unverified_match');
});
test('no and multiple Census matches remain unpinned',async()=>{
 for(const matches of [[],[hit(typed),hit(typed)]])assert.equal((await handAddressPoint(typed,async()=>body({result:{addressMatches:matches}}))).status,'no_match');
});

import {unitPins} from '../src/unitStatusPins.ts';
import {applyHandEdits,countUnits} from '../shared/starUnitStatus.ts';
test('pin clear does not resurrect another saved-source pin or alter unit status',()=>{
 const unit={unit:'SOLARSPOTTER 023',placement:'FIELD',site:'Original site',state:'GREEN',online:1,cameras:1};
 const report={units:[unit],counts:countUnits([unit])};
 const current=applyHandEdits(report,[{unit_key:unit.unit,field:'address',action:'set',value:typed,revision:'saved-revision'}]);
 const after=current.units[0];assert.equal(after.address,typed);assert.equal(after.location,null);
 assert.equal(after.unit,unit.unit);assert.equal(after.placement,unit.placement);assert.equal(after.site,unit.site);assert.equal(after.state,unit.state);
 const fallback=[{unitNumber:unit.unit,address:typed,point:[30.1,-95.4]}];
 assert.equal(unitPins(current.units,fallback).pins.length,0);
 const cleared=applyHandEdits(report,[{unit_key:unit.unit,field:'address',action:'clear',value:null,revision:'clear-revision'}]);
 assert.equal(cleared.units[0].addressRevision,'clear-revision');assert.equal(unitPins(cleared.units,fallback).pins.length,0);
});

const ss032={typed:'10426 IH37 Access Road, Corpus Christi TX 78410',matched:'10428 I-37 Mathis TX 78368',latitude:28.084928,longitude:-97.803507};
for(const sample of [{typed,matched:typed.replace('22725','22726'),latitude:30.1,longitude:-95.4},ss032]){
 test('all lookup paths reject mismatched result without fallback: '+sample.typed,async()=>{
  let remoteCalls=0,providerCalls=0;
  const remote=async()=>{remoteCalls++;return {status:'success',reason:'synthetic',matchedAddress:sample.matched,latitude:sample.latitude,longitude:sample.longitude};};
  const census=async()=>{providerCalls++;return body({result:{addressMatches:[{matchedAddress:sample.matched,coordinates:{y:sample.latitude,x:sample.longitude}}]}});};
  const rejected=await handAddressPoint(sample.typed,census,'synthetic-key',remote);
  assert.equal(rejected.status,'unverified_match');assert.equal(rejected.latitude,undefined);assert.equal(providerCalls,1);assert.equal(remoteCalls,0);
  const local=await handAddressPoint(sample.typed,async url=>new URL(url).hostname==='geocoding.geo.census.gov'?body({result:{addressMatches:[]}}):body({results:[{formatted_address:sample.matched,location:{lat:sample.latitude,lng:sample.longitude},accuracy:1}]}),'synthetic-key',remote);
  assert.equal(local.status,'unverified_match');assert.equal(local.latitude,undefined);assert.equal(remoteCalls,0);
  const external=await handAddressPoint(sample.typed,async()=>body({result:{addressMatches:[]}}),null,remote);
  assert.equal(external.status,'unverified_match');assert.equal(external.latitude,undefined);assert.equal(remoteCalls,1);
  assert.equal(checkedHandPoint(sample.typed,await remote()).status,'unverified_match');
 });
}
test('remote lookup success requires matched text and finite coordinates; normalized match still works',async()=>{
 const census=async()=>body({result:{addressMatches:[]}});
 for(const value of [{status:'success',latitude:30,longitude:-95},{status:'success',matchedAddress:typed,latitude:'30',longitude:-95},{status:'unverified_match',reason:'Different house number'}]){
  const found=await handAddressPoint(typed,census,null,async()=>value);assert.equal(found.status,'unverified_match');assert.equal(found.latitude,undefined);
 }
 assert.equal((await handAddressPoint(typed,census,null,async()=>({status:'success',reason:'Synthetic',matchedAddress:'22725 ASHLEY PINES DRIVE, SPRING, TX 77373',latitude:30,longitude:-95}))).status,'success');
});

import test from 'node:test';import assert from 'node:assert/strict';
import {readPlacementCustomer} from '../../supabase/functions/cos-mhelp-placement-sync/customerRead.ts';
import {createPlacementParentReadCache} from '../../supabase/functions/cos-mhelp-placement-sync/parentReadCache.ts';
import {createFleetLocationReader} from '../../supabase/functions/cos-mhelp-placement-sync/locationReader.ts';
const path='/customers/2?Fields=customerId,portalId,name,isServiceLocation,isActive,address1,address2,city,state,zip,countryId,latitude,longitude';
const parent={customerId:'2',portalId:'224643',name:'Synthetic builder',isServiceLocation:false,isActive:true,address1:'Private billing address',token:'Private source value'};
const service={customerId:'3',portalId:'224643',name:'Synthetic job',address1:'123 Main St',city:'Houston',state:'TX',zip:'77002',latitude:29.76,longitude:-95.37};
test('placement and location reads reuse a verified parent without exposing billing or source fields',async()=>{
 const cache=createPlacementParentReadCache(),calls=[];
 const projected=await readPlacementCustomer('2',{portalId:'224643',accessToken:'synthetic-token',signal:new AbortController().signal,includeActive:true,onVerified:r=>cache.remember('2',r),readJson:r=>r.json(),fetch:async url=>{calls.push(url);return Response.json(parent);}});
 assert.deepEqual(projected,{customerId:'2',name:parent.name,isServiceLocation:false,placement:'FIELD'});
 assert.match(calls[0],/fields=customerId,portalId,name,isServiceLocation,isActive$/);
 const reader=createFleetLocationReader(async p=>{const hit=cache.read(p);if(hit)return hit;calls.push(p);assert.match(p,/servicelocations/);return {totalRows:1,results:[service]};},async()=>{throw Error('Unexpected geocoder');});
 const location=await reader({customerId:'2',serviceLocationId:'3'},null);
 assert.equal(location.address,'123 Main St, Houston, TX 77002');assert.equal(calls.length,2);
 assert.doesNotMatch(JSON.stringify(cache.read(path)),/Private|billing|token|address1/);
 const copy=cache.read(path);copy.name='Changed';assert.equal(cache.read(path).name,parent.name);
 assert.equal(createPlacementParentReadCache().read(path),null);assert.equal(cache.read(path+'&extra=1'),null);
});
test('service-location customers still require a full address read and inactive parents remain inactive',async()=>{
 const cache=createPlacementParentReadCache();cache.remember('2',{...parent,isServiceLocation:true});assert.equal(cache.read(path),null);
 const calls=[],reader=createFleetLocationReader(async p=>{calls.push(p);return {...service,customerId:'2',isServiceLocation:true};},async()=>{throw Error('Unexpected geocoder');});
 const value=await reader({customerId:'2',serviceLocationId:'2'},null);assert.equal(value.address,'123 Main St, Houston, TX 77002');assert.equal(calls.length,1);assert.equal(calls[0],path);
 cache.remember('2',{...parent,isActive:false});const inactive=createFleetLocationReader(async p=>cache.read(p),async()=>{throw Error();});await assert.rejects(inactive({customerId:'2',serviceLocationId:'3'},null),/identity changed/);
 for(const row of [{...parent,portalId:'9'},{...parent,customerId:'3'},{...parent,name:'<unsafe>'}]){const isolated=createPlacementParentReadCache();isolated.remember('2',row);assert.equal(isolated.read(path),null);}
});
test('unverified and expired customer reads never seed the same-run cache',async()=>{
 for(const row of [{...parent,portalId:'9'},{...parent,isServiceLocation:null}]){
  const cache=createPlacementParentReadCache();const result=await readPlacementCustomer('2',{portalId:'224643',accessToken:'synthetic-token',signal:new AbortController().signal,onVerified:r=>cache.remember('2',r),readJson:r=>r.json(),fetch:async()=>Response.json(row)});
  assert.equal(result,null);assert.equal(cache.read(path),null);
 }
 const cache=createPlacementParentReadCache(),controller=new AbortController();
 const result=await readPlacementCustomer('2',{portalId:'224643',accessToken:'synthetic-token',signal:controller.signal,onVerified:r=>cache.remember('2',r),readJson:async r=>{controller.abort();return r.json();},fetch:async()=>Response.json(parent)});
 assert.equal(result,null);assert.equal(cache.read(path),null);
});

test('location diagnostics report fixed review categories without record data',async()=>{
 for(const [list,expected] of [[{results:[],totalRows:1},'service_inventory'],[{results:[],totalRows:0},'service_membership'],[{results:[{...service,zip:null}],totalRows:1},'address_validation']]){
  const codes=[];const reader=createFleetLocationReader(async p=>p.includes('servicelocations')?list:parent,async()=>{throw Error('Unexpected geocoder');},'224643',code=>codes.push(code));
  await assert.rejects(reader({customerId:'2',serviceLocationId:'3'},null));assert.deepEqual(codes,[expected]);assert.doesNotMatch(JSON.stringify(codes),/Private|Synthetic|123 Main/);
 }
});

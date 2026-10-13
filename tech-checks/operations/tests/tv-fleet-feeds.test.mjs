import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTvFleetFeeds} from '../src/tvFleetFeeds.ts';

const time='2026-10-12T18:45:00Z';
const field={items:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',unitNumber:'Sniper 312',status:'installed'}],summary:{fieldUnits:1,mappedUnits:0,unitGps:0,missingGps:1},generatedAt:time};
const health={totalDevices:0,online:0,offline:0,review:0,shopRoot:0,healthRows:0,fieldDevices:0,refreshedAt:time,rows:[]};
const routers={items:[],generatedAt:time,source:'camera_health',gpsAvailable:false};
const values={'/api/field-map':field,'/api/camera-health/summary-v3':health,'/api/routers':routers};
const callbacks=accepted=>({field:value=>{accepted.field=value;},health:value=>{accepted.health=value;},routers:value=>{accepted.routers=value;}});

test('field locations arrive while an optional health feed is still waiting',async()=>{
 let finishHealth,fieldArrived;
 const waiting=new Promise(resolve=>{finishHealth=resolve;});
 const arrived=new Promise(resolve=>{fieldArrived=resolve;});
 const accepted={};
 const loading=loadTvFleetFeeds({get:async path=>({data:path==='/api/camera-health/summary-v3'?await waiting:values[path]})},{...callbacks(accepted),field:value=>{accepted.field=value;fieldArrived();}});
 await arrived;assert.equal(accepted.field.items[0].unitNumber,'Sniper 312');assert.equal(accepted.health,undefined);
 finishHealth(health);assert.deepEqual(await loading,[]);assert.deepEqual(accepted.health.rows,health.rows);assert.deepEqual(accepted.health.fleetFieldUnits,field.items);
});

test('camera and router outages leave verified field locations available and identify each failed feed',async()=>{
 const accepted={};
 const errors=await loadTvFleetFeeds({get:async path=>{if(path!=='/api/field-map')throw new Error('Connection unavailable');return {data:field};}},callbacks(accepted));
 assert.equal(accepted.field,field);assert.equal(accepted.health,undefined);assert.equal(accepted.routers,undefined);
 assert.deepEqual(errors.sort(),['Camera Health: Connection unavailable','Routers: Connection unavailable']);
});

test('malformed location data is refused without suppressing valid health and router evidence',async()=>{
 const accepted={};
 const errors=await loadTvFleetFeeds({get:async path=>({data:path==='/api/field-map'?{...field,items:[...field.items,...field.items]}:values[path]})},callbacks(accepted));
 assert.equal(accepted.field,undefined);assert.equal(accepted.health,health);assert.ok(accepted.routers);
 assert.equal(errors.length,1);assert.match(errors[0],/^Field locations: Field Map returned inconsistent unit records/);
});

test('a malformed camera summary cannot be accepted as healthy or remove the map',async()=>{
 const accepted={};
 const errors=await loadTvFleetFeeds({get:async path=>({data:path==='/api/camera-health/summary-v3'?{...health,online:1}:values[path]})},callbacks(accepted));
 assert.equal(accepted.field,field);assert.equal(accepted.health,undefined);assert.ok(accepted.routers);
 assert.equal(errors.length,1);assert.match(errors[0],/^Camera Health: Camera Health returned an incomplete summary/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTvFleetFeeds,retainSourceErrors,sourceErrorText} from '../src/tvFleetFeeds.ts';

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

test('a failed health refresh clears cached health while retaining verified field locations',async()=>{
 const accepted={field,health};
 const errors=await loadTvFleetFeeds({get:async path=>{if(path==='/api/camera-health/summary-v3')throw Error('Saved source unavailable');return {data:values[path]};}}, {...callbacks(accepted),healthUnavailable:()=>{accepted.health=null;}});
 assert.equal(accepted.field,field);assert.equal(accepted.health,null);assert.ok(accepted.routers);assert.deepEqual(errors,['Camera Health: Saved source unavailable']);
});

test('source failures preserve their HTTP status separately from display text',async()=>{
 for(const status of [546,503,401,403,409]){
  const accepted={},failures=[],requests=[];
  const errors=await loadTvFleetFeeds({get:async path=>{requests.push(path);if(path==='/api/field-map')throw Object.assign(new Error('Synthetic failed read'),{response:{status}});return {data:values[path]};}}, {...callbacks(accepted),readFailure:(source,status)=>failures.push({source,status})});
  assert.deepEqual(failures,[{source:'fieldMap',status}]);assert.equal(requests.length,3);
  assert.deepEqual(errors,['Field locations: Synthetic failed read']);assert.equal(accepted.field,undefined);
 }
});

test('schema rejection reports no retryable HTTP status',async()=>{
 const failures=[];
 await loadTvFleetFeeds({get:async path=>({data:path==='/api/field-map'?{...field,items:[...field.items,...field.items]}:values[path]})},{...callbacks({}),readFailure:(source,status)=>failures.push({source,status})});
 assert.deepEqual(failures,[{source:'fieldMap',status:null}]);
});

// Camera saved reads and the router saved read run on separate cadences, so the
// loader must be able to perform either side alone. Reading routers on the
// camera cadence raises /api/routers traffic for no freshness benefit, and
// tying routers to the next camera deadline stretches them to that interval's
// next multiple instead of their own.
test('camera and router saved reads can each be performed alone',async()=>{
 const requested=[],api={get:async path=>{requested.push(path);return {data:values[path]};}};

 const cameraOnly={};
 assert.deepEqual(await loadTvFleetFeeds(api,callbacks(cameraOnly),false,{routers:false}),[]);
 assert.deepEqual(requested.sort(),['/api/camera-health/summary-v3','/api/field-map']);
 assert.equal(cameraOnly.routers,undefined,'a camera-only pass must not read routers');
 assert.ok(cameraOnly.field&&cameraOnly.health);

 requested.length=0;
 const routersOnly={};
 assert.deepEqual(await loadTvFleetFeeds(api,callbacks(routersOnly),false,{camera:false}),[]);
 assert.deepEqual(requested,['/api/routers'],'a router-only pass must not re-read camera evidence');
 assert.equal(routersOnly.field,undefined);assert.equal(routersOnly.health,undefined);
 assert.equal(routersOnly.routers,routers);

 requested.length=0;
 const both={};
 assert.deepEqual(await loadTvFleetFeeds(api,callbacks(both),false),[]);
 assert.deepEqual(requested.sort(),['/api/camera-health/summary-v3','/api/field-map','/api/routers'],'the default still reads all three, as manual refresh and initial load require');
});

// A skipped router read is not a failed one. The caller distinguishes them by
// whether the routers callback fired at all, so a camera-only pass must leave
// no router signal behind rather than reporting an absent or failed snapshot.
test('skipping the router read reports neither a router snapshot nor a router failure',async()=>{
 const accepted={};let unavailable=false;
 const errors=await loadTvFleetFeeds(
  {get:async path=>{if(path==='/api/routers')throw new Error('Routers should not have been read');return {data:values[path]};}},
  {...callbacks(accepted),routersUnavailable:()=>{unavailable=true;}},
  false,{routers:false});
 assert.deepEqual(errors,[]);
 assert.equal(accepted.routers,undefined);
 assert.equal(unavailable,false,'a deliberate skip must not look like unavailable router evidence');
});

// Vision's finding against 9eb1eb3e: once camera and router reads run on
// separate cadences, a successful router-only pass produces no camera errors,
// and reporting that pass's errors wholesale cleared an unresolved camera
// warning. The warning vanished while the condition causing it persisted.
// Errors are retained per source group so a pass only speaks for what it read.
const none={camera:[],routers:[]};
const CAMERA_FAIL='Camera Health: Connection unavailable';
const ROUTER_FAIL='Routers: Connection unavailable';

test('a successful router-only pass cannot clear an unresolved camera warning',()=>{
 const afterCameraFailure=retainSourceErrors(none,[CAMERA_FAIL],{camera:true,routers:true});
 assert.deepEqual(afterCameraFailure.camera,[CAMERA_FAIL]);
 assert.equal(sourceErrorText(afterCameraFailure),CAMERA_FAIL);
 // Routers alone, and they succeed. The camera warning must survive.
 const afterRouterOnly=retainSourceErrors(afterCameraFailure,[],{camera:false,routers:true});
 assert.deepEqual(afterRouterOnly.camera,[CAMERA_FAIL],'the camera warning is not this pass to clear');
 assert.deepEqual(afterRouterOnly.routers,[]);
 assert.equal(sourceErrorText(afterRouterOnly),CAMERA_FAIL);
 // Only a camera read that succeeds may clear it.
 const afterCameraRecovers=retainSourceErrors(afterRouterOnly,[],{camera:true,routers:false});
 assert.deepEqual(afterCameraRecovers.camera,[]);
 assert.equal(sourceErrorText(afterCameraRecovers),'');
});

test('a successful camera-only pass cannot clear an unresolved router warning',()=>{
 const afterRouterFailure=retainSourceErrors(none,[ROUTER_FAIL],{camera:true,routers:true});
 assert.deepEqual(afterRouterFailure.routers,[ROUTER_FAIL]);
 const afterCameraOnly=retainSourceErrors(afterRouterFailure,[],{camera:true,routers:false});
 assert.deepEqual(afterCameraOnly.routers,[ROUTER_FAIL],'the router warning is not this pass to clear');
 assert.equal(sourceErrorText(afterCameraOnly),ROUTER_FAIL);
});

test('both warnings are retained and reported together, each cleared only by its own source',()=>{
 const both=retainSourceErrors(none,[CAMERA_FAIL,ROUTER_FAIL],{camera:true,routers:true});
 assert.equal(sourceErrorText(both),CAMERA_FAIL+' '+ROUTER_FAIL);
 const routersRecover=retainSourceErrors(both,[],{camera:false,routers:true});
 assert.equal(sourceErrorText(routersRecover),CAMERA_FAIL);
 const camerasRecover=retainSourceErrors(routersRecover,[],{camera:true,routers:false});
 assert.equal(sourceErrorText(camerasRecover),'');
});

test('a field-locations failure is retained with the camera group, not the router group',()=>{
 const fieldFail='Field locations: Connection unavailable';
 const afterField=retainSourceErrors(none,[fieldFail],{camera:true,routers:true});
 assert.deepEqual(afterField.camera,[fieldFail],'field map is read with the camera pair');
 assert.deepEqual(afterField.routers,[]);
 assert.equal(sourceErrorText(retainSourceErrors(afterField,[],{camera:false,routers:true})),fieldFail);
});

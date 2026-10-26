import test from 'node:test';import assert from 'node:assert/strict';
import {readConnectionCheck,connectionCheckState} from '../src/connectionCheckResult.ts';
import {CAMERA_FRESH_MS} from '../src/cameraEvidence.ts';
const now=Date.parse('2026-10-26T17:00:00Z');
const device={id:12,unit:'Helios 1',connection:{publicIp:'8.8.8.8',ports:[80,443]}};
const result=()=>({deviceId:12,unitKey:'Helios 1',publicIp:'8.8.8.8',mode:'quick',checkedAt:new Date(now).toISOString(),ports:[{port:80,reachable:true,latencyMs:1}]});
test('exact completed response is online without claiming video or requiring other ports',()=>{
 const value=result(),accepted=readConnectionCheck(value,device,'quick',now);assert.deepEqual(accepted,value);assert.notEqual(accepted,value);assert.equal(connectionCheckState(accepted,device,now).state,'online');
});
test('complete negative is offline; partial or unspecified profile coverage stays unknown',()=>{
 const v={...result(),ports:[{port:80,reachable:false,latencyMs:null},{port:443,reachable:false,latencyMs:null}]};
 assert.equal(connectionCheckState(readConnectionCheck(v,device,'quick',now),device,now).state,'offline');
 assert.equal(connectionCheckState({...v,ports:v.ports.slice(0,1)},device,now).state,'unknown');
 const profile={...device,connection:{...device.connection,ports:[]}};
 assert.equal(connectionCheckState(readConnectionCheck(v,profile,'quick',now),profile,now).state,'unknown');
});
for(const [name,change] of [
 ['device',{deviceId:13}],['unit',{unitKey:'Helios 2'}],['IP',{publicIp:'1.1.1.1'}],['mode',{mode:'ports'}],['empty',{ports:[]}],['missing time',{checkedAt:null}],['future',{checkedAt:new Date(now+1).toISOString()}],['stale',{checkedAt:new Date(now-CAMERA_FRESH_MS-1).toISOString()}],['invalid calendar',{checkedAt:'2026-02-30T12:00:00Z'}],['unrequested port',{ports:[{port:22,reachable:true,latencyMs:1}]}],['nonboolean',{ports:[{port:80,reachable:'true',latencyMs:1}]}],['negative latency',{ports:[{port:80,reachable:true,latencyMs:-1}]}],['missing latency',{ports:[{port:80,reachable:true}]}],['duplicate',{ports:[{port:80,reachable:true,latencyMs:1},{port:80,reachable:false,latencyMs:null}]}]
])test('rejects '+name+' without accepting health',()=>assert.throws(()=>readConnectionCheck({...result(),...change},device,'quick',now),/exact saved connection/));
test('unrun and elapsed results are unknown without mutating the saved timestamp',()=>{
 assert.equal(connectionCheckState(null,device,now).state,'unknown');const v=result(),original=JSON.stringify(v);
 assert.equal(connectionCheckState(v,device,now+CAMERA_FRESH_MS).state,'online');assert.equal(connectionCheckState(v,device,now+CAMERA_FRESH_MS+1).state,'unknown');assert.equal(JSON.stringify(v),original);
});

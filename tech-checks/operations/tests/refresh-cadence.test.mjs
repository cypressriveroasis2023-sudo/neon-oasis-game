import test from 'node:test';import assert from 'node:assert/strict';
import {AUTO_REFRESH_MS,CAMERA_AUTO_REFRESH_MS,automaticRefreshDue} from '../src/refreshCadence.ts';
test('automatic refresh waits fifteen minutes and never runs while hidden',()=>{const start=1_000_000;assert.equal(AUTO_REFRESH_MS,900_000);for(const age of [0,1_000,60_000,899_999])assert.equal(automaticRefreshDue(start,start+age,false),false);assert.equal(automaticRefreshDue(start,start+900_000,false),true);assert.equal(automaticRefreshDue(start,start+900_000,true),false);assert.equal(automaticRefreshDue(start,start+3600_000,true),false);});
test('returning to a recent tab and backwards clock movement do not force reads',()=>{assert.equal(automaticRefreshDue(1000,2000,false),false);assert.equal(automaticRefreshDue(2000,1000,false),false);assert.equal(automaticRefreshDue(0,1000,true),false);});
test('camera saved-data reads have their own fifteen-minute visible-tab interval',()=>{
 const start=1_000_000;assert.equal(CAMERA_AUTO_REFRESH_MS,900_000);
 for(const age of [0,60_000,899_999])assert.equal(automaticRefreshDue(start,start+age,false,CAMERA_AUTO_REFRESH_MS),false);
 assert.equal(automaticRefreshDue(start,start+900_000,false,CAMERA_AUTO_REFRESH_MS),true);
 assert.equal(automaticRefreshDue(start,start+900_000,false),true,'routers, power and other default consumers remain at fifteen minutes');
 assert.equal(automaticRefreshDue(start,start+3600_000,true,CAMERA_AUTO_REFRESH_MS),false);
 assert.equal(automaticRefreshDue(start,start-1,false,CAMERA_AUTO_REFRESH_MS),false);
 assert.equal(automaticRefreshDue(start,NaN,false,CAMERA_AUTO_REFRESH_MS),false);
});

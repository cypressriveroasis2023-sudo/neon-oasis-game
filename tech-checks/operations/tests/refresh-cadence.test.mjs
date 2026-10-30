import test from 'node:test';import assert from 'node:assert/strict';
import {AUTO_REFRESH_MS,CAMERA_AUTO_REFRESH_MS,automaticRefreshDue} from '../src/refreshCadence.ts';
import {CAMERA_FRESH_MS} from '../src/cameraEvidence.ts';
test('automatic refresh waits fifteen minutes and never runs while hidden',()=>{const start=1_000_000;assert.equal(AUTO_REFRESH_MS,900_000);for(const age of [0,1_000,60_000,899_999])assert.equal(automaticRefreshDue(start,start+age,false),false);assert.equal(automaticRefreshDue(start,start+900_000,false),true);assert.equal(automaticRefreshDue(start,start+900_000,true),false);assert.equal(automaticRefreshDue(start,start+3600_000,true),false);});
test('returning to a recent tab and backwards clock movement do not force reads',()=>{assert.equal(automaticRefreshDue(1000,2000,false),false);assert.equal(automaticRefreshDue(2000,1000,false),false);assert.equal(automaticRefreshDue(0,1000,true),false);});
// Camera saved-data reads keep their own interval, separate from the default
// one routers and power use. Asserted against the constants rather than a
// literal so the cadence can be tuned without the test quietly pinning an old
// value - it previously hard-coded 900_000 and failed when the cadence was
// shortened to keep evidence inside its freshness window.
test('camera saved-data reads have their own visible-tab interval, shorter than the default',()=>{
 const start=1_000_000;
 // James set this figure explicitly at 10 minutes on 2026-10-30, so the exact
 // value is asserted as well as the relationships it has to satisfy. The
 // relational checks alone would let the requirement drift silently.
 assert.equal(CAMERA_AUTO_REFRESH_MS,600_000,'approved camera saved-read cadence is 10 minutes');
 assert.equal(AUTO_REFRESH_MS,900_000,'the default interval for routers, power and other consumers is unchanged');
 assert.ok(CAMERA_AUTO_REFRESH_MS<AUTO_REFRESH_MS,'camera evidence is read more often than default consumers');
 for(const age of [0,60_000,CAMERA_AUTO_REFRESH_MS-1])assert.equal(automaticRefreshDue(start,start+age,false,CAMERA_AUTO_REFRESH_MS),false);
 assert.equal(automaticRefreshDue(start,start+CAMERA_AUTO_REFRESH_MS,false,CAMERA_AUTO_REFRESH_MS),true);
 assert.equal(automaticRefreshDue(start,start+AUTO_REFRESH_MS-1,false),false,'routers, power and other default consumers keep the default interval');
 assert.equal(automaticRefreshDue(start,start+AUTO_REFRESH_MS,false),true,'routers, power and other default consumers keep the default interval');
 assert.equal(automaticRefreshDue(start,start+3600_000,true,CAMERA_AUTO_REFRESH_MS),false);
 assert.equal(automaticRefreshDue(start,start-1,false,CAMERA_AUTO_REFRESH_MS),false);
 assert.equal(automaticRefreshDue(start,NaN,false,CAMERA_AUTO_REFRESH_MS),false);
});

// The rule the cadence exists to satisfy. Camera evidence expires
// CAMERA_FRESH_MS after the PROVIDER observed it, not after we fetched it, so
// an observation is already aged on arrival. Measured 2026-10-30: the youngest
// of 474 Vigilant observations was 9 minutes old when read. If the read
// interval is not comfortably shorter than the freshness window, units drain
// into "unverified" between reads and the dashboard decays while sitting open.
test('camera reads are scheduled well inside the evidence freshness window',()=>{
 assert.ok(CAMERA_AUTO_REFRESH_MS<CAMERA_FRESH_MS,'a read must land before the previous evidence expires');
 assert.ok(CAMERA_FRESH_MS-CAMERA_AUTO_REFRESH_MS>=9*60_000,'leave room for observations that are already minutes old on arrival');
});

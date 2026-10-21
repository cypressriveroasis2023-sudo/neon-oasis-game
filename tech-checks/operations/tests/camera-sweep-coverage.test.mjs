import test from 'node:test';import assert from 'node:assert/strict';
import {projectCameraSweepCoverage,readCameraSweepCoverage} from '../shared/cameraSweepCoverage.ts';
const at='2026-10-20T22:15:40.626Z';
const input=()=>({provider:'avigilon',enabled:true,last_sync_at:at,last_sync_status:'partial',sweep:{source:'owned_saved_service_ports',counts_known:true,complete:false,eligible:166,scanned:166,published:166,held:18,reconciled_at:at,held_reasons:{identity_unverified:3,monitoring_disabled:4,ownership_unverified:1,retired_or_not_in_use:5,saved_endpoint_unavailable:5},offline:113,online:53,private:'must not escape'}});
test('the October20 partial sweep reports all held reasons and never exports outage totals or raw metadata',()=>{
 const coverage=projectCameraSweepCoverage([input()]);assert.equal(coverage.held,18);assert.equal(coverage.complete,false);
 assert.equal(coverage.heldReasons.reduce((n,r)=>n+r.count,0),18);
 assert.equal(coverage.observedAt,at);assert(!JSON.stringify(coverage).includes('113'));assert(!JSON.stringify(coverage).includes('must not escape'));
 assert.deepEqual(readCameraSweepCoverage(coverage),coverage);
});
test('the bounded PostgREST column projection yields the same coverage without reading raw metadata',()=>{
 const r=input(),m=r.sweep;
 const projected={provider:r.provider,enabled:r.enabled,last_sync_at:r.last_sync_at,last_sync_status:r.last_sync_status,
  sweep_source:m.source,sweep_complete:m.complete,sweep_counts_known:m.counts_known,
  sweep_eligible:m.eligible,sweep_scanned:m.scanned,sweep_published:m.published,sweep_held:m.held,
  sweep_reconciled_at:m.reconciled_at,sweep_held_reasons:m.held_reasons};
 assert.deepEqual(projectCameraSweepCoverage([projected]),projectCameraSweepCoverage([r]));
 assert.equal(projectCameraSweepCoverage([{...projected,sweep_eligible:'166'}]),null);
});
test('unknown, duplicate, incomplete, mismatched and malformed coverage cannot claim complete checks',()=>{
 for(const change of [r=>r.enabled=false,r=>r.sweep.held=17,r=>r.sweep.held_reasons.secret=1,r=>r.last_sync_at='bad',r=>r.sweep.published=167,r=>r.sweep.counts_known=false]){
  const r=input();change(r);assert.equal(projectCameraSweepCoverage([r]),null);
 }
 assert.equal(projectCameraSweepCoverage([input(),input()]),null);
 const r=input();r.sweep.complete=true;assert.equal(projectCameraSweepCoverage([r]).complete,false);
 const valid=projectCameraSweepCoverage([input()]);assert.equal(readCameraSweepCoverage({...valid,heldReasons:[null]}),null);
 assert.equal(readCameraSweepCoverage({...valid,heldReasons:[...valid.heldReasons,valid.heldReasons[0]]}),null);
});

import test from 'node:test';import assert from 'node:assert/strict';
import {cameraSummary,combinedState as backendCombined} from '../../supabase/functions/cos-operations-pages/cameraPlacementEvidence.ts';
import {combinedState as oldBackendCombined} from '../../supabase/functions/cos-operations-pages/cameraEvidence.ts';
import {combinedState} from '../src/cameraEvidence.ts';
import {currentTrackerShopScope} from '../../supabase/functions/cos-operations-pages/cameraTrackerShopScope.ts';
import {fixture,mhelpReceiptFor} from './camera-tracker-shop-fixtures.mjs';
test('missing coverage stays Unverified; Partial requires confirmed online and offline devices',()=>{
 for(const combine of [combinedState,backendCombined,oldBackendCombined]){
  for(const states of [['online','verifying'],['offline','verifying'],['online','mapping'],['verifying','mapping']])assert.equal(combine(states),'verifying');
  assert.equal(combine(['online','offline']),'degraded');assert.equal(combine(['degraded','verifying']),'degraded');assert.equal(combine(['online','online']),'online');assert.equal(combine(['offline','offline']),'offline');
 }
});
test('a stale first placement proof cannot trigger optional graph rereads',async()=>{
 const f=fixture();f.before.mhelpReceipt=mhelpReceiptFor(f);f.before.mhelpReceipt.lastSuccessAt='2000-01-01T00:00:00Z';let reads=0;
 const result=await currentTrackerShopScope(f.summary,f.tracker,f.before,{readSources:async()=>{reads++;return[]},readCurrent:async()=>{reads++;return f.after}});
 assert.strictEqual(result,f.summary);assert.equal(reads,0);
});
test('the saved-health read scales to 1000 source and tracker rows without repeated roster scans',()=>{
 let labelReads=0;const at='2026-10-19T11:00:00Z';
 const tracker=Array.from({length:1000},(_,i)=>({canonical_family:'Spotter',unit_tag:String(i+1),get source_label(){labelReads++;return 'Spotter '+(i+1);},tracker_state:'field_or_unknown'}));
 const devices=tracker.map((_,i)=>({id:i+1,unit_key:'Spotter '+(i+1),device_name:'Source '+(i+1),device_type:'NVR',organization:'Field',activation_state:'active',source:'vigilant_control_center',source_status:'online',source_last_seen_at:at}));
 const value=cameraSummary(devices,[],Date.parse(at),tracker,[]);assert.equal(value.totalDevices,1000);assert.equal(value.inventory.trackerOnlyRecords,0);assert.equal(value.rows.filter(row=>row.evidence.status==='online').length,1000);assert(labelReads<10000,'exact labels must be indexed once, not repeatedly scanned');
 const conflicting=[...tracker,{...tracker[0],source_label:'Spotter 1',tracker_state:'shop'}],changed=cameraSummary(devices,[],Date.parse(at),conflicting,[]);assert.equal(changed.rows.find(row=>row.id===1).scope,'unknown');
});

import test from 'node:test';import assert from 'node:assert/strict';
import {projectReconProviderInventory,reconDigest,reconResourceKey,reconAreaKey} from '../../supabase/functions/_shared/reconProviderInventory.ts';
import {projectReconProviderIdentities,appendReconProviderIdentities,reconTrackerKey,reconTrackerTuple,reconPhysicalTuple} from '../../supabase/functions/cos-operations-pages/reconProviderIdentity.ts';
import {REVIEWED_RECON_PROVIDER_GROUPS} from '../../supabase/functions/cos-operations-pages/reconProviderIdentityScope.ts';
import {cameraSummary} from '../../supabase/functions/cos-operations-pages/cameraPlacementEvidence.ts';
import {fieldCameraHealth,validateCameraHealth} from '../src/fieldCameraHealth.ts';
import {cameraOverview,healthWithFieldInventory} from '../src/cameraHealthCounts.ts';
import {readFileSync} from 'node:fs';
const now=Date.parse('2026-10-09T05:00:00Z'),at=new Date(now-60000).toISOString();
const gid=n=>'01'+n.toString(16).toUpperCase().padStart(4,'0')+'0000000000';
async function fixture(count=2){
 const unit={id:'a0000000-0000-4000-8000-000000000001',unitNumber:'Recon II 901',modelName:'RECON II',readOnly:true,recordSource:'Synthetic tracker',snapshotImportedAt:'2026-10-08T00:00:00Z',sourceVerifiedAt:null};
 const bridge={guid:gid(1),type:'bridge_4g',area:'Synthetic reviewed area',name:'Synthetic bridge'};
 const list=[bridge,...Array.from({length:count},(_,i)=>({guid:gid(i+2),type:'detector_hdr_xrl',area:bridge.area,name:'Synthetic detector '+i}))];
 const devices=list.slice(1).map((r,i)=>({id:i+1,external_device_id:r.guid,device_serial:'reconeyez:'+r.guid,device_name:r.name,device_type:'Reconeyez detector',source:'reconeyez',unit_key:r.area,organization:r.area,activation_state:'active',source_status:'online',source_last_seen_at:at,last_online_at:at,recon_battery_percent:22,recon_battery_updated_at:'2026-10-07T01:00:00Z',recon_battery_status:'low',recon_battery_status_updated_at:'2026-10-07T02:00:00Z'}));
 const index=await projectReconProviderInventory(list,at,[{external_device_id:bridge.guid,observed_at:at}]);
 const review={[await reconTrackerKey(unit.id)]:{trackerProof:await reconDigest(reconTrackerTuple(unit)),bridgeKey:await reconResourceKey(bridge.guid),areaKey:await reconAreaKey(bridge.area),providerProof:index.groups[0].proof,physicalProof:await reconDigest(reconPhysicalTuple(devices)),resourceIds:await Promise.all(devices.map(d=>reconDigest(['COS_HEALTH_RESOURCE_V1',String(d.id)]))),sourceKeys:[await reconDigest(['COS_HEALTH_SOURCE_UNIT_V1',bridge.area])],detectorCount:count}};
 return {units:[unit],devices,list,review,integrations:[{provider:'reconeyez',enabled:true,last_sync_status:'ok',last_sync_at:at,identity_inventory:index}]};
}
const project=f=>projectReconProviderIdentities(f.units,f.devices,f.integrations,f.review,now);
const health=async f=>({...cameraSummary(f.devices,[],now),...appendReconProviderIdentities({identityVersion:1,unitIdentities:[],identityWarnings:[]},await project(f))});
test('review scope has seven opaque assignments and exactly21detectors, never bridge camera rows',()=>{
 assert.equal(Object.keys(REVIEWED_RECON_PROVIDER_GROUPS).length,7);assert.equal(Object.values(REVIEWED_RECON_PROVIDER_GROUPS).reduce((n,r)=>n+r.detectorCount,0),21);
 for(const [key,r]of Object.entries(REVIEWED_RECON_PROVIDER_GROUPS))for(const h of [key,r.trackerProof,r.bridgeKey,r.areaKey,r.providerProof,r.physicalProof,...r.resourceIds,...r.sourceKeys])assert.match(h,/^[a-f0-9]{64}$/);
 const text=readFileSync(new URL('../../supabase/functions/cos-operations-pages/reconProviderIdentityScope.ts',import.meta.url),'utf8');assert.doesNotMatch(text,/reconeyez:|guid|device_serial|Recon II \d/);
});
test('complete unique provider area links exact saved detectors; opaque cache excludes raw inventory',async()=>{
 const f=await fixture(),r=await project(f);assert.equal(r.reconProviderUnitIdentities.length,1);assert.deepEqual(r.identityWarnings,[]);
 const serialized=JSON.stringify(f.integrations[0].identity_inventory);for(const row of f.list){assert(!serialized.includes(row.guid));assert(!serialized.includes(row.name));assert(!serialized.includes(row.area));}
 assert.equal(f.integrations[0].identity_inventory.resourceCount,3);const h=await health(f);validateCameraHealth(h);const field=fieldCameraHealth(f.units[0],f.units,h,now);assert.equal(field.state,'online');assert.equal(field.rows.length,2);assert.equal(field.association.kind,'reconeyez_area');assert.match(field.reason,/provider-area group/);assert.equal(cameraOverview(h,now).kinds.detectors,2);assert.equal(cameraOverview(h,now).kinds.cameras,0);
});
test('missing, duplicate or malformed complete provider identities reject inventory proof',async()=>{
 const f=await fixture();for(const rows of [[],[...f.list,f.list[0]],f.list.map((r,i)=>i? r:{...r,guid:''}),f.list.map((r,i)=>i?r:{...r,area:''})])await assert.rejects(()=>projectReconProviderInventory(rows,at));
});
test('added/removed bridges, new detectors, reassignment and short hardware-prefix collisions fail closed',async()=>{
 for(const mutate of [
  f=>f.list.push({guid:gid(90),type:'bridge_4g',area:f.list[0].area,name:'Extra bridge'}),
  f=>{f.list=f.list.slice(1);},
  f=>f.list.push({guid:gid(90),type:'detector_hdr_xrl',area:f.list[0].area,name:'Extra detector'}),
  f=>f.list.pop(),
  f=>{f.list[1].area='Different area';},
  f=>f.list.push({...f.list[0],guid:f.list[0].guid.slice(0,-1)+'F',area:'Different area'}),
 ]){const f=await fixture();mutate(f);f.integrations[0].identity_inventory=await projectReconProviderInventory(f.list,at);const r=await project(f);assert.equal(r.reconProviderUnitIdentities.length,0);assert.equal(r.identityWarnings.length,1);assert.deepEqual(r.identityWarnings[0].deviceIds,['1','2']);}
});
test('authentication failure, missing index, stale or future proof never admits current identity',async()=>{
 for(const mutate of [f=>{f.integrations[0].last_sync_status='failed';},f=>{f.integrations[0].enabled=false;},f=>{f.integrations=[];},f=>{delete f.integrations[0].identity_inventory;},f=>{f.integrations[0].identity_inventory.observedAt=new Date(now-1200001).toISOString();},f=>{f.integrations[0].identity_inventory.observedAt=new Date(now+1).toISOString();},f=>{f.integrations.push({...f.integrations[0]});}]){const f=await fixture();mutate(f);assert.equal((await project(f)).reconProviderUnitIdentities.length,0);}
});
test('changed tracker, resource incarnation, legacy family or duplicate ownership remain unverified',async()=>{
 for(const mutate of [f=>{f.units[0].unitNumber='Recon 901';},f=>{f.units[0].modelName='RECONS';},f=>{f.units[0].snapshotImportedAt='2026-10-09T00:00:00Z';},f=>{f.units[0].readOnly=false;},f=>{f.devices[0].device_serial='reconeyez:replacement';},f=>{f.devices[0].source='videofied';},f=>{f.devices[0].unit_key='Changed';},f=>f.devices.push({...f.devices[0],id:99}),f=>f.units.push({...f.units[0]})]){const f=await fixture();mutate(f);assert.equal((await project(f)).reconProviderUnitIdentities.length,0);}
 const f=await fixture();f.units=[];const r=await project(f);assert.equal(r.identityWarnings.length,1);assert.match(r.identityWarnings[0].unitId,/^unavailable:recon:/);assert.deepEqual(r.identityWarnings[0].deviceIds,['1','2']);
});
test('four-of-six fresh detectors stay partial; fresh bridge event and low battery never supply detector health',async()=>{
 const f=await fixture(6);for(const d of f.devices.slice(4))d.source_last_seen_at='2026-10-07T01:00:00Z';let h=await health(f),state=fieldCameraHealth(f.units[0],f.units,h,now);assert.equal(state.state,'unknown');assert.equal(state.observation.cameraState,'degraded');assert.equal(state.rows.length,6);
 for(const d of f.devices)d.source_last_seen_at='2026-10-07T01:00:00Z';h=await health(f);state=fieldCameraHealth(f.units[0],f.units,h,now);assert.equal(state.state,'unknown');assert.equal(state.observation.cameraState,'verifying');assert.equal(state.association.providerArea.bridgeLastEventAt,at);assert.equal(state.rows[0].batteryEvidence.percentObservedAt,'2026-10-07T01:00:00Z');assert.equal(state.rows[0].batteryEvidence.status,'low');assert.equal(cameraOverview(h,now).summary.online,0);
});
test('offline reviewed field units stay visible and client proof expiry denies identity without hiding raw records',async()=>{
 const f=await fixture();for(const d of f.devices)d.source_status='offline';const h=await health(f);assert.equal(fieldCameraHealth(f.units[0],f.units,h,now).state,'offline');assert.equal(h.rows.length,2);assert.equal(cameraOverview(h,now).records,2);
 const later=now+1200001;assert.equal(fieldCameraHealth(f.units[0],f.units,h,later).state,'unknown');assert.equal(cameraOverview(h,later).records,2);assert.equal(cameraOverview(h,later).summary.online,0);
});
test('reviewed provider areas cannot double-claim existing Owner or native resources',async()=>{
 const f=await fixture(),recon=await project(f),claim=recon.reconProviderUnitIdentities[0];
 const result=appendReconProviderIdentities({identityVersion:1,unitIdentities:[{...claim,kind:'native_provider',unitId:'different'}],identityWarnings:[]},recon);assert.equal(result.unitIdentities.length,0);assert.equal(result.reconProviderUnitIdentities.length,0);assert.equal(result.identityWarnings.length,2);
});
test('only exact synthetic placeholders are replaced while a complete current area is verified',async()=>{
 const f=await fixture(),h=await health(f),placeholder={id:'tracker:recon 2|901',unit:f.units[0].unitNumber,name:f.units[0].unitNumber,type:'tracker_unit',trackerOnly:true,scope:'unknown',activationState:'',status:'review'};
 const source={...h,rows:[...h.rows,placeholder],totalDevices:h.totalDevices+1,inventory:{...h.inventory,allRecords:h.inventory.allRecords+1,unknownScopeRecords:h.inventory.unknownScopeRecords+1}};
 const display=healthWithFieldInventory(source,f.units,now);validateCameraHealth(display);assert.equal(display.rows.length,2);assert.equal(source.rows.length,3);assert.deepEqual(display.rows,h.rows);
 const expired=healthWithFieldInventory(source,f.units,now+1200001);assert.equal(expired.rows.length,3);assert(expired.rows.includes(placeholder));
 const actual={...source,rows:source.rows.map(row=>row===placeholder?{...row,trackerOnly:false}:row)};assert.equal(healthWithFieldInventory(actual,f.units,now).rows.length,3);
});

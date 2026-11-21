import test from 'node:test';
import assert from 'node:assert/strict';
import {createMappedIdentityReview,prepareMappedIdentityReview} from '../../supabase/functions/cos-operations-pages/mappedIdentityReview.ts';
import {verifiedHealthIdentities} from '../../supabase/functions/cos-operations-pages/verifiedHealthIdentity.ts';
import {CAMERA_FRESH_MS} from '../../supabase/functions/cos-operations-pages/cameraEvidence.ts';
import {mappedFixture,unitId,unitKey,now} from './mapped-identity-fixture.mjs';
const preview=f=>prepareMappedIdentityReview(f.sources,f.upload,'101',unitKey,now);
test('complete exact mapped preview is read-only, preserves live proof absence and hides physical identifiers',async()=>{
 const f=mappedFixture(),saved=JSON.stringify(f);let reads=0;
 const result=await createMappedIdentityReview({now:()=>now,read:async key=>{assert.equal(key,unitKey);reads++;return structuredClone(f);}})('POST',{productId:'101',unitKey});
 assert.equal(reads,2);assert.equal(result.reviewOnly,true);assert.equal(result.commitSupported,false);assert.equal(result.liveVideoTested,false);assert.deepEqual(result.deviceIds,['1','2','3','4']);assert.equal(result.observations.length,4);assert.equal(result.reviewToken,undefined);
 assert.doesNotMatch(JSON.stringify(result),/synthetic-serial|synthetic-external|expectedGuard|physicalDigest/);assert.equal(JSON.stringify(f),saved);assert.equal((await verifiedHealthIdentities(f.sources)).unitIdentities.length,0);
});
const invalid=[
 ['held product',f=>f.upload.records[0].holdReason='installation_review'],
 ['placement held',f=>f.upload.records[0].placementHeld=true],
 ['manual lifecycle hold',f=>f.upload.records[0].lifecycle='DO_NOT_USE'],
 ['changed binding',f=>f.upload.records[0].binding.guardCurrent=false],
 ['wrong exact product',f=>f.upload.records[0].productId='102'],
 ['incomplete group',f=>f.sources.matches.pop()],
 ['new group resource',f=>f.sources.devices.push({...f.sources.devices[0],id:9,external_device_id:'new',device_serial:'new'})],
 ['duplicate serial',f=>f.sources.devices[1].device_serial=f.sources.devices[0].device_serial],
 ['duplicate mapping ownership',f=>f.sources.matches.push({...f.sources.matches[0],id:'44444444-4444-4444-8444-444444444444',equipment_unit_id:'55555555-5555-4555-8555-555555555555'})],
 ['wrong organization',f=>f.sources.providers[0].organization_id='55555555-5555-4555-8555-555555555555'],
 ['wrong provider family',f=>f.sources.providers[0].source='another_provider'],
 ['retired native',f=>f.sources.units[0].status='retired'],
 ['changed native label',f=>f.sources.units[0].unit_number='Changed unit'],
 ['missing epoch',f=>f.sources.ownerEpochs=[]],
 ['missing native epoch',f=>f.sources.ownerCrosswalk.nativeEpochs=[]],
 ['stale provider observation',f=>f.sources.devices[0].source_last_seen_at=new Date(now-CAMERA_FRESH_MS-1).toISOString()],
 ['future provider observation',f=>f.sources.devices[0].source_last_seen_at=new Date(now+1).toISOString()],
 ['partial provider observation',f=>f.sources.devices[0].source_last_seen_at=null],
 ['revoked Owner reservation',f=>f.sources.ownerCrosswalk.claims.push({id:'66666666-6666-4666-8666-666666666666',organization_id:'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',native_unit_id:unitId,native_unit_label:'Synthetic unit',legacy_unit_key:unitKey,device_ids:['1','2','3','4'],resource_epoch:'c'.repeat(64),physical_digest:'d'.repeat(64),provenance:'owner_confirmation',status:'revoked',revision:'2'})],
];
for(const [name,change] of invalid)test('mapped preview blocks '+name,async()=>{const f=mappedFixture();change(f);await assert.rejects(preview(f));});
for(const [name,change] of [
 ['source revision',f=>f.upload.sourceSha256='9'.repeat(64)],
 ['native epoch',f=>f.sources.ownerCrosswalk.nativeEpochs[0].epoch='9'.repeat(64)],
 ['provider status',f=>f.sources.devices[0].source_status='offline'],
 ['mapping evidence',f=>f.sources.matches[0].confidence='reviewed'],
])test('two-read preview blocks concurrent '+name+' change',async()=>{let n=0;await assert.rejects(createMappedIdentityReview({now:()=>now,read:async()=>{const f=mappedFixture();if(n++)change(f);return f;}})('POST',{productId:'101',unitKey}),/changed while loading/);});
test('unknown and recorder observations never become live video or channel proof',async()=>{
 const f=mappedFixture();for(const p of f.sources.providers)p.device_type='NVR';for(const d of f.sources.devices){d.device_type='NVR';d.source_status='authentication_failed';}
 const r=await preview(f);assert.ok(r.observations.every(o=>o.type==='NVR'&&o.providerReportedStatus==='unverified'));assert.equal(r.liveVideoTested,false);assert.match(r.consequence,/not.*prove recorder camera-channel health/);
});
test('request cannot supply actor, timestamp, binding, proof or confirmation fields',async()=>{
 for(const field of ['actorId','now','binding','proof','reviewToken','confirmationText'])await assert.rejects(createMappedIdentityReview({now:()=>now,read:async()=>{throw Error('must not read');}})('POST',{productId:'101',unitKey,[field]:'forged'}),/Only an exact Product ID/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {scheduleCameraMhelpIntake} from '../intake/mhelpIntakeBackground.ts';
import {identityDigest,nativeIdentityKey,nativeIdentityTuple,healthResourceKey,healthSourceUnitKey,verifiedHealthIdentities} from '../../supabase/functions/cos-operations-pages/verifiedHealthIdentity.ts';
import {fieldRecorderObservationGuards,fieldRecorderHealthGuards,projectFieldRecorderAuthority,REVIEWED_FIELD_RECORDER_PROOFS} from '../../supabase/functions/cos-operations-pages/fieldRecorderObservation.ts';
import {addressDigest} from '../../supabase/functions/cos-operations-pages/censusAddress.ts';
import {cameraSummary} from '../../supabase/functions/cos-operations-pages/cameraPlacementEvidence.ts';
import {fieldCameraHealth,unitHealthLabel} from '../src/fieldCameraHealth.ts';
import {cameraOverview,cameraUnitStatusLabel} from '../src/cameraHealthCounts.ts';
import {providerState} from '../src/cameraEvidence.ts';
const now=Date.parse('2026-10-09T06:40:00Z'),at='2026-10-09T06:35:00Z',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const uuid=(prefix)=>`${prefix}000000-0000-4000-8000-000000000001`;
async function fixture(){
 const unit={id:uuid('aa'),unit_number:'Spotter 987654HDC2',organization_id:org,status:'available'};
 const provider={id:uuid('bb'),organization_id:org,external_device_id:'synthetic-provider-serial',device_name:'Synthetic recorder',device_type:'NVR',source:'vigilant_control_center'};
 const match={id:uuid('cc'),organization_id:org,equipment_unit_id:unit.id,vigilant_device_id:provider.id,camera_key:'nvr',match_method:'reviewed_fixture',confidence:'exact'};
 const device={id:9001,external_device_id:provider.external_device_id,device_serial:'synthetic-physical-serial',device_name:provider.device_name,device_type:'NVR',unit_key:'SPOTTER 987654',organization:'ROOT',source:provider.source,activation_state:'deactivated',source_status:'online',source_last_seen_at:at};
 const sources={units:[unit],matches:[match],providers:[provider],devices:[device],audits:[]};
 const key=await nativeIdentityKey(unit.id),proof=await identityDigest(nativeIdentityTuple(unit,[{match,provider,device}]));
 const review={native:{[key]:proof},owner:new Set(),nativeResources:{[key]:{deviceIds:[await healthResourceKey('9001')],unitKeys:[await healthSourceUnitKey(device.unit_key)]}},ownerResources:{},ownerPhysical:{}};
 const binding={schemaVersion:1,organizationId:org,sourceSystem:'mhelpdesk_product_import',entityKind:'equipment_unit',nativeUnitId:unit.id,productId:'987654',unitNumber:unit.unit_number,family:'SPOTTERS',variant:'HDC2',sourceRevision:uuid('dd'),sourceFileSha256:'a'.repeat(64),sourceRowSha256:'b'.repeat(64),addressSha256:await addressDigest('123 Fixture Road, Test City, TX 77001'),nativeGuardSha256:'c'.repeat(64),installation:{street:'123 Fixture Road',city:'Test City',state:'TX',zip:'77001'},suppliedComponents:{street:true,city:true,state:true,zip:true},eligibility:'FIELD',eventId:'1'};
 const row={id:unit.id,unitNumber:unit.unit_number,modelName:'Spotter',readOnly:false,status:'field',currentLocationType:'field',importedPlacement:'FIELD',importedInstallation:binding};
 return {sources,review,integrations:[{provider:'vigilant',enabled:true,last_sync_status:'ok',last_sync_at:at}],allowed:new Set([proof]),snapshot:{items:[row],inventoryItems:[row],summary:{fieldUnits:1},generatedAt:at}};
}
async function project(f){
 const identity=await verifiedHealthIdentities(f.sources,f.review),guards=fieldRecorderHealthGuards(f.sources,identity,f.integrations,now,f.allowed);
 const snapshot=await projectFieldRecorderAuthority(f.snapshot,f.sources,identity,now,f.allowed),health={...cameraSummary(f.sources.devices,[],now),...identity,...guards};
 const row=snapshot.items[0],result=fieldCameraHealth(row,snapshot.items,health,now);
 return {identity,guards,snapshot,health,row,result};
}
test('only five opaque existing recorder commitments are eligible; defaults admit no synthetic identity',async()=>{
 assert.equal(REVIEWED_FIELD_RECORDER_PROOFS.size,5);for(const value of REVIEWED_FIELD_RECORDER_PROOFS)assert.match(value,/^[a-f0-9]{64}$/);
 const f=await fixture(),identity=await verifiedHealthIdentities(f.sources,f.review);assert.deepEqual(fieldRecorderObservationGuards(f.sources,identity,now).fieldRecorderObservationGuards,[]);
});
test('verified current Field authority displays a fresh recorder observation without rewriting historical state',async()=>{
 const f=await fixture(),before=structuredClone(f),p=await project(f);
 assert.equal(p.result.state,'online');assert.equal(unitHealthLabel(p.result),'RECORDER ONLINE');assert.equal(p.result.basis,'recorder');assert.equal(p.result.observation.cameraState,'mapping');assert.equal(p.result.classification.cameraState,'mapping');assert.equal(p.result.rows[0].activationState,'deactivated');assert.equal(p.result.rows[0].scope,'shop');assert.equal(p.result.classification.scope,'shop');assert.equal(providerState(p.result.rows[0],now),'verifying');assert.match(p.result.reason,/Current Field installation/);assert.deepEqual(f,before);
 assert.equal(p.snapshot.inventoryItems.length,1);assert.equal(p.snapshot.items.length,1);assert.equal(p.health.totalDevices,1);
 const group=cameraOverview(p.health,now,p.snapshot.items).groups[0];assert.equal(cameraUnitStatusLabel(group),'RECORDER ONLINE');assert.equal(group.cameraState,'mapping');
 assert.doesNotMatch(JSON.stringify(p.snapshot),/synthetic-physical-serial|synthetic-provider-serial/);
});
test('recorder offline remains separate from individual camera outages',async()=>{
 const f=await fixture();f.sources.devices[0].source_status='offline';const p=await project(f);
 assert.equal(p.result.state,'offline');assert.equal(unitHealthLabel(p.result),'RECORDER OFFLINE');assert.equal(p.result.classification.recorderOffline,true);assert.equal(p.result.observation.cameraState,'mapping');assert.equal(cameraOverview(p.health,now,p.snapshot.items).cameras.offline,0);assert.match(p.result.reason,/Individual camera channels and video are not verified/);
});
for(const [name,change] of [
 ['provider serial replacement',f=>f.sources.devices[0].device_serial='different-serial'],
 ['provider external ID replacement',f=>f.sources.providers[0].external_device_id='different-provider'],
 ['missing native match',f=>f.sources.matches=[]],
 ['changed native unit label',f=>f.sources.units[0].unit_number='Spotter 987653HDC2'],
 ['extra resource in complete group',f=>f.sources.devices.push({...f.sources.devices[0],id:9002,device_serial:'second-serial',external_device_id:'second-provider'})],
 ['duplicate provider serial',f=>f.sources.devices.push({...f.sources.devices[0],id:9002,unit_key:'Other unit',external_device_id:'second-provider'})],
 ['new competing native owner',f=>f.sources.matches.push({...f.sources.matches[0],id:uuid('ee'),equipment_unit_id:uuid('ff')})],
 ['native becomes Shop',f=>f.sources.units[0].status='shop'],
 ['new Owner Root move by resource',f=>f.sources.audits.push({id:99,action:'MOVE_TO_ROOT',unit_key:'Different historical label',device_ids:['9001']})],
 ['new Owner Shop move by exact key',f=>f.sources.audits.push({id:99,action:'MOVE_TO_ROOT',unit_key:'SPOTTER 987654',device_ids:[]})],
 ['historical Owner Field move remains a hold',f=>f.sources.audits.push({id:99,action:'MOVE_TO_FIELD',unit_key:'SPOTTER 987654',device_ids:['9001']})],
 ['malformed Owner roster',f=>f.sources.audits.push({id:99,unit_key:'Other unit',device_ids:null})],
 ])test(name+' denies the read-only recorder admission',async()=>{
 const f=await fixture();change(f);const p=await project(f);assert.equal(p.guards.fieldRecorderObservationGuards.length,0);assert.equal(p.row.fieldRecorderAuthority,undefined);assert.equal(p.result.state,'unknown');
});
for(const [name,change] of [
 ['current source is Shop',r=>r.importedPlacement='SHOP'],['source is tracker-only',r=>r.readOnly=true],['Field status removed',r=>r.status='shop'],['current physical type is Shop',r=>r.currentLocationType='shop'],['Owner projection wins',r=>r.placementSource='owner'],['Owner audit attached',r=>r.placementAuditId='99'],['source binding missing',r=>delete r.importedInstallation],['source belongs to another unit',r=>r.importedInstallation.nativeUnitId=uuid('ee')],['source label changed',r=>r.importedInstallation.unitNumber='Spotter 987653HDC2'],['invalid address digest',r=>r.importedInstallation.addressSha256='f'.repeat(64)],['source eligibility removed',r=>r.importedInstallation.eligibility='tombstone'],
 ])test(name+' provides no Field authority',async()=>{
 const f=await fixture();change(f.snapshot.items[0]);const p=await project(f);assert.equal(p.row.fieldRecorderAuthority,undefined);assert.equal(p.result.state,'unknown');
});
test('new Owner hold denies an old browser map authority when summary refreshes first',async()=>{
 const f=await fixture(),old=await project(f);f.sources.audits.push({id:99,action:'MOVE_TO_ROOT',unit_key:'SPOTTER 987654',device_ids:['9001']});f.integrations[0].last_sync_at='2026-10-09T06:39:00Z';f.sources.devices[0].source_last_seen_at='2026-10-09T06:39:00Z';const current=await project(f);
 assert.equal(fieldCameraHealth(old.row,[old.row],current.health,now).state,'unknown');assert.equal(old.row.fieldRecorderAuthority.schemaVersion,1);
});
for(const [name,change] of [
 ['source revision changed',p=>p.row.importedInstallation.sourceRevision=uuid('ee')],['native source guard changed',p=>p.row.importedInstallation.nativeGuardSha256='d'.repeat(64)],['source row changed',p=>p.row.importedInstallation.sourceRowSha256='d'.repeat(64)],['source file changed',p=>p.row.importedInstallation.sourceFileSha256='d'.repeat(64)],['source event changed',p=>p.row.importedInstallation.eventId='2'],['source product changed',p=>p.row.importedInstallation.productId='2'],['guard omitted',p=>delete p.health.fieldRecorderObservationVersion],['sync omitted from guard',p=>delete p.health.fieldRecorderObservationGuards[0].providerSyncAt],['guard sync stale',p=>p.health.fieldRecorderObservationGuards[0].providerSyncAt='2026-10-09T06:19:59Z'],['guard sync future',p=>p.health.fieldRecorderObservationGuards[0].providerSyncAt='2026-10-09T06:40:01Z'],['guard sync differs from source',p=>p.health.fieldRecorderObservationGuards[0].providerSyncAt='2026-10-09T06:36:00Z'],['malformed unrelated guard',p=>p.health.fieldRecorderObservationGuards.push({unitId:'other'})],['guard version unknown',p=>p.health.fieldRecorderObservationVersion=2],['guard duplicate',p=>p.health.fieldRecorderObservationGuards.push(p.health.fieldRecorderObservationGuards[0])],['guard stale',p=>p.health.fieldRecorderObservationGuards[0].checkedAt='2026-10-09T06:19:59Z'],['guard future',p=>p.health.fieldRecorderObservationGuards[0].checkedAt='2026-10-09T06:40:01Z'],['map authority stale',p=>p.row.fieldRecorderAuthority.checkedAt='2026-10-09T06:19:59Z'],['map authority future',p=>p.row.fieldRecorderAuthority.checkedAt='2026-10-09T06:40:01Z'],['guard proof changed',p=>p.health.fieldRecorderObservationGuards[0].identityProof='f'.repeat(64)],['guard resource changed',p=>p.health.fieldRecorderObservationGuards[0].deviceIds=['9002']],['map authority omitted',p=>delete p.row.fieldRecorderAuthority],
 ])test(name+' fails closed across independent map and health reads',async()=>{
 const p=await project(await fixture());change(p);assert.equal(fieldCameraHealth(p.row,[p.row],p.health,now).state,'unknown');
});
for(const [name,change] of [
 ['invalid cached provider state',d=>d.source_status='authentication_failed'],['provider state missing',d=>d.source_status=null],['provider time missing',d=>d.source_last_seen_at=null],['provider observation stale',d=>d.source_last_seen_at='2026-10-09T06:19:59Z'],['provider observation future',d=>d.source_last_seen_at='2026-10-09T06:40:01Z'],
 ])test(name+' stays unknown even when the exact Field recorder authority is current',async()=>{
 const f=await fixture();change(f.sources.devices[0]);const p=await project(f);assert.equal(p.result.state,'unknown');assert.equal(p.result.observation.cameraState,'mapping');assert.equal(p.result.observation.serviceState,'verifying');
});
test('unrelated Owner history does not suppress a proved Field recorder',async()=>{
 const f=await fixture();f.sources.audits.push({id:99,action:'MOVE_TO_ROOT',unit_key:'SPOTTER 123456',device_ids:['9100']});assert.equal((await project(f)).result.state,'online');
});
for(const cachedStatus of ['online','offline'])for(const [name,change] of [
 ['failed authentication sync',f=>f.integrations[0].last_sync_status='failed'],
 ['disabled integration',f=>f.integrations[0].enabled=false],
 ['partial inventory sync',f=>f.integrations[0].last_sync_status='partial'],
 ['missing integration',f=>f.integrations=[]],
 ['duplicate integration',f=>f.integrations.push({...f.integrations[0]})],
 ['missing sync timestamp',f=>f.integrations[0].last_sync_at=null],
 ['future sync timestamp',f=>f.integrations[0].last_sync_at='2026-10-09T06:40:01Z'],
 ['stale sync timestamp',f=>f.integrations[0].last_sync_at='2026-10-09T06:19:59Z'],
 ['new sync with unchanged old resource',f=>f.integrations[0].last_sync_at='2026-10-09T06:36:00Z'],
 ])test(name+' denies cached '+cachedStatus.toUpperCase()+' without erasing history',async()=>{
 const f=await fixture();f.sources.devices[0].source_status=cachedStatus;change(f);const p=await project(f);
 assert.equal(p.guards.fieldRecorderObservationGuards.length,0);assert.equal(p.result.state,'unknown');assert.equal(p.result.rows[0].evidence.status,cachedStatus);assert.equal(p.result.rows[0].evidence.observedAt,at);
});
test('actual producer authentication failure updates integration status and leaves cached source rows unchanged',async()=>{
 const f=await fixture(),cached=structuredClone(f.sources.devices),writes=[],requests=[];let handle;
 const source=readFileSync(new URL('../../supabase/functions/camera-provider-reconcile/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
 const javascript=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const db={rpc:async(name)=>{assert.equal(name,'verify_camera_health_cron_secret');return {data:true};},from(table){
  assert.equal(table,'camera_integrations','authentication fails before any camera write');return {update(patch){return {eq:async(column,value)=>{assert.equal(column,'provider');assert.equal(value,'vigilant');writes.push({table,patch});Object.assign(f.integrations[0],patch);return {error:null};}};}};
 }};
 vm.runInNewContext(javascript,{scheduleCameraMhelpIntake,Deno:{env:{get:()=> 'synthetic-test-only'},serve:callback=>{handle=callback;}},createClient:()=>db,Response,Request,AbortSignal,TextEncoder,URL,fetch:async(url)=>{requests.push(url);return new Response(JSON.stringify({message:'Synthetic authorization rejected'}),{status:401});},console:{error:()=>{}},setTimeout,clearTimeout});
 const response=await handle(new Request('https://synthetic.invalid',{method:'POST',headers:{'x-camera-cron-secret':'synthetic-test-only','Content-Type':'application/json'},body:JSON.stringify({mode:'vigilant'})}));
 assert.equal(response.status,500);assert.equal(requests.length,1);assert.equal(writes.length,1);assert.equal(f.integrations[0].last_sync_status,'failed');assert.deepEqual(f.sources.devices,cached);
 const projected=await project(f);assert.equal(projected.result.state,'unknown');assert.equal(projected.result.rows[0].evidence.status,'online');assert.equal(projected.result.rows[0].evidence.observedAt,at);
});

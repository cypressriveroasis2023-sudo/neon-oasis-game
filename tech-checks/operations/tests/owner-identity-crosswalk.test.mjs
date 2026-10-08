import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {fixture,row,snapshot,audit,unitId} from './native-placement-alias-fixtures.mjs';
import {OWNER_IDENTITY_ORG,OWNER_IDENTITY_CONTRACT,ownerIdentityDigest,ownerConfirmedPhysicalTuple,prepareOwnerIdentityReview,projectOwnerConfirmedIdentities} from '../../supabase/functions/cos-operations-pages/ownerIdentityCrosswalk.ts';
import {createOwnerIdentityReview} from '../../supabase/functions/cos-operations-pages/ownerIdentityReview.ts';
import {verifiedHealthIdentities} from '../../supabase/functions/cos-operations-pages/verifiedHealthIdentity.ts';
import {projectOwnerPlacement} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';
import {resolveVerifiedUnitIdentity} from '../src/verifiedUnitIdentity.ts';
const key='SOLARSPOTTER 987654',label='Spotter987654HDC2';
const claimId='88888888-8888-4888-8888-888888888888',requestId='99999999-9999-4999-8999-999999999999';
const emptyReview={native:{},owner:new Set(),nativeResources:{},ownerResources:{},ownerPhysical:{}};
async function setup(){
 const f=await fixture(label);f.sources.devices[0].unit_key=key;f.sources.units[0].status='available';f.sources.matches=[];f.sources.providers=[];
 const epoch='a'.repeat(64),crosswalk={revision:'b'.repeat(64),nativeEpochs:[{unitId,epoch:'e'.repeat(64)}],claims:[]};
 const sources={...f.sources,epochs:[{unitKey:key,epoch,deviceIds:['9101']}],crosswalk};
 const evidence=await prepareOwnerIdentityReview(sources,unitId,key,{unitIdentities:[],identityWarnings:[]});
 const claim={id:claimId,organization_id:OWNER_IDENTITY_ORG,native_unit_id:unitId,native_unit_label:label,legacy_unit_key:key,device_ids:['9101'],resource_epoch:epoch,physical_digest:evidence.physicalDigest,provenance:'owner_confirmation',status:'active',revision:'1',product_association:null};
 const bind=()=>{sources.crosswalk.claims=[claim];return sources;};
 const identity=()=>verifiedHealthIdentities({...sources,ownerCrosswalk:sources.crosswalk,ownerEpochs:sources.epochs},emptyReview);
 return {sources,claim,evidence,bind,identity};
}
test('zero-match labels do not infer any link; exact Owner confirmation is a distinct provenance',async()=>{
 const f=await setup();assert.equal((await f.identity()).ownerConfirmedUnitIdentities.length,0);f.bind();
 const result=await f.identity();assert.equal(result.ownerConfirmedUnitIdentities[0].kind,'owner_confirmed_native');assert.deepEqual(result.ownerConfirmedUnitIdentities[0].unitKeys,[key]);
 assert.equal(JSON.stringify(result).includes('synthetic-serial'),false);assert.equal(JSON.stringify(result).includes('confirmation_text'),false);
 assert.equal(result.ownerConfirmedUnitIdentities[0].unitNumber,label);assert.equal(result.ownerConfirmedUnitIdentities[0].unitId,unitId);
});
for(const [name,mutate] of [
 ['changed native label',f=>f.sources.units[0].unit_number+='S'],
 ['missing native source',f=>f.sources.units=[]],
 ['missing resource',f=>f.sources.devices=[]],
 ['resource serial changed',f=>f.sources.devices[0].device_serial='replacement'],
 ['resource type changed',f=>f.sources.devices[0].device_type='NVR'],
 ['source changed',f=>f.sources.devices[0].source='different_source'],
 ['external ID changed',f=>f.sources.devices[0].external_device_id='different_external'],
 ['raw key changed',f=>f.sources.devices[0].unit_key='SPOTTER 987654'],
 ['epoch changed and fields restored',f=>f.sources.epochs[0].epoch='c'.repeat(64)],
 ['epoch missing',f=>f.sources.epochs=[]],
 ['extra group member',f=>f.sources.devices.push({...f.sources.devices[0],id:9102,external_device_id:'second',device_serial:'second'})],
 ['duplicate resource ID',f=>f.sources.devices.push({...f.sources.devices[0]})],
 ['revoked',f=>f.claim.status='revoked'],
 ['competing provider link',f=>f.sources.matches.push({equipment_unit_id:unitId})],
 ['duplicate crosswalk native/resource claim',f=>f.sources.crosswalk.claims.push({...f.claim,id:requestId})],
 ['same serial claimed elsewhere',f=>f.sources.devices.push({...f.sources.devices[0],id:9102,external_device_id:'different',unit_key:'SNIPER 987654'})],
 ['duplicate target label',f=>f.sources.units.push({...f.sources.units[0],id:requestId})],
 ['source key normalized collision',f=>f.sources.devices.push({...f.sources.devices[0],id:9102,external_device_id:'second',device_serial:'second',unit_key:'solarspotter 987654'})],
])test(name+' denies the link and retains UUID/resource/key quarantine',async()=>{
 const f=await setup();f.bind();mutate(f);const result=await f.identity();assert.equal(result.ownerConfirmedUnitIdentities.length,0);assert.ok(result.identityWarnings.some(w=>w.unitId===unitId&&w.deviceIds.includes('9101')&&w.unitKeys.includes(key)));
 if(f.sources.units.length===1&&f.sources.units[0].unit_number===label){const projected=await projectOwnerPlacement(snapshot(),[],f.sources.devices,result,f.sources.units);assert.equal(projected.items.some(r=>r.id===unitId),false);assert.equal(projected.inventoryItems.find(r=>r.id===unitId).latitude,null);}
});
for(const other of ['SNIPER 987654','SPOTTER 98765','SPOTTER 987654.1','Spotter987654HDC4','SOLARSPOTTER 987655'])test('never infers related alias '+other,async()=>{
 const f=await setup();f.bind();f.sources.devices.push({...f.sources.devices[0],id:9102,unit_key:other,device_serial:'other-serial',external_device_id:'other-external'});
 const result=await f.identity();assert.equal(result.ownerConfirmedUnitIdentities.length,1);assert.deepEqual(result.ownerConfirmedUnitIdentities[0].deviceIds,['9101']);
});
test('benign IP/ports/status/location updates do not change physical digest or identity',async()=>{
 const f=await setup();f.bind();const old=await f.identity();Object.assign(f.sources.devices[0],{public_ip:'203.0.113.88',expected_ports:[123],organization:'Different site',source_status:'online',last_probe_online_at:'2026-10-08T12:00:00Z',connection_revision:99});
 assert.deepEqual(await f.identity(),old);assert.equal(await ownerIdentityDigest(ownerConfirmedPhysicalTuple(key,f.sources.devices)),f.claim.physical_digest);
});
test('identity alone preserves existing pin; FIELD and SHOP moves use existing audit and one native UUID',async()=>{
 const f=await setup();f.bind();let identities=await f.identity();let result=await projectOwnerPlacement(snapshot(),[],f.sources.devices,identities,f.sources.units);
 assert.equal(result.items[0].latitude,30);assert.equal(result.nativePlacementAliases.length,1);assert.equal(result.nativePlacementAliases[0].unitId,unitId);
 f.sources.audits=[audit({unit_key:key})];identities=await f.identity();result=await projectOwnerPlacement(snapshot(),f.sources.audits,f.sources.devices,identities,f.sources.units);
 assert.equal(result.items.length,1);assert.equal(result.items[0].id,unitId);assert.equal(result.items[0].latitude,null);assert.equal(result.nativePlacementAliases[0].auditId,'100');
 f.sources.audits=[audit({unit_key:key,placement:'SHOP',action:'MOVE_TO_ROOT',site_label:null,street_address:null})];result=await projectOwnerPlacement(snapshot(),f.sources.audits,f.sources.devices,identities,f.sources.units);assert.equal(result.items.length,0);assert.equal(result.inventoryItems.length,1);
});
test('revocation before any move removes stale current pin while preserving historical coordinates',async()=>{
 const f=await setup();f.bind();f.claim.status='revoked';const result=await projectOwnerPlacement(snapshot(),[],f.sources.devices,await f.identity(),f.sources.units);
 assert.equal(result.items.length,0);assert.equal(result.inventoryItems[0].historicalLatitude,30);assert.equal(result.inventoryItems[0].latitude,null);assert.equal(result.nativePlacementAliases.length,0);
});
test('frontend health and existing editor accept exact owner-confirmed capability, not fabricated provider proof',async()=>{
 const f=await setup();f.bind();const identity=await f.identity();const health={...identity,evidenceVersion:2,rows:[{id:'9101',unit:key,type:'IPC',trackerOnly:false}]};
 const map=await projectOwnerPlacement(snapshot(),[],f.sources.devices,identity,f.sources.units);
 assert.equal(resolveVerifiedUnitIdentity({id:unitId,unitNumber:label},health).state,'verified');
 const sandbox={};vm.createContext(sandbox);vm.runInContext(readFileSync(new URL('../../camera-placement-controls.js',import.meta.url),'utf8'),sandbox);
 const state={unitKey:key,placement:'FIELD',siteLabel:'Synthetic site',streetAddress:'',auditId:null,canMove:true};
 const resolved=sandbox.CameraPlacementControls.resolvePlacement(map,health,state,key);assert.equal(resolved.nativeAlias.unitId,unitId);assert.equal(resolved.writerCompatible,true);assert.equal(resolved.address,map.items[0].address);
 const altered=structuredClone(health);altered.ownerConfirmedUnitIdentities[0].proof='f'.repeat(64);assert.throws(()=>sandbox.CameraPlacementControls.resolvePlacement(map,altered,state,key),/association changed/);
});
test('preview token is stale on any source epoch or registry revision change',async()=>{
 const f=await setup();const original=f.evidence.reviewToken;f.sources.crosswalk.revision='c'.repeat(64);assert.notEqual((await prepareOwnerIdentityReview(f.sources,unitId,key,{unitIdentities:[],identityWarnings:[]})).reviewToken,original);
 f.sources.crosswalk.revision='b'.repeat(64);f.sources.epochs[0].epoch='d'.repeat(64);assert.notEqual((await prepareOwnerIdentityReview(f.sources,unitId,key,{unitIdentities:[],identityWarnings:[]})).reviewToken,original);
});
test('review handler blocks client-forged proof and never replays uncertain confirmation',async()=>{
 const f=await setup();let calls=0;const handler=createOwnerIdentityReview({actorId:unitId,organizationId:OWNER_IDENTITY_ORG,read:async()=>({sources:f.sources,identity:await f.identity()}),rpc:async()=>{calls++;throw Error('uncertain');}});
 await assert.rejects(()=>handler('/api/owner-identity/confirm','POST',{unitId,unitKey:key,physicalDigest:'a'.repeat(64)}),/Unsupported/);assert.equal(calls,0);
 await assert.rejects(()=>handler('/api/owner-identity/confirm','POST',{unitId,unitKey:key,reviewToken:'c'.repeat(64),requestId,confirmationText:'I inspected the physical equipment.'}),/reviewed identity changed/);assert.equal(calls,0);
 await assert.rejects(()=>handler('/api/owner-identity/confirm','POST',{unitId,unitKey:key,reviewToken:f.evidence.reviewToken,requestId,confirmationText:'I inspected the physical equipment.'}),/uncertain/);assert.equal(calls,1);
});
test('unconfirmed SHOP model/suffix concern blocks a shadow; truly unmapped SHOP remains movable',async()=>{
 const f=await setup();const identity=await f.identity();const health={...identity,evidenceVersion:2,rows:[{id:'9101',unit:key,trackerOnly:false}]};
 const sandbox={};vm.createContext(sandbox);vm.runInContext(readFileSync(new URL('../../camera-placement-controls.js',import.meta.url),'utf8'),sandbox);
 const map=await projectOwnerPlacement(snapshot(),[],f.sources.devices,identity,f.sources.units),state={unitKey:key,placement:'SHOP',siteLabel:'',streetAddress:'',auditId:null,canMove:true};
 assert.throws(()=>sandbox.CameraPlacementControls.resolvePlacement(map,health,state,key),/explicit Owner identity review/);
 assert.equal(sandbox.CameraPlacementControls.resolvePlacement({...map,items:[],inventoryItems:[],summary:{fieldUnits:0}},health,state,key).newInstallation,true);
 const moved=await projectOwnerPlacement(snapshot(),[audit({unit_key:key})],f.sources.devices,identity,f.sources.units);assert.equal(moved.items.length,0);assert.equal(moved.inventoryItems.length,1);assert.equal(moved.inventoryItems[0].id,unitId);assert.equal(moved.inventoryItems[0].placement,'UNKNOWN');
});
test('additive Owner identity contract leaves the original cached-client envelope valid for unrelated units',async()=>{
 const f=await setup();f.bind();const result=await f.identity();assert.deepEqual(result.unitIdentities,[]);assert.equal(result.identityVersion,1);assert.equal(result.ownerConfirmedIdentityVersion,1);assert.equal(result.ownerConfirmedUnitIdentities[0].kind,'owner_confirmed_native');
 // Exact discriminant/field validation used by the previously deployed V1 reader.
 const cachedV1=health=>{assert.equal(health.identityVersion,1);assert.equal(health.evidenceVersion,2);assert.ok(Array.isArray(health.unitIdentities));for(const proof of health.unitIdentities){assert.ok(['native_provider','owner_placement'].includes(proof.kind));assert.ok(proof.deviceIds.length);assert.match(proof.proof,/^[a-f0-9]{64}$/);}};
 const unrelated={unitId:'77777777-7777-4777-8777-777777777777',unitNumber:'SNIPER 12345',kind:'native_provider',deviceIds:['9999'],unitKeys:['SNIPER 12345'],proof:'f'.repeat(64)};
 const health={...result,evidenceVersion:2,unitIdentities:[unrelated],rows:[]};assert.doesNotThrow(()=>cachedV1(health));assert.equal(health.unitIdentities[0],unrelated);
 f.claim.status='revoked';const revoked=await f.identity();assert.equal(revoked.ownerConfirmedUnitIdentities.length,0);assert.ok(revoked.identityWarnings.some(w=>w.unitId===unitId&&w.unitKeys.includes(key)));assert.doesNotThrow(()=>cachedV1({...revoked,evidenceVersion:2}));
});
test('native pre-confirmation incarnation is included in the review token',async()=>{
 const f=await setup();const initial=f.evidence.reviewToken;f.sources.crosswalk.nativeEpochs[0].epoch='f'.repeat(64);const changed=await prepareOwnerIdentityReview(f.sources,unitId,key,{unitIdentities:[],identityWarnings:[]});assert.notEqual(changed.reviewToken,initial);
});

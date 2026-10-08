import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {projectOwnerPlacement,projectCameraOwnerPlacement} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';
import {fixture,row,audit,key,label,unitId,controlId,historyId,address} from './native-placement-alias-fixtures.mjs';
const ctx=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('../../camera-placement-controls.js',import.meta.url),'utf8'),ctx);
const resolve=(snapshot,health,state)=>ctx.CameraPlacementControls.resolvePlacement(snapshot,health,state,key);
const project=async f=>projectOwnerPlacement(f.snapshot,f.sources.audits,f.sources.devices,await f.identity(),f.sources.units);
const state=(patch={})=>({unitKey:key,placement:'FIELD',siteLabel:'Synthetic provider site',streetAddress:'',auditId:null,canMove:true,...patch});
const health=async f=>({evidenceVersion:2,rows:f.sources.devices.map(d=>({id:d.id,unit:d.unit_key,trackerOnly:false})),...await f.identity()});
const strip=r=>{const {_sourceField,_placementProof,...rest}=r;return rest;};
test('capability first save changes exactly the existing native UUID without creating the control row',async()=>{
 const f=await fixture(),before=structuredClone(f.sources),initial=await project(f);
 assert.deepEqual(initial.items,[strip(f.snapshot.items[0])]);assert.equal(initial.placementProjectionVersion,2);
 const t=initial.nativePlacementAliases[0];assert.deepEqual(t,{contract:'COS_NATIVE_PLACEMENT_ALIAS_V1',writerContract:'COS_CAMERA_PLACEMENT_V2',unitId,unitNumber:label,unitKey:key,deviceIds:['9101'],proof:(await f.identity()).unitIdentities[0].proof,auditId:null});
 const editable=resolve(initial,await health(f),state());assert.equal(editable.writerCompatible,true);assert.equal(editable.nativeAlias.unitId,unitId);assert.equal(editable.address,address);
 f.sources.audits.push(audit());const result=await project(f);
 assert.equal(result.items.length,1);assert.equal(result.inventoryItems.length,1);assert.equal(result.items[0].id,unitId);assert.equal(result.items[0].unitNumber,label);assert.equal(result.inventoryItems.some(r=>r.id===controlId),false);
 assert.equal(result.items[0].placementUnitKey,key);assert.equal(result.items[0].placementAuditId,'100');assert.equal(result.items[0].address,audit().street_address);assert.equal(result.items[0].site,audit().site_label);
 assert.equal(result.items[0].latitude,null);assert.equal(result.items[0].locationVerification,'address_changed');assert.equal(result.items[0].historicalLatitude,30);assert.equal(result.items[0].installedSiteId,null);assert.equal(result.nativePlacementAliases[0].auditId,'100');
 assert.deepEqual(f.sources.devices,before.devices);assert.deepEqual(f.snapshot.items[0],row());
 const edited=resolve(result,await health(f),state({auditId:'100',siteLabel:audit().site_label,streetAddress:audit().street_address}));assert.equal(edited.writerCompatible,true);assert.equal(edited.field,true);
});
test('address change, SHOP and redeployment retain native ID, raw audit provenance and prior history',async()=>{
 const f=await fixture();
 for(const a of [audit(),audit({id:'101',street_address:'300 Synthetic Fixture Rd',created_at:'2026-10-08T13:00:00Z'}),audit({id:'102',placement:'SHOP',action:'MOVE_TO_ROOT',site_label:null,street_address:null,created_at:'2026-10-08T14:00:00Z'}),audit({id:'103',created_at:'2026-10-08T15:00:00Z'})]){
  f.sources.audits.push(a);const p=await project(f);assert.equal(p.inventoryItems.length,1);assert.equal(p.inventoryItems[0].id,unitId);assert.equal(p.inventoryItems[0].placement,a.placement);assert.equal(p.inventoryItems[0].placementAuditId,a.id);assert.equal(p.inventoryItems[0].placementUnitKey,key);assert.equal(p.items.length,a.placement==='FIELD'?1:0);assert.equal(p.nativePlacementAliases[0].auditId,a.id);
  const r=resolve(p,await health(f),state({placement:a.placement,auditId:a.id,siteLabel:a.site_label||'',streetAddress:a.street_address||''}));assert.equal(r.writerCompatible,true);assert.equal(r.field,a.placement==='FIELD');
 }
});
test('later matching Owner GPS history restores only its own current address, never old GPS',async()=>{
 const f=await fixture();f.sources.audits=[audit()];
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(audit().street_address.toLowerCase()))),b=>b.toString(16).padStart(2,'0')).join('');
 f.snapshot.inventoryItems[0]._placementProof={owner:true,historyId,note:'COS_FIELD_LOCATION_V1|address_sha256='+hash+'|confirmed=true'};
 for(const [stamp,owner,hashSuffix,expected] of [['2026-10-08T11:00:00Z',true,'',false],['2026-10-08T13:00:00Z',false,'',false],['2026-10-08T13:00:00Z',true,'x',false],['2026-10-08T13:00:00Z',true,'',true]]){
  Object.assign(f.snapshot.inventoryItems[0],{gpsRecordedAt:stamp,_placementProof:{owner,historyId,note:'COS_FIELD_LOCATION_V1|address_sha256='+hash+hashSuffix+'|confirmed=true'}});
  const p=await project(f);assert.equal(p.items[0].locationVerification,expected?'owner_verified':'address_changed');assert.equal(p.items[0].latitude,expected?30:null);
 }
});
for(const [name,change] of Object.entries({
 'removed mapping':f=>f.sources.matches=[],
 'changed serial':f=>f.sources.devices[0].device_serial='different-synthetic-serial',
 'changed external identity':f=>f.sources.devices[0].external_device_id='different-synthetic-external',
 'changed source':f=>f.sources.devices[0].source='reconeyez',
 'added resource':f=>f.sources.devices.push({...f.sources.devices[0],id:9102,external_device_id:'extra-external',device_serial:'extra-serial'}),
 'removed native':f=>{f.sources.units=[];f.snapshot.items=[];f.snapshot.inventoryItems=[];},
 'missing provider':f=>f.sources.providers=[],
 'changed native label':f=>{f.sources.units[0].unit_number='Different synthetic label';f.snapshot.inventoryItems[0].unitNumber='Different synthetic label';},
 'changed resource key':f=>f.sources.devices[0].unit_key='SPOTTER 987655',
 'duplicate mapping claim':f=>f.sources.matches.push({...f.sources.matches[0],id:'88888888-8888-4888-8888-888888888888',equipment_unit_id:'99999999-9999-4999-8999-999999999999'}),
 'raw key alias':f=>f.sources.devices.push({...f.sources.devices[0],id:9102,unit_key:'Spotter987654',external_device_id:'extra-external',device_serial:'extra-serial'}),
 'native key alias':f=>f.sources.devices.push({...f.sources.devices[0],id:9102,unit_key:label,external_device_id:'extra-external',device_serial:'extra-serial'}),
 'native read only':f=>f.snapshot.inventoryItems[0].readOnly=true,
 'control row collision':f=>{f.snapshot.inventoryItems.push(row({id:controlId,unitNumber:'OTHER SYNTHETIC 999',_sourceField:false}));f.sources.units.push({id:controlId,unit_number:'OTHER SYNTHETIC 999',organization_id:f.sources.units[0].organization_id});},
 'raw inventory collision':f=>{f.snapshot.inventoryItems.push(row({id:controlId,unitNumber:key,_sourceField:false}));f.sources.units.push({id:controlId,unit_number:key,organization_id:f.sources.units[0].organization_id});},
 'native inventory collision':f=>{f.snapshot.inventoryItems.push(row({id:controlId,unitNumber:label,_sourceField:false}));f.sources.units.push({id:controlId,unit_number:label,organization_id:f.sources.units[0].organization_id});},
 'newer unmarked audit':f=>f.sources.audits.push(audit({id:'101',contract:null})),
 'competing native audit':f=>f.sources.audits.push(audit({id:'101',unit_key:label,control_id:'99999999-9999-4999-8999-999999999999'})),
}))test(name+' revokes alias and never generates a shadow or falls back to the name',async()=>{
 const f=await fixture();f.sources.audits=[audit()];change(f);const p=await project(f);
 assert.deepEqual(p.nativePlacementAliases,[]);assert.ok(p.placementReviews.length);assert.equal(p.inventoryItems.some(r=>r.recordSource==='Owner camera placement'),false);assert.equal(p.inventoryItems.filter(r=>r.id===unitId&&r.placement==='FIELD').length,0);
});
test('unmarked historical audit does not move native row or invalidate its current pin, but binds CAS',async()=>{
 const f=await fixture();f.sources.audits=[audit({contract:null,placement:null,action:'HISTORICAL'})];const p=await project(f);assert.deepEqual(p.items,[strip(row())]);assert.equal(p.nativePlacementAliases[0].auditId,'100');
});
test('projection never mutates health source observations or GPS/location history',async()=>{
 const f=await fixture();f.sources.audits=[audit()];const before={snapshot:structuredClone(f.snapshot)};
 await project(f);const rows=projectCameraOwnerPlacement(f.sources.devices,f.sources.audits);const {__ownerPlacement,...original}=rows[0];assert.equal(__ownerPlacement,'FIELD');assert.deepEqual(original,f.sources.devices[0]);assert.deepEqual(f.snapshot,before.snapshot);
});
test('old and incompatible backend versions retain alias read-only without broadening suffix matching',async()=>{
 const f=await fixture(),p=await project(f),h=await health(f);
 for(const version of [undefined,1,3,'2']){const old={...p,placementProjectionVersion:version};assert.equal(resolve(old,h,state()).writerCompatible,false);}
 assert.notEqual(ctx.CameraPlacementControls.placementMatchKey(key),ctx.CameraPlacementControls.placementMatchKey(label));
});
test('capability must agree with independently refreshed native row, full proof, device set and latest audit',async()=>{
 const f=await fixture(),p=await project(f),h=await health(f);
 const changes={proof:t=>t.proof='b'.repeat(64),audit:t=>t.auditId='99',raw:t=>t.unitKey='SPOTTER 987655',label:t=>t.unitNumber='Different label',uuid:t=>t.unitId=controlId,devices:t=>t.deviceIds=['9102'],contract:t=>t.contract='COS_NATIVE_PLACEMENT_ALIAS_V0',writer:t=>t.writerContract='UNSUPPORTED'};
 for(const [name,change] of Object.entries(changes)){const copy=structuredClone(p);change(copy.nativePlacementAliases[0]);assert.throws(()=>resolve(copy,h,state()),undefined,name);}
 const duplicate=structuredClone(p);duplicate.nativePlacementAliases.push({...duplicate.nativePlacementAliases[0]});assert.throws(()=>resolve(duplicate,h,state()));
 const missing=structuredClone(p);delete missing.nativePlacementAliases;assert.throws(()=>resolve(missing,h,state()));
 const changed=structuredClone(h);changed.unitIdentities[0].proof='c'.repeat(64);assert.throws(()=>resolve(p,changed,state()));
});
test('preflight revision includes capability/proof so backend rollout changes cannot reuse an opened form',async()=>{
 const f=await fixture(),p=await project(f),h=await health(f);const current=resolve(p,h,state());
 const old=resolve({...p,placementProjectionVersion:1},h,state());assert.notEqual(current.revision,old.revision);
 const altered=structuredClone(p),changedHealth=structuredClone(h);altered.nativePlacementAliases[0].proof='d'.repeat(64);changedHealth.unitIdentities[0].proof='d'.repeat(64);assert.notEqual(current.revision,resolve(altered,changedHealth,state()).revision);
});
test('duplicate reviewed claims and reused control UUID quarantine every claimant without order-dependent shadows',async()=>{
 const f=await fixture();f.sources.audits=[audit(),audit({id:'101',unit_key:'UNRELATED SYNTHETIC',device_ids:['9102']})];f.sources.devices.push({id:9102,unit_key:'UNRELATED SYNTHETIC'});
 for(const reverse of [false,true]){if(reverse)f.sources.audits.reverse();const p=await project(f);assert.deepEqual(p.nativePlacementAliases,[]);assert.equal(p.inventoryItems.some(r=>r.recordSource==='Owner camera placement'),false);assert.equal(p.placementReviews.length,2);}
 const g=await fixture(),identity=await g.identity();identity.unitIdentities.push({...identity.unitIdentities[0],unitId:controlId});g.sources.audits=[audit()];const p=await projectOwnerPlacement(g.snapshot,g.sources.audits,g.sources.devices,identity,g.sources.units);assert.deepEqual(p.nativePlacementAliases,[]);assert.equal(p.inventoryItems.length,1);assert.equal(p.inventoryItems[0].placement,'UNKNOWN');
});
test('missing, malformed and incompatible reviewed identity inputs do not advertise an alias',async()=>{
 const f=await fixture();for(const identity of [{identityVersion:2,unitIdentities:[],identityWarnings:[]},{identityVersion:1,unitIdentities:null,identityWarnings:[]},{identityVersion:1,unitIdentities:[{}],identityWarnings:[]}])await assert.rejects(projectOwnerPlacement(f.snapshot,[],f.sources.devices,identity,f.sources.units));
 const old=await projectOwnerPlacement(f.snapshot,[],f.sources.devices);assert.equal(old.nativePlacementAliases,undefined);
});
test('field-map and summary-v3 use exactly the same deployed selected-field identity source queries',()=>{
 const source=fs.readFileSync(new URL('../../supabase/functions/cos-operations-pages/index.ts',import.meta.url),'utf8');
 const map=source.slice(source.indexOf("if (path === '/api/field-map')"),source.indexOf('if (snapshots[path])'));
 const summary=source.slice(source.indexOf("if (path === '/api/camera-health/summary-v3')"),source.indexOf("if (path === '/api/camera-health/summary')"));
 const helper=source.slice(source.indexOf('const readIdentitySources'),source.indexOf('// Share one large-transfer'));
 for(const table of ['camera_devices','equipment_units','vision_vigilant_unit_matches','vision_vigilant_devices'])assert.ok(helper.includes(table+'?select='),table);
 assert.match(map,/readIdentitySources\(context\)/);assert.match(summary,/readIdentitySources\(context\)/);assert.match(helper,/verifiedHealthIdentities\(sources\)/);assert.match(map,/projectOwnerPlacement\(await projectImportedSourceAddresses\(snapshot,importedSources,audits,devices\),audits,devices,identity,units\)/);assert.match(map,/freshAudits,freshDevices,freshBundle\.identity,freshUnits\)/);
 assert.doesNotMatch(fs.readFileSync(new URL('../../supabase/functions/cos-operations-pages/placementProjection.ts',import.meta.url),'utf8'),/import .*verifiedHealthIdentity/);
});
test('warning with completely missing resources never invents a control row',async()=>{
 const f=await fixture();f.sources.audits=[audit()];f.sources.devices=[];const p=await project(f);assert.deepEqual(p.nativePlacementAliases,[]);assert.equal(p.inventoryItems.some(r=>r.recordSource==='Owner camera placement'),false);assert.ok(p.placementReviews.length);assert.equal(p.items.length,0);assert.equal(p.inventoryItems[0].placement,'UNKNOWN');assert.equal(p.inventoryItems[0].latitude,null);assert.equal(p.inventoryItems[0].locationHistoryId,null);
});
for(const placement of ['FIELD','SHOP'])test('all resources missing after saved '+placement+' quarantines native UUID and current pin but retains history',async()=>{
 const f=await fixture();f.sources.audits=[audit(placement==='SHOP'?{placement,action:'MOVE_TO_ROOT',site_label:null,street_address:null}:{})];f.sources.devices=[];
 const identity=await f.identity(),warning=identity.identityWarnings.find(w=>w.unitId===unitId);assert.ok(warning);assert.deepEqual(warning.deviceIds,[]);assert.deepEqual(warning.unitKeys,[]);
 const before=structuredClone(f.snapshot),p=await project(f);assert.equal(p.items.length,0);assert.equal(p.summary.fieldUnits,0);assert.deepEqual(p.nativePlacementAliases,[]);assert.equal(p.inventoryItems.length,1);
 const current=p.inventoryItems[0];assert.equal(current.id,unitId);assert.equal(current.placement,'UNKNOWN');assert.equal(current.placementStatus,'needs_identity_review');for(const k of ['latitude','longitude','coordinateSource','locationVerifiedAt','locationHistoryId'])assert.equal(current[k],null,k);assert.notEqual(current.locationVerification,'owner_verified');
 for(const k of ['historicalLatitude','historicalLongitude','historicalCoordinateSource','historicalRecordedAt'])assert.equal(current[k],before.inventoryItems[0][k],k);assert.deepEqual(f.snapshot,before);assert.equal(current.recordSource,'Native equipment');
});
for(const placement of ['FIELD','SHOP'])for(const lost of ['native only','native and devices'])test(lost+' lost after saved '+placement+' rejects stale map membership instead of returning a field pin',async()=>{
 const f=await fixture();f.sources.audits=[audit(placement==='SHOP'?{placement,action:'MOVE_TO_ROOT',site_label:null,street_address:null}:{})];f.sources.units=[];if(lost==='native and devices')f.sources.devices=[];
 const before=structuredClone(f.snapshot);await assert.rejects(project(f),error=>error.status===503&&/Native inventory changed/.test(error.message));assert.deepEqual(f.snapshot,before);
});
for(const change of ['duplicate','label mismatch','malformed','unavailable'])test('native membership '+change+' fails closed before applying an alias or exposing old coordinates',async()=>{
 const f=await fixture();f.sources.audits=[audit()];const identity=await f.identity();
 if(change==='duplicate')f.sources.units.push({...f.sources.units[0]});if(change==='label mismatch')f.sources.units[0].unit_number='Different synthetic native label';if(change==='malformed')delete f.sources.units[0].unit_number;
 await assert.rejects(projectOwnerPlacement(f.snapshot,f.sources.audits,f.sources.devices,identity,change==='unavailable'?undefined:f.sources.units),error=>error.status===503&&/Native inventory/.test(error.message));
});
for(const placement of ['FIELD','SHOP'])test('revoked positive native proof with retained commitments prevents saved '+placement+' shadow and native fallback',async()=>{
 const f=await fixture();f.sources.audits=[audit(placement==='SHOP'?{placement,action:'MOVE_TO_ROOT',site_label:null,street_address:null}:{})];f.review.native={};
 const identity=await f.identity();assert.deepEqual(identity.unitIdentities,[]);assert.equal(identity.identityWarnings.length,1);assert.equal(identity.identityWarnings[0].unitId,unitId);assert.deepEqual(identity.identityWarnings[0].deviceIds,['9101']);assert.deepEqual(identity.identityWarnings[0].unitKeys,[key]);
 const p=await project(f);assert.deepEqual(p.nativePlacementAliases,[]);assert.equal(p.items.length,0);assert.equal(p.inventoryItems.length,1);assert.equal(p.inventoryItems[0].id,unitId);assert.equal(p.inventoryItems[0].placement,'UNKNOWN');assert.equal(p.inventoryItems[0].latitude,null);assert.equal(p.inventoryItems[0].locationHistoryId,null);assert.equal(p.inventoryItems[0].historicalLatitude,30);
});
for(const unitLabel of [label,key])test('revoked proof before first audit keeps '+unitLabel+' non-editable without name fallback',async()=>{
 const f=await fixture(unitLabel);f.review.native={};const p=await project(f);assert.deepEqual(p.nativePlacementAliases,[]);assert.equal(p.items.length,0);assert.equal(p.inventoryItems[0].placement,'UNKNOWN');const h=await health(f);assert.throws(()=>resolve(p,h,state()),/identity|review/i);
});
test('revocation retains denial bindings even when the reviewed native row is currently absent',async()=>{
 const f=await fixture();f.review.native={};f.sources.units=[];f.sources.audits=[audit()];f.snapshot.items=[];f.snapshot.inventoryItems=[];
 const identity=await f.identity();assert.deepEqual(identity.unitIdentities,[]);assert.equal(identity.identityWarnings.length,1);assert.match(identity.identityWarnings[0].unitId,/^unavailable:/);assert.deepEqual(identity.identityWarnings[0].deviceIds,['9101']);assert.deepEqual(identity.identityWarnings[0].unitKeys,[key]);
 const p=await project(f);assert.deepEqual(p.items,[]);assert.deepEqual(p.inventoryItems,[]);assert.deepEqual(p.nativePlacementAliases,[]);assert.ok(p.placementReviews.length);
});
test('malformed warning contracts fail closed while valid empty bindings remain allowed',async()=>{
 const f=await fixture(),identity=await f.identity(),warning={unitId,reason:'Synthetic unavailable identity',deviceIds:[],unitKeys:[]};
 for(const patch of [{unitId:'not-a-uuid'}, {reason:null}, {reason:' '}, {deviceIds:[null]}, {deviceIds:['9101','9101']}, {unitKeys:['']}, {unitKeys:[key,key]}]){
  await assert.rejects(projectOwnerPlacement(f.snapshot,[],f.sources.devices,{...identity,identityWarnings:[{...warning,...patch}]},f.sources.units),/malformed/);
 }
 const p=await projectOwnerPlacement(f.snapshot,[],f.sources.devices,{...identity,identityWarnings:[warning]},f.sources.units);assert.equal(p.items.length,0);assert.equal(p.inventoryItems[0].placement,'UNKNOWN');assert.equal(p.inventoryItems[0].latitude,null);
});

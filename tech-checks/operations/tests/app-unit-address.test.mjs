import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppUnitAddress,appAddressLegacyKey} from '../../supabase/functions/cos-operations-pages/appUnitAddress.ts';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
import {projectAppUnitAddresses,projectImportedGeocodes,checkedImportedBinding} from '../../supabase/functions/cos-operations-pages/importedSourceProjection.ts';
import {checkedAddressEstimate,addressEstimateLabel} from '../src/fieldAddressEstimates.ts';
import {addressDigest} from '../../supabase/functions/cos-operations-pages/censusAddress.ts';
const contract='COS_APP_UNIT_ADDRESS_V1',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const id='11111111-1111-4111-8111-111111111111',rev='22222222-2222-4222-8222-222222222222',next='33333333-3333-4333-8333-333333333333',requestId='44444444-4444-4444-8444-444444444444';
const installation={street:'123 Main St',city:'Houston',state:'TX',zip:'77002'};
const proof={contract,legacyUnitKey:null,legacyIdentitySha256:'a'.repeat(64),legacyPlacementSha256:'b'.repeat(64)};
const emptyBundle=()=>({sources:{units:[],devices:[],audits:[]},identity:{identityVersion:1,unitIdentities:[],identityWarnings:[]}});
const native=(overrides={})=>({contract,unitId:id,unitNumber:'Solar Stand 72 901',sourceIdentity:{sourceSystem:'mhelpdesk_product_import',productId:'901'},sourceRevision:rev,revision:null,
 stableIdentitySha256:'c'.repeat(64),placementRevision:'d'.repeat(64),placement:'FIELD',installation:{...installation},siteLabel:'Synthetic site',sourceConflict:false,history:[],editable:true,...overrides});
function fixture(options={}){
 let record=native(options.record),reads=0,proofReads=0;const writes=[];let currentProof={...proof,...options.proof};
 const handler=createAppUnitAddress({capability:async()=>options.enabled!==false,readNative:async()=>{reads++;options.onRead?.(record,reads);return structuredClone(record);},readIdentity:async()=>options.onIdentity?.()||options.bundle||emptyBundle(),
 readProof:async()=>{proofReads++;return options.onProof?.(currentProof,proofReads)??structuredClone(currentProof);},save:async args=>{
  writes.push(args);record={...record,revision:next,placement:args.p_placement,installation:args.p_installation,siteLabel:args.p_site_label,placementRevision:'e'.repeat(64),addressAuthority:{...currentProof,revision:next}};
  if(options.afterSave)currentProof={...currentProof,...options.afterSave};return {changed:true,record:structuredClone(record)};
 }});
 return {handler,writes,get reads(){return reads;},setRecord:value=>{record={...record,...value};}};
}
const payload=(record,overrides={})=>({requestId,expectedSourceRevision:record.sourceRevision,expectedRevision:record.revision,expectedPlacementRevision:record.placementRevision,
 placement:record.placement,installation:record.installation,siteLabel:record.siteLabel,confirmed:true,...overrides});

test('stand with zero cameras supports partial address repair with actual change and fresh proof',async()=>{
 const f=fixture({record:{installation:{...installation,street:null}}});const read=await f.handler('GET',id,null);
 assert.equal(read.installation.street,null);assert.equal('stableIdentitySha256' in read,false);assert.equal('addressAuthority' in read,false);
 const result=await f.handler('POST',id,payload(read,{installation}));assert.equal(result.changed,true);assert.equal(f.writes.length,1);
 assert.equal(f.writes[0].p_expected_source_revision,rev);assert.deepEqual(f.writes[0].p_placement_proof,proof);
 assert.deepEqual(f.writes[0].p_effective_before.installation,{...installation,street:null});assert.deepEqual(result.record.installation,installation);
});
test('unmapped Shop to Field becomes a current address without a camera or fabricated native identity',async()=>{
 const f=fixture({record:{placement:'SHOP',installation:null,siteLabel:null}}),read=await f.handler('GET',id,null);
 const result=await f.handler('POST',id,payload(read,{placement:'FIELD',installation,siteLabel:'New site'}));
 assert.equal(result.record.placement,'FIELD');assert.equal(f.writes[0].p_native_unit_id,id);assert.equal('actorUserId' in f.writes[0],false);
});
test('GET, unchanged submit and canceled draft produce zero storage writes',async()=>{
 const f=fixture(),read=await f.handler('GET',id,null);const cancelDraft={...payload(read),installation:{...installation,street:'99 Changed St'}};void cancelDraft;
 const result=await f.handler('POST',id,payload(read));assert.equal(result.changed,false);assert.equal(f.writes.length,0);
});
for(const [name,body] of [['unconfirmed',{confirmed:false}],['blank',{installation:{street:'',city:null,state:'TX',zip:null}}],['untrusted actor',{actorUserId:id}],['GPS write',{latitude:1}],['bad source revision',{expectedSourceRevision:next}],['bad placement revision',{expectedPlacementRevision:'f'.repeat(64)}]])
 test(name+' cannot submit a native address write',async()=>{const f=fixture(),read=await f.handler('GET',id,null);await assert.rejects(f.handler('POST',id,payload(read,{installation:{...installation,street:'987 Main St'},...body})));assert.equal(f.writes.length,0);});
test('default-off capability denies before reading or writing address state',async()=>{const f=fixture({enabled:false});await assert.rejects(f.handler('GET',id,null),/not enabled/);assert.equal(f.reads,0);assert.equal(f.writes.length,0);});
test('a source change while loading invalidates the whole editable read',async()=>{const f=fixture({onRead:(record,n)=>{if(n===2)record.sourceRevision=next;}});await assert.rejects(f.handler('GET',id,null),/changed while loading/);assert.equal(f.writes.length,0);});
test('concurrent Owner proof change before save does not write',async()=>{
 const f=fixture(),read=await f.handler('GET',id,null);f.setRecord({placementRevision:'f'.repeat(64)});
 await assert.rejects(f.handler('POST',id,payload(read,{installation:{...installation,street:'987 Main St'}})),/changed/);assert.equal(f.writes.length,0);
});
test('a cross-project manual race after commit reports held outcome rather than fake atomic success',async()=>{
 const f=fixture({afterSave:{legacyPlacementSha256:'f'.repeat(64)}}),read=await f.handler('GET',id,null);
 await assert.rejects(f.handler('POST',id,payload(read,{installation:{...installation,street:'987 Main St'}})),/saved, but another placement/);assert.equal(f.writes.length,1);
});
test('full family and native identity commitments reject same-number links',()=>{
 const unit=native({unitNumber:'Sniper 2 901'}),bundle=emptyBundle();bundle.sources.devices=[{id:1,unit_key:'Sniper 901'}];assert.throws(()=>appAddressLegacyKey(unit,bundle),/family/);
 bundle.sources.devices=[{id:1,unit_key:'Sniper 2 901'}];assert.equal(appAddressLegacyKey(unit,bundle),'Sniper 2 901');
 bundle.identity.unitIdentities=[{unitId:next,unitKeys:['Sniper 2 901'],deviceIds:['1']}];assert.throws(()=>appAddressLegacyKey(unit,bundle),/association/);
});
test('existing Owner address prefills accurately and restoring the imported address creates truthful app authority',async()=>{
 const bundle=emptyBundle();bundle.sources.devices=[{id:1,unit_key:'Sniper 901'}];bundle.sources.audits=[{id:'7',unit_key:'Sniper 901',device_ids:[1],action:'MOVE_TO_FIELD',contract:'COS_CAMERA_PLACEMENT_V2',placement:'FIELD',request_id:id,control_id:next,site_label:'Owner site',street_address:'777 Owner St, Houston, TX 77002',created_at:'2026-10-08T00:00:00Z'}];
 bundle.identity.unitIdentities=[{kind:'owner_placement',unitId:next,unitNumber:'Sniper 901',unitKeys:['Sniper 901'],deviceIds:['1'],placementAuditId:'7',proof:'d'.repeat(64)}];
 const f=fixture({record:{unitNumber:'Sniper 901'},proof:{legacyUnitKey:'Sniper 901'},bundle});const read=await f.handler('GET',id,null);
 assert.equal(read.installation.street,'777 Owner St');const result=await f.handler('POST',id,payload(read,{installation,siteLabel:'Synthetic site'}));
 assert.equal(result.changed,true);assert.equal(result.record.installation.street,'123 Main St');assert.equal(f.writes[0].p_effective_before.installation.street,'777 Owner St');
});
test('later source refresh marks conflict but preserves authorized app correction and actor history',async()=>{
 const saved=native({revision:next,sourceRevision:requestId,sourceConflict:true,addressAuthority:{...proof,revision:next},installation:{...installation,street:'456 App St'},history:[{revision:next,actorUserId:id,actorRole:'it',savedAt:'2026-10-08T00:00:00Z',placement:'FIELD',installation:{...installation,street:'456 App St'}}]});
 const f=fixture({record:saved});const read=await f.handler('GET',id,null);assert.equal(read.sourceConflict,true);assert.equal(read.installation.street,'456 App St');assert.equal(read.history[0].actorRole,'it');assert.equal(f.writes.length,0);
});
test('editor derives current Owner address between proofs rather than from an earlier discovery snapshot',async()=>{
 const old=emptyBundle();old.sources.devices=[{id:1,unit_key:'Sniper 901'}];old.sources.audits=[{id:'7',unit_key:'Sniper 901',device_ids:[1],action:'MOVE_TO_FIELD',contract:'COS_CAMERA_PLACEMENT_V2',placement:'FIELD',request_id:id,control_id:next,site_label:'Owner site',street_address:'777 Earlier St, Houston, TX 77002',created_at:'2026-10-08T00:00:00Z'}];
 const current=structuredClone(old);current.sources.audits[0]={...current.sources.audits[0],id:'8',street_address:'888 Current St, Houston, TX 77002'};
 let reads=0;const f=fixture({record:{unitNumber:'Sniper 901'},proof:{legacyUnitKey:'Sniper 901'},onIdentity:()=>++reads===1?old:current});
 const read=await f.handler('GET',id,null);assert.equal(read.installation.street,'888 Current St');
 await f.handler('POST',id,payload(read,{siteLabel:'Changed site label'}));assert.equal(f.writes[0].p_effective_before.installation.street,'888 Current St');assert.equal(f.writes[0].p_installation.street,'888 Current St');
});

async function projectionFixture(overrides={}){
 const source={schemaVersion:1,organizationId:org,sourceSystem:'mhelpdesk_product_import',entityKind:'tracker',nativeUnitId:id,productId:'901',unitNumber:'Solar Stand 72 901',family:'SOLAR STAND 72',variant:null,
  sourceRevision:next,sourceFileSha256:'a'.repeat(64),sourceRowSha256:'b'.repeat(64),nativeGuardSha256:'c'.repeat(64),addressSha256:await addressDigest('123 Main St, Houston, TX 77002'),
  installation,suppliedComponents:{street:true,city:true,state:true,zip:true},eligibility:'FIELD',eventId:'2',placement:'FIELD',siteLabel:'Synthetic site',addressAuthority:{...proof,revision:next},...overrides};
 const row={id,unitNumber:source.unitNumber,readOnly:true,modelName:'SOLAR STAND 72',status:'field',currentLocationType:'field',address:'998 Old St, Houston, TX 77002',latitude:1,longitude:2,coordinateSource:'us_census_address_range_estimate',hasUnitGps:false};
 const snapshot={items:[row],inventoryItems:[row],summary:{fieldUnits:1}},bundle=emptyBundle(),context={nativeUnits:bundle.sources.units,identity:bundle.identity,currentSources:[source],confirmedAppAddressBindings:[source]};
 return {source,row,snapshot,context};
}
test('changed address holds old point; only exact app-authority provider binding yields new unverified estimate',async()=>{
 const {source,snapshot,context}=await projectionFixture();let result=await projectAppUnitAddresses(snapshot,[source],[],[],context);
 const row=result.items[0];assert.equal(row.latitude,null);assert.equal(row.longitude,null);assert.equal(row.address,'123 Main St, Houston, TX 77002');assert.match(row.addressSource,/COS app Owner \/ IT/);
 const binding=await checkedImportedBinding(source),record={binding,jobKind:'native_import',legacyGuardSha256:'d'.repeat(64),status:'success',verified:false,liveGps:false,
 provider:'us_census_address_range',benchmark:'Public_AR_Current',latitude:29.76,longitude:-95.36,matchedAddress:'123 MAIN ST, HOUSTON, TX 77002',geocodedAt:'2026-10-08T00:00:00Z'};
 result=await projectImportedGeocodes(result,[record],[],[],context);const estimate=await checkedAddressEstimate(result.items[0]);assert.equal(addressEstimateLabel(estimate),'U.S. Census address-range estimate');assert.equal(result.items[0].latitude,null);
 const stale=structuredClone(record);delete stale.binding.addressAuthority;assert.equal((await projectImportedGeocodes(result,[stale],[],[],context)).items[0].locationImportedGeocode,undefined);
});
test('Shop and Inactive app decisions stay inventory-only and never retain former field coordinates',async()=>{
 for(const placement of ['SHOP','INACTIVE']){const {source,snapshot,context}=await projectionFixture({placement,installation:null,addressSha256:null,suppliedComponents:null,eligibility:'tombstone'});
  const result=await projectAppUnitAddresses(snapshot,[source],[],[],context);assert.equal(result.items.length,0);assert.equal(result.inventoryItems[0].currentLocationType,placement.toLowerCase());assert.equal(result.inventoryItems[0].latitude,null);}
});
test('future manual proof change keeps manual placement priority and holds an unmatched old app point',async()=>{
 const {source,row,snapshot,context}=await projectionFixture();context.confirmedAppAddressBindings=[];
 const held=await projectAppUnitAddresses(snapshot,[source],[],[],context);assert.equal(held.items.length,0);assert.equal(held.inventoryItems[0].placementStatus,'needs_identity_review');
 const manual={...row,placementSource:'owner',placement:'FIELD',placementAuditId:'901',address:'444 Owner St, Houston, TX 77002',latitude:null,longitude:null};
 const current=await projectAppUnitAddresses({items:[manual],inventoryItems:[manual],summary:{}},[source],[],[],{...context,stableAppManualIds:[id]});assert.equal(current.items[0].address,manual.address);
 const raced=await projectAppUnitAddresses({items:[manual],inventoryItems:[manual],summary:{}},[source],[],[],context);assert.equal(raced.items.length,0);
});
test('current manual GPS is preserved byte-for-byte while app address cannot grant IT GPS rights',async()=>{
 const {source,row,context}=await projectionFixture();const manual={...row,hasUnitGps:true,locationVerification:'owner_verified',coordinateSource:'phone_gps'};
 const result=await projectAppUnitAddresses({items:[manual],inventoryItems:[manual],summary:{}},[source],[],[],context);assert.deepEqual(result.items[0],manual);
});

const actors=[['Owner','e4abc521-1ef3-45a6-9829-b87faff78210','3f073784-96e7-43d8-b9e0-33ab31c3c8b1','Owner','owner','owner',200],
 ['IT','4f7044b5-86b6-411f-8898-39bb64b4ddbc','d0757b64-9623-4adc-afff-21cc7853e88a','Teddy Hopper','it','it_technician',200],
 ['Service','78e54fbd-c2db-4d18-8e3d-a9740adcf285','7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8','Abel Cervantes','service','service_technician',403]];
for(const [name,legacyId,actorId,displayName,department,role,status] of actors)test(name+' address route uses actual existing authenticated actor and native role',async()=>{
 const calls=[];const handler=createOperationsHandler({platformUrl:'https://native.test',serviceKey:'synthetic-service-only',fetch:async(url,init={})=>{
  const body=init.body?JSON.parse(init.body):null;calls.push({url,body});let response;
  if(url.includes('/auth/v1/user'))response={id:legacyId};
  else if(url.includes('/rest/v1/profiles?'))response=[{user_id:legacyId,full_name:displayName,role:department,active:true,archived_at:null}];
  else if(url.includes('/rest/v1/user_profiles?'))response=[{user_id:actorId,display_name:displayName,department,active:true}];
  else if(url.includes('/rest/v1/user_roles?'))response=[{roles:{code:role,organization_id:org}}];
  else if(url.endsWith('/cos_app_unit_address_capability'))response={contract,enabled:true,readiness:{native:true,bridge:true,worker:true,queue:true,readers:true,legacyProof:true}};
  else if(url.endsWith('/cos_app_unit_address_legacy_capability'))response={contract,proof:true,queue:true};
  else if(url.endsWith('/cos_app_unit_address_read')){assert.equal(body.p_actor_user_id,actorId);response=native();}
  else if(url.endsWith('/cos_app_unit_address_legacy_proof')){assert.equal(init.headers.Authorization,'Bearer synthetic-current-session');response=proof;}
  else if(url.endsWith('/cos_owner_identity_snapshot'))response={revision:'a'.repeat(64),nativeEpochs:[],claims:[]};
  else if(url.endsWith('/cos_fleet_placement_evidence_v1')||url.includes('camera_devices?')||url.includes('equipment_units?')||url.includes('vision_vigilant_'))response=[];
  else throw Error('Unexpected test request '+url);
  return new Response(JSON.stringify(response),{status:200});
 }});
 const request=new Request('https://native.test/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer synthetic-current-session','Content-Type':'application/json'},body:JSON.stringify({method:'GET',path:`/api/field-map/${id}/address`})});
 const response=await handler(request);assert.equal(response.status,status,JSON.stringify(await response.json()));
 if(status===403)assert.equal(calls.some(c=>c.url.includes('cos_app_unit_address')),false);
 assert.equal(calls.some(c=>c.url.endsWith('/cos_app_unit_address_save')),false);
});

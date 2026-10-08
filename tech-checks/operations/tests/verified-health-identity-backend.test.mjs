import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {identityDigest,nativeIdentityKey,nativeIdentityTuple,ownerIdentityKey,ownerIdentityTuple,ownerPhysicalIdentityTuple,healthResourceKey,healthSourceUnitKey,verifiedHealthIdentities} from '../../supabase/functions/cos-operations-pages/verifiedHealthIdentity.ts';
import {REVIEWED_NATIVE_IDENTITIES,REVIEWED_OWNER_IDENTITIES,REVIEWED_NATIVE_RESOURCES,REVIEWED_OWNER_RESOURCES,REVIEWED_OWNER_PHYSICAL_IDENTITIES} from '../../supabase/functions/cos-operations-pages/verifiedHealthIdentityScope.ts';
import {cameraSummary as legacySummary,serviceEvidence,serviceState,CAMERA_FRESH_MS} from '../../supabase/functions/cos-operations-pages/cameraEvidence.ts';
import {cameraSummary as placementSummary,CAMERA_FRESH_MS as placementFreshness} from '../../supabase/functions/cos-operations-pages/cameraPlacementEvidence.ts';
import {projectCameraOwnerPlacement} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';
const org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const uuid=(prefix,n)=>`${prefix}000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const now=Date.parse('2026-10-08T04:13:00Z'),observedAt='2026-10-08T04:03:18.933Z';
const clone=value=>structuredClone(value);
const resourceReview=async(ids,keys)=>({deviceIds:await Promise.all(ids.map(id=>healthResourceKey(String(id)))),unitKeys:await Promise.all(keys.map(healthSourceUnitKey))});
async function fixture(count=1){
 const sources={units:[],matches:[],providers:[],devices:[],audits:[]},review={native:{},owner:new Set(),nativeResources:{},ownerResources:{},ownerPhysical:{}};let deviceId=0;
 for(let i=0;i<count;i++){
  const unit={id:uuid('aa',i+1),unit_number:(i<12?'Solar Spotter ':'Spotter ')+String(i+1).padStart(3,'0')+'HDC4',organization_id:org},associations=[];
  sources.units.push(unit);
  for(let j=0;j<(i<15?4:1);j++){
   const n=++deviceId,external=`synthetic-external-${n}`,provider={id:uuid('bb',n),organization_id:org,external_device_id:external,device_name:`Synthetic provider ${i+1} / ${j+1}`,device_type:i<15?'IPC':'NVR',source:'vigilant_control_center'};
   const match={id:uuid('cc',n),organization_id:org,equipment_unit_id:unit.id,vigilant_device_id:provider.id,camera_key:`cam${j+1}`,match_method:'normalized_device_name',confidence:'exact'};
   const device={id:n,external_device_id:external,device_serial:external,device_name:provider.device_name,device_type:provider.device_type,unit_key:`SOURCE ${i+1}`,organization:'Synthetic site',source:provider.source,activation_state:'active',source_status:'online',source_last_seen_at:observedAt};
   sources.matches.push(match);sources.providers.push(provider);sources.devices.push(device);associations.push({match,provider,device});
  }
  review.native[await nativeIdentityKey(unit.id)]=await identityDigest(nativeIdentityTuple(unit,associations));
  review.nativeResources[await nativeIdentityKey(unit.id)]=await resourceReview(associations.map(row=>row.device.id),[...new Set(associations.map(row=>row.device.unit_key))]);
 }
 return {sources,review};
}
async function ownerFixture(){
 const {sources,review}=await fixture(1);
 const control=uuid('dd',1),key='SOLARSPOTTER SYNTHETIC';
 const audit={id:'46',action:'MOVE_TO_FIELD',unit_key:key,device_ids:['9001','9002','9003','9004'],created_at:'2026-10-08T04:02:14.651887Z',contract:'COS_CAMERA_PLACEMENT_V2',placement:'FIELD',site_label:'Synthetic owner site',street_address:'123 Fixture Street',request_id:control,control_id:control};
 for(const id of audit.device_ids)sources.devices.push({id,unit_key:key,external_device_id:`synthetic-owner-external-${id}`,device_serial:`synthetic-owner-serial-${id}`,device_name:`Synthetic owner ${id}`,device_type:'IPC',source:'vigilant_control_center',activation_state:'active',organization:'ROOT',source_status:'online',source_last_seen_at:observedAt});
 sources.audits.push(audit);review.owner.add(await identityDigest(ownerIdentityTuple(audit)));
 review.ownerResources[await ownerIdentityKey(control)]=await resourceReview(audit.device_ids,[audit.unit_key]);
 review.ownerPhysical[await ownerIdentityKey(control)]=await identityDigest(ownerPhysicalIdentityTuple(audit,sources.devices.filter(device=>audit.device_ids.includes(String(device.id)))));
 // A similar native display label without durable links is deliberately unresolved.
 sources.units.push({id:uuid('ee',11),unit_number:'Solar Spotter SYNTHETICHDC4',organization_id:org});
 return {sources,review,control,audit};
}
const project=({sources,review})=>verifiedHealthIdentities(sources,review);
test('review scope contains exactly 65 opaque native commitments and one Owner commitment',()=>{
 assert.equal(Object.keys(REVIEWED_NATIVE_IDENTITIES).length,65);assert.equal(REVIEWED_OWNER_IDENTITIES.size,1);
 assert.deepEqual(Object.keys(REVIEWED_NATIVE_RESOURCES).sort(),Object.keys(REVIEWED_NATIVE_IDENTITIES).sort());
 assert.equal(Object.values(REVIEWED_NATIVE_RESOURCES).flatMap(row=>row.deviceIds).length,110);
 assert.equal(Object.keys(REVIEWED_OWNER_RESOURCES).length,1);assert.equal(Object.values(REVIEWED_OWNER_RESOURCES)[0].deviceIds.length,4);
 assert.deepEqual(Object.keys(REVIEWED_OWNER_PHYSICAL_IDENTITIES),Object.keys(REVIEWED_OWNER_RESOURCES));
 for(const digest of Object.values(REVIEWED_OWNER_PHYSICAL_IDENTITIES))assert.match(digest,/^[a-f0-9]{64}$/);
 for(const [key,value] of Object.entries(REVIEWED_NATIVE_IDENTITIES))for(const digest of [key,value])assert.match(digest,/^[a-f0-9]{64}$/);
 for(const [key,value] of Object.entries({...REVIEWED_NATIVE_RESOURCES,...REVIEWED_OWNER_RESOURCES}))for(const digest of [key,...value.deviceIds,...value.unitKeys])assert.match(digest,/^[a-f0-9]{64}$/);
 const source=readFileSync(new URL('../../supabase/functions/cos-operations-pages/verifiedHealthIdentityScope.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/external_device_id|device_serial|HDC[24]|Solar Spotter|Spotter \d/);
});
test('65 actual-shaped complete groups prove 110 unique resources without exposing serials',async()=>{
 const f=await fixture(65),result=await project(f);assert.equal(result.identityVersion,1);assert.equal(result.unitIdentities.length,65);assert.deepEqual(result.identityWarnings,[]);
 const ids=result.unitIdentities.flatMap(row=>row.deviceIds);assert.equal(ids.length,110);assert.equal(new Set(ids).size,110);
 assert.doesNotMatch(JSON.stringify(result),/synthetic-external|device_serial|external_device_id|match_method|device_name/);
 for(const identity of result.unitIdentities){assert.equal(identity.kind,'native_provider');assert.match(identity.proof,/^[a-f0-9]{64}$/);assert.equal(identity.deviceIds.length,identity.unitNumber.startsWith('Solar')?4:identity.deviceIds.length);}
 for(const key of ['units','matches','providers','devices'])f.sources[key].reverse();assert.deepEqual(await project(f),result);
});
test('only pre-reviewed complete mapping tuples are accepted, with no alias/name/IP inference',async()=>{
 const f=await fixture();assert.equal((await verifiedHealthIdentities(f.sources)).unitIdentities.length,0);
 f.sources.units[0].unit_number='Solar Spotter 001';assert.equal((await project(f)).unitIdentities.length,0);
});
test('partial, extra, duplicate and reassigned identity evidence all fail closed',async()=>{
 const changes={
  'missing mapping':s=>s.matches.pop(),
  'missing provider':s=>s.providers.pop(),
  'missing legacy resource':s=>s.devices.pop(),
  'extra group resource':s=>s.devices.push({...s.devices[0],id:99,external_device_id:'extra',device_serial:'extra'}),
  'duplicate legacy ID':s=>s.devices.push({...s.devices[0]}),
  'duplicate serial':s=>s.devices.push({...s.devices[0],id:99,unit_key:'ANOTHER',external_device_id:'different'}),
  'duplicate external ID':s=>s.devices.push({...s.devices[0],id:99,unit_key:'ANOTHER',device_serial:'different'}),
  'duplicate provider external ID':s=>s.providers.push({...s.providers[0],id:uuid('bb',999)}),
  'duplicate provider ID':s=>s.providers.push({...s.providers[0]}),
  'duplicate match':s=>s.matches.push({...s.matches[0]}),
  'cross-native ownership':s=>s.matches.push({...s.matches[0],id:uuid('cc',999),equipment_unit_id:uuid('aa',999)}),
  'reassigned native':s=>s.matches[0].equipment_unit_id=uuid('aa',999),
  'changed native organization':s=>s.units[0].organization_id=uuid('ff',1),
  'changed provider organization':s=>s.providers[0].organization_id=uuid('ff',1),
  'changed match organization':s=>s.matches[0].organization_id=uuid('ff',1),
  'changed provider source':s=>s.providers[0].source='reconeyez',
  'changed provider resource kind':s=>s.providers[0].device_type='NVR',
  'changed camera key':s=>s.matches[0].camera_key='cam99',
  'changed source unit ownership':s=>s.devices[0].unit_key='ANOTHER',
  'changed complete serial association':s=>{s.providers[0].external_device_id='different';s.devices[0].external_device_id='different';s.devices[0].device_serial='different';},
 };
 for(const [name,change] of Object.entries(changes)){const f=await fixture();change(f.sources);const result=await project(f);assert.equal(result.unitIdentities.length,0,name);assert.ok(result.identityWarnings.length,name);assert.doesNotMatch(JSON.stringify(result),/synthetic-external/);}
});
test('missing and partial mappings warn the previously reviewed resources, even without any current link',async()=>{
 for(const keep of [0,1,3]){
  const f=await fixture();f.sources.matches=f.sources.matches.slice(0,keep);
  const result=await project(f);assert.deepEqual(result.unitIdentities,[]);assert.equal(result.identityWarnings.length,1);
  assert.deepEqual(result.identityWarnings[0].deviceIds,['1','2','3','4']);assert.deepEqual(result.identityWarnings[0].unitKeys,['SOURCE 1']);
  assert.equal(result.identityWarnings[0].unitId,f.sources.units[0].id);
 }
});
test('a missing approved native equipment row still quarantines its surviving source without inventing a UUID',async()=>{
 const f=await fixture(),reviewKey=await nativeIdentityKey(f.sources.units[0].id);f.sources.units=[];
 const result=await project(f);assert.deepEqual(result.unitIdentities,[]);
 assert.equal(result.identityWarnings.length,1);assert.equal(result.identityWarnings[0].unitId,'unavailable:'+reviewKey);
 assert.deepEqual(result.identityWarnings[0].deviceIds,['1','2','3','4']);assert.deepEqual(result.identityWarnings[0].unitKeys,['SOURCE 1']);
 assert.equal(f.sources.providers.length,4);assert.equal(f.sources.matches.length,4);
 f.sources.devices=[];assert.deepEqual((await project(f)).identityWarnings,[]);
});
test('source-group warnings cover partial, new and replacement inventory without claiming extra IDs',async()=>{
 for(const keep of [0,1,3,4]){
  const f=await fixture(),extra={...f.sources.devices[0],id:99,external_device_id:'unreviewed-external',device_serial:'unreviewed-serial'};
  f.sources.devices=f.sources.devices.slice(0,keep);f.sources.devices.push(extra);
  const result=await project(f),warning=result.identityWarnings[0];assert.deepEqual(result.unitIdentities,[]);
  assert.deepEqual(warning.deviceIds,['1','2','3','4'].slice(0,keep));assert.deepEqual(warning.unitKeys,['SOURCE 1']);
  assert.doesNotMatch(JSON.stringify(warning),/99|unreviewed-external|unreviewed-serial/);
 }
 const empty=await fixture();empty.sources.devices=[];
 assert.deepEqual((await project(empty)).identityWarnings.map(({deviceIds,unitKeys})=>({deviceIds,unitKeys})),[{deviceIds:[],unitKeys:[]}]);
});
test('cross-assigned mappings never leak the newly associated unit resources into warnings',async()=>{
 const f=await fixture(2),[first,second]=f.sources.units;
 for(const match of f.sources.matches)match.equipment_unit_id=match.equipment_unit_id===first.id?second.id:first.id;
 const result=await project(f);assert.deepEqual(result.unitIdentities,[]);assert.equal(result.identityWarnings.length,2);
 assert.deepEqual(result.identityWarnings.find(row=>row.unitId===first.id).deviceIds,['1','2','3','4']);
 assert.deepEqual(result.identityWarnings.find(row=>row.unitId===first.id).unitKeys,['SOURCE 1']);
 assert.deepEqual(result.identityWarnings.find(row=>row.unitId===second.id).deviceIds,['5','6','7','8']);
 assert.deepEqual(result.identityWarnings.find(row=>row.unitId===second.id).unitKeys,['SOURCE 2']);
 const renamed=await fixture();for(const device of renamed.sources.devices)device.unit_key='UNREVIEWED FOREIGN UNIT';
 const warning=(await project(renamed)).identityWarnings[0];assert.deepEqual(warning.deviceIds,['1','2','3','4']);assert.deepEqual(warning.unitKeys,[]);
 assert.doesNotMatch(JSON.stringify(warning),/UNREVIEWED FOREIGN UNIT|synthetic-external|device_serial|external_device_id|match_method|device_name/);
 assert.deepEqual(Object.keys(warning).sort(),['deviceIds','reason','unitId','unitKeys']);
});
test('Owner control and latest reviewed audit bind four cameras despite generic model; unlinked native remains unresolved',async()=>{
 const f=await ownerFixture(),result=await project(f),owner=result.unitIdentities.find(row=>row.kind==='owner_placement');
 assert.deepEqual(owner.deviceIds,['9001','9002','9003','9004']);assert.equal(owner.unitId,f.control);assert.equal(owner.placementAuditId,'46');assert.equal(owner.unitNumber,f.audit.unit_key);
 assert.equal(result.unitIdentities.some(row=>row.unitId===uuid('ee',11)),false);
 const summary=placementSummary(projectCameraOwnerPlacement(f.sources.devices,f.sources.audits),[],now);
 assert.equal(summary.rows.filter(row=>owner.deviceIds.includes(String(row.id))).length,4);assert.ok(summary.rows.filter(row=>owner.deviceIds.includes(String(row.id))).every(row=>row.scope==='field'&&row.evidence.status==='online'));
});
test('changed Owner membership and newer conflicting/unreviewed history cannot reuse the old proof',async()=>{
 for(const change of [
  f=>f.sources.devices.pop(),
  f=>f.sources.devices.push({...f.sources.devices.at(-1),id:'9005'}),
  f=>f.sources.devices.push({...f.sources.devices.at(-1)}),
  f=>f.sources.devices.at(-1).unit_key='OTHER',
  f=>f.sources.audits.push({...f.audit,id:'47',contract:null}),
  f=>f.sources.audits.push({...f.audit,id:'47',created_at:'2026-10-08T04:04:00Z'}),
  f=>f.sources.units.push({id:f.control,unit_number:f.audit.unit_key,organization_id:org}),
 ]){const f=await ownerFixture();change(f);assert.equal((await project(f)).unitIdentities.filter(row=>row.kind==='owner_placement').length,0);}
});
test('the same Owner database IDs cannot admit changed physical provider, kind, serial or external identities',async()=>{
 const changes={
  'provider source':f=>f.sources.devices.at(-1).source='reconeyez',
  'resource kind':f=>f.sources.devices.at(-1).device_type='NVR',
  'serial':f=>f.sources.devices.at(-1).device_serial='unreviewed-serial',
  'external identity':f=>f.sources.devices.at(-1).external_device_id='unreviewed-external',
  'serial and external identity':f=>{f.sources.devices.at(-1).device_serial='unreviewed-both';f.sources.devices.at(-1).external_device_id='unreviewed-both';},
  'missing serial':f=>delete f.sources.devices.at(-1).device_serial,
  'missing external identity':f=>delete f.sources.devices.at(-1).external_device_id,
  'duplicate serial within group':f=>f.sources.devices.at(-1).device_serial=f.sources.devices.at(-2).device_serial,
  'duplicate external identity within group':f=>f.sources.devices.at(-1).external_device_id=f.sources.devices.at(-2).external_device_id,
  'duplicate serial outside group':f=>f.sources.devices.push({...f.sources.devices.at(-1),id:'9998',unit_key:'FOREIGN GROUP',external_device_id:'unreviewed-external'}),
  'duplicate external identity outside group':f=>f.sources.devices.push({...f.sources.devices.at(-1),id:'9999',unit_key:'FOREIGN GROUP',device_serial:'unreviewed-serial'}),
  'missing physical review':f=>f.review.ownerPhysical={},
 };
 for(const [name,change] of Object.entries(changes)){
  const f=await ownerFixture();change(f);const result=await project(f),warning=result.identityWarnings.find(row=>row.unitId===f.control);
  assert.equal(result.unitIdentities.some(row=>row.kind==='owner_placement'),false,name);assert.ok(warning,name);
  assert.deepEqual(warning.deviceIds,f.audit.device_ids,name);assert.deepEqual(warning.unitKeys,[f.audit.unit_key],name);
  assert.doesNotMatch(JSON.stringify(warning),/synthetic-owner-|unreviewed-|FOREIGN GROUP|9998|9999/);
 }
 const f=await ownerFixture(),expected=await project(f);f.sources.devices.reverse();assert.deepEqual(await project(f),expected);
});
test('Owner membership and newer audit warnings remain pinned to the previously reviewed source',async()=>{
 for(const change of [
  f=>f.sources.devices.pop(),
  f=>f.sources.devices.push({...f.sources.devices.at(-1),id:'9005'}),
  f=>f.sources.audits.push({...f.audit,id:'47',contract:null}),
  f=>f.sources.audits.push({...f.audit,id:'47',created_at:'2026-10-08T04:04:00Z'}),
  f=>f.sources.audits.push({...f.audit,id:'47',control_id:uuid('ff',9),created_at:'2026-10-08T04:04:00Z'}),
 ]){
  const f=await ownerFixture();change(f);const result=await project(f),warning=result.identityWarnings.find(row=>row.unitId===f.control);
  assert.equal(result.unitIdentities.some(row=>row.kind==='owner_placement'),false);assert.ok(warning);
  assert.deepEqual(warning.deviceIds,f.audit.device_ids.filter(id=>f.sources.devices.some(device=>String(device.id)===id)));
  assert.deepEqual(warning.unitKeys,[f.audit.unit_key]);assert.doesNotMatch(JSON.stringify(warning),/9005|Synthetic owner site|Fixture Street/);
 }
});
test('fully absent Owner audit history still quarantines its reviewed source without inventing a control UUID',async()=>{
 const f=await ownerFixture(),reviewKey=await ownerIdentityKey(f.control);f.sources.audits=[];
 const result=await project(f);assert.equal(result.unitIdentities.filter(row=>row.kind==='owner_placement').length,0);
 assert.equal(result.identityWarnings.length,1);const warning=result.identityWarnings[0];
 assert.equal(warning.unitId,'unavailable:'+reviewKey);assert.deepEqual(warning.deviceIds,f.audit.device_ids);assert.deepEqual(warning.unitKeys,[f.audit.unit_key]);
 assert.equal(f.sources.devices.filter(row=>f.audit.device_ids.includes(String(row.id))).length,4);
 f.sources.devices=f.sources.devices.filter(row=>!f.audit.device_ids.includes(String(row.id)));
 assert.deepEqual((await project(f)).identityWarnings,[]);
});
test('Owner control reuse for an unrelated newer group revokes the old identity without warning foreign IDs or keys',async()=>{
 const f=await ownerFixture(),foreignKey='UNREVIEWED OWNER SOURCE',foreignIds=['9991','9992'];
 for(const id of foreignIds)f.sources.devices.push({id,unit_key:foreignKey});
 f.sources.audits.push({...f.audit,id:'47',unit_key:foreignKey,device_ids:foreignIds,created_at:'2026-10-08T04:04:00Z'});
 const result=await project(f),warning=result.identityWarnings.find(row=>row.unitId===f.control);
 assert.equal(result.unitIdentities.some(row=>row.unitId===f.control),false);assert.ok(warning);
 assert.deepEqual(warning.deviceIds,f.audit.device_ids);assert.deepEqual(warning.unitKeys,[f.audit.unit_key]);
 assert.doesNotMatch(JSON.stringify(warning),/9991|9992|UNREVIEWED OWNER SOURCE/);
});
const endpoint=()=>({id:1,unit_key:'CAMV SYNTHETIC',device_name:'Synthetic service',device_type:'CAMV',source:'2026_unit_tracker',activation_state:'active',organization:'Fixture',public_ip:'8.8.4.4',expected_ports:[80,443],connection_revision:0});
const boundHealth=()=>({camera_device_id:1,overall_status:'online',checked_at:observedAt,ip_reachable:true,port_status:{80:{online:true},443:{online:false},_connection:{ip:'8.8.4.4',revision:'0',checkedAt:observedAt,status:'online',reachable:true,confirmedOutage:false,consecutiveFailures:0}}});
test('v3 reuses the IP/revision/actual-port-bound projector and never borrows provider time',()=>{
 const d=endpoint(),h=boundHealth();assert.equal(serviceEvidence(d,h,false,now).status,'online');
 const rows=placementSummary([d],[h],now).rows;assert.equal(serviceState(rows[0],now),'online');assert.deepEqual(rows[0].connection,{publicIp:'8.8.4.4',ports:[80,443]});
 for(const change of [
  (d,h)=>d.public_ip='8.8.8.8', (d,h)=>d.connection_revision=1,(d,h)=>d.connection_revision=null,
  (d,h)=>d.expected_ports=[80,443,8443],(d,h)=>delete h.port_status[80],(d,h)=>h.port_status[80].attempted=false,
  (d,h)=>h.port_status[80].online='true',(d,h)=>delete h.port_status._connection,
  (d,h)=>h.port_status._connection.checkedAt='invalid',(d,h)=>h.port_status._connection.checkedAt='2030-01-01T00:00:00Z',
  (d,h)=>h.port_status._connection.checkedAt='2026-02-30T00:00:00Z',
 ]){const device=endpoint(),health=boundHealth();change(device,health);const evidence=serviceEvidence(device,health,false,now);assert.equal(evidence.status,'unknown');assert.equal(evidence.observedAt,null);assert.equal(serviceState(placementSummary([device],[health],now).rows[0],now),'verifying');}
 const old=boundHealth();old.port_status._connection.checkedAt='2026-10-08T03:00:00Z';assert.equal(serviceEvidence(d,old,false,now).observedAt,old.port_status._connection.checkedAt);assert.equal(serviceState(placementSummary([d],[old],now).rows[0],now),'verifying');
});
test('the single 20-minute freshness boundary agrees between backend variants and never changes observation time',()=>{
 assert.equal(CAMERA_FRESH_MS,20*60000);assert.equal(placementFreshness,CAMERA_FRESH_MS);
 const d={...endpoint(),device_type:'IPC',source:'vigilant_control_center',source_status:'online'};
 for(const minutes of [15,20,20+1/60000]){
  const stamp=new Date(now-minutes*60000).toISOString(),device={...d,source_last_seen_at:stamp},health=boundHealth();health.port_status._connection.checkedAt=stamp;
  for(const summary of [legacySummary,placementSummary]){const row=summary([device],[health],now).rows[0];assert.equal(row.status,minutes<=20?'online':'review');assert.equal(serviceState(row,now),minutes<=20?'online':'verifying');assert.equal(row.evidence.observedAt,stamp);assert.equal(row.serviceEvidence.observedAt,stamp);}
 }
});
test('v3 projections query only allowlisted identity columns using existing fixed organization/auth flow',()=>{
 const source=readFileSync(new URL('../../supabase/functions/cos-operations-pages/index.ts',import.meta.url),'utf8');
 const summary=source.slice(source.indexOf("if (path === '/api/camera-health/summary-v3')"),source.indexOf("if (path === '/api/camera-health/summary')"));
 assert.match(summary,/readIdentitySources\(context\)/);
 const route=source.slice(source.indexOf('const readIdentitySources'),source.indexOf('// Share one large-transfer'))+summary;
 assert.match(route,/vision_vigilant_unit_matches\?select=id,organization_id,equipment_unit_id,vigilant_device_id,camera_key,match_method,confidence&organization_id=eq\./);
 assert.match(route,/vision_vigilant_devices\?select=id,organization_id,external_device_id,device_name,device_type,source&organization_id=eq\./);
 assert.match(route,/equipment_units\?select=id,organization_id,unit_number,status&organization_id=eq\./);
 assert.match(route,/camera_devices\?select=id,external_device_id,device_serial,/);assert.doesNotMatch(route,/select=\*|[?&]unit_id=/);
 assert.match(route,/verifiedHealthIdentities/);assert.match(route,/projectCameraOwnerPlacement/);
});

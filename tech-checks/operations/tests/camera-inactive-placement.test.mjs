import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {inactiveSnapshot,inactiveHealth,inactiveState} from './camera-inactive-placement.fixture.mjs';
import {projectOwnerPlacement} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';
const context=vm.createContext({Date,AbortController,setTimeout,clearTimeout});
for(const file of ['camera-placement-controls.js','camera-effective-placement.js'])vm.runInContext(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),context);
const controls=context.CameraPlacementControls,effective=context.CameraEffectivePlacement;
const resolve=(snapshot,health=inactiveHealth(),state=inactiveState())=>controls.resolvePlacement(snapshot,health,state,'RANGER 001');
const device=()=>({id:11,unit_key:'RANGER 001',organization:'Old provider site',activation_state:'active',source_status:'offline'});

for(const [version,tracker] of [[1,false],[1,true],[2,true]])test('actual inactive V'+version+' '+(tracker?'tracker':'equipment')+' source DTO permits only an explicit new installation without mutating source or health',async()=>{
 const snapshot=await inactiveSnapshot({version,tracker}),health=inactiveHealth(),state=inactiveState(),before=JSON.stringify([snapshot,health,state]);
 assert.equal(snapshot.items.length,0);assert.equal(snapshot.inventoryItems.length,1);
 assert.equal(controls.isImportedInactive(snapshot.inventoryItems[0]),true);
 const result=resolve(snapshot,health,state);
 assert.equal(result.field,false);assert.equal(result.newInstallation,true);assert.equal(result.site,'');assert.equal(result.address,'');assert.equal(result.writerCompatible,true);
 const camera=device(),value=effective.resolve(snapshot,health,[camera]).get('11');
 assert.equal(value.status,'ready');assert.equal(value.scope,'inactive');assert.equal(value.site,'INACTIVE / DO NOT USE');assert.equal(value.address,'');
 assert.equal(camera.activation_state,'active');assert.equal(camera.source_status,'offline');assert.equal(JSON.stringify([snapshot,health,state]),before);
});

test('V2 tracker proof rejects changed source namespaces, malformed records, mixed identities and native claims',async()=>{
 for(const change of [r=>delete r.importedInstallation.sourceRecordId,r=>r.importedInstallation.sourceRecordId='google_sheet:123:0:Inventory|row_1',r=>r.importedInstallation.sourceSystem='mhelpdesk_product_import',r=>r.importedInstallation.productId='12345',r=>{r.readOnly=false;r.importedInstallation.entityKind='equipment_unit';}]){
  const snapshot=await inactiveSnapshot({version:2});change(snapshot.inventoryItems[0]);assert.throws(()=>resolve(snapshot));assert.notEqual(effective.resolve(snapshot,inactiveHealth(),[device()]).get('11').status,'ready');
 }
});

const brokenRows=[
 ['missing binding',row=>delete row.importedInstallation],['label only',row=>delete row.importedPlacement],
 ['wrong native identity',row=>row.importedInstallation.nativeUnitId='99999999-9999-4999-8999-999999999999'],
 ['wrong kind',row=>row.importedInstallation.entityKind='tracker'],['invalid revision',row=>row.importedInstallation.sourceRevision='stale'],
 ['invalid event',row=>row.importedInstallation.eventId='0'],['oversized event',row=>row.importedInstallation.eventId='9223372036854775808'],
 ['invalid guard',row=>row.importedInstallation.nativeGuardSha256='missing'],['missing file hash',row=>delete row.importedInstallation.sourceFileSha256],
 ['missing row hash',row=>delete row.importedInstallation.sourceRowSha256],['mixed source identity',row=>row.importedInstallation.sourceRecordId='google_sheet:synthetic_sheet_123:0:Inventory|row_1'],
 ...['nativeGuardSha256','sourceFileSha256','sourceRowSha256'].flatMap(key=>[
  ['array '+key,row=>row.importedInstallation[key]=['a'.repeat(64)]],['object '+key,row=>row.importedInstallation[key]={hash:'a'.repeat(64)}]
 ]),
 ['embedded address',row=>row.importedInstallation.installation={street:'Old address'}],['wrong imported placement',row=>row.importedInstallation.placement='SHOP'],
 ['fake inactive display',row=>row.site='SHOP / ROOT'],['missing address',row=>delete row.address],['retained address',row=>row.address='Old address'],
 ['retained current coordinates',row=>row.latitude=30],['retained current GPS',row=>row.hasUnitGps=true],['verified pin',row=>row.locationVerification='owner_verified'],
 ['saved history',row=>row.locationHistoryId='99999999-9999-4999-8999-999999999999'],['active job',row=>row.activeJobNumber='JOB 100'],['installed site',row=>row.installedSiteId='99999999-9999-4999-8999-999999999999'],
 ['partial Owner audit',row=>row.placementAuditId='100'],['partial Owner placement',row=>row.placement='SHOP']
];
for(const [name,change] of brokenRows)test('inactive '+name+' cannot open a blank editor or assert effective inactive placement',async()=>{
 const snapshot=await inactiveSnapshot();change(snapshot.inventoryItems[0]);
 assert.throws(()=>resolve(snapshot));
 let status='unavailable';try{status=effective.resolve(snapshot,inactiveHealth(),[device()]).get('11').status;}catch{}
 assert.notEqual(status,'ready');
});

test('inactive field membership and legacy audit or address conflict block deployment',async()=>{
 const snapshot=await inactiveSnapshot();snapshot.items=[snapshot.inventoryItems[0]];snapshot.summary.fieldUnits=1;
 assert.throws(()=>resolve(snapshot),/inactive placement proof/);assert.equal(effective.resolve(snapshot,inactiveHealth(),[device()]).get('11').status,'unresolved');
 for(const patch of [{auditId:'10'},{streetAddress:'Old Owner address'},{canMove:false}])assert.throws(()=>resolve({...snapshot,items:[],summary:{...snapshot.summary,fieldUnits:0}},inactiveHealth(),{...inactiveState(),...patch}));
});

test('inactive source identity and revisions stay in the pre-save fingerprint',async()=>{
 const snapshot=await inactiveSnapshot(),before=resolve(snapshot).revision;
 for(const change of [r=>r.importedInstallation.sourceRevision='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',r=>r.importedInstallation.eventId='2',r=>r.importedInstallation.sourceRowSha256='d'.repeat(64),r=>r.importedInstallation.productId='12346']){
  const next=structuredClone(snapshot);change(next.inventoryItems[0]);assert.notEqual(resolve(next).revision,before);
 }
 const warning=inactiveHealth();warning.identityWarnings=[{unitId:snapshot.inventoryItems[0].id,reason:'Identity changed',deviceIds:['11'],unitKeys:['RANGER 001']}];assert.throws(()=>resolve(snapshot,warning),/review/);
 const duplicate=structuredClone(snapshot);duplicate.inventoryItems.push({...duplicate.inventoryItems[0],id:'99999999-9999-4999-8999-999999999999'});assert.throws(()=>resolve(duplicate),/More than one/);
 const missing=inactiveHealth();missing.rows=[];assert.throws(()=>resolve(snapshot,missing),/complete source identity/);
});

test('a confirmed Owner move outranks retained inactive source metadata and retains the normal field editor',async()=>{
 const snapshot=await inactiveSnapshot(),time=new Date().toISOString();snapshot.inventoryItems=snapshot.inventoryItems.map(row=>({...row,_sourceField:false}));
 const audit={id:'100',unit_key:'RANGER 001',contract:'COS_CAMERA_PLACEMENT_V2',placement:'FIELD',action:'MOVE_TO_FIELD',created_at:time,request_id:'22222222-2222-4222-8222-222222222222',control_id:'33333333-3333-4333-8333-333333333333',device_ids:[11],site_label:'Confirmed installation',street_address:'100 New Fixture Rd'};
 const projected=await projectOwnerPlacement(snapshot,[audit],[{id:11,unit_key:'RANGER 001'}]);
 const state={...inactiveState(),auditId:'100',siteLabel:audit.site_label,streetAddress:audit.street_address};
 const result=resolve(projected,inactiveHealth(),state);assert.equal(result.field,true);assert.equal(result.newInstallation,false);assert.equal(result.address,audit.street_address);
 assert.equal(effective.resolve(projected,inactiveHealth(),[device()]).get('11').scope,'field');
});

test('inactive effective labels and stale read stay honest without changing camera observations',async()=>{
 const snapshot=await inactiveSnapshot(),camera=device(),before=JSON.stringify(camera);let denied=false;
 context.fetch=async(_url,options)=>({ok:!denied,json:async()=>JSON.parse(options.body).path==='/api/field-map'?snapshot:inactiveHealth()});
 const db={auth:{getSession:async()=>({data:{session:{user:{id:'synthetic-owner'},access_token:'synthetic-only'}}})}};
 const view=effective.create({db,getDevices:()=>[camera]});await view.refresh();assert.equal(effective.locationText(camera),'INACTIVE / DO NOT USE');assert.doesNotMatch(effective.markup(camera),/maps\/search/);
 denied=true;await view.refresh();assert.equal(effective.locationText(camera),'Last read: INACTIVE / DO NOT USE');assert.equal(JSON.stringify(camera),before);view.dispose();
});

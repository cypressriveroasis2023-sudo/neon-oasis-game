// Synthetic source receipts and UI lifecycle only. No network, credentials or live writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {projectMhelpUploadPlacement} from '../../supabase/functions/cos-operations-pages/mhelpUploadPlacement.ts';
import {projectMhelpFieldPlacement} from '../../supabase/functions/cos-operations-pages/mhelpPlacementProjection.ts';
import {projectEffectiveFleetPlacement} from '../../supabase/functions/cos-operations-pages/effectiveFleetPlacement.ts';
import {projectCombinedFleetRoster} from '../../supabase/functions/cos-operations-pages/combinedFleetRoster.ts';
const source=fs.readFileSync(new URL('../../camera-placement-controls.js',import.meta.url),'utf8');
const effective=fs.readFileSync(new URL('../../camera-effective-placement.js',import.meta.url),'utf8');
const uid='98765400-1111-4111-8111-111111111111',key='SOLARSPOTTER 987654',unitNumber='Solar Spotter 987654HDC2',proof='a'.repeat(64),hash='b'.repeat(64);
function fixture(kind='mhelpdesk_upload',placement='FIELD'){
 const observedAt=new Date(Date.now()-3*60*60*1000).toISOString(),scope=placement.toLowerCase();
 const e={contract:'COS_EFFECTIVE_FLEET_PLACEMENT_V1',state:scope,source:kind==='mhelpdesk_upload'?'owner_supplied_mhelp_export':'mhelpdesk',observedAt,freshness:'recorded',reason:kind==='mhelpdesk_upload'?'owner_supplied_export_not_live_api':'placement_refresh_unavailable'};
 const evidence={source:e.source,observedAt,state:'recorded',fresh:false,reason:e.reason,...(kind==='mhelpdesk_upload'?{productId:'987654',sourceSha256:hash,timestampKind:'upload_received',timestampPrecision:'second'}:{})};
 const row={id:uid,unitNumber,readOnly:false,placement,placementSource:kind,currentLocationType:scope,status:'field',site:'Historical source site',address:'100 Historical Synthetic Rd, Testville, TX 77001',activeJobNumber:null,installedSiteId:null,hasUnitGps:false,locationVerification:'coordinates_unverified',latitude:null,longitude:null,placementEvidence:evidence,effectivePlacement:e,activeInventoryEligible:true};
 if(kind==='mhelpdesk_upload')Object.assign(row,{uploadPlacementEvidence:structuredClone(evidence),uploadProductId:'987654',uploadLifecycle:'UNFLAGGED',uploadActiveInventoryEligible:true});
 else Object.assign(row,{mhelpObservedAt:observedAt,mhelpConfirmedAssignment:{contract:'COS_MHELP_CONFIRMED_ASSIGNMENT_V1',unitId:uid,unitNumber,placement,observedAt,assignmentChanged:false}});
 const alias={contract:'COS_NATIVE_PLACEMENT_ALIAS_V1',writerContract:'COS_CAMERA_PLACEMENT_V2',unitId:uid,unitNumber,unitKey:key,deviceIds:['9101','9102'],proof,auditId:null};
 const record={recordId:'mhelp_product:987654',productId:'987654',unitNumber:'Recorded full source label',placement,uploadLifecycle:'UNFLAGGED',overlayApplied:true,binding:{state:'linked',unitIds:[uid],candidateUnitIds:[],placementHeld:false,matchMethod:'reviewed_product_id',reason:null}};
 const snapshot={items:placement==='FIELD'?[row]:[],inventoryItems:[row],summary:{fieldUnits:placement==='FIELD'?1:0},placementReviews:[],effectivePlacementVersion:1,placementProjectionVersion:2,nativePlacementAliases:[alias],generatedAt:new Date().toISOString(),...(kind==='mhelpdesk_upload'?{uploadInventory:{contract:'COS_MHELP_UPLOAD_INVENTORY_V1',source:e.source,sourceSha256:hash,receivedAt:observedAt,receivedAtPrecision:'second',exportAsOf:null,records:[record]}}:{})};
 const health={evidenceVersion:2,identityVersion:1,rows:['9101','9102'].map(id=>({id,unit:key,trackerOnly:false,evidence:{kind:'provider',source:'Star4Live'}})),unitIdentities:[{unitId:uid,unitNumber,kind:'native_provider',deviceIds:['9101','9102'],unitKeys:[key],proof}],identityWarnings:[]};
 const state={unitKey:key,placement:'FIELD',auditId:null,siteLabel:'',streetAddress:'',canMove:true};
 const context=vm.createContext({Date,AbortController,AbortSignal,setTimeout,clearTimeout,crypto:{randomUUID}});
 vm.runInContext(source,context);vm.runInContext(effective,context);
 const devices=health.rows.map(r=>({id:Number(r.id),unit_key:key,organization:'Old provider organization',activation_state:'active'}));
 return {row,alias,record,snapshot,health,state,context,devices,api:context.CameraPlacementControls,resolve(){return this.api.resolvePlacement(this.snapshot,this.health,this.state,key)},display(){return this.context.CameraEffectivePlacement.resolve(this.snapshot,this.health,this.devices).get('9101')}};
}
for(const kind of ['mhelpdesk','mhelpdesk_upload'])for(const placement of ['FIELD','SHOP'])test(kind+' '+placement+' uses recorded source evidence plus existing native writer proof',()=>{
 const f=fixture(kind,placement),before=JSON.stringify(f.snapshot),r=f.resolve(),display=f.display();
 assert.equal(r.writerCompatible,true);assert.equal(r.sourcePlacement.kind,kind);assert.equal(r.field,placement==='FIELD');assert.equal(display.status,'ready');assert.equal(display.scope,placement.toLowerCase());assert.match(display.source,kind==='mhelpdesk'?/mHelpDesk recorded placement.*observed/:/Owner-supplied mHelpDesk export.*received/);assert.ok(display.source.includes(f.row.effectivePlacement.observedAt));assert.doesNotMatch(display.source,/current physical|live verified/i);
 if(placement==='SHOP'){assert.equal(r.newInstallation,true);assert.equal(r.site,'');assert.equal(r.address,'');}
 assert.equal(JSON.stringify(f.snapshot),before);
});
for(const kind of ['mhelpdesk','mhelpdesk_upload'])test(kind+' exact labels cannot bypass absent native alias capability',()=>{
 const f=fixture(kind);f.row.unitNumber=key;f.health.unitIdentities[0].unitNumber=key;if(f.row.mhelpConfirmedAssignment)f.row.mhelpConfirmedAssignment.unitNumber=key;f.snapshot.nativePlacementAliases=[];
 assert.equal(f.resolve().writerCompatible,false);assert.equal(f.display().status,'ready');
});
for(const kind of ['mhelpdesk','mhelpdesk_upload'])test(kind+' source proof cannot replace reviewed camera identity',()=>{
 const f=fixture(kind);f.health.unitIdentities=[];
 assert.throws(()=>f.resolve(),/No verified equipment association/);assert.equal(f.display().status,'unresolved');
 // Exact full-label fallback remains a separate old path, never a new source write.
 f.row.unitNumber=key;if(f.row.mhelpConfirmedAssignment)f.row.mhelpConfirmedAssignment.unitNumber=key;f.snapshot.nativePlacementAliases=[];
 assert.equal(f.resolve().writerCompatible,false);assert.equal(f.display().status,'unresolved');
});
const baseDenials=[
 ['missing finalizer version',f=>delete f.snapshot.effectivePlacementVersion],
 ['wrong finalizer version',f=>f.snapshot.effectivePlacementVersion=2],
 ['wrong finalizer contract',f=>f.row.effectivePlacement.contract='unreviewed'],
 ['state mismatch',f=>f.row.effectivePlacement.state='shop'],
 ['location mismatch',f=>f.row.currentLocationType='shop'],
 ['review freshness',f=>f.row.effectivePlacement.freshness='review'],
 ['review evidence',f=>f.row.placementEvidence.state='review'],
 ['future observation',f=>f.row.effectivePlacement.observedAt='2999-01-01T00:00:00Z'],
 ['missing evidence',f=>delete f.row.placementEvidence],
 ['inactive inventory',f=>f.row.activeInventoryEligible=false],
 ['absent active eligibility',f=>delete f.row.activeInventoryEligible],
 ['string active eligibility',f=>f.row.activeInventoryEligible='true'],
 ['null active eligibility',f=>f.row.activeInventoryEligible=null],
 ['identity conflict',f=>f.row.representationStatus='conflict'],
 ['placement review',f=>f.row.placementReviewReason='Review required'],
 ['field membership mismatch',f=>{f.snapshot.items=[];f.snapshot.summary.fieldUnits=0;}],
 ['non-native source row',f=>f.row.readOnly=true],
 ['unreviewed source',f=>f.row.placementSource='new_source'],
];
for(const kind of ['mhelpdesk','mhelpdesk_upload'])for(const [label,change]of baseDenials)test(kind+' denies '+label,()=>{
 const f=fixture(kind);change(f);assert.throws(()=>f.resolve());assert.notEqual(f.display().status,'ready');
});
const uploadDenials=[
 ['null product ID',f=>{f.row.placementEvidence.productId=null;f.row.uploadPlacementEvidence.productId=null;f.row.uploadProductId=null;f.record.productId=null;f.record.recordId='mhelp_product:null';}],
 ['numeric product ID',f=>{f.row.placementEvidence.productId=987654;f.row.uploadPlacementEvidence.productId=987654;f.row.uploadProductId=987654;f.record.productId=987654;}],
 ['absent upload eligibility',f=>delete f.row.uploadActiveInventoryEligible],['string upload eligibility',f=>f.row.uploadActiveInventoryEligible='true'],['inactive upload eligibility',f=>f.row.uploadActiveInventoryEligible=false],
 ['absent placementHeld',f=>delete f.record.binding.placementHeld],['string placementHeld',f=>f.record.binding.placementHeld='true'],['string false placementHeld',f=>f.record.binding.placementHeld='false'],['null placementHeld',f=>f.record.binding.placementHeld=null],
 ['missing receipt',f=>delete f.snapshot.uploadInventory],['wrong receipt version',f=>f.snapshot.uploadInventory.contract='v2'],['different source hash',f=>f.snapshot.uploadInventory.sourceSha256='c'.repeat(64)],
 ['different received time',f=>f.snapshot.uploadInventory.receivedAt='2020-01-01T00:00:00Z'],['invented export time',f=>f.snapshot.uploadInventory.exportAsOf=f.snapshot.uploadInventory.receivedAt],['different product',f=>f.row.uploadProductId='555'],['missing row evidence',f=>delete f.row.uploadPlacementEvidence],['wrong receipt kind',f=>f.row.placementEvidence.timestampKind='live_api'],
 ['duplicate product',f=>f.snapshot.uploadInventory.records.push(structuredClone(f.record))],['competing target',f=>f.snapshot.uploadInventory.records.push({...structuredClone(f.record),productId:'555',recordId:'mhelp_product:555'})],
 ['held binding',f=>f.record.binding.state='held'],['held placement',f=>f.record.binding.placementHeld=true],['unapplied overlay',f=>f.record.overlayApplied=false],['candidate identity',f=>f.record.binding.candidateUnitIds=[uid]],['missing UUID',f=>f.record.binding.unitIds=[]],['duplicate UUID',f=>f.record.binding.unitIds.push(uid)],['unreviewed match',f=>f.record.binding.matchMethod='same_number'],['inactive source',f=>f.record.uploadLifecycle='DO_NOT_USE'],['different source placement',f=>f.record.placement='SHOP']
];
for(const[label,change]of uploadDenials)test('upload denies '+label,()=>{const f=fixture();change(f);assert.throws(()=>f.resolve());assert.notEqual(f.display().status,'ready');});
for(const[label,change]of [
 ['missing marker',f=>delete f.row.mhelpConfirmedAssignment],['wrong marker contract',f=>f.row.mhelpConfirmedAssignment.contract='wrong'],['wrong native UUID',f=>f.row.mhelpConfirmedAssignment.unitId='98765400-2222-4222-8222-222222222222'],['changed native label',f=>f.row.mhelpConfirmedAssignment.unitNumber+=' replacement'],['different marker timestamp',f=>f.row.mhelpConfirmedAssignment.observedAt='2020-01-01T00:00:00Z'],['different source timestamp',f=>f.row.mhelpObservedAt='2020-01-01T00:00:00Z'],['different marker placement',f=>f.row.mhelpConfirmedAssignment.placement='SHOP'],['stale claimed-current observation',f=>{f.row.effectivePlacement.freshness='current';f.row.placementEvidence.state='current';f.row.placementEvidence.fresh=true;}]
])test('mhelpdesk denies '+label,()=>{const f=fixture('mhelpdesk');change(f);assert.throws(()=>f.resolve());assert.notEqual(f.display().status,'ready');});
test('mhelpdesk source-current evidence preserves its original time and remains distinct from physical verification',()=>{
 const f=fixture('mhelpdesk'),observedAt=new Date(Date.now()-1000).toISOString();f.row.effectivePlacement.observedAt=observedAt;f.row.effectivePlacement.freshness='current';Object.assign(f.row.placementEvidence,{observedAt,state:'current',fresh:true});f.row.mhelpConfirmedAssignment.observedAt=observedAt;f.row.mhelpObservedAt=observedAt;assert.equal(f.resolve().writerCompatible,true);assert.match(f.display().source,/recorded placement/);assert.ok(f.display().source.includes(observedAt));
});
for(const kind of ['mhelpdesk','mhelpdesk_upload'])for(const[label,change]of [['legacy audit',f=>f.state.auditId='44'],['legacy address',f=>f.state.streetAddress='100 Owner Rd'],['retained owner audit',f=>f.row.placementAuditId='44'],['retained owner key',f=>f.row.placementUnitKey=key]])test(kind+' preserves '+label+' review gate',()=>{const f=fixture(kind);change(f);assert.throws(()=>f.resolve(),/saved Owner history/);});
test('source placement ignores obsolete imported SHOP metadata while retaining it in the revision',()=>{const f=fixture();f.row.importedPlacement='SHOP';f.row.importedInstallation=null;const r=f.resolve();assert.equal(r.field,true);f.row.importedPlacement='FIELD';assert.notEqual(f.resolve().revision,r.revision);});
test('source revised receipt/assignment/authority changes invalidate the baseline; harmless JSON key order does not',()=>{
 for(const kind of ['mhelpdesk','mhelpdesk_upload']){const f=fixture(kind),before=f.resolve().revision;f.row.effectivePlacement=Object.fromEntries(Object.entries(f.row.effectivePlacement).reverse());assert.equal(f.resolve().revision,before);f.row.mhelpAssignmentChange={contract:'COS_MHELP_ASSIGNMENT_CHANGE_V1',unitId:uid,reason:'customer_or_service_location_changed'};assert.notEqual(f.resolve().revision,before);}
 const f=fixture(),before=f.resolve().revision;f.record.binding.matchMethod='owner_confirmed_alias';assert.notEqual(f.resolve().revision,before);
});
test('finalized recorded_inventory preserves old exact identifier path without inventing an Owner audit',()=>{
 const f=fixture();f.row.unitNumber=key;f.health.unitIdentities=[];f.snapshot.nativePlacementAliases=[];for(const k of ['placementSource','placementEvidence','uploadPlacementEvidence','uploadProductId','uploadLifecycle','uploadActiveInventoryEligible'])delete f.row[k];f.row.effectivePlacement={contract:'COS_EFFECTIVE_FLEET_PLACEMENT_V1',state:'field',source:'recorded_inventory',observedAt:null,freshness:'recorded',reason:null};
 assert.equal(f.resolve().writerCompatible,true);assert.equal(f.display().status,'ready');f.row.placementEvidence={source:'recorded_inventory',state:'recorded',fresh:false,reason:'service_location_read_timeout',observedAt:null};assert.throws(()=>f.resolve());
});
function dialogFixture(kind='mhelpdesk_upload'){
 const f=fixture(kind);Object.assign(f,{calls:[],saved:[],timeouts:[],holdMap:false,postReadbackFail:false,writeState:'',phase:'baseline'});
 const input=name=>({value:'',checked:false,disabled:false,required:['reason','confirmed'].includes(name),label:{hidden:false},closest(){return this.label;},focus(){}}),fields=Object.fromEntries(['site','address','reason','confirmed'].map(k=>[k,input(k)]));
 const nodes={feedback:{textContent:''},note:{textContent:''},title:{textContent:''},unit:{textContent:''},save:{disabled:true},cancel:{disabled:false},retry:{hidden:true,disabled:false}};
 const form={elements:{namedItem:n=>fields[n]},querySelector:s=>s==='[type=submit]'?nodes.save:s==='.placement-cancel'?nodes.cancel:nodes.retry,querySelectorAll:()=>Object.values(fields),reportValidity:()=>!!fields.reason.value&&fields.confirmed.checked};
 const dialog={isConnected:false,setAttribute(){},querySelector:s=>s==='form'?form:s==='h2'?nodes.title:s==='.placement-feedback'?nodes.feedback:s==='.placement-pin-note'?nodes.note:nodes.unit,addEventListener(){},showModal(){},close(){},remove(){this.isConnected=false;}};
 f.context.document={createElement:()=>dialog,body:{append:d=>d.isConnected=true}};f.context.window={addEventListener(){},removeEventListener(){}};
 f.context.fetch=async(_u,options)=>{const path=JSON.parse(options.body).path;f.calls.push(path);if(f.holdMap&&path==='/api/field-map')await new Promise(r=>f.releaseMap=r);return{ok:!(f.postReadbackFail&&f.phase==='written'&&path==='/api/field-map'),status:503,json:async()=>structuredClone(path==='/api/field-map'?f.snapshot:f.health)};};
 const db={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-only',user:{id:'synthetic-owner'}}}})},rpc:async(name,args)=>{f.calls.push(name);if(name==='owner_camera_unit_placement_state_v2')return{data:structuredClone(f.state)};
  assert.equal(name,'owner_set_camera_unit_placement_v2');assert.equal(args.p_unit_key,key);assert.equal(args.p_expected_audit_id,null);f.phase='written';f.writeState=args.p_placement;Object.assign(f.state,{placement:args.p_placement,auditId:'101',siteLabel:args.p_site_label,streetAddress:args.p_street_address});Object.assign(f.row,{placement:args.p_placement,placementSource:'owner',placementUnitKey:key,placementAuditId:'101',placementUpdatedAt:new Date().toISOString(),currentLocationType:args.p_placement.toLowerCase(),effectivePlacement:{contract:'COS_EFFECTIVE_FLEET_PLACEMENT_V1',state:args.p_placement.toLowerCase(),source:'owner',observedAt:new Date().toISOString(),freshness:'recorded',reason:null}});f.snapshot.generatedAt=new Date().toISOString();f.snapshot.items=[];f.snapshot.summary.fieldUnits=0;f.alias.auditId='101';return{data:{ok:true,unit_key:key,placement:args.p_placement,request_id:args.p_request_id,audit_id:'101'}};
 }};
 return Object.assign(f,{fields,nodes,form,dialog,open:()=>f.api.open({db,key,placement:'SHOP',onSaved:v=>f.saved.push(v)}),submit:()=>form.onsubmit({preventDefault(){}}),moves:()=>f.calls.filter(n=>n==='owner_set_camera_unit_placement_v2')});
}
for(const kind of ['mhelpdesk','mhelpdesk_upload'])test(kind+' one confirmed Shop move performs independent legacy + exact native Owner readback',async()=>{
 const f=dialogFixture(kind);await f.open();assert.equal(f.nodes.save.disabled,false);assert.match(f.nodes.feedback.textContent,/Confirm the unit’s physical location/);assert.ok(f.nodes.feedback.textContent.includes(f.row.effectivePlacement.observedAt));f.fields.reason.value='Synthetic return';f.fields.confirmed.checked=true;await f.submit();assert.equal(f.moves().length,1);assert.equal(f.saved.length,1);assert.equal(f.dialog.isConnected,false);assert.equal(f.calls.filter(n=>n==='/api/field-map').length,3);assert.equal(f.writeState,'SHOP');
});
test('uncertain native readback never replays a committed source move',async()=>{const f=dialogFixture();await f.open();f.fields.reason.value='Synthetic return';f.fields.confirmed.checked=true;f.postReadbackFail=true;await f.submit();assert.equal(f.moves().length,1);assert.equal(f.saved.length,0);assert.match(f.nodes.feedback.textContent,/could not be confirmed/);f.nodes.retry.onclick();await f.submit();assert.equal(f.moves().length,1);assert.equal(f.nodes.retry.hidden,true);});
test('a changed source receipt needs reread and new confirmation before any move',async()=>{const f=dialogFixture();await f.open();f.fields.reason.value='Synthetic return';f.fields.confirmed.checked=true;f.record.binding.matchMethod='owner_confirmed_alias';await f.submit();assert.equal(f.moves().length,0);assert.match(f.nodes.feedback.textContent,/identity changed/);assert.equal(f.nodes.retry.hidden,false);});
test('missing suffix association explains review without offering a false retry remedy or writing',async()=>{const f=dialogFixture();f.health.unitIdentities=[];await f.open();assert.equal(f.nodes.save.disabled,true);assert.equal(f.nodes.retry.hidden,true);assert.match(f.nodes.feedback.textContent,/No verified equipment association/);assert.match(f.nodes.feedback.textContent,/retrying does not create that link/);assert.doesNotMatch(f.nodes.feedback.textContent,/\.\./);assert.equal(f.moves().length,0);});

for(const kind of ['mhelpdesk','mhelpdesk_upload'])for(const placement of ['FIELD','SHOP'])test('actual main source projector/finalizer output is accepted for '+kind+' '+placement,()=>{
 const f=fixture(kind,placement),now=Date.now(),observedAt=new Date(now-3*60*60*1000).toISOString();
 const row={id:uid,unitNumber,readOnly:false,status:'field',currentLocationType:'field',site:'Old source',address:'10 Synthetic Old Road',installedSiteId:null,activeJobNumber:null,hasUnitGps:false,latitude:null,longitude:null,locationVerification:'coordinates_unverified'};
 const raw={...f.snapshot,inventoryItems:[row],items:[row],summary:{fieldUnits:1}};delete raw.effectivePlacementVersion;delete raw.uploadInventory;
 let projected,authorities=[];
 if(kind==='mhelpdesk_upload'){
  const upload={contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:hash,payloadSha256:'c'.repeat(64),receivedAt:observedAt,receivedAtPrecision:'second',exportAsOf:null,records:[{productId:'987654',unitNumber,category:'Synthetic Camera',customerId:'999',customer:'Synthetic customer',sourceAddress:{street:'Source billing address'},sourceRow:2,placement,lifecycle:'UNFLAGGED',binding:{productId:'987654',trackerId:null,trackerLabel:null,nativeUnitId:uid,nativeLabel:unitNumber,fullLabel:unitNumber,matchMethod:'reviewed_product_id',evidenceSha256:'d'.repeat(64),expectedGuard:'e'.repeat(64),guardCurrent:true}}]};
  const result=projectMhelpUploadPlacement(raw,upload,[],f.health,now);projected=result.snapshot;authorities=result.authorities;
 }else{
  const receipt={contract:'COS_MHELP_PLACEMENT_V1',enabled:true,lastSuccessAt:observedAt,lastAttemptAt:observedAt,errorCode:'source_refresh_delayed',items:[{trackerId:'98765400-2222-4222-8222-222222222222',nativeUnitId:uid,trackerLabel:unitNumber,nativeLabel:unitNumber,guardCurrent:true,state:'confirmed',placement,customerLabel:'Synthetic customer',siteLabel:'Synthetic job',locationReview:false,assignmentChanged:false,observedAt}]};
  projected=projectMhelpFieldPlacement(raw,receipt,[],f.health,now);
 }
 f.snapshot=projectCombinedFleetRoster(projectEffectiveFleetPlacement(projected,[],{authorizedUploadPlacements:authorities}),[],f.health);f.row=f.snapshot.inventoryItems[0];
 const result=f.resolve();assert.equal(result.writerCompatible,true);assert.equal(result.sourcePlacement.kind,kind);assert.equal(result.field,placement==='FIELD');assert.equal(f.display().status,'ready');assert.equal(result.sourcePlacement.observedAt,observedAt);
});

test('recorded-inventory finalization cannot bypass a missing legacy imported SHOP proof',()=>{
 const f=fixture();f.row.unitNumber=key;f.health.unitIdentities=[];f.snapshot.nativePlacementAliases=[];for(const k of ['placementSource','placementEvidence','uploadPlacementEvidence','uploadProductId','uploadLifecycle','uploadActiveInventoryEligible'])delete f.row[k];f.row.effectivePlacement={contract:'COS_EFFECTIVE_FLEET_PLACEMENT_V1',state:'field',source:'recorded_inventory',observedAt:null,freshness:'recorded',reason:null};f.row.importedPlacement='SHOP';f.row.importedInstallation=null;f.state.placement='SHOP';assert.throws(()=>f.resolve(),/imported Shop placement proof is incomplete/);
});

for(const page of ['camera-health.html','camera-detail.html'])test(page+' requests the corrected source-compatible placement helpers',()=>{
 const html=fs.readFileSync(new URL('../../'+page,import.meta.url),'utf8');
 for(const helper of ['camera-placement-controls.js','camera-effective-placement.js']){
  const urls=[...html.matchAll(/src="([^"]+)"/g)].map(match=>match[1]).filter(url=>url.startsWith('./'+helper+'?'));
  assert.deepEqual(urls,['./'+helper+'?v='+ (helper==='camera-placement-controls.js'?'20261015-save-recovery-v1':'20261015-placement-read-coalescing-v1')]);
 }
});

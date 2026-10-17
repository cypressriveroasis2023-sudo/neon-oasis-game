import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture,hash,org,native,tracker,actor} from './fixtures/owner-identity-upload-fixture.mjs';

const sql=async file=>readFile(new URL('../db/'+file,import.meta.url),'utf8');

test('layered source transition migration installs on existing PR200 reader without changing inventory',async()=>{
 const f=await fixture({recordCount:1001});
 try{
  const before=await f.snapshot(),preserved=await f.preserved();
  // The existing identity fixture installs the compact graph guard but skips
  // this separate source-graph reader; add its original unchanged definition.
  const continuity=await sql('mhelp-source-continuity.sql');
  const start=continuity.indexOf('-- Same complete graph'),end=continuity.indexOf('create function cos_mhelp_placement_private.continuity_unchanged');
  assert.ok(start>=0&&end>start);
  await f.db.exec(continuity.slice(start,end));
  await f.db.exec(await sql('cos_source_transition_continuity_20261017.sql'));
  assert.deepEqual(await f.snapshot(),before);
  assert.deepEqual(await f.preserved(),preserved);
  const projected=(await f.db.query('select cos_mhelp_placement_private.upload_snapshot() v')).rows[0].v;
  assert.equal(projected.records.length,1001);
  assert.equal(projected.records.filter(r=>r.placement==='FIELD').length,287);
  assert.equal(projected.records.filter(r=>r.placement==='SHOP').length,714);
  assert.equal((await f.db.query('select count(*)::int n from cos_mhelp_placement_private.source_transition_receipts')).rows[0].n,0);
  const held=(await f.db.query("select cos_mhelp_placement_private.source_transition_review($1,$2,$3,$4) v",[hash,hash,hash,'2258987'])).rows[0].v;
  assert.equal(held.eligible,false);
  assert.equal(held.reason,'active_source_or_payload_changed');
  const excluded=(await f.db.query("select cos_mhelp_placement_private.source_transition_review($1,$2,$3,$4) v",[hash,hash,hash,'2301876'])).rows[0].v;
  assert.equal(excluded.reason,'separate_identity_review_required');
  for(const role of ['anon','authenticated','service_role']){
   await f.db.exec('set role '+role);
   await assert.rejects(()=>f.db.query('select * from cos_mhelp_placement_private.source_transition_receipts'));
   await assert.rejects(()=>f.db.query('select cos_mhelp_placement_private.source_transition_review($1,$2,$3,$4)',[hash,hash,hash,'2258987']));
   await f.db.exec('reset role');
  }
  await assert.rejects(()=>f.db.exec('delete from cos_mhelp_placement_private.source_transition_receipts'),/immutable/);
  await assert.rejects(()=>f.db.exec('truncate cos_mhelp_placement_private.source_transition_receipts'),/immutable/);
 }finally{await f.db.close();}
});


test('guarded source transition is read-only until Owner admission and fails shut after later tracker change',async()=>{
 const f=await fixture();
 try {
  const db=f.db, currentSha='b'.repeat(64),payload='c'.repeat(64),request='66666666-6666-4666-8666-666666666666';
  const continuity=await sql('mhelp-source-continuity.sql');
  await db.exec(continuity.slice(continuity.indexOf('-- Same complete graph'),continuity.indexOf('create function cos_mhelp_placement_private.continuity_unchanged')));
  await db.exec('create table app_private.cos_archived_representation_revocations (id uuid)');
  await db.query("update equipment_units set unit_number='Solar Spotter 006HDC2' where id=$1",[native]);
  await db.query("update app_private.vision_tracker_locations set unit_number='Solar Spotter 006HDC2',unit_key='solarspotter006hdc2' where id=$1",[tracker]);
  const beforeGuard=(await db.query('select cos_mhelp_placement_private.upload_binding_guard($1,$2) v',[tracker,native])).rows[0].v;
  const beforeGraph=(await db.query('select cos_mhelp_placement_private.continuity_graph($1,$2) v',[tracker,native])).rows[0].v;
  const old={...f.records[0],productId:'2229349',unitNumber:'Solar Spotter 006  ',category:'Solar Spotter',customer:'Synthetic customer: Synthetic job',
   sourceAddress:{street:'19777 Clay Rd',city:'Katy',state:'TX',zip:'77449'},
   possibleAliasUnitIds:[],placementHeld:false,
   binding:{...f.records[0].binding,productId:'2229349',fullLabel:'Solar Spotter 006  ',
    trackerLabel:'Solar Spotter 006HDC2',nativeLabel:'Solar Spotter 006HDC2',
    canonicalKey:'SOLAR SPOTTER:6',representedUnitIds:[native],expectedGuard:beforeGuard}};
  const beforeRecords=[old,...f.records.slice(1)];
  const trackerRowId='tracker:synthetic:SOLAR SPOTTER:6';
  const oldTracker={recordId:trackerRowId,unitNumber:'Solar Spotter 006HDC2',matchedProductId:'2229349',category:'SOLAR SPOTTERS',
   placement:'FIELD',lifecycle:'ACTIVE',customer:'Synthetic customer',site:'Synthetic job',sourceAddress:null,
   binding:{state:'linked',unitIds:[native,tracker],unitLabels:{[native]:'Solar Spotter 006HDC2',[tracker]:'Solar Spotter 006HDC2'},
    matchMethod:'exact_canonical_family_unit',trackerId:tracker,nativeUnitId:native,expectedGuard:beforeGuard,
    representedUnitIds:[native],placementHeld:false}};
  const newTracker={...oldTracker,unitNumber:'Solar Spotter 006',customer:'Synthetic customer: Synthetic job',site:null,
   binding:{state:'held',unitIds:[],unitLabels:{},guardCurrent:null}};
  await db.query('update cos_mhelp_placement_private.upload_batches set records=$1::jsonb,receipt=receipt||$3::jsonb where source_sha256=$2',
   [beforeRecords,hash,{trackerRecords:[oldTracker]}]);
  await db.exec('alter table app_private.cos_geocode_sources add column source_file_sha256 text');
  await db.query('insert into app_private.cos_geocode_sources(tracker_id,entity_kind,native_unit_id,product_id,source_system,source_revision,unit_number,tracker_unit_number,active,source_file_sha256) values($1,$2,$3,$4,$5,$6,$7,$8,true,$9)',[tracker,'equipment_unit',native,'2229349','mhelpdesk_product_import','77777777-7777-4777-8777-777777777777','Solar Spotter 006HDC2','Solar Spotter 006HDC2',hash]);
  const afterGuard=(await db.query('select cos_mhelp_placement_private.upload_binding_guard($1,$2) v',[tracker,native])).rows[0].v;
  const afterGraph=(await db.query('select cos_mhelp_placement_private.continuity_graph($1,$2) v',[tracker,native])).rows[0].v;
  assert.notEqual(beforeGuard,afterGuard);assert.deepEqual({...beforeGraph,sources:[]},{...afterGraph,sources:[]});
  await db.query('insert into cos_mhelp_placement_private.source_admissions(request_id,source_sha256,payload_sha256,input_sha256,authorization_sha256,records,before_guards,after_sources) values($1,$2,$3,$4,$5,$6,$7,$8)',[request,hash,hash,hash,hash,[],[],[]]);
  await db.query('insert into cos_mhelp_placement_private.source_continuity(request_id,action,source_sha256,payload_sha256,tracker_id,native_id,original_guard,before_guard,after_guard,before_graph,after_graph,authorization_sha256) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[request,'admit',hash,hash,tracker,native,beforeGuard,beforeGuard,afterGuard,beforeGraph,afterGraph,hash]);
  const next={...old,unitNumber:'Solar Spotter 006',binding:null,placementHeld:true,holdReason:'Native identity or location evidence changed; fresh association review required'};
  delete next.possibleAliasUnitIds;
  const nextRecords=[next,...f.records.slice(1)];
  const receipt={...f.receipt,sourceSha256:currentSha,receivedAt:'2026-10-17T10:00:00Z',trackerRecords:[newTracker]};
  await db.query('insert into cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records) values($1,$2,$3,$4)',[currentSha,payload,receipt,nextRecords]);
  await db.query('update cos_mhelp_placement_private.upload_control set active_sha256=$1 where singleton',[currentSha]);
  await db.query("insert into cos_mhelp_placement_private.upload_audit(action,source_sha256,previous_sha256,authorization_sha256) values('activate',$1,$2,$3)",[currentSha,hash,hash]);
  await db.exec(await sql('cos_source_transition_continuity_20261017.sql'));
  const proof=(await db.query('select cos_mhelp_placement_private.source_transition_review($1,$2,$3,$4) v',[currentSha,payload,hash,'2229349'])).rows[0].v;
  assert.deepEqual({eligible:proof.eligible,reason:proof.reason},{eligible:true,reason:'guarded_source_transition_only'});
  const baseline=(await f.snapshot()).records[0];assert.equal(baseline.binding,null);assert.equal(baseline.placementHeld,true);
  const preview=(await db.query('select cos_mhelp_placement_private.admit_source_transition($1,$2,$3,$4,$5,$6,$7,$8,$9) v',[actor,org,currentSha,payload,hash,'2229349',proof.currentRowSha256,'88888888-8888-4888-8888-888888888888',false])).rows[0].v;
  assert.equal(preview.applied,false);
  assert.equal((await f.snapshot()).records[0].binding,null);
  const receiptResult=(await db.query('select cos_mhelp_placement_private.admit_source_transition($1,$2,$3,$4,$5,$6,$7,$8,$9) v',[actor,org,currentSha,payload,hash,'2229349',proof.currentRowSha256,'88888888-8888-4888-8888-888888888888',true])).rows[0].v;
  assert.equal(receiptResult.applied,true);
  const admitted=(await f.snapshot()).records[0];
  assert.equal(admitted.binding.nativeUnitId,native);assert.equal(admitted.binding.guardCurrent,true);
  assert.equal(admitted.holdReason,null);assert.equal(admitted.placementHeld,false);
  const reconciled=(await f.snapshot()).trackerRecords;
  assert.equal(reconciled[0].matchedProductId,'2229349');
  assert.equal(reconciled[0].binding.state,'linked');
  assert.equal(reconciled[0].binding.guardCurrent,true);
  assert.deepEqual(reconciled[0].binding.unitIds,[native,tracker]);
  assert.equal((await f.snapshot()).records.length,2);
  await db.query("update app_private.vision_tracker_locations set customer='Concurrent correction' where id=$1",[tracker]);
  const afterDrift=await f.snapshot(),stale=afterDrift.records[0];
  assert.equal(stale.binding,null);assert.equal(stale.placementHeld,true);
  assert.equal(afterDrift.trackerRecords[0].binding.state,'held');
  await assert.rejects(()=>db.query('select cos_mhelp_placement_private.admit_source_transition($1,$2,$3,$4,$5,$6,$7,$8,$9)',[actor,org,currentSha,payload,hash,'2229349',proof.currentRowSha256,'88888888-8888-4888-8888-888888888888',true]),/changed/);
 }finally{await f.db.close();}
});

import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';import {schema} from './fixtures/mhelp-placement-schema.mjs';
const tracker='11111111-1111-4111-8111-111111111111',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',revision='22222222-2222-4222-8222-222222222222',hash='a'.repeat(64);
async function fixture(){const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');await db.exec(schema);await db.exec(await readFile(new URL('../db/20261012173408_cos_mhelp_placement_sync.sql',import.meta.url),'utf8'));
 await db.query(`insert into app_private.vision_tracker_locations values($1,$2,'Sniper 2 017','sniper2017','SNIPERS','FIELD','Synthetic Customer','Synthetic Site','Old street',30,-95)`,[tracker,org]);
 await db.query(`insert into app_private.cos_geocode_sources values($1,'tracker',null,'101','mhelpdesk_product_import',$2,'Sniper 2 017','Sniper 2 017',true)`,[tracker,revision]);
 const acl=(await db.query("select proacl::text acl from pg_proc where oid='public.cos_mhelp_placement_snapshot(uuid,uuid)'::regprocedure")).rows;
 await db.exec(await readFile(new URL('../db/mhelp_upload_overlay.sql',import.meta.url),'utf8'));
 assert.deepEqual((await db.query("select proacl::text acl from pg_proc where oid='public.cos_mhelp_placement_snapshot(uuid,uuid)'::regprocedure")).rows,acl);
 const guard=(await db.query('select cos_mhelp_placement_private.upload_binding_guard($1,null) value',[tracker])).rows[0].value;
 const receipt={contract:'COS_MHELP_UPLOAD_V1',sourceSha256:hash,libraryFileId:'libfile_synthetic',receivedAt:'2026-01-01T12:00:00Z',receivedAtPrecision:'minute',receivedMessageId:'SyntheticMessage',exportAsOf:null,authorizationSha256:'b'.repeat(64),recordCount:2,companyCustomerIds:['11']};
 const records=[{productId:'101',unitNumber:'Sniper 2 017',category:'Sniper 2',customerId:'11',customer:'Synthetic Company',sourceAddress:{street:'Source street',city:'Test',state:'TX',zip:'00000'},sourceRow:2,placement:'SHOP',lifecycle:'UNFLAGGED',binding:{productId:'101',trackerId:tracker,nativeUnitId:null,trackerLabel:'Sniper 2 017',nativeLabel:null,fullLabel:'Sniper 2 017',matchMethod:'exact_family_unit',representedUnitIds:[tracker],representationEvidenceSha256:hash,canonicalKey:'SNIPER2:17',reviewEvidence:{method:'synthetic'},evidenceSha256:'c'.repeat(64),expectedGuard:guard}},{productId:'102',unitNumber:'Sniper 4 018 DO NOT USE',category:'Sniper 4',customerId:'12',customer:'Synthetic Builder',sourceAddress:{street:'',city:'',state:'',zip:''},sourceRow:3,placement:'FIELD',lifecycle:'DO_NOT_USE',binding:null}];return {db,receipt,records};}
const call=async(db,receipt,records,apply=false,expected=null)=>(await db.query('select cos_mhelp_placement_private.review_upload($1,$2,$3,$4) value',[receipt,records,expected,apply])).rows[0].value;
const preserved=async db=>(await db.query("select jsonb_build_object('trackers',(select jsonb_agg(to_jsonb(t)) from app_private.vision_tracker_locations t),'sources',(select jsonb_agg(to_jsonb(t)) from app_private.cos_geocode_sources t),'api',(select jsonb_agg(to_jsonb(t)) from cos_mhelp_placement_private.control t),'observations',(select jsonb_agg(to_jsonb(t)) from cos_mhelp_placement_private.links t)) value")).rows[0].value;
test('dry-run is read-only; apply is atomic/idempotent; rollback retains all source/audit records and API state',async()=>{const {db,receipt,records}=await fixture();try{
 const before=await preserved(db);const dry=await call(db,receipt,records);assert.equal(dry.applied,false);assert.equal(dry.records,2);assert.equal((await db.query('select count(*) n from cos_mhelp_placement_private.upload_batches')).rows[0].n,0);
 const applied=await call(db,receipt,records,true);assert.equal(applied.boundRecords,1);assert.equal(applied.unboundRecords,1);assert.equal((await call(db,receipt,records,true)).idempotent,true);
 const snap=(await db.query('select public.cos_mhelp_placement_snapshot($1,$2) value',[tracker,org])).rows[0].value;assert.equal(snap.upload.records.length,2);assert.equal(snap.upload.records[0].binding.guardCurrent,true);assert.equal(snap.upload.records[0].binding.reviewEvidence,undefined);assert.equal(snap.upload.records[1].lifecycle,'DO_NOT_USE');assert.deepEqual(await preserved(db),before);
 await assert.rejects(()=>db.query('select cos_mhelp_placement_private.rollback_upload($1,$2,$3)',['d'.repeat(64),null,hash]),/changed/);
 const rollback=(await db.query('select cos_mhelp_placement_private.rollback_upload($1,$2,$3)',[hash,null,hash])).rows;assert.ok(rollback);
 assert.equal((await db.query('select cos_mhelp_placement_private.upload_snapshot() value')).rows[0].value,null);assert.equal((await db.query('select count(*) n from cos_mhelp_placement_private.upload_batches')).rows[0].n,1);assert.equal((await db.query('select count(*) n from cos_mhelp_placement_private.upload_audit')).rows[0].n,2);assert.deepEqual(await preserved(db),before);
 }finally{await db.close();}});
test('stale graph, duplicate ProductId, incomplete file and changed expected active head fail without writes',async()=>{const {db,receipt,records}=await fixture();try{
 await assert.rejects(()=>call(db,receipt,[records[0]]),/Incomplete/);
 await assert.rejects(()=>call(db,receipt,[records[0],records[0]]),/Invalid/);
 await assert.rejects(()=>call(db,receipt,records,true,'d'.repeat(64)),/changed/);
 await db.exec("update app_private.vision_tracker_locations set site='Newer correction'");await assert.rejects(()=>call(db,receipt,records,true),/graph changed/);
 assert.equal((await db.query('select count(*) n from cos_mhelp_placement_private.upload_batches')).rows[0].n,0);
 }finally{await db.close();}});
test('post-import graph drift holds binding; source hash cannot be reused for changed content; no public/admin expansion',async()=>{const {db,receipt,records}=await fixture();try{
 await call(db,receipt,records,true);await assert.rejects(()=>call(db,{...receipt,filename:'altered'},records,true),/different reviewed content/);
 await db.exec("update app_private.vision_tracker_locations set unit_number='Renamed after review'");assert.equal((await db.query('select cos_mhelp_placement_private.upload_snapshot() value')).rows[0].value.records[0].binding.guardCurrent,false);
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(()=>call(db,receipt,records,true));await assert.rejects(()=>db.query('select * from cos_mhelp_placement_private.upload_batches'));await db.exec('reset role');}
 }finally{await db.close();}});
test('tracker bindings are revalidated at every snapshot and private tracker reader grants stay closed',async()=>{const {db,receipt,records}=await fixture();try{
 const b=records[0].binding;receipt.trackerSource={contract:'COS_CURRENT_TRACKER_CENSUS_V1',complete:true,sourceSha256:'d'.repeat(64),observedAt:receipt.receivedAt,totalSourceRecords:1};
 receipt.trackerRecords=[{recordId:'tracker:synthetic:row2',unitNumber:'Sniper 2 017',placement:'FIELD',lifecycle:'ACTIVE',matchedProductId:'101',binding:{state:'linked',trackerId:tracker,nativeUnitId:null,unitIds:[tracker],representedUnitIds:[tracker],unitLabels:{[tracker]:'Sniper 2 017'},expectedGuard:b.expectedGuard,guardCurrent:false}}];
 await call(db,receipt,records,true);let read=(await db.query('select cos_mhelp_placement_private.upload_snapshot() value')).rows[0].value;assert.equal(read.trackerRecords[0].binding.guardCurrent,true);
 await db.query('update app_private.cos_geocode_sources set source_revision=$1',['33333333-3333-4333-8333-333333333333']);read=(await db.query('select cos_mhelp_placement_private.upload_snapshot() value')).rows[0].value;assert.equal(read.trackerRecords[0].binding.guardCurrent,false);
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(()=>db.query('select cos_mhelp_placement_private.upload_tracker_snapshot($1)',[receipt.trackerRecords]));await db.exec('reset role');}
 }finally{await db.close();}});
test('prior assignment proof is exact and cannot outlive a changed saved API assignment',async()=>{const {db,receipt,records}=await fixture();try{
 const prior={productId:'101',customerId:'12',placement:'FIELD',serviceLocationId:'88',observedAt:'2026-01-01T08:00:00Z'};
 await db.query(`insert into cos_mhelp_placement_private.links(equipment_id,tracker_id,tracker_label,full_label,source_revision,baseline_guard,baseline_customer_id,authorization_sha256,observation,observed_at) values('101',$1,'Sniper 2 017','Sniper 2 017',$2,$3,'12',$3,$4,$5)`,[tracker,revision,hash,{state:'confirmed',customerId:'12',placement:'FIELD',serviceLocationId:'88'},prior.observedAt]);
 records[0].binding.previousAssignment=prior;assert.equal((await call(db,receipt,records)).applied,false);
 await db.exec(`update cos_mhelp_placement_private.links set observation=jsonb_set(observation,'{customerId}','"13"')`);await assert.rejects(()=>call(db,receipt,records),/Previous assignment evidence changed/);
 }finally{await db.close();}});
test('assignmentChanged distinguishes known moves from newly available or missing service identity',async()=>{const {db}=await fixture();try{
 await db.query(`insert into cos_mhelp_placement_private.links(equipment_id,tracker_id,tracker_label,full_label,source_revision,baseline_guard,baseline_customer_id,baseline_location_id,authorization_sha256,observation,observed_at) values('101',$1,'Sniper 2 017','Sniper 2 017',$2,$3,'12',null,$3,$4,'2026-01-01T08:00:00Z')`,[tracker,revision,hash,{state:'confirmed',customerId:'12',placement:'FIELD',serviceLocationId:'88'}]);
 const read=async()=>((await db.query('select public.cos_mhelp_placement_snapshot($1,$2) value',[tracker,org])).rows[0].value.items[0]);
 let item=await read();assert.equal(item.locationReview,true);assert.equal(item.assignmentChanged,false,'first known service ID is not evidence of movement');
 await db.exec(`update cos_mhelp_placement_private.links set baseline_location_id='87'`);assert.equal((await read()).assignmentChanged,true,'different known service IDs prove movement');
 await db.exec(`update cos_mhelp_placement_private.links set baseline_location_id='88'`);item=await read();assert.equal(item.locationReview,false);assert.equal(item.assignmentChanged,false);
 await db.exec(`update cos_mhelp_placement_private.links set observation=observation-'serviceLocationId'`);item=await read();assert.equal(item.locationReview,true);assert.equal(item.assignmentChanged,false,'missing new ID cannot prove movement');
 await db.exec(`update cos_mhelp_placement_private.links set observation=jsonb_set(observation,'{customerId}','"13"')`);assert.equal((await read()).assignmentChanged,true,'different known customer IDs prove movement');
 }finally{await db.close();}});

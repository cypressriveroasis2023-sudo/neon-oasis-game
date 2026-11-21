import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {fixture} from './fixtures/publisher-review-fixture.mjs';
import {publisherPostgres} from './fixtures/publisher-postgres.mjs';
import {planPublishing} from '../../supabase/functions/cos-sheets-placement-publish/model.ts';
const migration=await readFile(new URL('../docs/drafts/cos-publisher-fields-v1.sql',import.meta.url),'utf8');
const rollback=await readFile(new URL('../docs/drafts/cos-publisher-fields-v1-rollback.sql',import.meta.url),'utf8');
const cell=s=>({entered:{stringValue:s},validation:null,rich:false,note:null});
const get=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0].v;
async function setup(){const db=await fixture(await publisherPostgres());
 await db.exec(`create schema cos_operational_private;create table cos_operational_private.current_placements(product_id text primary key);
 create table cos_mhelp_placement_private.live_inventory_control(singleton boolean primary key,enabled boolean,last_success_at timestamptz,error_code text,active_source_sha256 text);
 create table cos_mhelp_placement_private.upload_control(singleton boolean primary key,active_sha256 text);
 create table cos_mhelp_placement_private.live_inventory_candidates(source_sha256 text primary key,payload_sha256 text,receipt jsonb,records jsonb);
 insert into cos_mhelp_placement_private.live_inventory_control values(true,true,clock_timestamp(),null,repeat('a',64));insert into cos_mhelp_placement_private.upload_control values(true,repeat('a',64));`);
 const record={productId:'123',unitNumber:'Spotter 023.1',customer:'Cameras Onsite LLC',placement:'SHOP',lifecycle:'UNFLAGGED',holdReason:null,addressReview:null,sourceAddress:{street:'',city:'',state:'',zip:''},sourceDates:{apiCustomerObservedAt:new Date().toISOString()},apiAssignment:{customerId:'4',serviceLocationId:null,placementProof:{serviceVerified:false}}};
 const receipt={contract:'COS_MHELP_API_V1',origin:'mhelpdesk_api',portalId:'224643',complete:true,reviewed:true,sourceSha256:'a'.repeat(64),receivedAt:new Date().toISOString()};
 await db.query(`insert into cos_mhelp_placement_private.live_inventory_candidates select repeat('a',64),encode(sha256(convert_to(jsonb_build_object('receipt',$1::jsonb,'records',$2::jsonb)::text,'UTF8')),'hex'),$1,$2`,[receipt,[record]]);
 await db.exec(await readFile(new URL('../db/mhelp-publisher-reviewed-bindings.sql',import.meta.url),'utf8'));
 await db.exec(`create function cos_mhelp_placement_private.upload_snapshot() returns jsonb language sql as $$select '{}'::jsonb$$;`);
 await db.exec(await readFile(new URL('../db/mhelp-publisher-freshness.sql',import.meta.url),'utf8'));
 await db.exec(migration);
 const binding=(await db.query('select * from cos_sheets_placement_private.bindings')).rows[0];
 const fields={address:cell(''),index:{row:8,cells:['SPOTTERS|Spotter 023.1','123','Spotter 023.1','Synthetic Builder: Synthetic Job','ServiceItem_List_20261023000000.csv'].map(cell)}};fields.index.cells[4].note='Historical note';
 const source=await get(db,"select cos_sheets_placement_private.field_source('123','Historical note') v");assert(source);
 const location=await get(db,'select cos_sheets_placement_private.field_location(b) v from cos_sheets_placement_private.bindings b');
 const manifest={contract:'COS_PUBLISHER_FIELDS_REVIEW_V1',readAt:new Date().toISOString(),sourceSha256:'a'.repeat(64),items:[{equipmentId:'123',location,legacyBaseline:binding.baseline_cells,fields,source}]};
 return {db,manifest,fields};}
const admit=(db,m,auth='c'.repeat(64))=>get(db,'select cos_sheets_placement_private.admit_fields($1,$2) v',[m,auth]);
const begin=db=>get(db,'select public.cos_sheets_placement_begin() v');
const stage=(db,lease,intents)=>get(db,'select public.cos_sheets_placement_stage($1,$2) v',[lease,intents]);
const finish=(db,lease,results)=>get(db,'select public.cos_sheets_placement_finish($1,$2) v',[lease,results]);
const realPostgres=Boolean(process.env.COS_PUBLISHER_TEST_DATABASE_URL);
async function waitForLock(db,pid){
 for(let n=0;n<100;n++){
  if(await get(db,"select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock') v",[pid]))return;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 throw Error('Concurrent client never reached the expected database lock');
}
test('real PostgreSQL concurrent one-use admission commits exactly one complete review',{skip:!realPostgres},async()=>{const {db,manifest}=await setup();try{
 const a=await db.connect(),b=await db.connect();
 const results=await Promise.allSettled([a,b].map(c=>c.query('select cos_sheets_placement_private.admit_fields($1,$2)',[JSON.stringify(manifest),'c'.repeat(64)])));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='23505').length,1);
 assert.equal(await get(db,'select count(*)::int v from cos_sheets_placement_private.field_reviews'),1);
 assert.equal(await get(db,'select count(*)::int v from cos_sheets_placement_private.field_bindings'),1);
 }finally{await db.close();}});
test('real PostgreSQL concurrent source replacement invalidates an admission waiting for its locks',{skip:!realPostgres},async()=>{const {db,manifest}=await setup();try{
 const writer=await db.connect(),reviewer=await db.connect();const pid=(await reviewer.query('select pg_backend_pid() pid')).rows[0].pid;
 await writer.query('begin');await writer.query("update cos_mhelp_placement_private.upload_control set active_sha256=repeat('d',64)");
 const attempt=reviewer.query('select cos_sheets_placement_private.admit_fields($1,$2)',[JSON.stringify(manifest),'c'.repeat(64)]).then(()=>({ok:true}),error=>({error}));
 try{await waitForLock(db,pid);}finally{await writer.query('commit');}
 assert.equal((await attempt).error?.code,'40001');
 assert.equal(await get(db,'select count(*)::int v from cos_sheets_placement_private.field_reviews'),0);
 assert.equal(await get(db,'select count(*)::int v from cos_sheets_placement_private.field_bindings'),0);
 }finally{await db.close();}});
test('every private extension table/function denies API roles and rollback restores all three RPC definitions and ACLs',async()=>{const {db}=await setup();try{
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await get(db,"select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='cos_sheets_placement_private' and has_function_privilege($1,p.oid,'EXECUTE')) v",[role]),false);
  assert.equal(await get(db,"select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='cos_sheets_placement_private' and c.relname like 'field_%' and c.relkind='r' and has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE')) v",[role]),false);
 }
 const originals=(await db.query('select signature,definition from cos_sheets_placement_private.field_function_backup order by signature')).rows;
 assert.equal(originals.length,3);
 const acls=await Promise.all(originals.map(r=>get(db,'select proacl::text v from pg_proc where oid=$1::regprocedure',[r.signature])));
 await db.exec(rollback);
 for(let i=0;i<originals.length;i++){
  assert.equal(await get(db,'select pg_get_functiondef($1::regprocedure) v',[originals[i].signature]),originals[i].definition);
  assert.equal(await get(db,'select proacl::text v from pg_proc where oid=$1::regprocedure',[originals[i].signature]),acls[i]);
 }
 }finally{await db.close();}});
test('real PostgreSQL source change while stage waits fails closed without partial pending state',{skip:!realPostgres},async()=>{const {db,manifest,fields}=await setup();try{
 await admit(db,manifest);await db.exec('update cos_sheets_placement_private.control set enabled=true');const start=await begin(db),b=start.bindings[0];
 const p=planPublishing([b],[{sheetId:b.sheetId,row:b.row,label:b.label,unique:true,cells:b.baseline,fields}]);
 const writer=await db.connect(),stager=await db.connect();const pid=(await stager.query('select pg_backend_pid() pid')).rows[0].pid;
 await writer.query('begin');await writer.query("update cos_mhelp_placement_private.upload_control set active_sha256=repeat('d',64)");
 const attempt=stager.query('select public.cos_sheets_placement_stage($1,$2)',[start.leaseId,JSON.stringify(p.intents)]).then(()=>({ok:true}),error=>({error}));
 try{await waitForLock(db,pid);}finally{await writer.query('commit');}
 const result=await attempt;assert.equal(result.error?.code,'40001');
 assert.equal(await get(db,'select pending v from cos_sheets_placement_private.field_bindings'),null);
 assert.equal(await get(db,'select pending_cells v from cos_sheets_placement_private.bindings'),null);
 assert.equal(await get(db,'select count(*)::int v from cos_sheets_placement_private.field_audit'),0);
 }finally{await db.close();}});
test('real PostgreSQL stage holds source locks through commit and lease acquisition is exclusive',{skip:!realPostgres},async()=>{const {db,manifest,fields}=await setup();try{
 await admit(db,manifest);await db.exec('update cos_sheets_placement_private.control set enabled=true');const a=await db.connect(),b=await db.connect();
 const leases=await Promise.all([a,b].map(c=>c.query('select public.cos_sheets_placement_begin() v')));const valid=leases.map(r=>r.rows[0].v).filter(v=>v.leaseId);assert.equal(valid.length,1);
 const start=valid[0],binding=start.bindings[0],p=planPublishing([binding],[{sheetId:binding.sheetId,row:binding.row,label:binding.label,unique:true,cells:binding.baseline,fields}]);
 await a.query('begin');await a.query('select public.cos_sheets_placement_stage($1,$2)',[start.leaseId,JSON.stringify(p.intents)]);
 const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
 const update=b.query("update cos_mhelp_placement_private.upload_control set active_sha256=repeat('d',64)").then(()=>({ok:true}),error=>({error}));
 try{await waitForLock(db,pid);}finally{await a.query('commit');}assert.equal((await update).ok,true);
 assert.deepEqual(await get(db,'select pending v from cos_sheets_placement_private.field_bindings'),p.intents[0].fields.cells);
 await assert.rejects(()=>stage(db,start.leaseId,p.intents));
 assert.equal(await get(db,'select count(*)::int v from cos_sheets_placement_private.field_audit'),1);
 }finally{await db.close();}});
test('review-only SQL opts in only fresh exact one-use manifests; denied roles and stale/changed identities cannot admit',async()=>{const {db,manifest}=await setup();try{
 assert.equal(await get(db,'select count(*)::int v from cos_sheets_placement_private.field_bindings'),0);
 for(const mutate of [m=>m.readAt=new Date(Date.now()-121000).toISOString(),m=>m.items[0].location.row=3,m=>m.items[0].fields.index.cells[1].entered.stringValue='124',m=>m.sourceSha256='d'.repeat(64),m=>m.items[0].source.address='Forged',m=>m.items.push(m.items[0])]){const m=structuredClone(manifest);mutate(m);await assert.rejects(()=>admit(db,m));}
 assert.equal(await admit(db,manifest),1);await assert.rejects(()=>admit(db,manifest),/duplicate/);
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(()=>admit(db,manifest));await assert.rejects(()=>db.query('select * from cos_sheets_placement_private.field_bindings'));await db.exec('reset role');}
 }finally{await db.close();}});
test('extended stage/readback is atomic with legacy state, audits intent/readback, recovers exactly and remains idempotent',async()=>{const {db,manifest,fields}=await setup();try{
 await admit(db,manifest);await db.exec('update cos_sheets_placement_private.control set enabled=true');const start=await begin(db),b=start.bindings[0];const row={sheetId:b.sheetId,row:b.row,label:b.label,unique:true,cells:b.baseline,fields};const p=planPublishing([b],[row]);assert.equal(p.intents.length,1);
 await assert.rejects(()=>stage(db,start.leaseId,p.intents.map(({fields,...i})=>i)),/Field/);
 const bad=structuredClone(p.intents);bad[0].fields.cells.index.cells[4].entered.stringValue='ServiceItem_List_20261024000000.csv';await assert.rejects(()=>stage(db,start.leaseId,bad),/Protected/);
 assert.equal((await stage(db,start.leaseId,p.intents)).committed,true);
 const wrongLegacy=structuredClone(p.results);wrongLegacy[0].cells[2].entered.stringValue='Wrong readback';await assert.rejects(()=>finish(db,start.leaseId,wrongLegacy),/readback/);
 assert.deepEqual(await get(db,'select baseline v from cos_sheets_placement_private.field_bindings'),fields);
 await assert.rejects(()=>finish(db,start.leaseId,p.results.map(({fields,...r})=>r)),/readback/);
 assert.deepEqual(await get(db,'select baseline v from cos_sheets_placement_private.field_bindings'),fields);
 await db.query('select public.cos_sheets_placement_fail($1)',[start.leaseId]);await db.exec('update cos_sheets_placement_private.control set last_attempt_at=null');const recover=await begin(db);
 assert.equal((await finish(db,recover.leaseId,p.results.map(r=>({...r,state:'recovered'})))).recovered,1);
 assert.equal(await get(db,'select count(*)::int v from cos_sheets_placement_private.field_audit'),2);
 await db.exec('update cos_sheets_placement_private.control set last_attempt_at=null');const next=await begin(db);const n=next.bindings[0];const unchanged=planPublishing([n],[{...row,cells:n.baseline,fields:n.fields.baseline}]);assert.equal(unchanged.requests.length,0);assert.equal((await finish(db,next.leaseId,unchanged.results)).unchanged,1);
 }finally{await db.close();}});
test('source CAS, native/operational guards, freshness and payload hash block field staging without partial pending state',async()=>{const {db,manifest,fields}=await setup();try{
 await admit(db,manifest);await db.exec('update cos_sheets_placement_private.control set enabled=true');const start=await begin(db),b=start.bindings[0];const p=planPublishing([b],[{sheetId:b.sheetId,row:b.row,label:b.label,unique:true,cells:b.baseline,fields}]);
 for(const sql of ["update cos_mhelp_placement_private.upload_control set active_sha256=repeat('d',64)","update cos_mhelp_placement_private.live_inventory_control set last_success_at=clock_timestamp()-interval '21 minutes'","update cos_mhelp_placement_private.live_inventory_candidates set payload_sha256=repeat('d',64)","insert into cos_operational_private.current_placements values('123')","update app_private.vision_tracker_locations set site='Manual change'","update cos_sheets_placement_private.bindings set row_number=3"]){await db.exec('begin');await db.exec(sql);await assert.rejects(()=>stage(db,start.leaseId,p.intents));await db.exec('rollback');assert.equal(await get(db,'select pending v from cos_sheets_placement_private.field_bindings'),null);}
 }finally{await db.close();}});
test('rollback requires disabled quiescent publisher, preserves audit and exact original function ACL/definition',async()=>{const {db}=await setup();try{
 const before=await get(db,"select definition v from cos_sheets_placement_private.field_function_backup where signature='public.cos_sheets_placement_finish(uuid,jsonb)'");const acl=await get(db,"select proacl::text v from pg_proc where oid='public.cos_sheets_placement_finish(uuid,jsonb)'::regprocedure");
 await db.exec('update cos_sheets_placement_private.control set enabled=true');await assert.rejects(()=>db.exec(rollback),/Quiescent/);await db.exec('rollback');await db.exec('update cos_sheets_placement_private.control set enabled=false');await db.exec(rollback);
 assert.equal(await get(db,"select pg_get_functiondef('public.cos_sheets_placement_finish(uuid,jsonb)'::regprocedure) v"),before);assert.equal(await get(db,"select proacl::text v from pg_proc where oid='public.cos_sheets_placement_finish(uuid,jsonb)'::regprocedure"),acl);
 assert.equal(await get(db,'select count(*)::int v from cos_sheets_placement_private.field_audit'),0);
 }finally{await db.close();}});

test('known service address derives only from matching fresh accepted record; stale/missing/ambiguous evidence cannot invent an address',async()=>{const {db}=await setup();try{
 const receipt=await get(db,'select receipt v from cos_mhelp_placement_private.live_inventory_candidates');
 const r={productId:'123',unitNumber:'Spotter 023.1',customer:'Synthetic Builder: New Job',placement:'FIELD',lifecycle:'UNFLAGGED',holdReason:null,addressReview:null,sourceAddress:{street:'123 Synthetic\nSt',city:'Test City',state:'TX',zip:'00000'},sourceDates:{apiCustomerObservedAt:new Date().toISOString(),apiAddressObservedAt:new Date().toISOString()},apiAssignment:{customerId:'4',serviceLocationId:'5',placementProof:{serviceVerified:true}}};
 await db.query('update cos_mhelp_placement_private.links set observation=$1',[{equipmentId:'123',state:'confirmed',customerId:'4',serviceLocationId:'5',placement:'FIELD',customerLabel:'Synthetic Builder',siteLabel:'New Job'}]);
 const replace=async records=>db.query("update cos_mhelp_placement_private.live_inventory_candidates set records=$1,payload_sha256=encode(sha256(convert_to(jsonb_build_object('receipt',receipt,'records',$1::jsonb)::text,'UTF8')),'hex')",[records]);
 const source=()=>get(db,"select cos_sheets_placement_private.field_source('123',null) v");
 await replace([r]);const good=await source();assert.equal(good.address,'123 Synthetic St, Test City, TX 00000');assert(good.provenanceNote.includes(receipt.receivedAt));assert(!good.provenanceNote.includes('ServiceItem_List'));
 for(const mutate of [x=>x.sourceDates.apiAddressObservedAt=new Date(Date.now()-1210000).toISOString(),x=>x.sourceDates.apiCustomerObservedAt=null,x=>x.sourceDates.apiAddressObservedAt='invalid',x=>x.apiAssignment.serviceLocationId='6',x=>x.lifecycle='MISSING',x=>x.holdReason='identity_changed',x=>x.unitNumber='Spotter 023']){const bad=structuredClone(r);mutate(bad);await replace([bad]);assert.equal(await source(),null);}
 await replace([r,r]);assert.equal(await source(),null);
 for(const mutate of [x=>x.sourceAddress.street='',x=>x.addressReview='ambiguous_service_membership',x=>x.apiAssignment.placementProof.serviceVerified=false]){const unknown=structuredClone(r);mutate(unknown);await replace([unknown]);assert.equal((await source()).address,null);}
 }finally{await db.close();}});

test('install and rollback reject function drift and outstanding writes without losing preserved definitions',async()=>{const {db}=await setup();try{
 await db.exec("update cos_sheets_placement_private.bindings set pending_cells=baseline_cells");await assert.rejects(()=>db.exec(rollback),/Quiescent/);await db.exec('rollback');await db.exec('update cos_sheets_placement_private.bindings set pending_cells=null');
 const original=await get(db,"select pg_get_functiondef('public.cos_sheets_placement_begin()'::regprocedure) v");await db.exec(original.replace("'leaseId',v","'leaseId',v,'newRelease',true"));await assert.rejects(()=>db.exec(rollback),/changed since install/);await db.exec('rollback');
 assert(await get(db,"select to_regclass('cos_sheets_placement_private.field_audit')::text v"));
 }finally{await db.close();}});

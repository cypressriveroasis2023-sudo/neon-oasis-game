import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fixture,reset,seed,ORG,hash,rpc} from './fixtures/geocode-sources-database-fixture.mjs';
let db;
const migration=()=>readFile(new URL('../db/cos-tracker-source-v2.sql',import.meta.url),'utf8');
const admin=async(name,records)=>(await db.query('select app_private.cos_tracker_sources_admin_'+name+'($1,$2) value',[ORG,records])).rows[0].value;
const identity=s=>({entityKind:s.entityKind,nativeUnitId:s.nativeUnitId,sourceSystem:s.sourceSystem,sourceRecordId:s.sourceRecordId,sourceRevision:s.sourceRevision});
const record=(n=1)=>{const id=randomUUID(),full=`Solar Pole 72|${String(n).padStart(3,'0')}`;return {entityKind:'tracker',nativeUnitId:id,trackerId:id,sourceSystem:'google_sheet_tracker',sourceRecordId:`google_sheet:synthetic_sheet_123:12:${full}`,sourceProvenance:{sheetId:'synthetic_sheet_123',tabId:'12',fullIdentity:full,sourceRange:`A${n}:L${n}`},createTracker:true,unitNumber:full.replace('|',' '),trackerUnitNumber:full.replace('|',' '),family:'Solar Pole 72',trackerFamily:'SOLAR POLES & SKIDS',variant:null,sourceFileSha256:hash('synthetic file'),sourceRowSha256:hash(String(n)),installation:{street:'123 Main St',city:'Houston',state:'TX',zip:'77002'},addressSha256:hash('123 main st, houston, tx 77002'),previousSourceRevision:null,placement:'FIELD',siteLabel:'Synthetic site',customerLabel:'Synthetic customer'};};
before(async()=>{db=await fixture();await db.exec('alter table app_private.vision_tracker_locations add column customer text');await db.exec('revoke usage on schema app_private from service_role');for(const f of ['cos-geocode-sources-read-access.sql','cos-geocode-sources-admin-import.sql'])await db.exec(await readFile(new URL('../db/'+f,import.meta.url),'utf8'));await db.exec(await migration());});
after(async()=>db?.close());beforeEach(async()=>reset(db));
test('eight real typed tracker identities share address without ProductIds, cameras or GPS',async()=>{
 const input=Array.from({length:8},(_,i)=>record(i+1)),sources=await admin('import_reviewed',input);assert.equal(sources.length,8);
 for(const s of sources){assert.equal(s.schemaVersion,2);assert.equal(s.sourceSystem,'google_sheet_tracker');assert.equal(Object.hasOwn(s,'productId'),false);assert.equal(Object.hasOwn(s,'sourceProvenance'),false);}
 const changes=await rpc(db,'list_changes',{p_organization_id:ORG,p_after_event_id:'0',p_limit:100});assert.equal(changes.events.length,8);assert.equal(new Set(changes.events.map(x=>x.sourceRecordId)).size,8);
 const batch=await rpc(db,'read_current_batch',{p_organization_id:ORG,p_sources:sources.map(identity)});assert.deepEqual(batch.sources,sources);
 const map=await rpc(db,'map_projection',{p_organization_id:ORG,p_identities:sources.map(s=>({entityKind:s.entityKind,nativeUnitId:s.nativeUnitId}))});assert.equal(map.length,8);assert.equal(map.every(s=>!Object.hasOwn(s,'productId')),true);
 assert.equal((await db.query('select count(*)::integer n from public.equipment_units')).rows[0].n,0);
 assert.equal((await db.query("select count(*)::integer n from app_private.vision_tracker_locations where family='SOLAR POLES & SKIDS'")).rows[0].n,8);
 assert.equal((await db.query('select count(*)::integer n from app_private.vision_tracker_locations where latitude is not null or longitude is not null')).rows[0].n,0);
});
test('V1 remains byte-equivalent JSON and immutable after typed schema migration',async()=>{
 const r=await seed(db);const [s]=(await db.query('select app_private.cos_geocode_sources_admin_import_reviewed($1,$2) value',[ORG,[r]])).rows[0].value;
 assert.equal(s.schemaVersion,1);assert.equal(s.productId,r.productId);assert.equal(Object.hasOwn(s,'sourceRecordId'),false);
 const [t]=await admin('import_reviewed',[record()]);
 assert.deepEqual((await rpc(db,'read_current_batch',{p_organization_id:ORG,p_sources:[{entityKind:s.entityKind,nativeUnitId:s.nativeUnitId,productId:s.productId,sourceRevision:s.sourceRevision},identity(t)]})).sources,[s,t]);
 const events=(await rpc(db,'list_changes',{p_organization_id:ORG,p_after_event_id:'0',p_limit:100})).events;assert.deepEqual(events[0],{eventId:s.eventId,entityKind:s.entityKind,nativeUnitId:s.nativeUnitId,productId:s.productId,sourceRevision:s.sourceRevision,kind:'upsert'});
});
test('duplicate source/target/full label and forged ProductId fail atomically',async()=>{
 const r=record();await assert.rejects(()=>admin('import_reviewed',[{...r,productId:'12345'}]),/Invalid reviewed source/);
 await assert.rejects(()=>admin('import_reviewed',[r,{...record(2),sourceRecordId:r.sourceRecordId}]),/Ambiguous reviewed batch/);
 await admin('import_reviewed',[r]);await assert.rejects(()=>admin('import_reviewed',[record()]),/already exists/);
 await assert.rejects(()=>admin('import_reviewed',[{...record(2),sourceProvenance:{...r.sourceProvenance,sourceRange:'https://secret'}}]),/provenance/);
 assert.equal((await db.query('select count(*)::integer n from app_private.cos_geocode_sources')).rows[0].n,1);
});
test('address revisions, tracker edits and tombstones cancel previous currentness without changing GPS',async()=>{
 const r=record();const [s]=await admin('import_reviewed',[r]);const next={...r,createTracker:false,previousSourceRevision:s.sourceRevision,nativeGuardSha256:s.nativeGuardSha256,installation:{...r.installation,street:'124 Main St'},addressSha256:hash('124 main st, houston, tx 77002')};
 const [changed]=await admin('import_reviewed',[next]);assert.notEqual(s.sourceRevision,changed.sourceRevision);
 assert.deepEqual((await rpc(db,'read_current_batch',{p_organization_id:ORG,p_sources:[identity(s)]})).sources,[null]);
 await db.query("update app_private.vision_tracker_locations set address='125 Main St' where id=$1",[r.trackerId]);
 assert.deepEqual((await rpc(db,'read_current_batch',{p_organization_id:ORG,p_sources:[identity(changed)]})).sources,[null]);
 const events=(await rpc(db,'list_changes',{p_organization_id:ORG,p_after_event_id:'0',p_limit:100})).events;assert.equal(events[0].kind,'tombstone');assert.equal(events[0].sourceRecordId,r.sourceRecordId);
});
test('readers work with service schema USAGE=false; admission is administrator only',async()=>{
 const [s]=await admin('import_reviewed',[record()]);assert.equal((await db.query("select has_schema_privilege('service_role','app_private','USAGE') allowed")).rows[0].allowed,false);
 for(const role of ['anon','authenticated'])await assert.rejects(()=>rpc(db,'list_changes',{p_organization_id:ORG,p_after_event_id:'0',p_limit:100},role),/permission denied/);
 for(const role of ['service_role','anon','authenticated']){await db.exec('set role '+role);try{await assert.rejects(()=>admin('revoke_reviewed',[identity(s)]),/permission denied/);}finally{await db.exec('reset role');}}
 const [gone]=await admin('revoke_reviewed',[identity(s)]);assert.equal(gone.eligibility,'tombstone');assert.equal(Object.hasOwn(gone,'productId'),false);
});
test('additive migration preserves every row/revision/event in a 431-source V1 roster',async()=>{
 const old=await fixture();try{
  const rows=[];for(let i=0;i<431;i++)rows.push(await seed(old,{kind:'tracker',label:`Solar Stand 72 ${i+100}`,product:String(i+10000)}));
  for(let i=0;i<rows.length;i+=250)await rpc(old,'import_reviewed',{p_organization_id:ORG,p_records:rows.slice(i,i+250)});
  const snapshot=async()=>({sources:(await old.query("select jsonb_agg(to_jsonb(s)-'source_system'-'source_record_id'-'source_provenance'-'source_customer_label' order by native_unit_id) v from app_private.cos_geocode_sources s")).rows[0].v,events:(await old.query("select jsonb_agg(to_jsonb(e)-'source_system'-'source_record_id' order by event_id) v from app_private.cos_geocode_source_events e")).rows[0].v,tracker:(await old.query('select jsonb_agg(to_jsonb(t) order by id) v from app_private.vision_tracker_locations t')).rows[0].v,dtos:(await old.query('select jsonb_agg(app_private.cos_source_record(s) order by native_unit_id) v from app_private.cos_geocode_sources s')).rows[0].v});
  const before=await snapshot();for(const f of ['cos-geocode-sources-read-access.sql','cos-geocode-sources-admin-import.sql'])await old.exec(await readFile(new URL('../db/'+f,import.meta.url),'utf8'));
  await old.exec('revoke usage on schema app_private from service_role');await old.exec(await migration());assert.deepEqual(await snapshot(),before);assert.equal(before.sources.length,431);
 }finally{await old.close();}
});

test('tracker target UUID cannot collide with unrelated registered equipment',async()=>{
 const r=record();await db.query("insert into public.equipment_units(id,organization_id,unit_number,status) values($1,$2,'HELIOS 500','available')",[r.nativeUnitId,ORG]);
 await assert.rejects(()=>admin('import_reviewed',[r]),/already exists/);assert.equal((await db.query('select count(*)::integer n from app_private.vision_tracker_locations')).rows[0].n,0);
});

test('a native tracker customer edit invalidates V2 without changing V1 guards',async()=>{
 const r=record();const [s]=await admin('import_reviewed',[r]);await db.query("update app_private.vision_tracker_locations set customer='New synthetic customer' where id=$1",[r.trackerId]);
 assert.deepEqual((await rpc(db,'read_current_batch',{p_organization_id:ORG,p_sources:[identity(s)]})).sources,[null]);
 assert.equal((await db.query('select active from app_private.cos_geocode_sources where native_unit_id=$1',[r.nativeUnitId])).rows[0].active,false);
});

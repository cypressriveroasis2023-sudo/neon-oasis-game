// Shared, generated-data-only proof for PGlite and disposable PostgreSQL.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {smallFixture as originalSmall,representativeFixture as originalRepresentative,candidateSql as optimizedSnapshot,snapshot,org,sha,t,n} from './placement-snapshot-dedup.mjs';
export {snapshot,org,sha,t,n};
export const indexName='cos_equipment_unit_source_label_hash';
export const oldPredicate='app_private.cos_source_label(x.unit_number)';
export const newPredicate="pg_catalog.regexp_replace(pg_catalog.lower(x.unit_number),'[^a-z0-9]','','g')";
export const changedFunctions=new Map([
 ['app_private.cos_source_native_guard(text,uuid,uuid,text,text)',2],
 ['cos_mhelp_placement_private.guard(uuid,uuid)',1]
]);
export const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const sql=async kind=>readFile(new URL(`../../db/mhelp-placement-label-index${kind?'-'+kind:''}.sql`,import.meta.url),'utf8');
export async function smallFixture(db){const f=await originalSmall(db);await f.db.exec(optimizedSnapshot);return f;}
export async function representativeFixture(db){const f=await originalRepresentative(db);await f.db.exec(optimizedSnapshot);return f;}
export const allFunctions=async db=>(await db.query(`select p.oid::regprocedure::text signature,to_jsonb(p)-'prosrc' catalog,p.prosrc body,pg_get_functiondef(p.oid) definition
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private','cos_mhelp_placement_private') order by 1`)).rows;
export const tableSecurity=async db=>(await db.query(`select c.oid::regclass::text relation,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,
 (select jsonb_agg(jsonb_build_object('name',a.attname,'acl',a.attacl) order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) columns,
 (select jsonb_agg(to_jsonb(p) order by p.polname) from pg_policy p where p.polrelid=c.oid) policies
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app_private','cos_mhelp_placement_private') and c.relkind='r' order by 1`)).rows;
export function exactFunctionChange(before,after){
 assert.deepEqual(after.map(({body,definition,...x})=>x),before.map(({body,definition,...x})=>x),'Every user pg_proc field except prosrc must be identical, including OIDs, ACLs and configuration');
 let replacements=0;
 for(let i=0;i<before.length;i++){
  const count=changedFunctions.get(before[i].signature)||0;
  if(count){assert.equal(before[i].body.split(oldPredicate).length-1,count);replacements+=count;}
  const expected=count?before[i].body.replaceAll(oldPredicate,newPredicate):before[i].body;
  assert.equal(after[i].body,expected,`Only approved left-hand predicates may change: ${before[i].signature}`);
  assert.equal(digest(after[i].definition),digest(count?before[i].definition.replaceAll(oldPredicate,newPredicate):before[i].definition));
 }
 assert.equal(replacements,3);
 return {userFunctionCount:before.length,leftHandPredicatesChanged:replacements,allNonBodyCatalogFieldsEqual:true,allOtherBodiesEqual:true};
}
export function snapshotCounts(s){return {items:s.items.length,confirmed:s.items.filter(x=>x.state==='confirmed').length,sourceRecords:s.upload.records.length,trackerRecords:s.upload.trackerRecords.length,sourceCurrent:s.upload.records.filter(x=>x.binding?.guardCurrent).length,trackerCurrent:s.upload.trackerRecords.filter(x=>x.binding?.guardCurrent).length};}
export function representativeCounts(s){
 const counts=snapshotCounts(s);assert.deepEqual(counts,{items:434,confirmed:367,sourceRecords:1001,trackerRecords:810,sourceCurrent:564,trackerCurrent:756});
 assert.equal(s.upload.receivedMessageId,undefined);assert.equal(s.upload.authorizationSha256,undefined);
 assert.equal(s.upload.records[0].binding.reviewEvidence,undefined);assert.equal(s.upload.trackerRecords[0].ownerQuote,undefined);return counts;
}
export async function attempt(db,read){
 await db.exec('savepoint label_index_attempt');
 try{const value=await read();await db.exec('release savepoint label_index_attempt');return {value};}
 catch(e){await db.exec('rollback to savepoint label_index_attempt;release savepoint label_index_attempt');return {error:e.code};}
}
const guards=async db=>(await db.query(`select cos_mhelp_placement_private.guard($1,$2) placement,
 app_private.cos_source_native_guard('equipment_unit',$2,$1,'Spotter 001','Spotter 001') native,
 app_private.cos_source_native_guard('tracker',$3,$3,'Spotter 400','Spotter 400') tracker`,[t(1),n(1),t(400)])).rows;
export async function compare(db,name,mutate=async()=>{},read=()=>snapshot(db),check=()=>{}){
 await db.exec('begin');
 try{
  await mutate();const before=await attempt(db,read),beforeGuards=await guards(db);
  await db.exec(await sql());const after=await attempt(db,read),afterGuards=await guards(db);
  assert.deepEqual(after,before,name);assert.deepEqual(afterGuards,beforeGuards,`${name}: exact guard hashes`);await check(after.value,after);
  return {name,equal:true,error:after.error??null,baselineSha256:digest(before),candidateSha256:digest(after),guardSha256:digest(afterGuards)};
 }finally{await db.exec('rollback');}
}
export async function coordinateFixture(f){
 const db=f.db;
 await db.exec(`update app_private.cos_geocode_sources s set native_guard_sha256=app_private.cos_source_native_guard(s.entity_kind,s.native_unit_id,s.tracker_id,s.unit_number,s.tracker_unit_number)
 where s.native_unit_id in(select native_unit_id from app_private.cos_geocode_sources where entity_kind='equipment_unit' order by native_unit_id limit 16)`);
 const sources=(await db.query(`select s.*,app_private.cos_recorded_coordinate_binding(s.entity_kind,s.native_unit_id,s.tracker_id,s.unit_number,s.tracker_unit_number,s.product_id,s.family) binding
 from app_private.cos_geocode_sources s where entity_kind='equipment_unit' order by native_unit_id limit 16`)).rows;
 for(const s of sources){assert.ok(s.binding);await db.query(`insert into app_private.cos_source_recorded_coordinates(organization_id,entity_kind,native_unit_id,tracker_id,payload) values($1,$2,$3,$4,$5)`,[org,s.entity_kind,s.native_unit_id,s.tracker_id,{unitNumber:s.unit_number,trackerUnitNumber:s.tracker_unit_number,productId:s.product_id,family:s.family,binding:s.binding}]);}
 const ids=sources.map(s=>({entityKind:s.entity_kind,nativeUnitId:s.native_unit_id}));
 const read=async()=>{await db.exec('set role service_role');try{return(await db.query('select public.cos_source_recorded_coordinates_read_many($1,$2) value',[org,ids])).rows[0].value;}finally{await db.exec('reset role');}};
 assert.equal((await read()).length,16);return {read,sources};
}
export async function equivalenceCases(f,record=()=>{}){
 const db=f.db,results=[];
 const run=async(...args)=>{const result=await compare(db,...args);results.push(result);await record(result);};
 await run('unchanged complete snapshot',undefined,undefined,representativeCounts);
 for(const [name,statement,values] of [
  ['Owner history',"insert into public.equipment_unit_location_history values($1,'Synthetic Owner move')",[n(1)]],
  ['Owner identity',"insert into app_private.cos_owner_identity_claims values($1,'Synthetic Owner identity')",[n(1)]],
  ['normalized duplicate native insert',"insert into public.equipment_units(id,organization_id,unit_number,status) values($1,$2,'SPOTTER-001','available')",[n(999),org]],
  ['native label rename',"update public.equipment_units set unit_number='Renamed synthetic' where id=$1",[n(1)]],
  ['native delete','delete from public.equipment_units where id=$1',[n(1)]],
  ['native null label','update public.equipment_units set unit_number=null where id=$1',[n(1)]],
  ['native GPS','update public.equipment_units set gps_latitude=1,gps_longitude=2 where id=$1',[n(1)]],
  ['native status',"update public.equipment_units set status='retired' where id=$1",[n(1)]],
  ['source revision',"update app_private.cos_geocode_sources set street='Changed synthetic street' where tracker_id=$1",[t(1)]],
  ['tracker label',"update app_private.vision_tracker_locations set unit_number='Renamed synthetic' where id=$1",[t(1)]]
 ])await run(name,()=>db.query(statement,values));
 await run('null/mismatched expected guards',async()=>{const records=structuredClone(f.records);records[1].binding={...records[0].binding,expectedGuard:'f'.repeat(64)};records[2].binding={...records[0].binding,expectedGuard:null};await db.query('update cos_mhelp_placement_private.upload_batches set records=$1',[records]);},undefined,s=>{assert.equal(s.upload.records[0].binding.guardCurrent,true);assert.equal(s.upload.records[1].binding.guardCurrent,false);assert.equal(s.upload.records[2].binding.guardCurrent,null);});
 for(const state of ['held','missing'])await run(state+' malformed UUID',async()=>{const receipt=structuredClone(f.receipt);receipt.trackerRecords[0].binding={trackerId:'invalid',nativeUnitId:null,expectedGuard:sha};if(state==='held')receipt.trackerRecords[0].binding.state=state;await db.query('update cos_mhelp_placement_private.upload_batches set receipt=$1',[receipt]);},undefined,(s,r)=>state==='held'?assert.equal(s.upload.trackerRecords[0].binding.guardCurrent,false):assert.equal(r.error,'22P02'));
 await run('JSON-null tracker array',()=>db.exec("update cos_mhelp_placement_private.upload_batches set receipt=jsonb_set(receipt,'{trackerRecords}','null')"),undefined,(_,r)=>assert.equal(r.error,'22023'));
 await run('active pointer null',()=>db.exec('update cos_mhelp_placement_private.upload_control set active_sha256=null'),undefined,s=>assert.equal(s.upload,null));
 const coordinates=await coordinateFixture(f);
 await run('coordinate16 full output equality',undefined,coordinates.read,s=>assert.equal(s.length,16));
 await run('coordinate collision hold',()=>db.query("insert into public.equipment_units(id,organization_id,unit_number,status) values($1,$2,'Spotter 0001','available')",[n(999),org]),coordinates.read);
 await run('coordinate native move hold',()=>db.query("update public.equipment_units set current_location_type='shop' where id=$1",[coordinates.sources[0].native_unit_id]),coordinates.read);
 await run('coordinate source change hold',()=>db.query("update app_private.cos_geocode_sources set street='Changed synthetic' where native_unit_id=$1",[coordinates.sources[0].native_unit_id]),coordinates.read);
 assert.equal(results.length,20);return results;
}
export async function normalizationProof(db){
 const collations=(await db.query(`select collname from pg_collation where collencoding in(-1,6) and collname in ('default','C','POSIX','C.utf8','C.UTF-8','ucs_basic','pg_c_utf8','unicode') order by collname`)).rows;
 const labels=[null,'','Spotter 001','SPOTTER-001','İ 001','I\u0307 001','Straße 1','ß','ẞ','KÅ','１２３','ABC\u200b123','éÉe\u0301','ΩωЖж','A_B/C-D.9'];
 for(const {collname} of collations)for(const label of labels){
  const coll='"'+collname.replaceAll('"','""')+'"';
  const {rows:[r]}=await db.query(`select app_private.cos_source_label($1::text collate ${coll}) original,pg_catalog.regexp_replace(pg_catalog.lower($1::text collate ${coll}),'[^a-z0-9]','','g') expanded`,[label]);assert.equal(r.expanded,r.original);
 }
 return {collations:collations.map(c=>c.collname),samplesPerCollation:labels.length,nullUnicodeAndCollationEqual:true};
}
export async function collisionAndWriterProof(db){
 const keys=['collision143653','collision193481'];
 const hashes=(await db.query('select hashtext($1) a,hashtext($2) b',keys)).rows[0];assert.deepEqual(hashes,{a:-1988777272,b:-1988777272});
 await db.exec(`create table public.synthetic_label_index_probe(id integer primary key,organization_id integer,label text);
 insert into public.synthetic_label_index_probe select i,1,'unrelated'||i from generate_series(1,10000) i;`);
 await db.query('insert into public.synthetic_label_index_probe values(10001,1,$1),(10002,1,$2),(10003,2,$1),(10004,1,upper($1))',keys);
 const expression="pg_catalog.regexp_replace(pg_catalog.lower(label),'[^a-z0-9]','','g')";
 const query=`select id,label from public.synthetic_label_index_probe where organization_id=1 and ${expression}=$1 order by id`;
 const before=(await db.query(query,[keys[0]])).rows;assert.deepEqual(before.map(r=>r.id),[10001,10004]);
 await db.exec(`create index synthetic_label_index_probe_hash on public.synthetic_label_index_probe using hash(${expression});analyze public.synthetic_label_index_probe;`);
 assert.deepEqual((await db.query(query,[keys[0]])).rows,before);
 const plan=(await db.query('explain(analyze,buffers,format json) '+query,[keys[0]])).rows[0]['QUERY PLAN'];
 assert.ok(JSON.stringify(plan).includes('synthetic_label_index_probe_hash'),'Default planner must choose HASH index');
 const plans=[];const collect=node=>{plans.push(node);for(const child of node.Plans||[])collect(child);};collect(plan[0].Plan);
 assert.ok(plans.some(node=>node['Rows Removed by Index Recheck']>0),'Real distinct-key hash collision must be rejected by an equality recheck');
 await db.exec(`insert into public.synthetic_label_index_probe values(10005,1,''),(10006,1,''),(10007,1,null),
 (10008,1,'A'||repeat('9',140000));update public.synthetic_label_index_probe set label='B'||repeat('8',140000) where id=10008;`);
 assert.equal((await db.query('select length(label) n from public.synthetic_label_index_probe where id=10008')).rows[0].n,140001);
 await db.exec(`delete from public.synthetic_label_index_probe where id=10008;
 insert into public.synthetic_label_index_probe select 10008,1,string_agg(md5(i::text),'') from generate_series(1,6000) i;
 update public.synthetic_label_index_probe set label=label||'next' where id=10008;`);
 assert.equal((await db.query('select length(label) n from public.synthetic_label_index_probe where id=10008')).rows[0].n,192004);
 await db.exec(`create role synthetic_label_index_writer;grant select,insert,update,delete on public.synthetic_label_index_probe to synthetic_label_index_writer;
 alter table public.synthetic_label_index_probe enable row level security;
 create policy synthetic_label_index_write on public.synthetic_label_index_probe for all to synthetic_label_index_writer using(true) with check(true);
 set role synthetic_label_index_writer;`);
 try{
  await assert.rejects(()=>db.query("select app_private.cos_source_label('writer001')"),e=>e.code==='42501');
  await db.exec(`insert into public.synthetic_label_index_probe values(10009,1,'Writer');update public.synthetic_label_index_probe set label='WRITER-002' where id=10009;delete from public.synthetic_label_index_probe where id=10009;`);
 }finally{await db.exec('reset role');}
 return {keys,hash:hashes.a,defaultPlannerUsesHash:true,collisionRechecked:true,normalizedDuplicateCount:2,distinctKeyAndOtherOrganizationRejected:true,longTextWriteLengths:[140001,192004],nullAndBlankDuplicatesAllowed:true,privateHelperDenied:'42501',builtinsWriterAndRlsWork:true,plan};
}

// Each committed mutation targets a distinct identity. Native-trigger invalidations persist.
export const mutationCases=[
 {name:'Owner history',target:1,statement:"insert into public.equipment_unit_location_history values($1,'Synthetic concurrent Owner move')",values:[n(1)]},
 {name:'Owner identity',target:2,statement:"insert into app_private.cos_owner_identity_claims values($1,'Synthetic concurrent Owner identity')",values:[n(2)]},
 {name:'native normalized duplicate insert',target:3,statement:"insert into public.equipment_units(id,organization_id,unit_number,status) values($1,$2,'SPOTTER-003','available')",values:[n(999),org]},
 {name:'native rename',target:4,statement:"update public.equipment_units set unit_number='Renamed synthetic' where id=$1",values:[n(4)]},
 {name:'native GPS',target:5,statement:'update public.equipment_units set gps_latitude=1,gps_longitude=2 where id=$1',values:[n(5)]},
 {name:'native delete',target:6,statement:'delete from public.equipment_units where id=$1',values:[n(6)]}
];
export function assertMutationHeld(value,target){
 assert.equal(value.upload.records.find(r=>r.binding?.nativeUnitId===n(target)).binding.guardCurrent,false);
 assert.equal(value.upload.trackerRecords.find(r=>r.binding?.nativeUnitId===n(target)).binding.guardCurrent,false);
 assert.equal(value.items.find(r=>r.nativeUnitId===n(target)).state,'held');
}
// Call only in the in-memory fixture or the URL-guarded, synthetic-only PostgreSQL service.
export async function rebuildDisposableFixture(db){
 await db.exec('drop schema cos_mhelp_placement_private cascade;drop schema app_private cascade;drop schema public cascade;create schema public authorization pg_database_owner;grant usage on schema public to public;drop role anon;drop role authenticated;drop role service_role');
 return representativeFixture(db);
}

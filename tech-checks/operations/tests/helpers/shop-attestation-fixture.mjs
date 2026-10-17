import {fixture as ownerFixture,org,hash} from '../fixtures/owner-identity-upload-fixture.mjs';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
export const legacyActor='05bf20fe-19f7-4db7-ac05-5b2a5f681fdf';
export async function shopFixture({real=Boolean(process.env.COS_HANDOFF_TEST_DATABASE_URL),install=true}={}){
 let db,admin,pg,connection,database;
 if(real){
  const url=new URL(process.env.COS_HANDOFF_TEST_DATABASE_URL);
  if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/^\/cos_handoff_test_[a-z0-9_]+$/.test(url.pathname)||url.search||url.hash)throw Error('Disposable loopback handoff database required.');
  pg=(await import('../../legacy/tests/recon-ordering/node_modules/pg/lib/index.js')).default;connection=url.href;database=url.pathname.slice(1);url.pathname='/postgres';admin=new pg.Client({connectionString:url.href});await admin.connect();await admin.query('create database '+database);db=new pg.Client({connectionString:connection});await db.connect();const query=db.query.bind(db);db.query=(sql,values)=>query(sql,values?.map(v=>Array.isArray(v)?JSON.stringify(v):v));db.exec=sql=>db.query(sql);
 }
 async function close(){if(admin){await db?.end();await admin.query('drop database '+database);for(const role of ['anon','authenticated','service_role'])await admin.query('drop role if exists '+role);await admin.end();}else await db?.close();}
 try{
 const f=await ownerFixture({database:db});db=f.db;
 // Reproduce the live reader's optimization prerequisites as well as its exact
 // captured definitions. All records, users and provider IDs remain synthetic.
 await db.exec('alter table app_private.cos_archived_representations add column id uuid primary key default gen_random_uuid();alter table app_private.cos_geocode_sources add primary key(native_unit_id);');
 const readers=JSON.parse(await readFile(new URL('../fixtures/shop-attestation-readers-20261017.json',import.meta.url),'utf8'));
 for(const row of readers.filter(r=>r.schema==='cos_mhelp_placement_private'))await db.exec(row.definition);
 const migration=await readFile(new URL('../../db/techcheck-shop-attestation-v1.sql',import.meta.url),'utf8');
 await db.exec('alter default privileges in schema public grant execute on functions to authenticated,service_role');
 const functionCatalog="select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition,p.proacl::text acl,p.proowner::regrole::text owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private','cos_mhelp_placement_private') order by 1,2,3";
 const beforeFunctions=(await db.query(functionCatalog)).rows;
 if(install)await db.exec(migration);
 let counter=300;
 async function addUnit({family='Sniper',tag='001',native=true}={}){
  const tracker=randomUUID(),nativeId=native?randomUUID():null,revision=randomUUID(),product=String(counter++),label=family+' '+tag;
  if(native)await db.query("insert into equipment_units(id,organization_id,unit_number,status) values($1,$2,$3,'available')",[nativeId,org,label]);
  await db.query("insert into app_private.vision_tracker_locations(id,organization_id,unit_number,unit_key,family,placement,customer,site) values($1,$2,$3,$4,$5,'SHOP','Cameras Onsite LLC','Shop')",[tracker,org,label,label.toLowerCase().replaceAll(' ',''),family]);
  await db.query("insert into app_private.cos_geocode_sources(tracker_id,entity_kind,native_unit_id,product_id,source_system,source_revision,unit_number,tracker_unit_number,active) values($1,$2,$3,$4,'mhelpdesk_product_import',$5,$6,$6,true)",[tracker,native?'equipment_unit':'tracker',nativeId||tracker,product,revision,label]);
  const guard=(await db.query('select cos_mhelp_placement_private.guard($1,$2) v',[tracker,nativeId])).rows[0].v;
  await db.query("insert into cos_mhelp_placement_private.links(equipment_id,tracker_id,native_unit_id,tracker_label,native_label,full_label,source_revision,baseline_guard,baseline_customer_id,baseline_location_id,authorization_sha256,observation,observed_at) values($1,$2,$3,$4,$5,$4,$6,$7,'11',null,$8,jsonb_build_object('equipmentId',$1::text,'state','confirmed','placement','SHOP','customerId','11','serviceLocationId',null,'customerLabel','Cameras Onsite LLC','siteLabel','Shop'),statement_timestamp()-interval '1 minute')",[product,tracker,nativeId,label,nativeId?label:null,revision,guard,hash]);
  const graph=(await db.query('select cos_mhelp_placement_private.upload_binding_guard($1,$2) v',[tracker,nativeId])).rows[0].v;
  const record={productId:product,unitNumber:label,category:family,customerId:'11',customer:'Cameras Onsite LLC',placement:'SHOP',lifecycle:'UNFLAGGED',sourceAddress:{},sourceRow:counter,binding:{productId:product,trackerId:tracker,nativeUnitId:nativeId,trackerLabel:label,nativeLabel:nativeId?label:null,fullLabel:label,matchMethod:'reviewed_product_id',representedUnitIds:[nativeId||tracker],representationEvidenceSha256:hash,evidenceSha256:hash,expectedGuard:graph}};
  const current=(await db.query('select active_sha256 v from cos_mhelp_placement_private.upload_control where singleton')).rows[0].v;
  const old=(await db.query('select records from cos_mhelp_placement_private.upload_batches where source_sha256=$1',[current])).rows[0].records;
  const records=[...old,record],sha=String(counter).padStart(64,'0');
  // Existing unrelated record guards can be stale; the real upload admission
  // kernel rejects re-baselining them, so seed this immutable synthetic batch
  // directly. The production reader and all guard functions are still real SQL.
  await db.query('insert into cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records) values($1,$1,$2,$3)',[sha,{...f.receipt,sourceSha256:sha,recordCount:records.length},records]);
  await db.query('update cos_mhelp_placement_private.upload_control set active_sha256=$1 where singleton',[sha]);
  await db.exec("update cos_mhelp_placement_private.control set enabled=true,last_success_at=statement_timestamp(),error_code=null");
  return {item:{equipment_key:family.toLowerCase()+':'+tag,family,unit_tag:tag},tracker,nativeId,revision,product,record};
 }
 const unit=await addUnit();
 const args=(items=[unit.item],extra={})=>({p_legacy_actor_id:legacyActor,p_request_id:randomUUID(),p_purpose:'checkout',p_items:items,...extra});
 const attest=async(p=args())=>(await db.query('select public.cos_techcheck_shop_attestation_v1($1,$2,$3,$4) v',Object.values(p))).rows[0].v;
 const snapshot=async()=>{
  const relations=(await db.query("select quote_ident(n.nspname)||'.'||quote_ident(c.relname) name from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in('public','app_private','cos_mhelp_placement_private') order by 1")).rows;
  const result={};for(const {name} of relations)result[name]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) v from ${name} x`)).rows[0].v;return result;
 };
 return {...f,db,pg,connection,unit,addUnit,args,attest,snapshot,migration,readers,functionCatalog,beforeFunctions,close};
 }catch(error){await close();throw error;}
}

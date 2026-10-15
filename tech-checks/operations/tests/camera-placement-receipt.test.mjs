// PGlite in-process only: no listener, no HTTP, no customer rows, no production SQL.
import test from 'node:test';
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {representativeFixture,allFunctions,tableSecurity,representativeCounts,snapshot,org,t,n,sql} from './fixtures/placement-label-index.mjs';
const dir=fileURLToPath(new URL('./hosted-camera-receipt-proof',import.meta.url));
test('camera-only placement preserves consumed guards, role fences, table data and exact rollback',async()=>{
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),report={execution:'PGlite in-process; entirely generated records',cases:[],acl:[],uploadOnlyErrorChanges:[],workCounts:null};
const f=await representativeFixture(),db=f.db;
try{
 await db.exec(await sql());
 const fullSql=(await db.query("select pg_get_functiondef('public.cos_mhelp_placement_snapshot(uuid,uuid)'::regprocedure) value")).rows[0].value;
 assert.equal(createHash('sha256').update(fullSql).digest('hex'),'95a859becc87439d9fd5ab66ed238644b73193ce9fea1d25d15f594bb17d7de9');
 const dataState=async()=>{const tables=(await db.query("select quote_ident(n.nspname)||'.'||quote_ident(c.relname) relation from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private','cos_mhelp_placement_private') and c.relkind='r' order by 1")).rows;const values=[];for(const {relation}of tables)values.push({relation,rows:(await db.query("select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) rows from "+relation+' t')).rows[0].rows});return digest(values);};
 const before=await allFunctions(db),security=await tableSecurity(db),dataBefore=await dataState(),fullBefore=await snapshot(db);report.population=representativeCounts(fullBefore);
 await db.exec(fs.readFileSync(dir+'/candidate-overload.sql','utf8'));
 const after=await allFunctions(db);assert.deepEqual(after.filter(x=>x.signature!=='cos_mhelp_placement_snapshot(uuid,uuid,text)'),before);assert.deepEqual(await tableSecurity(db),security);assert.deepEqual(await snapshot(db),fullBefore);
 const slim=async(actor=t(1),organization=org,projection='camera')=>(await db.query('select public.cos_mhelp_placement_snapshot($1,$2,$3) value',[actor,organization,projection])).rows[0].value;
 const full=async(actor=t(1),organization=org)=>(await db.query('select public.cos_mhelp_placement_snapshot($1,$2) value',[actor,organization])).rows[0].value;
 const project=v=>v===null?null:Object.fromEntries(Object.entries(v).filter(([k])=>k!=='upload'));
 const attempt=async fn=>{await db.exec('savepoint attempt');try{const value=await fn();await db.exec('release savepoint attempt');return {value};}catch(e){await db.exec('rollback to savepoint attempt;release savepoint attempt');return {error:{code:e.code,message:e.message}};}};
 async function compare(name,mutate=async()=>{},readFull=full,readSlim=slim,check=()=>{}){await db.exec('begin');try{await mutate();const b=await attempt(readFull),c=await attempt(readSlim);if(Object.hasOwn(b,'value'))b.value=project(b.value);assert.deepEqual(c,b,name);await check(c);report.cases.push({name,equal:true,error:c.error??null,receiptSha256:digest(c)});}finally{await db.exec('rollback');}}
 await compare('434 complete guarded links and every status field',undefined,undefined,undefined,r=>{assert.equal(r.value.items.length,434);assert.equal(r.value.items.filter(x=>x.state==='confirmed').length,367);assert.deepEqual(r.value.items.map(x=>x.trackerId),r.value.items.map(x=>x.trackerId).sort());assert(!('upload'in r.value));});
 for(const [name,statement,params]of [
 ['Owner history invalidates link',"insert into public.equipment_unit_location_history values($1,'Synthetic move')",[n(1)]],
 ['Owner identity invalidates link',"insert into app_private.cos_owner_identity_claims values($1,'Synthetic identity')",[n(1)]],
 ['duplicate normalized native invalidates',"insert into public.equipment_units(id,organization_id,unit_number,status) values($1,$2,'SPOTTER-001','available')",[n(999),org]],
 ['native rename',"update public.equipment_units set unit_number='Changed synthetic' where id=$1",[n(1)]],
 ['native delete','delete from public.equipment_units where id=$1',[n(1)]],
 ['native null label','update public.equipment_units set unit_number=null where id=$1',[n(1)]],
 ['native GPS','update public.equipment_units set gps_latitude=1,gps_longitude=2 where id=$1',[n(1)]],
 ['native retired',"update public.equipment_units set status='retired' where id=$1",[n(1)]],
 ['source revision',"update app_private.cos_geocode_sources set street='Changed synthetic' where tracker_id=$1",[t(1)]],
 ['tracker rename',"update app_private.vision_tracker_locations set unit_number='Changed synthetic' where id=$1",[t(1)]],
 ['baseline guard changed',"update cos_mhelp_placement_private.links set baseline_guard=repeat('f',64) where tracker_id=$1",[t(1)]],
 ['held observation reason',"update cos_mhelp_placement_private.links set observation=observation||'{\"state\":\"held\",\"reason\":\"service_location_read_timeout\"}' where tracker_id=$1",[t(1)]],
 ['null observation data',"update cos_mhelp_placement_private.links set observation='null' where tracker_id=$1",[t(1)]],
 ['assignment change and timestamp',"update cos_mhelp_placement_private.links set observation=observation||'{\"customerId\":\"900\",\"serviceLocationId\":\"999\"}',observed_at='2026-01-02T01:02:03+00' where tracker_id=$1",[t(1)]],
 ['disabled receipt',"update cos_mhelp_placement_private.control set enabled=false",[]],
 ['status error timestamps',"update cos_mhelp_placement_private.control set error_code='SYNTHETIC',last_attempt_at='2026-01-02T01:02:03Z',last_success_at='2026-01-01T12:00:00Z'",[]],
 ['missing status row returns null','delete from cos_mhelp_placement_private.control',[]],
 ['no links','delete from cos_mhelp_placement_private.links',[]],
 ['active upload null','update cos_mhelp_placement_private.upload_control set active_sha256=null',[]]
 ])await compare(name,()=>db.query(statement,params));
 // Shared actor helper and equipment gate execute identically before the unchanged checked-link query.
 await compare('actor denial',()=>db.exec("create or replace function app_private.appdeploy_assume_actor(uuid,uuid) returns void language plpgsql as $$begin raise exception 'Synthetic actor denied' using errcode='42501';end$$"));
 await compare('equipment permission denied',()=>db.exec('create or replace function app_private.has_permission(uuid,text) returns boolean language sql as $$select false$$'));
 await compare('wrong organization',undefined,()=>full(t(1),n(1)),()=>slim(t(1),n(1)));
 await compare('opaque status and backoff fields copied intact',()=>db.exec(`create or replace function public.cos_mhelp_placement_status() returns jsonb language sql security definer set search_path='' as $$ select '{"contract":"COS_MHELP_PLACEMENT_V1","enabled":true,"lastSuccessAt":"2026-01-01T12:00:00Z","lastAttemptAt":"2026-01-02T12:00:00Z","errorCode":"SYNTHETIC","readBackoff":{"retryAt":"2026-01-03T12:00:00Z","reason":"synthetic"},"newOpaqueStatus":{"x":[null,1,false]}}'::jsonb $$`));
 await compare('status function throws',()=>db.exec("create or replace function public.cos_mhelp_placement_status() returns jsonb language plpgsql security definer set search_path='' as $$begin raise exception 'Synthetic status unavailable' using errcode='XX001';end$$"));
 await compare('link guard throws',()=>db.exec("create or replace function cos_mhelp_placement_private.guard(p_tracker uuid,p_native uuid) returns text language plpgsql stable set search_path='' as $$begin raise exception 'Synthetic consumed guard failure' using errcode='22P02';end$$"));
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('begin;set role '+role);try{const a=await attempt(()=>full()),b=await attempt(()=>slim());if(role==='service_role'){assert.deepEqual(b.value,project(a.value));report.acl.push({role,full:'allowed',camera:'allowed'});}else{assert.equal(a.error.code,'42501');assert.equal(b.error.code,'42501');report.acl.push({role,full:'42501',camera:'42501'});}}finally{await db.exec('rollback');}
 }
 const added=after.find(x=>x.signature==='cos_mhelp_placement_snapshot(uuid,uuid,text)');report.overloadDefinitionSha256=createHash('sha256').update(added.definition).digest('hex');
 const catalog=(await db.query("select proowner::regrole::text owner,proacl::text acl,prosecdef security_definer,proargnames names,pronargs args,pronargdefaults defaults,proconfig settings from pg_proc where oid='public.cos_mhelp_placement_snapshot(uuid,uuid,text)'::regprocedure")).rows[0];assert.equal(catalog.defaults,0);assert.equal(catalog.owner,'postgres');assert.equal(catalog.security_definer,true);assert.equal(catalog.acl,'{postgres=X/postgres,service_role=X/postgres}');assert.deepEqual(catalog.settings,['search_path=""']);report.overloadCatalog=catalog;
 for(const projection of [null,'all','', 'CAMERA']){await db.exec('begin');try{const result=await attempt(()=>slim(t(1),org,projection));assert.equal(result.error.code,'22023');report.cases.push({name:'reject unsupported selector '+JSON.stringify(projection),equal:'new-contract-only',error:result.error});}finally{await db.exec('rollback');}}
 for(const [name,mutate]of [
 ['upload malformed linked tracker UUID',async()=>{const receipt=structuredClone(f.receipt);receipt.trackerRecords[0].binding.trackerId='invalid';await db.query('update cos_mhelp_placement_private.upload_batches set receipt=$1',[receipt]);}],
 ['upload JSON-null tracker array',()=>db.exec("update cos_mhelp_placement_private.upload_batches set receipt=jsonb_set(receipt,'{trackerRecords}','null')")],
 ['upload function failure',()=>db.exec("create or replace function cos_mhelp_placement_private.upload_snapshot() returns jsonb language plpgsql stable set search_path='' as $$begin raise exception 'Synthetic unused upload failure' using errcode='XX002';end$$")]
 ]){await db.exec('begin');try{await mutate();const b=await attempt(()=>full()),c=await attempt(()=>slim());assert(b.error);assert(c.value);assert.deepEqual(c.value,project(fullBefore));report.uploadOnlyErrorChanges.push({name,fullError:b.error,slim:'status/items unchanged; success',intentionalDependencyRemoval:true});}finally{await db.exec('rollback');}}
 // Count actual function evaluations using private disposable sequence probes only.
 await db.exec('begin');try{
  for(const [name,args]of [['guard','p_tracker uuid, p_native uuid'],['continuity_current','t uuid, n uuid, original text']]){
   const signature=name==='guard'?'uuid,uuid':'uuid,uuid,text',original=(await db.query(`select pg_get_functiondef('cos_mhelp_placement_private.${name}(${signature})'::regprocedure) definition`)).rows[0].definition;
   await db.exec(original.replace('FUNCTION cos_mhelp_placement_private.'+name+'(','FUNCTION cos_mhelp_placement_private.probe_original_'+name+'('));
   const invocation=name==='guard'?'p_tracker,p_native':'t,n,original',returns=name==='guard'?'text':'boolean';
   await db.exec(`create sequence cos_mhelp_placement_private.probe_${name};create or replace function cos_mhelp_placement_private.${name}(${args}) returns ${returns} language plpgsql stable set search_path='' as $$begin perform nextval('cos_mhelp_placement_private.probe_${name}'::regclass);return cos_mhelp_placement_private.probe_original_${name}(${invocation});end$$;`);
  }
  const counts=async read=>{await db.exec("alter sequence cos_mhelp_placement_private.probe_guard restart with 1;alter sequence cos_mhelp_placement_private.probe_continuity_current restart with 1");await read();return(await db.query('select (select case when is_called then last_value else 0 end from cos_mhelp_placement_private.probe_guard)::int linkGuards,(select case when is_called then last_value else 0 end from cos_mhelp_placement_private.probe_continuity_current)::int uploadGraphs')).rows[0];};
  const fullCounts=await counts(full),slimCounts=await counts(slim);assert.equal(fullCounts.linkguards,434);assert.equal(slimCounts.linkguards,434);assert.equal(fullCounts.uploadgraphs,770);assert.equal(slimCounts.uploadgraphs,0);report.workCounts={full:fullCounts,camera:slimCounts};
 }finally{await db.exec('rollback');}
 assert.deepEqual(await allFunctions(db),after);assert.deepEqual(await tableSecurity(db),security);report.existingFunctionsAndTablesUnchanged=true;assert.equal(await dataState(),dataBefore);report.tableDataUnchanged=true;
 await db.exec('begin');try{await assert.rejects(()=>db.exec(fs.readFileSync(dir+'/candidate-overload.sql','utf8')),e=>e.code==='55000');}finally{await db.exec('rollback');}
 const rollback=fs.readFileSync(dir+'/candidate-overload-rollback.sql','utf8');await db.exec(rollback);assert.deepEqual(await allFunctions(db),before);assert.deepEqual(await tableSecurity(db),security);assert.equal(await dataState(),dataBefore);await db.exec(rollback);report.rollbackExactAndRepeatable=true;
 assert.equal(report.cases.length,30);assert.equal(report.uploadOnlyErrorChanges.length,3);assert.equal(report.rollbackExactAndRepeatable,true);
}finally{await db.close();}

});

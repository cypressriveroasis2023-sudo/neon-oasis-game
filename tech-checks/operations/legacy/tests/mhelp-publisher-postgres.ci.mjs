/** Existing fixed-loopback, ephemeral-CI guard; never accepts a production URL. */
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {assertCiContext,validateIsolatedServer,parameters,openPsql} from './mhelp-postgres-concurrency.ci.mjs';
import {schema} from '../../tests/fixtures/mhelp-placement-schema.mjs';
assertCiContext();
const exec=sql=>openPsql(sql).done;
const query=async(sql,args=[])=>JSON.parse((await exec("select coalesce(json_agg(row_to_json(x)),'[]'::json) from ("+parameters(sql,args)+") x;")).trim());
validateIsolatedServer((await query('select current_database() database,current_user account,inet_server_port() port'))[0]);
await exec('create role anon;create role authenticated;create role service_role;'+schema);
for(const file of ['20261012173408_cos_mhelp_placement_sync.sql','20261012184453_cos_sheets_placement_publisher.sql'])await exec(await readFile(new URL('../../db/'+file,import.meta.url),'utf8'));
const tracker='22222222-2222-4222-8222-222222222222',revision='33333333-3333-4333-8333-333333333333',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
await exec(parameters("insert into app_private.vision_tracker_locations values($1,$2,'Spotter 023.1','spotter0231','SPOTTERS','FIELD','Synthetic Builder','Synthetic Job','Historical address',30,-95);insert into app_private.cos_geocode_sources values($1,'tracker',$1,'123','mhelpdesk_product_import',$3,'Spotter 023.1','Spotter 023.1',true);",[tracker,org,revision]));
const guard=(await query('select cos_mhelp_placement_private.guard($1,null) value',[tracker]))[0].value;
const link={equipmentId:'123',trackerId:tracker,nativeUnitId:null,trackerLabel:'Spotter 023.1',nativeLabel:null,fullLabel:'Spotter 023.1',model:null,sourceRevision:revision,expectedGuard:guard,customerId:'2',serviceLocationId:'3',placement:'FIELD',customerLabel:'Synthetic Builder',siteLabel:'Synthetic Job'};
await exec(parameters('select cos_mhelp_placement_private.admit($1::jsonb,$2);',[JSON.stringify([link]),'a'.repeat(64)]));
const cells=['Spotter 023.1','FIELD','Synthetic Builder','Synthetic Job'].map(s=>({entered:{stringValue:s},validation:null,rich:false}));
await exec(parameters('select cos_sheets_placement_private.admit($1::jsonb,$2);',[JSON.stringify([{equipmentId:'123',sheetId:2017346590,row:2,label:'Spotter 023.1',cells}]),'b'.repeat(64)]));
await exec(`create schema cos_operational_private;create table cos_operational_private.current_placements(product_id text primary key);
 create function cos_mhelp_placement_private.upload_snapshot() returns jsonb language sql as $$select '{}'::jsonb$$;
 update cos_mhelp_placement_private.links set observation='{"state":"confirmed"}',observed_at=clock_timestamp()-interval '2 hours';
 update cos_sheets_placement_private.control set enabled=true;`);
const before=await query('select observed_at from cos_mhelp_placement_private.links');
const acl=await query("select proacl::text from pg_proc where oid='public.cos_sheets_placement_finish(uuid,jsonb)'::regprocedure");
const prior=(await query("select pg_get_functiondef('public.cos_sheets_placement_finish(uuid,jsonb)'::regprocedure) definition"))[0].definition;
await exec(await readFile(new URL('../../db/mhelp-publisher-freshness.sql',import.meta.url),'utf8'));
await exec(prior);
await exec(await readFile(new URL('../../db/mhelp-publisher-refresh-safe-cleanup.sql',import.meta.url),'utf8'));
const repaired=(await query("select pg_get_functiondef('public.cos_sheets_placement_finish(uuid,jsonb)'::regprocedure) definition"))[0].definition;
assert.match(repaired,/delete from cos_sheets_placement_private\.refresh_requests where equipment_id=any\(seen\)/);
assert.doesNotMatch(repaired,/delete from cos_sheets_placement_private\.refresh_requests\s*;/);
assert.deepEqual(await query("select proacl::text from pg_proc where oid='public.cos_sheets_placement_finish(uuid,jsonb)'::regprocedure"),acl);
const lease=(await query('select public.cos_sheets_placement_begin() value'))[0].value.leaseId;
const finish=parameters('select public.cos_sheets_placement_finish($1,$2::jsonb);',[lease,JSON.stringify([{equipmentId:'123',state:'held',reason:'source_refresh_requested'}])]);
const first=openPsql('begin;'+finish,{held:true,application:'publisher-first'});let second;
try{
 await first.ready;second=openPsql('begin;'+finish+'commit;',{application:'publisher-second'});
 let blocked=false;for(let i=0;i<40;i++){if((await query("select wait_event_type from pg_stat_activity where application_name='publisher-second'")).some(x=>x.wait_event_type==='Lock')){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}
 assert(blocked,'concurrent publisher must wait for lease transaction');
 assert.match(await first.release(),/"committed": true/);assert.match(await second.done,/"committed": false/);
}finally{await first.release().catch(()=>first.abort());if(second)await second.done.catch(()=>second.abort());}
assert.deepEqual((await query('select public.cos_mhelp_inventory_baseline() value'))[0].value.publisherRefreshEquipmentIds,['123']);
assert.deepEqual(await query('select observed_at from cos_mhelp_placement_private.links'),before);
await exec("insert into cos_operational_private.current_placements values('123')");
assert.deepEqual((await query('select public.cos_mhelp_inventory_baseline() value'))[0].value.publisherRefreshEquipmentIds,[]);
await exec("delete from cos_operational_private.current_placements;update cos_sheets_placement_private.refresh_requests set requested_at=clock_timestamp()-interval '3 hours'");
assert.deepEqual((await query('select public.cos_mhelp_inventory_baseline() value'))[0].value.publisherRefreshEquipmentIds,[]);
for(const role of ['anon','authenticated','service_role'])assert.equal((await query("select has_table_privilege($1,'cos_sheets_placement_private.refresh_requests','select,insert,update,delete') allowed",[role]))[0].allowed,false);
console.log('PASS: real PostgreSQL concurrent finish, unchanged source clocks/ACLs, operational override, expiry, private queue');

// Review-only mechanism: isolated PostgreSQL concurrency/ACL gate, never production.
await exec(`create table cos_mhelp_placement_private.live_inventory_control(singleton boolean,enabled boolean,error_code text,active_source_sha256 text);
 create table cos_mhelp_placement_private.live_inventory_candidates(source_sha256 text primary key,records jsonb);
 update cos_mhelp_placement_private.control set enabled=true,last_success_at=clock_timestamp();`);
const reviewSource='d'.repeat(64),reviewAuthorization='e'.repeat(64);
const observation={equipmentId:'123',state:'confirmed',customerId:'2',serviceLocationId:'3',placement:'FIELD',customerLabel:'Synthetic Builder',siteLabel:'Synthetic Job'};
await exec(parameters('update cos_mhelp_placement_private.links set observation=$1::jsonb,observed_at=clock_timestamp();insert into cos_mhelp_placement_private.live_inventory_control values(true,true,null,$2);insert into cos_mhelp_placement_private.live_inventory_candidates values($2,$3::jsonb);',[JSON.stringify(observation),reviewSource,JSON.stringify([{productId:'123',holdReason:null}])]));
const stageAcl=await query("select proacl::text from pg_proc where oid='public.cos_sheets_placement_stage(uuid,jsonb)'::regprocedure");
await exec(await readFile(new URL('../../db/mhelp-publisher-reviewed-bindings.sql',import.meta.url),'utf8'));
assert.deepEqual(await query("select proacl::text from pg_proc where oid='public.cos_sheets_placement_stage(uuid,jsonb)'::regprocedure"),stageAcl);
const current={sheetId:2017346590,row:2,label:'Spotter 023.1',cells,customerStyle:'plain'};
const target={...current,row:3,customerStyle:'combined',cells:cells.map((c,i)=>i===2?{...c,entered:{stringValue:'Synthetic Builder: Synthetic Job'}}:c)};
const repairSql=parameters('select cos_sheets_placement_private.repair_bindings($1::jsonb,$2,clock_timestamp(),$3);',[JSON.stringify([{equipmentId:'123',before:current,after:target,observation}]),reviewSource,reviewAuthorization]);
const nativeBefore=await query('select to_jsonb(t) value from app_private.vision_tracker_locations t');
const repairFirst=openPsql('begin;'+repairSql,{held:true,application:'review-first'});
try{
 await repairFirst.ready;
 const repairSecond=openPsql('begin;'+repairSql+'commit;',{application:'review-second'});
 await assert.rejects(repairSecond.done,/lock|ERROR/);
 await repairFirst.release();
}finally{await repairFirst.release().catch(()=>repairFirst.abort());}
assert.deepEqual(await query('select to_jsonb(t) value from app_private.vision_tracker_locations t'),nativeBefore);
assert.equal((await query('select count(*)::int n from cos_sheets_placement_private.binding_reviews'))[0].n,1);
assert.equal((await query('select row_number from cos_sheets_placement_private.bindings'))[0].row_number,3);
await assert.rejects(exec(repairSql),/changed|ERROR/);
for(const role of ['anon','authenticated','service_role'])assert.equal((await query("select has_function_privilege($1,'cos_sheets_placement_private.repair_bindings(jsonb,text,timestamptz,text)','execute') allowed",[role]))[0].allowed,false);
console.log('PASS: real PostgreSQL reviewed repair serialization, one-use audit, native preservation and private ACLs');
const plainCells=['Synthetic Unit','FIELD','Builder: Division','Division'].map(s=>({entered:{stringValue:s},validation:null,rich:false}));
const plainObservation={placement:'FIELD',customerLabel:'Builder: Division',siteLabel:'Division'};
assert.equal((await query('select cos_sheets_placement_private.customer_value($1::jsonb,$2::jsonb,$3) value',[JSON.stringify(plainCells),JSON.stringify(plainObservation),'plain']))[0].value,'Builder: Division');
console.log('PASS: explicit plain style preserves punctuation in the actual parent customer name');

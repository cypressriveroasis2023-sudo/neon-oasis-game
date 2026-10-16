import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
import {createAvigilonSourceCoordinator} from '../../supabase/functions/_shared/avigilonSourceCoordinator.ts';
import {avigilonAuthorityClient} from '../../supabase/functions/_shared/avigilonAuthorityClient.ts';
const tenant='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',owner='11111111-1111-4111-8111-111111111111',actor={tenantId:tenant,actorId:owner,canCheck:true};
const command={table:'camera_devices',action:'update',values:{public_ip:'8.8.4.4',connection_revision:2},eq:{id:10}};
const sql=async name=>readFile(new URL('../db/'+name,import.meta.url),'utf8');
async function fixture(){
 const native=new PGlite(),legacy=new PGlite();
 const roles=`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;`;
 await native.exec(roles+`create table user_profiles(user_id uuid,organization_id uuid,active boolean,department text);create table roles(id uuid,organization_id uuid,code text);create table user_roles(user_id uuid,role_id uuid);insert into user_profiles values('${owner}','${tenant}',true,'owner');insert into roles values('${owner}','${tenant}','owner');insert into user_roles values('${owner}','${owner}');`);
 for(const file of ['avigilon_check_runs.sql','avigilon_health_publication.sql','avigilon_source_operations.sql'])await native.exec(await sql(file));
 await legacy.exec(roles+`create table camera_devices(id bigint primary key,device_serial text unique,public_ip text,connection_revision bigint,monitoring_profile text);insert into camera_devices values(10,'serial','8.8.8.8',1,'sniper');create table camera_integrations(provider text primary key,metadata jsonb);create table equipment_master(canonical_family text,unit_tag text,tracker_state text,unique(canonical_family,unit_tag));create table camera_inventory_audit(id bigint primary key,unit_key text);create table camera_integration_events(id bigint primary key,payload jsonb);create table camera_health_current(camera_device_id bigint,checked_at timestamptz);create table camera_health_history(camera_device_id bigint,observed_at timestamptz);`);
 await legacy.exec(await sql('avigilon_legacy_source_guard.sql'));
 const call=async(action,payload)=>(await native.query('select cos_avigilon_checks_private.source_control($1,$2,$3,$4) value',[owner,tenant,action,payload])).rows[0].value;
 const apply=async ticket=>(await legacy.query('select cos_avigilon_source_private.apply($1) value',[ticket])).rows[0].value;
 const seal=async()=>(await legacy.query('select receipt from cos_avigilon_source_private.receipts r join cos_avigilon_source_private.control c on c.operation_id=r.id where writer_xid is null')).rows[0]?.receipt;
 const readRoster=async()=>{const row=(await legacy.query('select * from camera_devices where id=10')).rows[0];return {tenantId:tenant,revision:'source-'+row.connection_revision,units:[{id:'r1',nativeUnitId:'u1',name:'Sniper 1',family:'Sniper',placement:'FIELD',restricted:false,identityVerified:true,endpoint:{deviceId:'10',revision:String(row.connection_revision),ip:row.public_ip,ports:[443],profile:'sniper'}}]};};
 const cancel=async ticket=>{await legacy.exec(`set request.jwt.claims='{"role":"service_role"}'`);return (await legacy.query('select public.cos_avigilon_source_cancel($1) value',[ticket])).rows[0].value;};
 const deps={actor,native:call,applyLegacy:apply,readLegacySeal:seal,cancelLegacy:cancel,readRoster};return {native,legacy,call,apply,seal,readRoster,deps,coordinator:createAvigilonSourceCoordinator(deps),close:async()=>{await native.close();await legacy.close();}};
}
test('real two-database coordinator seals source DML before admission; old requests cannot mutate afterward',async()=>{const f=await fixture();try{
 await assert.rejects(()=>f.legacy.exec("update camera_devices set public_ip='1.1.1.1'"),/native-fenced/);
 const id=crypto.randomUUID(),result=await f.coordinator.mutate([command],id);assert.equal(result.admission.admitted,true);assert.equal(result.receipt.sealed,true);
 const ticket={id,tenantId:tenant,generation:result.receipt.generation,commands:[command]};
 assert.deepEqual(await f.apply(ticket),result.receipt);await assert.rejects(()=>f.apply({...ticket,commands:[{...command,values:{public_ip:'1.1.1.1'}}]}),/replay changed/);
 assert.equal((await f.legacy.query('select public_ip from camera_devices')).rows[0].public_ip,'8.8.4.4');
 await assert.rejects(()=>f.legacy.exec("update camera_devices set public_ip='1.1.1.1'"),/native-fenced/);
 await assert.rejects(async()=>f.native.query('select cos_avigilon_checks_private.admit($1,$2,1,$3)',[owner,tenant,await f.readRoster()]),/Sealed source/);
 }finally{await f.close();}});
test('lost legacy response stays closed; durable resume reuses sealed operation exactly once',async()=>{const f=await fixture();try{
 let lose=true;const c=createAvigilonSourceCoordinator({...f.deps,applyLegacy:async t=>{const r=await f.apply(t);if(lose){lose=false;throw Error('lost response');}return r;}});
 await assert.rejects(()=>c.mutate([command]),/lost response/);assert.equal((await f.call('state',{})).admitted,false);
 const result=await c.reconcile();assert.equal(result.admission.admitted,true);assert.equal((await f.legacy.query('select count(*) n from cos_avigilon_source_private.receipts')).rows[0].n,1);
 assert.deepEqual(await c.reconcile(),{unchanged:true});
 }finally{await f.close();}});
test('outstanding remote request blocks admission and another writer; delayed replay cannot reopen seal',async()=>{const f=await fixture();try{
 let release,entered;const ready=new Promise(r=>entered=r),held=new Promise(r=>release=r);let ticket;
 const c=createAvigilonSourceCoordinator({...f.deps,applyLegacy:async t=>{ticket=t;entered();await held;return f.apply(t);}});
 const pending=c.mutate([command]);await ready;
 assert.equal((await f.call('state',{})).admitted,false);
 await assert.rejects(()=>f.coordinator.mutate([]),/writer pending/);
 await assert.rejects(async()=>f.call('finish',{id:ticket.id,generation:ticket.generation,legacyReceipt:null,roster:await f.readRoster()}),/sealed source/);
 release();const result=await pending;assert.equal(result.admission.admitted,true);
 await f.coordinator.mutate([{...command,values:{connection_revision:3,public_ip:'1.1.1.1'}}]);await f.apply(ticket);
 assert.equal((await f.legacy.query('select public_ip from camera_devices')).rows[0].public_ip,'1.1.1.1');
 }finally{await f.close();}});
test('native source change during readback rejects admission, then reconciliation reopens from fresh readback',async()=>{const f=await fixture();try{
 let change=true;const c=createAvigilonSourceCoordinator({...f.deps,readRoster:async()=>{const r=await f.readRoster();if(change){change=false;await f.native.exec('update cos_avigilon_checks_private.authority set admitted=false,generation=generation+1');}return r;}});
 await assert.rejects(()=>c.mutate([command]),/changed during/);assert.equal((await f.call('state',{})).admitted,false);
 assert.equal((await c.reconcile()).admission.admitted,true);
 await f.native.exec('update cos_avigilon_checks_private.authority set admitted=false,generation=generation+1');assert.equal((await c.reconcile()).admission.admitted,true);
 }finally{await f.close();}});
test('existing provider client write chain uses full protocol; unmanaged health remains independent',async()=>{const f=await fixture();try{
 const db=avigilonAuthorityClient({from:()=>({})},f.coordinator);
 const result=await db.from('camera_devices').update(command.values).eq('id',10).select();assert.equal(result.error,null);assert.equal(result.data[0].connection_revision,2);
 await f.coordinator.mutate([{table:'camera_devices',action:'upsert',values:{id:10,device_serial:'serial',public_ip:'8.8.4.4',connection_revision:2,monitoring_profile:'sniper'},onConflict:'device_serial'}]);
 await f.legacy.exec("insert into camera_integrations values('vigilant','{}')");
 const inserted=await db.from('camera_devices').upsert({id:10,device_serial:'serial',public_ip:'8.8.4.4',connection_revision:2,monitoring_profile:'sniper'},{onConflict:'device_serial'});assert.equal(inserted.error,null);assert.equal((await f.call('state',{})).admitted,true);
 await assert.rejects(()=>f.legacy.exec('insert into camera_health_current values(10,clock_timestamp())'),/native publication/);
 await f.coordinator.mutate([{table:'camera_devices',action:'insert',values:{id:20,device_serial:'other',monitoring_profile:'recon'}}]);await f.legacy.exec('insert into camera_health_current values(20,clock_timestamp())');
 }finally{await f.close();}});
test('cancellation seals a delayed request before recovery admission; late writer cannot execute',async()=>{const f=await fixture();try{
 let release,entered;const ready=new Promise(r=>entered=r),held=new Promise(r=>release=r);let ticket;
 const c=createAvigilonSourceCoordinator({...f.deps,applyLegacy:async t=>{ticket=t;entered();await held;return f.apply(t);}});
 const pending=c.mutate([command]);await ready;
 const cancelled=await f.coordinator.cancelPending();assert.equal(cancelled.receipt.cancelled,true);assert.equal(cancelled.admission.admitted,true);
 const rejected=assert.rejects(pending,/Source operation changed/);release();await rejected;
 assert.equal((await f.legacy.query('select public_ip from camera_devices')).rows[0].public_ip,'8.8.8.8');
 assert.deepEqual(await f.apply(ticket),cancelled.receipt);
 }finally{await f.close();}});
test('cancellation after an already committed write returns its actual receipt, never pretends rollback',async()=>{const f=await fixture();try{
 const c=createAvigilonSourceCoordinator({...f.deps,applyLegacy:async t=>{await f.apply(t);throw Error('response lost');}});
 await assert.rejects(()=>c.mutate([command]),/response lost/);const result=await f.coordinator.cancelPending();assert.equal(result.receipt.cancelled,undefined);assert.equal(result.admission.admitted,true);assert.equal((await f.legacy.query('select public_ip from camera_devices')).rows[0].public_ip,'8.8.4.4');
 }finally{await f.close();}});
test('guarded manual RPC preserves original legacy actor authorization and compare-and-swap',async()=>{const f=await fixture();try{
 await f.legacy.exec(`create function public.set_camera_unit_connection_v2(p_device_id bigint,p_public_ip text,p_expected_revision bigint,p_expected_unit_etag text,p_ports integer[]) returns jsonb language plpgsql as $$begin if auth.jwt()->>'sub'<>'${owner}' then raise exception 'Original actor denied';end if;update public.camera_devices set public_ip=p_public_ip,connection_revision=connection_revision+1 where id=p_device_id and connection_revision=p_expected_revision;if not found then raise exception 'Stale source revision';end if;return jsonb_build_object('ok',true);end$$;`);
 const manual={action:'rpc',name:'set_camera_unit_connection_v2',legacyActorId:owner,args:{p_device_id:10,p_public_ip:'8.8.4.4',p_expected_revision:1,p_expected_unit_etag:'etag',p_ports:[443]}};
 assert.deepEqual((await f.coordinator.mutate([manual])).receipt.results,[{ok:true}]);
 await assert.rejects(()=>f.coordinator.mutate([{...manual,legacyActorId:tenant}]),/Original actor denied/);await f.coordinator.cancelPending();
 await assert.rejects(()=>f.coordinator.mutate([manual]),/Stale source revision/);await f.coordinator.cancelPending();
 assert.equal((await f.call('state',{})).admitted,true);
 }finally{await f.close();}});

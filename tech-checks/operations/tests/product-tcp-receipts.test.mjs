import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {productSource,positive,negative,uuid} from './fixtures/product-tcp-source.mjs';
import {buildProductGroups,consumeProductReceipt,RECEIPT_CONTRACT} from '../../supabase/functions/_shared/exact-product-producer/fullSource.ts';
import {createReceiptStore} from '../../supabase/functions/_shared/exact-product-producer/receiptAdapter.ts';
import {collectProductGroups,readProductGroupStatuses} from '../../supabase/functions/_shared/exact-product-producer/groupCollector.ts';
const migration=await readFile(new URL('../db/exact-product-producer/receipt_protocol_v2.sql',import.meta.url),'utf8');
async function fixture(){
 const f=await productSource({now:Date.now()-500}),db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table public.camera_devices(id bigint primary key,connection_revision bigint,public_ip inet,expected_ports integer[],monitoring_profile text,source text,monitoring_enabled boolean,activation_state text,unit_key text,device_name text,organization text,external_device_id text,device_serial text,device_type text);
 create table public.camera_health_current(marker text);insert into camera_health_current values('untouched');
 create table public.camera_health_history(marker text);insert into camera_health_history values('untouched');
 grant select,update on public.camera_devices to service_role;`);
 const fields=Object.keys(f.source.identitySources.devices[0]);
 for(const d of f.source.identitySources.devices)await db.query(`insert into camera_devices(${fields.join(',')}) values(${fields.map((_,i)=>'$'+(i+1)).join(',')})`,fields.map(k=>d[k]));
 try{await db.exec(migration);await db.exec(await readFile(new URL('../db/exact-product-producer/receipt_batch_read_v2.sql',import.meta.url),'utf8'));}catch(e){await db.close();throw Error(e.message+' at '+e.position);}
 const rpc=async(name,args)=>{
  assert.ok(['cos_product_tcp_stage_v2','cos_product_tcp_accept_v2','cos_product_tcp_read_v2','cos_product_tcp_receipt_v2','cos_product_tcp_read_batch_v2'].includes(name));
  await db.exec('begin;set local role service_role;');
  try{const result=(await db.query(`select public.${name}(${Object.values(args).map((_,i)=>'$'+(i+1)).join(',')}) value`,Object.values(args))).rows[0].value;await db.exec('commit');return result;}
  catch(error){await db.exec('rollback');throw error;}
 };
 const g=(await buildProductGroups(f.source,['101'],f.now,f.review)).groups[0];
 const payload={contract:RECEIPT_CONTRACT,runId:uuid(800),proof:g,ports:{80:positive,443:positive},checkedAt:new Date(f.now).toISOString()};
 const store=createReceiptStore(rpc),signal=new AbortController().signal;
 const preserved=async()=>(await db.query("select jsonb_build_object('devices',(select jsonb_agg(to_jsonb(d) order by id) from camera_devices d),'health',(select jsonb_agg(h) from camera_health_current h),'history',(select jsonb_agg(h) from camera_health_history h)) v")).rows[0].v;
 return {...f,db,rpc,g,payload,store,signal,preserved};
}
test('real SQL migration: private invoker-only functions, no public grants; stage/accept/replay preserves all global rows',async()=>{
 const f=await fixture();try{
 const before=await f.preserved(),ack=await f.store.stage(f.payload,f.signal);assert.equal(ack.state,'pending');assert.equal(await f.store.read(f.g,f.signal),null);
 const accepted=await f.store.accept(ack,f.g.authorityGuard,f.signal);assert.equal(accepted.state,'accepted');assert.deepEqual(await f.store.stage(f.payload,f.signal),accepted);
 const receipt=await f.store.read(f.g,f.signal);assert.equal(consumeProductReceipt(f.g,receipt,f.now).status,'online');assert.deepEqual(await f.preserved(),before);
 assert.equal((await f.db.query('select count(*)::int n from cos_product_tcp_private.receipts')).rows[0].n,1);
 assert.equal((await f.store.stage({...f.payload,ports:{80:negative,443:negative}},f.signal)).reason,'receipt_payload_conflict');
 for(const role of ['anon','authenticated']){await f.db.exec('begin;set local role '+role);await assert.rejects(()=>f.db.query('select public.cos_product_tcp_read_v2($1,$2)',['101',f.g.authorityGuard]),/permission denied/);await f.db.exec('rollback');}
 const meta=(await f.db.query("select prosecdef,proacl::text acl from pg_proc where proname like 'cos_product_tcp_%_v2'")).rows;assert.equal(meta.length,5);assert.ok(meta.every(r=>r.prosecdef===false&&!r.acl.includes('anon')&&!r.acl.includes('authenticated')));
 }finally{await f.db.close();}
});
test('SQL rejects stale revision/ports, disabled/retired/foreign members and added IP collisions atomically',async()=>{
 const f=await fixture();try{
 for(const change of ["update camera_devices set connection_revision=1 where id=4","update camera_devices set expected_ports='{80}' where id=4","update camera_devices set monitoring_enabled=false where id=4","update camera_devices set activation_state='retired' where id=4","update camera_devices set source='foreign' where id=4","insert into camera_devices select 99,connection_revision,public_ip,expected_ports,monitoring_profile,source,false,activation_state,unit_key,device_name,organization,external_device_id,device_serial,device_type from camera_devices where id=4"]){
  await f.db.exec('begin;'+change+';set local role service_role;');const result=(await f.db.query('select cos_product_tcp_private.local_current($1) v',[f.g])).rows[0];assert.equal(result.v,false)
  await f.db.exec('rollback');
 }
 }finally{await f.db.close();}
});
test('changed remote guard or local configuration after staging cannot accept; incomplete ports write no receipts',async()=>{
 const f=await fixture();try{
 const ack=await f.store.stage(f.payload,f.signal);assert.equal((await f.store.accept(ack,'0'.repeat(64),f.signal)).ok,false);
 await f.db.exec('update camera_devices set connection_revision=connection_revision+1 where id=4');assert.equal((await f.store.accept(ack,f.g.authorityGuard,f.signal)).ok,false);
 assert.equal((await f.db.query('select state from cos_product_tcp_private.receipts')).rows[0].state,'pending');
 await f.db.exec('update camera_devices set connection_revision=0 where id=4');
 for(const ports of [{80:positive},{80:positive,443:{...negative,error:'Network unreachable'}},{80:positive,443:{online:false}}])await assert.rejects(()=>f.store.stage({...f.payload,runId:uuid(801),ports},f.signal));
 assert.equal((await f.db.query('select count(*)::int n from cos_product_tcp_private.receipts')).rows[0].n,1);
 }finally{await f.db.close();}
});
test('complete grouped collector uses one transport set, actual SQL receipts and fresh source-aware consumption',async()=>{
 const f=await fixture();try{
 let calls=0;const runtime={read:async()=>structuredClone(f.source),rpc:f.rpc,probe:async()=>{calls++;return negative;}};
 const before=await f.preserved(),result=await collectProductGroups(runtime,['101'],uuid(900),()=>f.now,f.review);assert.equal(result.complete,true);assert.equal(calls,2);assert.equal(result.outcomes[0].deviceCount,4);assert.deepEqual(await f.preserved(),before);
 const statuses=await readProductGroupStatuses(runtime,['101'],()=>f.now,f.review);assert.equal(statuses[0].status,'offline');
 f.source.upload.records[0].binding.expectedGuard='8'.repeat(64);assert.equal((await readProductGroupStatuses(runtime,['101'],()=>f.now,f.review))[0].status,'unknown');
 }finally{await f.db.close();}
});
test('remote drift after stage leaves pending-only evidence; timeout or partial probes cannot stage',async()=>{
 const f=await fixture();try{
 let reads=0;const runtime={read:async()=>{const s=structuredClone(f.source);if(++reads>=3)s.upload.records[0].binding.expectedGuard='8'.repeat(64);return s;},rpc:f.rpc,probe:async()=>positive};
 const result=await collectProductGroups(runtime,['101'],uuid(901),()=>f.now,f.review);assert.equal(result.complete,false);assert.equal(result.outcomes[0].reason,'pending_source_changed');assert.equal((await f.db.query('select state from cos_product_tcp_private.receipts')).rows[0].state,'pending');
 reads=0;runtime.probe=async()=>{throw Error('routing');};await collectProductGroups(runtime,['101'],uuid(902),()=>f.now,f.review);assert.equal((await f.db.query('select count(*)::int n from cos_product_tcp_private.receipts')).rows[0].n,1);
 }finally{await f.db.close();}
});

test('remote change between final read and acceptance can persist only a scoped receipt, never a current status',async()=>{
 const f=await fixture();try{
 const runtime={read:async()=>structuredClone(f.source),probe:async()=>positive,rpc:async(name,args,signal)=>{
  if(name==='cos_product_tcp_accept_v2')f.source.upload.records[0].binding.expectedGuard='7'.repeat(64);
  return f.rpc(name,args,signal);
 }};
 const before=await f.preserved();assert.equal((await collectProductGroups(runtime,['101'],uuid(903),()=>f.now,f.review)).complete,true);
 assert.equal((await readProductGroupStatuses(runtime,['101'],()=>f.now,f.review))[0].status,'unknown');assert.deepEqual(await f.preserved(),before);
 }finally{await f.db.close();}
});
test('immutable payload and rollback preserve receipts while denying execution',async()=>{
 const f=await fixture();try{
 const ack=await f.store.stage(f.payload,f.signal);await f.store.accept(ack,f.g.authorityGuard,f.signal);
 await assert.rejects(()=>f.db.exec("update cos_product_tcp_private.receipts set payload='{}'"),/Immutable receipt/);
 await f.db.exec(await readFile(new URL('../db/exact-product-producer/rollback_receipt_protocol_v2.sql',import.meta.url),'utf8'));
 await assert.rejects(()=>f.store.stage({...f.payload,runId:uuid(904)},f.signal),/permission denied/);
 assert.equal((await f.db.query('select count(*)::int n from cos_product_tcp_private.receipts')).rows[0].n,1);
 }finally{await f.db.close();}
});

test('lost stage acknowledgement yields a reconcilable receipt key and never retries or invents Offline',async()=>{
 const f=await fixture();try{
 let stages=0;const runtime={read:async()=>structuredClone(f.source),probe:async()=>positive,rpc:async(name,args,signal)=>{const r=await f.rpc(name,args,signal);if(name==='cos_product_tcp_stage_v2'){stages++;throw Error('lost acknowledgement');}return r;}};
 const result=await collectProductGroups(runtime,['101'],uuid(905),()=>f.now,f.review);assert.equal(result.outcomes[0].state,'publication_uncertain');assert.equal(stages,1);
 assert.equal((await f.store.inspect(result.outcomes[0].receiptKey,f.signal)).state,'pending');assert.equal(await f.store.read(f.g,f.signal),null);
 }finally{await f.db.close();}
});
test('batch SQL preserves exact per-target semantics, 100-target bound, configuration CAS and private rollback',async()=>{
 const f=await fixture();try{
 const before=await f.preserved(),ack=await f.store.stage(f.payload,f.signal);await f.store.accept(ack,f.g.authorityGuard,f.signal);
 const targets=Array.from({length:100},(_,i)=>({productId:i===0?'101':String(1000+i),authorityGuard:f.g.authorityGuard}));
 const rows=await f.rpc('cos_product_tcp_read_batch_v2',{p_targets:targets});assert.equal(rows.length,100);assert.equal(rows[0].receipt.state,'accepted');assert.ok(rows.slice(1).every(r=>r.receipt===null));assert.deepEqual(rows.map(r=>r.productId),targets.map(t=>t.productId));
 for(const bad of [[],[targets[0],targets[0]],[...targets,{productId:'9999',authorityGuard:f.g.authorityGuard}],[{...targets[0],authorityGuard:null}],[{...targets[0],productId:101}],[{...targets[0],extra:true}]])await assert.rejects(()=>f.rpc('cos_product_tcp_read_batch_v2',{p_targets:bad}));
 assert.equal((await f.rpc('cos_product_tcp_read_batch_v2',{p_targets:[{productId:'101',authorityGuard:'0'.repeat(64)}]}))[0].receipt,null);
 for(const role of ['anon','authenticated']){await f.db.exec('begin;set local role '+role);await assert.rejects(()=>f.db.query('select cos_product_tcp_read_batch_v2($1)',[[targets[0]]]),/permission denied/);await f.db.exec('rollback');}
 await f.db.exec('update camera_devices set monitoring_enabled=false where id=4');assert.equal((await f.rpc('cos_product_tcp_read_batch_v2',{p_targets:[targets[0]]}))[0].receipt,null);await f.db.exec('update camera_devices set monitoring_enabled=true where id=4');assert.deepEqual(await f.preserved(),before);
 await f.db.exec(await readFile(new URL('../db/exact-product-producer/receipt_batch_read_v2_rollback.sql',import.meta.url),'utf8'));await assert.rejects(()=>f.rpc('cos_product_tcp_read_batch_v2',{p_targets:[targets[0]]}),/permission denied/);
 assert.equal((await f.store.read(f.g,f.signal)).state,'accepted');assert.equal((await f.db.query('select count(*)::int n from cos_product_tcp_private.receipts')).rows[0].n,1);
 }finally{await f.db.close();}
});
test('real SQL full fleet: 100 accepted distinct saved groups in one network-equivalent batch, no non-target writes',async()=>{
 const f=await fixture();try{
 const groups=[];
 for(let i=0;i<100;i++){
  const group=structuredClone(f.g);group.productId=String(1000+i);group.nativeUnitId=uuid(2000+i);group.authorityGuard=(1000+i).toString(16).padStart(64,'0');
  for(let j=0;j<group.devices.length;j++){
   const d=group.devices[j];d.id=String(1000+i*4+j);d.ip=`11.23.0.${i+1}`;d.unitKey='sql-batch-'+i;d.serial='sql-serial-'+d.id;d.externalId='sql-external-'+d.id;
   const row={...f.source.identitySources.devices[j],id:Number(d.id),public_ip:d.ip,unit_key:d.unitKey,device_serial:d.serial,external_device_id:d.externalId},fields=Object.keys(row);
   await f.db.query(`insert into camera_devices(${fields.join(',')}) values(${fields.map((_,n)=>'$'+(n+1)).join(',')})`,fields.map(k=>row[k]));
  }
  // SQL fixtures exercise receipt storage/current-config semantics. Native
  // admission is independently exercised by the 100-reviewed-identity test.
  const ack=await f.store.stage({...f.payload,runId:uuid(3000+i),proof:group},f.signal);assert.equal(ack.ok,true);assert.equal((await f.store.accept(ack,group.authorityGuard,f.signal)).ok,true);groups.push(group);
 }
 const before=await f.preserved();let calls=0;
 const store=createReceiptStore(async(name,args,signal)=>{calls++;return f.rpc(name,args,signal);});
 const receipts=await store.readMany(groups,f.signal);assert.equal(calls,1);assert.equal(receipts.size,100);for(const group of groups)assert.equal(consumeProductReceipt(group,receipts.get(group.productId),f.now).status,'online');
 assert.deepEqual(await f.preserved(),before);
 await f.db.exec('update camera_devices set connection_revision=1 where id=1000');
 const changed=await store.readMany(groups,f.signal);assert.equal(changed.get('1000'),null);assert.equal([...changed.values()].filter(Boolean).length,99);
 assert.equal((await f.db.query('select count(*)::int n from cos_product_tcp_private.receipts')).rows[0].n,100);
 }finally{await f.db.close();}
});

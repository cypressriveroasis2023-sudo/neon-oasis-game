// REQUIRED hosted proof against a disposable local PostgreSQL 17 service only.
// This file never reads a production URL, key or password.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
if(process.env.COS_TRANSFER_POSTGRES_CI!=='1')throw new Error('Dedicated local PostgreSQL CI opt-in is required.');
const database='cos_transfer_ci_'+randomUUID().replaceAll('-','');
const psql=process.env.COS_TRANSFER_PSQL||'psql';
const it='00000000-0000-4000-8000-000000000001',svc='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003',unverified='00000000-0000-4000-8000-000000000004';
const children=new Set();const lit=v=>"'"+String(v).replaceAll("'","''")+"'";const json=v=>lit(JSON.stringify(v))+'::jsonb';
function session(label,db=database){
 const env={PATH:process.env.PATH,LANG:'C.UTF-8',PGAPPNAME:label,PGCONNECT_TIMEOUT:'5',PGPASSWORD:'synthetic-ci-only',PGOPTIONS:'-c statement_timeout=15000 -c lock_timeout=12000 -c idle_in_transaction_session_timeout=20000'};
 const child=spawn(psql,['-X','--no-password','-h','127.0.0.1','-p','5432','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-qAt'],{env,stdio:['pipe','pipe','pipe']});children.add(child);let stdout='',stderr='',done=false;
 child.stdout.on('data',d=>{stdout+=d;});child.stderr.on('data',d=>{stderr+=d;});
 const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{done=true;children.delete(child);resolve({code,stdout,stderr});});});
 return {child,completion,send:sql=>child.stdin.write(sql),end:sql=>child.stdin.end(sql),get stdout(){return stdout;},get done(){return done;}};
}
async function query(sql,{db=database,label='receipt-observer',allowError=false}={}){const s=session(label,db);s.end(sql+'\n');const r=await s.completion;if(!allowError&&r.code!==0)throw new Error(r.stderr||'psql failed');return r;}
async function one(sql){const r=await query(sql);return JSON.parse(r.stdout.trim().split('\n').filter(Boolean).at(-1));}
const auth=actor=>`set local test.actor=${lit(actor)};set local role authenticated;`;
const rpc=args=>`select public.submit_techcheck_transfer_v2(${Object.entries(args).map(([k,v])=>k+'=>'+(typeof v==='number'?v:typeof v==='object'?json(v):lit(v))).join(',')})::text;`;
const execute=(args,actor=it)=>query('begin;'+auth(actor)+rpc(args)+'commit;');
const readback=id=>one(`select jsonb_build_object('revision',t.revision,'state',t.state,'events',(select count(*) from app_private.techcheck_transfer_events where transfer_id=t.id),'receipts',(select count(*) from app_private.techcheck_transfer_events where transfer_id=t.id and kind='receipt'),'outbox',(select count(*) from app_private.techcheck_transfer_outbox where transfer_id=t.id),'reservations',(select count(*) from app_private.techcheck_transfer_reservations where transfer_id=t.id)) from app_private.techcheck_transfers t where id=${lit(id)};`);
let contract,created=false;
async function issue(){
 const id=randomUUID(),key='solar_spotter:'+id,item={equipment_key:key,family:'Solar Spotter',unit_tag:'TEST-'+id.slice(0,8),sims:[],battery_count:null,battery_configuration:null,parts:[]};
 const photo={equipment_key:key,kind:'unit',path:it+'/'+id+'/'+'a'.repeat(64)+'.jpg'};
 await query(`insert into equipment_master(equipment_key,unit_tag,source_family,canonical_family,workflow_type,source_label,tracker_state) values(${lit(key)},${lit(item.unit_tag)},'Solar Spotter','Solar Spotter','Solar Spotter','Synthetic concurrency equipment','shop');insert into storage.objects values('techcheck-transfer-evidence',${lit(photo.path)},'{"mimetype":"image/jpeg","size":1234}'::jsonb);`);
 const r={p_request_id:id,p_transfer_id:id,p_kind:'checkout',p_expected_revision:0,p_service_actor:svc,p_items:[item],p_checks:{[key]:Object.fromEntries(contract.families['Solar Spotter'].bool_fields.map(f=>[f,true]))},p_signature:{method:'typed',name:'Synthetic IT',confirmed:true},p_photos:[photo],p_notes:'Synthetic local concurrency checkout',p_purpose:'truck_replenishment'};
 await execute(r);return r;
}
const receipt=r=>({...r,p_request_id:randomUUID(),p_kind:'receipt',p_expected_revision:1,p_checks:{},p_signature:{method:'typed',name:'Synthetic Service',confirmed:true},p_photos:[],p_notes:'Synthetic local receipt'});
async function overlap(label,first,second){
 const a=session(label+'-first');a.send('begin;'+auth(svc)+rpc(first)+'\n\\echo RECEIPT_HELD\n');
 let deadline=Date.now()+7000;while(!a.stdout.includes('RECEIPT_HELD')){if(a.done)throw new Error((await a.completion).stderr);if(Date.now()>deadline)throw new Error('First receipt did not reach hold marker.');await delay(20);}
 const b=session(label+'-second');b.end('begin;'+auth(svc)+rpc(second)+'commit;\n');
 try{
  let proof;deadline=Date.now()+7000;
  while(Date.now()<deadline){proof=await one(`select coalesce((select jsonb_build_object('first_pid',a.pid,'first_state',a.state,'wait_event_type',b.wait_event_type,'wait_event',b.wait_event,'blockers',to_jsonb(pg_blocking_pids(b.pid))) from pg_stat_activity a cross join pg_stat_activity b where a.application_name=${lit(label+'-first')} and b.application_name=${lit(label+'-second')}),'null'::jsonb);`);if(proof?.wait_event_type==='Lock'&&proof.blockers.includes(proof.first_pid))break;if(b.done)throw new Error('Second backend completed without overlapping lock wait.');await delay(20);}
  assert.equal(proof?.first_state,'idle in transaction');assert.equal(proof?.wait_event_type,'Lock');assert.ok(proof.blockers.includes(proof.first_pid));a.end('commit;\n');const [ar,br]=await Promise.all([a.completion,b.completion]);assert.equal(ar.code,0,ar.stderr);return {first:ar,second:br,proof};
 }finally{if(!a.done)a.child.kill('SIGTERM');if(!b.done)b.child.kill('SIGTERM');}
}
try{
 await query(`create database ${database}` ,{db:'cos_transfer_ci'});created=true;
 const fixture=await readFile(new URL('./transfer-purpose.test.mjs',import.meta.url),'utf8');let schema=fixture.match(/await db\.exec\(`([\s\S]*?)`\);/)[1];for(const [k,v]of Object.entries({it,svc,other,unverified}))schema=schema.replaceAll('${'+k+'}',v);
 schema=schema.replace(/create role (anon|authenticated|service_role);/g,(_,r)=>`do $$begin if not exists(select 1 from pg_roles where rolname='${r}') then create role ${r};end if;end $$;`);await query(schema);
 for(const name of ['techcheck-named-handoffs-v1.sql','techcheck-transfer-rollout-v2.sql','techcheck-transfer-integration-v3.sql','techcheck-transfer-purpose-v2.sql'])await query(await readFile(new URL('../../database-maintenance/'+name,import.meta.url),'utf8'));
 await query('update app_private.techcheck_transfer_settings set enabled=true,reports_ready=true,receipt_link_ready=true,custody_ready=true;');contract=JSON.parse(await readFile(new URL('../../transfers/checklist-contract.json',import.meta.url),'utf8'));
 console.log((await query('select version();')).stdout.trim());
 const a=await issue(),ar=receipt(a),different=receipt(a);const fresh=await overlap('receipt-distinct',ar,different);assert.notEqual(fresh.second.code,0);assert.match(fresh.second.stderr,/Handoff changed/);assert.deepEqual(await readback(a.p_transfer_id),{revision:2,state:'accepted',events:2,receipts:1,outbox:2,reservations:1});console.log('PASS overlapping fresh request IDs commit exactly one receipt and one receipt outbox',fresh.proof);
 const b=await issue(),same=receipt(b),retry=await overlap('receipt-same-id',same,same);assert.equal(retry.second.code,0,retry.second.stderr);const response=JSON.parse(retry.second.stdout.split('\n').find(line=>line.startsWith('{')));assert.equal(response.event_id,same.p_request_id);assert.equal(response.replayed,true);assert.deepEqual(await readback(b.p_transfer_id),{revision:2,state:'accepted',events:2,receipts:1,outbox:2,reservations:1});console.log('PASS overlapping identical retry returns the saved actor-bound receipt without another outbox',retry.proof);
 console.log('All 2 native PostgreSQL overlapping-transaction proofs passed. Production calls: 0.');
}finally{for(const child of children)child.kill('SIGTERM');if(created)await query(`drop database ${database} with (force);`,{db:'cos_transfer_ci'});}

import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {correctionActors,correctionFixtureSchema,correctionMigrationNames,correctionLegacyReadySql,correctionTestReadySql} from './helpers/correction-schema-fixture.mjs';

// Opt-in ONLY against a dedicated, disposable local PostgreSQL server.
// No project URL, production identifier, deployment, credentials or external API.
const enabled=process.env.COS_CORRECTION_POSTGRES_TEST==='1';
const required=process.env.COS_CORRECTION_POSTGRES_REQUIRED==='1';
if(required&&!enabled)throw new Error('Required PostgreSQL concurrency gate was not enabled.');
const psql=process.env.COS_CORRECTION_PSQL||'psql';
const host=process.env.COS_CORRECTION_PG_HOST||'';
const port=process.env.COS_CORRECTION_PG_PORT||'';
const user=process.env.COS_CORRECTION_PG_USER||'';
const database='cos_correction_concurrency_'+process.pid+'_'+randomUUID().replaceAll('-','').slice(0,10);
const evidence={kind:'synthetic-local-postgresql-concurrency',database,production_calls:0,proofs:[]};
const children=new Set();
const {it,svc}=correctionActors;
let contract,created=false;
const lit=value=>"'"+String(value).replaceAll("'","''")+"'";
const json=value=>lit(JSON.stringify(value))+'::jsonb';
function session(label,db=database){
 const env={PATH:process.env.PATH,LANG:'C.UTF-8',PGAPPNAME:label,PGCONNECT_TIMEOUT:'5',PGOPTIONS:'-c statement_timeout=15000 -c lock_timeout=12000 -c idle_in_transaction_session_timeout=20000'};
 if(process.env.COS_CORRECTION_PG_LIBRARY_PATH)env.LD_LIBRARY_PATH=process.env.COS_CORRECTION_PG_LIBRARY_PATH;
 if(host==='127.0.0.1')env.PGPASSWORD='synthetic-ci-only';
 const child=spawn(psql,['-X','--no-password','-h',host,'-p',port,'-U',user,'-d',db,'-v','ON_ERROR_STOP=1','-qAt'],{env,stdio:['pipe','pipe','pipe']});
 children.add(child);let stdout='',stderr='',done=false;
 child.stdout.on('data',data=>{stdout+=data;});child.stderr.on('data',data=>{stderr+=data;});
 const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{done=true;children.delete(child);resolve({code,signal,stdout,stderr});});});
 return {child,completion,send:sql=>child.stdin.write(sql),end:sql=>child.stdin.end(sql),get stdout(){return stdout;},get done(){return done;}};
}
async function query(sql,{db=database,label='cos-correction-observer',allowError=false}={}){
 const s=session(label,db);s.end(sql+'\n');const r=await s.completion;
 if(!allowError&&r.code!==0)throw new Error(r.stderr||r.stdout||'psql failed');
 return r;
}
async function one(sql){const r=await query(sql);const line=r.stdout.trim().split('\n').filter(Boolean).at(-1);return line?JSON.parse(line):null;}
const auth=actor=>`set local test.actor=${lit(actor)};set local test.jwt_role='authenticated';set local role authenticated;`;
const rpc=(name,args)=>`select public.${name}(${Object.entries(args).map(([key,value])=>key+'=>'+(typeof value==='number'?String(value):typeof value==='object'?json(value):lit(value))).join(',')})::text;`;
async function execute(name,args,actor=it){return query('begin;'+auth(actor)+rpc(name,args)+'commit;');}
async function eq(){const id=randomUUID(),key='Solar Spotter:CONCURRENCY-'+id,tag='TEST-'+id.slice(0,10);
 await query(`insert into equipment_master(equipment_key,unit_tag,source_family,canonical_family,workflow_type,source_label,tracker_state) values(${lit(key)},${lit(tag)},'Solar Spotter','Solar Spotter','Solar Spotter',${lit('Synthetic '+tag)},'shop');`);
 return {equipment_key:key,family:'Solar Spotter',unit_tag:tag,sims:[],battery_count:null,battery_configuration:null,required_battery_count:null,parts:[]};
}
const photo=(item,id,actor,kind)=>({equipment_key:item.equipment_key,kind,path:actor+'/'+id+'/'+createHash('sha256').update(item.equipment_key).digest('hex')+'.jpg'});
async function uploads(photos,actor=it){const paths=[...new Set(photos.map(p=>p.path))];
 await query('begin;'+auth(actor)+paths.map(path=>`insert into storage.objects values('techcheck-transfer-evidence',${lit(path)},'{"mimetype":"image/jpeg","size":1234}'::jsonb);`).join('')+'commit;');
}
async function issue({legacy=false}={}){const item=await eq(),id=randomUUID();
 if(legacy){item.battery_count=1;delete item.battery_configuration;delete item.required_battery_count;}
 const o={p_request_id:id,p_transfer_id:id,p_kind:'checkout',p_expected_revision:0,p_service_actor:svc,p_items:[item],p_checks:{[item.equipment_key]:Object.fromEntries(contract.families['Solar Spotter'].bool_fields.map(f=>[f,true]))},p_signature:{method:'typed',name:'Synthetic IT',confirmed:true},p_photos:[photo(item,id,it,'unit')],p_notes:'Synthetic concurrency original'};
 await uploads(o.p_photos);
 if(legacy){
  // Fixture-only historical seeding as the disposable database owner.
  await query('begin;'+`set local test.actor=${lit(it)};`+rpc('submit_techcheck_transfer_pre_purpose_v1',o).replace('public.','app_private.')+'commit;');
 }else{o.p_purpose='truck_replenishment';await execute('submit_techcheck_transfer_v2',o);}
 o.originalHash=await fingerprint(id);return o;
}
async function correction(o,item){item??=await eq();const id=randomUUID();const r={p_request_id:id,p_transfer_id:o.p_transfer_id,p_expected_revision:1,p_items:[item],p_photos:['unit','tag'].map(kind=>photo(item,id,it,kind)),p_reason:'Physically verified correction for isolated concurrency acceptance.',p_confirmation:{mode:'self',confirmed:true,technician_id:it}};
 await uploads(r.p_photos);return r;
}
async function receipt(o){const id=randomUUID(),r={p_request_id:id,p_transfer_id:o.p_transfer_id,p_kind:'receipt',p_expected_revision:1,p_service_actor:svc,p_items:o.p_items,p_checks:{},p_signature:{method:'typed',name:'Synthetic Service',confirmed:true},p_photos:o.p_items.map(item=>photo(item,id,svc,'unit')),p_notes:'Synthetic receipt overlap',p_purpose:o.p_purpose};
 await uploads(r.p_photos,svc);return r;
}
const fingerprint=id=>one(`select to_jsonb(md5(to_jsonb(e)::text||to_jsonb(o)::text)) from app_private.techcheck_transfer_events e join app_private.techcheck_transfer_outbox o on o.event_id=e.id where e.id=${lit(id)};`);
async function readback(id){return one(`select jsonb_build_object('revision',t.revision,'state',t.state,'manifest',t.manifest,'purpose',t.purpose,'purpose_revision',t.purpose_revision,
 'corrections',(select count(*) from app_private.techcheck_transfer_corrections c where c.transfer_id=t.id),
 'audits',(select count(*) from app_private.techcheck_transfer_correction_audit a where a.transfer_id=t.id),
 'outbox',(select count(*) from app_private.techcheck_transfer_correction_outbox q where q.transfer_id=t.id),
 'events',(select count(*) from app_private.techcheck_transfer_events e where e.transfer_id=t.id),
 'receipts',(select count(*) from app_private.techcheck_transfer_events e where e.transfer_id=t.id and e.kind='receipt'),
 'reservations',(select coalesce(jsonb_agg(r.equipment_key order by r.equipment_key),'[]') from app_private.techcheck_transfer_reservations r where r.transfer_id=t.id))
 from app_private.techcheck_transfers t where t.id=${lit(id)};`);}
async function heldTransaction(label,name,args,actor){
 const s=session(label);s.send('begin;'+auth(actor)+rpc(name,args)+'\n\\echo CORRECTION_TRANSACTION_HELD\n');
 const end=Date.now()+7000;
 while(!s.stdout.includes('CORRECTION_TRANSACTION_HELD')){
  if(s.done)throw new Error('First transaction failed: '+JSON.stringify(await s.completion));
  if(Date.now()>end)throw new Error('First transaction did not reach hold marker.');
  await delay(25);
 }
 return s;
}
async function overlap(label,first,second){
 const aLabel=label+'-first',bLabel=label+'-second';const a=await heldTransaction(aLabel,first.name,first.args,first.actor||it);
 const b=session(bLabel);b.end('begin;'+auth(second.actor||it)+rpc(second.name,second.args)+'commit;\n');
 let waitProof;const deadline=Date.now()+7000;
 try{
  while(Date.now()<deadline){
   waitProof=await one(`select jsonb_build_object('first_pid',a.pid,'first_state',a.state,'second_pid',b.pid,'second_state',b.state,
    'wait_event_type',b.wait_event_type,'wait_event',b.wait_event,'blocking_pids',to_jsonb(pg_blocking_pids(b.pid)))
    from pg_stat_activity a cross join pg_stat_activity b where a.application_name=${lit(aLabel)} and b.application_name=${lit(bLabel)};`);
   if(waitProof?.wait_event_type==='Lock'&&waitProof.blocking_pids.includes(waitProof.first_pid))break;
   if(b.done)throw new Error('Second call finished without the required overlapping lock wait.');
   await delay(25);
  }
  assert.equal(waitProof?.first_state,'idle in transaction');assert.equal(waitProof?.wait_event_type,'Lock');
  assert.ok(waitProof.blocking_pids.includes(waitProof.first_pid),'Second real backend must be blocked by the uncommitted first backend.');
  a.end('commit;\n');const [aResult,bResult]=await Promise.all([a.completion,b.completion]);
  assert.equal(aResult.code,0,aResult.stderr);const proof={case:label,wait:waitProof,first_exit:aResult.code,second_exit:bResult.code,second_error:bResult.stderr.trim()||null};evidence.proofs.push(proof);
  return {a:aResult,b:bResult,proof};
 }finally{if(!a.done)a.child.kill('SIGTERM');if(!b.done)b.child.kill('SIGTERM');}
}
async function assertOriginal(o){assert.equal(await fingerprint(o.p_request_id),o.originalHash);}
function gate(name,fn){test(name,{skip:!enabled?'Set COS_CORRECTION_POSTGRES_TEST=1 for isolated real-PostgreSQL concurrency acceptance.':false},fn);}

before(async()=>{
 if(!enabled)return;
 assert.ok(host.startsWith('/tmp/')||host==='127.0.0.1','Only explicit temporary Unix socket or loopback host is allowed.');
 assert.match(port,/^[0-9]{4,5}$/);assert.match(user,/^(cos_concurrency|postgres)$/);
 const server=(await query("select jsonb_build_object('version',version(),'listen_addresses',current_setting('listen_addresses'),'server_address',inet_server_addr(),'port',current_setting('port'),'data_directory',current_setting('data_directory'))::text;",{db:'postgres'})).stdout.trim();
 evidence.server=JSON.parse(server);assert.match(evidence.server.version,/PostgreSQL 17\./,'Acceptance uses PostgreSQL major17.');
 if(host.startsWith('/tmp/')){assert.equal(evidence.server.listen_addresses,'');assert.equal(evidence.server.server_address,null);assert.ok(evidence.server.data_directory.startsWith('/tmp/'));}
 await query('create database '+database+';',{db:'postgres'});created=true;
 await query("do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;",{db:'postgres'});
 await query(correctionFixtureSchema.replace('create role anon;create role authenticated;create role service_role;',''));
 for(const name of correctionMigrationNames)await query(await readFile(new URL('../../database-maintenance/'+name,import.meta.url),'utf8'));
 await query(correctionLegacyReadySql+';'+correctionTestReadySql+';');
 await query(`insert into service_truck_units values(${lit(svc)},'Synthetic old equipment','TEST-OLD','assigned');`);
 contract=JSON.parse(await readFile(new URL('../../transfers/checklist-contract.json',import.meta.url),'utf8'));
});
after(async()=>{
 if(!enabled)return;
 for(const child of children)child.kill('SIGTERM');
 if(created){
  evidence.truck_inventory=await one('select coalesce(jsonb_agg(to_jsonb(t)),\'[]\') from public.service_truck_units t;');
  if(process.env.COS_CORRECTION_PG_EVIDENCE)await writeFile(process.env.COS_CORRECTION_PG_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
  await query('drop database '+database+';',{db:'postgres'});
 }
});

gate('real PostgreSQL: concurrent corrections from the same expected revision commit only one revision',async()=>{
 const o=await issue(),a=await correction(o),b=await correction(o);
 const result=await overlap('cos-same-revision',{name:'submit_techcheck_transfer_correction_v1',args:a},{name:'submit_techcheck_transfer_correction_v1',args:b});
 assert.notEqual(result.b.code,0);assert.match(result.b.stderr,/Handoff changed/);
 const saved=await readback(o.p_transfer_id);assert.equal(saved.revision,2);assert.equal(saved.state,'awaiting_service');assert.equal(saved.corrections,1);assert.equal(saved.audits,1);assert.equal(saved.outbox,1);assert.equal(saved.receipts,0);assert.equal(saved.events,1);assert.deepEqual(saved.reservations,[a.p_items[0].equipment_key]);
 await assertOriginal(o);result.proof.saved=saved;result.proof.original_unchanged=true;
});

gate('real PostgreSQL: a correction blocks stale overlapping Service acceptance',async()=>{
 const o=await issue(),a=await correction(o),b=await receipt(o);
 const result=await overlap('cos-correction-before-receipt',{name:'submit_techcheck_transfer_correction_v1',args:a},{name:'submit_techcheck_transfer_v2',args:b,actor:svc});
 assert.notEqual(result.b.code,0);assert.match(result.b.stderr,/Handoff changed/);
 const saved=await readback(o.p_transfer_id);assert.equal(saved.revision,2);assert.equal(saved.state,'awaiting_service');assert.equal(saved.receipts,0);assert.equal(saved.corrections,1);
 await assertOriginal(o);result.proof.saved=saved;result.proof.original_unchanged=true;
});

gate('real PostgreSQL: an overlapping Service receipt prevents correction of accepted custody',async()=>{
 const o=await issue(),a=await receipt(o),b=await correction(o);
 const result=await overlap('cos-receipt-before-correction',{name:'submit_techcheck_transfer_v2',args:a,actor:svc},{name:'submit_techcheck_transfer_correction_v1',args:b});
 assert.notEqual(result.b.code,0);assert.match(result.b.stderr,/Handoff changed/);
 const retry=await query('begin;'+auth(it)+rpc('submit_techcheck_transfer_correction_v1',{...b,p_expected_revision:2})+'commit;',{allowError:true});assert.notEqual(retry.code,0);assert.match(retry.stderr,/receipt or custody change/);
 const saved=await readback(o.p_transfer_id);assert.equal(saved.revision,2);assert.equal(saved.state,'accepted');assert.equal(saved.receipts,1);assert.equal(saved.corrections,0);assert.equal(saved.audits,0);assert.equal(saved.outbox,0);
 await assertOriginal(o);result.proof.saved=saved;result.proof.original_unchanged=true;
});

gate('real PostgreSQL: different handoffs cannot concurrently reserve the same replacement unit',async()=>{
 const first=await issue(),second=await issue(),replacement=await eq(),a=await correction(first,replacement),b=await correction(second,replacement);
 const result=await overlap('cos-replacement-conflict',{name:'submit_techcheck_transfer_correction_v1',args:a},{name:'submit_techcheck_transfer_correction_v1',args:b});
 assert.notEqual(result.b.code,0);assert.match(result.b.stderr,/another unresolved handoff/);
 const winner=await readback(first.p_transfer_id),loser=await readback(second.p_transfer_id);assert.equal(winner.revision,2);assert.equal(loser.revision,1);assert.equal(loser.corrections,0);assert.deepEqual(winner.reservations,[replacement.equipment_key]);assert.deepEqual(loser.reservations,[second.p_items[0].equipment_key]);
 await assertOriginal(first);await assertOriginal(second);result.proof.saved={winner,loser};result.proof.original_unchanged=true;
});

gate('real PostgreSQL: concurrent exact request retries return one saved correction and one replay',async()=>{
 const o=await issue(),r=await correction(o);
 const result=await overlap('cos-exact-replay',{name:'submit_techcheck_transfer_correction_v1',args:r},{name:'submit_techcheck_transfer_correction_v1',args:r});
 assert.equal(result.b.code,0,result.b.stderr);const replay=JSON.parse(result.b.stdout.trim().split('\n').filter(Boolean).at(-1));assert.equal(replay.replayed,true);assert.equal(replay.correction_id,r.p_request_id);
 const saved=await readback(o.p_transfer_id);assert.equal(saved.revision,2);assert.equal(saved.corrections,1);assert.equal(saved.audits,1);assert.equal(saved.outbox,1);assert.equal(saved.events,1);assert.equal(saved.receipts,0);
 await assertOriginal(o);result.proof.saved=saved;result.proof.original_unchanged=true;result.proof.replayed=true;
 const truck=await one('select jsonb_build_object(\'count\',count(*),\'unit\',min(unit_tag)) from public.service_truck_units;');assert.deepEqual(truck,{count:1,unit:'TEST-OLD'});
});

gate('real PostgreSQL: purpose classification serializes against a stale equipment correction',async()=>{
 const o=await issue({legacy:true}),b=await correction(o);
 const a={p_request_id:randomUUID(),p_transfer_id:o.p_transfer_id,p_expected_revision:1,p_purpose:'truck_replenishment',
  p_items:o.p_items.map(item=>({...item,battery_count:null,battery_configuration:null,required_battery_count:null})),p_reason:'Synthetic IT verified this unclassified handoff replenishes the truck.'};
 const result=await overlap('cos-purpose-before-correction',{name:'classify_techcheck_transfer_purpose_v1',args:a},{name:'submit_techcheck_transfer_correction_v1',args:b});
 assert.notEqual(result.b.code,0);assert.match(result.b.stderr,/Handoff changed/);
 const classified=await readback(o.p_transfer_id);assert.equal(classified.revision,2);assert.equal(classified.purpose_revision,2);assert.equal(classified.corrections,0);assert.equal(classified.receipts,0);
 await execute('submit_techcheck_transfer_correction_v1',{...b,p_expected_revision:2});
 const saved=await readback(o.p_transfer_id);assert.equal(saved.revision,3);assert.equal(saved.purpose,'truck_replenishment');assert.equal(saved.purpose_revision,2);
 assert.equal(saved.state,'awaiting_service');assert.equal(saved.events,2);assert.equal(saved.receipts,0);assert.equal(saved.corrections,1);assert.equal(saved.audits,1);assert.equal(saved.outbox,1);
 await assertOriginal(o);result.proof.classified=classified;result.proof.saved=saved;result.proof.original_unchanged=true;
});

import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {PGlite} from '@electric-sql/pglite';

// Synthetic source queues and folder mappings only. No Google, Supabase or
// production network calls. The reviewed production bindings are replaced only
// in this test harness, never through a runtime bypass in the migration.
const actor='00000000-0000-4000-8000-000000000101';
const other='00000000-0000-4000-8000-000000000102';
const unmapped='00000000-0000-4000-8000-000000000103';
const root='1Ea2F0rQAhx9emvHaqFu4fRIRnYVBYfGH';
const folder='synthetic-technician-folder',otherFolder='synthetic-other-folder';
const roles='create role anon;create role authenticated;create role service_role;';
const schema=`
 create schema auth;create schema app_private;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('role',current_setting('test.jwt_role',true))$$;
 grant usage on schema auth,app_private to authenticated,service_role;
 create table public.profiles(user_id uuid primary key,full_name text,role text default 'it',active boolean default true,archived_at timestamptz);
 create table app_private.techcheck_transfer_events(id uuid primary key,transfer_id uuid not null,actor_id uuid not null references public.profiles(user_id),actor_name text,signed_at timestamptz,kind text default 'checkout',snapshot jsonb default '{}',photos jsonb default '[]');
 create table app_private.techcheck_transfer_outbox(event_id uuid primary key references app_private.techcheck_transfer_events(id),transfer_id uuid,status text,lease_token uuid,locked_until timestamptz,drive_manifest jsonb default '{}');
 create table app_private.service_daily_reports(id uuid primary key,service_tech_id uuid not null references public.profiles(user_id),actor_name text,submitted_at timestamptz,check_date date,delivery_status text,lease_token uuid,locked_until timestamptz,snapshot jsonb default '{}',drive_manifest jsonb default '{}');
 insert into public.profiles(user_id,full_name) values('${actor}','Synthetic Technician'),('${other}','Other Synthetic Technician'),('${unmapped}','Synthetic Technician');
`;
const bindings=`insert into app_private.techcheck_archive_technicians(actor_id,folder_id,folder_name,verified_at,verification_reference) values
 ('${actor}','${folder}','Synthetic Technician','2026-10-21T12:00:00Z','synthetic local fixture'),
 ('${other}','${otherFolder}','Other Synthetic Technician','2026-10-21T12:00:00Z','synthetic local fixture');`;
const enable='update app_private.techcheck_archive_routing_settings set enabled=true where singleton';
let db,source,migration;
before(async()=>{
 source=await readFile(new URL('../../database-maintenance/techcheck-archive-routing-v1.sql',import.meta.url),'utf8');
 const marker=/-- BEGIN VERIFIED TECHNICIAN FOLDER BINDINGS[\s\S]*?-- END VERIFIED TECHNICIAN FOLDER BINDINGS/;
 assert.match(source,marker);migration=source.replace(marker,bindings);
 db=new PGlite();await db.exec(roles+schema);await db.exec(migration);
});
after(async()=>db?.close());
async function as(role,jwt,fn){
 await db.exec('reset role');await db.query("select set_config('test.jwt_role',$1,false)",[jwt]);await db.exec('set role '+role);
 try{return await fn();}finally{await db.exec('reset role');}
}
const rpc=(args,role='service_role',jwt=role)=>as(role,jwt,async()=>
 (await db.query(`select public.techcheck_archive_destination_v1(${Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')}) result`,Object.values(args))).rows[0].result);
const context=(job,data={})=>rpc({p_action:'context',p_source:job.source,p_id:job.id,p_lease:job.lease,p_data:data});
const reserve=(job,kind,candidate,parent,adopted=false)=>rpc({p_action:'reserve',p_source:job.source,p_id:job.id,p_lease:job.lease,p_data:{kind,candidate_id:candidate,parent_id:parent,adopted}});
async function job({source:kind='transfer',who=actor,at='2026-10-22T04:59:59Z',day='2026-10-21',status='processing',expires='10 minutes',eventKind='checkout',originalActor=actor}={}){
 const id=randomUUID(),lease=randomUUID(),transfer=randomUUID();
 if(kind==='transfer'){
  let originalId;
  if(eventKind==='purpose_amendment'){
   originalId=randomUUID();await db.query('insert into app_private.techcheck_transfer_events(id,transfer_id,actor_id,actor_name,signed_at) values($1,$2,$3,$4,$5)',[originalId,transfer,originalActor,'Original submitting technician',at]);
  }
  await db.query('insert into app_private.techcheck_transfer_events(id,transfer_id,actor_id,actor_name,signed_at,snapshot,photos) values($1,$2,$3,$4,$5,$6,$7)',[id,transfer,who,'Saved signer name',at,{signed:'unchanged',...(originalId?{original_event_id:originalId}:{})},[{path:'synthetic-original-photo'}]]);
  if(eventKind!=='checkout')await db.query('update app_private.techcheck_transfer_events set kind=$1 where id=$2',[eventKind,id]);
  await db.query("insert into app_private.techcheck_transfer_outbox values($1,$2,$3,$4,now()+$5::interval,'{\"original\":\"untouched\"}')",[id,transfer,status,lease,expires]);
 }else await db.query("insert into app_private.service_daily_reports values($1,$2,$3,$4,$5,$6,$7,now()+$8::interval,'{\"signed\":\"unchanged\"}','{\"original\":\"untouched\"}')",[id,who,'Saved daily signer',at,day,status,lease,expires]);
 return {source:kind,id,lease};
}
const count=async()=>Number((await db.query('select count(*) n from app_private.techcheck_archive_folders')).rows[0].n);
const originalHash=async()=> (await db.query(`select md5(jsonb_build_object(
 'events',(select jsonb_agg(to_jsonb(e) order by id) from app_private.techcheck_transfer_events e),
 'outbox',(select jsonb_agg(to_jsonb(q) order by event_id) from app_private.techcheck_transfer_outbox q),
 'daily',(select jsonb_agg(to_jsonb(r) order by id) from app_private.service_daily_reports r))::text) hash`)).rows[0].hash;

test('unmodified release SQL installs the four independently verified UUID/folder bindings and rejects a changed profile',async()=>{
 const verified=[
  ['4f7044b5-86b6-411f-8898-39bb64b4ddbc','Teddy Hopper','it','1Im1trPgcC4NIw9eTfaobWTRSpNPlfgvt'],
  ['b7cc3cbf-d11e-4d4a-9742-c07701857911','Victor Garcia','it','1xa5s67_JsQWG5A9XG-6ZHlb1oyVEK4Lm'],
  ['49dce28e-099a-40bb-a8d8-b39f9ffbabee','Josh Mireles','service','1gzBr-u6Xd6i19I7PE0rnB_47Ipi8IWWz'],
  ['78e54fbd-c2db-4d18-8e3d-a9740adcf285','Abel Cervantes','service','1NGanUoAXTVAZDPuHGE-pz6Xt6kkuanU6'],
 ];
 // These are public metadata bindings in an isolated schema, not live users,
 // sessions or source records. Exercise the release seed without replacing it.
 for(const changed of [false,true]){
  const fixture=new PGlite();
  try{
   await fixture.exec(roles+schema);
   for(const [id,name,role] of verified)await fixture.query('insert into public.profiles(user_id,full_name,role) values($1,$2,$3)',[id,name,role]);
   if(changed){
    await fixture.query('update public.profiles set active=false where user_id=$1',[verified[1][0]]);
    await assert.rejects(fixture.exec(source),/Verified technician profile bindings changed/);
    await fixture.exec('rollback');
    assert.equal((await fixture.query("select to_regclass('app_private.techcheck_archive_technicians') value")).rows[0].value,null);
   }else{
    await fixture.exec(source);
    const saved=(await fixture.query('select actor_id,folder_id,folder_name from app_private.techcheck_archive_technicians order by actor_id')).rows;
    assert.deepEqual(saved,verified.map(([actor_id,folder_name,,folder_id])=>({actor_id,folder_id,folder_name})).sort((a,b)=>a.actor_id.localeCompare(b.actor_id)));
    assert.equal((await fixture.query('select enabled from app_private.techcheck_archive_routing_settings')).rows[0].enabled,false);
   }
  }finally{await fixture.close();}
 }
});

test('routing is disabled by default and no client or server role can directly change the registry',async()=>{
 const j=await job(),c=await context(j);assert.equal(c.enabled,false);assert.equal(c.ready,false);assert.equal(c.status,'disabled');assert.equal(await count(),0);
 await assert.rejects(reserve(j,'date','synthetic-date',folder),/awaiting release approval/);
 for(const role of ['anon','authenticated','service_role'])for(const table of ['techcheck_archive_routing_settings','techcheck_archive_technicians','techcheck_archive_folders']){
  const p=(await db.query('select has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE\') allowed',[role,'app_private.'+table])).rows[0];assert.equal(p.allowed,false,role+' '+table);
 }
 const tables=(await db.query("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app_private' and relname in ('techcheck_archive_routing_settings','techcheck_archive_technicians','techcheck_archive_folders')")).rows;
 assert.equal(tables.length,3);assert.ok(tables.every(t=>t.relrowsecurity));
 await db.exec(enable);
});

test('service-only execution, current processing lease and supported action are mandatory',async()=>{
 const j=await job(),args={p_action:'context',p_source:j.source,p_id:j.id,p_lease:j.lease,p_data:{}};
 for(const role of ['anon','authenticated'])await assert.rejects(rpc(args,role,'service_role'),/permission denied/);
 await assert.rejects(rpc(args,'service_role','authenticated'),/Server access/);
 await assert.rejects(rpc({...args,p_id:null}),/Invalid archive/);
 await assert.rejects(rpc({...args,p_lease:randomUUID()}),/lease/);
 await assert.rejects(rpc({...args,p_source:'correction'}),/Invalid archive/);
 await assert.rejects(rpc({...args,p_action:'overwrite'}),/Invalid archive/);
 await assert.rejects(context(await job({expires:'-1 minute'})),/lease/);
 await assert.rejects(context(await job({status:'sent'})),/lease/);
 await assert.rejects(context(await job({source:'daily',status:'queued'})),/lease/);
});

test('source actor UUID and Central date determine routing without a display-name match',async()=>{
 const a=await context(await job()),b=await context(await job({source:'daily'}));
 assert.equal(a.actor_id,actor);assert.equal(a.actor_name,'Saved signer name');assert.equal(a.check_date,'2026-10-21');assert.equal(a.category,'Equipment Transfers');
 assert.equal(b.check_date,a.check_date);assert.equal(b.category,'Truck Inspections');assert.equal(a.technician_folder.id,folder);assert.equal(a.technician_folder.name,'Synthetic Technician');assert.equal(a.root_folder.id,root);
 assert.equal((await context(await job({at:'2026-10-22T05:00:00Z'}))).check_date,'2026-10-22');
 assert.equal((await context(await job({at:'2026-12-02T05:59:59Z'}))).check_date,'2026-12-01');
 await db.query('update public.profiles set full_name=$1 where user_id=$2',['Changed display name',actor]);
 assert.equal((await context(await job())).technician_folder.name,'Synthetic Technician');
 const unknown=await job({who:unmapped}),missing=await context(unknown);assert.equal(missing.ready,false);assert.equal(missing.status,'mapping_required');assert.equal(missing.technician_folder,null);
 await assert.rejects(reserve(unknown,'date','synthetic-unknown-date',folder),/verified technician folder/);
 await assert.rejects(context(await job({source:'daily',day:'2026-10-22'})),/Central submission date/);
 await assert.rejects(context(await job(),{actor_id:other}),/cannot accept/);
});

test('Owner purpose amendment files under the immutable original technician while retaining the actual recorder',async()=>{
 const j=await job({who:unmapped,eventKind:'purpose_amendment'}),before=await originalHash(),c=await context(j);
 assert.equal(c.ready,true);assert.equal(c.actor_id,actor);assert.equal(c.actor_name,'Original submitting technician');
 assert.equal(c.source_actor_id,unmapped);assert.equal(c.source_actor_name,'Saved signer name');assert.equal(c.technician_folder.id,folder);
 const day=await reserve(j,'date','synthetic-purpose-date',folder);await reserve(j,'category','synthetic-purpose-category',day.id);
 assert.equal(await originalHash(),before);
 const missing=await job({who:unmapped,eventKind:'purpose_amendment',originalActor:unmapped});assert.equal((await context(missing)).status,'mapping_required');
 await db.query("update app_private.techcheck_transfer_events set snapshot='{}'::jsonb where id=$1",[missing.id]);await assert.rejects(context(missing),/unavailable/);
});

test('date and category slots have exact canonical parents and cannot accept actor, name or date injection',async()=>{
 const j=await job({at:'2026-10-23T18:00:00Z'});
 await assert.rejects(reserve(j,'category','synthetic-category-before-date','synthetic-date-before-reserved'),/Reserve the canonical date/);
 await assert.rejects(reserve(j,'date','synthetic-bad-parent',otherFolder),/canonical hierarchy/);
 await assert.rejects(reserve(j,'date',root,folder),/conflicts/);
 await assert.rejects(reserve(j,'date',otherFolder,folder),/conflicts/);
 for(const extra of [{actor_id:other},{date:'1999-01-01'},{name:'A guessed folder'}])await assert.rejects(rpc({p_action:'reserve',p_source:j.source,p_id:j.id,p_lease:j.lease,p_data:{kind:'date',candidate_id:'synthetic-injected',parent_id:folder,adopted:false,...extra}}),/Invalid archive folder/);
 await assert.rejects(reserve(j,'date','https://bad.example/folder',folder),/Invalid archive folder/);
 const d=await reserve(j,'date','synthetic-canonical-date-23',folder);assert.deepEqual(d,{id:'synthetic-canonical-date-23',parent_id:folder,name:'2026-10-23',adopted:false});
 await assert.rejects(reserve(j,'category','synthetic-bad-category-parent',otherFolder),/canonical hierarchy/);
 const c=await reserve(j,'category','synthetic-canonical-category-23',d.id);assert.deepEqual(c,{id:'synthetic-canonical-category-23',parent_id:d.id,name:'Equipment Transfers',adopted:false});
 const read=await context(j);assert.deepEqual(read.date_folder,d);assert.deepEqual(read.category_folder,c);
});

test('different jobs share date slots and same-category slots, retaining the first adopted identity',async()=>{
 const a=await job({at:'2026-10-24T18:00:00Z'}),b=await job({source:'daily',at:'2026-10-24T18:00:00Z',day:'2026-10-24'}),c=await job({at:'2026-10-24T19:00:00Z'});
 const d=await reserve(a,'date','synthetic-adopted-date-24',folder,true);
 assert.deepEqual(await reserve(b,'date','synthetic-losing-date-24',folder,false),d);
 const first=await reserve(a,'category','synthetic-adopted-transfer-24',d.id,true);
 assert.deepEqual(await reserve(c,'category','synthetic-losing-transfer-24',d.id,false),first);
 assert.equal(first.adopted,true);assert.equal(first.id,'synthetic-adopted-transfer-24');
 const daily=await reserve(b,'category','synthetic-daily-24',d.id);assert.equal(daily.name,'Truck Inspections');assert.notEqual(daily.id,first.id);
 const slots=(await db.query('select kind,category from app_private.techcheck_archive_folders where actor_id=$1 and check_date=$2',[actor,'2026-10-24'])).rows;assert.equal(slots.length,3);
 await assert.rejects(db.query("update app_private.techcheck_archive_folders set adopted=false where folder_id=$1",[first.id]),/cannot be replaced/);
 await assert.rejects(db.query('delete from app_private.techcheck_archive_folders where folder_id=$1',[d.id]),/cannot be replaced/);
});

test('a Drive ID cannot be reused for another technician, date or category',async()=>{
 const a=await job({at:'2026-10-25T18:00:00Z'}),b=await job({who:other,at:'2026-10-25T18:00:00Z'});
 const d=await reserve(a,'date','synthetic-exclusive-date',folder);
 await assert.rejects(reserve(b,'date',d.id,otherFolder),/duplicate key/);
 await assert.rejects(reserve(a,'category',d.id,d.id),/conflicts/);
 const c=await reserve(a,'category','synthetic-exclusive-category',d.id);
 await assert.rejects(reserve(await job({at:'2026-10-26T18:00:00Z'}),'date',c.id,folder),/duplicate key/);
});

test('routing and replay never mutate signed source records, original queues or their manifests',async()=>{
 const j=await job({at:'2026-10-27T18:00:00Z'}),before=await originalHash();
 const d=await reserve(j,'date','synthetic-preserved-date',folder);await reserve(j,'category','synthetic-preserved-category',d.id,true);await context(j);await reserve(j,'date','synthetic-unused-candidate',folder);
 assert.equal(await originalHash(),before);
 assert.doesNotMatch(source,/(?:update|insert into|delete from)\s+(?:app_private\.(?:techcheck_transfer_events|techcheck_transfer_outbox|service_daily_reports)|public\.(?:equipment_master|unit_registry|service_truck\w*))/i);
 assert.doesNotMatch(source,/net\.http|cron\.schedule|grant\s+.*\b(?:select|insert|update|delete)\b.*\bto\s+(?:public|anon|authenticated|service_role)/i);
});

test('all callable definer permissions are explicit and fixed-search-path; public wrapper is invoker',async()=>{
 const funcs=(await db.query("select n.nspname,p.proname,p.prosecdef,p.proconfig,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('techcheck_archive_destination_v1','techcheck_archive_folder_immutable_v1')")).rows;
 assert.equal(funcs.length,3);
 for(const f of funcs){assert.ok(f.proconfig?.includes('search_path=""'));assert.ok(f.acl);assert.doesNotMatch(f.acl,/(?:^|,)=[^,]*X/);}
 const impl=funcs.find(f=>f.nspname==='app_private'&&f.proname==='techcheck_archive_destination_v1');assert.equal(impl.prosecdef,true);
 assert.equal(funcs.find(f=>f.nspname==='public').prosecdef,false);
 for(const schema of ['public','app_private'])for(const role of ['anon','authenticated'])assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,schema+'.techcheck_archive_destination_v1(text,text,uuid,uuid,jsonb)'])).rows[0].allowed,false);
});

// Actual overlapping-backend proof uses the same isolated PostgreSQL service as
// the correction suite. CI requires it; ordinary offline test runs may skip it.
const pgEnabled=process.env.COS_CORRECTION_POSTGRES_TEST==='1';
if(process.env.COS_CORRECTION_POSTGRES_REQUIRED==='1'&&!pgEnabled)throw new Error('Required PostgreSQL archive-routing concurrency gate was not enabled.');
test('real PostgreSQL: different delivery jobs converge on one date/category ID under overlapping transactions',{skip:!pgEnabled?'Set COS_CORRECTION_POSTGRES_TEST=1 for isolated PostgreSQL concurrency acceptance.':false},async()=>{
 const host=process.env.COS_CORRECTION_PG_HOST||'',port=process.env.COS_CORRECTION_PG_PORT||'',user=process.env.COS_CORRECTION_PG_USER||'';
 assert.ok(host.startsWith('/tmp/')||host==='127.0.0.1');assert.match(port,/^[0-9]{4,5}$/);assert.match(user,/^(cos_concurrency|postgres)$/);
 const name='cos_archive_routing_'+process.pid+'_'+randomUUID().replaceAll('-','').slice(0,10),children=new Set(),proofs=[];
 let created=false;
 const lit=v=>"'"+String(v).replaceAll("'","''")+"'",json=v=>lit(JSON.stringify(v))+'::jsonb';
 function session(label,database=name){
  const env={PATH:process.env.PATH,LANG:'C.UTF-8',PGAPPNAME:label,PGCONNECT_TIMEOUT:'5',PGOPTIONS:'-c statement_timeout=15000 -c lock_timeout=12000 -c idle_in_transaction_session_timeout=20000'};
  if(process.env.COS_CORRECTION_PG_LIBRARY_PATH)env.LD_LIBRARY_PATH=process.env.COS_CORRECTION_PG_LIBRARY_PATH;
  if(host==='127.0.0.1')env.PGPASSWORD='synthetic-ci-only';
  const child=spawn(process.env.COS_CORRECTION_PSQL||'psql',['-X','--no-password','-h',host,'-p',port,'-U',user,'-d',database,'-v','ON_ERROR_STOP=1','-qAt'],{env,stdio:['pipe','pipe','pipe']});
  children.add(child);let out='',err='',done=false;child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
  const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{done=true;children.delete(child);resolve({code,out,err});});});
  return {child,completion,send:q=>child.stdin.write(q),end:q=>child.stdin.end(q),get output(){return out;},get done(){return done;}};
 }
 async function query(sql,database=name){const s=session('cos-archive-observer',database);s.end(sql+'\n');const r=await s.completion;assert.equal(r.code,0,r.err);return r.out.trim();}
 const value=async sql=>JSON.parse((await query(sql)).split('\n').at(-1));
 const auth="set local test.jwt_role='service_role';set local role service_role;";
 const call=(j,kind,id,parent,adopted)=>`select public.techcheck_archive_destination_v1('reserve',${lit(j.source)},${lit(j.id)},${lit(j.lease)},${json({kind,candidate_id:id,parent_id:parent,adopted})})::text;`;
 async function makeJob(kind){const id=randomUUID(),lease=randomUUID(),transfer=randomUUID();
  if(kind==='transfer')await query(`insert into app_private.techcheck_transfer_events(id,transfer_id,actor_id,actor_name,signed_at) values(${lit(id)},${lit(transfer)},${lit(actor)},'Synthetic saved signer','2026-10-22T04:59:59Z');insert into app_private.techcheck_transfer_outbox(event_id,transfer_id,status,lease_token,locked_until) values(${lit(id)},${lit(transfer)},'processing',${lit(lease)},now()+interval '10 minutes');`);
  else await query(`insert into app_private.service_daily_reports(id,service_tech_id,actor_name,submitted_at,check_date,delivery_status,lease_token,locked_until) values(${lit(id)},${lit(actor)},'Synthetic daily signer','2026-10-22T04:59:59Z','2026-10-21','processing',${lit(lease)},now()+interval '10 minutes');`);
  return {source:kind,id,lease};
 }
 async function overlap(label,j1,j2,kind,parent,adopted){
  const firstId='synthetic-'+label+'-winner',secondId='synthetic-'+label+'-loser',a=session(label+'-a'),b=session(label+'-b');
  a.send('begin;'+auth+call(j1,kind,firstId,parent,adopted)+'\n\\echo ARCHIVE_TRANSACTION_HELD\n');
  let deadline=Date.now()+7000;
  while(!a.output.includes('ARCHIVE_TRANSACTION_HELD')){if(a.done)throw new Error(JSON.stringify(await a.completion));if(Date.now()>deadline)throw new Error('First archive reservation never reached its hold marker.');await delay(25);}
  b.end('begin;'+auth+call(j2,kind,secondId,parent,!adopted)+'commit;\n');
  let wait;deadline=Date.now()+7000;
  while(Date.now()<deadline){wait=await value(`select jsonb_build_object('first_pid',a.pid,'first_state',a.state,'second_pid',b.pid,'wait_event_type',b.wait_event_type,'wait_event',b.wait_event,'blocking_pids',to_jsonb(pg_blocking_pids(b.pid))) from pg_stat_activity a cross join pg_stat_activity b where a.application_name=${lit(label+'-a')} and b.application_name=${lit(label+'-b')};`);if(wait?.wait_event_type==='Lock'&&wait.blocking_pids.includes(wait.first_pid))break;if(b.done)throw new Error('No actual overlapping reservation wait occurred.');await delay(25);}
  assert.equal(wait?.first_state,'idle in transaction');assert.equal(wait?.wait_event_type,'Lock');assert.ok(wait.blocking_pids.includes(wait.first_pid));
  a.end('commit;\n');const [ar,br]=await Promise.all([a.completion,b.completion]);assert.equal(ar.code,0,ar.err);assert.equal(br.code,0,br.err);
  const saved=JSON.parse(ar.out.split('\n').find(l=>l.startsWith('{'))),reused=JSON.parse(br.out.split('\n').find(l=>l.startsWith('{')));assert.deepEqual(reused,saved);assert.equal(saved.id,firstId);assert.equal(saved.adopted,adopted);
  proofs.push({case:label,wait,saved,reused});return saved;
 }
 try{
  const server=JSON.parse(await query("select jsonb_build_object('version',version(),'listen_addresses',current_setting('listen_addresses'),'server_address',inet_server_addr(),'data_directory',current_setting('data_directory'))::text;",'postgres'));
  assert.match(server.version,/PostgreSQL 17\./);if(host.startsWith('/tmp/')){assert.equal(server.listen_addresses,'');assert.equal(server.server_address,null);assert.ok(server.data_directory.startsWith('/tmp/'));}
  await query('create database '+name+';','postgres');created=true;
  await query("do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;",'postgres');
  await query(schema);await query(migration);await query(enable);
  const a=await makeJob('transfer'),b=await makeJob('daily'),c=await makeJob('transfer');
  const hashSql="select to_jsonb(md5(jsonb_build_object('events',(select jsonb_agg(to_jsonb(e) order by id) from app_private.techcheck_transfer_events e),'outbox',(select jsonb_agg(to_jsonb(o) order by event_id) from app_private.techcheck_transfer_outbox o),'daily',(select jsonb_agg(to_jsonb(d) order by id) from app_private.service_daily_reports d))::text));";
  const before=await value(hashSql),d=await overlap('cos-archive-date',a,b,'date',folder,false);
  await overlap('cos-archive-category',a,c,'category',d.id,true);
  const rows=await value('select jsonb_agg(to_jsonb(f) order by kind) from app_private.techcheck_archive_folders f;');assert.equal(rows.length,2);assert.equal(await value(hashSql),before);
  const evidence={kind:'synthetic-local-postgresql-archive-routing-concurrency',server,production_calls:0,proofs,registry:rows,source_records_unchanged:true};
  if(process.env.COS_ARCHIVE_PG_EVIDENCE)await writeFile(process.env.COS_ARCHIVE_PG_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
 }finally{
  for(const child of children)child.kill('SIGTERM');
  if(created)await query('drop database '+name+';','postgres');
 }
});

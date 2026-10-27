import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const privateSchema='cos_mhelp_placement_private';
const relation=`${privateSchema}.upload_batches`;
const indexName='cos_mhelp_upload_batches_prior_csv_idx';
const indexRelation=`${privateSchema}.${indexName}`;
const reader=`${privateSchema}.shop_address_baseline(text)`;
const sourceHash='3111c117314dda326c3fe4813f72596bbda92df3d4e0a759c5c3ff380e094624';
const sha=n=>BigInt(n).toString(16).padStart(64,'0');
const sql=async action=>readFile(new URL(`../db/mhelp-upload-prior-csv-index-${action}.sql`,import.meta.url),'utf8');
const shopRows=[
 {productId:'100',unitNumber:'Spotter 100',category:'Spotter',customerId:'shop',customer:'COS',placement:'SHOP',lifecycle:'active',sourceAddress:{street:'Synthetic saved shop'}},
 {productId:'101',unitNumber:'Spotter 101',category:'Spotter',customerId:'field',customer:'Synthetic field',placement:'FIELD',lifecycle:'active',sourceAddress:{street:'Synthetic field address'}}
];

async function fixture(){
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create schema ${privateSchema};
   create table ${relation}(
    source_sha256 text primary key check(source_sha256~'^[a-f0-9]{64}$'),
    payload_sha256 text not null check(payload_sha256~'^[a-f0-9]{64}$'),
    receipt jsonb not null,records jsonb not null,admitted_at timestamptz not null default clock_timestamp());
   alter table ${relation} enable row level security;
   revoke all on ${relation} from public,anon,authenticated,service_role;`);
  await db.exec(await readFile(new URL('../docs/drafts/cos-shop-address-evidence.sql',import.meta.url),'utf8'));
  assert.equal((await db.query(`select encode(sha256(convert_to(pg_get_functiondef($1::regprocedure),'UTF8')),'hex') sha`,[reader])).rows[0].sha,sourceHash);
  const read=async(base=sha(1000))=>(await db.query(`select ${privateSchema}.shop_address_baseline($1) value`,[base])).rows[0].value;
  const add=async({id,time='2026-10-26T00:00:00Z',contract='COS_MHELP_UPLOAD_V1',records=shopRows,receipt:overrides={},badPayload=false})=>{
   const receipt={contract,sourceSha256:sha(id),reviewed:true,recordCount:Array.isArray(records)?records.length:2,
    ...(contract==='COS_MHELP_API_V1'?{origin:'mhelpdesk_api',portalId:'224643',complete:true}:{}),...overrides};
   await db.query(`insert into ${relation}(source_sha256,payload_sha256,receipt,records,admitted_at)
    values($1,case when $5 then repeat('f',64) else encode(sha256(convert_to(jsonb_build_object('receipt',$2::jsonb,'records',$3::jsonb)::text,'UTF8')),'hex') end,$2::jsonb,$3::jsonb,$4::timestamptz)`,
   [sha(id),JSON.stringify(receipt),JSON.stringify(records),time,badPayload]);
  };
  const reset=async()=>{await db.exec(`truncate ${relation}`);await add({id:1000,time:'2026-10-27T12:00:00Z',contract:'COS_MHELP_API_V1'});};
  const state=async()=> (await db.query(`select jsonb_build_object(
   'rows',(select jsonb_agg(to_jsonb(b) order by b.source_sha256) from ${relation} b),
   'functions',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='${privateSchema}'),
   'security',(select jsonb_build_object('owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity) from pg_class c where c.oid='${relation}'::regclass),
   'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p where p.polrelid='${relation}'::regclass),
   'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t where t.tgrelid='${relation}'::regclass)) value`)).rows[0].value;
  const index=async()=> (await db.query(`select i.indexrelid::int oid,pg_catalog.pg_get_indexdef(i.indexrelid) definition,i.indisunique,i.indisvalid,i.indisready,i.indislive
   from pg_index i where i.indexrelid=to_regclass($1)`,[indexRelation])).rows;
  return {db,read,add,reset,state,index};
 }catch(error){await db.close();throw error;}
}

async function attempt(read){
 try{return {value:await read()};}
 catch(error){return {error:{code:error.code,message:error.message,detail:error.detail??null,hint:error.hint??null}};}
}

test('prior CSV index preserves exact latest-earlier selection, full results and validation errors',async()=>{
 const f=await fixture();
 try{
  const install=await sql('install'),rollback=await sql('rollback');
  const cases=[
   {name:'no prior CSV',run:async()=>{},check:r=>assert.equal(r.value,null)},
   {name:'valid saved Shop rows',run:()=>f.add({id:1}),check:r=>assert.deepEqual(r.value.records,[shopRows[0]])},
   {name:'later API receipts do not hide prior CSV',run:async()=>{await f.add({id:1});await f.add({id:2,time:'2026-10-27T01:00:00Z',contract:'COS_MHELP_API_V1'});},check:r=>assert.equal(r.value.sourceSha256,sha(1))},
   {name:'equal-time CSV uses descending source SHA',run:async()=>{await f.add({id:1});await f.add({id:2});},check:r=>assert.equal(r.value.sourceSha256,sha(2))},
   {name:'base-time and future CSV are excluded',run:async()=>{await f.add({id:1});await f.add({id:2,time:'2026-10-27T12:00:00Z'});await f.add({id:3,time:'2026-10-28T00:00:00Z'});},check:r=>assert.equal(r.value.sourceSha256,sha(1))},
   {name:'latest invalid CSV is not skipped for older valid evidence',run:async()=>{await f.add({id:1});await f.add({id:2,time:'2026-10-27T01:00:00Z',receipt:{reviewed:false}});},check:r=>assert.equal(r.value,null)},
   {name:'equal-time higher SHA remains selected even when invalid',run:async()=>{await f.add({id:1});await f.add({id:2,receipt:{reviewed:false}});},check:r=>assert.equal(r.value,null)},
   {name:'wrong history source identity stays invalid',run:()=>f.add({id:1,receipt:{sourceSha256:sha(99)}}),check:r=>assert.equal(r.value,null)},
   {name:'bad history payload hash stays invalid',run:()=>f.add({id:1,badPayload:true}),check:r=>assert.equal(r.value,null)},
   {name:'duplicate historical Product IDs stay invalid',run:()=>f.add({id:1,records:[shopRows[0],shopRows[0]]}),check:r=>assert.equal(r.value,null)},
   {name:'latest malformed count still raises its original error',run:async()=>{await f.add({id:1});await f.add({id:2,receipt:{recordCount:'invalid'}});},check:r=>assert.equal(r.error.code,'22P02')},
   {name:'nonarray historical records still raise their original error',run:()=>f.add({id:1,records:{malformed:true}}),check:r=>assert.equal(r.error.code,'22023')},
   {name:'missing base remains null',run:()=>f.add({id:1}),read:()=>f.read(sha(9999)),check:r=>assert.equal(r.value,null)},
   {name:'CSV is not an API base',run:()=>f.add({id:1}),read:()=>f.read(sha(1)),check:r=>assert.equal(r.value,null)}
  ];
  for(const scenario of cases){
   await f.reset();await scenario.run();const preserved=await f.state();const read=scenario.read??f.read;
   const before=await attempt(read);scenario.check(before);await f.db.exec(install);
   assert.deepEqual(await attempt(read),before,scenario.name);assert.deepEqual(await f.state(),preserved,scenario.name);
   await f.db.exec(rollback);assert.deepEqual(await attempt(read),before,scenario.name+' after rollback');
  }
 }finally{await f.db.close();}
});

test('index-only release is exact, idempotent, reversible and preserves privileges and settings',async()=>{
 const f=await fixture();
 try{
  const install=await sql('install'),rollback=await sql('rollback');
  for(const ddl of [install,rollback]){
   assert.match(ddl,/set local lock_timeout='2s'/);assert.match(ddl,/pg_try_advisory_xact_lock/);
   assert.doesNotMatch(ddl,/\b(?:alter|grant|revoke|insert|update|delete|truncate|analyze)\s+(?:table|function|role|schema|index|on|into|from|cos_mhelp)/i);
   assert.doesNotMatch(ddl,/set\s+(?:local\s+)?(?:statement_timeout|work_mem|enable_\w+)/i);
  }
  await f.reset();await f.add({id:1});
  await f.db.exec("create schema synthetic_shadow;create function synthetic_shadow.pg_get_indexdef(oid) returns text language sql as $$select 'shadowed'::text$$;set search_path=synthetic_shadow,public,pg_catalog;set statement_timeout='8s';set work_mem='2184kB'");
  const settings=async()=> (await f.db.query("select current_setting('search_path') search_path,current_setting('statement_timeout') timeout,current_setting('work_mem') memory")).rows[0];
  const before=await f.state(),beforeSettings=await settings(),expected=await f.read();
  await f.db.exec(install);const installed=await f.index();assert.equal(installed.length,1);
  assert.equal(installed[0].indisunique,false);for(const key of ['indisvalid','indisready','indislive'])assert.equal(installed[0][key],true);
  assert.match(installed[0].definition,/admitted_at DESC, source_sha256 DESC/);
  assert.match(installed[0].definition,/WHERE \(\(receipt ->> 'contract'::text\) = 'COS_MHELP_UPLOAD_V1'::text\)/);
  await f.db.exec(install);assert.deepEqual(await f.index(),installed);assert.deepEqual(await f.state(),before);assert.deepEqual(await settings(),beforeSettings);
  for(const role of ['anon','authenticated','service_role']){
   await f.db.exec('set role '+role);
   try{await assert.rejects(()=>f.read(),e=>e.code==='42501');await assert.rejects(()=>f.db.query(`select * from ${relation}`),e=>e.code==='42501');}
   finally{await f.db.exec('reset role');}
  }
  assert.deepEqual(await f.read(),expected);await f.db.exec(rollback);await f.db.exec(rollback);
  assert.deepEqual(await f.index(),[]);assert.deepEqual(await f.state(),before);assert.deepEqual(await settings(),beforeSettings);
 }finally{await f.db.close();}
});

test('install and rollback fail closed on function, schema, index and postcondition drift',async()=>{
 const f=await fixture();
 try{
  const install=await sql('install'),rollback=await sql('rollback');await f.reset();await f.add({id:1});
  const reject=async(ddl,mutation)=>{
   const before=await f.state(),indexes=await f.index();await f.db.exec('begin');
   try{await f.db.exec(mutation);await assert.rejects(()=>f.db.exec(ddl),e=>e.code==='55000');}
   finally{await f.db.exec('rollback');}
   assert.deepEqual(await f.state(),before);assert.deepEqual(await f.index(),indexes);
  };
  const drift=[
   `alter function ${reader} cost 101`,
   `grant execute on function ${reader} to authenticated`,
   `alter table ${relation} disable row level security`,
   `alter table ${relation} add column unexpected text`,
   `create index synthetic_other_index on ${relation}(payload_sha256)`
  ];
  for(const mutation of drift)await reject(install,mutation);
  await reject(install,`create table ${indexRelation}(unexpected text)`);
  await reject(install,`create index ${indexName} on ${relation}(admitted_at)`);
  const broken=install.replace('end $migration$;',"raise exception 'Synthetic post-DDL failure' using errcode='55000';\nend $migration$;");
  assert.notEqual(broken,install);const before=await f.state();await assert.rejects(()=>f.db.exec(broken),e=>e.code==='55000');await f.db.exec('rollback');
  assert.deepEqual(await f.index(),[]);assert.deepEqual(await f.state(),before);
  await f.db.exec(install);
  for(const mutation of drift)await reject(rollback,mutation);
  await reject(rollback,`drop index ${indexRelation};create index ${indexName} on ${relation}(admitted_at desc,source_sha256 desc) where receipt->>'contract'='COS_MHELP_API_V1'`);
  const brokenRollback=rollback.replace('end $migration$;',"raise exception 'Synthetic post-drop failure' using errcode='55000';\nend $migration$;");
  const installed=await f.index();await assert.rejects(()=>f.db.exec(brokenRollback),e=>e.code==='55000');await f.db.exec('rollback');assert.deepEqual(await f.index(),installed);
  await f.db.exec(rollback);
 }finally{await f.db.close();}
});

test('captured native planner costs select the partial index and avoid detoasting unrelated receipts',async context=>{
 const f=await fixture();
 try{
  // Mirror captured native planner costs only inside this disposable fixture.
  // The release SQL never changes planner settings or runs ANALYZE.
  await f.db.exec("set random_page_cost=1.1;set seq_page_cost=1;set cpu_tuple_cost=0.01;set cpu_index_tuple_cost=0.005;set cpu_operator_cost=0.0025;set effective_cache_size='384MB'");
  await f.db.exec(`insert into ${relation}
   select lpad(to_hex(g),64,'0'),repeat('a',64),
    jsonb_build_object('contract',case when g<3 then 'COS_MHELP_UPLOAD_V1' else 'COS_MHELP_API_V1' end,
     'opaque',(select jsonb_agg(md5(x::text)) from generate_series(1,512)x)),
    '[]'::jsonb,'2026-09-01T00:00:00Z'::timestamptz+g*interval '1 hour'
   from generate_series(1,84)g;
   analyze ${relation};`);
  const selection=`select history.* from ${relation} history
   where history.admitted_at<(select base.admitted_at from ${relation} base where base.source_sha256=$1)
    and history.receipt->>'contract'='COS_MHELP_UPLOAD_V1'
   order by history.admitted_at desc,history.source_sha256 desc limit 1`;
  const plan=async()=> (await f.db.query('explain(analyze,buffers,format json) '+selection,[sha(84)])).rows[0]['QUERY PLAN'][0];
  const nodes=p=>[p,...(p.Plans??[]).flatMap(nodes)];
  const expected=(await f.db.query(selection,[sha(84)])).rows;
  assert.equal(expected[0].source_sha256,sha(2));const before=await plan();
  assert.ok(nodes(before.Plan).some(p=>p['Node Type']==='Seq Scan'&&p.Alias==='history'));
  await f.db.exec(await sql('install'));const after=await plan();
  assert.deepEqual((await f.db.query(selection,[sha(84)])).rows,expected);
  assert.ok(nodes(after.Plan).some(p=>p['Index Name']===indexName),'Default captured native costs must actually choose the new index');
  assert.ok(!nodes(after.Plan).some(p=>p['Node Type']==='Seq Scan'&&p.Alias==='history'));
  assert.ok(after.Plan['Shared Hit Blocks']<before.Plan['Shared Hit Blocks']);
  context.diagnostic(`Synthetic shared-buffer hits: ${before.Plan['Shared Hit Blocks']} before, ${after.Plan['Shared Hit Blocks']} after; native production readback remains required.`);
  await f.db.exec(await sql('rollback'));assert.deepEqual((await f.db.query(selection,[sha(84)])).rows,expected);
 }finally{await f.db.close();}
});

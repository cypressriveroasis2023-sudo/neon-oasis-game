// Disposable hosted PostgreSQL 17.6 only. No provider/native project connection.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {fixture,inputManifest,REVIEWED_RECEIPT_SHA256,ORG,ACTOR,SOURCE,AUTH,id,native} from './fixtures/source-equipment-receipts-postgres.mjs';
import {prechecks,readerChecks,revokedChecks,products} from './fixtures/source-equipment-receipts-proof.mjs';

const raw=process.env.COS_RECEIPTS_TEST_DATABASE_URL;
if(process.env.COS_RECEIPTS_POSTGRES_CI!=='1'||process.env.GITHUB_ACTIONS!=='true'||!raw)
  throw Error('Explicit synthetic hosted-CI opt-in required; no local PostgreSQL execution.');
const url=new URL(raw);
if(!['postgres:','postgresql:'].includes(url.protocol)||url.search||url.hash||
  url.hostname!=='127.0.0.1'||url.port!=='5432'||url.pathname!=='/cos_source_receipts_test_ci'||
  url.username!=='postgres'||url.password!=='synthetic-ci-only')
  throw Error('Only the dedicated disposable loopback PostgreSQL CI service is allowed.');
const require=createRequire(new URL('../legacy/tests/recon-ordering/package.json',import.meta.url));
assert.equal(require('pg/package.json').version,'8.16.3','Use the existing pinned client only');
const {Client}=require('pg');
const clients=[],passed=[],contentionReadMs=[];
let f,g,a,b,timing,failedCase,postgresVersion,status='failed',failure;
const params=values=>values?.map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v);
const adapter=c=>({exec:sql=>c.query(sql),query:(sql,args)=>c.query(sql,params(args))});
const connect=async name=>{
  const c=new Client({connectionString:url.href,application_name:'cos_source_receipts_test_'+name,connectionTimeoutMillis:5000});
  await c.connect();clients.push(c);
  await c.query("set statement_timeout='8s';set lock_timeout='5s';set time zone 'UTC'");return c;
};
const test=async(name,fn)=>{failedCase=name;await fn();passed.push(name);console.log('PASS '+name);failedCase=null;};
const settle=p=>p.then(value=>({value}),error=>({error}));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitBlocked(observer,blocked){
  const end=performance.now()+1500;
  while(performance.now()<end){
    // Activity snapshots are transaction-local; refresh before each observation.
    await observer.query('select pg_stat_clear_snapshot()');
    const row=(await observer.query('select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[blocked.processID])).rows[0];
    if(row?.wait_event_type==='Lock'&&row.blockers.includes(observer.processID))return;
    await delay(10);
  }
  throw Error('Expected an observed PostgreSQL wait on the other client, not a sleep-based race.');
}
async function assertNoReceipts(){assert.equal((await f.counts()).receipts,0);}
try {
  a=await connect('left');b=await connect('right');
  const identity=(await a.query('select current_database() db,current_user role,current_setting(\'server_version_num\') version')).rows[0];
  assert.deepEqual(identity,{db:'cos_source_receipts_test_ci',role:'postgres',version:'170006'});
  postgresVersion=(await a.query('show server_version')).rows[0].server_version;
  assert.equal((await a.query(`select count(*)::int n from pg_namespace where nspname in('app_private','cos_mhelp_placement_private')`)).rows[0].n,0,
    'Refuse any preexisting application schema');
  assert.equal((await a.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p','v','m','S')")).rows[0].n,0,
    'Refuse a populated disposable database');
  f=await fixture(adapter(a));
  // The second client shares the same captured values without creating another schema.
  g={...f,db:adapter(b)};
  g.admit=async(rs=f.receipts,authorization=AUTH)=>(await b.query('select cos_mhelp_placement_private.review_source_equipment_estimates($1,$2,$3,$4,$5) result',
    params([SOURCE,'b'.repeat(64),await f.hash(rs),rs,authorization]))).rows[0].result;
  g.revoke=async(ids=f.receipts.map(r=>r.receiptId),authorization=AUTH)=>(await b.query(
    'select cos_mhelp_placement_private.revoke_source_equipment_estimates($1::uuid[],$2) result',[`{${ids.join(',')}}`,authorization])).rows[0].result;
  await prechecks(f,test);
  await test('existing Owner-history writer forces admission NOWAIT with no partial receipt writes',async()=>{
    await b.query('begin');
    try {
      await b.query("insert into public.equipment_unit_location_history(equipment_unit_id,note) values($1,'Synthetic in-flight Owner move')",[native(1)]);
      const start=performance.now();await assert.rejects(()=>f.admit(),e=>e.code==='55P03');assert.ok(performance.now()-start<1500);
    } finally { await b.query('rollback'); }
    await assertNoReceipts();
  });
  await test('admission blocks a real Owner-history phantom until rollback',async()=>{
    await a.query('begin');await f.admit();
    await b.query('begin');
    const pending=settle(b.query("insert into public.equipment_unit_location_history(equipment_unit_id,note) values($1,'Synthetic waiting Owner move')",[native(1)]));
    try { await waitBlocked(a,b); } finally { await a.query('rollback'); }
    const result=await pending;assert.ifError(result.error);await b.query('rollback');await assertNoReceipts();
  });
  await test('waiting admission rechecks an active head committed by the other client',async()=>{
    await b.query('begin');await b.query('update cos_mhelp_placement_private.upload_control set active_sha256=null');
    const pending=settle(f.admit());
    try { await waitBlocked(b,a); } finally { await b.query('commit'); }
    const result=await pending;assert.match(result.error?.message??'',/Active upload changed/);await assertNoReceipts();
    assert.equal(await f.read(),null);
    await b.query('update cos_mhelp_placement_private.upload_control set active_sha256=$1',[SOURCE]);
  });
  await test('two clients admit the identical three receipts exactly once',async()=>{
    const authority=await f.state(false);
    await a.query('begin');assert.equal((await f.admit()).receipts,3);
    const pending=settle(g.admit());
    try { await waitBlocked(a,b); } finally { await a.query('commit'); }
    const result=await pending;assert.ifError(result.error);assert.equal(result.value.receipts,3);
    assert.equal((await f.counts()).receipts,3);assert.deepEqual(await f.state(false),authority);
  });
  // Bound healthy synthetic SQL, independently of the application transport cap.
  await a.query("set statement_timeout='1500ms'");
  timing=await readerChecks(f,test);
  await a.query("set statement_timeout='8s'");
  await test('different concurrent admission replay is rejected without changing the three receipts',async()=>{
    const before=await f.state();await a.query('begin');await f.admit();
    const pending=settle(g.admit(f.receipts,'d'.repeat(64)));
    try { await waitBlocked(a,b); } finally { await a.query('commit'); }
    const result=await pending;assert.match(result.error?.message??'',/Receipt replay differs/);assert.deepEqual(await f.state(),before);
  });
  await test('MVCC reader ignores uncommitted Owner history, retains a repeatable snapshot, then suppresses the committed change',async()=>{
    await a.query('begin isolation level repeatable read read only');
    await a.query("set local role service_role;set local statement_timeout='1500ms'");
    const measuredSnapshot=async()=>{const start=performance.now();const result=await f.snapshot();contentionReadMs.push(performance.now()-start);return result;};
    assert.deepEqual(products(await measuredSnapshot()),['1','2','3']);
    await b.query('begin');
    await b.query("insert into public.equipment_unit_location_history(id,equipment_unit_id,note) values($1,$2,'Synthetic concurrent committed history')",[id(0,9001),native(1)]);
    assert.deepEqual(products(await measuredSnapshot()),['1','2','3']);
    await b.query('commit');
    assert.deepEqual(products(await measuredSnapshot()),['1','2','3'],'Repeatable-read snapshot is stable, not fresh after an external commit');
    await a.query('rollback');
    assert.ok(Math.max(...contentionReadMs)<1500,'Reader must not wait on an uncommitted history writer');
    const before=await f.state();assert.deepEqual(products(await f.read()),['2','3']);assert.deepEqual(await f.state(),before);
    await assert.rejects(()=>f.admit(),/Source linkage graph changed/);
    // Undo only this synthetic mutable history row; immutable authority is never weakened.
    await b.query('delete from public.equipment_unit_location_history where id=$1',[id(0,9001)]);
    assert.deepEqual(products(await f.read()),['1','2','3']);
  });
  await test('READ COMMITTED reader sees a committed linkage change on its next statement',async()=>{
    await a.query('begin read only');await a.query('set local role service_role');
    assert.deepEqual(products(await f.snapshot()),['1','2','3']);
    await b.query("update app_private.cos_geocode_sources set street='Changed Synthetic Lane' where product_id='2'");
    assert.deepEqual(products(await f.snapshot()),['1','3']);await a.query('rollback');
    await assert.rejects(()=>f.admit(),/Source linkage graph changed/);
    await b.query("update app_private.cos_geocode_sources set street='2 Synthetic Receipt Lane' where product_id='2'");
  });
  await test('new committed Owner ProductId claim suppresses the formerly empty target graph',async()=>{
    await b.query(`insert into app_private.cos_owner_identity_claims(id,organization_id,native_unit_id,native_unit_label,legacy_unit_key,
      device_ids,resource_epoch,source_epoch,physical_digest,provenance,confirmation_text,evidence_ref,product_association,
      confirmed_by,request_id,request_payload) values($1,$2,$3,'Synthetic unit 3','SYNTHETIC-3',array['1003'],$4,$4,$4,
      'owner_confirmation','Synthetic confirmation','synthetic:fixture','{"productId":"3"}',$5,$6,'{}')`,
      [id(5,3),ORG,native(3),SOURCE,ACTOR,id(8,3)]);
    const before=await f.state();assert.deepEqual(products(await f.read()),['1','2']);assert.deepEqual(await f.state(),before);
    await assert.rejects(()=>f.admit(),/Source linkage graph changed/);
    // The immutable Owner claim is retained through all remaining tests.
  });
  await test('head/payload replacement suppresses every prior receipt and restoration is exact',async()=>{
    await b.query("insert into cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records) select repeat('d',64),repeat('e',64),receipt,records from cos_mhelp_placement_private.upload_batches where source_sha256=$1",[SOURCE]);
    await b.query("update cos_mhelp_placement_private.upload_control set active_sha256=repeat('d',64)");
    const result=await f.read();assert.equal(result.sourceSha256,'d'.repeat(64));assert.deepEqual(products(result),[]);
    await assert.rejects(()=>f.admit(),/Active upload changed/);
    await b.query('update cos_mhelp_placement_private.upload_control set active_sha256=$1',[SOURCE]);
    assert.deepEqual(products(await f.read()),['1','2']);
  });
  await test('overlapping two-client revocations serialize and identical replay tombstones once',async()=>{
    await a.query('begin');assert.equal(await f.revoke(f.receipts.slice(0,2).map(r=>r.receiptId)),2);
    const pending=settle(g.revoke([...f.receipts].reverse().map(r=>r.receiptId)));
    try { await waitBlocked(a,b); } finally { await a.query('commit'); }
    const result=await pending;assert.ifError(result.error);assert.equal(result.value,3);
    assert.equal((await f.counts()).revocations,3);assert.deepEqual(products(await f.read()),[]);
  });
  await test('concurrent conflicting revocation replay cannot overwrite append-only authorization',async()=>{
    const before=await f.state();await a.query('begin');await f.revoke();
    const pending=settle(g.revoke(undefined,'d'.repeat(64)));
    try { await waitBlocked(a,b); } finally { await a.query('commit'); }
    const result=await pending;assert.match(result.error?.message??'',/Revocation replay differs/);assert.deepEqual(await f.state(),before);
  });
  await revokedChecks(f,test);
  status='passed';
} catch(error) {
  failure={name:error.name,code:error.code??null,message:error.message};throw error;
} finally {
  for(const c of clients)await c.query('rollback').catch(()=>{});
  const counts=f?await f.counts().catch(()=>null):null;
  await writeFile('source-equipment-receipts-postgres-results.json',JSON.stringify({
    status,syntheticOnly:true,execution:'hosted PostgreSQL, two independent clients',productionWrites:0,providerCalls:0,
    postgresVersion,pgClientVersion:'8.16.3',commit:process.env.GITHUB_SHA??null,reviewedReceiptSha256:REVIEWED_RECEIPT_SHA256,
    tenantAdaptation:'Exactly one reader tenant literal and four matching dependency constraints remapped to synthetic tenant; all logic retained',
    limitations:['Synthetic auth boundary; not deployed actor authorization','First measured call is not a cold OS/DB-cache benchmark',
      'Representative synthetic workload, not live latency/SLA','Native tables are bounded synthetic dependency shapes; no production trigger bundle',
      'Exactly three receipts only; the production reader has no global receipt cap',
      'No claim about application abort propagation or backend cancellation'],
    sqlInputs:inputManifest,passed,failedCase,failure,timing,contentionReadMs,counts},null,2)+'\n');
  for(const c of clients)await c.end().catch(()=>{});
}

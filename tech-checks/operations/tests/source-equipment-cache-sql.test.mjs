import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORG, ACTOR, SOURCE, PAYLOAD, AUTH, id, native, tracker, claim, archive,
  receiptSql, withDb, seedPair, seedSource, seedLink, seedClaim, seedArchive,
  seedCoordinates, seedGraph,
} from './fixtures/source-equipment-cache-fixture.mjs';

test('three reviewed cache receipts remain separate from all native/upload data and read in READ ONLY',withDb(async f=>{const before=(await f.db.query('select (select jsonb_agg(t) from cos_mhelp_placement_private.upload_batches t) upload,(select jsonb_agg(t) from public.unchanged_native_inventory t) native')).rows;assert.equal((await f.admit()).receipts,3);const r=await f.read();assert.equal(r.records.length,3);assert.equal(r.sourceSha256,SOURCE);assert.ok(r.records.every(x=>x.verified===false&&x.liveGps===false&&x.uploadRecord.customerId==='456'));assert.deepEqual((await f.db.query('select (select jsonb_agg(t) from cos_mhelp_placement_private.upload_batches t) upload,(select jsonb_agg(t) from public.unchanged_native_inventory t) native')).rows,before);assert.equal((await f.admit()).receipts,3);assert.equal((await f.db.query('select count(*) n from cos_mhelp_placement_private.source_equipment_estimates')).rows[0].n,3);}));
test('admission and revocation deny API roles; snapshot uses existing actor/view checks',withDb(async f=>{for(const role of ['anon','authenticated','service_role']){await f.db.exec(`set role ${role}`);await assert.rejects(f.admit());await assert.rejects(f.db.query('select cos_mhelp_placement_private.revoke_source_equipment_estimates($1,$2)',[[f.receipts[0].receiptId],AUTH]));await f.db.exec('reset role');}for(const role of ['anon','authenticated'])await assert.rejects(f.read(role),/permission denied/);await assert.rejects(f.read('service_role','33333333-3333-4333-8333-333333333333'),/Invalid actor/);await assert.rejects(f.read('service_role',ACTOR,null),/Equipment view required/);await f.db.exec("set test.permission='false'");await assert.rejects(f.read(),/Equipment view required/);}));
test('partial admission failure is atomic; changed hashes, extra/duplicate rows and stale source fail closed',withDb(async f=>{const r=structuredClone(f.receipts);r[1].cacheEvidence.latitude=91; r[1].cacheEvidenceSha256=await f.hash(r[1].cacheEvidence);await assert.rejects(f.admit(r),/cache evidence/);assert.equal((await f.read()).records.length,0);for(const rs of [[f.receipts[0],f.receipts[0]],Array(4).fill(f.receipts[0]),[{...f.receipts[0],extra:true}]])await assert.rejects(f.admit(rs));await assert.rejects(f.admit(f.receipts,SOURCE,PAYLOAD,'d'.repeat(64)));await assert.rejects(f.admit(f.receipts,'d'.repeat(64)),/Active upload changed/);const changed=structuredClone(f.receipts);changed[0].cacheEvidenceSha256='d'.repeat(64);await assert.rejects(f.admit(changed));}));
test('full immutable record hash protects customer ID/text, source address, label and lifecycle at admission',withDb(async f=>{for(const [key,value] of [['customerId','789'],['customer','Different'],['unitNumber','Different'],['lifecycle','DO_NOT_USE'],['placement','SHOP'],['binding',{nativeUnitId:'new'}],['placementHeld',true],['possibleAliasUnitIds',['candidate']],['sourceAddress',{...f.upload[0].sourceAddress,street:'9 Main St'}]]){const u=structuredClone(f.upload);u[0][key]=value;await f.db.query('update cos_mhelp_placement_private.upload_batches set records=$1',[u]);await assert.rejects(f.admit());}await f.db.query('update cos_mhelp_placement_private.upload_batches set records=$1',[f.upload]);assert.equal((await f.admit()).receipts,3);}));
test('read drops revoked, stale-head, changed lifecycle/address/customer/linkage and duplicate identity receipts',withDb(async f=>{await f.admit();for(const edit of [u=>u[0].customerId='789',u=>u[0].customer='Other',u=>u[0].sourceAddress.street='9 Main St',u=>u[0].placement='SHOP',u=>u[0].lifecycle='MISSING',u=>u[0].binding={nativeUnitId:'new'},u=>u[0].placementHeld=true,u=>u.push({...u[0]})]){const u=structuredClone(f.upload);edit(u);await f.db.query('update cos_mhelp_placement_private.upload_batches set records=$1',[u]);assert.equal((await f.read()).records.length,2);}await f.db.query('update cos_mhelp_placement_private.upload_batches set records=$1',[f.upload]);await f.db.exec('update cos_mhelp_placement_private.upload_control set active_sha256=null');assert.equal(await f.read(),null);}));
test('append-only narrow revocation is idempotent and cannot resurrect a receipt',withDb(async f=>{await f.admit();const ids=[f.receipts[0].receiptId],revoke=()=>f.db.query('select cos_mhelp_placement_private.revoke_source_equipment_estimates($1,$2)',[ids,AUTH]);await revoke();await revoke();assert.equal((await f.read()).records.length,2);await assert.rejects(f.admit(),/revoked/);for(const statement of ['update cos_mhelp_placement_private.source_equipment_estimates set product_id=product_id','delete from cos_mhelp_placement_private.source_equipment_estimates','truncate cos_mhelp_placement_private.source_equipment_estimates cascade','delete from cos_mhelp_placement_private.source_equipment_estimate_revocations'])await assert.rejects(f.db.exec(statement),/append-only/);assert.equal((await f.read()).records.length,2);}));
test('revocation rejects a different authorization replay and a conflict inserted before its write',withDb(async f=>{await f.admit();const ids=[f.receipts[0].receiptId];await f.db.query('select cos_mhelp_placement_private.revoke_source_equipment_estimates($1,$2)',[ids,AUTH]);await assert.rejects(f.db.query('select cos_mhelp_placement_private.revoke_source_equipment_estimates($1,$2)',[ids,'d'.repeat(64)]),/Revocation replay differs/);
 await f.db.exec(`create function cos_mhelp_placement_private.inject_revocation_conflict() returns trigger language plpgsql as $$begin if pg_trigger_depth()=1 then insert into cos_mhelp_placement_private.source_equipment_estimate_revocations values(new.receipt_id,repeat('e',64),clock_timestamp());end if;return new;end$$;create trigger synthetic_conflict before insert on cos_mhelp_placement_private.source_equipment_estimate_revocations for each row execute function cos_mhelp_placement_private.inject_revocation_conflict();`);
 await assert.rejects(f.db.query('select cos_mhelp_placement_private.revoke_source_equipment_estimates($1,$2)',[[f.receipts[1].receiptId],AUTH]),/Revocation replay differs/);assert.equal((await f.db.query('select count(*) n from cos_mhelp_placement_private.source_equipment_estimate_revocations')).rows[0].n,1);
 await f.db.exec('begin isolation level repeatable read');try{await assert.rejects(f.db.query('select cos_mhelp_placement_private.revoke_source_equipment_estimates($1,$2)',[[f.receipts[2].receiptId],AUTH]),/Read committed/);}finally{await f.db.exec('rollback');}
}));

const products = result => result.records.map(record => record.productId);
const snapshots = async f => (await f.db.query(`select jsonb_build_object(
  'uploads',(select jsonb_agg(to_jsonb(t)) from cos_mhelp_placement_private.upload_batches t),
  'control',(select jsonb_agg(to_jsonb(t)) from cos_mhelp_placement_private.upload_control t),
  'native',(select jsonb_agg(to_jsonb(t)) from public.equipment_units t),
  'trackers',(select jsonb_agg(to_jsonb(t)) from app_private.vision_tracker_locations t),
  'history',(select jsonb_agg(to_jsonb(t)) from public.equipment_unit_location_history t),
  'sources',(select jsonb_agg(to_jsonb(t)) from app_private.cos_geocode_sources t),
  'links',(select jsonb_agg(to_jsonb(t)) from cos_mhelp_placement_private.links t),
  'claims',(select jsonb_agg(to_jsonb(t)) from app_private.cos_owner_identity_claims t),
  'resources',(select jsonb_agg(to_jsonb(t)) from app_private.cos_owner_identity_resources t),
  'ownerRevocations',(select jsonb_agg(to_jsonb(t)) from app_private.cos_owner_identity_revocations t),
  'archives',(select jsonb_agg(to_jsonb(t)) from app_private.cos_archived_representations t),
  'archiveRevocations',(select jsonb_agg(to_jsonb(t)) from app_private.cos_archived_representation_revocations t),
  'coordinates',(select jsonb_agg(to_jsonb(t)) from app_private.cos_source_recorded_coordinates t)
) state`)).rows[0].state;

async function assertChangedGraph(f, label, mutate, admitted = true) {
  const expected = f.receipts[0].linkageGraphSha256;
  await f.db.exec('begin');
  try {
    await mutate();
    assert.notEqual(await f.guard('1'), expected, `${label}: relevant graph digest must change`);
    for (const receipt of f.receipts.slice(1)) {
      assert.equal(await f.guard(receipt.productId), receipt.linkageGraphSha256, `${label}: unrelated product graph`);
    }
    // The public reader is exercised as the real API reader role. Separate tests
    // execute it in an actual READ ONLY transaction, including a changed graph.
    await f.db.exec('set local role service_role');
    assert.deepEqual(products(await f.snapshot()), admitted ? ['2', '3'] : [], `${label}: stale estimate suppressed`);
    await f.db.exec('reset role; savepoint admission');
    await assert.rejects(f.admit(), /Source linkage graph changed/, `${label}: admission rejects stale captured graph`);
    await f.db.exec('rollback to savepoint admission');
    assert.equal((await f.db.query('select count(*)::int n from cos_mhelp_placement_private.source_equipment_estimates')).rows[0].n,
      admitted ? 3 : 0, `${label}: no partial receipt insert`);
  } finally { await f.db.exec('rollback'); }
  assert.equal(await f.guard('1'), expected, `${label}: fixture rollback restores the exact captured graph`);
}

test('real source graph and upload guard admit unchanged inactive associations without native writes', withDb(async f => {
  await seedGraph(f);
  const graph = await f.graph('1');
  assert.equal(graph.sources.length, 1);
  assert.equal(graph.sources[0].active, false, 'inactive source rows remain denial evidence');
  assert.equal(graph.links.length, 1);
  assert.equal(graph.ownerClaims.length, 1);
  assert.equal(graph.ownerResources.length, 1);
  assert.equal(graph.archives.length, 1);
  assert.equal(graph.recordedCoordinates.length, 1);
  assert.equal(await f.hash(graph), f.receipts[0].linkageGraphSha256);
  const realPairGuard = (await f.db.query('select cos_mhelp_placement_private.upload_binding_guard($1,$2) g', [tracker(1), native(1)])).rows[0].g;
  assert.ok(graph.pairGuards.some(pair => pair.trackerId === tracker(1) && pair.nativeUnitId === native(1) && pair.guard === realPairGuard));
  const before = await snapshots(f);
  assert.equal((await f.admit()).receipts, 3);
  assert.equal((await f.admit()).receipts, 3);
  const result = await f.read();
  assert.deepEqual(products(result), ['1', '2', '3']);
  assert.equal(result.records[0].linkageGraphSha256, await f.guard('1'));
  assert.equal(result.records[0].uploadRecord.binding, null, 'historical graph never becomes positive identity');
  assert.ok(result.records.every(record => record.verified === false && record.liveGps === false));
  assert.deepEqual(await snapshots(f), before);
}));

test('source and link changes, including inactive source rows, invalidate admission and read', withDb(async f => {
  await seedGraph(f); await seedPair(f, 5); await f.admit();
  const cases = [
    ['inactive source address', () => f.db.exec("update app_private.cos_geocode_sources set street='9 Main St' where product_id='1'")],
    ['source revision', () => f.db.exec("update app_private.cos_geocode_sources set source_revision=gen_random_uuid() where product_id='1'")],
    ['source reactivation', () => f.db.exec("update app_private.cos_geocode_sources set active=true,eligibility='FIELD' where product_id='1'")],
    ['source ProductId reassignment', () => f.db.exec("update app_private.cos_geocode_sources set product_id='99' where product_id='1'")],
    ['source tracker reassignment', () => f.db.query("update app_private.cos_geocode_sources set tracker_id=$1 where product_id='1'", [tracker(5)])],
    ['source native reassignment', () => f.db.query("update app_private.cos_geocode_sources set native_unit_id=$1 where product_id='1'", [native(5)])],
    ['source removal', () => f.db.exec("delete from app_private.cos_geocode_sources where product_id='1'")],
    ['link observation', () => f.db.exec("update cos_mhelp_placement_private.links set observation='{\"customerId\":\"999\"}' where equipment_id='1'")],
    ['link native reassignment', () => f.db.query("update cos_mhelp_placement_private.links set native_unit_id=$1 where equipment_id='1'", [native(5)])],
    ['link tracker reassignment', () => f.db.query("update cos_mhelp_placement_private.links set tracker_id=$1 where equipment_id='1'", [tracker(5)])],
    ['link ProductId reassignment', () => f.db.exec("update cos_mhelp_placement_private.links set equipment_id='99' where equipment_id='1'")],
    ['link removal', () => f.db.exec("delete from cos_mhelp_placement_private.links where equipment_id='1'")],
  ];
  for (const [label, mutate] of cases) await assertChangedGraph(f, label, mutate);
}));

test('new Owner claims, Owner resource additions and revocations invalidate both receipt paths', withDb(async f => {
  await seedGraph(f); await seedPair(f, 5); await f.admit();
  await assertChangedGraph(f, 'new ProductId Owner association to another native', () => seedClaim(f, '1', 5));
  await assertChangedGraph(f, 'new resource on existing Owner claim', () => f.db.query(
    "insert into app_private.cos_owner_identity_resources(device_id,claim_id,source,device_type,external_device_id) values('9001',$1,'synthetic','camera','new-camera')", [claim(1)]));
  await assertChangedGraph(f, 'Owner revocation', () => f.db.query(
    "insert into app_private.cos_owner_identity_revocations(claim_id,request_id,revoked_by,reason,cause) values($1,$2,$3,'Synthetic owner revocation','owner_revocation')", [claim(1), id(8, 99), ACTOR]));
}));

test('native, tracker and native-history movement invalidate both receipt paths', withDb(async f => {
  await seedGraph(f); await f.admit();
  const cases = [
    ['native GPS', () => f.db.query('update public.equipment_units set gps_latitude=30,gps_longitude=-96,gps_recorded_at=now() where id=$1', [native(1)])],
    ['native status', () => f.db.query("update public.equipment_units set status='retired',retired_at=now() where id=$1", [native(1)])],
    ['native assignment', () => f.db.query("update public.equipment_units set installed_site_id=$2,current_location_type='site' where id=$1", [native(1), id(8, 88)])],
    ['native deletion', () => f.db.query('delete from public.equipment_units where id=$1', [native(1)])],
    ['tracker coordinates', () => f.db.query("update app_private.vision_tracker_locations set latitude=30,longitude=-96,coordinate_source='source_recorded' where id=$1", [tracker(1)])],
    ['tracker placement', () => f.db.query("update app_private.vision_tracker_locations set placement='SHOP' where id=$1", [tracker(1)])],
    ['tracker deletion', () => f.db.query('delete from app_private.vision_tracker_locations where id=$1', [tracker(1)])],
    ['history edit', () => f.db.query("update public.equipment_unit_location_history set note='Changed history' where equipment_unit_id=$1", [native(1)])],
    ['history addition', () => f.db.query("insert into public.equipment_unit_location_history(equipment_unit_id,note) values($1,'New history')", [native(1)])],
    ['history removal', () => f.db.query('delete from public.equipment_unit_location_history where equipment_unit_id=$1', [native(1)])],
  ];
  for (const [label, mutate] of cases) await assertChangedGraph(f, label, mutate);
}));

test('archive revocation and recorded-coordinate changes invalidate both receipt paths', withDb(async f => {
  await seedGraph(f); await f.admit();
  await assertChangedGraph(f, 'archive revocation', () => f.db.query(
    "insert into app_private.cos_archived_representation_revocations(representation_id,reason) values($1,'admin_revoked')", [archive(1)]));
  await assertChangedGraph(f, 'inactive recorded coordinate payload', () => f.db.query(
    "update app_private.cos_source_recorded_coordinates set payload=payload||'{\"latitude\":30}' where native_unit_id=$1", [native(1)]));
  await assertChangedGraph(f, 'recorded coordinate activation', () => f.db.query(
    'update app_private.cos_source_recorded_coordinates set active=true where native_unit_id=$1', [native(1)]));
  await assertChangedGraph(f, 'recorded coordinate removal', () => f.db.query(
    'delete from app_private.cos_source_recorded_coordinates where native_unit_id=$1', [native(1)]));
}));

test('new source/link/Owner/coordinate phantoms fail initial admission and suppress admitted receipts', withDb(async f => {
  await seedPair(f, 1);
  const cases = [
    ['inactive source phantom', () => seedSource(f)],
    ['active source phantom', () => seedSource(f, '1', 1, true)],
    ['link phantom', () => seedLink(f)],
    ['Owner ProductId phantom', () => seedClaim(f, '1')],
    ['inactive coordinate phantom', () => seedCoordinates(f)],
    ['active coordinate phantom', () => seedCoordinates(f, '1', 1, true)],
  ];
  for (const [label, mutate] of cases) await assertChangedGraph(f, label, mutate, false);
  assert.equal((await f.admit()).receipts, 3);
  for (const [label, mutate] of cases) await assertChangedGraph(f, label, mutate);
}));

test('archive additions invalidate an existing source-only graph', withDb(async f => {
  await seedPair(f, 1); await seedPair(f, 4); await seedSource(f); await f.refreshGuards();
  await f.admit();
  await assertChangedGraph(f, 'new archive phantom', () => seedArchive(f));
}));

test('transitive canonical native, tracker, history, Owner and coordinate changes invalidate the archive graph', withDb(async f => {
  await seedGraph(f); await f.admit();
  const cases = [
    ['canonical native GPS', () => f.db.query('update public.equipment_units set gps_latitude=30,gps_longitude=-96 where id=$1', [native(4)])],
    ['canonical tracker placement', () => f.db.query("update app_private.vision_tracker_locations set placement='SHOP' where id=$1", [tracker(4)])],
    ['canonical history addition', () => f.db.query("insert into public.equipment_unit_location_history(equipment_unit_id,note) values($1,'New canonical history')", [native(4)])],
    ['canonical Owner claim without ProductId', () => seedClaim(f, null, 4)],
    ['canonical unrelated-ProductId coordinates', () => seedCoordinates(f, '9004', 4)],
  ];
  for (const [label, mutate] of cases) await assertChangedGraph(f, label, mutate);
}));

test('unrelated authority changes preserve admission and every already captured estimate', withDb(async f => {
  await seedGraph(f); await f.admit();
  const before = await f.guard('1');
  await seedGraph(f, '9005', 5, 6);
  await f.db.query("insert into app_private.cos_owner_identity_revocations(claim_id,request_id,reason,cause) values($1,$2,'Unrelated revocation','owner_revocation')", [claim(5), id(8, 95)]);
  await f.db.query("insert into app_private.cos_archived_representation_revocations(representation_id,reason) values($1,'admin_revoked')", [archive(5)]);
  await f.db.query('update public.equipment_units set gps_latitude=30,gps_longitude=-96 where id=$1', [native(5)]);
  assert.equal(await f.guard('1'), before);
  assert.equal((await f.admit()).receipts, 3);
  assert.deepEqual(products(await f.read()), ['1', '2', '3']);
}));

test('changed-graph reader works in READ ONLY and leaves all authority tables untouched', withDb(async f => {
  await seedGraph(f); await f.admit();
  await f.db.query('update public.equipment_units set gps_latitude=30,gps_longitude=-96 where id=$1', [native(1)]);
  const before = await snapshots(f);
  assert.deepEqual(products(await f.read()), ['2', '3']);
  assert.deepEqual(await snapshots(f), before);
  await f.db.exec('begin read only');
  try {
    await assert.rejects(f.admit(), /read-only transaction/);
  } finally { await f.db.exec('rollback'); }
}));

test('private graph and digest helpers explicitly deny all API roles, even with schema usage', withDb(async f => {
  await seedGraph(f); await f.admit();
  await f.db.exec('grant usage on schema cos_mhelp_placement_private to anon,authenticated,service_role');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const signature of ['source_estimate_linkage_graph(text)', 'source_estimate_linkage_guard(text)']) {
      assert.equal((await f.db.query('select has_function_privilege($1,$2,\'execute\') allowed', [role, `cos_mhelp_placement_private.${signature}`])).rows[0].allowed, false);
    }
    await f.db.exec(`set role ${role}`);
    try {
      await assert.rejects(f.db.query('select cos_mhelp_placement_private.source_estimate_linkage_graph($1)', ['1']), /permission denied for function source_estimate_linkage_graph/);
      await assert.rejects(f.db.query('select cos_mhelp_placement_private.source_estimate_linkage_guard($1)', ['1']), /permission denied for function source_estimate_linkage_guard/);
      await assert.rejects(f.db.exec('select * from cos_mhelp_placement_private.source_equipment_estimates'), /permission denied/);
    } finally { await f.db.exec('reset role'); }
  }
  assert.deepEqual(products(await f.read()), ['1', '2', '3']);
}));

test('graph admission holds SHARE locks on every dependency and enforces READ COMMITTED', withDb(async f => {
  const dependencies = [
    'app_private.vision_tracker_locations', 'public.equipment_units', 'app_private.cos_geocode_sources',
    'cos_mhelp_placement_private.links', 'public.equipment_unit_location_history', 'app_private.cos_owner_identity_claims',
    'app_private.cos_owner_identity_resources', 'app_private.cos_owner_identity_revocations',
    'app_private.cos_archived_representations', 'app_private.cos_archived_representation_revocations',
    'app_private.cos_source_recorded_coordinates',
  ];
  await f.db.exec('begin');
  try {
    await f.admit();
    const locks = (await f.db.query(`select n.nspname||'.'||c.relname relation,l.mode
      from pg_locks l join pg_class c on c.oid=l.relation join pg_namespace n on n.oid=c.relnamespace
      where l.granted and l.pid=pg_backend_pid()`)).rows;
    for (const relation of dependencies) assert.ok(locks.some(lock => lock.relation === relation && lock.mode === 'ShareLock'), `${relation}: phantom-blocking SHARE lock`);
    assert.ok(locks.some(lock => lock.relation === 'cos_mhelp_placement_private.upload_control' && lock.mode === 'RowShareLock'), 'active-head row is locked');
    assert.equal((await f.db.query("select current_setting('lock_timeout') timeout")).rows[0].timeout, '2s');
  } finally { await f.db.exec('rollback'); }
  for (const isolation of ['repeatable read', 'serializable']) {
    await f.db.exec(`begin isolation level ${isolation}`);
    try { await assert.rejects(f.admit(), /Read committed transaction required/); }
    finally { await f.db.exec('rollback'); }
  }
  assert.equal((await f.db.query('select count(*)::int n from cos_mhelp_placement_private.source_equipment_estimates')).rows[0].n, 0);
  // PGlite has one backend. The runtime lock inspection above proves held lock
  // modes; this source assertion covers fail-fast competing-writer behavior
  // without pretending a single backend is a two-session concurrency test.
  const review = receiptSql.slice(receiptSql.indexOf('create function cos_mhelp_placement_private.review_source_equipment_estimates'), receiptSql.indexOf('create function cos_mhelp_placement_private.revoke_source_equipment_estimates'));
  const locked = review.match(/lock table\s+([\s\S]*?)\s+in share mode nowait;/i);
  assert.ok(locked, 'competing graph writer must fail fast');
  assert.deepEqual(locked[1].split(',').map(name => name.trim()).sort(), [...dependencies].sort());
  assert.ok(review.indexOf("current_setting('transaction_isolation')") < review.indexOf('lock table'));
  assert.ok(review.indexOf('lock table') < review.indexOf('source_estimate_linkage_guard'));
  assert.ok(review.indexOf('source_estimate_linkage_guard') < review.indexOf('insert into cos_mhelp_placement_private.source_equipment_estimates'));
}));

test('graph digests and accepted receipts are independent of the caller session timezone', withDb(async f => {
  await seedGraph(f);
  await f.admit();
  const expected = await f.guard('1'), graph = await f.graph('1');
  for (const timezone of ['America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Auckland', 'UTC']) {
    await f.db.query("select set_config('TimeZone',$1,false)", [timezone]);
    assert.equal(await f.guard('1'), expected, `stable digest in ${timezone}`);
    assert.deepEqual(await f.graph('1'), graph, `stable graph timestamp serialization in ${timezone}`);
    assert.equal((await f.admit()).receipts, 3);
    assert.deepEqual(products(await f.read()), ['1', '2', '3']);
  }
}));

test('admission requires the exact captured linkage digest and fails atomically for a later stale product', withDb(async f => {
  for (const value of [undefined, null, '', 'not-a-digest', 'd'.repeat(64)]) {
    const receipts = structuredClone(f.receipts);
    if (value === undefined) delete receipts[0].linkageGraphSha256;
    else receipts[0].linkageGraphSha256 = value;
    await assert.rejects(f.admit(receipts), /Exact unique receipt required|Source linkage graph changed/);
  }
  await seedPair(f, 2); await seedSource(f, '2', 2);
  await assert.rejects(f.admit(), /Source linkage graph changed/);
  assert.equal((await f.db.query('select count(*)::int n from cos_mhelp_placement_private.source_equipment_estimates')).rows[0].n, 0,
    'the first inserted receipt is rolled back when the second graph is stale');
}));

test('closure follows mismatched exact source/link/coordinate UUID edges beyond the ProductId pair', withDb(async f => {
  for (const number of [1, 5, 6]) await seedPair(f, number);
  await seedSource(f);
  await seedLink(f, '9005', 5);
  await f.db.query("update cos_mhelp_placement_private.links set tracker_id=$1 where equipment_id='9005'", [tracker(1)]);
  await seedCoordinates(f, '9006', 6);
  await f.db.query("update app_private.cos_source_recorded_coordinates set native_unit_id=$1 where payload->>'productId'='9006'", [native(5)]);
  await f.refreshGuards(); await f.admit();
  const graph = await f.graph('1');
  assert.ok(graph.links.some(link => link.equipment_id === '9005'));
  assert.ok(graph.recordedCoordinates.some(coordinate => coordinate.payload.productId === '9006'));
  await assertChangedGraph(f, 'transitive link native history', () => f.db.query(
    "insert into public.equipment_unit_location_history(equipment_unit_id,note) values($1,'Linked history')", [native(5)]));
  await assertChangedGraph(f, 'transitive coordinate tracker placement', () => f.db.query(
    "update app_private.vision_tracker_locations set placement='SHOP' where id=$1", [tracker(6)]));
  await assertChangedGraph(f, 'transitive native Owner claim', () => seedClaim(f, null, 5));
}));

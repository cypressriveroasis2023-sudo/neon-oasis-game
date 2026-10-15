import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {ORG,ACTOR,SOURCE,PAYLOAD,AUTH,id,native,tracker,GRAPH_TABLES} from './source-equipment-receipts-postgres.mjs';

export const products = value => value?.records.map(r=>r.productId) ?? [];
const receiptCount = async f => (await f.counts()).receipts;
export async function transaction(db, fn) {
  await db.exec('begin');
  try { return await fn(); } finally { await db.exec('rollback'); }
}
export async function expectFailure(db, fn, expected) {
  await db.exec('savepoint expected_failure');
  try { await assert.rejects(fn,expected); }
  finally { await db.exec('rollback to savepoint expected_failure; release savepoint expected_failure'); }
}
export async function serviceSnapshot(f) {
  await f.db.exec('set local role service_role');
  try { return await f.snapshot(); } finally { await f.db.exec('reset role'); }
}
export async function prechecks(f,test) {
  const {db} = f;
  await test('representative population and exact two source-only / one empty target graph',async()=>{
    assert.deepEqual(await f.counts(),{uploads:1001,trackers:810,native:810,sources:809,links:807,owner_claims:97,
      owner_resources:97,archives:27,coordinates:27,history:810,receipts:0,revocations:0});
    for (const r of f.receipts) {
      const graph = await f.graph(r.productId);
      for (const [key,value] of Object.entries(graph).filter(([,v])=>Array.isArray(v))) {
        assert.equal(value.length,r.productId!=='3'&&['sources','pairGuards'].includes(key)?1:0,`${r.productId}: ${key}`);
      }
      assert.equal(await f.hash(graph),r.linkageGraphSha256);
      if (r.productId!=='3') {
        const pair = graph.pairGuards[0];
        assert.equal(pair.guard,(await db.query('select cos_mhelp_placement_private.upload_binding_guard($1,$2) g',[pair.trackerId,pair.nativeUnitId])).rows[0].g);
      }
    }
  });
  await test('exact bounded hashes, identity, evidence and atomic late-product failures',async()=>{
    const before = await f.state();
    for (const rs of [[],Array(4).fill(f.receipts[0]),[f.receipts[0],f.receipts[0]],[{...f.receipts[0],extra:true}]])
      await assert.rejects(()=>f.admit(rs),/Exact bounded receipt|Exact unique receipt/);
    await assert.rejects(()=>f.admit(f.receipts,SOURCE,PAYLOAD,'d'.repeat(64)),/Exact bounded receipt/);
    await assert.rejects(()=>f.admit(f.receipts,SOURCE,PAYLOAD,undefined,null),/Exact bounded receipt/);
    await assert.rejects(()=>f.admit(f.receipts,'d'.repeat(64)),/Active upload changed/);
    await assert.rejects(()=>f.admit(f.receipts,SOURCE,'d'.repeat(64)),/Active upload changed/);
    for (const field of ['uploadRecordSha256','linkageGraphSha256','cacheEvidenceSha256']) {
      const rs = structuredClone(f.receipts); rs[1][field]='d'.repeat(64);
      await assert.rejects(()=>f.admit(rs),/Upload identity|Source linkage graph changed|cache evidence/);
      assert.equal(await receiptCount(f),0,'First receipt insert must roll back if the second fails');
    }
    const badEvidence = [
      {latitude:91},{longitude:-181},{verified:true},{liveGps:true},{status:'failure'},
      {address:'different synthetic address'},{provider:'unapproved'},{geocodedAt:'2999-01-01T00:00:00Z'},
      {provider:'geocodio',accuracyType:'rooftop',accuracy:0.89,matchType:'building_centroid'},
    ];
    for (const edit of badEvidence) {
      const rs=structuredClone(f.receipts);Object.assign(rs[1].cacheEvidence,edit);rs[1].cacheEvidenceSha256=await f.hash(rs[1].cacheEvidence);
      await assert.rejects(()=>f.admit(rs),/Exact successful cache evidence required/);
      assert.equal(await receiptCount(f),0);
    }
    assert.deepEqual(await f.state(),before,'Rejected admission changes no tables');
  });
  await test('all API roles denied private tables/helpers/admission/revocation, even with schema usage',async()=>{
    await db.exec('grant usage on schema cos_mhelp_placement_private to anon,authenticated,service_role');
    try {
      for (const role of ['anon','authenticated','service_role']) {
        for (const signature of ['source_estimate_linkage_graph(text)','source_estimate_linkage_guard(text)',
          'review_source_equipment_estimates(text,text,text,jsonb,text)','revoke_source_equipment_estimates(uuid[],text)'])
          assert.equal((await db.query("select has_function_privilege($1,$2,'execute') allowed",[role,`cos_mhelp_placement_private.${signature}`])).rows[0].allowed,false);
        await db.exec(`set role ${role}`);
        try {
          for (const query of [
            "select cos_mhelp_placement_private.source_estimate_linkage_graph('1')",
            "select cos_mhelp_placement_private.source_estimate_linkage_guard('1')",
            "select cos_mhelp_placement_private.review_source_equipment_estimates(null,null,null,'[]',null)",
            "select cos_mhelp_placement_private.revoke_source_equipment_estimates('{}',null)",
            'select * from cos_mhelp_placement_private.source_equipment_estimates',
            'select * from cos_mhelp_placement_private.source_equipment_estimate_revocations',
          ]) await assert.rejects(()=>db.query(query),e=>e.code==='42501');
        } finally { await db.exec('reset role'); }
      }
    } finally { await db.exec('revoke all on schema cos_mhelp_placement_private from anon,authenticated,service_role'); }
    for (const role of ['anon','authenticated']) await assert.rejects(()=>f.read(role),e=>e.code==='42501');
    await assert.rejects(()=>f.read('service_role',id(2,2)),/Invalid synthetic actor/);
    await assert.rejects(()=>f.read('service_role',ACTOR,id(1,2)),/Equipment view required/);
    await db.exec("set test.permission='false'");
    try { await assert.rejects(()=>f.read(),/Equipment view required/); } finally { await db.exec("set test.permission='true'"); }
  });
  await test('admission and revocation reject repeatable-read and serializable writers',async()=>{
    for (const isolation of ['repeatable read','serializable']) {
      await db.exec(`begin isolation level ${isolation}`);
      try {
        await expectFailure(db,()=>f.admit(),/Read committed transaction required/);
        await expectFailure(db,()=>f.revoke(),/Read committed transaction required/);
      } finally { await db.exec('rollback'); }
    }
  });
  await test('adversarial transitive links/archives/Owner/coordinate graph never becomes native identity',async()=>{
    const original=structuredClone(f.receipts);
    try { await transaction(db,async()=>{
      await db.query(`insert into cos_mhelp_placement_private.links(equipment_id,tracker_id,native_unit_id,tracker_label,
        native_label,full_label,source_revision,baseline_guard,baseline_customer_id,authorization_sha256)
        values('1',$1,$2,'Synthetic unit 1','Synthetic unit 1','Synthetic unit 1',$3,$4,'456',$5)`,[tracker(1),native(1),id(7,1),SOURCE,AUTH]);
      await db.query(`insert into app_private.cos_archived_representations(id,organization_id,archived_native_id,canonical_native_id,
        archived_tracker_id,canonical_tracker_id,reviewed_before,source_evidence,review_sha256,evidence_sha256)
        values($1,$2,$3,$4,$5,$6,'{}','{}',$7,$7)`,[id(6,1),ORG,native(1),native(271),tracker(1),tracker(271),SOURCE]);
      await db.query(`insert into app_private.cos_source_recorded_coordinates(record_id,organization_id,entity_kind,native_unit_id,tracker_id,payload,active)
        values($1,$2,'equipment_unit',$3,$4,'{"productId":"541","latitude":0,"longitude":0}',false)`,[id(9,1),ORG,native(271),tracker(541)]);
      await db.query(`insert into app_private.cos_owner_identity_claims(id,organization_id,native_unit_id,native_unit_label,legacy_unit_key,
        device_ids,resource_epoch,source_epoch,physical_digest,provenance,confirmation_text,evidence_ref,confirmed_by,request_id,request_payload)
        values($1,$2,$3,'Synthetic unit 541','SYNTHETIC-541',array['1541'],$4,$4,$4,'owner_confirmation',
        'Synthetic confirmation','synthetic:fixture',$5,$6,'{}')`,[id(5,541),ORG,native(541),SOURCE,ACTOR,id(8,541)]);
      await db.query("insert into app_private.cos_owner_identity_resources values('1541',$1,'synthetic','camera',null,null)",[id(5,541)]);
      for (const r of f.receipts) r.linkageGraphSha256=await f.guard(r.productId);
      const graph=await f.graph('1');
      assert.ok(graph.sources.some(s=>s.product_id==='541'));
      assert.ok(graph.links.some(l=>l.equipment_id==='271'));
      assert.equal(graph.ownerClaims.length,1);assert.equal(graph.ownerResources.length,1);
      assert.equal(graph.archives.length,1);assert.equal(graph.recordedCoordinates.length,1);
      const authority=await f.state(false);
      await f.admit();const beforeRead=await f.state();const result=await serviceSnapshot(f);
      assert.deepEqual(products(result),['1','2','3']);assert.ok(result.records.every(r=>r.uploadRecord.binding===null&&!r.verified&&!r.liveGps));
      assert.deepEqual(await f.state(),beforeRead);assert.deepEqual(await f.state(false),authority);
      const changes = [
        ["update public.equipment_units set gps_latitude=1,gps_longitude=1 where id=$1",[native(541)]],
        ["update app_private.vision_tracker_locations set placement='SHOP' where id=$1",[tracker(271)]],
        ["insert into public.equipment_unit_location_history(equipment_unit_id,note) values($1,'Synthetic new history')",[native(541)]],
        ["update cos_mhelp_placement_private.links set observation='{\"customerId\":\"789\"}' where equipment_id='271'",[]],
        ["update app_private.cos_geocode_sources set street='Changed Synthetic Lane' where product_id='541'",[]],
        ["update app_private.cos_source_recorded_coordinates set active=true where record_id=$1",[id(9,1)]],
        ["insert into app_private.cos_owner_identity_resources values('9999',$1,'synthetic','camera',null,null)",[id(5,541)]],
        ["insert into app_private.cos_owner_identity_revocations(claim_id,request_id,reason,cause) values($1,$2,'Synthetic revoke','owner_revocation')",[id(5,541),id(8,999)]],
        ["insert into app_private.cos_archived_representation_revocations(representation_id,reason) values($1,'admin_revoked')",[id(6,1)]],
      ];
      for (const [query,args] of changes) {
        await db.exec('savepoint graph_change');
        try {
          await db.query(query,args);assert.notEqual(await f.guard('1'),f.receipts[0].linkageGraphSha256);
          assert.deepEqual(products(await serviceSnapshot(f)),['2','3']);
          await expectFailure(db,()=>f.admit(),/Source linkage graph changed/);
        } finally { await db.exec('rollback to savepoint graph_change; release savepoint graph_change'); }
      }
    }); } finally { f.receipts.splice(0,f.receipts.length,...original); }
    assert.equal(await receiptCount(f),0);
  });
}

export async function readerChecks(f,test,{measure=true}={}) {
  const {db}=f;
  const timings=[];
  await test('three exact receipts read in READ ONLY, without any native or receipt mutation',async()=>{
    const before=await f.state();
    for (let i=0;i<(measure?21:1);i++) {
      const start=performance.now();const result=await f.read();timings.push(performance.now()-start);
      assert.equal(result.sourceSha256,SOURCE);assert.equal(result.payloadSha256,PAYLOAD);
      assert.deepEqual(products(result),['1','2','3']);
      for (let j=0;j<3;j++) {
        assert.equal(result.records[j].receiptId,f.receipts[j].receiptId);
        assert.equal(result.records[j].uploadRecordSha256,f.receipts[j].uploadRecordSha256);
        assert.equal(result.records[j].linkageGraphSha256,f.receipts[j].linkageGraphSha256);
        assert.deepEqual(result.records[j].uploadRecord,f.upload[j]);
        assert.equal(result.records[j].verified,false);assert.equal(result.records[j].liveGps,false);
      }
    }
    assert.deepEqual(await f.state(),before);
    if (measure) assert.ok(Math.max(...timings)<1500,'Synthetic SQL reader must leave at least 500 ms below the 2,000 ms optional-read cap');
  });
  await test('changed upload identity, assignment, lifecycle, address and duplicate ProductId suppress stale receipts',async()=>{
    const edits=[r=>r.customerId='789',r=>r.customer='Different synthetic customer',r=>r.unitNumber='Different synthetic label',
      r=>r.sourceAddress.street='Changed Synthetic Lane',r=>r.lifecycle='MISSING',r=>r.placement='SHOP',r=>r.binding={nativeUnitId:native(1)},
      r=>r.placementHeld=true,r=>r.possibleAliasUnitIds=[native(1)]];
    for (const edit of [...edits,null]) await transaction(db,async()=>{
      const upload=structuredClone(f.upload);if(edit)edit(upload[0]);else upload.push({...upload[0]});
      await db.query('update cos_mhelp_placement_private.upload_batches set records=$1',[upload]);
      const before=await f.state();assert.deepEqual(products(await serviceSnapshot(f)),['2','3']);assert.deepEqual(await f.state(),before);
      await expectFailure(db,()=>f.admit(),/Upload identity|Upload ProductId is not unique/);
    });
  });
  await test('unrelated graph changes preserve receipts; source changes suppress the affected receipt',async()=>{
    for (const product of ['1','810']) await transaction(db,async()=>{
      await db.query('update app_private.cos_geocode_sources set street=$1 where product_id=$2',['Changed Synthetic Lane',product]);
      const before=await f.state();assert.deepEqual(products(await serviceSnapshot(f)),product==='1'?['2','3']:['1','2','3']);
      assert.deepEqual(await f.state(),before);
      if(product==='1')await expectFailure(db,()=>f.admit(),/Source linkage graph changed/);else assert.equal((await f.admit()).receipts,3);
    });
  });
  await test('late unknown revocation is atomic and cannot leave an earlier tombstone',async()=>{
    const before=await f.state();
    await assert.rejects(()=>f.revoke([f.receipts[0].receiptId,id(1,9999)]),/Unknown receipt/);
    assert.deepEqual(await f.state(),before);
    assert.equal((await f.counts()).revocations,0);
  });
  await test('all receipt dependencies hold phantom-blocking SHARE locks during admission',async()=>{
    await transaction(db,async()=>{
      await f.admit();
      const locks=(await db.query(`select n.nspname||'.'||c.relname relation,l.mode from pg_locks l
        join pg_class c on c.oid=l.relation join pg_namespace n on n.oid=c.relnamespace where l.granted and l.pid=pg_backend_pid()`)).rows;
      for(const table of GRAPH_TABLES)assert.ok(locks.some(l=>l.relation===table&&l.mode==='ShareLock'),table);
      assert.equal((await db.query("select current_setting('lock_timeout') timeout")).rows[0].timeout,'2s');
    });
  });
  await test('reader is timezone-stable; read-only transactions reject receipt writers',async()=>{
    for(const timezone of ['America/Los_Angeles','Asia/Kolkata','UTC']) {
      await db.query("select set_config('TimeZone',$1,false)",[timezone]);
      assert.equal(await f.guard('1'),f.receipts[0].linkageGraphSha256);
      assert.deepEqual(products(await f.read()),['1','2','3']);
    }
    await db.exec('begin read only');
    try { await expectFailure(db,()=>f.admit(),e=>e.code==='25006'); } finally { await db.exec('rollback'); }
  });
  const warm=timings.slice(1).sort((a,b)=>a-b);
  return {scope:'Synthetic SQL round trip including BEGIN/SET ROLE/ROLLBACK; excludes HTTP/body/validation; not a live SLA',
    firstMeasuredMs:timings[0],warmSamples:warm.length,warmMedianMs:warm.length?warm[Math.floor(warm.length/2)]:null,
    warmP95Ms:warm.length?warm[Math.ceil(warm.length*.95)-1]:null,maxMs:Math.max(...timings),
    sqlCeilingMs:1500,optionalReadCapMs:2000,remainingCapMs:2000-Math.max(...timings)};
}

export async function revokedChecks(f,test) {
  const {db}=f;
  await test('revoked receipts stay absent, cannot replay differently or mutate append-only history',async()=>{
    assert.deepEqual(products(await f.read()),[]);
    assert.equal(await f.revoke(),3);assert.equal((await f.counts()).revocations,3);
    await assert.rejects(()=>f.revoke(undefined,'d'.repeat(64)),/Revocation replay differs/);
    await assert.rejects(()=>f.admit(),/Receipt was revoked/);
    for(const ids of [[],Array(4).fill(f.receipts[0].receiptId),[f.receipts[0].receiptId,f.receipts[0].receiptId],[id(1,9999)]])
      await assert.rejects(()=>f.revoke(ids),/Exact bounded revocation|Unknown receipt/);
    for(const table of ['source_equipment_estimates','source_equipment_estimate_revocations']) {
      for(const sql of [`update cos_mhelp_placement_private.${table} set authorization_sha256=authorization_sha256`,
        `delete from cos_mhelp_placement_private.${table}`,`truncate cos_mhelp_placement_private.${table} cascade`])
        await assert.rejects(()=>db.query(sql),/append-only/);
    }
    assert.equal((await f.counts()).receipts,3);assert.equal((await f.counts()).revocations,3);
  });
}

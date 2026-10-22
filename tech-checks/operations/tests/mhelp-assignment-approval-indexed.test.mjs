import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture,reviewData,stageId,organizationId,activeSha} from './fixtures/assignment-review-indexed.mjs';
import {approvalSignature,prepareOwnerAssignmentApprovalIndexedSql} from '../scripts/prepareOwnerAssignmentApprovalIndexedSql.mjs';
const baseline=readFileSync(new URL('./fixtures/assignment-approval-before-20261022.sql',import.meta.url),'utf8');
const migration=prepareOwnerAssignmentApprovalIndexedSql(baseline);
const note='Explicit synthetic Owner approval preserving equipment and historical evidence';
async function setup(){
 const f=await fixture();
 await f.db.exec(`
 alter table cos_mhelp_placement_private.upload_batches add column receipt jsonb;
 create table cos_mhelp_placement_private.approval_validation_calls(receipt jsonb,records jsonb,previous text);
 create table cos_mhelp_placement_private.approval_fixture_flags(deny_actor boolean,reject_validation boolean);
 insert into cos_mhelp_placement_private.approval_fixture_flags values(false,false);
 create function app_private.appdeploy_assume_actor(uuid,uuid) returns void language plpgsql as $$begin
  if (select deny_actor from cos_mhelp_placement_private.approval_fixture_flags) then raise exception 'Actor denied' using errcode='42501';end if;
 end $$;
 create function app_private.has_permission(uuid,text) returns boolean language sql as $$select true$$;
 create function cos_mhelp_placement_private.assignment_review_lock() returns void language sql as $$select$$;
 create function cos_mhelp_placement_private.recover_identity_evidence_records(records jsonb) returns jsonb language sql as $$
  select jsonb_build_object('bindings',jsonb_object_agg(x->>'productId',jsonb_build_object('binding',x->'binding'))) from jsonb_array_elements(records) x where x->>'productId' is not null
 $$;
 create function cos_mhelp_placement_private.review_upload(r jsonb,items jsonb,prev text,apply boolean) returns jsonb language plpgsql as $$begin
  if (select reject_validation from cos_mhelp_placement_private.approval_fixture_flags) then raise exception 'Synthetic full admission rejected';end if;
  insert into cos_mhelp_placement_private.approval_validation_calls values(r,items,prev);return '{}'::jsonb;
 end $$;
 ${baseline};
 revoke all on function ${approvalSignature} from public,anon,authenticated;
 grant execute on function ${approvalSignature} to service_role;
 `);
 const load=async(data=reviewData(10,5))=>{
  await f.load(data);
  await f.db.exec('truncate cos_mhelp_placement_private.approval_validation_calls');
  const trackers=data.original.map(r=>({matchedProductId:r.productId,unitNumber:r.unitNumber,binding:{state:'linked',...r.binding}}));
  await f.db.query('update cos_mhelp_placement_private.upload_batches set receipt=$1::jsonb',[JSON.stringify({trackerRecords:trackers})]);
  await f.db.query("update cos_mhelp_placement_private.owner_equipment_stages set receipt=receipt||jsonb_build_object('trackerRecords',$1::jsonb)",[JSON.stringify(trackers)]);
 };
 const call=async(action='approve',digest)=>{
  const row=(await f.db.query('select actor_id,verified_2027_sha256 from cos_mhelp_placement_private.owner_equipment_stages')).rows[0];
  digest??=(await f.read()).reviewDigest;
  return (await f.db.query('select public.cos_owner_mhelp_assignment_review_v1($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8) value',[row.actor_id,organizationId,stageId,
   // Fixture's exact original synthetic byte hash.
   (await f.db.query('select source_sha256 from cos_mhelp_placement_private.owner_equipment_stages')).rows[0].source_sha256,row.verified_2027_sha256,action,digest,note])).rows[0].value;
 };
 const state=async()=>{
  // Compare all JSON values in PostgreSQL; do not print megabytes through psql.
  // Only the nondeterministic approval time is excluded from the digest.
  const stage=(await f.db.query(`select review_receipt ? 'assignmentReview' approved,
   encode(sha256(convert_to((jsonb_build_object('records',records,'receipt',receipt,'review_receipt',review_receipt)
    #- '{receipt,assignmentApproval,approvedAt}' #- '{review_receipt,assignmentReview,approvedAt}')::text,'UTF8')),'hex') fingerprint
   from cos_mhelp_placement_private.owner_equipment_stages`)).rows[0];
  const calls=(await f.db.query(`select count(*)::integer count,
   encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(c) order by to_jsonb(c)::text),'[]')::text,'UTF8')),'hex') fingerprint
   from cos_mhelp_placement_private.approval_validation_calls c`)).rows[0];
  return {stage,calls};
 };
 return {...f,load,call,state};
}

test('1001 records and 354 review items: complete approval output, stored rows, validator input and replay remain exact',async t=>{
 const f=await setup();try{
  const results=[];
  for(const repaired of [false,true]){
   if(repaired)await f.db.exec(migration);
   await f.load(reviewData());
   const before=await f.db.query("select jsonb_agg(to_jsonb(u) order by id) v from public.equipment_units u");
   const start=performance.now(),approved=await f.call(),ms=performance.now()-start;
   assert.equal(approved.approved,true);assert.equal(approved.items.length,354);
   const state=await f.state();assert.equal(state.calls.count,1);
   assert.deepEqual(await f.db.query("select jsonb_agg(to_jsonb(u) order by id) v from public.equipment_units u"),before);
   const replay=await f.call();assert.equal(replay.idempotent,true);
   assert.deepEqual(await f.state(),state,'Replay does not repeat validation or writes');
   results.push({approved,state});t.diagnostic(`${repaired?'Indexed':'Original'} synthetic approval ${ms.toFixed(1)}ms`);
  }
  assert.deepEqual(results[1],results[0]);
 }finally{await f.db.close();}
});

test('missing/duplicate/null IDs and ordered first-match tracker selection retain complete success or rejection parity',async()=>{
 const f=await setup();try{
  const scenarios=[
   {name:'ordinary'},
   {name:'null and missing tracker IDs',mutate:async()=>f.db.exec("update cos_mhelp_placement_private.owner_equipment_stages set receipt=jsonb_set(receipt,'{trackerRecords}',(receipt->'trackerRecords')||'[null,{}, {\"matchedProductId\":null}]'::jsonb)")},
   {name:'prior duplicate strict check',change:d=>d.original.push(structuredClone(d.original[0]))},
   {name:'missing prior strict check',change:d=>d.original.shift()},
   {name:'duplicate prior tracker first match',mutate:async()=>f.db.exec("update cos_mhelp_placement_private.upload_batches set receipt=jsonb_set(receipt,'{trackerRecords}',(receipt->'trackerRecords')||jsonb_build_array(jsonb_set(receipt->'trackerRecords'->0,'{unitNumber}','\"wrong later identity\"'::jsonb)))")},
   {name:'null staged record retains exact array content',change:d=>d.records.push(null,{productId:null},{unitNumber:'Missing ID'})},
   {name:'empty tracker array',mutate:async()=>f.db.exec("update cos_mhelp_placement_private.owner_equipment_stages set receipt=jsonb_set(receipt,'{trackerRecords}','[]'::jsonb)")},
   {name:'validator rejection',error:/Synthetic full admission rejected/,mutate:async()=>f.db.exec('update cos_mhelp_placement_private.approval_fixture_flags set reject_validation=true')},
   {name:'actor denied',error:/Actor denied/,mutate:async()=>f.db.exec('update cos_mhelp_placement_private.approval_fixture_flags set deny_actor=true')},
  ];
  const results=[];
  for(const repaired of [false,true]){
   if(repaired)await f.db.exec(migration);
   for(const [j,s] of scenarios.entries()){
    await f.db.exec('update cos_mhelp_placement_private.approval_fixture_flags set deny_actor=false,reject_validation=false');
    const d=reviewData(10,5);s.change?.(d);await f.load(d);await s.mutate?.();
    let result;try{result={value:await f.call(),state:await f.state()};}catch(e){
     const error=String(e.stderr||e.message).match(/ERROR:\s*([^\n]+)/)?.[1]||e.message;
     result={error};assert.equal((await f.state()).stage.approved,false);
    }
    if(s.error)assert.match(result.error,s.error);
    if(repaired)assert.deepEqual(result,results[j],s.name);else results.push(result);
   }
  }
 }finally{await f.db.close();}
});

test('stale digest remains denied and source drift cannot install; metadata and permissions stay exact',async()=>{
 const f=await setup();try{
  await f.load();await assert.rejects(()=>f.call('approve','0'.repeat(64)),/Explicit current-state/);
  const catalog=()=>f.db.query(`select proowner,proacl,prosecdef,provolatile,proconfig from pg_proc where oid=$1::regprocedure`,[approvalSignature]);
  const before=await catalog();await f.db.exec(migration);assert.deepEqual(await catalog(),before);
  await assert.rejects(()=>f.call('approve','0'.repeat(64)),/Explicit current-state/);
  await assert.rejects(()=>f.db.exec(migration),/Installed assignment approval changed/);await f.db.exec('rollback');
  assert.throws(()=>prepareOwnerAssignmentApprovalIndexedSql(baseline+' '),/Exact reviewed approval/);
 }finally{await f.db.close();}
});

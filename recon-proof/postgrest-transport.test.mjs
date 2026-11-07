import test from 'node:test';import assert from 'node:assert/strict';
import {createHostedFixture} from './postgres-fixture.mjs';import {startPostgrest} from './postgrest.mjs';
import {inventoryInput} from '../tech-checks/operations/tests/fixtures/recon-owned-metadata-v2.mjs';
import {timestampMicros} from '../tech-checks/operations/tests/fixtures/recon-timestamp-micros.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('actual PostgREST serialization, browser denial, lost ACK and native40001/PT409', {timeout:60000},async()=>{
 const f=await createHostedFixture();let rest,blocker;
 try{
  // Test-only wrapper obtains a genuine stale snapshot; it never raises 40001.
  await f.db.exec(`CREATE SEQUENCE public.synthetic_native_attempts;CREATE SEQUENCE public.synthetic_native_errors;CREATE SEQUENCE public.synthetic_business_attempts;
   GRANT USAGE,SELECT ON SEQUENCE public.synthetic_native_attempts,public.synthetic_native_errors,public.synthetic_business_attempts TO service_role;
   CREATE FUNCTION public.synthetic_native40001(p_event_id bigint) RETURNS jsonb
   LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET default_transaction_isolation='repeatable read' AS $$
   DECLARE attempt_no bigint;BEGIN attempt_no:=pg_catalog.nextval('public.synthetic_native_attempts');
    IF attempt_no>3 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Synthetic retry safety ceiling';END IF;PERFORM metadata FROM public.camera_integrations WHERE provider='reconeyez';
    PERFORM pg_catalog.pg_advisory_xact_lock(41839,833);
    RETURN public.recon_record_webhook_receipt_v2(p_event_id);
   EXCEPTION WHEN serialization_failure THEN PERFORM pg_catalog.nextval('public.synthetic_native_errors');RAISE;END$$;
   CREATE FUNCTION public.synthetic_business_conflict(p_attempt_id uuid,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
   DECLARE attempt_no bigint;BEGIN attempt_no:=pg_catalog.nextval('public.synthetic_business_attempts');
    IF attempt_no>2 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Synthetic business retry safety ceiling';END IF;
    RETURN public.recon_finish_inventory_v2(p_attempt_id=>p_attempt_id,p_devices=>p_input->'p_devices',p_identity_inventory=>p_input->'p_identity_inventory',p_inventory_count=>(p_input->>'p_inventory_count')::integer,p_skipped_non_detectors=>(p_input->>'p_skipped_non_detectors')::integer);END$$;
   REVOKE ALL ON FUNCTION public.synthetic_business_conflict(uuid,jsonb) FROM PUBLIC,anon,authenticated;
   GRANT EXECUTE ON FUNCTION public.synthetic_business_conflict(uuid,jsonb) TO service_role;
   REVOKE ALL ON FUNCTION public.synthetic_native40001(bigint) FROM PUBLIC,anon,authenticated;
   GRANT EXECUTE ON FUNCTION public.synthetic_native40001(bigint) TO service_role;`);
  rest=await startPostgrest(f);
  const rpc=async(name,args,headers=rest.headers)=>{
   const response=await fetch(rest.url+'/rpc/'+name,{method:'POST',headers,body:JSON.stringify(args),signal:AbortSignal.timeout(20000)});
   const text=await response.text();return {status:response.status,text,body:JSON.parse(text)};
  };
  const id=await f.audit({startedAt:'2026-01-01T00:00:00.123456Z'});
  for(const [role,expectedStatus] of [['anon',401],['authenticated',403]]){
   const beforeDenial=await f.snapshot();
   const denied=await rpc('recon_record_webhook_receipt_v2',{p_event_id:id},rest.roleHeaders(role));
   assert.equal(denied.status,expectedStatus);assert.equal(denied.body.code,'42501');
   assert.deepEqual(await f.snapshot(),beforeDenial,role+' denial must not mutate fixture state');
  }
  const before=await f.snapshot(),invalid=await rpc('recon_record_webhook_receipt_v2',{p_event_id:9007199254740992});assert.equal(invalid.status,400);assert.equal(invalid.body.code,'22023');assert.deepEqual(await f.snapshot(),before);
  const first=await rpc('recon_record_webhook_receipt_v2',{p_event_id:id});assert.equal(first.status,200);assert.equal(first.body.outcome,'applied');
  assert.deepEqual(Object.keys(first.body).sort(),['schema_version','event_id','receipt_started_at','outcome','applied'].sort());
  assert.equal(timestampMicros(first.body.receipt_started_at),timestampMicros('2026-01-01T00:00:00.123456Z'));
  // A committed response is deliberately discarded; exact identity retry recovers it.
  const discarded=await f.audit({startedAt:'2026-01-01T00:00:01.123456Z'});await rpc('recon_record_webhook_receipt_v2',{p_event_id:discarded});
  const once=await f.snapshot(),recovered=await rpc('recon_record_webhook_receipt_v2',{p_event_id:discarded});assert.equal(recovered.body.outcome,'duplicate');assert.deepEqual(await f.snapshot(),once);
  const token=await f.begin();await f.failure(token);const conflict=await rpc('recon_finish_inventory_v2',{p_attempt_id:token.attempt_id,...await inventoryInput(token.observed_at)});assert.equal(conflict.status,409);assert.equal(conflict.body.code,'PT409');
  const beforeConflict=await f.snapshot();const countedConflict=await rpc('synthetic_business_conflict',{p_attempt_id:token.attempt_id,p_input:await inventoryInput(token.observed_at)});assert.equal(countedConflict.status,409);assert.equal(countedConflict.body.code,'PT409');assert.deepEqual(await f.snapshot(),beforeConflict);
  assert.equal(await f.scalar('SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS value FROM synthetic_business_attempts'),1,'PT409 must not be internally retried');
  const concurrent=await f.audit({startedAt:'2026-01-01T00:00:02.123456Z'});
  blocker=await f.connect('http-native40001-blocker');const pid=(await blocker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
  await blocker.query('SELECT pg_advisory_lock(41839,833)');
  const nativeStarted=performance.now();const pending=rpc('synthetic_native40001',{p_event_id:concurrent});pending.catch(()=>{});
  let found;const end=Date.now()+5000;
  while(Date.now()<end){const rows=(await f.db.query("SELECT pid,wait_event_type,wait_event,pg_blocking_pids(pid) blockers FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND query LIKE '%synthetic_native40001%' AND wait_event_type='Lock'")).rows;found=rows.find(x=>x.blockers.includes(pid));if(found)break;await delay(20)}
  assert(found,'Actual PostgREST transaction must be observed waiting behind fixture blocker');console.log('HTTP_NATIVE40001_LOCK '+JSON.stringify(found));
  assert.equal((await f.rpc('recon_record_webhook_receipt_v2',{p_event_id:concurrent})).outcome,'applied');
  await blocker.query('SELECT pg_advisory_unlock(41839,833)');const native=await pending;
  // Version-specific14.5 behavior: PostgREST retries the real abort internally.
  const nativeAttempts=await f.scalar('SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS value FROM synthetic_native_attempts');
  const nativeErrors=await f.scalar('SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS value FROM synthetic_native_errors');
  console.log('POSTGREST_NATIVE_OBSERVATION '+JSON.stringify({status:native.status,body:native.body,nativeAttempts,nativeErrors,elapsedMs:performance.now()-nativeStarted}));
  assert.equal(native.status,200);assert.equal(native.body.outcome,'duplicate');
  assert.equal(nativeAttempts,2,'Exactly original execution plus one successful internal retry');assert.equal(nativeErrors,1,'One engine-generated serialization_failure caught and rethrown unchanged');
  const retry=await rpc('recon_record_webhook_receipt_v2',{p_event_id:concurrent});assert.equal(retry.body.outcome,'duplicate');
  console.log('POSTGREST_TRANSPORT '+JSON.stringify({image:rest.image,precision:'microsecond exact',PT409:conflict.status,native40001HttpStatus:native.status,nativeOutcome:native.body.outcome,nativeAttempts,nativeErrors,PT409Attempts:1,nativeIsInjected:false}));
 }finally{if(blocker)await blocker.query('SELECT pg_advisory_unlock_all()').catch(()=>{});
  try{if(rest)await rest.close()}finally{await f.close()}
 }
});

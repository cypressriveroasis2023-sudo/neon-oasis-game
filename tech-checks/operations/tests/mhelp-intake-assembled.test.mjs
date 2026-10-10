/** Isolated SQL + runtime contract tests. Synthetic identities only; no network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,payload,shellPayload,rows,receipt,service,it} from '../legacy/mhelp-intake-fixture.mjs';
import {BATCH_CONTRACT,IntakeFault,runMhelpIntake,validateOperationalTicket} from '../intake/mhelpIntakeRuntime.ts';
import {createBoundedMhelpSource} from '../intake/mhelpIntakeSource.ts';
import {createExistingServiceRpc} from '../intake/mhelpIntakeTransport.ts';
import {projectIntakeReview} from '../../supabase/functions/cos-operations-pages/mhelpIntakeReview.ts';
import {checkedIntakeReview} from '../src/mhelpIntakeReviewModel.ts';

async function assembled() {
  const db=await fixture({realScheduler:true});
  const rpc=createExistingServiceRpc({rpc:(name,args)=>({abortSignal:async signal=>{
    assert.equal(name,'camera_mhelp_ticket_intake_v1');
    if(signal.aborted)throw new IntakeFault('DEADLINE',true);
    await db.exec('set role service_role');
    try{return {data:(await db.query('select public.camera_mhelp_ticket_intake_v1($1::jsonb) value',[JSON.stringify(args.p_request)])).rows[0].value,error:null,status:200};}
    catch(error){return {data:null,error:{code:error.code},status:400};}
    finally{await db.exec('reset role');}
  }})});
  const tickets=[payload(),payload()];
  tickets[1].source.ticketId='43';tickets[1].source.ticketNumber='000043';tickets[1].request.ticket_no='000043';
  const readSource=async window=>({contract:BATCH_CONTRACT,portalId:'17',schemaContract:'synthetic-verified-v1',window,totalRows:2,partial:false,tickets});
  const run=changes=>runMhelpIntake({enabled:true,rpc,readSource,random:()=>0,sleep:async()=>{},...changes});
  const state=async()=>(await db.query("select * from cos_mhelp_intake.scheduler_state where portal_id='17'")).rows[0];
  const call=input=>rpc(input,new AbortController().signal);
  return {db,rpc,call,tickets,run,state};
}
const size=async(db,table)=>(await db.query(`select count(*)::integer n from ${table}`)).rows[0].n;

test('assembled partial batch preserves receipts, retries without duplicate jobs and advances only after completion',async()=>{
  const {db,run,state}=await assembled();
  await db.exec(`create function public.synthetic_batch_lock() returns trigger language plpgsql as $$begin
    if new.ticket_no='000043' then raise exception 'Synthetic transient write conflict' using errcode='55P03';end if;return new;end$$;
    create trigger synthetic_batch_lock before insert on public.job_assignments for each row execute function public.synthetic_batch_lock();`);
  const failed=await run();assert.equal(failed.state,'failed');assert.equal(failed.code,'WRITE_UNAVAILABLE');assert.equal(failed.watermarkAdvanced,false);
  assert.equal((await rows(db)).length,1);assert.equal((await receipt(db)).length,1);
  const held=await state();assert.equal(held.watermark.toISOString(),'2026-10-10T00:00:00.000Z');assert.equal(held.lease_id,null);assert.equal(held.failure_count,1);
  await db.exec("drop trigger synthetic_batch_lock on public.job_assignments;update cos_mhelp_intake.scheduler_state set retry_after=clock_timestamp()-interval '1 second',last_attempt_at=clock_timestamp()-interval '5 minutes'");
  const complete=await run();assert.equal(complete.state,'complete');assert.equal(complete.existing,1);assert.equal(complete.created,1);
  assert.equal((await rows(db)).length,2);assert.equal((await receipt(db)).length,2);assert.equal(await size(db,'public.workflow_checkpoints'),2);assert.equal(await size(db,'public.app_notifications'),0);
  assert((await state()).watermark>held.watermark);
});

test('assembled committed record and finish with lost acknowledgements retry identical envelopes exactly once',async()=>{
  const {db,rpc,call,run}=await assembled();const calls=[];let lostRecord=false,lostFinish=false;
  const retrying=async(input,signal)=>{calls.push(structuredClone(input));const result=await rpc(input,signal);
    if(input.action==='record'&&!lostRecord){lostRecord=true;throw new IntakeFault('WRITE_UNAVAILABLE',true);}
    if(input.action==='finish'&&!lostFinish){lostFinish=true;throw new IntakeFault('WRITE_UNAVAILABLE',true);}return result;};
  assert.equal((await run({rpc:retrying})).state,'complete');assert.equal((await rows(db)).length,2);assert.equal((await receipt(db)).length,2);assert.equal(await size(db,'public.workflow_checkpoints'),2);
  const records=calls.filter(x=>x.action==='record'&&x.ticket.source.ticketId==='42'),finishes=calls.filter(x=>x.action==='finish');
  assert.equal(records.length,2);assert.deepEqual(records[0],records[1]);assert.equal(finishes.length,2);assert.deepEqual(finishes[0],finishes[1]);
  const status=checkedIntakeReview(projectIntakeReview(await call({action:'review_status'})));assert.equal(status.createdCount,2);assert.equal(status.pendingReviewCount,0);assert.equal(typeof status.lastSuccessAt,'string');
});

test('assembled exhausted finish acknowledgements report uncertainty without undoing committed checkpoint',async()=>{
  const {db,rpc,run,state}=await assembled();
  const result=await run({rpc:async(input,signal)=>{const result=await rpc(input,signal);if(input.action==='commit_discovery')throw new IntakeFault('WRITE_UNAVAILABLE',true);return result;}});
  assert.equal(result.state,'failed');assert.equal(result.watermarkAdvanced,false);assert.equal(result.completionUncertain,true);
  const saved=await state();assert.equal(saved.completed_total,2);assert.equal(saved.failure_count,1);assert.equal(saved.lease_id,null);assert.equal(saved.last_error_code,'WRITE_UNAVAILABLE');
  assert.equal((await rows(db)).length,2);assert.equal((await receipt(db)).length,2);assert.equal(await size(db,'public.workflow_checkpoints'),2);
});

test('assembled missing durable receipt blocks finish and replays preserve completed technician edits',async()=>{
  const {db,call,tickets,state}=await assembled();const lease=await call({action:'begin'});
  await call({action:'record',leaseId:lease.leaseId,ticket:tickets[0]});
  await assert.rejects(call({action:'commit_discovery',leaseId:lease.leaseId,expectedTicketIds:['42','43'],total:2}),e=>e.code==='WRITE_UNAVAILABLE'&&!e.retryable);
  assert.equal((await state()).watermark.toISOString(),'2026-10-10T00:00:00.000Z');
  await db.query("update public.job_assignments set notes='Synthetic technician edit',status='completed' where id=$1",[(await rows(db))[0].id]);
  const before=await rows(db);assert.equal((await call({action:'record',leaseId:lease.leaseId,ticket:tickets[0]})).state,'existing');assert.deepEqual(await rows(db),before);
  await call({action:'record',leaseId:lease.leaseId,ticket:tickets[1]});
  assert.equal((await call({action:'commit_discovery',leaseId:lease.leaseId,expectedTicketIds:['42','43'],total:2})).state,'complete');
});

test('accepted printed references project SQL through backend DTO and UI while contact/body-like values fail closed',async()=>{
  const {db,call,tickets}=await assembled();const lease=await call({action:'begin'});
  for(const [index,number]of ['WO-000042','A_01.2/3'].entries()){
    const ticket=structuredClone(tickets[index]);ticket.source.ticketNumber=number;ticket.request.ticket_no=number;ticket.source.statusId='synthetic-unknown-status';
    assert.equal((await call({action:'record',leaseId:lease.leaseId,ticket})).state,'review_needed');
  }
  const status=checkedIntakeReview(projectIntakeReview(await call({action:'review_status'})));
  assert.deepEqual(status.held.map(x=>x.ticketNumber),['WO-000042','A_01.2/3']);
  for(const number of ['contact@example.invalid','a ticket body','url:secret','A\nB','-only','A'.repeat(129)]){
    const ticket=structuredClone(tickets[0]);ticket.source.ticketId='99';ticket.source.ticketNumber=number;ticket.request.ticket_no=number;
    await assert.rejects(call({action:'record',leaseId:lease.leaseId,ticket}));
    const invalid={...status,held:[{ticketNumber:number,reasonCodes:['source_status_unreviewed']}]};invalid.pendingReviewCount=1;invalid.heldTruncated=false;
    assert.throws(()=>projectIntakeReview(invalid));assert.throws(()=>checkedIntakeReview(invalid));
  }
  assert.equal((await receipt(db)).length,2);assert.equal((await rows(db)).length,0);
});

test('private crosswalk resolves an explicit assigned source with null projection, preserving immutable source input',async()=>{
  const {db,call,tickets}=await assembled();const lease=await call({action:'begin'});const ticket=tickets[0];
  ticket.source.assignment={state:'assigned',identities:['service.source'],evidence:'Synthetic explicit source assignment'};
  assert.equal(ticket.request.targets[0].assignee_user_id,null);
  assert.equal((await call({action:'record',leaseId:lease.leaseId,ticket})).state,'created');
  const job=(await rows(db))[0];assert.equal(job.assignee_user_id,service);assert.equal(job.assignment_scope,'technician');assert.equal(job.assignee_name,'Synthetic Service');
  assert.equal((await receipt(db))[0].first_payload.request.targets[0].assignee_user_id,null);
  assert.equal((await call({action:'record',leaseId:lease.leaseId,ticket})).state,'existing');assert.equal((await rows(db)).length,1);
});

test('private crosswalk holds unknown source, mismatched nonnull UUID, absent field and inactive profile',async()=>{
  for(const change of [ticket=>{ticket.source.assignment.identities=['unknown.source'];},ticket=>{ticket.request.targets[0].assignee_user_id=it;},ticket=>{delete ticket.request.targets[0].assignee_user_id;},async(_ticket,db)=>{await db.query('update public.profiles set active=false where user_id=$1',[service]);}]){
    const {db,call,tickets}=await assembled();const lease=await call({action:'begin'});const ticket=tickets[0];
    ticket.source.assignment={state:'assigned',identities:['service.source'],evidence:'Synthetic explicit source assignment'};await change(ticket,db);
    const result=await call({action:'record',leaseId:lease.leaseId,ticket});assert.equal(result.state,'review_needed');assert(result.reasonCodes.includes('assignment_identity_unverified')||result.reasonCodes.includes('source_scope_or_route_invalid'));
    assert.equal((await rows(db)).length,0);assert.equal((await receipt(db)).length,1);
  }
});


test('false coverage diagnostics permit a known creation and unknown null-projection hold in one complete source batch',async()=>{
  const {db,call,rpc,tickets,run,state}=await assembled();
  // Coverage is deliberately incomplete; unrelated stale mappings must not veto
  // a ticket whose own type/status/lead facts are independently valid in SQL.
  await db.exec(`insert into cos_mhelp_intake.identity_crosswalk(portal_id,source_identity,legacy_user_id,department,enabled,evidence,review_actor,approval_reference,reviewed_at)
    values('17','synthetic-stale-identity','90000000-0000-4000-8000-000000000001','service',true,'Synthetic stale mapping','approved_service','Synthetic approval',now());
    insert into cos_mhelp_intake.source_status_policies(portal_id,status_id,classification,enabled,evidence,reviewed_by,reviewed_at)
    values('17','synthetic-unrelated-status','review',true,'Synthetic inactive reviewer','90000000-0000-4000-8000-000000000002',now());`);
  const policy=await call({action:'policy'});assert.equal(policy.state,'ready');assert.equal(policy.typeMappingsVerified,false);assert.equal(policy.identityMappingsVerified,false);assert.equal(policy.statusPoliciesVerified,false);
  tickets[1].source.typeId='synthetic-unknown-type';tickets[1].request=null;
  const readSource=createBoundedMhelpSource({getPolicy:async()=>call({action:'policy'}),adapterFor:p=>({schemaContract:p.schemaContract,schemaEvidence:p.schemaEvidence,readPage:async()=>({totalRows:2,rows:tickets}),projectTicket:value=>value})});
  let checkedFinish=false;const result=await run({readSource,rpc:async(input,signal)=>{
    if(input.action==='commit_discovery'){assert.equal((await receipt(db)).length,2);assert.equal((await rows(db)).length,1);assert.equal((await state()).watermark.toISOString(),'2026-10-10T00:00:00.000Z');checkedFinish=true;}
    return rpc(input,signal);
  }});
  assert(checkedFinish);assert.equal(result.state,'complete');assert.equal(result.created,1);assert.equal(result.reviewNeeded,1);assert.equal(result.watermarkAdvanced,true);
  const held=(await receipt(db)).find(r=>r.ticket_id==='43');assert.equal(held.state,'review_needed');assert.equal(held.first_payload.request,null);assert(held.reason_codes.includes('type_mapping_unverified'));assert(held.reason_codes.includes('source_scope_or_route_invalid'));
  assert.equal((await rows(db))[0].ticket_no,'000042');assert.equal(await size(db,'public.workflow_checkpoints'),1);assert.equal(await size(db,'public.app_notifications'),0);
  const status=checkedIntakeReview(projectIntakeReview(await call({action:'review_status'})));assert.equal(status.createdCount,1);assert.equal(status.pendingReviewCount,1);
});

test('an all-held scan retains every null projection with zero created work and never reports a created count',async()=>{
  const {db,call,tickets,run,state}=await assembled();for(const ticket of tickets){ticket.source.typeId='synthetic-unknown-type';ticket.request=null;}
  const result=await run();assert.equal(result.state,'complete');assert.equal(result.scanned,2);assert.equal(result.created,0);assert.equal(result.existing,0);assert.equal(result.reviewNeeded,2);assert.equal(result.watermarkAdvanced,true);
  assert.equal((await rows(db)).length,0);assert.equal(await size(db,'public.workflow_checkpoints'),0);assert.equal((await receipt(db)).length,2);assert.equal((await state()).completed_total,2);
  const status=checkedIntakeReview(projectIntakeReview(await call({action:'review_status'})));assert.equal(status.createdCount,0);assert.equal(status.pendingReviewCount,2);
});

test('explicit null first observation can enrich before creation while frozen candidate controls replay',async()=>{
  const {db,call,tickets}=await assembled();const lease=await call({action:'begin'}),ticket=structuredClone(tickets[0]);ticket.request=null;
  assert.equal((await call({action:'record',leaseId:lease.leaseId,ticket})).state,'review_needed');
  assert.equal((await call({action:'record',leaseId:lease.leaseId,ticket})).state,'review_needed');assert.equal((await receipt(db)).length,1);
  const enriched=await call({action:'record',leaseId:lease.leaseId,ticket:tickets[0]});assert.equal(enriched.state,'created');
  assert.equal((await receipt(db))[0].first_payload.request,null);assert.deepEqual((await receipt(db))[0].candidate_payload,tickets[0]);assert.equal((await rows(db)).length,1);
  const replay=await call({action:'record',leaseId:lease.leaseId,ticket});assert.equal(replay.state,'review_needed');assert.deepEqual(replay.reasonCodes,['source_changed_review_required']);assert.deepEqual(replay.assignmentIds,enriched.assignmentIds);
  for(const request of [false,1,'untrusted scalar',[],{unapproved:'field'}]){const invalid=structuredClone(tickets[1]);invalid.request=request;await assert.rejects(call({action:'record',leaseId:lease.leaseId,ticket:invalid}));}
  assert.equal((await receipt(db)).length,1);
});


test('immutable source-identity changes stay latched even when earlier uncreated candidate becomes eligible',async()=>{
  const {db,call,tickets}=await assembled();const lease=await call({action:'begin'}),original=tickets[0];
  await db.exec("update cos_mhelp_intake.type_mappings set enabled=false where type_id='5'");
  assert.equal((await call({action:'record',leaseId:lease.leaseId,ticket:original})).state,'review_needed');
  const changed=structuredClone(original);changed.source.createdAt='2026-10-10T00:00:02Z';
  assert.deepEqual((await call({action:'record',leaseId:lease.leaseId,ticket:changed})).reasonCodes,['source_identity_changed_review_required']);
  await db.exec("update cos_mhelp_intake.type_mappings set enabled=true where type_id='5'");
  const replay=await call({action:'record',leaseId:lease.leaseId,ticket:original});assert.equal(replay.state,'review_needed');assert.deepEqual(replay.reasonCodes,['source_identity_changed_review_required']);
  const saved=(await receipt(db))[0];assert.deepEqual(saved.first_payload,original);assert.deepEqual(saved.candidate_payload,original);assert.equal(saved.review_required,true);assert.equal(saved.state,'review_needed');assert.equal((await rows(db)).length,0);
});


test('fail RPC validates optional provider cooldown as bounded JSON integer before touching lease state',async()=>{
  const {call,state}=await assembled();const lease=await call({action:'begin'}),before=await state();
  for(const retryAfterSeconds of [null,'60',1.5,-1,86401,true,[],{},1e100]){
    await assert.rejects(call({action:'fail',leaseId:lease.leaseId,code:'SOURCE_UNAVAILABLE',retryable:true,retryAfterSeconds}),e=>e.code==='WRITE_UNAVAILABLE'&&!e.retryable);
    assert.deepEqual(await state(),before);
  }
  assert.deepEqual(await call({action:'fail',leaseId:lease.leaseId,code:'SOURCE_UNAVAILABLE',retryable:true}),{state:'backoff',retryAfterSeconds:30});
  assert.equal((await state()).watermark.toISOString(),before.watermark.toISOString());
});

test('same service-only fail action persists provider minimum without shortening exponential or permanent backoff',async()=>{
  for(const [provider,retryable,expected]of [[0,true,30],[1,true,30],[90,true,90],[86400,true,86400],[1,false,1800],[7200,false,7200]]){
    const {db,call,state}=await assembled();const lease=await call({action:'begin'}),before=await state();
    const result=await call({action:'fail',leaseId:lease.leaseId,code:'SOURCE_UNAVAILABLE',retryable,retryAfterSeconds:provider});assert.deepEqual(result,{state:'backoff',retryAfterSeconds:expected});
    const saved=await state();assert(saved.retry_after.getTime()>=Date.now()+expected*1000-1000);assert.equal(saved.failure_count,1);assert.equal(saved.lease_id,null);assert.equal(saved.watermark.toISOString(),before.watermark.toISOString());
    assert.deepEqual(await call({action:'begin'}),{state:'backoff'});
    for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("select has_function_privilege($1,'cos_mhelp_intake.fail_intake_v1(uuid,text,boolean,integer)','EXECUTE') f",[role])).rows[0].f,false);
  }
});

test('canonical minimal hold omits unknown containers and durably accounts for the source without creating work',async()=>{
  const {db,call,tickets,state}=await assembled();const lease=await call({action:'begin'});
  const original=tickets[0];const minimal={contract:original.contract,schemaContract:original.schemaContract,source:{portalId:original.source.portalId,ticketId:original.source.ticketId,ticketNumber:original.source.ticketNumber,createdAt:original.source.createdAt},request:null};
  assert.deepEqual(validateOperationalTicket(minimal,lease),minimal);
  const result=await call({action:'record',leaseId:lease.leaseId,ticket:minimal});assert.equal(result.state,'review_needed');assert(result.reasonCodes.includes('source_scope_or_route_invalid'));assert(result.reasonCodes.includes('type_mapping_unverified'));assert(result.reasonCodes.includes('source_status_incomplete_or_deleted'));assert(result.reasonCodes.includes('ticket_lead_unverified'));
  assert.deepEqual((await receipt(db))[0].first_payload,minimal);assert.equal((await rows(db)).length,0);assert.equal(await size(db,'public.workflow_checkpoints'),0);
  assert.equal((await state()).watermark.toISOString(),'2026-10-10T00:00:00.000Z');
  assert.equal((await call({action:'commit_discovery',leaseId:lease.leaseId,expectedTicketIds:['42'],total:1})).state,'complete');
});

test('unknown optional facts must be omitted: JSON null containers and null type/status remain rejected before retention',async()=>{
  const {db,call,tickets}=await assembled();const lease=await call({action:'begin'});
  for(const change of [t=>{t.source.typeId=null;},t=>{t.source.statusId=null;},t=>{t.source.assignment=null;},t=>{t.ticketLead=null;},t=>{t.sourceEvidence=null;},t=>{t.departmentAssignments=null;}]){
    const ticket=structuredClone(tickets[0]);change(ticket);await assert.rejects(call({action:'record',leaseId:lease.leaseId,ticket}));
  }
  assert.equal((await receipt(db)).length,0);assert.equal((await rows(db)).length,0);
});


import {PENDING_BATCH_CONTRACT} from '../intake/mhelpIntakePending.ts';
async function oldPendingFixture(){
 const f=await assembled(),complete=shellPayload('service'),held=structuredClone(complete);held.request=null;
 const lease=await f.call({action:'begin'});assert.equal((await f.call({action:'record',leaseId:lease.leaseId,ticket:held})).state,'review_needed');
 await f.call({action:'commit_discovery',leaseId:lease.leaseId,expectedTicketIds:['42'],total:1});await f.call({action:'finish',leaseId:lease.leaseId});
 await f.db.exec("update cos_mhelp_intake.scheduler_state set watermark=clock_timestamp()-interval '1 minute',last_attempt_at=clock_timestamp()-interval '5 minutes';update cos_mhelp_intake.receipts set pending_next_at=clock_timestamp()-interval '1 second';");
 return {...f,complete,held};
}
test('assembled late scheduling creates once beyond overlap, freezes first/candidate and preserves subsequent manual work',async()=>{
 const f=await oldPendingFixture();let pendingInput,lost=true;
 const result=await f.run({readSource:async window=>{assert(Date.parse(f.complete.source.createdAt)<Date.parse(window.createdAfter));return {contract:BATCH_CONTRACT,portalId:'17',schemaContract:'synthetic-verified-v1',window,totalRows:0,partial:false,tickets:[]};},
  readPending:async leaseId=>({contract:PENDING_BATCH_CONTRACT,leaseId,outcomes:[{ticketId:'42',ticket:f.complete}],budgetExhausted:false}),
  rpc:async(input,signal)=>{const result=await f.rpc(input,signal);if(input.action==='record_pending'){pendingInput=input;if(lost){lost=false;throw new IntakeFault('WRITE_UNAVAILABLE',true);}}return result;}});
 assert.equal(result.state,'complete');assert.equal(result.pending.created,1);assert.equal((await rows(f.db)).length,1);const r=(await receipt(f.db))[0];assert.deepEqual(r.first_payload,f.held);assert.deepEqual(r.candidate_payload,f.complete);assert.equal(r.pending_attempt_count,1);assert.equal(r.pending_next_at,null);assert.equal((await rows(f.db))[0].requested_unit_count,null);assert.equal((await rows(f.db))[0].job_lead_user_id,null);
 await f.db.exec("update public.job_assignments set notes='Synthetic completed manual work',status='completed'");const manual=await rows(f.db);await assert.rejects(f.call(pendingInput),e=>e.code==='WRITE_UNAVAILABLE');assert.deepEqual(await rows(f.db),manual);
});
test('assembled isolated pending failure does not block fresh creation or erase late-ticket state',async()=>{
 const f=await oldPendingFixture();const fresh=structuredClone(f.complete);fresh.source.ticketId='43';fresh.source.ticketNumber='000043';fresh.request.ticket_no='000043';fresh.source.createdAt=new Date(Date.now()-30000).toISOString();
 const result=await f.run({readSource:async window=>({contract:BATCH_CONTRACT,portalId:'17',schemaContract:'synthetic-verified-v1',window,totalRows:1,partial:false,tickets:[fresh]}),
  readPending:async leaseId=>({contract:PENDING_BATCH_CONTRACT,leaseId,outcomes:[{ticketId:'42',code:'SOURCE_UNAVAILABLE',retryable:true}],budgetExhausted:false})});
 assert.equal(result.state,'complete');assert.equal(result.watermarkAdvanced,true);assert.equal(result.created,1);assert.equal(result.pending.deferred,1);assert.equal(result.pending.state,'deferred');assert.equal((await rows(f.db)).length,1);assert.equal((await rows(f.db))[0].ticket_no,'000043');const waiting=(await receipt(f.db)).find(r=>r.ticket_id==='42');assert.equal(waiting.state,'review_needed');assert.deepEqual(waiting.first_payload,f.held);assert.deepEqual(waiting.candidate_payload,f.held);assert.equal(waiting.pending_attempt_count,1);
 const status=await f.call({action:'pending_status'});assert.equal(status.waitingCount,1);assert.equal(status.dueCount,0);assert.equal(status.lastRefreshState,'deferred');
});

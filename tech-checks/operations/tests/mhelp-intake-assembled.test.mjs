/** Isolated SQL + runtime contract tests. Synthetic identities only; no network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,payload,rows,receipt,service,it} from '../legacy/mhelp-intake-fixture.mjs';
import {BATCH_CONTRACT,IntakeFault,runMhelpIntake} from '../intake/mhelpIntakeRuntime.ts';
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
  await db.exec("drop trigger synthetic_batch_lock on public.job_assignments;update cos_mhelp_intake.scheduler_state set retry_after=clock_timestamp()-interval '1 second'");
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
  const result=await run({rpc:async(input,signal)=>{const result=await rpc(input,signal);if(input.action==='finish')throw new IntakeFault('WRITE_UNAVAILABLE',true);return result;}});
  assert.equal(result.state,'failed');assert.equal(result.watermarkAdvanced,false);assert.equal(result.completionUncertain,true);
  const saved=await state();assert.equal(saved.completed_total,2);assert.equal(saved.failure_count,0);assert.equal(saved.lease_id,null);assert.equal(saved.last_error_code,null);
  assert.equal((await rows(db)).length,2);assert.equal((await receipt(db)).length,2);assert.equal(await size(db,'public.workflow_checkpoints'),2);
});

test('assembled missing durable receipt blocks finish and replays preserve completed technician edits',async()=>{
  const {db,call,tickets,state}=await assembled();const lease=await call({action:'begin'});
  await call({action:'record',leaseId:lease.leaseId,ticket:tickets[0]});
  await assert.rejects(call({action:'finish',leaseId:lease.leaseId,expectedTicketIds:['42','43'],total:2}),e=>e.code==='WRITE_UNAVAILABLE'&&!e.retryable);
  assert.equal((await state()).watermark.toISOString(),'2026-10-10T00:00:00.000Z');
  await db.query("update public.job_assignments set notes='Synthetic technician edit',status='completed' where id=$1",[(await rows(db))[0].id]);
  const before=await rows(db);assert.equal((await call({action:'record',leaseId:lease.leaseId,ticket:tickets[0]})).state,'existing');assert.deepEqual(await rows(db),before);
  await call({action:'record',leaseId:lease.leaseId,ticket:tickets[1]});
  assert.equal((await call({action:'finish',leaseId:lease.leaseId,expectedTicketIds:['42','43'],total:2})).state,'complete');
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

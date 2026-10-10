/** Synthetic PGlite lock catalog/ledger tests. Multi-session proof lives in hosted CI. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,shellPayload,accept,rows,receipt,owner} from '../mhelp-intake-fixture.mjs';
const scalar=async(db,query,params=[])=>(await db.query(query,params)).rows[0];
const lockModes=async db=>(await db.query(`select c.relname,l.mode from pg_locks l join pg_class c on c.oid=l.relation
  where l.pid=pg_backend_pid() and c.relnamespace='public'::regnamespace and c.relname in ('job_assignments','prep_tickets','unit_returns') order by c.relname,l.mode`)).rows;
const humanInsert=(table,number='000042')=>table==='job_assignments'
  ? `insert into public.job_assignments(ticket_no,assigned_role,assigned_by,assigned_by_name)values('${number}','service','${owner}','Synthetic Owner')`
  : `insert into public.${table}(ticket_no,status)values('${number}','synthetic-history')`;
const rpc=async(db,request)=>{
  await db.exec('set role service_role');
  try{return (await scalar(db,'select public.camera_mhelp_ticket_intake_v1($1::jsonb) value',[JSON.stringify(request)])).value;}
  finally{await db.exec('reset role');}
};

test('pending and invalid schedule holds acquire no public write-conflicting table lock',async()=>{
  for(const pending of ['null_projection','missing_schedule']){
    const db=await fixture({type:'pickup'}),body=shellPayload('pickup');
    if(pending==='null_projection')body.request=null;else body.request.scheduled_for=null;
    await db.exec('begin');
    try{
      assert.equal((await accept(db,body)).state,'review_needed');
      const modes=await lockModes(db);
      assert(modes.every(lock=>lock.mode==='AccessShareLock'),JSON.stringify(modes));
      assert.deepEqual([...new Set(modes.map(lock=>lock.relname))],['job_assignments','prep_tickets','unit_returns']);
      assert.equal((await rows(db)).length,0);assert.equal((await receipt(db)).length,1);
    }finally{await db.exec('rollback');}
  }
});

test('every potentially creating enrichment keeps all three original NOWAIT locks and a fresh collision check',async()=>{
  const db=await fixture({type:'pickup'}),first=shellPayload('pickup');first.request=null;await accept(db,first);
  await db.exec(humanInsert('job_assignments'));
  await db.exec('begin');
  try{
    const result=await accept(db,shellPayload('pickup'));assert.deepEqual(result.reasonCodes,['existing_ticket_requires_reconciliation']);
    const modes=await lockModes(db);assert.equal(modes.filter(lock=>lock.mode==='ShareRowExclusiveLock').length,3);
    assert.equal((await rows(db)).length,1);assert.equal((await receipt(db))[0].state,'review_needed');
  }finally{await db.exec('rollback');}
});

test('observed manual assignment/prep/return history remains a permanent hold after synthetic history removal',async()=>{
  for(const table of ['job_assignments','prep_tickets','unit_returns']){
    const db=await fixture({type:'pickup'}),body=shellPayload('pickup');await db.exec(humanInsert(table));
    const first=await accept(db,body);assert(first.reasonCodes.includes('existing_ticket_requires_reconciliation'));
    const saved=(await receipt(db))[0];await db.exec(`delete from public.${table}`);
    const replay=await accept(db,body);assert.deepEqual(replay.reasonCodes,first.reasonCodes);
    assert.equal((await rows(db)).length,0);assert.deepEqual((await receipt(db))[0],saved);
  }
});

test('invalid initial candidates still record observed history without acquiring broad locks',async()=>{
  const db=await fixture({type:'pickup'}),first=shellPayload('pickup');first.request=null;await db.exec(humanInsert('prep_tickets'));
  await db.exec('begin');
  try{
    const result=await accept(db,first);assert(result.reasonCodes.includes('existing_ticket_requires_reconciliation'));
    assert((await lockModes(db)).every(lock=>lock.mode==='AccessShareLock'));
  }finally{await db.exec('commit');}
  await db.exec('delete from public.prep_tickets');
  assert((await accept(db,shellPayload('pickup'))).reasonCodes.includes('existing_ticket_requires_reconciliation'));assert.equal((await rows(db)).length,0);
});

test('automatic pending and overlap discovery cannot recreate removed historical work or unpark its latch',async()=>{
  const db=await fixture({type:'pickup',realScheduler:true}),complete=shellPayload('pickup');
  await db.exec("update cos_mhelp_intake.portal_config set activated_at=clock_timestamp()-interval '5 minutes'");
  complete.source.createdAt=new Date(Date.now()-4*60*1000).toISOString();const first=structuredClone(complete);first.request=null;
  const lease=await rpc(db,{action:'begin'});
  await rpc(db,{action:'record',leaseId:lease.leaseId,ticket:first});
  await rpc(db,{action:'commit_discovery',leaseId:lease.leaseId,expectedTicketIds:['42'],total:1});await rpc(db,{action:'finish',leaseId:lease.leaseId});
  await db.exec("update cos_mhelp_intake.scheduler_state set last_attempt_at=clock_timestamp()-interval '5 minutes';update cos_mhelp_intake.receipts set pending_next_at=clock_timestamp()-interval '1 second';");
  const next=await rpc(db,{action:'begin'});await rpc(db,{action:'commit_discovery',leaseId:next.leaseId,expectedTicketIds:[],total:0});
  assert.deepEqual((await rpc(db,{action:'pending_scope',leaseId:next.leaseId})).tickets.map(t=>t.ticketId),['42']);
  await db.exec(humanInsert('job_assignments'));
  const observation={action:'record_pending',leaseId:next.leaseId,outcome:{ticketId:'42',ticket:complete}};
  const collision=await rpc(db,observation);assert(collision.reasonCodes.includes('existing_ticket_requires_reconciliation'));
  assert.equal((await receipt(db))[0].pending_next_at,null);
  await db.exec('delete from public.job_assignments');assert.deepEqual(await rpc(db,observation),collision);assert.equal((await rows(db)).length,0);
  await rpc(db,{action:'finish',leaseId:next.leaseId});
  // An ordinary overlapping discovery pass calls schedule_pending again. It
  // must preserve the latch and keep the receipt parked even after row removal.
  await db.exec("update cos_mhelp_intake.scheduler_state set last_attempt_at=clock_timestamp()-interval '5 minutes';");
  const overlap=await rpc(db,{action:'begin'}),result=await rpc(db,{action:'record',leaseId:overlap.leaseId,ticket:complete});
  assert(result.reasonCodes.includes('existing_ticket_requires_reconciliation'));assert.equal((await receipt(db))[0].pending_next_at,null);
  await rpc(db,{action:'commit_discovery',leaseId:overlap.leaseId,expectedTicketIds:[],total:0});
  // Defensive selector filtering also excludes a stale/incorrect due timestamp.
  await db.exec("update cos_mhelp_intake.receipts set pending_next_at=clock_timestamp()-interval '1 second'");
  assert.deepEqual((await rpc(db,{action:'pending_scope',leaseId:overlap.leaseId})).tickets,[]);assert.equal((await rows(db)).length,0);
  assert.deepEqual((await receipt(db))[0].first_payload,first);
});

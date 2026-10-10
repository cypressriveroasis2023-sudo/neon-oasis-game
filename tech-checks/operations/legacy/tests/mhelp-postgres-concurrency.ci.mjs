/** Hosted-CI-only real PostgreSQL races. No Docker commands, production URLs or supplied DB credentials. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {fixture,payload,shellPayload,owner,it,service} from '../mhelp-intake-fixture.mjs';
export function assertCiContext(env=process.env){
  if(env.GITHUB_ACTIONS!=='true'||env.COS_MHELP_POSTGRES_CI!=='1')throw Error('Real PostgreSQL tests require the explicit ephemeral GitHub Actions service; no local database was contacted.');
}
export const connection=Object.freeze({host:'127.0.0.1',port:'5432',database:'cos_mhelp_intake_ci',user:'postgres'});
export function validateIsolatedServer(guard){
  assert.equal(guard.database,connection.database);assert.equal(guard.account,connection.user);assert.equal(guard.port,Number(connection.port));
  // The client destination above is fixed loopback. inet_server_addr() identifies
  // the container-side interface, whose Docker subnet is intentionally not fixed.
}
const literal=value=>value===null?'NULL':typeof value==='boolean'?String(value):typeof value==='number'&&Number.isFinite(value)?String(value):"'"+String(value).replaceAll("'","''")+"'";
export const parameters=(sql,values=[])=>sql.replace(/\$(\d+)/g,(_,number)=>{if(Number(number)<1||Number(number)>values.length)throw Error('Invalid synthetic SQL parameter');return literal(values[Number(number)-1]);});
function openPsql(sql,{application='mhelp-ci',held=false}={}){
  assertCiContext();
  const child=spawn('psql',['--no-psqlrc','--quiet','--tuples-only','--no-align','--set=ON_ERROR_STOP=1','--set=VERBOSITY=verbose','--host='+connection.host,'--port='+connection.port,'--username='+connection.user,'--dbname='+connection.database],{
    env:{PATH:process.env.PATH,LANG:'C.UTF-8',PGPASSWORD:'synthetic-ci-only',PGAPPNAME:application,PGCONNECT_TIMEOUT:'5',PGOPTIONS:'-c statement_timeout=15000 -c lock_timeout=3000'},stdio:['pipe','pipe','pipe'],
  });
  let stdout='',stderr='',resolveReady,rejectReady;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  // A failed process can exit before the caller reaches ready; preserve the rejection.
  ready.catch(()=>{});
  const timeout=setTimeout(()=>child.kill('SIGKILL'),20000);
  const done=new Promise((resolve,reject)=>{
    child.stdout.on('data',data=>{stdout+=data;if(stdout.length>1048576)child.kill('SIGKILL');if(stdout.includes('__MHELP_HELD__'))resolveReady();});
    child.stderr.on('data',data=>{stderr+=data;if(stderr.length>1048576)child.kill('SIGKILL');});
    child.on('error',error=>{clearTimeout(timeout);rejectReady(error);reject(error);});
    child.on('close',code=>{clearTimeout(timeout);if(code===0){resolveReady();resolve(stdout);}else{const error=Object.assign(Error('Synthetic PostgreSQL test failed: '+stderr),{sqlstate:stderr.match(/(?:ERROR|FATAL):\s+([A-Z0-9]{5}):/)?.[1]});rejectReady(error);reject(error);}});
  });
  done.catch(()=>{});
  if(held)child.stdin.write(sql+'\n\\echo __MHELP_HELD__\n');else child.stdin.end(sql+'\n');
  return {done,ready,release:async()=>{if(held&&!child.stdin.destroyed)child.stdin.end('COMMIT;\n\\q\n');return done;},rollback:async()=>{if(held&&!child.stdin.destroyed)child.stdin.end('ROLLBACK;\n\\q\n');return done;},abort:()=>child.kill('SIGKILL')};
}
const exec=async(sql,options)=>openPsql(sql,options).done;
const jsonLines=text=>text.split(/\r?\n/).filter(line=>line.trim().startsWith('{')||line.trim().startsWith('[')).map(line=>JSON.parse(line));
async function query(sql,values=[]){const text=await exec('select coalesce(json_agg(row_to_json(v)),\'[]\'::json) from ('+parameters(sql,values).replace(/;\s*$/,'')+') v;');return {rows:jsonLines(text).at(-1)};}
const rpcSql=input=>`set local role service_role;select public.camera_mhelp_ticket_intake_v1(${literal(JSON.stringify(input))}::jsonb);`;
const rpc=async(input,options)=>jsonLines(await exec('begin;'+rpcSql(input)+'commit;',options)).at(-1);
const snapshot=async()=> (await query('select id,ticket_no,status,assignee_user_id,assignee_name,assignment_scope,notes,started_at,completed_at,claimed_at,updated_at from public.job_assignments order by id')).rows;
const stats=async()=> (await query("select (select count(*) from public.job_assignments)::integer assignments,(select count(*) from cos_mhelp_intake.receipts)::integer receipts,(select count(*) from public.app_notifications)::integer notifications,(select watermark from cos_mhelp_intake.scheduler_state where portal_id='17') watermark")).rows[0];
async function setup(type='service',activationAgeMinutes=5){
  const guard=(await query('select current_database() database,current_user account,inet_server_port() port')).rows[0];
  validateIsolatedServer(guard);
  await fixture({type,database:{exec,query:async(sql,values)=>{await exec(parameters(sql,values));return {rows:[]};}},realScheduler:true});
  await exec(`update cos_mhelp_intake.portal_config set activated_at=date_trunc('milliseconds',clock_timestamp()-make_interval(mins=>${literal(activationAgeMinutes)})) where portal_id='17';`);
  const lease=await rpc({action:'begin'});assert.equal(lease.state,'leased');
  const ticket=payload(type);ticket.source.createdAt=new Date(Date.parse(lease.activationFloor)+1000).toISOString();return {lease,ticket,record:{action:'record',leaseId:lease.leaseId,ticket}};
}
async function waitForLock(application,maxWaitMs=1200){
  const until=Date.now()+maxWaitMs;
  while(Date.now()<until){const rows=(await query('select wait_event_type from pg_stat_activity where application_name=$1',[application])).rows;if(rows.some(r=>r.wait_event_type==='Lock'))return;await sleep(20);}
  throw Error('The second real database session did not demonstrate lock contention');
}
async function duplicateRace(){
  const {record}=await setup('swap');
  const first=openPsql('begin;'+rpcSql(record),{application:'mhelp-ci-duplicate-first',held:true});
  try{
    await first.ready;
    const second=rpc(record,{application:'mhelp-ci-duplicate-second'});second.catch(()=>{});
    await waitForLock('mhelp-ci-duplicate-second');
    const firstResult=jsonLines(await first.release()).at(-1),secondResult=await second;
    assert.equal(firstResult.state,'created');assert.equal(secondResult.state,'existing');assert.deepEqual(firstResult.assignmentIds,secondResult.assignmentIds);
    assert.deepEqual({...await stats(),watermark:null},{assignments:2,receipts:1,notifications:0,watermark:null});
    console.log('PASS: separate PostgreSQL sessions contended on the same source and committed one assignment set/receipt.');
  }finally{await first.release().catch(()=>first.abort());}
}
async function legacyTableContention(){
  const {lease,record}=await setup(),before=await stats();
  const holder=openPsql('begin;lock table public.job_assignments in row exclusive mode;',{application:'mhelp-ci-human-lock',held:true});
  try{
    await holder.ready;const start=Date.now();
    await assert.rejects(rpc(record),error=>error.sqlstate==='55P03');
    assert(Date.now()-start<2000,'NOWAIT must fail promptly rather than holding the human workflow');
    assert.deepEqual(await stats(),before,'Failed record must leave receipts/assignments/watermark unchanged');
  }finally{await holder.release().catch(()=>holder.abort());}
  assert.equal((await rpc(record)).state,'created');
  assert.equal((await rpc({action:'commit_discovery',leaseId:lease.leaseId,expectedTicketIds:['42'],total:1})).state,'complete');
  assert.equal((await rpc({action:'finish',leaseId:lease.leaseId})).state,'complete');
  assert.equal(Date.parse((await stats()).watermark),Date.parse(lease.createdBefore));
  console.log('PASS: a real legacy table lock causes bounded NOWAIT failure, unchanged watermark and safe same-key retry.');
}
async function creatingCandidatePublicContention(){
  for(const ending of ['commit','rollback']){
    const {record}=await setup('swap');
    const first=openPsql('begin;'+rpcSql(record),{application:'mhelp-ci-creating-intake',held:true});let writer;
    try{
      await first.ready;
      writer=exec(`begin;set local lock_timeout='5s';set local statement_timeout='10s';
        insert into public.job_assignments(ticket_no,assigned_role,assigned_by,assigned_by_name)
        values('SYN-MANUAL-OTHER','service',${literal(owner)}::uuid,'Synthetic Owner');commit;`,{application:'mhelp-ci-waiting-human'});
      writer.catch(()=>{});await waitForLock('mhelp-ci-waiting-human',2500);
      const releasedAt=Date.now();
      if(ending==='commit')await first.release();else await first.rollback();
      await writer;assert(Date.now()-releasedAt<5000,'Ordinary writer must resume within the bounded post-release window');
      const jobs=await snapshot();assert.equal(jobs.filter(row=>row.ticket_no==='SYN-MANUAL-OTHER').length,1);
      assert.equal(jobs.filter(row=>row.ticket_no==='000042').length,ending==='commit'?2:0);
      assert.equal((await stats()).receipts,ending==='commit'?1:0);
    }finally{await first.release().catch(()=>first.abort());if(writer)await writer.catch(()=>{});}
  }
  console.log('PASS: valid intake retains public history locks until COMMIT/ROLLBACK; ordinary writes resume after either outcome.');
}
async function heldCandidatePublicWrites(){
  // A held transaction deliberately stays open while a separate ordinary writer
  // mutates each history table. This must succeed before the intake COMMIT.
  for(const projection of ['null_request','missing_schedule'])for(const table of ['job_assignments','prep_tickets','unit_returns']){
    const {record}=await setup('pickup'),complete=shellPayload('pickup');complete.source.createdAt=record.ticket.source.createdAt;
    record.ticket=structuredClone(complete);if(projection==='null_request')record.ticket.request=null;else record.ticket.request.scheduled_for=null;
    const first=openPsql('begin;'+rpcSql(record),{application:'mhelp-ci-held-candidate',held:true});
    try{
      await first.ready;
      const locks=(await query(`select c.relname,l.mode from pg_locks l join pg_class c on c.oid=l.relation join pg_stat_activity a on a.pid=l.pid
        where a.application_name='mhelp-ci-held-candidate' and c.relnamespace='public'::regnamespace and c.relname in ('job_assignments','prep_tickets','unit_returns')`)).rows;
      assert(locks.every(lock=>lock.mode==='AccessShareLock'),JSON.stringify(locks));
      const insert=table==='job_assignments'
        ? `insert into public.job_assignments(ticket_no,assigned_role,assigned_by,assigned_by_name)values('000042','service',${literal(owner)}::uuid,'Synthetic Owner');`
        : `insert into public.${table}(ticket_no,status)values('000042','synthetic-history');`;
      await exec("begin;set local lock_timeout='250ms';set local statement_timeout='1s';"+insert+'commit;',{application:'mhelp-ci-ordinary-public-writer'});
      const held=jsonLines(await first.release()).at(-1);assert.equal(held.state,'review_needed');
      const valid={...record,ticket:complete},collision=await rpc(valid);assert(collision.reasonCodes.includes('existing_ticket_requires_reconciliation'));
      // Synthetic history removal must never convert a previous collision into
      // authority to create work on discovery overlap or a pending reread.
      await exec(`delete from public.${table} where ticket_no='000042';`);
      const replay=await rpc(valid);assert(replay.reasonCodes.includes('existing_ticket_requires_reconciliation'));
      const receipt=(await query('select first_payload,candidate_payload,pending_next_at from cos_mhelp_intake.receipts')).rows[0];
      assert.deepEqual(receipt.first_payload,record.ticket);assert.deepEqual(receipt.candidate_payload,complete);assert.equal(receipt.pending_next_at,null);
      assert.equal((await stats()).assignments,0);
    }finally{await first.release().catch(()=>first.abort());}
  }
  console.log('PASS: held schedule candidates leave ordinary public writes unblocked; valid enrichment rechecks collisions and removed history stays latched.');
}
async function lostAcknowledgement(){
  const {lease,record}=await setup();
  // Deliberately discard the committed record response: simulate lost HTTP acknowledgement.
  await exec('begin;'+rpcSql(record)+'commit;');
  const initial=await snapshot();assert.equal(initial.length,1);const assignment=initial[0].id;
  await exec(`begin;select set_config('test.real_user',${literal(service)},true);select public.claim_my_department_assignment(${literal(assignment)}::uuid);update public.job_assignments set notes='Synthetic manual technician edit' where id=${literal(assignment)}::uuid;commit;`);
  const claimed=await snapshot();assert.equal(claimed[0].status,'started');assert.equal(claimed[0].assignee_user_id,service);assert.equal(claimed[0].notes,'Synthetic manual technician edit');
  const claimedNotifications=(await stats()).notifications;
  assert.equal((await rpc(record)).state,'existing');assert.deepEqual(await snapshot(),claimed);assert.equal((await stats()).notifications,claimedNotifications);
  await exec(`update public.job_assignments set status='completed',completed_at=clock_timestamp(),notes='Synthetic completed work edit' where id=${literal(assignment)}::uuid;`);
  const completed=await snapshot();assert.equal((await rpc(record)).state,'existing');assert.deepEqual(await snapshot(),completed);
  const commit={action:'commit_discovery',leaseId:lease.leaseId,expectedTicketIds:['42'],total:1};
  await exec('begin;'+rpcSql(commit)+'commit;'); // Lose discovery-commit acknowledgement too.
  assert.deepEqual(await rpc(commit),{state:'complete',total:1,watermarkAdvanced:true});
  const finish={action:'finish',leaseId:lease.leaseId};await exec('begin;'+rpcSql(finish)+'commit;');
  assert.deepEqual(await rpc(finish),{state:'complete',watermarkAdvanced:true});assert.deepEqual(await snapshot(),completed);assert.equal((await stats()).notifications,claimedNotifications);
  assert.equal((await stats()).assignments,1);assert.equal((await stats()).receipts,1);
  console.log('PASS: lost record/finish acknowledgements replay safely after genuine fixture claim, manual edits and completion.');
}
async function scheduledProfileContention(){
  // Actual crosswalk/profile locks use the same fresh proposal as PGlite.
  for(const target of ['crosswalk','profile']){
    const {record}=await setup('pickup');const createdAt=record.ticket.source.createdAt;
    record.ticket=shellPayload('pickup');record.ticket.source.createdAt=createdAt;
    record.ticket.request.targets.find(target=>target.role==='service').assignee_user_id=null;
    for(const role of ['anon','authenticated','service_role']){
      const access=(await query(`select has_schema_privilege($1,'cos_mhelp_intake','usage') s,
        has_table_privilege($1,'cos_mhelp_intake.receipts','select,insert,update,delete') t,
        has_function_privilege($1,'cos_mhelp_intake.accept_ticket_v1(jsonb)','execute') f,
        has_function_privilege($1,'public.camera_mhelp_ticket_intake_v1(jsonb)','execute') rpc`,[role])).rows[0];
      assert.deepEqual(access,{s:false,t:false,f:false,rpc:role==='service_role'});
    }
    const implementation=(await query("select prosrc,prosecdef from pg_proc where oid='cos_mhelp_intake.accept_ticket_v1(jsonb)'::regprocedure")).rows[0];
    assert.equal(implementation.prosecdef,false);assert(implementation.prosrc.includes('technician_equipment_selection_v1'));
    const first=openPsql('begin;'+rpcSql(record),{application:'mhelp-ci-shell-first',held:true});
    let edit;
    try{
      await first.ready;
      edit=exec(target==='crosswalk'
        ? "update cos_mhelp_intake.identity_crosswalk set enabled=false where portal_id='17' and source_identity='service.source';"
        : `update public.profiles set active=false where user_id=${literal(service)}::uuid;`,{application:'mhelp-ci-shell-edit'});
      edit.catch(()=>{});await waitForLock('mhelp-ci-shell-edit');
      const created=jsonLines(await first.release()).at(-1);assert.equal(created.state,'created');await edit;
      const jobs=(await query('select id,job_lead_user_id,assignee_user_id,status from public.job_assignments order by id')).rows;
      assert.equal(jobs.length,2);assert(jobs.every(row=>row.job_lead_user_id===null&&row.status==='assigned'));
      assert.equal(jobs.filter(row=>row.assignee_user_id===service).length,1);assert.equal(jobs.filter(row=>row.assignee_user_id===null).length,1);
      const saved=(await query('select first_payload,candidate_payload from cos_mhelp_intake.receipts')).rows;
      assert.deepEqual(saved[0].candidate_payload,record.ticket);assert(!('ticketLead' in saved[0].first_payload));
      assert.equal((await rpc(record)).state,'existing');
      assert.deepEqual((await query('select id,job_lead_user_id,assignee_user_id,status from public.job_assignments order by id')).rows,jobs);
      assert.deepEqual((await query('select first_payload,candidate_payload from cos_mhelp_intake.receipts')).rows,saved);
      assert.equal((await stats()).notifications,0);
      const newer=structuredClone(record);newer.ticket.source.ticketId='43';newer.ticket.source.ticketNumber='000043';newer.ticket.request.ticket_no='000043';
      const held=await rpc(newer);assert.equal(held.state,'review_needed');assert(held.reasonCodes.includes('assignment_identity_unverified'));
      assert.equal((await stats()).assignments,2);
      console.log('PASS: real PostgreSQL '+target+' edits wait for scheduled-shell creation; frozen replay/ACLs stay unchanged and later invalid assignments hold.');
    }finally{await first.release().catch(()=>first.abort());if(edit)await edit.catch(()=>{});}
  }
}
async function pendingEnrichment(){
  const {lease,record}=await setup('pickup',30);const complete=shellPayload('pickup');complete.source.createdAt=record.ticket.source.createdAt;record.ticket=structuredClone(complete);record.ticket.request=null;
  assert.equal((await rpc(record)).state,'review_needed');
  await rpc({action:'commit_discovery',leaseId:lease.leaseId,expectedTicketIds:['42'],total:1});await rpc({action:'finish',leaseId:lease.leaseId});
  // Move only synthetic scheduler state: the old ticket is now beyond overlap.
  await exec("update cos_mhelp_intake.scheduler_state set watermark=clock_timestamp()-interval '1 minute',last_attempt_at=clock_timestamp()-interval '5 minutes';update cos_mhelp_intake.receipts set pending_next_at=clock_timestamp()-interval '1 second';");
  const next=await rpc({action:'begin'});assert(Date.parse(complete.source.createdAt)<Date.parse(next.createdAfter));
  await rpc({action:'commit_discovery',leaseId:next.leaseId,expectedTicketIds:[],total:0});
  const scope=await rpc({action:'pending_scope',leaseId:next.leaseId});assert.deepEqual(scope.tickets.map(t=>t.ticketId),['42']);
  const observation={action:'record_pending',leaseId:next.leaseId,outcome:{ticketId:'42',ticket:complete}};
  const first=openPsql('begin;'+rpcSql(observation),{application:'mhelp-ci-pending-first',held:true});let second;
  try{
    await first.ready;second=rpc(observation,{application:'mhelp-ci-pending-replay'});second.catch(()=>{});await waitForLock('mhelp-ci-pending-replay');
    assert.equal(jsonLines(await first.release()).at(-1).state,'created');assert.equal((await second).state,'created');
    const receipt=(await query('select first_payload,candidate_payload,pending_attempt_count,pending_next_at from cos_mhelp_intake.receipts')).rows[0];
    assert.equal(receipt.first_payload.request,null);assert.deepEqual(receipt.candidate_payload,complete);assert.equal(receipt.pending_attempt_count,1);assert.equal(receipt.pending_next_at,null);assert.equal((await stats()).assignments,2);
    await exec("update public.job_assignments set notes='Synthetic post-enrichment manual edit',status='completed';");const manual=await snapshot();assert.equal((await rpc(observation)).state,'created');assert.deepEqual(await snapshot(),manual);
    await rpc({action:'finish',leaseId:next.leaseId});assert.equal((await stats()).notifications,0);
    console.log('PASS: pending late scheduling beyond overlap serializes concurrent lost-ack replay, creates once, and preserves manual edits.');
  }finally{await first.release().catch(()=>first.abort());if(second)await second.catch(()=>{});}
}
export async function main(){assertCiContext();await duplicateRace();await legacyTableContention();await creatingCandidatePublicContention();await heldCandidatePublicWrites();await lostAcknowledgement();await scheduledProfileContention();await pendingEnrichment();console.log('All real PostgreSQL concurrency checks passed.');}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});

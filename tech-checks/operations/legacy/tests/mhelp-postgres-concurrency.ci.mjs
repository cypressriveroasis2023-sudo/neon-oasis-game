/** Hosted-CI-only real PostgreSQL races. No Docker commands, production URLs or supplied DB credentials. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {fixture,payload,service} from '../mhelp-intake-fixture.mjs';
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
  return {done,ready,release:async()=>{if(held&&!child.stdin.destroyed)child.stdin.end('COMMIT;\n\\q\n');return done;},abort:()=>child.kill('SIGKILL')};
}
const exec=async(sql,options)=>openPsql(sql,options).done;
const jsonLines=text=>text.split(/\r?\n/).filter(line=>line.trim().startsWith('{')||line.trim().startsWith('[')).map(line=>JSON.parse(line));
async function query(sql,values=[]){const text=await exec('select coalesce(json_agg(row_to_json(v)),\'[]\'::json) from ('+parameters(sql,values).replace(/;\s*$/,'')+') v;');return {rows:jsonLines(text).at(-1)};}
const rpcSql=input=>`set local role service_role;select public.camera_mhelp_ticket_intake_v1(${literal(JSON.stringify(input))}::jsonb);`;
const rpc=async(input,options)=>jsonLines(await exec('begin;'+rpcSql(input)+'commit;',options)).at(-1);
const snapshot=async()=> (await query('select id,ticket_no,status,assignee_user_id,assignee_name,assignment_scope,notes,started_at,completed_at,claimed_at,updated_at from public.job_assignments order by id')).rows;
const stats=async()=> (await query("select (select count(*) from public.job_assignments)::integer assignments,(select count(*) from cos_mhelp_intake.receipts)::integer receipts,(select count(*) from public.app_notifications)::integer notifications,(select watermark from cos_mhelp_intake.scheduler_state where portal_id='17') watermark")).rows[0];
async function setup(type='service'){
  const guard=(await query('select current_database() database,current_user account,inet_server_port() port')).rows[0];
  validateIsolatedServer(guard);
  await fixture({type,database:{exec,query:async(sql,values)=>{await exec(parameters(sql,values));return {rows:[]};}},realScheduler:true});
  await exec("update cos_mhelp_intake.portal_config set activated_at=date_trunc('milliseconds',clock_timestamp()-interval '5 minutes') where portal_id='17';");
  const lease=await rpc({action:'begin'});assert.equal(lease.state,'leased');
  const ticket=payload(type);ticket.source.createdAt=new Date(Date.parse(lease.activationFloor)+1000).toISOString();return {lease,ticket,record:{action:'record',leaseId:lease.leaseId,ticket}};
}
async function waitForLock(application){
  const until=Date.now()+1200;
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
  assert.equal((await rpc({action:'finish',leaseId:lease.leaseId,expectedTicketIds:['42'],total:1})).state,'complete');
  assert.equal(Date.parse((await stats()).watermark),Date.parse(lease.createdBefore));
  console.log('PASS: a real legacy table lock causes bounded NOWAIT failure, unchanged watermark and safe same-key retry.');
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
  const finish={action:'finish',leaseId:lease.leaseId,expectedTicketIds:['42'],total:1};
  await exec('begin;'+rpcSql(finish)+'commit;'); // Lose finish acknowledgement too.
  assert.deepEqual(await rpc(finish),{state:'complete',total:1,watermarkAdvanced:true});assert.deepEqual(await snapshot(),completed);assert.equal((await stats()).notifications,claimedNotifications);
  assert.equal((await stats()).assignments,1);assert.equal((await stats()).receipts,1);
  console.log('PASS: lost record/finish acknowledgements replay safely after genuine fixture claim, manual edits and completion.');
}
export async function main(){assertCiContext();await duplicateRace();await legacyTableContention();await lostAcknowledgement();console.log('All real PostgreSQL concurrency checks passed.');}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});

/** Synthetic-only pending enrichment, private scheduler and interrupted transport tests. */
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {INTAKE_CONTRACT,BATCH_CONTRACT,IntakeFault,runMhelpIntake} from '../intake/mhelpIntakeRuntime.ts';
import {PENDING_LIMITS,PENDING_SCOPE_CONTRACT,PENDING_BATCH_CONTRACT,parsePendingScope,validatePendingBatch,validatePendingTicket} from '../intake/mhelpIntakePending.ts';
import {createBoundedPendingSource,PendingTicketFault} from '../intake/mhelpIntakeSource.ts';
import {projectRunResult,readBoundedJson,fetchBounded,createNativeIntakeSourceHandler} from '../intake/mhelpIntakeHandlers.ts';
import {createExistingCredentialPendingRead,createExistingCredentialPendingScopeRead} from '../intake/mhelpIntakeTransport.ts';
import {createCameraMhelpReadinessHandler} from '../../supabase/functions/camera-mhelp-readiness/index.ts';
const at=Date.parse('2026-10-10T12:00:00.000Z'),floor='2026-10-10T10:00:00.000Z';
const leaseId='10000000-0000-4000-8000-000000000001';
const ticket=(id='1')=>({contract:'cos-mhelp-legacy-intake-v1',schemaContract:'synthetic-only',source:{portalId:'17',ticketId:id,ticketNumber:'WO-'+id,createdAt:'2026-10-10T10:01:00.000Z'},request:null});
const scope=(ids=['1'])=>({contract:PENDING_SCOPE_CONTRACT,leaseId,portalId:'17',schemaContract:'synthetic-only',activationFloor:floor,leaseUntil:'2026-10-10T12:03:00.000Z',tickets:ids.map(ticketId=>({ticketId,createdAt:ticket(ticketId).source.createdAt}))});
const policy=()=>({state:'ready',portalId:'17',schemaContract:'synthetic-only',schemaEvidence:'Synthetic verified contract',activationFloor:floor,typeMappingsVerified:false,identityMappingsVerified:false,statusPoliciesVerified:false});
const refresh=(outcomes=[{ticketId:'1',ticket:ticket()}],extra={})=>({contract:PENDING_BATCH_CONTRACT,leaseId,outcomes,budgetExhausted:false,...extra});
const request=(body)=>new Request('https://synthetic.invalid',{method:'POST',headers:{'Content-Type':'application/json','x-camera-cron-secret':'synthetic-only'},body:JSON.stringify(body)});
function source({ids=['1'],read,open,sleep}={}){let calls=0;const p=policy();return {calls:()=>calls,read:createBoundedPendingSource({getScope:async()=>scope(ids),getPolicy:async()=>p,now:()=>at,sleep:sleep??(async()=>{}),adapterFor:()=>({schemaContract:p.schemaContract,schemaEvidence:p.schemaEvidence,readPage:async()=>{},projectTicket:v=>v,openPending:open,readPendingTicket:read??(async({ticketId},_s,budget)=>budget(async()=>{calls++;return ticket(ticketId);}))})})};}

test('pending validation admits an exact known post-activation ID beyond discovery overlap only',()=>{
 const s=parsePendingScope(scope(),at);assert.deepEqual(validatePendingTicket(ticket(),s),ticket());
 for(const edit of [v=>v.source.ticketId='2',v=>v.source.portalId='18',v=>v.source.createdAt=floor,v=>v.source.createdAt='2026-10-09T00:00:00.000Z',v=>v.source.contact={private:'x'},v=>v.schemaContract='unknown']){const t=ticket();edit(t);assert.throws(()=>validatePendingTicket(t,s));}
 for(const edit of [v=>v.tickets.push(v.tickets[0]),v=>v.tickets=Array.from({length:11},(_,i)=>({ticketId:String(i+1),createdAt:ticket().source.createdAt})),v=>v.tickets[0].createdAt='2026-10-09T00:00:00.000Z',v=>v.leaseUntil='2026-10-10T12:00:00.000Z',v=>v.actor='owner']){const v=scope();edit(v);assert.throws(()=>parsePendingScope(v,at));}
 assert.throws(()=>validatePendingBatch(refresh([]),s));assert.throws(()=>validatePendingBatch(refresh([{ticketId:'2',ticket:ticket('2')}]),s));
 assert.throws(()=>validatePendingBatch(refresh([{ticketId:'1',code:'SOURCE_UNAVAILABLE',retryable:true,retryAfterSeconds:'60'}]),s));
 assert.equal(validatePendingBatch(refresh([],{budgetExhausted:true}),s).outcomes.length,0);
});


test('local equipment-selection policy is an exact local marker, never arbitrary source authority',()=>{
 const s=parsePendingScope(scope(),at),t=ticket();t.localWorkflowPolicy={policy:'technician_equipment_selection_v1'};assert.deepEqual(validatePendingTicket(t,s),t);
 for(const marker of [null,{}, {policy:'other'},{policy:'technician_equipment_selection_v1',actor:'owner'},'technician_equipment_selection_v1'])assert.throws(()=>validatePendingTicket({...t,localWorkflowPolicy:marker},s));
});

test('source preserves sibling results, retries within one budget, and stops provider-wide cooldowns',async()=>{
 let count=0;const reader=source({ids:['1','2','3'],read:async({ticketId},_s,budget)=>budget(async()=>{count++;if(ticketId==='1')throw new PendingTicketFault('SOURCE_UNAVAILABLE',true);return ticket(ticketId);})});
 const result=await reader.read(leaseId,new AbortController().signal);assert.equal(count,5);assert.equal(result.batch.outcomes.length,3);assert.equal(result.batch.outcomes[0].code,'SOURCE_UNAVAILABLE');assert(result.batch.outcomes[1].ticket);
 count=0;const limited=source({ids:['1','2','3'],read:async({ticketId},_s,budget)=>budget(async()=>{count++;if(ticketId==='2')throw new PendingTicketFault('SOURCE_UNAVAILABLE',true,600);return ticket(ticketId);})});
 const cooled=await limited.read(leaseId,new AbortController().signal);assert.equal(count,2);assert.equal(cooled.batch.outcomes.length,2);assert.equal(cooled.batch.failure.retryAfterSeconds,600);
});

test('all open/detail/appointment calls and retries share the hard twenty-call allowance',async()=>{
 let calls=0;const reader=source({ids:Array.from({length:10},(_,i)=>String(i+1)),open:async(_p,_s,budget)=>budget(async()=>{calls++;}),read:async({ticketId},_s,budget)=>{await budget(async()=>{calls++;});await budget(async()=>{calls++;});return ticket(ticketId);}});
 const result=await reader.read(leaseId,new AbortController().signal);assert.equal(calls,20);assert.equal(result.batch.outcomes.length,9);assert.equal(result.batch.budgetExhausted,true);assert.equal(PENDING_LIMITS.maxTickets,10);assert.equal(PENDING_LIMITS.deadlineMs,30000);
});

function runtime(change={}){const calls=[];const lease={state:'leased',leaseId,portalId:'17',schemaContract:'synthetic-only',activationFloor:floor,createdAfter:'2026-10-10T11:35:00.000Z',createdBefore:'2026-10-10T12:00:00.000Z',leaseUntil:scope().leaseUntil};const fresh=ticket('9');fresh.source.createdAt='2026-10-10T11:59:00.000Z';return {calls,options:{enabled:true,now:()=>at,sleep:async()=>{},readSource:async window=>({contract:BATCH_CONTRACT,portalId:'17',schemaContract:'synthetic-only',window,totalRows:1,partial:false,tickets:[fresh]}),readPending:async()=>refresh(),rpc:async input=>{calls.push(structuredClone(input));if(input.action==='begin')return lease;if(input.action==='record')return {state:'review_needed'};if(input.action==='commit_discovery')return {state:'complete',total:1,watermarkAdvanced:true};if(input.action==='pending_scope')return scope();if(input.action==='record_pending')return {state:'created'};if(input.action==='finish')return {state:'complete',watermarkAdvanced:true};return {state:'backoff'};},...change}};}
test('fresh discovery commits before late-ticket refresh; results remain separate and private',async()=>{
 const {calls,options}=runtime();const r=await runMhelpIntake(options);assert.equal(r.state,'complete');assert.equal(r.reviewNeeded,1);assert.equal(r.pending.created,1);assert.equal(r.watermarkAdvanced,true);assert.deepEqual(calls.map(v=>v.action),['begin','record','commit_discovery','pending_scope','record_pending','finish']);assert(!JSON.stringify(projectRunResult(r)).includes('WO-'));
});
test('failed pending preserves confirmed discovery progress and safe global cooldown',async()=>{
 const {calls,options}=runtime({readPending:async()=>refresh([{ticketId:'1',code:'SOURCE_UNAVAILABLE',retryable:true,retryAfterSeconds:600}],{failure:{code:'SOURCE_UNAVAILABLE',retryable:true,retryAfterSeconds:600}})});const rpc=options.rpc;options.rpc=async input=>input.action==='record_pending'?(calls.push(input),{state:'deferred'}):rpc(input);
 const r=await runMhelpIntake(options);assert.equal(r.state,'failed');assert.equal(r.watermarkAdvanced,true);assert.equal(r.pending.deferred,1);assert.equal(r.pending.state,'failed');assert.equal(r.completionUncertain,undefined);assert.equal(calls.at(-1).retryAfterSeconds,600);assert.equal(projectRunResult(r).watermarkAdvanced,true);
});
test('partial discovery and unconfirmed commit never start pending; lost release keeps truthful advancement',async()=>{
 const partial=runtime();partial.options.readSource=async()=>({partial:true});assert.equal((await runMhelpIntake(partial.options)).watermarkAdvanced,false);assert(!partial.calls.some(v=>v.action==='pending_scope'));
 for(const action of ['commit_discovery','finish']){const f=runtime(),rpc=f.options.rpc;f.options.rpc=async input=>{if(input.action===action)throw new IntakeFault('WRITE_UNAVAILABLE',true);return rpc(input);};const r=await runMhelpIntake(f.options);assert.equal(r.state,'failed');assert.equal(r.watermarkAdvanced,action==='finish');assert.equal(r.completionUncertain,action==='commit_discovery'?true:undefined);if(action==='commit_discovery')assert(!f.calls.some(v=>v.action==='pending_scope'));}
});

test('fetch and stream aborts settle despite ignored reads, hung cancellation, throws and late responses',async()=>{
 for(const cancel of [()=>new Promise(()=>{}),()=>{throw Error('private');},()=>Promise.reject(Error('private'))]){
  let released=0;const body={getReader:()=>({read:()=>new Promise(()=>{}),cancel,releaseLock:()=>{released++;}})};const controller=new AbortController();setTimeout(()=>controller.abort(),10);await assert.rejects(readBoundedJson(body,100,controller.signal),e=>e.code==='DEADLINE');assert.equal(released,1);
 }
 let cancelled=0,complete;const controller=new AbortController();const pending=fetchBounded(async()=>new Promise(resolve=>{complete=resolve;}),'https://synthetic.invalid',{},controller.signal);await new Promise(resolve=>setTimeout(resolve,0));controller.abort();await assert.rejects(pending,e=>e.code==='DEADLINE');complete({body:{cancel:()=>{cancelled++;return new Promise(()=>{});}}});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(cancelled,1);
});

test('HTTP refresh and trusted scope accept only action plus lease, never arbitrary IDs or caller authority',async()=>{
 const denied=createNativeIntakeSourceHandler({authenticate:()=>false,read:async()=>{},refresh:async()=>{throw Error('not called');}});assert.equal((await denied(request({action:'ticket_refresh',leaseId}))).status,403);
 const native=createNativeIntakeSourceHandler({authenticate:()=>true,read:async()=>{},refresh:async()=>({scope:{...scope(),leaseUntil:new Date(Date.now()+180000).toISOString()},batch:refresh()})});
 for(const extra of [{ticketIds:['1']},{portalId:'17'},{url:'https://private.invalid'},{actor:'owner'}])assert.equal((await native(request({action:'ticket_refresh',leaseId,...extra}))).status,400);
 assert.equal((await native(request({action:'ticket_refresh',leaseId}))).status,200);
 let called=0;const verifier=createCameraMhelpReadinessHandler({verifyCron:async()=>true,pendingScope:async()=>{called++;return {...scope(),leaseUntil:new Date(Date.now()+180000).toISOString()};}});
 assert.equal((await verifier(request({action:'intake_pending_scope',leaseId,ticketIds:['1']}))).status,400);assert.equal(called,0);assert.equal((await verifier(request({action:'intake_pending_scope',leaseId}))).status,200);assert.equal(called,1);
 const seen=[];const fetcher=async(url,init)=>{seen.push({url,init});return new Response('{}');};const req=request({});await createExistingCredentialPendingRead({projectUrl:'https://goqrnolcvqnirjmzaeyk.supabase.co',request:req,fetch:fetcher})(leaseId,new AbortController().signal);await createExistingCredentialPendingScopeRead({projectUrl:'https://tughscoxralhofrckvxy.supabase.co',request:req,fetch:fetcher})(leaseId,new AbortController().signal);assert.deepEqual(seen.map(v=>JSON.parse(v.init.body)),[{action:'ticket_refresh',leaseId},{action:'intake_pending_scope',leaseId}]);assert(seen.every(v=>v.init.headers['x-camera-cron-secret']==='synthetic-only'&&!v.init.headers.Authorization));
});

let database;after(async()=>{await database?.close();});
async function sqlFixture(){const db=database??=new PGlite();await db.exec(`drop schema if exists cos_mhelp_intake cascade;drop schema if exists pending_clock cascade;drop role if exists anon;drop role if exists authenticated;drop role if exists service_role;create role anon;create role authenticated;create role service_role;
 create schema cos_mhelp_intake;create table cos_mhelp_intake.portal_config(portal_id text primary key,enabled boolean,activated_at timestamptz,schema_contract text,schema_evidence text);
 insert into cos_mhelp_intake.portal_config values('17',true,'${floor}','synthetic-only','Synthetic verified contract');
 create table cos_mhelp_intake.receipts(portal_id text,ticket_id text,source_created_at timestamptz,state text,first_payload jsonb,candidate_payload jsonb,reason_codes text[] default '{}',review_required boolean default false,assignment_ids uuid[] default '{}',primary key(portal_id,ticket_id));
 create schema pending_clock;create table pending_clock.now(value timestamptz);insert into pending_clock.now values('2026-10-10T12:00:00Z');create function pending_clock.clock_timestamp() returns timestamptz language sql volatile as $$select value from pending_clock.now$$;
 create function cos_mhelp_intake.accept_ticket_v1(t jsonb) returns jsonb language plpgsql as $$begin
 update cos_mhelp_intake.receipts set candidate_payload=t,state=case when t->'request'='null'::jsonb then 'review_needed' else 'created' end where portal_id=t#>>'{source,portalId}' and ticket_id=t#>>'{source,ticketId}';return jsonb_build_object('state',case when t->'request'='null'::jsonb then 'review_needed' else 'created' end);end$$;`);
 const sql=await readFile(new URL('../intake/mhelp-intake-scheduler-proposal.sql',import.meta.url),'utf8');await db.exec(sql.replaceAll('clock_timestamp()','pending_clock.clock_timestamp()'));
 const query=async(fn,args=[])=> (await db.query('select cos_mhelp_intake.'+fn+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') value',args)).rows[0].value;
 const begin=()=>query('begin_intake_v1');const commit=(id,ids=[])=>query('commit_discovery_v1',[id,JSON.stringify(ids),ids.length]);const pending=id=>query('pending_scope_v1',[id]);const observe=(id,outcome)=>query('record_pending_v1',[id,JSON.stringify(outcome)]);const finish=id=>query('finish_intake_v1',[id]);const state=async()=> (await db.query('select * from cos_mhelp_intake.scheduler_state')).rows[0];
 const insert=async(id='1',created=ticket().source.createdAt)=>{const t=ticket(id);t.source.createdAt=created;await db.query("insert into cos_mhelp_intake.receipts(portal_id,ticket_id,source_created_at,state,first_payload,candidate_payload,pending_next_at) values('17',$1,$2,'review_needed',$3,$3,'2026-10-10T11:00:00Z')",[id,created,JSON.stringify(t)]);};
 return {db,query,begin,commit,pending,observe,finish,state,insert};}

test('SQL commit retains one lease, freezes oldest due IDs once, and never admits arbitrary/history/created rows',async()=>{
 const f=await sqlFixture();for(let i=1;i<=12;i++)await f.insert(String(i));await f.insert('99','2026-10-09T00:00:00.000Z');await f.db.exec("update cos_mhelp_intake.receipts set state='created' where ticket_id='12'");const l=await f.begin();await assert.rejects(f.pending(l.leaseId),/DISCOVERY_NOT_COMMITTED/);await assert.rejects(f.finish(l.leaseId),/DISCOVERY_NOT_COMMITTED/);await f.commit(l.leaseId);assert.equal((await f.state()).lease_id,l.leaseId);const s=await f.pending(l.leaseId);assert.equal(s.tickets.length,10);assert(!s.tickets.some(v=>['99','12'].includes(v.ticketId)));await f.insert('13');assert.deepEqual(await f.pending(l.leaseId),s);await assert.rejects(f.observe(l.leaseId,{ticketId:'99',ticket:ticket('99')}),/NOT_ADMITTED/);await f.finish(l.leaseId);assert.equal((await f.state()).lease_id,null);assert.equal((await f.state()).watermark.toISOString(),l.createdBefore);
});
test('SQL late enrichment and lost observation acknowledgement preserve first snapshot without double backoff',async()=>{
 const f=await sqlFixture();await f.insert();const l=await f.begin();await f.commit(l.leaseId);await f.pending(l.leaseId);const outcome={ticketId:'1',ticket:ticket()};const first=await f.observe(l.leaseId,outcome);assert.deepEqual(await f.observe(l.leaseId,outcome),first);let r=(await f.db.query('select * from cos_mhelp_intake.receipts')).rows[0];assert.equal(r.pending_attempt_count,1);assert.equal(r.pending_next_at.toISOString(),'2026-10-10T12:05:00.000Z');const changed=structuredClone(outcome);changed.ticket.request={notes:'Synthetic added appointment'};await assert.rejects(f.observe(l.leaseId,changed),/REPLAY_CHANGED/);await f.finish(l.leaseId);
 await f.db.exec("update pending_clock.now set value='2026-10-10T12:06:00Z'");const next=await f.begin();await f.commit(next.leaseId);await f.pending(next.leaseId);assert.equal((await f.observe(next.leaseId,changed)).state,'created');r=(await f.db.query('select * from cos_mhelp_intake.receipts')).rows[0];assert.equal(r.first_payload.request,null);assert.deepEqual(r.candidate_payload.request,changed.ticket.request);assert.equal(r.pending_next_at,null);await assert.rejects(f.observe(l.leaseId,outcome),/LEASE_LOST/);
});
test('SQL missing discovery receipt blocks advancement; pending failure cannot reverse committed progress',async()=>{
 const f=await sqlFixture();await f.insert();const l=await f.begin(),before=(await f.state()).watermark;await assert.rejects(f.commit(l.leaseId,['missing']),/MISSING_RECEIPTS/);assert.equal((await f.state()).watermark.getTime(),before.getTime());await f.commit(l.leaseId);await f.pending(l.leaseId);await f.observe(l.leaseId,{ticketId:'1',code:'SOURCE_UNAVAILABLE',retryable:true,retryAfterSeconds:7200});await f.query('fail_intake_v1',[l.leaseId,'SOURCE_UNAVAILABLE',true,7200]);const s=await f.state();assert.equal(s.watermark.toISOString(),l.createdBefore);assert.equal(s.retry_after.toISOString(),'2026-10-10T14:00:00.000Z');assert.equal((await f.begin()).state,'backoff');
});
test('SQL expired/stale leases cannot observe or release newer work and all helpers stay private',async()=>{
 const f=await sqlFixture();await f.insert();const l=await f.begin();await f.commit(l.leaseId);await f.pending(l.leaseId);await f.db.exec("update pending_clock.now set value='2026-10-10T12:06:00Z'");const next=await f.begin();await assert.rejects(f.observe(l.leaseId,{ticketId:'1',ticket:ticket()}),/LEASE_LOST/);await f.finish(l.leaseId);assert.equal((await f.state()).lease_id,next.leaseId);for(const role of ['anon','authenticated','service_role']){const q=await f.db.query("select has_function_privilege($1,'cos_mhelp_intake.pending_scope_v1(uuid)','execute') a,has_function_privilege($1,'cos_mhelp_intake.record_pending_v1(uuid,jsonb)','execute') b,has_table_privilege($1,'cos_mhelp_intake.receipts','select') c",[role]);assert.deepEqual(q.rows[0],{a:false,b:false,c:false});}
});


test('SQL per-ticket backoff is 5/10/20/40/60 minutes, saturates, and leaves unattempted IDs due',async()=>{
 const f=await sqlFixture();await f.insert('1');await f.insert('2');let elapsed=0;
 for(let attempt=0;attempt<18;attempt++){
  const time=at+elapsed;await f.db.query('update pending_clock.now set value=$1',[new Date(time).toISOString()]);
  const l=await f.begin();await f.commit(l.leaseId);const s=await f.pending(l.leaseId);assert(s.tickets.some(t=>t.ticketId==='1'));
  const outcome={ticketId:'1',code:'SOURCE_UNAVAILABLE',retryable:true};await f.observe(l.leaseId,outcome);const rows=(await f.db.query('select * from cos_mhelp_intake.receipts order by ticket_id')).rows;
  const delay=Math.min(60,5*2**Math.min(attempt,4))*60000;assert.equal(rows[0].pending_next_at.getTime(),time+delay);assert.equal(rows[0].pending_attempt_count,Math.min(16,attempt+1));assert.equal(rows[1].pending_attempt_count,0);assert.equal(rows[1].pending_next_at.toISOString(),'2026-10-10T11:00:00.000Z');
  await f.finish(l.leaseId);elapsed+=delay;
 }
});


test('same-key source creation changes park the existing receipt without retaining altered source or creating work',async()=>{
 const t=ticket();t.source.createdAt='2026-10-09T00:00:00.000Z';const reader=source({read:async(_i,_s,budget)=>budget(async()=>t)});const result=await reader.read(leaseId,new AbortController().signal);assert.deepEqual(result.batch.outcomes,[{ticketId:'1',identityChanged:true}]);
 const f=await sqlFixture();await f.insert();const l=await f.begin();await f.commit(l.leaseId);await f.pending(l.leaseId);const before=(await f.db.query('select * from cos_mhelp_intake.receipts')).rows[0];await f.observe(l.leaseId,result.batch.outcomes[0]);const after=(await f.db.query('select * from cos_mhelp_intake.receipts')).rows[0];assert.equal(after.state,'review_needed');assert.equal(after.pending_next_at,null);assert.deepEqual(after.first_payload,before.first_payload);assert.deepEqual(after.candidate_payload,before.candidate_payload);assert.deepEqual(after.reason_codes,['source_identity_changed_review_required']);
 const bad=source({read:async()=>({...t,source:{...t.source,ticketId:'99'}})});const invalid=await bad.read(leaseId,new AbortController().signal);assert.equal(invalid.batch.failure.code,'SOURCE_INVALID');assert.equal(invalid.batch.outcomes[0].identityChanged,undefined);
});


test('pending status is opt-in, aggregate-only, and counts waiting separately from parked/created receipts',async()=>{
 const f=await sqlFixture();await f.insert('1');await f.insert('2');await f.insert('3');await f.db.exec("update cos_mhelp_intake.receipts set pending_next_at=null where ticket_id='3';update cos_mhelp_intake.receipts set pending_next_at='2026-10-10T14:00:00Z' where ticket_id='2'");
 const initial=await f.query('read_pending_status_v1');assert.deepEqual(initial,{contract:'cos-mhelp-pending-status-v1',waitingCount:2,dueCount:1,oldestWaitingCreatedAt:ticket().source.createdAt,lastRefreshAt:null,lastRefreshState:null,lastRefreshCode:null});
 const l=await f.begin();await f.commit(l.leaseId);await f.pending(l.leaseId);await f.observe(l.leaseId,{ticketId:'1',code:'SOURCE_UNAVAILABLE',retryable:true});const result=await f.query('read_pending_status_v1');assert.equal(result.dueCount,0);assert.equal(result.waitingCount,2);assert.equal(result.lastRefreshAt,'2026-10-10T12:00:00.000Z');assert.equal(result.lastRefreshState,'deferred');assert.equal(result.lastRefreshCode,'SOURCE_UNAVAILABLE');assert(!JSON.stringify(result).includes('ticketId'));assert(!JSON.stringify(result).includes('candidate'));
});

test('both deployed intake invocation paths wire pending reads without adding credentials',async()=>{
 const source=await readFile(new URL('../../supabase/functions/camera-mhelp-ticket-intake/serve.ts',import.meta.url),'utf8');const background=await readFile(new URL('../intake/mhelpIntakeBackground.ts',import.meta.url),'utf8');for(const code of [source,background])assert.match(code,/readPending:createExistingCredentialPendingRead/);
});


test('private pending writer rejects malformed failures and never upgrades permanent faults to retryable',async()=>{
 const f=await sqlFixture();await f.insert();const l=await f.begin();await f.commit(l.leaseId);await f.pending(l.leaseId);
 for(const extra of [{code:'SOURCE_INVALID',retryable:true},{code:'private raw error',retryable:false},{code:'SOURCE_UNAVAILABLE',retryable:true,retryAfterSeconds:'60'},{code:'SOURCE_UNAVAILABLE',retryable:true,retryAfterSeconds:86401},{identityChanged:false},{identityChanged:true,body:'private'}])await assert.rejects(f.observe(l.leaseId,{ticketId:'1',...extra}),/INVALID_PENDING/);
 const row=(await f.db.query('select * from cos_mhelp_intake.receipts')).rows[0];assert.equal(row.pending_attempt_count,0);assert.equal(row.pending_last_at,null);
});

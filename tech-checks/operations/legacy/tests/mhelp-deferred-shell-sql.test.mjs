/** Isolated PGlite assertions only. Every identity and ticket is synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture,shellInput,shellPayload,options,accept,rows,receipt,owner,it,service,sql} from '../mhelp-intake-fixture.mjs';
import {prepareMhelpLegacyIntake} from '../mhelpIntakeAdapter.ts';
import {mhelpIntakeDeploymentSql} from '../deploymentAssembly.mjs';
const scalar=async(db,query,params=[])=>(await db.query(query,params)).rows[0];
const assigned=identity=>({state:'assigned',identities:[identity],evidence:'Synthetic explicit department technician'});
const unassigned=()=>({state:'unassigned',identities:[],evidence:'Synthetic explicit empty department'});
const shellOptions=()=>{const {ticketLead,...rest}=options();return rest;};

test('four shell routes retain exact scheduled technician, truthful service attribution and no automatic progress',async()=>{
  for(const type of ['service','delivery','swap','pickup']){
    const db=await fixture({type}),body=shellPayload(type),result=await accept(db,body);
    assert.equal(result.state,'created',JSON.stringify(result));assert.equal(result.notifications,false);
    const jobs=await rows(db),byId=Object.fromEntries(jobs.map(r=>[r.id,r]));
    assert.deepEqual(result.assignmentIds.map(id=>byId[id].assigned_role),type==='service'?['service']:type==='pickup'?['service','it']:['it','service']);
    for(const job of jobs){
      assert.equal(job.assignee_user_id,job.assigned_role==='service'?service:null);
      assert.equal(job.assignment_scope,job.assigned_role==='service'?'technician':'department');
      assert.equal(job.status,'assigned');assert.equal(job.site,null);assert.equal(job.requested_unit_count,null);
      assert.deepEqual(job.equipment_manifest,[]);assert.deepEqual(job.return_equipment_manifest,[]);
      for(const field of ['solar_panel_qty','battery_replacement_qty','camera_replacement_qty','sim_replacement_qty','micro_sd_qty'])assert.equal(job[field],0);
      for(const field of ['job_lead_user_id','job_lead_name','job_lead_role','started_at','claimed_at','completed_at','cancelled_at','prep_ticket_id'])assert.equal(job[field],null);
      assert.equal(job.job_description,body.request.job_description);assert.equal(job.notes,body.request.notes);
      assert.equal(job.scheduled_for.toISOString(),'2026-10-12T00:00:00.000Z');assert.equal(job.scheduled_time,null);
      assert.equal(job.requires_it_handoff,job.assigned_role==='service'&&['delivery','swap'].includes(type));
      assert.equal(job.assigned_by,null);assert.equal(job.assigned_by_name,'mHelpDesk automatic intake');assert.equal(job.created_from,'mhelpdesk_service_intake');
    }
    assert.equal((await scalar(db,'select count(*)::int n from public.app_notifications')).n,0);
    assert.equal((await scalar(db,'select count(*)::int n from public.workflow_checkpoints')).n,jobs.length);
    assert((await db.query('select changed_by from public.workflow_checkpoints')).rows.every(r=>r.changed_by===null));
    const saved=(await receipt(db))[0];assert.deepEqual(saved.first_payload,body);assert.deepEqual(saved.candidate_payload,body);
    assert.equal(saved.actor_kind,'service_role');assert.equal(saved.received_by,null);
  }
});

test('notes-only and supplied optional site/lead preserve actual source text and exact reviewed selection',async()=>{
  const db=await fixture({type:'delivery'}),input=shellInput();input.description.value='';
  input.site={reviewed:true,value:'Synthetic reviewed site',evidence:'Synthetic genuine source site'};
  const body=prepareMhelpLegacyIntake(input,options()).payload;
  assert.equal((await accept(db,body)).state,'created');
  for(const job of await rows(db)){
    assert.equal(job.job_description,'');assert.equal(job.notes,input.notes);assert.equal(job.site,input.site.value);
    assert.equal(job.job_lead_user_id,it);assert.equal(job.job_lead_role,'it');assert.equal(job.job_lead_name,'Synthetic IT');
  }
});

test('SQL derives missing counterpart queues locally without adding vendor department facts',async()=>{
  for(const department of ['it','service']){
    const db=await fixture({type:'delivery'}),body=shellPayload('delivery',department);
    assert.equal((await accept(db,body)).state,'created');
    assert.deepEqual((await receipt(db))[0].candidate_payload.departmentAssignments,[]);
    for(const job of await rows(db))assert.equal(job.assignee_user_id,job.assigned_role===department?(department==='it'?it:service):null);
  }
  for(const fact of [unassigned(),assigned('it.source')]){
    const db=await fixture({type:'delivery'}),input=shellInput();input.departmentAssignments=[{department:'it',...fact}];
    const body=prepareMhelpLegacyIntake(input,shellOptions()).payload;
    assert.equal((await accept(db,body)).state,'created');
    assert.deepEqual((await receipt(db))[0].candidate_payload.departmentAssignments,input.departmentAssignments);
    assert.equal((await rows(db)).find(r=>r.assigned_role==='it').assignee_user_id,fact.state==='assigned'?it:null);
  }
});

test('exact fixed local policy and bounded normalized envelope reject untrusted additions before receipt retention',async()=>{
  const db=await fixture({type:'delivery'});
  for(const policy of [null,[],true,'technician_equipment_selection_v1',{}, {policy:'other'},{policy:'technician_equipment_selection_v1',approved:true}]){
    const body=shellPayload();body.localWorkflowPolicy=policy;await assert.rejects(accept(db,body),/MHELP_INTAKE_INVALID_SOURCE/);
  }
  for(const mutate of [p=>{p.targetProvenance=[{role:'it',kind:'local_workflow_queue'}];},p=>{p.equipment={};},p=>{p.ticketLead={policy:'reviewed_local_unassigned_v1'};},p=>{p.request.notes={raw:'Synthetic private body'};},p=>{p.sourceEvidence.schedule='\n';}]){
    const body=shellPayload();mutate(body);await assert.rejects(accept(db,body),/MHELP_INTAKE_INVALID_SOURCE/);
  }
  assert.equal((await receipt(db)).length,0);assert.equal((await rows(db)).length,0);
});

test('deferred zero placeholders never bypass unresolved scope, instruction, route or schedule validation',async()=>{
  const mutations=[p=>{p.sourceEvidence.complete=true;},p=>{p.sourceEvidence.equipment='Synthetic unsupported scope claim';},
    p=>{p.sourceEvidence.parts='Synthetic unsupported parts claim';},p=>{p.request.equipment_manifest=[{category:'device',label:'Sniper',qty:1}];},
    p=>{p.request.requested_unit_count=0;},p=>{delete p.request.requested_unit_count;},p=>{p.request.micro_sd_qty=1;},p=>{p.request.micro_sd_qty='0';},
    p=>{delete p.request.site;},p=>{p.request.site='Synthetic unreviewed site';},p=>{p.request.job_description=' \n ';p.request.notes='\t ';},
    p=>{p.request.site='Synthetic\nSite';p.sourceEvidence.site='Synthetic actual site evidence';},p=>{p.request.job_description='\u00a0\u2000';p.request.notes='\uFEFF';},p=>{p.request.job_description+='\u0007';},p=>{delete p.sourceEvidence.description;},p=>{delete p.sourceEvidence.schedule;},
    p=>{delete p.request.scheduled_for;},p=>{p.request.scheduled_for='2026-02-30';},p=>{p.request.scheduled_for='1899-12-31';},
    p=>{delete p.request.scheduled_time;},p=>{p.request.scheduled_time='25:00';},p=>{p.request.targets.reverse();},
    p=>{p.request.targets[1].requires_it_handoff=false;},p=>{p.request.targets.pop();}];
  const db=await fixture({type:'delivery'});
  for(let index=0;index<mutations.length;index++){
    const body=shellPayload();body.source.ticketId='scope-'+index;body.source.ticketNumber=body.request.ticket_no='SYN-SCOPE-'+index;mutations[index](body);
    const result=await accept(db,body);assert.equal(result.state,'review_needed','mutation '+index);assert(result.reasonCodes.includes('source_scope_or_route_invalid'),'mutation '+index);
  }
  assert.equal((await rows(db)).length,0);assert.equal((await receipt(db)).length,mutations.length);
});

test('scheduled identity and conflicting genuine department facts cannot be replaced by local queues',async()=>{
  const mutations=[p=>{delete p.source.assignment;},p=>{p.source.assignment=unassigned();},p=>{p.source.assignment.state='unknown';},
    p=>{p.source.assignment.identities=['unknown.source'];},p=>{p.source.assignment.identities.push('it.source');},
    p=>{delete p.request.targets[1].assignee_user_id;},p=>{p.request.targets[1].assignee_user_id=it;},p=>{p.request.targets[0].assignee_user_id=it;},
    p=>{p.departmentAssignments=[{department:'it',state:'unknown',identities:[],evidence:'Synthetic unknown fact'}];},
    p=>{p.departmentAssignments=[{department:'service',...unassigned()}];},p=>{p.departmentAssignments=[{department:'service',...assigned('it.source')}];},
    p=>{p.departmentAssignments=[{department:'it',...unassigned()},{department:'it',...unassigned()}];}];
  const db=await fixture({type:'delivery'});
  for(let index=0;index<mutations.length;index++){
    const body=shellPayload();body.source.ticketId='identity-'+index;body.source.ticketNumber=body.request.ticket_no='SYN-ID-'+index;mutations[index](body);
    const result=await accept(db,body);assert.equal(result.state,'review_needed','mutation '+index);assert(result.reasonCodes.includes('assignment_identity_unverified'),'mutation '+index);
  }
  assert.equal((await rows(db)).length,0);
});

test('shell write revalidates current profile, crosswalk, reviewer, exact type and source status',async()=>{
  const mutations=[`update public.profiles set active=false where user_id='${service}'`,
    `update public.profiles set archived_at=now() where user_id='${service}'`, `update public.profiles set role='it' where user_id='${service}'`,
    "update cos_mhelp_intake.identity_crosswalk set enabled=false where source_identity='service.source'",
    `update cos_mhelp_intake.identity_crosswalk set reviewed_by='${it}' where source_identity='service.source'`,
    "update cos_mhelp_intake.type_mappings set enabled=false", "update cos_mhelp_intake.type_mappings set work_type='pickup'",
    "update cos_mhelp_intake.source_status_policies set classification='terminal'", "update cos_mhelp_intake.source_status_policies set enabled=false",
    `update public.profiles set active=false where user_id='${owner}'`];
  for(const mutation of mutations){const db=await fixture({type:'delivery'});await db.exec(mutation);assert.equal((await accept(db,shellPayload())).state,'review_needed',mutation);assert.equal((await rows(db)).length,0);}
  const db=await fixture({type:'service'}),body=shellPayload('service');body.source.assignment=assigned('it.source');body.request.targets[0].assignee_user_id=it;
  assert.equal((await accept(db,body)).state,'review_needed');assert.equal((await rows(db)).length,0);
});

test('late appointment candidate enriches a null first projection without rewriting first observation',async()=>{
  const db=await fixture({type:'delivery'}),complete=shellPayload(),first={contract:complete.contract,schemaContract:complete.schemaContract,
    source:{portalId:'17',ticketId:'42',ticketNumber:'000042',createdAt:complete.source.createdAt},request:null};
  assert.equal((await accept(db,first)).state,'review_needed');
  const intermediate=structuredClone(complete);intermediate.request.scheduled_for=null;
  assert.equal((await accept(db,intermediate)).state,'review_needed');
  let saved=(await receipt(db))[0];assert.deepEqual(saved.first_payload,first);assert.deepEqual(saved.candidate_payload,intermediate);
  const created=await accept(db,complete);assert.equal(created.state,'created');
  saved=(await receipt(db))[0];assert.deepEqual(saved.first_payload,first);assert.deepEqual(saved.candidate_payload,complete);assert.equal(saved.review_required,false);
  assert.deepEqual((await accept(db,complete)).assignmentIds,created.assignmentIds);assert.equal((await rows(db)).length,2);
  const changed=await accept(db,first);assert.equal(changed.state,'review_needed');assert.deepEqual(changed.assignmentIds,created.assignmentIds);
  assert.deepEqual(changed.reasonCodes,['source_changed_review_required']);assert.deepEqual((await receipt(db))[0].candidate_payload,complete);
});

test('created candidate freezes despite technician edits, source changes, profile edits and missing assignment rows',async()=>{
  const db=await fixture({type:'delivery'}),body=shellPayload(),created=await accept(db,body);
  await db.exec(`update public.job_assignments set notes='Synthetic technician edits',job_description='Synthetic updated work',site='Synthetic actual site',requested_unit_count=3,status='started';update public.profiles set active=false where user_id='${service}';`);
  const jobs=await rows(db),checkpoints=(await scalar(db,'select count(*)::int n from public.workflow_checkpoints')).n;
  assert.equal((await accept(db,body)).state,'existing');assert.deepEqual(await rows(db),jobs);
  const changed=structuredClone(body);changed.request.notes='Synthetic later source text';
  const result=await accept(db,changed);assert.equal(result.state,'review_needed');assert.deepEqual(result.assignmentIds,created.assignmentIds);assert.deepEqual(await rows(db),jobs);
  assert.equal((await accept(db,body)).reviewRequired,true);assert.deepEqual((await receipt(db))[0].candidate_payload,body);
  assert.equal((await scalar(db,'select count(*)::int n from public.workflow_checkpoints')).n,checkpoints);
  await db.exec('delete from public.job_assignments');assert.equal((await accept(db,body)).state,'existing');assert.equal((await rows(db)).length,0);
});

test('createdAt and printed-reference mismatch permanently latch uncreated holds without replacing either snapshot',async()=>{
  for(const mutate of [p=>{p.source.createdAt='2026-10-10T00:00:02Z';},p=>{p.source.ticketNumber=p.request.ticket_no='SYN-CHANGED';}]){
    const db=await fixture({type:'delivery'}),original=shellPayload();original.request.scheduled_for=null;
    assert.equal((await accept(db,original)).state,'review_needed');const saved=(await receipt(db))[0];
    const changed=shellPayload();mutate(changed);assert.deepEqual((await accept(db,changed)).reasonCodes,['source_identity_changed_review_required']);
    assert.deepEqual((await accept(db,shellPayload())).reasonCodes,['source_identity_changed_review_required']);
    const after=(await receipt(db))[0];assert.deepEqual(after.first_payload,saved.first_payload);assert.deepEqual(after.candidate_payload,saved.candidate_payload);assert.equal((await rows(db)).length,0);
  }
});

test('another source key cannot claim even an uncreated printed reference',async()=>{
  const db=await fixture({type:'delivery'}),body=shellPayload();body.request.scheduled_for=null;await accept(db,body);
  const next=shellPayload();next.source.ticketId='another-key';assert((await accept(db,next)).reasonCodes.includes('existing_ticket_requires_reconciliation'));
  assert.equal((await rows(db)).length,0);assert.equal((await receipt(db)).length,2);
});

test('receipt guard rejects first-observation, identity, created-candidate and assignment-ID rewrites',async()=>{
  const db=await fixture({type:'delivery'});await accept(db,shellPayload());
  for(const edit of ["first_payload='{}'::jsonb","candidate_payload='{}'::jsonb","ticket_id='changed'","portal_id='18'","ticket_number='changed'","source_created_at=now()","assignment_ids=array[gen_random_uuid()]","created_at=now()-interval '1 day'","state='review_needed',assignment_ids='{}',created_at=null"])
    await assert.rejects(db.exec('update cos_mhelp_intake.receipts set '+edit),/MHELP_INTAKE_RECEIPT_IMMUTABLE/);
  assert.deepEqual((await receipt(db))[0].candidate_payload,shellPayload());
});

test('no-lead queues use original assignment views without claiming, and original return/handoff gates remain intact',async()=>{
  for(const type of ['delivery','pickup']){
    const db=await fixture({type}),created=await accept(db,shellPayload(type)),jobs=await rows(db);
    await db.query("select set_config('test.real_user',$1,false)",[it]);
    assert.deepEqual((await scalar(db,'select public.my_managed_tickets_v1() value')).value,[]);
    const target=jobs.find(r=>r.assigned_role===(type==='pickup'?'it':'service'));
    await db.query("select set_config('test.real_user',$1,false)",[type==='pickup'?it:service]);
    await assert.rejects(db.query('select public.claim_my_department_assignment($1::uuid)',[target.id]),type==='pickup'?/return|intake/i:/handoff|ready|assigned/i);
    assert((await rows(db)).every(r=>r.status==='assigned'));assert.equal(created.assignmentIds.length,2);
  }
});

test('fresh assembly omits retired local-lead machinery and keeps receipt ACL/RLS and service attribution guards',async()=>{
  const assembly=await mhelpIntakeDeploymentSql(),base=await sql();
  assert.doesNotMatch(assembly,/ticket_lead_policies|ticket_lead_resolution|reviewed_local_unassigned_v1/);
  assert.doesNotMatch(base,/\b(update|delete from)\s+public\.job_assignments/i);
  assert.doesNotMatch(base,/set_config|enqueue_app_notification|net\.http|pg_net|claim_my_department_assignment/);
  const db=await fixture({type:'delivery'});
  assert.equal((await scalar(db,"select to_regclass('cos_mhelp_intake.ticket_lead_policies') is null absent")).absent,true);
  for(const role of ['anon','authenticated','service_role'])assert.deepEqual(await scalar(db,"select has_schema_privilege($1,'cos_mhelp_intake','USAGE') s,has_table_privilege($1,'cos_mhelp_intake.receipts','select,insert,update,delete') t,has_function_privilege($1,'cos_mhelp_intake.guard_receipt_snapshots_v1()','execute') g",[role]),{s:false,t:false,g:false});
  assert.equal((await scalar(db,"select relrowsecurity r from pg_class where oid='cos_mhelp_intake.receipts'::regclass")).r,true);
  await assert.rejects(db.exec("insert into public.job_assignments(ticket_no,assigned_role,assigned_by_name)values('SYN-BAD','it','Nobody')"),/job_assignments_mhelp_actor_required/);

});

async function installShellWorkflowContracts(db){
  // Only compatibility dependencies are synthetic; function bodies are exact
  // read-only captures, stored separately from protected production workflows.
  await db.exec(`alter table public.prep_tickets add column equipment_manifest jsonb,add column requested_unit_count integer;
    create function public.actor_display_name() returns text language sql stable as $$select coalesce((select full_name from public.profiles where user_id=auth.uid()),'System')$$;`);
  await db.exec(await readFile(new URL('./contracts/shell-workflow-contract.sql',import.meta.url),'utf8'));
}

test('real Owner equipment correction and cancellation preserve fixed service attribution and frozen replay',async()=>{
  const db=await fixture({type:'pickup'}),body=shellPayload('pickup'),created=await accept(db,body);await installShellWorkflowContracts(db);
  await db.query("select set_config('test.real_user',$1,false)",[owner]);
  const manifest=[{category:'device',label:'Sniper',qty:2}];
  const update=(await scalar(db,'select public.owner_update_ticket_equipment_v1($1,$2::jsonb) value',['000042',JSON.stringify(manifest)])).value;
  assert.equal(update.assignment_rows_updated,2);assert.equal(update.requested_unit_count,2);
  for(const job of await rows(db)){assert.deepEqual(job.equipment_manifest,manifest);assert.equal(job.requested_unit_count,2);assert.equal(job.status,'assigned');}
  await db.query('select public.owner_cancel_job_assignment($1::uuid)',[created.assignmentIds[0]]);
  const jobs=await rows(db);assert.equal(jobs.find(r=>r.id===created.assignmentIds[0]).status,'cancelled');
  for(const job of jobs){assert.equal(job.assigned_by,null);assert.equal(job.assigned_by_name,'mHelpDesk automatic intake');assert.equal(job.created_from,'mhelpdesk_service_intake');}
  await db.query("select set_config('test.real_user','',false)");
  assert.equal((await accept(db,body)).state,'existing');assert.deepEqual(await rows(db),jobs);assert.deepEqual((await receipt(db))[0].candidate_payload,body);
});

test('exact Pickup return trigger keeps unknown quantity active until ordinary authoritative scope correction',async()=>{
  const db=await fixture({type:'pickup'}),body=shellPayload('pickup');await accept(db,body);await installShellWorkflowContracts(db);
  await db.exec(`create trigger synthetic_return_completion after insert or update on public.unit_returns for each row execute function public.sync_pickup_assignment_completion_from_return_v1();`);
  await db.query("insert into public.unit_returns(ticket_no,status)values('000042','pending_mhelp_inventory')");
  assert((await rows(db)).every(r=>r.status==='assigned'&&r.requested_unit_count===null&&r.completed_at===null));
  assert.equal((await scalar(db,'select count(*)::int n from public.reports')).n,0);
  await db.query("select set_config('test.real_user',$1,false)",[owner]);
  await db.query('select public.owner_update_ticket_equipment_v1($1,$2::jsonb)',['000042',JSON.stringify([{category:'device',label:'Sniper',qty:2}])]);
  await db.query("insert into public.unit_returns(ticket_no,status)values('000042','waiting_it')");
  let jobs=await rows(db);assert.equal(jobs.find(r=>r.assigned_role==='service').status,'completed');assert.equal(jobs.find(r=>r.assigned_role==='it').status,'assigned');
  await db.query("update public.unit_returns set status='pending_mhelp_inventory' where status='waiting_it'");
  jobs=await rows(db);assert(jobs.every(r=>r.status==='completed'&&r.requested_unit_count===2));
  await db.query("select set_config('test.real_user','',false)");
  assert.equal((await accept(db,body)).state,'existing');assert.deepEqual(await rows(db),jobs);assert.equal((await scalar(db,'select count(*)::int n from public.app_notifications')).n,0);
});

test('receipt snapshot guard permits genuine uncreated candidate/review updates and later retry metadata',async()=>{
  const db=await fixture({type:'delivery'}),first=shellPayload();first.request.scheduled_for=null;await accept(db,first);
  // Representative scheduler metadata column is synthetic here; the scheduler
  // proposal owns its actual retry schema and tests.
  await db.exec('alter table cos_mhelp_intake.receipts add column synthetic_retry_count integer default 0');
  const candidate=shellPayload();candidate.request.scheduled_for=null;candidate.request.notes='Synthetic later original note';
  await db.query("update cos_mhelp_intake.receipts set candidate_payload=$1::jsonb,review_required=true,reason_codes=array['source_scope_or_route_invalid'],synthetic_retry_count=1",[JSON.stringify(candidate)]);
  let saved=(await receipt(db))[0];assert.deepEqual(saved.first_payload,first);assert.deepEqual(saved.candidate_payload,candidate);assert.equal(saved.synthetic_retry_count,1);
  const complete=shellPayload();assert.equal((await accept(db,complete)).state,'created');
  await db.exec("update cos_mhelp_intake.receipts set review_required=true,reason_codes=array['source_changed_review_required'],synthetic_retry_count=2");
  saved=(await receipt(db))[0];assert.deepEqual(saved.first_payload,first);assert.deepEqual(saved.candidate_payload,complete);assert.equal(saved.synthetic_retry_count,2);
});

test('second-target failure rolls back late candidate replacement, shell assignments and audit checkpoints together',async()=>{
  const db=await fixture({type:'delivery'}),first=shellPayload();first.request.scheduled_for=null;await accept(db,first);
  const before=(await receipt(db))[0];
  await db.exec(`create function public.synthetic_shell_failure() returns trigger language plpgsql as $$begin
    if new.assigned_role='service' then raise exception 'Synthetic shell second-target failure';end if;return new;end$$;
    create trigger synthetic_shell_failure before insert on public.job_assignments for each row execute function public.synthetic_shell_failure();`);
  await assert.rejects(accept(db,shellPayload()),/Synthetic shell second-target failure/);
  assert.deepEqual((await receipt(db))[0],before);assert.equal((await rows(db)).length,0);assert.equal((await scalar(db,'select count(*)::int n from public.workflow_checkpoints')).n,0);
});

test('uncreated receipt cannot change candidate identity but can retain genuinely changed operational facts',async()=>{
  const db=await fixture({type:'delivery'}),first=shellPayload();first.request.scheduled_for=null;await accept(db,first);
  for(const field of ['portalId','ticketId','ticketNumber','createdAt']){
    const changed=structuredClone(first);changed.source[field]='changed';
    await assert.rejects(db.query('update cos_mhelp_intake.receipts set candidate_payload=$1::jsonb',[JSON.stringify(changed)]),/MHELP_INTAKE_CANDIDATE_IDENTITY_IMMUTABLE/);
  }
  const changed=structuredClone(first);changed.request.notes='Synthetic later instruction';
  assert.equal((await accept(db,changed)).state,'review_needed');assert.deepEqual((await receipt(db))[0].first_payload,first);assert.deepEqual((await receipt(db))[0].candidate_payload,changed);
});

test('null primary source projection resolves the exact private scheduled technician for every shell route',async()=>{
  for(const type of ['service','delivery','swap','pickup'])for(const department of ['service','it']){
    if(type==='service'&&department==='it')continue; // IT is not a Service-only route.
    const db=await fixture({type}),body=shellPayload(type,department);
    const primary=body.request.targets.find(target=>target.role===department);primary.assignee_user_id=null;
    const created=await accept(db,body);assert.equal(created.state,'created',JSON.stringify({type,department,created}));
    const jobs=await rows(db),scheduledUser=department==='it'?it:service;
    for(const job of jobs){
      assert.equal(job.assignee_user_id,job.assigned_role===department?scheduledUser:null);
      assert.equal(job.assignment_scope,job.assigned_role===department?'technician':'department');assert.equal(job.status,'assigned');
    }
    const saved=(await receipt(db))[0];assert.deepEqual(saved.first_payload,body);assert.deepEqual(saved.candidate_payload,body);
    assert.equal(saved.first_payload.source.assignment.state,'assigned');
    assert.deepEqual(saved.first_payload.source.assignment.identities,[department+'.source']);
    assert.deepEqual(saved.first_payload.departmentAssignments,[]);
    assert.equal(saved.candidate_payload.request.targets.find(target=>target.role===department).assignee_user_id,null);
    assert.deepEqual((await accept(db,body)).assignmentIds,created.assignmentIds);assert.equal((await scalar(db,'select count(*)::int n from public.app_notifications')).n,0);
  }
});

test('null explicit secondary assignment also resolves its own exact crosswalk instead of becoming a queue',async()=>{
  const db=await fixture({type:'delivery'}),input=shellInput();input.departmentAssignments=[{department:'it',...assigned('it.source')}];
  const body=prepareMhelpLegacyIntake(input,shellOptions()).payload;
  for(const target of body.request.targets)target.assignee_user_id=null;
  assert.equal((await accept(db,body)).state,'created');
  for(const job of await rows(db)){assert.equal(job.assignee_user_id,job.assigned_role==='it'?it:service);assert.equal(job.assignment_scope,'technician');}
  assert.deepEqual((await receipt(db))[0].candidate_payload,body);
});

test('null primary projection still holds absent, disabled or inactive exact private identity mappings',async()=>{
  for(const change of ["delete from cos_mhelp_intake.identity_crosswalk where source_identity='service.source'",
    "update cos_mhelp_intake.identity_crosswalk set enabled=false where source_identity='service.source'",
    `update public.profiles set active=false where user_id='${service}'`,
    `update public.profiles set role='it' where user_id='${service}'`]){
    const db=await fixture({type:'delivery'}),body=shellPayload();body.request.targets[1].assignee_user_id=null;await db.exec(change);
    const result=await accept(db,body);assert.equal(result.state,'review_needed');assert(result.reasonCodes.includes('assignment_identity_unverified'));
    assert.equal((await rows(db)).length,0);assert.deepEqual((await receipt(db))[0].candidate_payload,body);
  }
});

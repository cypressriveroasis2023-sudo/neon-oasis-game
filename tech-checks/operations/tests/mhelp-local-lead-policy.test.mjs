import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,input,options,payload,accept,rows,receipt,owner,it,service} from '../legacy/mhelp-intake-fixture.mjs';
import {prepareMhelpLegacyIntake,REVIEWED_LOCAL_LEAD_POLICY} from '../legacy/mhelpIntakeAdapter.ts';
import {mhelpLocalLeadUpgradeSql,mhelpIntakeDeploymentSql} from '../legacy/deploymentAssembly.mjs';
import {validateOperationalTicket} from '../intake/mhelpIntakeRuntime.ts';
import {projectIntakeReview} from '../intake/mhelpIntakeReview.ts';
import {checkedIntakeReview} from '../src/mhelpIntakeReviewModel.ts';
const marker=()=>({policy:REVIEWED_LOCAL_LEAD_POLICY});
const localPayload=(type='service')=>({...payload(type),ticketLead:marker()});
const scope={portalId:'17',schemaContract:'synthetic-verified-v1',activationFloor:'2026-10-10T00:00:00Z',createdAfter:'2026-10-10T00:00:00Z',createdBefore:'2026-10-10T00:15:00Z'};
const selectPolicy=async(db,user=it)=>db.query(`insert into cos_mhelp_intake.ticket_lead_policies(portal_id,legacy_user_id,enabled,evidence,reviewed_by,reviewed_at)
  values('17',$1,true,'Synthetic explicit local ownership decision; no vendor identity asserted',$2,'2026-10-10T00:00:00Z')`,[user,owner]);
const scalar=async(db,query,params=[])=>(await db.query(query,params)).rows[0];

test('pure preparation emits only the fixed marker without crosswalk, vendor identity or local UUID',()=>{
  const source=input();source.identityCrosswalk=[];
  const result=prepareMhelpLegacyIntake(source,{...options(),ticketLead:marker()});
  assert.equal(result.state,'ready');assert.equal(result.executionEnabled,false);assert.deepEqual(result.payload.ticketLead,marker());
  assert(!JSON.stringify(result.payload).includes(it));assert(!JSON.stringify(result.payload).includes('it.source'));
  assert.deepEqual(validateOperationalTicket(result.payload,scope),result.payload);
  for(const lead of [{policy:'unknown'},{...marker(),sourceIdentity:'it.source'},{...marker(),evidence:'Fake vendor lead'},{...marker(),legacyUserId:it},{policy:null}]){
    assert.equal(prepareMhelpLegacyIntake(source,{...options(),ticketLead:lead}).state,'review_needed');
    assert.throws(()=>validateOperationalTicket({...result.payload,ticketLead:lead},scope));
  }
  source.source.assignment={state:'assigned',identities:['service.source'],evidence:'Synthetic assigned source'};
  assert(prepareMhelpLegacyIntake(source,{...options(),ticketLead:marker()}).reasonCodes.includes('ticket_lead_policy_conflict'));
});

test('missing, disabled or wrong-portal local policy holds without inferring a person or provenance',async()=>{
  for(const variant of ['missing','disabled','wrong_portal']){
    const db=await fixture();
    if(variant!=='missing'){
      await selectPolicy(db);
      if(variant==='disabled')await db.exec('update cos_mhelp_intake.ticket_lead_policies set enabled=false');
      else await db.exec(`insert into cos_mhelp_intake.portal_config(portal_id) values('18');update cos_mhelp_intake.ticket_lead_policies set portal_id='18';`);
    }
    const body=localPayload(),result=await accept(db,body);assert.equal(result.state,'review_needed');assert(result.reasonCodes.includes('ticket_lead_unverified'));
    assert.equal((await rows(db)).length,0);const saved=(await receipt(db))[0];assert.equal(saved.ticket_lead_resolution,null);assert.deepEqual(saved.first_payload,body);
  }
});

test('all four routes resolve a real local IT lead with no vendor crosswalk, preserving queues and truthful service attribution',async()=>{
  for(const type of ['service','delivery','swap','pickup']){
    const db=await fixture({type});await selectPolicy(db);await db.exec('delete from cos_mhelp_intake.identity_crosswalk');
    const body=localPayload(type),result=await accept(db,body);assert.equal(result.state,'created');
    const jobs=await rows(db);assert.equal(jobs.length,type==='service'?1:2);
    for(const job of jobs){
      assert.equal(job.job_lead_user_id,it);assert.equal(job.job_lead_role,'it');assert.equal(job.job_lead_name,'Synthetic IT');
      assert.equal(job.assignee_user_id,null);assert.equal(job.assignment_scope,'department');assert.equal(job.status,'assigned');
      assert.equal(job.assigned_by,null);assert.equal(job.assigned_by_name,'mHelpDesk automatic intake');assert.equal(job.created_from,'mhelpdesk_service_intake');
    }
    const saved=(await receipt(db))[0];assert.equal(saved.actor_kind,'service_role');assert.equal(saved.received_by,null);
    assert.deepEqual(saved.first_payload.ticketLead,marker());assert.equal(saved.ticket_lead_resolution.legacy_user_id,it);
    assert.equal(saved.ticket_lead_resolution.mode,REVIEWED_LOCAL_LEAD_POLICY);assert.equal(saved.ticket_lead_resolution.review_actor,'owner');
    assert.equal(saved.ticket_lead_resolution.reviewed_by,owner);assert(!('source_identity' in saved.ticket_lead_resolution));
    assert.equal((await scalar(db,'select count(*)::integer n from public.app_notifications')).n,0);
    await db.query("select set_config('test.real_user',$1,false)",[it]);
    assert((await scalar(db,'select public.my_managed_tickets_v1() value')).value.some(row=>row.ticket_no==='000042'));
  }
});

test('write boundary rejects nonexistent, wrong-role, inactive, archived leads and invalid reviewer authority',async()=>{
  for(const [user,change] of [['90000000-0000-4000-8000-000000000099',null],[service,null],[owner,null],[it,'active=false'],[it,"archived_at='2026-10-10T00:00:00Z'"]]){
    const db=await fixture();await selectPolicy(db,user);if(change)await db.query(`update public.profiles set ${change} where user_id=$1`,[it]);
    const result=await accept(db,localPayload());assert.equal(result.state,'review_needed');assert(result.reasonCodes.includes('ticket_lead_inactive_or_unverified'));assert.equal((await rows(db)).length,0);
  }
  for(const edit of [`update cos_mhelp_intake.ticket_lead_policies set reviewed_by='${service}'`,`update public.profiles set active=false where user_id='${owner}'`,`update cos_mhelp_intake.ticket_lead_policies set reviewed_at=clock_timestamp()+interval '1 day'`]){
    const db=await fixture();await selectPolicy(db);await db.exec(edit);const result=await accept(db,localPayload());assert.equal(result.state,'review_needed');assert(result.reasonCodes.some(code=>code.startsWith('ticket_lead_')));assert.equal((await rows(db)).length,0);
  }
});

test('policy provenance is bounded and delegated review never fabricates a human reviewer',async()=>{
  const db=await fixture();await selectPolicy(db);
  for(const edit of ["evidence=''","evidence=repeat('x',1001)","evidence=E'bad\\nline'","reviewed_by=null","review_actor='approved_service'","review_actor='approved_service',reviewed_by=null,approval_reference=''","reviewed_at='infinity'","policy='anything_else'"])
    await assert.rejects(db.exec(`update cos_mhelp_intake.ticket_lead_policies set ${edit}`));
  await assert.rejects(selectPolicy(db),/duplicate key/);
  await db.exec("update cos_mhelp_intake.ticket_lead_policies set review_actor='approved_service',reviewed_by=null,approval_reference='Synthetic owner approval reference'");
  assert.equal((await accept(db,localPayload())).state,'created');const saved=(await receipt(db))[0];
  assert.equal(saved.ticket_lead_resolution.reviewed_by,null);assert.equal(saved.ticket_lead_resolution.review_actor,'approved_service');assert.equal(saved.ticket_lead_resolution.approval_reference,'Synthetic owner approval reference');
});

test('local policy holds assigned or contradictory source facts and conflict reasons survive the Owner DTO',async()=>{
  for(const mutate of [body=>{body.source.assignment={state:'assigned',identities:['service.source'],evidence:'Synthetic assigned source'};},body=>{body.departmentAssignments=[{department:'service',state:'assigned',identities:['service.source'],evidence:'Synthetic conflicting department'}];},body=>{delete body.source.assignment;}]){
    const db=await fixture();await selectPolicy(db);const body=localPayload();mutate(body);const result=await accept(db,body);
    assert.equal(result.state,'review_needed');assert(result.reasonCodes.includes('ticket_lead_policy_conflict'));assert.equal((await rows(db)).length,0);
    await db.exec('set role service_role');try{const dto=await scalar(db,`select public.camera_mhelp_ticket_intake_v1('{"action":"review_status"}'::jsonb) value`);assert(checkedIntakeReview(projectIntakeReview(dto.value)).held[0].reasonCodes.includes('ticket_lead_policy_conflict'));}finally{await db.exec('reset role');}
  }
});

test('mixed source/policy lead modes, caller UUIDs and unknown markers reject before retention',async()=>{
  const db=await fixture();await selectPolicy(db);
  for(const lead of [{...marker(),sourceIdentity:'it.source'},{...marker(),sourceIdentity:'other.source',evidence:'Synthetic contradictory lead'},{...marker(),legacy_user_id:service},{...marker(),legacyUserId:service},{...marker(),evidence:'Caller approval'},{policy:'other'},{policy:42},{policy:null}])
    await assert.rejects(accept(db,{...localPayload(),ticketLead:lead}),/MHELP_INTAKE_INVALID_SOURCE/);
  assert.equal((await receipt(db)).length,0);assert.equal((await rows(db)).length,0);
});

test('exact source-crosswalk lead still works independently and never falls back to the local policy',async()=>{
  const db=await fixture();await selectPolicy(db);await db.exec(`insert into public.profiles(user_id,role,full_name) values('90000000-0000-4000-8000-000000000098','it','Synthetic other IT');update cos_mhelp_intake.ticket_lead_policies set legacy_user_id='90000000-0000-4000-8000-000000000098';`);
  assert.equal((await accept(db,payload())).state,'created');assert.equal((await rows(db))[0].job_lead_user_id,it);assert.equal((await receipt(db))[0].ticket_lead_resolution.mode,'source_crosswalk');
  const unknown=payload();unknown.source.ticketId='43';unknown.source.ticketNumber='000043';unknown.request.ticket_no='000043';unknown.ticketLead.sourceIdentity='unknown.source';
  assert.equal((await accept(db,unknown)).state,'review_needed');assert.equal((await rows(db)).length,1);
});

test('unchanged held marker can proceed after private policy repair without inventing earlier selection',async()=>{
  const db=await fixture(),body=localPayload();assert.equal((await accept(db,body)).state,'review_needed');assert.equal((await receipt(db))[0].ticket_lead_resolution,null);
  await selectPolicy(db);assert.equal((await accept(db,body)).state,'created');const saved=(await receipt(db))[0];assert.deepEqual(saved.first_payload,body);assert.equal(saved.ticket_lead_resolution.legacy_user_id,it);
});

test('replay preserves assignment and original provenance after policy, profile, config and manual lead edits',async()=>{
  const db=await fixture(),body=localPayload();await selectPolicy(db);const created=await accept(db,body),saved=(await receipt(db))[0];
  await db.exec(`update cos_mhelp_intake.ticket_lead_policies set legacy_user_id='${service}',evidence='Synthetic later decision';update public.profiles set active=false where user_id='${it}';update cos_mhelp_intake.portal_config set enabled=false,schema_contract='synthetic-later-contract';update public.job_assignments set job_lead_user_id='${service}',job_lead_name='Synthetic manual edit',notes='Synthetic manual work edit',status='completed';`);
  const edited=await rows(db),replay=await accept(db,body);assert.equal(replay.state,'existing');assert.deepEqual(replay.assignmentIds,created.assignmentIds);assert.deepEqual(await rows(db),edited);assert.deepEqual((await receipt(db))[0],saved);
  await db.exec('delete from cos_mhelp_intake.ticket_lead_policies');assert.equal((await accept(db,body)).state,'existing');assert.deepEqual(await rows(db),edited);
  assert.equal((await accept(db,{...body,ticketLead:{sourceIdentity:'it.source',evidence:'Synthetic changed source lead'}})).state,'review_needed');assert.deepEqual((await receipt(db))[0].ticket_lead_resolution,saved.ticket_lead_resolution);assert.deepEqual(await rows(db),edited);
});

test('forward upgrade is atomic and preserves installed rows, historical provenance, disabled state and public ACLs',async()=>{
  const db=await fixture({localLeadUpgrade:false});assert.equal((await accept(db)).state,'created');await db.exec('update cos_mhelp_intake.portal_config set enabled=false');
  const oldReceipt=(await receipt(db))[0],oldJobs=await rows(db),definition=await scalar(db,"select pg_get_functiondef('cos_mhelp_intake.accept_ticket_v1(jsonb)'::regprocedure) body"),publicAcl=await scalar(db,"select proacl::text acl from pg_proc where oid='public.camera_mhelp_ticket_intake_v1(jsonb)'::regprocedure");
  const upgrade=await mhelpLocalLeadUpgradeSql();await assert.rejects(db.exec(upgrade.replace(/commit;\s*$/,'select missing_synthetic_upgrade_check();\ncommit;')));await db.exec('rollback');
  assert.equal((await scalar(db,"select to_regclass('cos_mhelp_intake.ticket_lead_policies') is null absent")).absent,true);assert.deepEqual(await scalar(db,"select pg_get_functiondef('cos_mhelp_intake.accept_ticket_v1(jsonb)'::regprocedure) body"),definition);assert.deepEqual((await receipt(db))[0],oldReceipt);assert.deepEqual(await rows(db),oldJobs);
  await db.exec(upgrade);assert.deepEqual(await scalar(db,"select proacl::text acl from pg_proc where oid='public.camera_mhelp_ticket_intake_v1(jsonb)'::regprocedure"),publicAcl);
  const upgraded=(await receipt(db))[0];assert.equal(upgraded.ticket_lead_resolution,null);delete upgraded.ticket_lead_resolution;assert.deepEqual(upgraded,oldReceipt);
  assert.equal((await scalar(db,'select count(*)::integer n from cos_mhelp_intake.ticket_lead_policies')).n,0);assert.equal((await scalar(db,'select bool_or(enabled) enabled from cos_mhelp_intake.portal_config')).enabled,false);assert.equal((await accept(db)).state,'existing');assert.deepEqual(await rows(db),oldJobs);
  for(const role of ['anon','authenticated','service_role'])assert.deepEqual(await scalar(db,"select has_schema_privilege($1,'cos_mhelp_intake','usage') s,has_table_privilege($1,'cos_mhelp_intake.ticket_lead_policies','select,insert,update,delete') t,has_function_privilege($1,'cos_mhelp_intake.accept_ticket_v1(jsonb)','execute') f",[role]),{s:false,t:false,f:false});
  assert.equal((await scalar(db,"select relrowsecurity r from pg_class where oid='cos_mhelp_intake.ticket_lead_policies'::regclass")).r,true);
  assert.equal((upgrade.match(/^grant /gm)||[]).length,0);assert.doesNotMatch(upgrade,/insert into cos_mhelp_intake\.(?:portal_config|ticket_lead_policies)/i);
  assert((await mhelpIntakeDeploymentSql()).includes(upgrade.split('\n').filter(line=>!['begin;','commit;'].includes(line.trim())).join('\n')));
});

test('upgrade refuses enabled intake or live lease, leaving the old schema unchanged',async()=>{
  for(const live of [false,true]){
    const db=await fixture({enabled:!live,localLeadUpgrade:false,realScheduler:true});if(live)await db.exec(`insert into cos_mhelp_intake.scheduler_state(portal_id,watermark,lease_id,lease_until) values('17',now(),gen_random_uuid(),clock_timestamp()+interval '3 minutes')`);
    await assert.rejects(db.exec(await mhelpLocalLeadUpgradeSql()),live?/MHELP_INTAKE_LIVE_LEASE/:/MHELP_INTAKE_DISABLE_BEFORE_UPGRADE/);await db.exec('rollback');assert.equal((await scalar(db,"select to_regclass('cos_mhelp_intake.ticket_lead_policies') is null absent")).absent,true);
  }
});

test('forward upgrade refuses an unexpectedly changed acceptance function rather than overwriting it',async()=>{
  const db=await fixture({enabled:false,localLeadUpgrade:false});
  await db.exec(`create or replace function cos_mhelp_intake.accept_ticket_v1(p_ticket jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$begin raise exception 'Synthetic changed contract';end;$$;`);
  await assert.rejects(db.exec(await mhelpLocalLeadUpgradeSql()),/MHELP_INTAKE_BASE_DRIFT/);await db.exec('rollback');
  assert.equal((await scalar(db,"select to_regclass('cos_mhelp_intake.ticket_lead_policies') is null absent")).absent,true);
  assert((await scalar(db,"select prosrc from pg_proc where oid='cos_mhelp_intake.accept_ticket_v1(jsonb)'::regprocedure")).prosrc.includes('Synthetic changed contract'));
});

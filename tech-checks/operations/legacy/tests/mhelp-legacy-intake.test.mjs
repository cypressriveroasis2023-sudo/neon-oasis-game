import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareMhelpLegacyIntake} from '../mhelpIntakeAdapter.ts';
import {fixture,input,options,payload,accept,rows,receipt,sql,owner,it,service} from '../mhelp-intake-fixture.mjs';

test('preparation needs explicit source creation, verified schema and deliberate exact IT lead; never executes',()=>{
  const result=prepareMhelpLegacyIntake(input(),options());
  assert.equal(result.state,'ready');assert.equal(result.executionEnabled,false);
  assert.equal(result.payload.source.createdAt,options().createdAt);assert.equal(result.payload.ticketLead.sourceIdentity,'it.source');
  for(const createdAt of ['2026-10-10','2026-02-30T00:00:00Z','2026-10-10T00:00:00','2026-10-10T01:00:00+01:00'])
    assert(prepareMhelpLegacyIntake(input(),{...options(),createdAt}).reasonCodes.includes('source_creation_time_invalid'));
  for(const change of [{sourceIdentity:'guessed.display.name'},{sourceIdentity:'service.source'},{evidence:''}])
    assert(prepareMhelpLegacyIntake(input(),{...options(),ticketLead:{...options().ticketLead,...change}}).reasonCodes.includes('ticket_lead_unverified'));
  const incomplete=input();incomplete.equipment.complete=false;assert.equal(prepareMhelpLegacyIntake(incomplete,options()).payload,null);
});

test('one approved service-only RPC leaves private helpers/table access revoked and adds no identity override or outgoing call',async()=>{
  const source=await sql();assert.match(source,/security invoker set search_path = ''/);
  assert.equal((source.match(/^grant /gm)||[]).length,1);assert.match(source,/grant execute on function public.camera_mhelp_ticket_intake_v1\(jsonb\) to service_role/);
  assert.doesNotMatch(source,/\b(set_config|http_post|http_get|enqueue_app_notification)\b/i);
  assert.doesNotMatch(source,/\b(update|delete from)\s+public\.job_assignments/i);
  const db=await fixture();try {
    assert.equal((await db.query("select prosecdef from pg_proc where oid='cos_mhelp_intake.accept_ticket_v1(jsonb)'::regprocedure")).rows[0].prosecdef,false);
    for(const role of ['anon','authenticated','service_role'])
      assert.deepEqual((await db.query("select has_schema_privilege($1,'cos_mhelp_intake','USAGE') s,has_function_privilege($1,'cos_mhelp_intake.accept_ticket_v1(jsonb)','EXECUTE') f",[role])).rows[0],{s:false,f:false});
    const tables=(await db.query("select relrowsecurity from pg_class where relnamespace='cos_mhelp_intake'::regnamespace and relkind='r'")).rows;
    assert.equal((await db.query("select has_function_privilege('service_role','public.camera_mhelp_ticket_intake_v1(jsonb)','EXECUTE') f")).rows[0].f,true);
    for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'public.camera_mhelp_ticket_intake_v1(jsonb)','EXECUTE') f",[role])).rows[0].f,false);
    assert.equal(tables.length,6);assert(tables.every(r=>r.relrowsecurity));
  }finally{await db.close();}
});

test('service wrapper denies public/regular users and any fabricated human actor, even an active Owner',async()=>{
  const db=await fixture();try {
    for(const user of [owner,it,service]) {await db.query("select set_config('test.real_user',$1,false)",[user]);await assert.rejects(accept(db),/MHELP_INTAKE_SERVICE_ROLE_REQUIRED/);}
    await db.exec("select set_config('test.real_user','',false)");
    for(const role of ['anon','authenticated']) {
      await db.exec('set role '+role);
      try {await assert.rejects(db.query("select public.camera_mhelp_ticket_intake_v1('{\"action\":\"begin\"}'::jsonb)"),/permission denied/);}
      finally{await db.exec('reset role');}
    }
    await assert.rejects(db.query('select cos_mhelp_intake.accept_ticket_v1($1)',[JSON.stringify(payload())]),/MHELP_INTAKE_SERVICE_CONTEXT_REQUIRED/);
    assert.equal((await rows(db)).length,0);assert.equal((await receipt(db)).length,0);
  }finally{await db.close();}
});

test('disabled and historical intake create nothing and retain no historical ticket content',async()=>{
  const db=await fixture({enabled:false});try {
    assert.equal((await accept(db)).state,'disabled');await db.exec('update cos_mhelp_intake.portal_config set enabled=true');
    const old=payload();old.source.createdAt='2026-10-09T23:59:59Z';assert.equal((await accept(db,old)).state,'excluded');
    assert.equal((await rows(db)).length,0);assert.equal((await receipt(db)).length,0);
    const boundary=payload();boundary.source.createdAt='2026-10-10T00:00:00Z';assert.equal((await accept(db,boundary)).state,'created');
  }finally{await db.close();}
});

test('four types preserve role order, handoff/return gates, live IT lead, untouched progress and zero notifications',async()=>{
  for(const type of ['service','delivery','swap','pickup']) {
    const db=await fixture({type});try {
      const result=await accept(db,payload(type));assert.equal(result.state,'created',type);assert.equal(result.notifications,false);
      const assigned=await rows(db),byId=Object.fromEntries(assigned.map(r=>[r.id,r]));
      assert.deepEqual(result.assignmentIds.map(id=>byId[id].assigned_role),type==='service'?['service']:type==='pickup'?['service','it']:['it','service']);
      for(const row of assigned) {
        assert.equal(row.job_lead_user_id,it);assert.equal(row.job_lead_role,'it');assert.equal(row.assigned_by,null);assert.equal(row.assigned_by_name,'mHelpDesk automatic intake');assert.equal(row.created_from,'mhelpdesk_service_intake');assert.equal(row.work_type,type);
        assert.equal(row.status,'assigned');assert.equal(row.prep_ticket_id,null);assert.equal(row.started_at,null);assert.deepEqual(row.return_equipment_manifest,[]);
        assert.equal(row.requires_it_handoff,row.assigned_role==='service'&&['delivery','swap'].includes(type));
      }
      assert.equal((await db.query('select count(*)::int n from public.app_notifications')).rows[0].n,0);
      assert.equal((await db.query('select count(*)::int n from public.workflow_checkpoints')).rows[0].n,assigned.length);
      const replay=await accept(db,payload(type));assert.equal(replay.state,'existing');assert.deepEqual(replay.assignmentIds,result.assignmentIds);
    }finally{await db.close();}
  }
});

test('Service with explicit supported parts requires IT then Service',async()=>{
  const db=await fixture();try {
    const value=input();value.parts.quantities.micro_sd_qty=1;const p=prepareMhelpLegacyIntake(value,options()).payload;
    assert.equal((await accept(db,p)).state,'created');assert.deepEqual((await rows(db)).map(r=>r.requires_it_handoff).sort(),[false,true]);
  }finally{await db.close();}
});

test('replay after claim, manual edits, completion, cancellation or missing work never mutates/recreates assignments',async()=>{
  const db=await fixture();try {
    const result=await accept(db),id=result.assignmentIds[0];
    for(const status of ['started','completed','cancelled']) {
      await db.query('update public.job_assignments set assignee_user_id=$1,status=$2,notes=$3 where id=$4',[service,status,'Manual technician edit',id]);
      const before=await rows(db);assert.equal((await accept(db)).state,'existing');assert.deepEqual(await rows(db),before);
    }
    await db.query('delete from public.job_assignments where id=$1',[id]); // Synthetic-only fault injection.
    assert.equal((await accept(db)).state,'existing');assert.equal((await rows(db)).length,0);
  }finally{await db.close();}
});

test('changed source status/details/assignment remain review-only and never overwrite technician edits',async()=>{
  const db=await fixture();try {
    await accept(db);const before=await rows(db);
    for(const field of ['status','description','assignment']) {
      const next=payload();if(field==='status')next.source.statusId='another-source-status';
      if(field==='description')next.request.job_description='Changed vendor instructions';
      if(field==='assignment')next.source.assignment={state:'assigned',identities:['service.source'],evidence:'Changed source'};
      const result=await accept(db,next);assert.equal(result.state,'review_needed');assert.deepEqual(result.reasonCodes,['source_changed_review_required']);assert.deepEqual(await rows(db),before);
    }
    assert.deepEqual((await receipt(db))[0].first_payload,payload());
    assert.equal((await receipt(db))[0].state,'created');assert.equal((await receipt(db))[0].review_required,true);
    assert.equal((await db.query('select count(*)::int n from cos_mhelp_intake.receipts where review_required')).rows[0].n,1);
    assert.equal((await accept(db)).reviewRequired,true);
  }finally{await db.close();}
});

test('all legacy history and same-number different-source tickets are held instead of adopted',async()=>{
  for(const status of ['assigned','started','completed','cancelled']) {
    const db=await fixture();try {
      await db.query(`insert into public.job_assignments(ticket_no,assigned_role,status,assigned_by,assigned_by_name)values('000042','service',$1,$2,'Synthetic Owner')`,[status,owner]);
      const before=await rows(db),result=await accept(db);assert.equal(result.state,'review_needed');assert(result.reasonCodes.includes('existing_ticket_requires_reconciliation'));assert.deepEqual(await rows(db),before);
    }finally{await db.close();}
  }
  const db=await fixture();try {
    await accept(db);const next=payload();next.source.ticketId='different-id';assert((await accept(db,next)).reasonCodes.includes('existing_ticket_requires_reconciliation'));assert.equal((await rows(db)).length,1);
  }finally{await db.close();}
});

test('missing scope, malformed quantities, wrong routes, unsupported equipment and unknown source facts persist review holds',async()=>{
  const changes=[p=>{delete p.request.micro_sd_qty;},p=>{p.request.micro_sd_qty=-1;},p=>{p.request.micro_sd_qty='0';},
    p=>{p.request.scheduled_for='2026-02-30';},p=>{delete p.request.scheduled_time;},p=>{delete p.sourceEvidence;},p=>{p.sourceEvidence.complete=false;},
    p=>{p.request.targets[0].requires_it_handoff=true;},p=>{delete p.request.targets[0].assignee_user_id;},
    p=>{p.request.equipment_manifest=[{category:'device',label:'Solar Pole',qty:1}];},p=>{p.request.equipment_manifest=[{category:'device',label:'Sniper',qty:null}];},
    p=>{p.source.assignment.state='unknown';},p=>{delete p.source.assignment;},p=>{p.schemaContract='unverified';},p=>{p.source.deleted=true;},p=>{p.source.typeId='unknown';},
    p=>{p.ticketLead.sourceIdentity='guessed-name';},p=>{p.ticketLead.sourceIdentity='service.source';}];
  const db=await fixture();try {
    for(let index=0;index<changes.length;index++) {
      const p=payload();p.source.ticketId=String(index+100);p.source.ticketNumber='test-'+index;p.request.ticket_no=p.source.ticketNumber;changes[index](p);
      const result=await accept(db,p);assert.equal(result.state,'review_needed','case '+index);assert(result.reasonCodes.length>0);assert.equal((await rows(db)).length,0);
    }
    assert.equal((await receipt(db)).length,changes.length);
  }finally{await db.close();}
});

test('persisted exact crosswalk revalidates current activity, archive and role; same held source can proceed after mapping repair',async()=>{
  const db=await fixture();try {
    const value=input();value.source.assignment={state:'assigned',identities:['service.source'],evidence:'Synthetic explicit source assignment'};
    const p=prepareMhelpLegacyIntake(value,options()).payload;
    await db.exec(`update public.profiles set active=false where user_id='${service}'`);assert((await accept(db,p)).reasonCodes.includes('assignment_identity_unverified'));
    await db.exec(`update public.profiles set active=true,archived_at=now() where user_id='${service}'`);assert((await accept(db,p)).reasonCodes.includes('assignment_identity_unverified'));
    await db.exec(`update public.profiles set archived_at=null,role='it' where user_id='${service}'`);assert((await accept(db,p)).reasonCodes.includes('assignment_identity_unverified'));
    await db.exec(`update public.profiles set role='service' where user_id='${service}'`);assert.equal((await accept(db,p)).state,'created');assert.equal((await rows(db))[0].assignee_user_id,service);
  }finally{await db.close();}
});

test('failure on second assignment rolls back first assignment, checkpoints and receipt atomically',async()=>{
  const db=await fixture({type:'delivery'});try {
    await db.exec(`create function public.synthetic_fail_second() returns trigger language plpgsql as $$begin
      if new.assigned_role='service' then raise exception 'Synthetic second-target failure';end if;return new;end$$;
      create trigger synthetic_fail_second before insert on public.job_assignments for each row execute function public.synthetic_fail_second();`);
    await assert.rejects(accept(db,payload('delivery')),/Synthetic second-target failure/);
    assert.equal((await rows(db)).length,0);assert.equal((await receipt(db)).length,0);assert.equal((await db.query('select count(*)::int n from public.workflow_checkpoints')).rows[0].n,0);
  }finally{await db.close();}
});

test('queued duplicate calls yield one immutable receipt; disabling preserves readback without creating more work',async()=>{
  const db=await fixture();try {
    // PGlite serializes calls; this does not establish multi-session lock contention.
    assert.deepEqual((await Promise.all([accept(db),accept(db),accept(db)])).map(r=>r.state),['created','existing','existing']);
    assert.equal((await rows(db)).length,1);assert.equal((await receipt(db)).length,1);
    await db.exec('update cos_mhelp_intake.portal_config set enabled=false');assert.equal((await accept(db)).state,'existing');
    const newer=payload();newer.source.ticketId='43';newer.source.ticketNumber='000043';newer.request.ticket_no='000043';assert.equal((await accept(db,newer)).state,'disabled');
  }finally{await db.close();}
});

test('unrelated raw source fields are stripped by preparation and rejected by the database without retention',async()=>{
  const value=input();value.source.unrelated='synthetic-unwanted';value.source.assignment.unrelated='synthetic-unwanted';
  value.departmentAssignments=[{department:'service',state:'unassigned',identities:[],evidence:'Synthetic explicit empty',unrelated:'synthetic-unwanted'}];
  const prepared=prepareMhelpLegacyIntake(value,{...options(),ticketLead:{...options().ticketLead,unrelated:'synthetic-unwanted'}});
  assert.equal(JSON.stringify(prepared).includes('synthetic-unwanted'),false);
  const db=await fixture();try {
    for(const target of ['source','request','ticketLead','sourceEvidence']) {
      const p=payload();p[target].unrelated='synthetic-unwanted';await assert.rejects(accept(db,p),/MHELP_INTAKE_INVALID_SOURCE/);
    }
    const p=payload();p.source.createdAt='2026-10-10T24:00:00Z';await assert.rejects(accept(db,p),/MHELP_INTAKE_INVALID_SOURCE/);
    assert.equal((await rows(db)).length,0);assert.equal((await receipt(db)).length,0);
  }finally{await db.close();}
});

test('exact existing claim/read contracts recognize imported lead and enforce IT handoff/physical-return gates',async()=>{
  for(const type of ['delivery','pickup']) {
    const db=await fixture({type});try {
      const created=await accept(db,payload(type)),assigned=await rows(db);
      await db.query("select set_config('test.real_user',$1,false)",[it]);
      const managed=(await db.query('select public.my_managed_tickets_v1() value')).rows[0].value;
      assert.equal(managed.length,1);assert.equal(managed[0].ticket_no,'000042');assert.equal(managed[0].all_finished,false);
      const target=assigned.find(row=>row.assigned_role===(type==='pickup'?'it':'service'));
      await db.query("select set_config('test.real_user',$1,false)",[type==='pickup'?it:service]);
      await assert.rejects(db.query('select public.claim_my_department_assignment($1)',[target.id]),type==='pickup'?/WAITING FOR SERVICE RETURN/:/WAITING FOR IT HANDOFF/);
      assert.equal((await rows(db)).find(row=>row.id===target.id).status,'assigned');
      if(type==='pickup')await db.exec("insert into public.unit_returns(ticket_no,status) values('000042','waiting_it')");
      else await db.exec("insert into public.prep_tickets(ticket_no,status) values('000042','released')");
      await db.query('select public.claim_my_department_assignment($1)',[target.id]);
      const claimed=(await rows(db)).find(row=>row.id===target.id);assert.equal(claimed.status,'started');
      await db.exec("select set_config('test.real_user','',false)");
      assert.deepEqual((await accept(db,payload(type))).assignmentIds,created.assignmentIds);
      assert.equal((await rows(db)).length,2);
    }finally{await db.close();}
  }
});

test('orphaned prep and return history are held even when no assignment survives',async()=>{
  for(const table of ['prep_tickets','unit_returns']) {
    const db=await fixture();try {
      await db.exec(`insert into public.${table}(ticket_no,status) values('000042','completed')`);
      const result=await accept(db);assert.equal(result.state,'review_needed');assert(result.reasonCodes.includes('existing_ticket_requires_reconciliation'));assert.equal((await rows(db)).length,0);
    }finally{await db.close();}
  }
});

test('another portal cannot reuse a printed ticket even if all created assignments disappear',async()=>{
  const db=await fixture();try {
    await accept(db);
    await db.exec(`delete from public.job_assignments;
      insert into cos_mhelp_intake.portal_config select '18',enabled,activated_at,schema_contract,schema_evidence,reviewed_by,review_actor,approval_reference,reviewed_at from cos_mhelp_intake.portal_config where portal_id='17';
      insert into cos_mhelp_intake.type_mappings select '18',type_id,work_type,enabled,evidence,reviewed_by,review_actor,approval_reference,reviewed_at from cos_mhelp_intake.type_mappings where portal_id='17';
      insert into cos_mhelp_intake.identity_crosswalk select '18',source_identity,legacy_user_id,department,enabled,evidence,reviewed_by,review_actor,approval_reference,reviewed_at from cos_mhelp_intake.identity_crosswalk where portal_id='17';`);
    const p=payload();p.source.portalId='18';
    await db.exec(`create or replace function cos_mhelp_intake.validate_intake_lease_v1(uuid) returns jsonb language sql as $$select '{"portalId":"18","createdAfter":"2026-10-09T00:00:00Z","createdBefore":"2026-10-11T00:00:00Z"}'::jsonb$$`);
    const result=await accept(db,p);assert.equal(result.state,'review_needed');assert(result.reasonCodes.includes('existing_ticket_requires_reconciliation'));assert.equal((await rows(db)).length,0);
  }finally{await db.close();}
});

test('ordinary rows still require a real actor and direct callers cannot forge the fixed service actor marker',async()=>{
  const db=await fixture();try {
    for(const [marker,name] of [[null,'Synthetic Owner'],['other','mHelpDesk automatic intake'],['mhelpdesk_service_intake','Wrong name'],['mhelpdesk_service_intake','mHelpDesk automatic intake']])
      await assert.rejects(db.query("insert into public.job_assignments(ticket_no,assigned_role,assigned_by,assigned_by_name,created_from) values('bad-actor','service',null,$1,$2)",[name,marker]));
    // Existing real table rights do not authorize direct service-marker inserts.
    await db.exec('grant insert on public.job_assignments to service_role; grant usage on schema auth to service_role; grant execute on function auth.uid() to service_role;set role service_role');
    try{await assert.rejects(db.query("insert into public.job_assignments(ticket_no,assigned_role,assigned_by,assigned_by_name,created_from) values('bad-service','service',null,'mHelpDesk automatic intake','mhelpdesk_service_intake')"),/MHELP_INTAKE_SERVICE_CONTEXT_REQUIRED/);}
    finally{await db.exec('reset role');}
    await accept(db);const row=(await rows(db))[0];assert.equal(row.assigned_by,null);
    assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,3);
    await assert.rejects(db.query('update public.job_assignments set assigned_by=$1 where id=$2',[owner,row.id]),/MHELP_INTAKE_ACTOR_IMMUTABLE/);
    for(const user of [it,service]){
      await db.query("select set_config('test.real_user',$1,false)",[user]);
      if(user===service){const visible=(await db.query("select * from public.my_available_assignments('service')")).rows;assert.equal(visible.length,1);assert.equal(visible[0].assigned_by_name,'mHelpDesk automatic intake');}
      else assert.equal((await db.query('select public.my_managed_tickets_v1() value')).rows[0].value.length,1);
    }
    const saved=(await receipt(db))[0];assert.equal(saved.received_by,null);assert.equal(saved.actor_kind,'service_role');
  }finally{await db.close();}
});

test('configuration records delegated review provenance without claiming a human Owner identity',async()=>{
  const db=await fixture();try {
    for(const table of ['portal_config','type_mappings','source_status_policies','identity_crosswalk'])
      await db.query(`update cos_mhelp_intake.${table} set reviewed_by=null,review_actor='approved_service',approval_reference=$1`,['synthetic-explicit-user-approval']);
    assert.equal((await accept(db)).state,'created');
    for(const table of ['portal_config','type_mappings','source_status_policies','identity_crosswalk'])
      await assert.rejects(db.query(`update cos_mhelp_intake.${table} set approval_reference=null`),/check constraint/);
  }finally{await db.close();}
});

test('read-only service policy reveals verification flags without identities and respects inactive reviewers',async()=>{
  const db=await fixture();try {
    async function policy(){await db.exec('set role service_role');try{return(await db.query(`select public.camera_mhelp_ticket_intake_v1('{"action":"policy"}') value`)).rows[0].value;}finally{await db.exec('reset role');}}
    const value=await policy();assert.equal(value.state,'ready');assert.equal(value.typeMappingsVerified,false);assert.equal(value.identityMappingsVerified,true);assert.equal(value.statusPoliciesVerified,true);
    assert.equal(JSON.stringify(value).includes(it),false);assert.equal(JSON.stringify(value).includes('it.source'),false);
    await db.exec(`update public.profiles set active=false where user_id='${owner}'`);assert.equal((await policy()).state,'review_needed');
  }finally{await db.close();}
});

test('migration lock waits are bounded and runtime history locks fail immediately instead of inverting human lock order',async()=>{
  const source=await sql();assert.match(source,/set local lock_timeout='2s'/);assert.match(source,/set local statement_timeout='30s'/);
  assert.match(source,/lock table public\.job_assignments, public\.prep_tickets, public\.unit_returns in share row exclusive mode nowait/);
  const db=await fixture({type:'delivery'});try {
    // PGlite has one session. Inject the exact contention SQLSTATE after the
    // first target to verify whole-record rollback; multi-session remains gated.
    await db.exec(`create function public.synthetic_lock_backoff() returns trigger language plpgsql as $$begin
      if new.assigned_role='service' then raise exception 'Synthetic lock contention' using errcode='55P03';end if;return new;end$$;
      create trigger synthetic_lock_backoff before insert on public.job_assignments for each row execute function public.synthetic_lock_backoff();`);
    await assert.rejects(accept(db,payload('delivery')),error=>error.code==='55P03');
    assert.equal((await rows(db)).length,0);assert.equal((await receipt(db)).length,0);
    assert.equal((await db.query('select count(*)::int n from public.workflow_checkpoints')).rows[0].n,0);
  }finally{await db.close();}
});

test('nested provider data is rejected at every scalar leaf before created or review receipt retention',async()=>{
  const db=await fixture();try {
    const nested={rawProviderBody:{privateData:'synthetic-unwanted'}};
    const changes=[p=>{p.ticketLead.evidence=nested;},p=>{p.source.assignment.evidence=nested;},
      p=>{p.source.typeId=nested;},p=>{p.source.statusId=nested;},p=>{p.request.job_description=nested;},
      p=>{p.sourceEvidence.equipment=nested;},p=>{p.request.equipment_manifest=[{category:'device',label:'Sniper',qty:nested}];},
      p=>{p.source.assignment.identities=[nested];},p=>{p.request.targets[0].assignee_user_id=nested;},
      p=>{p.departmentAssignments=[{department:'service',state:'unassigned',identities:[],evidence:nested}];},p=>{p.source.typeId=5;},
      p=>{p.ticketLead.evidence='x'.repeat(1001);},p=>{p.source.assignment.evidence='x'.repeat(1001);}];
    for(const change of changes){const p=payload();change(p);await assert.rejects(accept(db,p),/MHELP_INTAKE_INVALID_SOURCE/);}
    assert.equal((await rows(db)).length,0);assert.equal((await receipt(db)).length,0);
  }finally{await db.close();}
});

test('only reviewed open source status/custom-status pairs create; terminal, unknown and ambiguous statuses remain review holds',async()=>{
  const db=await fixture();try {
    for(const [status,classification] of [['closed','terminal'],['cancelled','terminal'],['ambiguous','review']])
      await db.query(`insert into cos_mhelp_intake.source_status_policies(portal_id,status_id,classification,enabled,evidence,reviewed_by,reviewed_at)
        values('17',$1,$2,true,'Synthetic exact source dictionary decision',$3,now())`,[status,classification,owner]);
    for(const [index,status] of ['closed','cancelled','ambiguous','unknown',' '].entries()) {
      const p=payload();p.source.ticketId=String(index+600);p.source.ticketNumber='status-'+index;p.request.ticket_no=p.source.ticketNumber;p.source.statusId=status;
      const result=await accept(db,p);assert.equal(result.state,'review_needed');assert(result.reasonCodes.some(code=>code.startsWith('source_status_')));
    }
    const p=payload();p.source.customStatusId='unreviewed-custom';assert.equal((await accept(db,p)).state,'review_needed');
    assert.equal((await rows(db)).length,0);assert.equal((await receipt(db)).length,6);
    assert.equal((await receipt(db)).find(row=>row.ticket_id==='600').first_payload.source.statusId,'closed');
  }finally{await db.close();}
});

test('Owner review DTO is bounded and includes changed-source created receipts without payloads or people',async()=>{
  const db=await fixture();try {
    await accept(db);const changed=payload();changed.request.notes='Synthetic changed private note';await accept(db,changed);
    for(let n=0;n<27;n++){const p=payload();p.source.ticketId=String(800+n);p.source.ticketNumber='review-'+String(n).padStart(2,'0');p.request.ticket_no=p.source.ticketNumber;p.source.statusId='unknown';await accept(db,p);}
    await db.exec('set role service_role');let summary;
    try{summary=(await db.query(`select public.camera_mhelp_ticket_intake_v1('{"action":"review_status"}') value`)).rows[0].value;}finally{await db.exec('reset role');}
    assert.equal(summary.contract,'cos-mhelp-intake-review-v1');assert.equal(summary.pendingReviewCount,28);assert.equal(summary.createdCount,1);
    assert.equal(summary.held.length,25);assert.equal(summary.heldTruncated,true);assert.equal(summary.lastAttemptAt,null);assert.equal(summary.lastErrorCode,null);
    assert.deepEqual(summary.held[0],{ticketNumber:'000042',reasonCodes:['source_changed_review_required']});
    assert.equal(JSON.stringify(summary).includes('private note'),false);assert.equal(JSON.stringify(summary).includes(it),false);
    assert(summary.held.every(row=>Object.keys(row).sort().join(',')==='reasonCodes,ticketNumber'));
  }finally{await db.close();}
});

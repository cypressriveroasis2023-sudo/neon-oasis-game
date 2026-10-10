import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectMhelpSourceShell} from '../intake/mhelpSourceShellProjection.ts';
import {IntakeFault, validateOperationalTicket} from '../intake/mhelpIntakeRuntime.ts';
import {APPROVED_OPERATIONAL_ADAPTERS, productionAdapterFor, createBoundedMhelpSource} from '../intake/mhelpIntakeSource.ts';
import {LEGACY_PART_FIELDS} from '../shared/mhelpLegacyRoutePlan.ts';
import {fixture, accept, rows, receipt, it, service, owner} from '../legacy/mhelp-intake-fixture.mjs';

// All source facts, mappings, users and SQL data in this file are synthetic.
const scope = {portalId:'17', schemaContract:'synthetic-verified-v1', activationFloor:'2026-10-10T00:00:00Z',
  createdAfter:'2026-10-10T00:00:00Z', createdBefore:'2026-10-10T00:10:00Z'};
const config = (kind='delivery') => ({portalId:'17', schemaContract:scope.schemaContract,
  routeMapping:{portalId:'17', typeId:'5', workType:kind, reviewed:true, evidence:'Synthetic reviewed exact source type'}});
const assigned = identity => ({state:'assigned', identities:[identity], evidence:'Synthetic exact verified opaque appointment identity'});
const unassigned = () => ({state:'unassigned', identities:[], evidence:'Synthetic explicit source department unassignment'});
function facts(department='service') {
  return {
    source:{portalId:'17', ticketId:'42', ticketNumber:'000042', createdAt:'2026-10-10T00:00:01Z',
      typeId:'5', statusId:'source-open', customStatusId:null, deleted:false, assignment:assigned(department+'.source')},
    description:{reviewed:true, value:'  Synthetic instructions.\r\nKeep exact spacing.  ', evidence:'Synthetic verified source instruction fields'},
    notes:' \tSynthetic source notes.\n Keep this too.  ',
    schedule:{reviewed:true, date:'2026-10-12', time:'09:30:00', evidence:'Synthetic verified appointment local date/time semantics'},
  };
}
function project(input=facts(), options=config()) {
  const result=projectMhelpSourceShell(input,options);
  assert.deepEqual(validateOperationalTicket(result,scope),result);
  return result;
}
function minimum(input=facts()) {
  const {portalId,ticketId,ticketNumber,createdAt}=input.source;
  const source={portalId,ticketId,ticketNumber,createdAt};
  for (const key of ['typeId','statusId']) if (typeof input.source[key]==='string') source[key]=input.source[key];
  if (input.source.customStatusId===null) source.customStatusId=null;
  if (typeof input.source.deleted==='boolean') source.deleted=input.source.deleted;
  const knownAssignments=[assigned('service.source'),assigned('it.source'),unassigned()];
  if (knownAssignments.some(fact=>JSON.stringify(fact)===JSON.stringify(input.source.assignment))) source.assignment=structuredClone(input.source.assignment);
  return {contract:'cos-mhelp-legacy-intake-v1', schemaContract:scope.schemaContract, source, request:null};
}
const sourceInvalid = error => error instanceof IntakeFault && error.code === 'SOURCE_INVALID';
const roles = kind => kind === 'service' ? ['service'] : kind === 'pickup' ? ['service','it'] : ['it','service'];

test('all routes use explicit configuration, unresolved targets, original text and truthful deferred placeholders',()=>{
  for (const kind of ['service','delivery','swap','pickup']) for (const department of ['service','it']) {
    const input=facts(department),configuration=config(kind),before=structuredClone(input),beforeConfig=structuredClone(configuration);
    const output=project(input,configuration);
    assert.equal(output.request.work_type,kind);
    assert.deepEqual(output.request.targets,roles(kind).map(role=>({role,assignee_user_id:null,requires_it_handoff:role==='service'&&roles(kind)[0]==='it'})));
    assert.deepEqual(output.source,input.source);assert.deepEqual(output.departmentAssignments,[]);
    assert.deepEqual(output.localWorkflowPolicy,{policy:'technician_equipment_selection_v1'});
    assert.deepEqual(output.sourceEvidence,{description:input.description.evidence,schedule:input.schedule.evidence,complete:false});
    assert.equal(output.request.job_description,input.description.value);assert.equal(output.request.notes,input.notes);
    assert.equal(output.request.scheduled_for,input.schedule.date);assert.equal(output.request.scheduled_time,input.schedule.time);
    assert.equal(output.request.unit_summary,'');assert.equal(output.request.site,null);
    assert.equal(output.request.requested_unit_count,null);assert.deepEqual(output.request.equipment_manifest,[]);
    for (const field of LEGACY_PART_FIELDS) assert.equal(output.request[field],0);
    for (const key of ['ticketLead','targetProvenance','identityCrosswalk']) assert.equal(Object.hasOwn(output,key),false);
    assert.deepEqual(input,before);assert.deepEqual(configuration,beforeConfig);
    output.source.assignment.identities.push('changed');output.departmentAssignments.push({});output.localWorkflowPolicy.policy='changed';
    assert.deepEqual(input,before);
  }
});

test('notes-only, whitespace and optional site/time/summary preserve evidence without fabricating fields',()=>{
  for (const site of [undefined,null,{reviewed:true,value:'Synthetic verified site',evidence:'Synthetic verified source site'}]) {
    const input=facts();input.description.value=' \r\n\t';input.site=site;input.schedule.time=null;input.unitSummary='  Synthetic existing summary.\n';
    const output=project(input);
    assert.equal(output.request.job_description,input.description.value);assert.equal(output.request.notes,input.notes);
    assert.equal(output.request.site,site?.value??null);assert.equal(Object.hasOwn(output.sourceEvidence,'site'),Boolean(site));
    assert.equal(output.request.scheduled_time,null);assert.equal(output.request.unit_summary,input.unitSummary);
  }
  const input=facts();input.notes='';assert.equal(project(input).request.notes,'');
  for (const blank of ['',' \r\n\t','\u00a0\u2000\uFEFF']) {
    input.description.value=blank;input.notes=blank;assert.deepEqual(project(input),minimum(input));
  }
});

test('missing or ambiguous operational facts retain only independently validated source facts',()=>{
  const mutations=[
    p=>{delete p.notes;},p=>{p.notes=null;},p=>{p.notes={raw:'Never retain'};},p=>{p.notes+='\u0007';},
    p=>{delete p.description;},p=>{p.description.reviewed=false;},p=>{p.description.evidence=' ';},p=>{p.description.value='x'.repeat(10001);},
    p=>{delete p.schedule;},p=>{p.schedule.date='';},p=>{p.schedule.date='2026-02-29';},p=>{p.schedule.date='1899-12-31';},
    p=>{p.schedule.reviewed=false;},p=>{p.schedule.evidence='\n';},p=>{delete p.schedule.time;},p=>{p.schedule.time='25:00';},
    p=>{delete p.source.assignment;},p=>{p.source.assignment=unassigned();},p=>{p.source.assignment.state='unknown';},
    p=>{p.source.assignment.identities.push('other.source');},p=>{p.source.assignment.identities=[' service.source'];},p=>{p.source.assignment.evidence='';},
    p=>{delete p.source.statusId;},p=>{delete p.source.typeId;},p=>{delete p.source.customStatusId;},p=>{p.source.deleted=true;},
    p=>{p.site={reviewed:false,value:'Synthetic unverified site',evidence:'Synthetic evidence'};},p=>{p.unitSummary=null;},
  ];
  for (let index=0;index<mutations.length;index++) {
    const input=facts();mutations[index](input);assert.deepEqual(project(input),minimum(input),'mutation '+index);
  }
});

test('pending missing appointment or notes keeps known source facts and recorded deletion never becomes ready',async()=>{
  for (const remove of [p=>{delete p.schedule;},p=>{delete p.notes;}]) {
    const input=facts();remove(input);const output=project(input);
    assert.equal(output.request,null);assert.deepEqual(output.source,input.source);
    assert.deepEqual(Object.keys(output).sort(),['contract','request','schemaContract','source']);
    const db=await fixture({type:'delivery'}),result=await accept(db,output);
    assert.equal(result.state,'review_needed');
    for (const reason of ['type_mapping_unverified','source_status_unreviewed','source_status_incomplete_or_deleted']) assert.equal(result.reasonCodes.includes(reason),false,reason);
    assert.equal((await rows(db)).length,0);
  }
  const db=await fixture({type:'delivery'}),input=facts();input.source.deleted=true;
  const deleted=project(input);assert.equal(deleted.request,null);assert.deepEqual(deleted.source,input.source);
  const result=await accept(db,deleted);assert.equal(result.state,'review_needed');
  assert(result.reasonCodes.includes('source_status_incomplete_or_deleted'));assert.equal((await rows(db)).length,0);
  assert.deepEqual((await receipt(db))[0].first_payload.source,input.source);
  const terminal=facts();delete terminal.schedule;terminal.source.statusId='source-terminal';terminal.source.customStatusId='custom-terminal';
  const held=project(terminal);assert.equal(held.request,null);assert.deepEqual(held.source,terminal.source);
  const terminalDb=await fixture({type:'delivery'});
  await terminalDb.exec("update cos_mhelp_intake.source_status_policies set status_id='source-terminal',custom_status_id='custom-terminal',classification='terminal'");
  assert((await accept(terminalDb,held)).reasonCodes.includes('source_status_terminal'));assert.equal((await rows(terminalDb)).length,0);
  const unknown=facts();delete unknown.source.typeId;delete unknown.source.assignment;delete unknown.schedule;
  const partial=project(unknown);assert.equal(Object.hasOwn(partial.source,'typeId'),false);assert.equal(Object.hasOwn(partial.source,'assignment'),false);
  assert.equal(partial.source.statusId,'source-open');assert.equal(partial.source.deleted,false);
  const immutableOnly={source:{portalId:'17',ticketId:'42',ticketNumber:'000042',createdAt:'2026-10-10T00:00:01Z'}};
  assert.deepEqual(project(immutableOnly),{contract:'cos-mhelp-legacy-intake-v1',schemaContract:scope.schemaContract,source:immutableOnly.source,request:null});
});

test('verified notes alone can provide instructions without inventing a reviewed vendor summary',async()=>{
  for (const description of [undefined,null]) {
    const input=facts();input.description=description;
    input.notesEvidence={reviewed:true,evidence:'Synthetic verified original notes, no source summary supplied'};
    const output=project(input);assert.equal(output.request.job_description,'');assert.equal(output.request.notes,input.notes);
    assert.equal(output.sourceEvidence.description,input.notesEvidence.evidence);
    const db=await fixture({type:'delivery'});assert.equal((await accept(db,output)).state,'created');
    for (const job of await rows(db)) {assert.equal(job.job_description,'');assert.equal(job.notes,input.notes);}
  }
  for (const notesEvidence of [undefined,null,{reviewed:false,evidence:'Synthetic unreviewed notes'}, {reviewed:true,evidence:''}]) {
    const input=facts();delete input.description;input.notesEvidence=notesEvidence;assert.deepEqual(project(input),minimum(input));
  }
  const conflict=facts();conflict.description.reviewed=false;conflict.notesEvidence={reviewed:true,evidence:'Synthetic verified notes'};
  assert.deepEqual(project(conflict),minimum(conflict));
  conflict.description=undefined;conflict.notes=' \n';assert.deepEqual(project(conflict),minimum(conflict));
});

test('route selection is exact reviewed configuration and never falls back to source prose or fuzzy names',()=>{
  const input=facts();input.notes='Synthetic delivery installation swap pickup instructions';
  assert.equal(project(input,config('service')).request.work_type,'service');
  for (const route of [undefined,null,{...config().routeMapping,reviewed:false},{...config().routeMapping,evidence:''},
    {...config().routeMapping,portalId:'18'},{...config().routeMapping,typeId:'05'},
    {...config().routeMapping,workType:'Installation'},{...config().routeMapping,workType:'Delivery'},
    {...config().routeMapping,workType:{toString:()=> 'delivery'}}]) {
    assert.deepEqual(project(input,{...config(),routeMapping:route}),minimum(input));
  }
});

test('immutable identity and schema are validated before any pending receipt can be projected',()=>{
  for (const [field,values] of Object.entries({portalId:[undefined,'18','017',17],ticketId:[undefined,'','042',42,'42\n'],
    ticketNumber:[undefined,'',' bad','A B','a\n','a'.repeat(129)],
    createdAt:[undefined,'2026-10-10','2026-02-30T00:00:00Z','2026-10-10T00:00:01+00:00','2026-10-10T00:00:01.1Z']})) {
    for (const value of values) {const input=facts();input.source[field]=value;assert.throws(()=>projectMhelpSourceShell(input,config()),sourceInvalid,field+': '+value);}
  }
  for (const value of ['',undefined,' '+scope.schemaContract, 'x'.repeat(129),'a\nb']) {
    assert.throws(()=>projectMhelpSourceShell(facts(),{...config(),schemaContract:value}),error=>error instanceof IntakeFault&&error.code==='CONFIGURATION');
  }
});

test('native does not accept or access a COS crosswalk, user ID, invented lead or structured equipment scope',()=>{
  for (const key of ['identityCrosswalk','legacyUserId','equipment','parts','ticketLead','localWorkflowPolicy','rawVendorBody']) {
    const input=facts();Object.defineProperty(input,key,{enumerable:true,get(){throw Error('This value must not be read');}});
    assert.throws(()=>projectMhelpSourceShell(input,config()),sourceInvalid);
  }
  for (const mutate of [p=>{p.source.customer={private:'body'};},p=>{p.source.assignment.legacyUserId=service;},
    p=>{p.description.raw='Never retain';},p=>{p.schedule.timeZoneGuess='Synthetic';}]) {
    const input=facts();mutate(input);assert.throws(()=>projectMhelpSourceShell(input,config()),sourceInvalid);
  }
  const input=facts();Object.defineProperty(input.source,'assignment',{get(){throw Error('Synthetic normalized reader failed');}});
  assert.throws(()=>projectMhelpSourceShell(input,config()),/Synthetic normalized reader failed/);
});

test('only genuine normalized department facts survive and known conflicts remain pending',()=>{
  const input=facts();input.departmentAssignments=[{department:'it',...assigned('it.source')}];
  const output=project(input);assert.deepEqual(output.departmentAssignments,input.departmentAssignments);
  assert(output.request.targets.every(t=>t.assignee_user_id===null));
  output.departmentAssignments[0].identities.push('changed');assert.deepEqual(input.departmentAssignments[0].identities,['it.source']);
  for (const departments of [[{department:'service',...unassigned()},{department:'it',...unassigned()}],
    [{department:'it',...assigned('service.source')},{department:'service',...assigned('service.source')}],
    [{department:'it',...unassigned()},{department:'it',...unassigned()}],
    [{department:'it',state:'unknown',identities:[],evidence:'Synthetic unresolved fact'}],
    [{department:'other',...unassigned()}]]) {
    input.departmentAssignments=departments;assert.deepEqual(project(input),minimum(input));
  }
  input.departmentAssignments=[{department:'it',...assigned('it.source')}];
  assert.deepEqual(project(input,config('service')),minimum(input));
});

test('real isolated SQL writer resolves opaque source identity privately for all four routes and both departments',async()=>{
  for (const kind of ['service','delivery','swap','pickup']) for (const department of ['service','it']) {
    const db=await fixture({type:kind}),body=project(facts(department),config(kind)),result=await accept(db,body);
    if (kind==='service'&&department==='it') {
      assert.equal(result.state,'review_needed');assert(result.reasonCodes.includes('assignment_identity_unverified'));assert.equal((await rows(db)).length,0);continue;
    }
    assert.equal(result.state,'created',JSON.stringify({kind,department,result}));assert.equal(result.notifications,false);
    const jobs=await rows(db),byId=Object.fromEntries(jobs.map(job=>[job.id,job]));
    assert.deepEqual(result.assignmentIds.map(id=>byId[id].assigned_role),roles(kind));
    for (const job of jobs) {
      assert.equal(job.assignee_user_id,job.assigned_role===department?(department==='it'?it:service):null);
      assert.equal(job.assignment_scope,job.assigned_role===department?'technician':'department');
      assert.equal(job.job_description,body.request.job_description);assert.equal(job.notes,body.request.notes);
      assert.equal(job.scheduled_time,'09:30:00');assert.equal(job.scheduled_for.toISOString(),'2026-10-12T00:00:00.000Z');
      assert.equal(job.requires_it_handoff,job.assigned_role==='service'&&roles(kind)[0]==='it');
      assert.equal(job.status,'assigned');assert.equal(job.assigned_by,null);
      for (const field of ['site','requested_unit_count','job_lead_user_id','claimed_at','started_at','completed_at','cancelled_at','prep_ticket_id']) assert.equal(job[field],null);
      assert.deepEqual(job.equipment_manifest,[]);for (const field of LEGACY_PART_FIELDS) assert.equal(job[field],0);
    }
    const saved=(await receipt(db))[0];assert.deepEqual(saved.first_payload,body);assert.deepEqual(saved.candidate_payload,body);
    assert.equal(JSON.stringify(body).includes(service),false);assert.equal(JSON.stringify(body).includes(it),false);
    assert.deepEqual((await accept(db,body)).assignmentIds,result.assignmentIds);
    assert.equal((await db.query('select count(*)::int n from public.app_notifications')).rows[0].n,0);
  }
});

test('real SQL retains notes-only optional fields and resolves explicit secondary assignment without native user IDs',async()=>{
  const db=await fixture({type:'delivery'}),input=facts();input.description.value=' \n';input.schedule.time=null;
  input.site={reviewed:true,value:'Synthetic supplied site',evidence:'Synthetic verified site'};
  input.unitSummary=' Synthetic source summary ';input.departmentAssignments=[{department:'it',...assigned('it.source')}];
  const body=project(input);assert.equal((await accept(db,body)).state,'created');
  for (const job of await rows(db)) {
    assert.equal(job.assignee_user_id,job.assigned_role==='it'?it:service);assert.equal(job.assignment_scope,'technician');
    assert.equal(job.job_description,input.description.value);assert.equal(job.notes,input.notes);assert.equal(job.site,input.site.value);
    // Existing SQL normalizes the optional unit summary; original instruction and note strings above stay exact.
    assert.equal(job.unit_summary,input.unitSummary.trim());assert.equal(job.scheduled_time,null);
  }
});

test('minimal missing-note/schedule/identity candidates persist then enrich without overwriting first observation',async()=>{
  for (const remove of [p=>{delete p.notes;},p=>{delete p.schedule;},p=>{delete p.source.assignment;}]) {
    const db=await fixture({type:'delivery'}),input=facts();remove(input);const first=project(input);
    assert.deepEqual(first,minimum(input));assert.equal((await accept(db,first)).state,'review_needed');
    const complete=project();assert.equal((await accept(db,complete)).state,'created');
    const saved=(await receipt(db))[0];assert.deepEqual(saved.first_payload,first);assert.deepEqual(saved.candidate_payload,complete);
    assert.equal((await rows(db)).length,2);
  }
});

test('private SQL authority still holds unresolved mapping, route/status conflicts and current profile changes',async()=>{
  const changes=["delete from cos_mhelp_intake.identity_crosswalk where source_identity='service.source'",
    "update cos_mhelp_intake.identity_crosswalk set enabled=false where source_identity='service.source'",
    `update public.profiles set active=false where user_id='${service}'`,
    `update public.profiles set archived_at=now() where user_id='${service}'`,
    `update public.profiles set role='it' where user_id='${service}'`,
    `update cos_mhelp_intake.identity_crosswalk set reviewed_by='${it}'`,
    "update cos_mhelp_intake.type_mappings set work_type='pickup'",
    "update cos_mhelp_intake.source_status_policies set classification='terminal'",
    `update public.profiles set active=false where user_id='${owner}'`];
  for (const change of changes) {
    const db=await fixture({type:'delivery'}),body=project();await db.exec(change);
    assert.equal((await accept(db,body)).state,'review_needed',change);assert.equal((await rows(db)).length,0);
    assert.deepEqual((await receipt(db))[0].candidate_payload,body);
  }
  const db=await fixture({type:'delivery'}),input=facts();input.source.assignment.identities=['Service.Source'];
  assert.equal((await accept(db,project(input))).state,'review_needed');assert.equal((await rows(db)).length,0);
});

test('writer errors roll back projected candidate, work and trigger audit atomically',async()=>{
  const db=await fixture({type:'delivery'}),input=facts();delete input.schedule;const first=project(input);await accept(db,first);
  const before=(await receipt(db))[0];
  await db.exec(`create function public.synthetic_projection_failure() returns trigger language plpgsql as $$begin
    if new.assigned_role='service' then raise exception 'Synthetic projected second-target failure';end if;return new;end$$;
    create trigger synthetic_projection_failure before insert on public.job_assignments for each row execute function public.synthetic_projection_failure();`);
  await assert.rejects(accept(db,project()),/Synthetic projected second-target failure/);
  assert.deepEqual((await receipt(db))[0],before);assert.equal((await rows(db)).length,0);
  assert.equal((await db.query('select count(*)::int n from public.workflow_checkpoints')).rows[0].n,0);
});

test('future injected adapter can carry both ready and minimum projections through the bounded runtime without registering production access',async()=>{
  const complete=facts(),pending=facts();pending.source.ticketId='43';pending.source.ticketNumber='000043';delete pending.schedule;
  const policy={...scope,state:'ready',schemaEvidence:'Synthetic schema proof',typeMappingsVerified:true,identityMappingsVerified:false,statusPoliciesVerified:true};
  delete policy.createdAfter;delete policy.createdBefore;
  let reads=0;
  const read=createBoundedMhelpSource({
    getPolicy:async()=>policy,
    adapterFor:()=>({schemaContract:policy.schemaContract,schemaEvidence:policy.schemaEvidence,
      readPage:async()=>{reads++;return {totalRows:2,rows:[complete,pending]};},
      projectTicket:(normalized,authority)=>projectMhelpSourceShell(normalized,{...config(),portalId:authority.portalId,schemaContract:authority.schemaContract}),
    }),
    now:()=>Date.parse('2026-10-10T00:10:00Z'),
  });
  const result=await read({createdAfter:scope.createdAfter,createdBefore:scope.createdBefore},new AbortController().signal);
  assert.equal(reads,1);assert.equal(result.totalRows,2);assert.equal(result.partial,false);
  assert.deepEqual(result.tickets,[project(complete),minimum(pending)]);
  assert.deepEqual(APPROVED_OPERATIONAL_ADAPTERS,{});assert.equal(productionAdapterFor(policy),null);
});

test('projection stays inactive, side-effect-free and absent from the empty production adapter registry',()=>{
  assert.deepEqual(APPROVED_OPERATIONAL_ADAPTERS,{});assert.equal(productionAdapterFor({...scope,state:'ready'}),null);
  const source=readFileSync(new URL('../intake/mhelpSourceShellProjection.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\bfetch\s*\(|\.rpc\s*\(|\.from\s*\(|Date\.now\s*\(|randomUUID\s*\(|console\./);
  assert.doesNotMatch(source,/identityCrosswalk|legacyUserId|legacyProjectId|nativeMhelpTokens|Deno\.env|process\.env/);
  const registry=readFileSync(new URL('../intake/mhelpIntakeSource.ts',import.meta.url),'utf8');
  assert.doesNotMatch(registry,/mhelpSourceShellProjection/);
});

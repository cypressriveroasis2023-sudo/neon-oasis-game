import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  LEGACY_PART_FIELDS, LEGACY_TECH_CHECK_PROJECT, TECHNICIAN_EQUIPMENT_SELECTION_POLICY, planMhelpLegacyRoute,
} from '../shared/mhelpLegacyRoutePlan.ts';
import {prepareMhelpLegacyIntake} from '../legacy/mhelpIntakeAdapter.ts';

// Synthetic only. Never use production notes, names, identities or ticket text.
const service = '11111111-1111-4111-8111-111111111111';
const it = '22222222-2222-4222-8222-222222222222';
const assigned = identity => ({state:'assigned',identities:[identity],evidence:'Synthetic exact source appointment assignment'});
const unassigned = () => ({state:'unassigned',identities:[],evidence:'Synthetic explicit empty department assignment'});
const identity = (sourceIdentity='source.service',department='service',legacyUserId=service) => ({
  portalId:'17',sourceIdentity,legacyProjectId:LEGACY_TECH_CHECK_PROJECT,legacyUserId,
  department,active:true,archived:false,verified:true,evidence:'Synthetic reviewed same-person profile mapping',
});
function fixture(workType='delivery') {
  return {
    localWorkflowPolicy:{policy:TECHNICIAN_EQUIPMENT_SELECTION_POLICY},
    source:{portalId:'17',ticketId:'42',ticketNumber:'SYN-42',typeId:'5',statusId:'source-open',customStatusId:null,deleted:false,
      assignment:assigned('source.service')},
    typeMappings:[{portalId:'17',typeId:'5',workType,reviewed:true,evidence:'Synthetic reviewed exact source type'}],
    identityCrosswalk:[identity()],
    description:{reviewed:true,value:'  Synthetic work instructions.\nPreserve spacing.  ',evidence:'Synthetic verified original source instruction fields'},
    notes:'  Synthetic original notes.\n\tKeep this text exactly.  ',
    schedule:{reviewed:true,date:'2026-10-12',time:'09:30',evidence:'Synthetic verified appointment date and local time'},
    unitSummary:'',
  };
}
const options = () => ({createdAt:'2026-10-10T01:02:03.000Z',schemaContract:'synthetic-verified-v1'});
const blocked = (input, reason) => {
  const result=planMhelpLegacyRoute(input);
  assert.equal(result.state,'review_needed');
  assert.equal(result.request,null);
  assert(result.reasonCodes.includes(reason),`${reason}: ${result.reasonCodes.join(',')}`);
  const prepared=prepareMhelpLegacyIntake(input,options());
  assert.equal(prepared.state,'review_needed');assert.equal(prepared.payload,null);
};

test('deferred Delivery/Swap preserve scheduled Service identity and derive only a local IT queue',()=>{
  for (const type of ['delivery','swap']) {
    const input=fixture(type),before=structuredClone(input),plan=planMhelpLegacyRoute(input);
    assert.equal(plan.state,'ready');assert.deepEqual(plan.reasonCodes,[]);
    assert.deepEqual(plan.request.p_request.targets,[
      {role:'it',assignee_user_id:null,requires_it_handoff:false},
      {role:'service',assignee_user_id:service,requires_it_handoff:true},
    ]);
    assert.deepEqual(plan.targetProvenance,[{role:'it',kind:'local_workflow_queue'},{role:'service',kind:'source_assignment'}]);
    assert.equal(plan.firstDepartment,'it');assert.equal(plan.intakeRequired,type==='swap');
    assert.equal(plan.ticketLead,'not_assigned_by_plan');assert.equal(plan.executionEnabled,false);
    assert.deepEqual(input,before);
  }
});

test('deferred Service is a field-work shell without a source-confirmed no-prep assertion',()=>{
  const input=fixture('service'),plan=planMhelpLegacyRoute(input),prepared=prepareMhelpLegacyIntake(input,options());
  assert.equal(plan.state,'ready');assert.deepEqual(plan.request.p_request.targets,[{role:'service',assignee_user_id:service,requires_it_handoff:false}]);
  assert.deepEqual(plan.targetProvenance,[{role:'service',kind:'source_assignment'}]);
  assert.equal(prepared.payload.sourceEvidence.complete,false);
  assert.equal(Object.hasOwn(prepared.payload.sourceEvidence,'equipment'),false);
  assert.equal(Object.hasOwn(prepared.payload.sourceEvidence,'parts'),false);
  assert.deepEqual(prepared.payload.localWorkflowPolicy,{policy:TECHNICIAN_EQUIPMENT_SELECTION_POLICY});
});

test('deferred Pickup is Service-first with unknown quantity and no manufactured completion',()=>{
  const input=fixture('pickup'),plan=planMhelpLegacyRoute(input);
  assert.equal(plan.state,'ready');assert.equal(plan.intakeRequired,true);
  assert.deepEqual(plan.request.p_request.targets,[
    {role:'service',assignee_user_id:service,requires_it_handoff:false},
    {role:'it',assignee_user_id:null,requires_it_handoff:false},
  ]);
  assert.equal(plan.request.p_request.requested_unit_count,null);
  for (const key of ['status','started_at','completed_at','claimed_at','prep_ticket_id','return_equipment_manifest']) assert.equal(Object.hasOwn(plan.request.p_request,key),false);
  // Completion is deliberately left to the unchanged legacy return/count gates.
  assert.equal(plan.executionEnabled,false);
});

test('deferred envelope preserves original instructions, real schedule and nullable shell fields',()=>{
  const input=fixture(),prepared=prepareMhelpLegacyIntake(input,options());
  assert.equal(prepared.state,'ready');assert.equal(prepared.executionEnabled,false);
  const p=prepared.payload;
  assert.equal(p.request.site,null);assert.equal(p.request.requested_unit_count,null);assert.deepEqual(p.request.equipment_manifest,[]);
  assert.equal(p.request.job_description,input.description.value);assert.equal(p.request.notes,input.notes);
  assert.equal(p.request.scheduled_for,input.schedule.date);assert.equal(p.request.scheduled_time,input.schedule.time);
  for (const key of LEGACY_PART_FIELDS) assert.equal(p.request[key],0);
  assert.deepEqual(p.source.assignment,input.source.assignment);assert.deepEqual(p.departmentAssignments,[]);
  assert.equal(Object.hasOwn(p,'ticketLead'),false);assert.equal(Object.hasOwn(p,'targetProvenance'),false);
  assert.deepEqual(p.sourceEvidence,{description:input.description.evidence,schedule:input.schedule.evidence,complete:false});
  p.source.assignment.identities.push('changed');p.localWorkflowPolicy.policy='changed';
  assert.deepEqual(input.source.assignment.identities,['source.service']);assert.equal(input.localWorkflowPolicy.policy,TECHNICIAN_EQUIPMENT_SELECTION_POLICY);
});

test('optional site and notes-only instructions do not fabricate a description or location',()=>{
  for (const site of [undefined,null]) {
    const input=fixture();input.site=site;input.description.value='';
    const p=prepareMhelpLegacyIntake(input,options()).payload;
    assert(p);assert.equal(p.request.site,null);assert.equal(p.request.job_description,'');assert.equal(p.request.notes,input.notes);
  }
  const input=fixture();input.site={reviewed:true,value:'Synthetic existing site',evidence:'Synthetic verified site field'};
  let p=prepareMhelpLegacyIntake(input,options()).payload;
  assert.equal(p.request.site,input.site.value);assert.equal(p.sourceEvidence.site,input.site.evidence);
  input.site.reviewed=false;blocked(input,'site_review_required');
  const blank=fixture();blank.description.value=' \n ';blank.notes='\t ';blocked(blank,'description_review_required');
});

test('policy requires an exact fixed marker and rejects mixed structured scope even when empty',()=>{
  for (const value of [null,undefined,[],true,'technician_equipment_selection_v1',{}, {policy:'other'},
    {policy:TECHNICIAN_EQUIPMENT_SELECTION_POLICY,approved:true},
    {policy:TECHNICIAN_EQUIPMENT_SELECTION_POLICY,legacyUserId:it}]) {
    const input=fixture();input.localWorkflowPolicy=value;blocked(input,'local_workflow_policy_invalid');
  }
  for (const key of ['equipment','parts']) for (const value of [undefined,null,{},[],{complete:true,items:[]}]) {
    const input=fixture();input[key]=value;blocked(input,'deferred_scope_conflict');
  }
});

test('deferred shell requires a verified actual scheduled assignee and never guesses identity',()=>{
  for (const fact of [undefined,null,unassigned(),{state:'unknown',identities:[],evidence:'Synthetic unknown assignment'}]) {
    const input=fixture();input.source.assignment=fact;blocked(input,'scheduled_assignee_required');
  }
  for (const change of [{legacyProjectId:'other'},{legacyUserId:'fake'},{active:false},{archived:true},{verified:false},{evidence:''}]) {
    const input=fixture();Object.assign(input.identityCrosswalk[0],change);blocked(input,'assignee_identity_unverified');
  }
  const missing=fixture();missing.identityCrosswalk=[];blocked(missing,'assignee_identity_unmatched');
  const duplicate=fixture();duplicate.identityCrosswalk.push(identity());blocked(duplicate,'assignee_identity_ambiguous');
  const multi=fixture();multi.source.assignment.identities.push('second.person');blocked(multi,'source_assignment_ambiguous');
});

test('scheduled IT identity is retained only on IT and Service gets a local counterpart queue',()=>{
  const input=fixture();input.source.assignment=assigned('source.it');input.identityCrosswalk=[identity('source.it','it',it)];
  const plan=planMhelpLegacyRoute(input);
  assert.equal(plan.state,'ready');assert.deepEqual(plan.request.p_request.targets,[
    {role:'it',assignee_user_id:it,requires_it_handoff:false},{role:'service',assignee_user_id:null,requires_it_handoff:true},
  ]);
  assert.deepEqual(plan.targetProvenance,[{role:'it',kind:'source_assignment'},{role:'service',kind:'local_workflow_queue'}]);
  input.typeMappings[0].workType='service';blocked(input,'source_assignee_not_routed');
});

test('genuine department facts stay separate and contradictory/unknown facts cannot become local queues',()=>{
  const input=fixture();input.departmentAssignments=[{department:'it',...unassigned()}];
  const plan=planMhelpLegacyRoute(input),p=prepareMhelpLegacyIntake(input,options()).payload;
  assert.equal(plan.state,'ready');assert.deepEqual(plan.targetProvenance[0],{role:'it',kind:'source_department_queue'});
  assert.deepEqual(p.departmentAssignments,input.departmentAssignments);
  input.departmentAssignments[0]={department:'it',state:'unknown',identities:[],evidence:'Synthetic unknown department'};
  blocked(input,'department_assignment_unknown');
  input.departmentAssignments=[{department:'service',...unassigned()}];blocked(input,'source_assignee_not_routed');
  input.departmentAssignments=[{department:'service',...assigned('different.person')}];input.identityCrosswalk.push(identity('different.person','service',it));
  blocked(input,'source_assignee_not_routed');
});

test('malformed or unresolved unrouted department facts are never discarded by deferred preparation',()=>{
  for (const fact of [{department:'it'}, {department:'it',state:'assigned',identities:'person',evidence:'Synthetic malformed fact'},
    {department:'it',state:'unassigned',identities:[],evidence:''}]) {
    const input=fixture('service');input.departmentAssignments=[fact];blocked(input,'department_assignment_invalid');
  }
  const unknown=fixture('service');unknown.departmentAssignments=[{department:'it',state:'unknown',identities:[],evidence:'Synthetic unknown fact'}];
  blocked(unknown,'department_assignment_unknown');
  const duplicate=fixture('service');duplicate.departmentAssignments=[{department:'it',...unassigned()},{department:'it',...unassigned()}];
  blocked(duplicate,'department_assignment_ambiguous');
});

test('reviewed explicit second-department technician remains assigned without inventing a Ticket Lead',()=>{
  const input=fixture();input.departmentAssignments=[{department:'it',...assigned('source.it')}];input.identityCrosswalk.push(identity('source.it','it',it));
  const plan=planMhelpLegacyRoute(input),p=prepareMhelpLegacyIntake(input,options()).payload;
  assert.equal(plan.state,'ready');assert.equal(plan.request.p_request.targets[0].assignee_user_id,it);
  assert.deepEqual(plan.targetProvenance,[{role:'it',kind:'source_assignment'},{role:'service',kind:'source_assignment'}]);
  assert.equal(Object.hasOwn(p,'ticketLead'),false);
  input.identityCrosswalk[1].legacyUserId=service;blocked(input,'assignee_department_identity_conflict');
});

test('deferred mode never defaults a missing/unreviewed work date or time',()=>{
  for (const change of [{date:''},{date:null},{date:'2026-02-29'},{time:undefined},{time:'25:00'},{reviewed:false},{evidence:''}]) {
    const input=fixture();Object.assign(input.schedule,change);blocked(input,'schedule_review_required');
  }
  const input=fixture();input.schedule.time=null;
  assert.equal(planMhelpLegacyRoute(input).request.p_request.scheduled_time,null);
});

test('source type remains authoritative and unknown aliases or known review conflicts remain held',()=>{
  const input=fixture('service');input.notes='Synthetic wording mentioning delivery; do not parse prose into routing.';
  assert.equal(planMhelpLegacyRoute(input).request.p_request.work_type,'service');
  input.typeMappings[0].reviewed=false;blocked(input,'type_mapping_unverified');
  input.typeMappings[0].reviewed=true;input.typeMappings[0].workType='Installation';blocked(input,'type_mapping_unverified');
  input.typeMappings=[];blocked(input,'type_mapping_missing');
});

test('optional lead never bypasses exact same-person validation or old local-lead restrictions',()=>{
  const input=fixture();input.identityCrosswalk.push(identity('source.it','it',it));
  const lead={sourceIdentity:'source.it',evidence:'Synthetic deliberately selected existing IT lead'};
  const p=prepareMhelpLegacyIntake(input,{...options(),ticketLead:lead}).payload;
  assert.deepEqual(p.ticketLead,lead);
  for (const ticketLead of [null,{}, {sourceIdentity:'source.service',evidence:'Synthetic wrong department'},
    {policy:'reviewed_local_unassigned_v1'}]) {
    const result=prepareMhelpLegacyIntake(input,{...options(),ticketLead});
    assert.equal(result.state,'review_needed');assert.equal(result.payload,null);
  }
});

test('no-policy source-complete mode keeps its old shape and mandatory scope/lead checks',()=>{
  const input=fixture('service');delete input.localWorkflowPolicy;
  input.source.assignment=unassigned();input.site={reviewed:true,value:'Synthetic site',evidence:'Synthetic verified site'};
  input.equipment={complete:true,reviewed:true,evidence:'Synthetic complete equipment',items:[]};
  input.parts={complete:true,reviewed:true,evidence:'Synthetic complete parts',quantities:Object.fromEntries(LEGACY_PART_FIELDS.map(key=>[key,0]))};
  input.identityCrosswalk.push(identity('source.it','it',it));
  const plan=planMhelpLegacyRoute(input);
  assert.equal(plan.state,'ready');assert.equal(plan.request.p_request.requested_unit_count,0);
  assert.equal(Object.hasOwn(plan,'localWorkflowPolicy'),false);assert.equal(Object.hasOwn(plan,'targetProvenance'),false);
  assert.equal(prepareMhelpLegacyIntake(input,options()).state,'review_needed');
  const p=prepareMhelpLegacyIntake(input,{...options(),ticketLead:{sourceIdentity:'source.it',evidence:'Synthetic verified lead'}}).payload;
  assert.equal(p.sourceEvidence.complete,true);assert.equal(Object.hasOwn(p,'localWorkflowPolicy'),false);
  delete input.equipment;blocked(input,'equipment_scope_incomplete');
});

test('pure shell planning/preparation exposes no execution, clock, identity or workflow mutation',()=>{
  for (const path of ['../shared/mhelpLegacyRoutePlan.ts','../legacy/mhelpIntakeAdapter.ts']) {
    const source=readFileSync(new URL(path,import.meta.url),'utf8');
    assert.doesNotMatch(source,/\bfetch\s*\(|\.rpc\s*\(|\.from\s*\(|Date\.now\s*\(|randomUUID\s*\(/);
  }
});

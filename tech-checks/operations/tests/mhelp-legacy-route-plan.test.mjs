import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LEGACY_PART_FIELDS, LEGACY_TECH_CHECK_PROJECT, planMhelpLegacyRoute,
} from '../shared/mhelpLegacyRoutePlan.ts';

const user = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
function fixture(type = 'service') {
  return {
    source: {portalId:'17', ticketId:'42', ticketNumber:'000042', typeId:'5', statusId:'closed-source-status', customStatusId:null, deleted:false,
      assignment:{state:'unassigned',identities:[],evidence:'Verified vendor assignedTo is explicitly null'}},
    typeMappings:[{portalId:'17',typeId:'5',workType:type,reviewed:true,evidence:'Reviewed vendor type dictionary; explicit business mapping'}],
    identityCrosswalk:[],
    site:{value:'Fixture site',reviewed:true,evidence:'Reviewed exact source site'},
    description:{value:'Fixture work instruction',reviewed:true,evidence:'Reviewed source description'},
    schedule:{date:'2026-10-12',time:null,reviewed:true,evidence:'Reviewed source local work date; source explicitly has no time'},
    equipment:{complete:true,reviewed:true,evidence:'Reviewed all source equipment lines',items:type==='service'?[]:[{category:'device',label:'Sniper',qty:2}]},
    parts:{complete:true,reviewed:true,evidence:'Reviewed all source part lines',quantities:Object.fromEntries(LEGACY_PART_FIELDS.map(key=>[key,0]))},
    notes:'',unitSummary:'',
  };
}
function person(identity = 'vendor.tech', department = 'service', userId = user) {
  return {portalId:'17',sourceIdentity:identity,legacyProjectId:LEGACY_TECH_CHECK_PROJECT,legacyUserId:userId,
    department,active:true,archived:false,verified:true,evidence:'Verified same-person legacy profile and exact vendor identity'};
}
const assigned = (identity='vendor.tech') => ({state:'assigned',identities:[identity],evidence:'Exact explicit source assignment'});
const unassigned = () => ({state:'unassigned',identities:[],evidence:'Explicit source department assignment is empty'});
const blocked = (value, reason) => {
  const plan=planMhelpLegacyRoute(value);
  assert.equal(plan.state,'review_needed'); assert.equal(plan.request,null);
  assert.ok(plan.reasonCodes.includes(reason),`${reason}: ${plan.reasonCodes.join(', ')}`);
  assert.equal(plan.executionEnabled,false);
  return plan;
};

test('service-only proposal has the exact existing Owner bundle shape and preserves vendor facts separately', () => {
  const input=fixture(), before=structuredClone(input), result=planMhelpLegacyRoute(input);
  assert.equal(result.state,'ready');
  assert.deepEqual(result.reasonCodes,[]);
  assert.deepEqual(result.request,{p_request:{ticket_no:'000042',site:'Fixture site',work_type:'service',
    targets:[{role:'service',assignee_user_id:null,requires_it_handoff:false}],requested_unit_count:0,unit_summary:'',
    job_description:'Fixture work instruction',notes:'',equipment_manifest:[],scheduled_for:'2026-10-12',scheduled_time:null,
    ...input.parts.quantities}});
  assert.equal(result.originalSource.statusId,'closed-source-status');
  assert.equal(result.originalSource.assignment.state,'unassigned');
  assert.equal(result.firstDepartment,'service'); assert.equal(result.intakeRequired,false);
  assert.equal(result.executionEnabled,false); assert.equal(result.requiresAtomicDuplicateCheck,true);
  assert.equal(result.ticketLead,'not_assigned_by_plan');
  assert.ok(!JSON.stringify(result.request).includes('completed'));
  assert.deepEqual(input,before);
});

test('reviewed install mapping uses delivery; delivery/swap route IT first and pickup routes Service first', () => {
  for (const type of ['delivery','swap','pickup']) {
    const plan=planMhelpLegacyRoute(fixture(type));
    assert.equal(plan.state,'ready',type);
    assert.deepEqual(plan.request.p_request.targets,type==='pickup'?
      [{role:'service',assignee_user_id:null,requires_it_handoff:false},{role:'it',assignee_user_id:null,requires_it_handoff:false}]:
      [{role:'it',assignee_user_id:null,requires_it_handoff:false},{role:'service',assignee_user_id:null,requires_it_handoff:true}]);
    assert.equal(plan.intakeRequired,type!=='delivery');
    assert.equal(plan.ticketLead,'requires_verified_it_lead');
    assert.equal(plan.request.p_request.requested_unit_count,2);
    assert.ok(!('prep_ticket_id' in plan.request.p_request));
  }
});

test('service explicitly requiring equipment or any supported part routes IT before Service', () => {
  for (const field of [...LEGACY_PART_FIELDS,'equipment']) {
    const input=fixture();
    if (field==='equipment') input.equipment.items=[{category:'stand',label:'Pole',qty:1}];
    else input.parts.quantities[field]=1;
    const result=planMhelpLegacyRoute(input);
    assert.equal(result.state,'ready'); assert.equal(result.firstDepartment,'it');
    assert.deepEqual(result.request.p_request.targets.map(row=>row.requires_it_handoff),[false,true]);
    assert.equal(result.request.p_request.requested_unit_count,0);
  }
});

test('missing or incomplete scope never turns Service into no-prep work', () => {
  for (const part of ['equipment','parts']) {
    for (const change of [{complete:false},{reviewed:false},{evidence:''}]) {
      const input=fixture(); Object.assign(input[part],change);
      blocked(input,part+'_scope_incomplete');
    }
  }
  const input=fixture(); delete input.parts.quantities.micro_sd_qty;
  blocked(input,'part_quantity_invalid_or_missing');
});

test('all four types require explicit reviewed portal-specific type ID mapping; never infer labels', () => {
  const input=fixture(); input.source.typeName='Install'; input.typeMappings=[];
  blocked(input,'type_mapping_missing');
  for (const change of [{portalId:'other'},{typeId:'other'},{workType:'install'},{reviewed:false},{evidence:''}]) {
    const next=fixture(); Object.assign(next.typeMappings[0],change);
    blocked(next,change.portalId||change.typeId?'type_mapping_missing':'type_mapping_unverified');
  }
  const duplicate=fixture(); duplicate.typeMappings.push({...duplicate.typeMappings[0]});
  blocked(duplicate,'type_mapping_ambiguous');
});

test('non-service types require supported explicitly counted equipment; unknown labels and counts stay visible', () => {
  for (const type of ['delivery','swap','pickup']) {
    const input=fixture(type); input.equipment.items=[]; blocked(input,'equipment_required');
  }
  for (const change of [{label:'Mystery camera'},{label:'Solar Pole'},{category:'stand'},{qty:0},{qty:-1},{qty:1.5},{qty:'2'},{qty:1000001},{qty:Infinity}]) {
    const input=fixture('delivery'); Object.assign(input.equipment.items[0],change); blocked(input,'equipment_item_unsupported');
  }
  const duplicate=fixture('delivery'); duplicate.equipment.items.push({...duplicate.equipment.items[0]});
  blocked(duplicate,'equipment_quantity_ambiguous');
});

test('devices and stands count separately and existing automatic Solar Spotter guard remains intact', () => {
  const input=fixture('delivery'); input.equipment.items.push({category:'stand',label:'Pole',qty:3});
  assert.equal(planMhelpLegacyRoute(input).request.p_request.requested_unit_count,2);
  input.equipment.items=[{category:'device',label:'Solar Spotter',qty:1},{category:'stand',label:'Solar Stand',qty:1}];
  blocked(input,'automatic_service_solar_stand_conflict');
});

test('one exact active verified same-person legacy crosswalk produces only the verified ID', () => {
  const input=fixture(); input.source.assignment=assigned(); input.identityCrosswalk=[person()];
  const result=planMhelpLegacyRoute(input);
  assert.equal(result.state,'ready');
  assert.deepEqual(result.request.p_request.targets,[{role:'service',assignee_user_id:user,requires_it_handoff:false}]);
  assert.ok(!JSON.stringify(result.request).includes('vendor.tech'));
  result.originalSource.assignment.identities.push('changed');
  assert.deepEqual(input.source.assignment.identities,['vendor.tech']);
});

test('name guessing, wrong portal/project, inactive users and ambiguous/multi-person mappings block', () => {
  for (const change of [{sourceIdentity:'Vendor.Tech'},{portalId:'other'},{legacyProjectId:'native-project'},{legacyUserId:'fake'},
    {active:false},{archived:true},{verified:false},{evidence:''}]) {
    const input=fixture(); input.source.assignment=assigned(); input.identityCrosswalk=[{...person(),...change}];
    blocked(input,change.sourceIdentity||change.portalId?'assignee_identity_unmatched':'assignee_identity_unverified');
  }
  const input=fixture(); input.source.assignment=assigned(); input.identityCrosswalk=[person(),person('vendor.tech','service',other)];
  blocked(input,'assignee_identity_ambiguous');
  input.source.assignment.identities.push('second.person'); blocked(input,'source_assignment_ambiguous');
});

test('missing/unknown assignment never defaults to a department queue', () => {
  for (const assignment of [undefined,null,{state:'unknown',identities:[],evidence:'Missing field'},{state:'unassigned',identities:[]}]) {
    const input=fixture(); input.source.assignment=assignment; blocked(input,'source_assignment_unknown');
  }
  const contradictory=fixture(); contradictory.source.assignment.identities=['vendor.tech'];
  blocked(contradictory,'source_assignment_unknown');
});

test('assigned dual-department ticket cannot invent the other department owner or queue', () => {
  const input=fixture('delivery'); input.source.assignment=assigned(); input.identityCrosswalk=[person()];
  blocked(input,'department_assignee_unresolved');
  input.departmentAssignments=[{department:'it',...unassigned()}];
  const result=planMhelpLegacyRoute(input);
  assert.equal(result.state,'ready');
  assert.deepEqual(result.request.p_request.targets,[
    {role:'it',assignee_user_id:null,requires_it_handoff:false},
    {role:'service',assignee_user_id:user,requires_it_handoff:true},
  ]);
  input.departmentAssignments.push({department:'it',...unassigned()}); blocked(input,'department_assignment_ambiguous');
});

test('department facts cannot silently drop or replace the original source assignee', () => {
  const input=fixture(); input.source.assignment=assigned(); input.identityCrosswalk=[person(),person('other.person','service',other)];
  input.departmentAssignments=[{department:'service',...unassigned()}];
  blocked(input,'source_assignee_not_routed');
  input.departmentAssignments=[{department:'service',...assigned('other.person')}];
  blocked(input,'source_assignee_not_routed');
  const unclaimed=fixture(); unclaimed.identityCrosswalk=[person()]; unclaimed.departmentAssignments=[{department:'service',...assigned()}];
  blocked(unclaimed,'source_department_assignment_conflict');
});

test('contradictory dual-role crosswalks and assigned departments absent from route require review', () => {
  const input=fixture('delivery'); input.source.assignment=assigned();
  input.identityCrosswalk=[person(),person('it.person','it',user)];
  input.departmentAssignments=[{department:'it',...assigned('it.person')}];
  blocked(input,'assignee_department_identity_conflict');
  const service=fixture(); service.departmentAssignments=[{department:'it',...assigned('it.person')}];
  blocked(service,'assignment_for_unrouted_department');
});

test('reviewed multiline instructions and notes retain their original content', () => {
  const input=fixture(); input.description.value='First recorded instruction.\nSecond recorded instruction.';
  input.notes='Line one\nLine two\tRecorded detail';
  const result=planMhelpLegacyRoute(input);
  assert.equal(result.state,'ready');
  assert.equal(result.request.p_request.job_description,input.description.value);
  assert.equal(result.request.p_request.notes,input.notes);
});

test('site, description and local schedule need review and exact valid dates; no today/time defaults', () => {
  for (const field of ['site','description','schedule']) {
    const input=fixture(); input[field].reviewed=false; blocked(input,field+'_review_required');
  }
  for (const change of [{date:''},{date:'2026-02-29'},{date:'2026-13-01'},{date:'2026-04-31'},
    {date:'2026-10-12T03:00:00Z'},{time:undefined},{time:'25:00'},{time:'12:60'},{time:'08:30Z'},{time:'08:30-05:00'}]) {
    const input=fixture(); Object.assign(input.schedule,change); blocked(input,'schedule_review_required');
  }
  const leap=fixture(); Object.assign(leap.schedule,{date:'2028-02-29',time:'23:59:59'});
  assert.equal(planMhelpLegacyRoute(leap).request.p_request.scheduled_time,'23:59:59');
});

test('source deletion and incomplete identities block; retained statuses never imply check completion', () => {
  const deleted=fixture(); deleted.source.deleted=true; blocked(deleted,'source_ticket_deleted');
  for (const field of ['portalId','ticketId','ticketNumber','typeId','statusId','customStatusId','deleted']) {
    const input=fixture(); delete input.source[field]; blocked(input,'source_identity_or_status_incomplete');
  }
  for (const status of ['Closed','Cancelled','Completed','Unrecognized status']) {
    const input=fixture(); input.source.statusId=status;
    const result=planMhelpLegacyRoute(input); assert.equal(result.originalSource.statusId,status);
    assert.ok(!('status' in result.request.p_request));
    assert.equal(result.executionEnabled,false);
  }
});

test('malformed inputs safely require review rather than throwing or forwarding arbitrary fields', () => {
  for (const value of [undefined,null,[],5,'raw ticket',{}, {source:{assignment:{identities:'name'}}}]) {
    assert.equal(planMhelpLegacyRoute(value).state,'review_needed');
  }
  const input=fixture(); input.completed_by=user; input.source.privateComment='not part of projection';
  const result=planMhelpLegacyRoute(input);
  assert.ok(!JSON.stringify(result).includes('privateComment')); assert.ok(!JSON.stringify(result).includes('completed_by'));
});

test('planner has no external calls, clock guesses, random identities, or mutation capabilities', () => {
  const source=readFileSync(new URL('../shared/mhelpLegacyRoutePlan.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\bfetch\s*\(|\.rpc\s*\(|\.from\s*\(|Date\.now\s*\(|new Date\s*\(|randomUUID\s*\(/);
});

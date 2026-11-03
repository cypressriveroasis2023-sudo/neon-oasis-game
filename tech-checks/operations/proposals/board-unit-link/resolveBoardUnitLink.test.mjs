import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveBoardUnitLink,appendBoardUnitLinks,savedBoardJob} from './resolveBoardUnitLink.ts';
import {fixture,ORG,OTHER,JOB,UNIT,ASSIGN,VISIT,TASK,TRACKER,ASOF,OBS,HASH,PID} from './fixtures.mjs';
const resolve=e=>resolveBoardUnitLink('job',{id:JOB,equipmentUnitTag:'Not an identity'},e);
function fail(reason,mutate){const e=fixture();mutate(e);assert.deepEqual(resolve(e),{contract:'COS_BOARD_UNIT_LINK_V1',state:'not_linked',reason});}
test('links exact saved assignment to reviewed Product ID despite different human labels',()=>{
 const result=resolve(fixture());assert.equal(result.state,'linked');assert.equal(result.unitId,UNIT);assert.equal(result.productId,PID);
 assert.equal(result.assignmentId,ASSIGN);assert.equal(result.sourceSha256,HASH);assert.equal(result.basis,'current_job_assignment');
 assert.equal(result.assignmentAsOf,ASOF);assert.equal(result.productObservedAt,OBS);assert.equal('cameraStatus' in result,false);
});
test('zero assignments stays unlinked, regardless of tag, IP, or record-supplied unit ID',()=>{
 const e=fixture();e.assignments.items=[];const result=resolveBoardUnitLink('job',{id:JOB,unitId:UNIT,productId:PID,equipmentUnitTag:'Synthetic unit',ip:'192.0.2.1'},e);
 assert.deepEqual(result,{contract:'COS_BOARD_UNIT_LINK_V1',state:'not_linked',reason:'no_saved_assignment'});
});
test('duplicate active assignments to the same unit are not silently collapsed',()=>fail('multiple_saved_assignments',e=>e.assignments.items.push({...e.assignments.items[0],assignmentId:OTHER})));
test('duplicate assignment IDs invalidate the assignment snapshot',()=>fail('invalid_assignment',e=>e.assignments.items.push({...e.assignments.items[0]})));
test('released active assignment is inconsistent, not current',()=>fail('invalid_assignment',e=>e.assignments.items[0].releasedAt=OBS));
test('cross-company unit relationship never produces an identifier',()=>fail('invalid_assignment',e=>{e.assignments.items[0].sameOrganization=false;e.assignments.items[0].unitId=null;}));
for(const part of ['assignments','fleet']){
 test(part+' tenant must match authenticated server context',()=>fail('scope_mismatch',e=>e[part].organizationId=OTHER));
 for(const state of ['stale','unavailable',undefined])test(part+' '+state+' disables link',()=>fail('source_unavailable',e=>e[part].readState=state));
 test(part+' future capture time is rejected without a freshness timer',()=>fail('evidence_mismatch',e=>e[part].asOf='2026-11-03T00:00:00Z'));
}
test('partial assignment snapshot is not treated as no assignment',()=>fail('source_unavailable',e=>e.assignments.complete=false));
test('job outside authorized assignment scope is rejected',()=>fail('scope_mismatch',e=>e.assignments.jobIds=[OTHER]));
test('unexpected rows outside query scope invalidate evidence',()=>fail('invalid_assignment',e=>e.assignments.items[0].jobId=OTHER));
test('future assignedAt is rejected',()=>fail('invalid_assignment',e=>e.assignments.items[0].assignedAt='2026-11-03T00:00:00Z'));
test('missing native unit does not fall back to a tracker or tag',()=>fail('unit_unavailable',e=>e.fleet.value.inventoryItems[0].id=TRACKER));
test('duplicate native inventory identities are rejected',()=>fail('unit_unavailable',e=>e.fleet.value.inventoryItems.push({...e.fleet.value.inventoryItems[0]})));
test('read-only tracker representation is not promoted to native job equipment',()=>fail('unit_unavailable',e=>e.fleet.value.inventoryItems[0].readOnly=true));
for(const status of ['retired','decommissioned','deleted','stolen'])test(status+' unit cannot link',()=>fail('unit_inactive',e=>e.assignments.items[0].unitStatus=status));
test('retirement timestamp is honored independently of status',()=>fail('unit_inactive',e=>e.assignments.items[0].retiredAt=OBS));
test('a repair-needed unit remains navigable; no health state is computed',()=>{
 const e=fixture();e.assignments.items[0].unitStatus='needs_repair';e.fleet.value.inventoryItems[0].status='needs_repair';assert.equal(resolve(e).state,'linked');
});
test('raw upload receipt is not a validated Fleet projection',()=>fail('source_unavailable',e=>e.fleet.value.uploadInventory.contract='COS_MHELP_API_V1'));
test('export-only data is not promoted to current API identity',()=>fail('source_unavailable',e=>e.fleet.value.uploadInventory.source='owner_supplied_mhelp_export'));
test('truncated Product census stays unavailable',()=>fail('source_unavailable',e=>e.fleet.value.uploadInventory.summary.totalRecords=2));
test('same Product ID repeated invalidates the census',()=>fail('product_binding_conflict',e=>{e.fleet.value.uploadInventory.records.push({...e.fleet.value.uploadInventory.records[0]});e.fleet.value.uploadInventory.summary.totalRecords=2;}));
test('another Product claiming the native unit is a conflict',()=>fail('product_binding_conflict',e=>{
 const other=structuredClone(e.fleet.value.uploadInventory.records[0]);other.productId='987654321';other.recordId='mhelp_product:987654321';
 e.fleet.value.uploadInventory.records.push(other);e.fleet.value.uploadInventory.summary.totalRecords=2;
}));
test('another held candidate claiming the native unit is also a conflict',()=>fail('product_binding_conflict',e=>{
 const other=structuredClone(e.fleet.value.uploadInventory.records[0]);other.productId='987654321';other.recordId='mhelp_product:987654321';other.binding.unitIds=[];other.binding.candidateUnitIds=[UNIT];other.binding.state='held';
 e.fleet.value.uploadInventory.records.push(other);e.fleet.value.uploadInventory.summary.totalRecords=2;
}));
test('no Product binding never falls back to a label',()=>fail('product_binding_missing',e=>e.fleet.value.uploadInventory.records[0].binding.unitIds=[TRACKER]));
for(const field of ['state','placementHeld','reason'])test('held binding '+field+' disables link',()=>fail('product_binding_held',e=>{e.fleet.value.uploadInventory.records[0].binding[field]=({state:'held',placementHeld:true,reason:'identity_guard_changed'})[field];}));
test('unapplied overlay cannot assert exact identity',()=>fail('product_binding_held',e=>e.fleet.value.uploadInventory.records[0].overlayApplied=false));
for(const method of ['exact_family_unit','archived_alias','owner_confirmed_alias'])test(method+' is not upgraded into reviewed Product ID proof',()=>fail('product_binding_not_reviewed',e=>e.fleet.value.uploadInventory.records[0].binding.matchMethod=method));
for(const status of ['DO_NOT_USE','MISSING'])test('Product '+status+' is unlinked',()=>fail('product_inactive',e=>e.fleet.value.uploadInventory.records[0].uploadLifecycle=status));
test('complete API missing list overrides a retained Product row',()=>fail('product_inactive',e=>e.fleet.value.uploadInventory.missingProductIds=[PID]));
for(const field of ['productId','sourceSha256','observedAt','source','state','evidenceKind'])test('mismatched native proof '+field+' fails closed',()=>fail('evidence_mismatch',e=>{
 e.fleet.value.inventoryItems[0].uploadPlacementEvidence[field]=({productId:'987654321',sourceSha256:'b'.repeat(64),observedAt:ASOF,source:'owner_supplied_mhelp_export',state:'unknown',evidenceKind:'derived_mapping'})[field];
}));
test('native identity hold stays unlinked',()=>fail('evidence_mismatch',e=>e.fleet.value.inventoryItems[0].placementStatus='needs_identity_review'));
test('completed visit links the current job assignment and never claims historical equipment',()=>{
 const record={id:`${JOB}:visit:${VISIT}`,jobId:JOB,visitId:VISIT,completionKind:'visit'};
 const out=resolveBoardUnitLink('job',record,fixture());assert.equal(out.state,'linked');assert.equal(out.recordContext,'completed_visit_current_job');
 assert.equal(savedBoardJob('job',{...record,jobId:OTHER}),null);assert.equal(savedBoardJob('job',{...record,jobId:undefined}),null);
});
test('task uses its exact related job, never the task or unit ID',()=>{
 const out=resolveBoardUnitLink('task',{id:TASK,relatedJobId:JOB},fixture());assert.equal(out.state,'linked');assert.equal(out.jobId,JOB);assert.equal(out.recordContext,'task_related_job');
 assert.equal(resolveBoardUnitLink('task',{id:TASK,unitId:UNIT},fixture()).reason,'invalid_record');
});
for(const id of [null,'', 'camera-22', ' '+JOB, JOB+' ', '00000000-0000-0000-0000-000000000000',`https://example.invalid/${JOB}`,`${JOB}:visit:${VISIT}`])
 test('rejects malformed job identity '+JSON.stringify(id),()=>assert.equal(resolveBoardUnitLink('job',{id},fixture()).reason,'invalid_record'));
test('record jobId disagreement fails closed',()=>assert.equal(resolveBoardUnitLink('job',{id:JOB,jobId:OTHER},fixture()).reason,'invalid_record'));
test('timezone-less evidence time is unavailable',()=>fail('source_unavailable',e=>e.fleet.asOf='2026-11-02 19:00:00'));
test('append preserves original records, notes, status, IDs, timestamps, and source object immutability',()=>{
 const board={asOf:ASOF,jobs:[{id:JOB,status:'Offline',notes:[{text:'unchanged',at:OBS}],cameraStatus:'unknown'}],tasks:[{id:TASK,relatedJobId:JOB}],readiness:[{status:'Ready'}]};
 const e=fixture(),before=JSON.stringify([board,e]);const out=appendBoardUnitLinks(board,e);
 assert.equal(out.jobs[0].unitLink.state,'linked');assert.equal(out.tasks[0].unitLink.state,'linked');
 assert.equal(JSON.stringify([board,e]),before);const {unitLink,...remaining}=out.jobs[0];assert.deepEqual(remaining,board.jobs[0]);assert.equal(out.readiness,board.readiness);
});
test('malformed Board response is rejected rather than converted into an empty success',()=>assert.throws(()=>appendBoardUnitLinks({jobs:null,tasks:[]},fixture()),TypeError));

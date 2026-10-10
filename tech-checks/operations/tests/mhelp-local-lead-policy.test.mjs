import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,input,options,payload,accept,rows,receipt,it} from '../legacy/mhelp-intake-fixture.mjs';
import {prepareMhelpLegacyIntake,REVIEWED_LOCAL_LEAD_POLICY} from '../legacy/mhelpIntakeAdapter.ts';
import {mhelpIntakeDeploymentSql} from '../legacy/deploymentAssembly.mjs';
import {validateOperationalTicket} from '../intake/mhelpIntakeRuntime.ts';
const marker=()=>({policy:REVIEWED_LOCAL_LEAD_POLICY});
const localPayload=(type='service')=>({...payload(type),ticketLead:marker()});
const scope={portalId:'17',schemaContract:'synthetic-verified-v1',activationFloor:'2026-10-10T00:00:00Z',createdAfter:'2026-10-10T00:00:00Z',createdBefore:'2026-10-10T00:15:00Z'};

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

// The preparer is kept backwards-compatible, but no local lead was deployed or
// selected. Fresh SQL deliberately refuses this obsolete installation proposal.
test('fresh proposal contains no local-lead policy table or upgrade requirement',async()=>{
  const source=await mhelpIntakeDeploymentSql();
  assert.doesNotMatch(source,/ticket_lead_policies|ticket_lead_resolution|reviewed_local_unassigned_v1/);
  const db=await fixture();
  assert.equal((await scalar(db,"select to_regclass('cos_mhelp_intake.ticket_lead_policies') is null absent")).absent,true);
  await assert.rejects(accept(db,localPayload()),/MHELP_INTAKE_INVALID_SOURCE/);
  assert.equal((await receipt(db)).length,0);assert.equal((await rows(db)).length,0);
  assert.equal((await accept(db,payload())).state,'created');assert.equal((await rows(db))[0].job_lead_user_id,it);
});

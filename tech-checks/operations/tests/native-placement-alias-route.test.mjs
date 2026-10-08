// Isolated contract/auth tests. All remote services use injected in-memory transports.
// Uses the unchanged bridge's configured auth-map constants, but all transport records are synthetic and in memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationsHandler } from '../../supabase/functions/cos-operations-pages/index.ts';
const ownerId = 'e4abc521-1ef3-45a6-9829-b87faff78210';
const actorId = '3f073784-96e7-43d8-b9e0-33ab31c3c8b1';
const recordId = 'a2345678-1234-1234-1234-123456789abc';
const technicians = {
  '4f7044b5-86b6-411f-8898-39bb64b4ddbc': {actorId:'d0757b64-9623-4adc-afff-21cc7853e88a',name:'Teddy Hopper',department:'it',roleCode:'it_technician'},
  'b7cc3cbf-d11e-4d4a-9742-c07701857911': {actorId:'3caf7c00-627f-445f-bce4-ddeae574ee5c',name:'Victor Garcia',department:'it',roleCode:'it_technician'},
  '78e54fbd-c2db-4d18-8e3d-a9740adcf285': {actorId:'7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8',name:'Abel Cervantes',department:'service',roleCode:'service_technician'},
  '49dce28e-099a-40bb-a8d8-b39f9ffbabee': {actorId:'1a7d3523-8a3c-488a-9216-4e37f4f7ecb9',name:'Josh Mireles',department:'service',roleCode:'service_technician'},
};
const orgId = 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const origin = 'https://cypressriveroasis2023-sudo.github.io';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function transport(scenario, calls) {
  const technician = technicians[scenario.userId];
  const mappedActor = technician?.actorId || actorId;
  return async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (url.includes('/auth/v1/user')) return scenario.invalidToken ? json({message:'Invalid JWT'},401) : json({id:scenario.userId || ownerId});
    if (url.includes('/rest/v1/profiles?')) return json([{user_id:scenario.userId || ownerId,full_name:scenario.legacyName || technician?.name || 'Owner',role:scenario.role || technician?.department || 'owner',active:!scenario.inactive,archived_at:scenario.archived ? '2026-01-01' : null}]);
    if (url.includes('/rest/v1/user_profiles?')) return json([{user_id:mappedActor,display_name:scenario.platformName || technician?.name || 'Owner',active:!scenario.actorInactive,department:scenario.actorDepartment || technician?.department || 'owner'}]);
    if (url.includes('/rest/v1/user_roles?')) return json(scenario.roleRevoked ? [] : [{role_id:recordId,roles:{code:scenario.wrongRole ? 'owner' : technician?.roleCode || 'owner',organization_id:scenario.wrongRoleOrg ? recordId : orgId}}]);
    if (url.includes('/rest/v1/visit_assignments?')) return json(scenario.outsideOrg ? [] : [{visit_id:recordId,user_id:scenario.otherAssignee ? actorId : mappedActor,assignment_role:'technician',status:'assigned',assigned_at:'2026-10-04T10:00:00Z',job_visits:{id:recordId,job_id:recordId,visit_number:1,visit_type:'IT_PREP',department:technician?.department || 'it',status:'scheduled',dispatch_status:'ready',scheduled_start:'2026-10-04T15:00:00Z',scheduled_end:'2026-10-04T16:00:00Z',jobs:{job_number:'COS 001',title:'Assigned Job',job_type:'DELIVERY',customers:{name:'Customer'},sites:{name:'Site'}}}}]);
    if (url.includes('/rest/v1/equipment_units?')) return json([]);
    if (url.includes('/rest/v1/vision_vigilant_unit_matches?') || url.includes('/rest/v1/vision_vigilant_devices?') || url.includes('/rest/v1/camera_devices?')) return json([]);
    if (url.endsWith('/rpc/cos_fleet_placement_evidence_v1')) return json([]);
    if (url.endsWith('/rpc/appdeploy_field_map_snapshot')) return json({items:[],inventoryItems:[],summary:{fieldUnits:0},generatedAt:'2026-10-08T00:00:00Z'});
    if (['jobs','equipment_units','owner_tasks','job_visits','quotes','invoices','purchase_orders','customers','sites','equipment_models'].some(table=>url.includes('/rest/v1/'+table+'?'))) return json(scenario.outsideOrg ? [] : [{id:recordId,job_number:'COS 001'}]);
    if (url.includes('/rest/v1/rpc/')) {
      if (scenario.rpcDenied) return json({message:'Native department or workflow guard rejected the request'},400);
      if (url.endsWith('/rpc/cos_technician_visible_visits')) {
        const payload=JSON.parse(init.body);
        assert.equal(payload.p_actor_user_id,mappedActor);assert.equal(payload.p_organization_id,orgId);assert.deepEqual(payload.p_visit_ids,[recordId]);
        return json(scenario.otherAssignee?[]:[recordId]);
      }
      if (url.endsWith('/rpc/appdeploy_technician_visit_snapshot')) return json({visit:{id:recordId},execution:{id:recordId,status:'not_started'},current_step:{title:'Native Step',instruction:'Native instruction',step_type:'yes_no',validation_schema:{hidden:true},evidence_requirements:{hidden:true}}});
      if (url.endsWith('/rpc/appdeploy_owner_jobs_snapshot')) return json({items:[{id:recordId,visitId:recordId,jobNumber:'COS 001'}]});
      return json({items:[],ok:true,id:recordId});
    }
    throw new Error('Unhandled mock route: '+url);
  };
}
function request(path, method='GET', body={}, headers={}) {
  return new Request('https://platform.example/functions/v1/cos-operations-pages',{
    method:'POST',
    headers:{Authorization:'Bearer test-owner-token','Content-Type':'application/json',Origin:origin,...headers},
    body:JSON.stringify({path,method,body}),
  });
}

for(const [name,scenario,status] of [
 ['Owner',{},200],
 ['approved IT one',{userId:'4f7044b5-86b6-411f-8898-39bb64b4ddbc'},200],
 ['approved IT two',{userId:'b7cc3cbf-d11e-4d4a-9742-c07701857911'},200],
 ['Service one',{userId:'78e54fbd-c2db-4d18-8e3d-a9740adcf285'},403],
 ['Service two',{userId:'49dce28e-099a-40bb-a8d8-b39f9ffbabee'},403],
 ['unmapped IT',{role:'it'},403],
 ['unmapped owner',{userId:'99999999-9999-4999-8999-999999999999'},403],
 ['inactive Owner',{inactive:true},403],
 ['revoked approved IT',{userId:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',roleRevoked:true},403],
])test(name+' respects existing field-map/identity route boundaries',async()=>{
 const calls=[],handler=createOperationsHandler({platformUrl:'https://platform.example',serviceKey:'synthetic-service-key',fetch:transport(scenario,calls)});
 const response=await handler(request('/api/field-map'));const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));
 if(status===200){assert.equal(result.placementProjectionVersion,2);assert.deepEqual(result.nativePlacementAliases,[]);assert.equal(calls.filter(c=>c.url.includes('/vision_vigilant_unit_matches?')).length,1);assert.equal(calls.filter(c=>c.url.includes('/vision_vigilant_devices?')).length,1);assert.equal(calls.filter(c=>c.url.includes('/camera_devices?')).length,1);}
 else assert.equal(calls.some(c=>/vision_vigilant|camera_devices|appdeploy_field_map_snapshot|cos_fleet_placement_evidence/.test(c.url)),false);
 assert.equal(calls.some(c=>/owner_set|INSERT|UPDATE|DELETE/.test(c.url)),false);
});

// Isolated contract/auth tests. All remote services use injected in-memory transports.
// Run from operations: node --import tsx --test tests/backend.test.mjs
import test from 'node:test';
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
    if (['jobs','equipment_units','owner_tasks','job_visits','quotes','invoices','purchase_orders','customers','sites','equipment_models'].some(table=>url.includes('/rest/v1/'+table+'?'))) return json(scenario.outsideOrg ? [] : [{id:recordId,job_number:'COS 001'}]);
    if (url.includes('/rest/v1/rpc/')) {
      if (scenario.rpcDenied) return json({message:'Native department or workflow guard rejected the request'},400);
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
const cases = [
 ['owner VRM fleet permitted', '/api/vrm-portal', 'GET', {}, 200],
 ['IT VRM denied', '/api/vrm-portal', 'GET', {}, 403, {role:'it'}],
 ['service VRM denied', '/api/vrm-portal', 'GET', {}, 403, {role:'service'}],
 ['unmapped VRM denied', '/api/vrm-portal', 'GET', {}, 403, {userId:'2e304f31-2500-415a-90b5-dbadd7d56f61'}],
 ['VRM configuration writes denied', '/api/vrm-portal', 'POST', {}, 404],
 ['missing bearer', '/api/jobs', 'GET', {}, 401, {}, {Authorization:''}],
 ['invalid remote bearer', '/api/jobs', 'GET', {}, 401, {invalidToken:true}],
 ['IT technician denied', '/api/jobs', 'GET', {}, 403, {role:'it'}],
 ['Service technician denied', '/api/jobs', 'GET', {}, 403, {role:'service'}],
 ['inactive legacy owner denied', '/api/jobs', 'GET', {}, 403, {inactive:true}],
 ['archived legacy owner denied', '/api/jobs', 'GET', {}, 403, {archived:true}],
 ['unmapped owner retains session', '/api/session', 'GET', {}, 200, {userId:'2e304f31-2500-415a-90b5-dbadd7d56f61'}],
 ['unmapped owner cannot read production', '/api/jobs', 'GET', {}, 403, {userId:'2e304f31-2500-415a-90b5-dbadd7d56f61'}],
 ['inactive production owner denied', '/api/jobs', 'GET', {}, 403, {actorInactive:true}],
 ['revoked production owner role denied', '/api/session', 'GET', {}, 403, {roleRevoked:true}],
 ['non-owner production profile denied', '/api/jobs', 'GET', {}, 403, {actorDepartment:'service'}],
 ['untrusted origin denied', '/api/jobs', 'GET', {}, 403, {}, {Origin:'https://attacker.example'}],
 ['actor override rejected', '/api/field-map/'+recordId+'/gps', 'POST', {latitude:30,longitude:-97,actorId:'other'}, 400],
 ['query injection rejected', '/api/jobs?select=secret', 'GET', {}, 404],
 ['unknown endpoint denied', '/api/reset', 'GET', {}, 404],
 ['unsupported transport method denied', '/api/jobs', 'DELETE', {}, 405],
 ['GET endpoint body denied', '/api/jobs', 'GET', {status:'closed'}, 400],
 ['null GPS latitude denied', '/api/field-map/'+recordId+'/gps', 'POST', {latitude:null,longitude:-97}, 400],
 ['GPS string denied', '/api/field-map/'+recordId+'/gps', 'POST', {latitude:'30',longitude:-97}, 400],
 ['GPS out of range denied', '/api/field-map/'+recordId+'/gps', 'POST', {latitude:91,longitude:-97}, 400],
 ['GPS negative accuracy denied', '/api/field-map/'+recordId+'/gps', 'POST', {latitude:30,longitude:-97,accuracyM:-1}, 400],
 ['GPS unsupported source denied', '/api/field-map/'+recordId+'/gps', 'POST', {latitude:30,longitude:-97,source:'spoof'}, 400],
 ['unit outside organization denied', '/api/field-map/'+recordId+'/gps', 'POST', {latitude:30,longitude:-97}, 404, {outsideOrg:true}],
 ['impossible schedule date denied', '/api/jobs/'+recordId+'/schedule', 'POST', {start:'2026-02-30T10:00',end:'2026-03-01T11:00',technician:'Tech'}, 400],
 ['reversed schedule denied', '/api/jobs/'+recordId+'/schedule', 'POST', {start:'2026-10-04T10:00',end:'2026-10-04T09:00',technician:'Tech'}, 400],
 ['native department guard propagated', '/api/jobs/'+recordId+'/assign', 'POST', {technician:'IT Tech'}, 409, {rpcDenied:true}],
 ['task status override denied', '/api/owner-tasks', 'POST', {title:'Task',assignedDepartment:'it',status:'completed'}, 400],
 ['invalid task priority denied', '/api/owner-tasks', 'POST', {title:'Task',assignedDepartment:'it',priority:'normal'}, 400],
 ['incomplete removal confirmation denied', '/api/jobs/'+recordId+'/remove', 'POST', {confirmation:'yes'}, 400],
 ['unauthorized removal denied', '/api/jobs/'+recordId+'/remove', 'POST', {confirmation:'DELETE COS 001'}, 403, {role:'service'}],
 ['wrong exact removal confirmation denied', '/api/jobs/'+recordId+'/remove', 'POST', {confirmation:'DELETE COS 002'}, 400],
 ['native removal maps authoritative guard', '/api/jobs/'+recordId+'/remove', 'POST', {confirmation:'DELETE COS 001'}, 200],
 ['technician cannot inspect Owner session', '/api/session','GET',{},403,{userId:'4f7044b5-86b6-411f-8898-39bb64b4ddbc'}],
 ['Owner cannot borrow technician queue', '/api/tech/my-day','GET',{},403],
 ['unmapped technician keeps legacy access', '/api/tech/session','GET',{},200,{userId:'b9465a4e-c003-4205-8154-56792c9cfed9',role:'service'}],
 ['unmapped technician cannot load platform queue', '/api/tech/my-day','GET',{},403,{userId:'b9465a4e-c003-4205-8154-56792c9cfed9',role:'service'}],
 ['linked technician session', '/api/tech/session','GET',{},200,{userId:'4f7044b5-86b6-411f-8898-39bb64b4ddbc'}],
 ['linked technician day', '/api/tech/my-day','GET',{},200,{userId:'4f7044b5-86b6-411f-8898-39bb64b4ddbc'}],
 ['linked technician tasks', '/api/tech/tasks','GET',{},200,{userId:'49dce28e-099a-40bb-a8d8-b39f9ffbabee'}],
 ['linked technician assignments scoped to self', '/api/tech/assignments','GET',{},200,{userId:'78e54fbd-c2db-4d18-8e3d-a9740adcf285'}],
 ['inconsistent technician assignment denied', '/api/tech/assignments','GET',{},503,{userId:'78e54fbd-c2db-4d18-8e3d-a9740adcf285',otherAssignee:true}],
 ['technician details sanitized', '/api/tech/visits/'+recordId,'GET',{},200,{userId:'b7cc3cbf-d11e-4d4a-9742-c07701857911'}],
 ['technician cannot inspect another assignment', '/api/tech/visits/'+recordId,'GET',{},404,{userId:'b7cc3cbf-d11e-4d4a-9742-c07701857911',otherAssignee:true}],
 ['technician inactive account denied', '/api/tech/my-day','GET',{},403,{userId:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',inactive:true}],
 ['technician native role revocation denied', '/api/tech/my-day','GET',{},403,{userId:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',roleRevoked:true}],
 ['technician native role mismatch denied', '/api/tech/my-day','GET',{},403,{userId:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',wrongRole:true}],
 ['technician native role organization mismatch denied', '/api/tech/my-day','GET',{},403,{userId:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',wrongRoleOrg:true}],
 ['technician legacy name change requires review', '/api/tech/my-day','GET',{},403,{userId:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',legacyName:'Different Person'}],
 ['technician platform name change requires review', '/api/tech/my-day','GET',{},403,{userId:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',platformName:'Different Person'}],
 ['technician writes remain denied', '/api/tech/visits/'+recordId,'POST',{},405,{userId:'4f7044b5-86b6-411f-8898-39bb64b4ddbc'}],
 ['technician cannot mutate Owner equipment', '/api/equipment/'+recordId,'POST',{},403,{userId:'4f7044b5-86b6-411f-8898-39bb64b4ddbc'}],
 ['quote review returns through native guard', '/api/quotes/'+recordId+'/action','POST',{action:'return',reason:'Review scope'},200],
 ['quote return requires reason', '/api/quotes/'+recordId+'/action','POST',{action:'return'},400],
 ['quote unsupported send denied', '/api/quotes/'+recordId+'/action','POST',{action:'send'},400],
 ['quote review unknown fields denied', '/api/quotes/'+recordId+'/action','POST',{action:'approve',email:'outside@example.com'},400],
 ['invoice approval through native guard', '/api/ar/'+recordId+'/action','POST',{action:'approve'},200],
 ['invoice issue through native guard', '/api/ar/'+recordId+'/action','POST',{action:'issue'},200],
 ['invoice payment is not exposed', '/api/ar/'+recordId+'/payment','POST',{amount:100,reference:'test'},404],
 ['document email is not exposed', '/api/documents/email','POST',{to:'outside@example.com'},404],
 ['native quote detail available', '/api/quotes/'+recordId,'GET',{},200],
 ['native invoice detail available', '/api/ar/'+recordId,'GET',{},200],
 ['native purchase detail available', '/api/purchasing/'+recordId,'GET',{},200],
 ['native PO review through guard', '/api/purchasing/'+recordId+'/po-review','POST',{action:'approve'},200],
 ['PO return requires reason', '/api/purchasing/'+recordId+'/po-review','POST',{action:'return'},400],
 ['native AP approval through guard', '/api/purchasing/'+recordId+'/approve','POST',{},200],
 ['AP approval rejects payment fields', '/api/purchasing/'+recordId+'/approve','POST',{paid:true},400],
 ['native customer save available', '/api/customers','POST',{name:'Customer',status:'active'},201],
 ['native customer update available', '/api/customers/'+recordId,'POST',{name:'Updated',legalName:'Legal',notes:'Notes',status:'inactive'},200],
 ['customer request rejects extra identity fields', '/api/customers','POST',{name:'Customer',userId:recordId},400],
 ['customer status validated', '/api/customers','POST',{name:'Customer',status:'retired'},400],
 ['native site save available', '/api/sites','POST',{customerId:recordId,name:'Site',country:'US',status:'active'},201],
 ['site customer scope guard enforced', '/api/sites','POST',{customerId:recordId,name:'Site'},404,{outsideOrg:true}],
 ['site geographic unsupported fields rejected', '/api/sites','POST',{customerId:recordId,name:'Site',latitude:30},400],
 ['native equipment save available', '/api/equipment','POST',{modelId:recordId,unitNumber:'Unit 1',status:'available',currentLocationType:'shop'},201],
 ['equipment status validated', '/api/equipment','POST',{modelId:recordId,unitNumber:'Unit 1',status:'field'},400],
 ['equipment site reassignment unsupported', '/api/equipment','POST',{modelId:recordId,unitNumber:'Unit 1',installedSiteId:recordId},400],
 ['equipment model scope enforced', '/api/equipment','POST',{modelId:recordId,unitNumber:'Unit 1'},404,{outsideOrg:true}],
 ['dispatch unsupported fields denied', '/api/jobs/'+recordId+'/dispatch','POST',{status:'dispatched'},400],
 ['native handoffs read available','/api/handoffs','GET',{},200],
 ['native directory read available','/api/customers','GET',{},200],
 ['native equipment read available','/api/equipment','GET',{},200],
 ['native Today snapshot permitted', '/api/jobs', 'GET', {}, 200],
 ['native GPS contract permitted', '/api/field-map/'+recordId+'/gps', 'POST', {latitude:30.123456,longitude:-97.123456,accuracyM:0,source:'manual',note:'Verified'}, 200],
 ['wall clock schedule contract permitted', '/api/jobs/'+recordId+'/schedule', 'POST', {start:'2026-10-04T10:00',end:'2026-10-04T11:00',technician:'Tech'}, 200],
 ['native task create contract permitted', '/api/owner-tasks', 'POST', {title:'Review',assignedDepartment:'it',priority:'medium',dueAt:'2026-10-04T15:00:00Z'}, 201],
];
for (const [name,path,method,body,status,scenario={},headers={}] of cases) {
  test(name, async () => {
    const calls=[];
    const handler=createOperationsHandler({platformUrl:'https://platform.example',serviceKey:'test-server-key',fetch:transport(scenario,calls)});
    const response=await handler(request(path,method,body,headers));
    const data=await response.json();
    if(response.status!==status)throw new Error('Expected '+status+', received '+response.status+': '+JSON.stringify(data));
    const rpcCalls=calls.filter(c=>c.url.includes('/rest/v1/rpc/'));
    if(status>=400&&!scenario.rpcDenied&&rpcCalls.length)throw new Error('Rejected request reached a native RPC.');
    if(name==='linked technician session'&&(data.productionTechnicianUserId!==technicians[scenario.userId].actorId||data.legacyTechnician!==true))throw new Error('Technician did not use their own actor.');
    if(name==='linked technician day'||name==='linked technician tasks') {
      if(rpcCalls.at(-1).body.p_actor_user_id!==technicians[scenario.userId].actorId)throw new Error('Technician borrowed another actor.');
    }
    if(name==='linked technician assignments scoped to self') {
      const query=calls.find(call=>call.url.includes('/rest/v1/visit_assignments?')).url;
      if(!query.includes('user_id=eq.'+technicians[scenario.userId].actorId)||!query.includes('job_visits.organization_id=eq.'+orgId)||data.visits.length!==1)throw new Error('Assignment queue was not scoped to caller and organization.');
    }
    if(name==='technician details sanitized'&&('validation_schema' in data.current_step||'evidence_requirements' in data.current_step))throw new Error('Internal workflow schemas were exposed.');
    if(name==='native Today snapshot permitted'&&data.items[0].technicianUserId!==actorId)throw new Error('Owner job technician UUID readback omitted.');
    if(name==='unmapped owner retains session'&&(data.authorized!==false||data.legacyOwner!==true))throw new Error('Unmapped Owner session was lost.');
    if(name==='native removal maps authoritative guard') {
      const call=rpcCalls.at(-1);
      if(!call.url.endsWith('/rpc/appdeploy_owner_delete_job')||call.body.p_confirmation!=='DELETE COS 001'||call.body.p_actor_user_id!==actorId||call.body.p_job_id!==recordId)throw new Error('Removal bypassed native confirmation/dependency guards.');
    }
    if(name==='native Today snapshot permitted') {
      const payload=rpcCalls.at(-1).body;
      if(payload.p_actor_user_id!==actorId||payload.p_organization_id!=='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5')throw new Error('Caller controlled actor or organization.');
    }
    if(name==='native GPS contract permitted') {
      const payload=rpcCalls.at(-1).body;
      if(payload.p_unit_id!==recordId||payload.p_accuracy_m!==0)throw new Error('GPS contract changed target or zero accuracy.');
    }
    if(name==='wall clock schedule contract permitted'&&rpcCalls.at(-1).body.p_start_local!=='2026-10-04 10:00')throw new Error('Local wall time was converted.');
    if(name==='native task create contract permitted'&&(rpcCalls.at(-1).body.p_task_id!==null||rpcCalls.at(-1).body.p_payload.priority!=='medium'))throw new Error('Task create contract changed.');
  });
}

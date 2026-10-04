// Isolated contract/auth tests. All remote services use injected in-memory transports.
// Run with: deno test --no-check index_test.js
import { createOperationsHandler } from './index.ts';
const ownerId = 'e4abc521-1ef3-45a6-9829-b87faff78210';
const actorId = '3f073784-96e7-43d8-b9e0-33ab31c3c8b1';
const recordId = 'a2345678-1234-1234-1234-123456789abc';
const origin = 'https://cypressriveroasis2023-sudo.github.io';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function transport(scenario, calls) {
  return async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (url.includes('/auth/v1/user')) return scenario.invalidToken ? json({message:'Invalid JWT'},401) : json({id:scenario.userId || ownerId});
    if (url.includes('/rest/v1/profiles?')) return json([{user_id:scenario.userId || ownerId,full_name:'Owner',role:scenario.role || 'owner',active:!scenario.inactive,archived_at:scenario.archived ? '2026-01-01' : null}]);
    if (url.includes('/rest/v1/user_profiles?')) return json([{user_id:actorId,active:!scenario.actorInactive,department:scenario.actorDepartment || 'owner'}]);
    if (url.includes('/rest/v1/user_roles?')) return json(scenario.roleRevoked ? [] : [{role_id:recordId,roles:{code:'owner'}}]);
    if (['jobs','equipment_units','owner_tasks'].some(table=>url.includes('/rest/v1/'+table+'?'))) return json(scenario.outsideOrg ? [] : [{id:recordId,job_number:'COS 001'}]);
    if (url.includes('/rest/v1/rpc/')) return scenario.rpcDenied ? json({message:'SERVICE work must be assigned to a SERVICE technician'},400) : json({items:[],ok:true,id:recordId});
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
 ['native Today snapshot permitted', '/api/jobs', 'GET', {}, 200],
 ['native GPS contract permitted', '/api/field-map/'+recordId+'/gps', 'POST', {latitude:30.123456,longitude:-97.123456,accuracyM:0,source:'manual',note:'Verified'}, 200],
 ['wall clock schedule contract permitted', '/api/jobs/'+recordId+'/schedule', 'POST', {start:'2026-10-04T10:00',end:'2026-10-04T11:00',technician:'Tech'}, 200],
 ['native task create contract permitted', '/api/owner-tasks', 'POST', {title:'Review',assignedDepartment:'it',priority:'medium',dueAt:'2026-10-04T15:00:00Z'}, 201],
];
for (const [name,path,method,body,status,scenario={},headers={}] of cases) {
  Deno.test(name, async () => {
    const calls=[];
    const handler=createOperationsHandler({platformUrl:'https://platform.example',serviceKey:'test-server-key',fetch:transport(scenario,calls)});
    const response=await handler(request(path,method,body,headers));
    const data=await response.json();
    if(response.status!==status)throw new Error('Expected '+status+', received '+response.status+': '+JSON.stringify(data));
    const rpcCalls=calls.filter(c=>c.url.includes('/rest/v1/rpc/'));
    if(status>=400&&!scenario.rpcDenied&&rpcCalls.length)throw new Error('Rejected request reached a native RPC.');
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

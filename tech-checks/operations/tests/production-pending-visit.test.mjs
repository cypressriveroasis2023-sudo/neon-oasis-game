import test from 'node:test';
import assert from 'node:assert/strict';
const {createOperationsHandler}=await import(process.env.COS_BRIDGE_TEST_SOURCE || '../../supabase/functions/cos-operations-pages/index.ts');
const org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',legacy='b7cc3cbf-d11e-4d4a-9742-c07701857911',actor='3caf7c00-627f-445f-bce4-ddeae574ee5c';
const visit='11111111-1111-4111-8111-111111111111',job='22222222-2222-4222-8222-222222222222',site='33333333-3333-4333-8333-333333333333',customer='44444444-4444-4444-8444-444444444444',other='55555555-5555-4555-8555-555555555555';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
function fixture(){return {visit_id:visit,user_id:actor,assignment_role:'technician',status:'assigned',job_visits:{id:visit,organization_id:org,job_id:job,visit_number:1,visit_type:'IT_PREP',department:'it',status:'scheduled',dispatch_status:'ready',scheduled_start:'2026-10-06T20:00:00Z',scheduled_end:'2026-10-06T22:00:00Z',instructions:'Prepare assigned equipment',jobs:{id:job,organization_id:org,job_number:'FIX-501',title:'Prep equipment',job_type:'DELIVERY',description:'Saved instructions',priority:'normal',site_id:site,customer_id:customer,operational_status:'ready_to_schedule',customers:{id:customer,organization_id:org,name:'Fixture customer'},sites:{id:site,organization_id:org,customer_id:customer,name:'Fixture site',address_line1:'123 Fixture Street',city:'Fixture City',state_region:'TX',postal_code:'12345'}}}};}
async function run(change=()=>{},options={}){
  const row=fixture();change(row);const calls=[];
  const handler=createOperationsHandler({platformUrl:'https://native.test',serviceKey:'synthetic-service-key',fetch:async(url,init={})=>{
    calls.push({url,method:init.method||'GET',body:init.body?JSON.parse(init.body):undefined});
    if(url.includes('/auth/v1/user'))return json({id:legacy});
    if(url.includes('/rest/v1/profiles?'))return json([{user_id:legacy,full_name:'Victor Garcia',role:'it',active:true}]);
    if(url.includes('/rest/v1/user_profiles?'))return json([{user_id:actor,display_name:'Victor Garcia',department:'it',active:true}]);
    if(url.includes('/rest/v1/user_roles?'))return json([{roles:{code:'it_technician',organization_id:org}}]);
    if(url.includes('/rest/v1/job_visits?'))return json([{id:visit}]);
    if(url.includes('/rest/v1/visit_assignments?')){
      if(url.includes('job_visits!inner'))return json(options.revokedDuringLoad?[]:options.duplicate?[row,row]:[row]);
      return json([{visit_id:visit,user_id:options.otherInitial?other:actor,assignment_role:'technician',status:options.initialStatus||'assigned'}]);
    }
    if(url.includes('/rest/v1/workflow_executions?'))return json(options.existingExecution?[{id:other}]:[]);
    if(url.includes('/rpc/appdeploy_technician_visit_snapshot'))return options.rpcError?json({message:'Source unavailable'},503):json(options.detail||{});
    throw new Error('Unexpected read '+url);
  }});
  const response=await handler(new Request('https://native.test/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer synthetic-token','Content-Type':'application/json',Origin:'https://cypressriveroasis2023-sudo.github.io'},body:JSON.stringify({path:'/api/tech/visits/'+visit,method:'GET',body:{}})}));
  return {response,data:await response.json(),calls};
}
for(const status of ['assigned','accepted'])test(status+' visit has read-only pending details without an execution',async()=>{
  const {response,data,calls}=await run(r=>r.status=status,{initialStatus:status});
  assert.equal(response.status,200);assert.equal(data.pendingWorkflow,true);assert.equal(data.execution,null);assert.equal(data.current_step,null);assert.equal(data.job.id,job);assert.equal(data.job.job_number,'FIX-501');assert.equal(data.site.name,'Fixture site');assert.equal(data.visit.dispatch_status,'ready');
  const scoped=calls.find(c=>c.url.includes('job_visits!inner'));for(const filter of ['visit_id=eq.'+visit,'user_id=eq.'+actor,'assignment_role=eq.technician','status=in.(assigned,accepted)','job_visits.organization_id=eq.'+org,'job_visits.department=eq.it','limit=2'])assert.ok(scoped.url.includes(filter));
  assert.ok(calls.every(c=>c.method==='GET'||c.url.endsWith('/rpc/appdeploy_technician_visit_snapshot')));assert.equal(calls.filter(c=>c.url.includes('/rpc/')).length,1);
});
for(const [name,mutate] of [
 ['other technician',r=>r.user_id=other],['revoked assignment',r=>r.status='revoked'],['wrong assignment role',r=>r.assignment_role='observer'],['wrong visit id',r=>r.visit_id=other],['wrong nested visit',r=>r.job_visits.id=other],['cross organization visit',r=>r.job_visits.organization_id=other],['other department',r=>r.job_visits.department='service'],['completed visit',r=>r.job_visits.status='completed'],['cancelled visit',r=>r.job_visits.status='cancelled'],['cross organization job',r=>r.job_visits.jobs.organization_id=other],['different job',r=>r.job_visits.jobs.id=other],['closed job',r=>r.job_visits.jobs.operational_status='closed'],['cross organization site',r=>r.job_visits.jobs.sites.organization_id=other],['different site customer',r=>r.job_visits.jobs.sites.customer_id=other],['cross organization customer',r=>r.job_visits.jobs.customers.organization_id=other],['different customer',r=>r.job_visits.jobs.customers.id=other],
])test('pending visit denies '+name,async()=>{const {response,data}=await run(mutate);assert.equal(response.status,503);assert.ok(data.error);assert.equal(data.job,undefined);});
for(const [name,options,status] of [['initial other technician',{otherInitial:true},404],['initial revoked',{initialStatus:'revoked'},404],['revoked during load',{revokedDuringLoad:true},404],['duplicate assignment',{duplicate:true},404],['existing execution with missing snapshot',{existingExecution:true},503],['malformed snapshot',{detail:{execution:{id:other}}},503],['wrong snapshot visit',{detail:{visit:{id:other}}},503],['RPC failure',{rpcError:true},503]])test('pending visit fails closed: '+name,async()=>{const {response,data}=await run(()=>{},options);assert.equal(response.status,status);assert.equal(data.job,undefined);});
test('execution-backed path stays unchanged and never uses fallback',async()=>{const detail={execution:{id:other,status:'in_progress'},visit:{id:visit},job:{id:job},site:{name:'Fixture site'},current_step:{id:other,title:'Saved step',step_type:'task',required:true,validation_schema:{private:true}}};const {response,data,calls}=await run(()=>{},{detail});assert.equal(response.status,200);assert.deepEqual(data.execution,detail.execution);assert.deepEqual(data.visit,detail.visit);assert.equal(data.current_step.title,'Saved step');assert.equal(data.current_step.validation_schema,undefined);assert.equal(data.pendingWorkflow,undefined);assert.ok(!calls.some(c=>c.url.includes('job_visits!inner')||c.url.includes('workflow_executions?')));});

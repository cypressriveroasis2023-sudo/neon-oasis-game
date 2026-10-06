import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
const owner='e4abc521-1ef3-45a6-9829-b87faff78210',actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const customer='11111111-1111-4111-8111-111111111111',contact='22222222-2222-4222-8222-222222222222',foreign='33333333-3333-4333-8333-333333333333';
const origin='https://cypressriveroasis2023-sudo.github.io';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
const row={id:contact,customer_id:customer,name:'Fixture Contact',email:'fixture@example.invalid',phone:'202-555-0101',title:'Fixture coordinator',is_primary:true,billing_contact:false,customers:{organization_id:org,status:'active'}};
function setup(scenario={}){
 const calls=[];
 const handler=createOperationsHandler({platformUrl:'https://platform.example',serviceKey:'synthetic-only',fetch:async(url,init={})=>{
  calls.push({url,method:init.method||'GET',body:init.body?JSON.parse(init.body):null});
  if(url.includes('/auth/v1/user'))return json({id:owner});
  if(url.includes('/rest/v1/profiles?'))return json([{user_id:owner,full_name:'Fixture Owner',role:scenario.role||'owner',active:!scenario.inactive,archived_at:scenario.archived?'2026-01-01':null}]);
  if(url.includes('/rest/v1/user_profiles?'))return json([{user_id:actor,display_name:'Fixture Owner',department:'owner',active:true}]);
  if(url.includes('/rest/v1/user_roles?'))return json([{roles:{code:'owner',organization_id:org}}]);
  if(url.endsWith('/rpc/appdeploy_customers_snapshot'))return scenario.permissionDenied?json({message:'Customer permission required'},403):json(scenario.malformedDirectory?{items:[null]}:{items:scenario.foreignCustomer?[]:[{id:customer,name:'Fixture customer',status:scenario.archivedCustomer?'archived':scenario.inactiveCustomer?'inactive':'active'},...(scenario.unrelatedArchived?[{id:foreign,name:'Archived Fixture',status:'archived'}]:[])]});
  if(url.includes('/rest/v1/customer_contacts?')){
   const all=scenario.rows||[row];const offset=Number(new URL(url).searchParams.get('offset'));return json(all.slice(offset,offset+1000));
  }
  throw Error('Unexpected contact backend fixture request: '+url);
 }});
 const request=(method='GET',path='/api/customers/'+customer+'/contacts',headers={})=>handler(new Request('https://platform.example/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer synthetic-owner-only','Content-Type':'application/json',Origin:origin,...headers},body:JSON.stringify({path,method,body:{}})}));
 return {calls,request};
}
test('contact read reuses customer permission gate, scopes organization/customer, and returns only safe contact fields',async()=>{
 const {calls,request}=setup();const response=await request();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual(await response.json(),{customerId:customer,items:[{id:contact,customerId:customer,name:row.name,email:row.email,phone:row.phone,title:row.title,isPrimary:true,billingContact:false}]});
 const gate=calls.find(call=>call.url.endsWith('/rpc/appdeploy_customers_snapshot'));assert.deepEqual(gate.body,{p_actor_user_id:actor,p_organization_id:org});
 const read=calls.find(call=>call.url.includes('/customer_contacts?'));const params=new URL(read.url).searchParams;
 assert.equal(params.get('customer_id'),'eq.'+customer);assert.equal(params.get('customers.organization_id'),'eq.'+org);assert.equal(params.get('customers.status'),'eq.active');assert.equal(read.method,'GET');
});
for(const [name,scenario,status] of [['foreign customer',{foreignCustomer:true},404],['inactive customer',{inactiveCustomer:true},409],['archived customer',{archivedCustomer:true},409],['customer permission denied',{permissionDenied:true},403],['malformed customer permission snapshot',{malformedDirectory:true},503],['archived owner',{archived:true},403],['inactive owner',{inactive:true},403],['technician role',{role:'service'},403]])test(name+' cannot read contact data',async()=>{
 const {calls,request}=setup(scenario);assert.equal((await request()).status,status);assert.equal(calls.filter(call=>call.url.includes('/customer_contacts?')).length,0);
});
for(const [name,rows] of [['foreign organization',[{...row,customers:{organization_id:foreign,status:'active'}}]],['foreign parent',[{...row,customer_id:foreign}]],['inactive returned parent',[{...row,customers:{organization_id:org,status:'inactive'}}]],['duplicate id',[row,row]],['malformed details',[{...row,email:42}]]])test(name+' fails closed without leaking a row',async()=>{
 const {request}=setup({rows});const response=await request();assert.equal(response.status,503);const data=await response.json();assert.equal(data.items,undefined);assert.equal(JSON.stringify(data).includes(row.email),false);
});
test('contacts paginate beyond 1000 without silent truncation',async()=>{
 const rows=Array.from({length:1001},(_,i)=>({...row,id:'a0000000-0000-4000-8000-'+String(i).padStart(12,'0')}));const {request,calls}=setup({rows});const response=await request();assert.equal(response.status,200);assert.equal((await response.json()).items.length,1001);assert.equal(calls.filter(call=>call.url.includes('/customer_contacts?')).length,2);
});
test('contact endpoint rejects writes, untrusted origins, missing auth and invalid IDs',async()=>{
 for(const [method,path,headers,status] of [['POST','/api/customers/'+customer+'/contacts',{},404],['GET','/api/customers/'+customer+'/contacts',{Origin:'https://foreign.example'},403],['GET','/api/customers/'+customer+'/contacts',{Authorization:''},401],['GET','/api/customers/not-a-uuid/contacts',{},400]]){const {request,calls}=setup();assert.equal((await request(method,path,headers)).status,status);assert.equal(calls.filter(call=>call.url.includes('/customer_contacts?')).length,0);}
});

test('an unrelated archived customer does not block an active customer contact read',async()=>{const {request}=setup({unrelatedArchived:true});const response=await request();assert.equal(response.status,200);assert.equal((await response.json()).items[0].id,contact);});

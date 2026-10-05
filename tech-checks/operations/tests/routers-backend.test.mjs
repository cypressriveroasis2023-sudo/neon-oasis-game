import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
const owner='e4abc521-1ef3-45a6-9829-b87faff78210',actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
async function run({role='owner',user=owner,inactive=false,revoked=false,method='GET',failRouters=false,unitError=false,body={}}={}){
 const calls=[];
 const handler=createOperationsHandler({platformUrl:'https://platform.example',serviceKey:'synthetic-platform-key',fetch:async(url,init={})=>{
  calls.push({url,init});
  if(url.includes('/auth/v1/user'))return json({id:user});
  if(url.includes('/profiles?'))return json([{user_id:user,full_name:'Owner',role,active:!inactive}]);
  if(url.includes('/user_profiles?'))return json([{user_id:actor,active:true,department:'owner'}]);
  if(url.includes('/user_roles?'))return json(revoked?[]:[{roles:{code:'owner',organization_id:org}}]);
  if(url.includes('/camera_unit_routers?'))return json(failRouters?{message:'Unavailable'}:[{id:1,unit_key:'HELIOS 001',router_public_ip:'192.0.2.1',current_status:'online',last_checked_at:new Date().toISOString(),password:'HIDDEN'}],failRouters?500:200);
  if(url.includes('/equipment_units?'))return json(unitError?{}:[{id:'11111111-1111-4111-8111-111111111111',unit_number:'HELIOS 001'}]);
  throw new Error('Unexpected route '+url);
 }});
 const response=await handler(new Request('https://platform.example/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer synthetic-legacy-user',Origin:'https://cypressriveroasis2023-sudo.github.io','Content-Type':'application/json'},body:JSON.stringify({path:'/api/routers',method,body})}));
 return {response,body:await response.json(),calls};
}
test('router read requires existing linked Owner and uses caller legacy RLS + scoped COS unit query',async()=>{
 const result=await run();assert.equal(result.response.status,200);assert.equal(result.body.items.length,1);assert.equal(result.body.items[0].gps,null);assert.equal(result.body.items[0].candidateUnit.unitNumber,'HELIOS 001');assert.equal(JSON.stringify(result.body).includes('HIDDEN'),false);
 const source=result.calls.find(c=>c.url.includes('/camera_unit_routers?'));assert.equal(source.init.headers.Authorization,'Bearer synthetic-legacy-user');assert.notEqual(source.init.headers.apikey,'synthetic-platform-key');assert.ok(!source.url.includes('select=*'));
 const units=result.calls.find(c=>c.url.includes('/equipment_units?'));assert.ok(units.url.includes('organization_id=eq.'+org));
 assert.ok(result.calls.every(c=>(c.init.method||'GET')==='GET'));assert.equal(result.response.headers.get('cache-control'),'no-store');
});
for(const [label,scenario,status] of [['IT',{role:'it'},403],['Service',{role:'service'},403],['unlinked Owner',{user:'21111111-1111-4111-8111-111111111111'},403],['inactive Owner',{inactive:true},403],['revoked Owner',{revoked:true},403],['write',{method:'POST'},404],['GET payload',{body:{actorId:'spoof'}},400]])test(label+' cannot read or mutate router inventory',async()=>{
 const result=await run(scenario);assert.equal(result.response.status,status);assert.equal(result.calls.some(c=>c.url.includes('camera_unit_routers')),false);
});
test('source failures are unavailable, never an empty healthy fleet',async()=>{
 for(const scenario of [{failRouters:true},{unitError:true}]){const result=await run(scenario);assert.equal(result.response.status,503);assert.equal('items' in result.body,false);}
});

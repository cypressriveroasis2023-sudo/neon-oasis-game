import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transferReadiness,TRANSFER_READINESS_RPC} from '../../transfers/readiness.js';
import {transferClient} from '../../transfers/client.js';
const id='00000000-0000-4000-8000-000000000001';
const ready=()=>({version:1,actor_id:id,role:'it',ready:true,enabled:true,
 dependencies:{read:true,submit:true,privateEvidence:true},release:{reports:true,receiptLink:true,custody:true}});
function fixture(response={data:ready()}){
 const state={id,role:'it',active:true,archived_at:null},calls=[];
 const c={getSession:()=>({user:{id:state.id}}),getRole:()=>state.role,
  getProfile:()=>({user_id:state.id,active:state.active,archived_at:state.archived_at}),
  db:{rpc:async(name,...args)=>{calls.push(name);return typeof response==='function'?response(name,...args):response;}}};
 return {c,state,calls};
}
test('readiness requires an explicit fully ready response bound to this active account',async()=>{
 const f=fixture();assert.deepEqual(await transferReadiness(f.c,'it'),{ready:true,reason:'ready',actor:id,role:'it'});assert.deepEqual(f.calls,[TRANSFER_READINESS_RPC]);
 for(const edit of [d=>delete d.release,d=>{d.version=2},d=>{d.actor_id='other'},d=>{d.role='service'},d=>{d.ready='true'},d=>{d.dependencies.read='true'}]){
  const data=ready();edit(data);assert.equal((await transferReadiness(fixture({data}).c,'it')).ready,false);
 }
});
test('every missing reporting, receipt, custody or backend gate keeps the feature held',async()=>{
 for(const [group,key] of [['release','reports'],['release','receiptLink'],['release','custody'],['dependencies','read'],['dependencies','submit'],['dependencies','privateEvidence']]){
  const data=ready();data[group][key]=false;const result=await transferReadiness(fixture({data}).c,'it');assert.equal(result.ready,false);assert.equal(result.reason,'held');
 }
 for(const key of ['enabled','ready']){const data=ready();data[key]=false;assert.equal((await transferReadiness(fixture({data}).c,'it')).reason,'held');}
});
test('old, unavailable and unauthorized backends never authorize handoffs',async()=>{
 for(const [code,reason] of [['PGRST202','not_installed'],['42501','access'],['PGRST301','access'],['XX000','unavailable']]){
  assert.equal((await transferReadiness(fixture({error:{code,message:'do not echo backend contents'}}).c,'it')).reason,reason);
 }
 assert.equal((await transferReadiness(fixture(()=>{throw Error('network')}).c,'it')).reason,'unavailable');
});
test('inactive, archived, missing and wrong-role accounts cause no readiness RPC',async()=>{
 for(const values of [{active:false},{archived_at:'2026-10-16'},{id:null},{role:'service'}]){
  const f=fixture();Object.assign(f.state,values);assert.equal((await transferReadiness(f.c,'it')).ready,false);assert.deepEqual(f.calls,[]);
 }
});
test('late readiness success cannot authorize a different account or changed profile',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>{resolve=r}));const pending=transferReadiness(f.c,'it');await Promise.resolve();f.state.id='other';resolve({data:ready()});assert.equal((await pending).reason,'session_changed');
 let resolve2;const g=fixture(()=>new Promise(r=>{resolve2=r}));const pending2=transferReadiness(g.c,'it');await Promise.resolve();g.state.active=false;resolve2({data:ready()});assert.equal((await pending2).reason,'session_changed');
});
test('a timeout settles without late callback side effects or unhandled rejection',async()=>{
 let settle;const f=fixture(()=>new Promise(r=>{settle=r}));const result=await transferReadiness(f.c,'it',{timeoutMs:5});assert.equal(result.reason,'timeout');settle({data:ready()});await Promise.resolve();assert.equal(result.ready,false);
 let reject;const g=fixture(()=>new Promise((_,r)=>{reject=r}));assert.equal((await transferReadiness(g.c,'it',{timeoutMs:5})).reason,'timeout');reject(Error('late rejection'));await new Promise(r=>setTimeout(r,0));
});
test('direct transfer clients do not read records, upload or submit when rollout is held',async()=>{
 const f=fixture({data:{...ready(),ready:false}});f.c.db.storage={from:()=>{throw Error('must not reach storage')}};
 const client=transferClient(f.c);await assert.rejects(client.read(),/held/);await assert.rejects(client.submit({p_request_id:id},[{blob:new Blob(['test'])}]),/held/);
 assert.deepEqual(f.calls,[TRANSFER_READINESS_RPC,TRANSFER_READINESS_RPC]);
});
test('direct clients stop if the profile is disabled before submission',async()=>{
 const f=fixture();const client=transferClient(f.c);f.state.active=false;
 await assert.rejects(client.submit({p_request_id:id},[]),/session changed/);assert.deepEqual(f.calls,[]);
});

test('actual Owner uses the backend IT handoff scope without changing identity or accepting another role',async()=>{
 const f=fixture(name=>({data:name===TRANSFER_READINESS_RPC?ready():{version:1,role:'it',transfers:[],equipment:[],technicians:[]}}));
 f.state.role='owner';f.c.getProfile=()=>({user_id:f.state.id,role:f.state.role,active:true,archived_at:null});f.c.getEffectiveRole=()=>f.state.role;
 assert.equal((await transferReadiness(f.c,'owner')).ready,true);
 const client=transferClient(f.c);assert.equal(client.actor,id);assert.equal(client.owner(),true);assert.equal((await client.read()).role,'it');
 for(const response of [{...ready(),role:'owner'},{...ready(),role:'service'},{...ready(),actor_id:'other'},{...ready(),ready:false}]){
  const g=fixture({data:response});g.state.role='owner';g.c.getProfile=f.c.getProfile;assert.equal((await transferReadiness(g.c,'owner')).ready,false);
 }
 f.calls.length=0;f.c.getEffectiveRole=()=> 'it';assert.equal((await transferReadiness(f.c,'owner')).ready,false);assert.deepEqual(f.calls,[]);
});

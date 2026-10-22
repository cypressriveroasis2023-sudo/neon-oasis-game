import assert from 'node:assert/strict';
import test from 'node:test';
import {setImmediate} from 'node:timers/promises';
import {readFileSync} from 'node:fs';
import {createOperationsSessionRecovery,ownerSessionFingerprint,guardSessionCallback,SESSION_VERIFICATION_TIMEOUT_MS} from '../src/operationsSessionRecovery.ts';
const owner={authorized:true,legacyOwner:true,role:'Owner',name:'Synthetic Owner',productionOwnerUserId:'11111111-1111-4111-8111-111111111111',features:{fleetAccess:true,vrmRead:true,fleetPlacementEdit:true}};
const flush=()=>setImmediate();
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function fixture(session=owner){
 const requests=[],queue=[],states=[];let mode='';
 const controller=createOperationsSessionRecovery({read:()=>{const request=deferred();requests.push(request);return request.promise;},mode:()=>mode,changed:state=>states.push(state),defer:fn=>queue.push(fn)});
 const initial=controller.check();requests[0].resolve(structuredClone(session));await initial;
 return {controller,requests,queue,states,get state(){return states.at(-1);},set mode(value){mode=value;},run(){queue.splice(0).forEach(fn=>fn());}};
}
for(const reason of ['token-renewed','parent-timeout'])test(reason+' clears all private views before one identity-verified Owner recovery',async()=>{
 const f=await fixture(),before=f.state.generation;
 f.controller.invalidate(reason);assert.equal(f.state.session,null);assert.equal(f.state.checking,true);assert.equal(f.requests.length,1);assert.equal(f.state.generation,before+1);
 f.run();assert.equal(f.requests.length,2);assert.equal(f.state.session,null);
 f.requests[1].resolve({...owner,name:'Updated display name',features:{fleetPlacementEdit:true,vrmRead:true,fleetAccess:true}});await flush();
 assert.equal(f.state.session.name,'Updated display name');assert.equal(f.state.reloadRequired,false);assert.equal(f.state.checking,false);assert.ok(f.state.generation>before);
});
for(const [label,change] of [
 ['different actor',{productionOwnerUserId:'22222222-2222-4222-8222-222222222222'}],
 ['same name without actor',{productionOwnerUserId:null}],['different role',{role:'IT'}],['different legacy scope',{legacyOwner:false}],
 ['authorization revoked',{authorized:false}],['capability downgrade',{features:{...owner.features,vrmRead:false}}],
 ['added capability',{features:{...owner.features,newPermission:true}}],['removed capability',{features:{fleetAccess:true,vrmRead:true}}],
 ['malformed capability',{features:{...owner.features,vrmRead:'true'}}],['missing capability map',{features:null}],
])test('revalidation blocks '+label+' and cannot refill the old view',async()=>{
 const f=await fixture();f.controller.invalidate('token-renewed');f.run();f.requests[1].resolve({...owner,...change});await flush();assert.equal(f.state.session,null);assert.equal(f.state.reloadRequired,true);assert.match(f.state.error,/Reload COS Operations/);f.controller.check();assert.equal(f.requests.length,2);
});
for(const session of [{...owner,legacyOwner:false,role:'IT',productionOwnerUserId:null},{...owner,productionOwnerUserId:undefined},{...owner,features:{}}])test('a session without a complete verified Owner identity never automatically revalidates',async()=>{
 const f=await fixture(session);f.controller.invalidate('token-renewed');f.run();assert.equal(f.requests.length,1);assert.equal(f.state.session,null);assert.equal(f.state.reloadRequired,true);
});
for(const reason of [undefined,'unknown','authentication-denied','security-hide',{},''])test('hard or unrecognized reason '+JSON.stringify(reason)+' requires reload without another read',async()=>{
 const f=await fixture();f.controller.invalidate(reason);f.run();assert.equal(f.state.reloadRequired,true);assert.equal(f.state.session,null);assert.equal(f.requests.length,1);
});
test('soft bursts coalesce, but a hard queued event dominates every later soft event',async()=>{
 const f=await fixture();f.controller.invalidate('token-renewed');f.controller.invalidate('parent-timeout');assert.equal(f.queue.length,1);f.run();assert.equal(f.requests.length,2);f.requests[1].resolve(owner);await flush();assert.ok(f.state.session);
 f.controller.invalidate('token-renewed');f.controller.invalidate('authentication-denied');f.controller.invalidate('parent-timeout');f.run();assert.equal(f.requests.length,2);assert.equal(f.state.reloadRequired,true);assert.equal(f.state.session,null);
});
for(const reason of ['parent-timeout','authentication-denied','security-hide',undefined])test('new '+String(reason)+' during verification fences its late successful response without reentrancy',async()=>{
 const f=await fixture();f.controller.invalidate('token-renewed');f.run();f.controller.invalidate(reason);f.requests[1].resolve(owner);await flush();f.run();assert.equal(f.state.session,null);assert.equal(f.state.reloadRequired,true);assert.equal(f.requests.length,2);
});
test('mode changes before or during revalidation fail closed',async()=>{
 for(const stage of ['before','during']){const f=await fixture();f.controller.invalidate('token-renewed');if(stage==='before')f.mode='fleet';f.run();if(stage==='during')f.mode='fleet';f.requests[1].resolve(owner);await flush();assert.equal(f.state.session,null);assert.equal(f.state.reloadRequired,true);}
});
test('revalidation network failure is terminal and does not retry automatically or replay a write',async()=>{
 const f=await fixture();f.controller.invalidate('parent-timeout');f.run();f.requests[1].reject(new Error('Synthetic unavailable'));await flush();f.run();f.controller.check();assert.equal(f.state.reloadRequired,true);assert.equal(f.requests.length,2);
 const hook=readFileSync(new URL('../src/useOperationsSession.ts',import.meta.url),'utf8');assert.match(hook,/api\.get\('\/api\/session'\)/);assert.doesNotMatch(hook,/api\.post/);
});
test('unmount/logout discards even a successful pending verification',async()=>{
 const f=await fixture();f.controller.invalidate('token-renewed');f.run();f.controller.stop();const count=f.states.length;f.requests[1].resolve(owner);await flush();assert.equal(f.states.length,count);assert.equal(f.state.session,null);
});
test('initial stale authorization is rejected when a security boundary intervenes',async()=>{
 const pending=deferred(),states=[];const controller=createOperationsSessionRecovery({read:()=>pending.promise,mode:()=>'',changed:state=>states.push(state)});const checking=controller.check();controller.invalidate('security-hide');pending.resolve(owner);await checking;assert.equal(states.at(-1).session,null);assert.equal(states.at(-1).reloadRequired,true);
});
test('Owner fingerprint compares every capability while excluding mutable display names',()=>{
 assert.equal(ownerSessionFingerprint(owner,''),ownerSessionFingerprint({...owner,name:'Different name'},''));assert.notEqual(ownerSessionFingerprint(owner,''),ownerSessionFingerprint({...owner,features:{...owner.features,newFalseCapability:false}},''));
});
test('App keys the entire authorized subtree by verified generation and removes private route selections',()=>{
 const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');assert.match(app,/<Fragment key=\{sessionGeneration\}>/);assert.match(app,/setRouteLocation\(\{workspace:active,jobId:'',detail:false\},true\)/);assert.match(app,/history\.replaceState\(null/);assert.match(app,/!reloadRequired&&/);
 const hook=readFileSync(new URL('../src/useOperationsSession.ts',import.meta.url),'utf8');assert.match(hook,/window\.addEventListener\('pagehide', leave\)/);assert.match(hook,/current\.stop\(\)/);
});

test('ordinary legacy navigation hides a healthy session without reauthorizing or changing its actor',async()=>{
 const f=await fixture(),saved=f.state;assert.equal(f.controller.hide(),false);assert.equal(f.state,saved);assert.equal(f.requests.length,1);assert.equal(f.controller.isCurrent(saved.generation),true);
 // A later recovery still requires that original verified Owner, even after healthy hide.
 f.controller.invalidate('token-renewed');f.run();f.requests[1].resolve({...owner,productionOwnerUserId:'22222222-2222-4222-8222-222222222222'});await flush();assert.equal(f.state.session,null);assert.equal(f.state.reloadRequired,true);
});
for(const phase of ['queued','verifying'])test('trusted hide in '+phase+' recovery makes all later results reload-required',async()=>{
 const f=await fixture();f.controller.invalidate('token-renewed');if(phase==='verifying')f.run();assert.equal(f.controller.hide(),true);f.run();if(phase==='verifying')f.requests[1].resolve(owner);await flush();assert.equal(f.state.session,null);assert.equal(f.state.reloadRequired,true);assert.equal(f.requests.length,phase==='queued'?1:2);
});
test('retained old toast/navigation callbacks cannot update the shell during or after revalidation',async()=>{
 const f=await fixture(),messages=[],routes=[],oldGeneration=f.state.generation;
 const oldShow=guardSessionCallback(f.controller.isCurrent,oldGeneration,message=>messages.push(message)),oldNavigate=guardSessionCallback(f.controller.isCurrent,oldGeneration,route=>routes.push(route));
 oldShow('Current safe message');oldNavigate('Current route');assert.deepEqual(messages,['Current safe message']);assert.deepEqual(routes,['Current route']);
 f.controller.invalidate('token-renewed');messages.length=0;routes.length=0;oldShow('Late captured private unit');oldNavigate('Late private unit route');assert.deepEqual(messages,[]);assert.deepEqual(routes,[]);
 f.run();f.requests[1].resolve(owner);await flush();oldShow('Old generation after recovery');oldNavigate('Old route after recovery');assert.deepEqual(messages,[]);assert.deepEqual(routes,[]);
 const currentShow=guardSessionCallback(f.controller.isCurrent,f.state.generation,message=>messages.push(message));currentShow('Fresh verified view');assert.deepEqual(messages,['Fresh verified view']);f.controller.stop();currentShow('After logout');assert.deepEqual(messages,['Fresh verified view']);
});
test('every parent callback that private children retain is generation guarded',()=>{
 const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
 for(const callback of ['show','navigate','openUnitHealth','returnToMap','createTicket','cancelCreateTicket','openJob','selectOverviewJob','openLifecycle','backToOverviewJobs','onTvChange'])assert.ok(app.includes('const '+callback+'=useCallback(guardCurrent('),callback);
 assert.match(app,/onSelectUnit=\{guardCurrent\(/);assert.match(app,/registerEquipment=\{guardCurrent\(/);assert.match(app,/onTvChange=\{onTvChange\}/);
});


test('a stalled initial account read leaves verification and supports a fresh manual retry',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const requests=[],states=[];
 const controller=createOperationsSessionRecovery({read:()=>{const request=deferred();requests.push(request);return request.promise;},mode:()=>'',changed:state=>states.push(state)});
 const initial=controller.check();
 t.mock.timers.tick(SESSION_VERIFICATION_TIMEOUT_MS);await initial;
 assert.equal(states.at(-1).checking,false);assert.equal(states.at(-1).session,null);assert.equal(states.at(-1).reloadRequired,false);assert.match(states.at(-1).error,/verification timed out/);
 const retry=controller.check();assert.equal(requests.length,2);
 requests[0].resolve(owner);await flush();assert.equal(states.at(-1).session,null);assert.equal(states.at(-1).checking,true);
 requests[1].resolve(owner);await retry;assert.equal(states.at(-1).session.authorized,true);assert.equal(states.at(-1).checking,false);controller.stop();
});
test('a stalled recovery requires reload and never restores a late authorized response',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=await fixture();f.controller.invalidate('token-renewed');f.run();
 t.mock.timers.tick(SESSION_VERIFICATION_TIMEOUT_MS);await flush();
 assert.equal(f.state.checking,false);assert.equal(f.state.session,null);assert.equal(f.state.reloadRequired,true);
 f.requests[1].resolve(owner);await flush();assert.equal(f.state.session,null);assert.equal(f.state.reloadRequired,true);f.controller.stop();
});

for (const first of ['parent-timeout','token-renewed']) test(first+' followed by renewal during verification requires a fresh verified read', async()=>{
 const f=await fixture();f.controller.invalidate(first);f.run();
 f.controller.invalidate('token-renewed');assert.equal(f.state.reloadRequired,false);assert.equal(f.state.session,null);
 f.run();assert.equal(f.requests.length,3);
 f.requests[1].resolve({...owner,productionOwnerUserId:'22222222-2222-4222-8222-222222222222'});await flush();assert.equal(f.state.session,null);
 f.requests[2].resolve(owner);await flush();assert.equal(f.state.reloadRequired,false);assert.ok(f.state.session);f.controller.stop();
});
for(const change of [{productionOwnerUserId:'22222222-2222-4222-8222-222222222222'},{features:{...owner.features,vrmRead:false}},{authorized:false}]) test('replacement recovery rejects changed identity or permissions '+JSON.stringify(change),async()=>{
 const f=await fixture();f.controller.invalidate('parent-timeout');f.run();f.controller.invalidate('token-renewed');f.run();
 assert.equal(f.requests.length,3);f.requests[2].resolve({...owner,...change});await flush();assert.equal(f.state.reloadRequired,true);assert.equal(f.state.session,null);f.requests[1].resolve(owner);await flush();assert.equal(f.state.session,null);f.controller.stop();
});
test('replacement verification remains bounded and hard stops dominate',async()=>{
 for(const reason of ['token-renewed','authentication-denied','security-hide']){
  const f=await fixture();f.controller.invalidate('parent-timeout');f.run();f.controller.invalidate('token-renewed');f.run();assert.equal(f.requests.length,3);
  f.controller.invalidate(reason);f.requests[1].resolve(owner);f.requests[2].resolve(owner);await flush();f.run();assert.equal(f.requests.length,3);assert.equal(f.state.reloadRequired,true);assert.equal(f.state.session,null);f.controller.stop();
 }
});
test('obsolete verification cleanup cannot cancel the replacement deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=await fixture();f.controller.invalidate('parent-timeout');f.run();f.controller.invalidate('token-renewed');f.run();
 f.requests[1].resolve(owner);await flush();
 t.mock.timers.tick(SESSION_VERIFICATION_TIMEOUT_MS);await flush();
 assert.equal(f.state.reloadRequired,true);assert.equal(f.state.session,null);
 f.requests[2].resolve(owner);await flush();assert.equal(f.state.session,null);f.controller.stop();
});
test('renewal restart cannot accept a changed mode and a later independent renewal still recovers',async()=>{
 const f=await fixture();f.controller.invalidate('parent-timeout');f.run();f.mode='fleet';f.controller.invalidate('token-renewed');f.run();assert.equal(f.state.reloadRequired,true);assert.equal(f.requests.length,2);f.requests[1].resolve(owner);await flush();f.controller.stop();
 const g=await fixture();g.controller.invalidate('parent-timeout');g.run();g.controller.invalidate('token-renewed');g.run();g.requests[1].resolve(owner);g.requests[2].resolve(owner);await flush();
 g.controller.invalidate('token-renewed');g.run();g.requests[3].resolve(owner);await flush();assert.ok(g.state.session);assert.equal(g.state.reloadRequired,false);g.controller.stop();
});

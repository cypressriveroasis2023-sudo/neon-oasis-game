import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {collectScheduledDirect,directCandidates,directPublicHost,scheduledOrder,boundedRequest} from '../../supabase/functions/_shared/scheduledDirectService.ts';
import {cameraEvidence,serviceEvidence,cameraState,serviceState} from '../../supabase/functions/cos-operations-pages/cameraEvidence.ts';
const stamp='2026-10-09T08:00:00Z',now=Date.parse(stamp),clone=x=>structuredClone(x);
const master=(over={})=>({canonical_family:'Sniper',unit_tag:'108',source_label:'Sniper 108',tracker_state:'shop',...over});
const device=(over={})=>({id:518,unit_key:'SNIPER 108',device_name:'Sniper 108',source:'2026_unit_tracker',public_ip:'8.8.4.4',expected_ports:[80,443],connection_revision:2,monitoring_profile:'sniper',monitoring_enabled:true,activation_state:'deactivated',organization:'root',...over});
function fixture({masters=[master()],devices=[device()]}={}){
 const state={masters:clone(masters),devices:clone(devices),health:[],writes:[],reads:[],cron:true,failRead:null,hangRead:null,hangPublish:false,publishError:false,beforePublish:null,aborted:0};
 const db={from(table){let ids,signal,mutation,patterns;const filters=[];const q={select(){return q},limit(){return q},in(k,v){if(k==='camera_device_id')ids=v;else filters.push([k,v]);return q},eq(){return q},or(value){patterns=value.split(',').map(p=>new RegExp('^'+p.replace('unit_key.ilike.','').replaceAll('%','[\\s\\S]*')+'$','i'));return q},is(){return q},update(v){mutation=v;return q},abortSignal(s){signal=s;return q},then(resolve,reject){
  state.reads.push(table);signal?.addEventListener('abort',()=>state.aborted++,{once:true});
  if(state.hangRead===table)return new Promise(()=>{}).then(resolve,reject);
  if(mutation){state.writes.push({table,mutation});return Promise.resolve({data:[{id:1}]}).then(resolve,reject);}
  const all=table==='equipment_master'?state.masters:table==='camera_devices'?state.devices:table==='camera_health_current'?state.health.filter(h=>!ids||ids.includes(h.camera_device_id)):[];
  const data=all.filter(row=>filters.every(([key,values])=>values.includes(row[key]))&&(!patterns||patterns.some(p=>p.test(row.unit_key))));
  return Promise.resolve({data:clone(data),error:state.failRead===table?{message:'denied'}:null}).then(resolve,reject);
 }};return q;},rpc(name,args){let signal;const q={abortSignal(s){signal=s;return q},then(resolve,reject){
  if(name==='verify_camera_health_cron_secret')return Promise.resolve({data:state.cron}).then(resolve,reject);
  signal?.addEventListener('abort',()=>state.aborted++,{once:true});
  if(state.hangPublish)return new Promise(()=>{}).then(resolve,reject);
  state.beforePublish?.();const d=state.devices.find(d=>d.id===args.p_device_id),prev=state.health.find(h=>h.camera_device_id===d?.id);
  if(state.publishError)return Promise.resolve({error:{message:'permission denied'}}).then(resolve,reject);
  if(!d||d.connection_revision!==args.p_revision||d.public_ip!==args.p_public_ip||JSON.stringify(d.expected_ports)!==JSON.stringify(args.p_expected_ports))return Promise.resolve({data:{ok:false,reason:'connection_changed'}}).then(resolve,reject);
  if(Date.parse(prev?.port_status?._connection?.checkedAt)>Date.parse(args.p_health.checked_at))return Promise.resolve({data:{ok:false,reason:'newer_observation'}}).then(resolve,reject);
  state.writes.push({table:'publisher',args:clone(args)});const h=clone(args.p_health);h.port_status._connection={revision:String(d.connection_revision),ip:d.public_ip,checkedAt:h.checked_at,status:h.overall_status,reachable:h.ip_reachable,consecutiveFailures:h.consecutive_failures};
  state.health=state.health.filter(x=>x.camera_device_id!==d.id).concat(h);
  return Promise.resolve({data:{ok:true,revision:d.connection_revision,checked_at:h.checked_at}}).then(resolve,reject);
 }};return q;}};
 return {state,db,run:(probe=async()=>({online:true,latency_ms:1}),options={})=>collectScheduledDirect(db,probe,{now:()=>now,...options})};
}
test('shop, field and legacy shop/deactivated pairs are eligible without reactivation; complete variants stay separate',()=>{
 for(const tracker_state of ['shop','field_or_unknown'])for(const activation_state of ['active','deactivated'])assert.equal(directCandidates([master({tracker_state})],[device({activation_state})]).selected.length,1);
 const m=master({canonical_family:'Sniper 4',unit_tag:'100',source_label:'Sniper 4 100'});
 assert.equal(directCandidates([m],[device({unit_key:'SNIPER 4 100'})]).selected.length,1);
 for(const unit_key of ['SNIPER 100','SNIPER 4100','SNIPER 2 100','100'])assert.equal(directCandidates([m],[device({unit_key})]).selected.length,0);
 assert.equal(directCandidates([master({canonical_family:'CAMV',unit_tag:'008',source_label:'CAMV 008'})],[device({unit_key:'CAM V 008',monitoring_profile:'camv'})]).selected.length,1);
});
test('retired, DNU, stolen and decommissioned evidence is excluded; a hostname, router or shared IP cannot establish identity',()=>{
 for(const patch of [{tracker_state:'retired'},{source_label:'Sniper 108 DNU'}])assert.equal(directCandidates([master(patch)],[device()]).selected.length,0);
 for(const patch of [{organization:'DNU'},{organization:'DO NOT USE'},{device_name:'Sniper 108 - Stolen'},{activation_state:'decommissioned'},{source:'vigilant_control_center'},{source:'manual'},{monitoring_enabled:false},{unit_key:'Sniper 166'},{monitoring_profile:'reconeyez'}])assert.equal(directCandidates([master()],[device(patch)]).selected.length,0);
 for(const ip of [null,'10.0.0.1','127.0.0.1','169.254.169.254','203.0.113.1','camera.example.com','8.8.4.4:443','8.8.4.4/24','https://8.8.4.4'])assert.equal(directPublicHost(ip),null);
 assert.equal(directPublicHost('8.8.4.4/32'),'8.8.4.4');
});
test('ambiguous pairs and missing saved endpoint/ports/revision are held, with no invented default connection',()=>{
 for(const [m,d] of [[[master(),master()],[device()]],[[master()],[device(),device({id:519})]]])assert.equal(directCandidates(m,d).selected.length,0);
 for(const patch of [{public_ip:null},{expected_ports:[]},{expected_ports:[443,443]},{expected_ports:['443']},{expected_ports:[0]},{connection_revision:null},{id:9007199254740992}])assert.equal(directCandidates([master()],[device(patch)]).selected.length,0);
 assert.equal(directCandidates([master({unit_tag:'108.1',source_label:'Sniper 108.1'})],[device({unit_key:'SNIPER 108.1'})]).selected.length,0);
 const candidates=directCandidates([master(),master({unit_tag:'166',source_label:'Sniper 166'})],[device(),device({id:545,unit_key:'SNIPER 166'})]);
 assert.equal(candidates.selected.length,2);assert.notEqual(candidates.selected[0].device.id,candidates.selected[1].device.id);assert.equal(candidates.selected[0].host,candidates.selected[1].host);
});
test('only configured service ports are probed and placement/source are preserved',async()=>{
 const f=fixture(),before=clone([f.state.masters,f.state.devices]),ports=[];
 const r=await f.run(async(host,p)=>{assert.equal(host,'8.8.4.4');ports.push(p);return {online:p===443,latency_ms:1};});
 assert.deepEqual(ports,[80,443]);assert.equal(r.results[0].published,true);assert.deepEqual([f.state.masters,f.state.devices],before);
 assert.equal(f.state.writes.length,1);assert.equal(f.state.writes[0].table,'publisher');assert.equal(f.state.writes[0].args.p_source,'automatic_tcp_sweep');
 const d=f.state.devices[0],h=f.state.health[0],e=serviceEvidence(d,h,false,now);
 assert.equal(e.kind,'service_port');assert.equal(e.status,'online');assert.equal(cameraState({activationState:'active',evidence:cameraEvidence(d)},now),'verifying');
 assert.equal(serviceState({activationState:'deactivated',serviceEvidence:e},now),'verifying');
 assert.doesNotMatch(JSON.stringify(r),/8\.8\.4\.4/);
});
test('fresh reread holds retired/DNU/ownership/identity/endpoint changes without incrementing counters',async()=>{
 for(const mutate of [s=>s.masters[0].tracker_state='retired',s=>s.devices[0].organization='DNU',s=>s.devices[0].source='manual',s=>s.devices.push(device({id:519,monitoring_enabled:false})),s=>s.devices[0].public_ip='8.8.8.8',s=>s.devices[0].expected_ports=[8443],s=>s.masters[0].source_label='SNIPER 108']){
  const f=fixture();let done=false;const r=await f.run(async()=>{if(!done){done=true;mutate(f.state);}return {online:false,latency_ms:null};});
  assert.equal(r.results[0].status,'unknown');assert.equal(f.state.writes.length,0);
 }
});
test('Shop and Field changes during a check retain endpoint history without placement writes',async()=>{
 const f=fixture();const r=await f.run(async()=>{f.state.masters[0].tracker_state='field_or_unknown';f.state.devices[0].organization='Synthetic site';f.state.devices[0].activation_state='active';return {online:true,latency_ms:1};});
 assert.equal(r.results[0].published,true);assert.equal(f.state.writes.every(w=>w.table==='publisher'),true);
});
test('existing endpoint CAS and newer result rejection remain publication gates',async()=>{
 for(const newer of [false,true]){
  const f=fixture();f.state.beforePublish=()=>{if(!newer)f.state.devices[0].connection_revision++;else f.state.health=[{camera_device_id:518,port_status:{_connection:{checkedAt:new Date(now+1000).toISOString()}}}];};
  const r=await f.run();assert.equal(r.results[0].published,false);assert.equal(f.state.writes.length,0);
 }
});
test('three actual failed observations count; malformed, auth-failed or stale probes remain unverified',async()=>{
 const f=fixture(),fail=async()=>({online:false,latency_ms:null,error:'Connection refused'});
 for(const status of ['verifying','verifying','offline'])assert.equal((await f.run(fail)).results[0].status,status);
 for(const probe of [async()=>({online:false,latency_ms:null,error:'Unauthorized'}),async()=>({online:'false',latency_ms:null}),async()=>{throw Error('collector failed');}]){
  const g=fixture();assert.equal((await g.run(probe)).results[0].status,'unknown');assert.equal(g.state.writes.length,0);
 }
 const g=fixture();let time=now;const r=await g.run(async()=>{time=now+60_000;return {online:false,latency_ms:null};},{startedAt:now,now:()=>time});assert.equal(r.results[0].status,'unknown');assert.equal(g.state.writes.length,0);
});
test('hung inventory and publication requests abort and settle without false outages',async()=>{
 const a=fixture();a.state.hangRead='equipment_master';const start=performance.now();await assert.rejects(()=>a.run(undefined,{ioTimeoutMs:20}),/timed out/);assert.ok(performance.now()-start<500);assert.ok(a.state.aborted>0);assert.equal(a.state.writes.length,0);
 const b=fixture();b.state.hangPublish=true;const r=await b.run(undefined,{ioTimeoutMs:20});assert.equal(r.results[0].status,'unknown');assert.ok(b.state.aborted>0);assert.equal(b.state.writes.length,0);
 const c=fixture();c.state.publishError=true;assert.equal((await c.run()).results[0].status,'unknown');assert.equal(c.state.writes.length,0);
});
test('missing/held rows consume no queue slots and a rotating window prevents repeated-oldest starvation',async()=>{
 const masters=Array.from({length:179},(_,i)=>master({unit_tag:String(i+1),source_label:'Sniper '+(i+1)}));
 const devices=masters.map((m,i)=>device({id:i+1,unit_key:m.source_label,last_health_checked_at:i<30?null:stamp}));
 const candidates=directCandidates(masters,devices).selected,seen=new Set();
 for(let cycle=0;cycle<18;cycle++)scheduledOrder(candidates,cycle*900_000).slice(0,10).forEach(c=>seen.add(c.device.id));assert.equal(seen.size,179);
 const f=fixture({masters,devices:devices.map((d,i)=>i<150?{...d,public_ip:null}:d)});let count=0;const r=await f.run(async()=>{count++;return {online:true,latency_ms:1};});
 assert.equal(r.eligible,29);assert.equal(r.held.length,150);assert.equal(r.results.length,29);assert.equal(count,2); // One shared transport, with 29 independent guarded publications.
});
test('deadline stops new waves, preserves unfinished timestamps and leaves later cycles eligible',async()=>{
 const masters=Array.from({length:21},(_,i)=>master({unit_tag:String(i+1),source_label:'Sniper '+(i+1)})),devices=masters.map((m,i)=>device({id:i+1,unit_key:m.source_label}));
 const f=fixture({masters,devices});let time=now;const r=await f.run(async()=>{time=now+46_000;return {online:true,latency_ms:1};},{startedAt:now,now:()=>time});
 assert.equal(r.results.length,10);assert.equal(r.deferred,11);assert.equal(r.deadlineReached,true);assert.ok(f.state.devices.every(d=>!d.last_health_checked_at));
});
test('cron authorization precedes inventory and sockets; methods and roles stay unchanged',async()=>{
 const source=await readFile(new URL('../../supabase/functions/camera-health-sweep/index.ts',import.meta.url),'utf8');
 for(const cron of [false,true]){
  const f=fixture();f.state.cron=cron;let handler,probes=0;
  const js=ts.transpileModule(source.replace(/^import .*;\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  vm.runInNewContext(js,{createClient:()=>f.db,collectScheduledDirect,boundedRequest,fetch,AbortSignal,AbortController,Request,Response,Date,setTimeout,clearTimeout,Deno:{env:{get:()=>''},serve:h=>handler=h,connect:async()=>{probes++;return {close(){}};}}});
  assert.equal((await handler(new Request('https://example.test',{method:'GET'}))).status,405);
  const response=await handler(new Request('https://example.test',{method:'POST',body:'{}'}));assert.equal(response.status,cron?200:403);
  if(!cron){assert.equal(f.state.reads.length,0);assert.equal(probes,0);}else assert.equal(probes,2);
 }
});
test('router/auth transport timeouts stay unknown or forbidden and cannot fabricate outages',async()=>{
 const source=await readFile(new URL('../../supabase/functions/camera-health-sweep/index.ts',import.meta.url),'utf8');
 const js=ts.transpileModule(source.replace(/^import .*;\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 for(const mode of ['auth','router_read','router_publish']){
  let handler,transport,probes=0,timeoutRequested=[];const f=fixture();
  const stalled=()=>transport('https://example.test').then(()=>({data:null}),()=>({data:null,error:{message:'transport aborted'}}));
  const db={...f.db,rpc:(name,args)=>mode==='auth'?stalled():f.db.rpc(name,args),from(table){
   if(table!=='camera_unit_routers')return f.db.from(table);
   let writing=false;const q={select(){return q},or(){return q},eq(){return q},is(){return q},update(){writing=true;return q},then(resolve,reject){
    if(mode==='router_read'||writing)return stalled().then(resolve,reject);
    return Promise.resolve({data:[{id:1,unit_key:'Synthetic router',router_public_ip:'8.8.4.5',web_port:8080,updated_at:stamp,current_status:'online'}]}).then(resolve,reject);
   }};return q;
  }};
  vm.runInNewContext(js,{createClient:(_u,_k,options)=>{transport=options.global.fetch;return db;},collectScheduledDirect,boundedRequest,
   fetch:(_input,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true})),
   AbortSignal:{any:AbortSignal.any,timeout:ms=>{timeoutRequested.push(ms);return AbortSignal.timeout(10);}},AbortController,Request,Response,Date,setTimeout,clearTimeout,
   Deno:{env:{get:()=>''},serve:h=>handler=h,connect:async()=>{probes++;return {close(){}};}}});
  const keepAlive=setTimeout(()=>{},1000);
  const response=await handler(new Request('https://example.test',{method:'POST',body:'{}'}));clearTimeout(keepAlive);
  assert.ok(timeoutRequested.every(ms=>ms<=4000));
  if(mode==='auth'){assert.equal(response.status,403);assert.equal(probes,0);assert.equal(f.state.writes.length,0);}
  else{const data=await response.json();assert.equal(data.router_results[0].status,'unknown');assert.equal(data.router_results.some(r=>r.status==='offline'),false);assert.equal(f.state.writes.some(w=>w.table==='camera_unit_routers'),false);}
 }
});
test('socket timeout settles even if cancellation is ignored, and closes a late connection',async()=>{
 const source=await readFile(new URL('../../supabase/functions/camera-health-sweep/index.ts',import.meta.url),'utf8');
 const js=ts.transpileModule(source.replace(/^import .*;\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 let closes=0,signal;
 const context=vm.createContext({createClient(){},collectScheduledDirect,boundedRequest,AbortController,Date,setTimeout,clearTimeout,Deno:{serve(){},connect:options=>{signal=options.signal;return new Promise(resolve=>setTimeout(()=>resolve({close(){closes++;}}),20));}}});
 vm.runInContext(js,context);
 const result=await context.tcp('8.8.4.4',443,1);
 assert.equal(result.online,false);assert.equal(result.error,'timeout');assert.equal(signal.aborted,true);
 await new Promise(resolve=>setTimeout(resolve,30));assert.equal(closes,1);
});
test('bounded wave rereads retain case/whitespace aliases and disabled foreign-profile duplicates',async()=>{
 for(const cam of [false,true]){
  const m=cam?master({canonical_family:'CAMV',unit_tag:'008',source_label:'CAMV 008'}):master();
  const d=cam?device({unit_key:'CAM V 008',monitoring_profile:'camv'}):device();
  const f=fixture({masters:[m],devices:[d]});let added=false;
  const r=await f.run(async()=>{if(!added){added=true;f.state.devices.push({...d,id:519,unit_key:cam?'  cAm\tV  008  ':'  sNiPeR\t108  ',monitoring_enabled:false,monitoring_profile:'foreign',source:'other_provider'});}return {online:true,latency_ms:1};});
  assert.equal(r.results[0].published,false);assert.equal(r.results[0].reason,'source_or_connection_changed');assert.equal(f.state.writes.length,0);
 }
});
async function heartbeatFixture(outcome,{collectorError=false,saveError=false}={}){
 const f=fixture();let handler;
 const source=await readFile(new URL('../../supabase/functions/camera-health-sweep/index.ts',import.meta.url),'utf8');
 const js=ts.transpileModule(source.replace(/^import .*;\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const db={...f.db,from:table=>saveError&&table==='camera_integrations'?{update(){return this},eq(){return this},select(){return this},abortSignal(){return this},then(resolve){return Promise.resolve({error:{message:'unavailable'}}).then(resolve);}}:f.db.from(table)};
 vm.runInNewContext(js,{createClient:()=>db,collectScheduledDirect:async()=>{if(collectorError)throw Error('unavailable');return outcome;},boundedRequest,fetch,AbortSignal,AbortController,Request,Response,Date,setTimeout,clearTimeout,Deno:{env:{get:()=>''},serve:h=>handler=h,connect:async()=>{throw Error('No fixture probe expected');}}});
 const response=await handler(new Request('https://example.test',{method:'POST',body:'{}'}));
 return {state:f.state,status:response.status,body:await response.json(),saved:f.state.writes.find(w=>w.table==='camera_integrations')?.mutation};
}
test('heartbeat persists held, deferred and unverified coverage even with zero publications',async()=>{
 const scenarios=[
  {results:[],eligible:0,held:[{reason:'saved_endpoint_unavailable'}],deferred:0,deadlineReached:false},
  {results:[{published:false,status:'unknown',reason:'publication_unverified'}],eligible:1,held:[],deferred:0,deadlineReached:false},
  {results:[{published:true,status:'online'}],eligible:3,held:[],deferred:2,deadlineReached:true},
 ];
 for(const outcome of scenarios){
  const r=await heartbeatFixture(outcome);assert.equal(r.status,200);assert.equal(r.body.coverage_recorded,true);assert.equal(r.saved.last_sync_status,'partial');
  const m=r.saved.metadata;assert.equal(m.complete,false);assert.equal(m.eligible,outcome.eligible);assert.equal(m.held,outcome.held.length);assert.equal(m.deferred,outcome.deferred);assert.equal(m.deadline_reached,outcome.deadlineReached);
  assert.equal(m.published,outcome.results.filter(x=>x.published).length);assert.equal(m.unverified,outcome.results.filter(x=>!x.published).length);assert.equal(m.offline,0);assert.equal(m.counts_known,true);assert.ok(m.reason);assert.ok(r.saved.last_error);
  assert.equal(r.state.writes.every(w=>w.table==='camera_integrations'),true);
 }
 const complete=await heartbeatFixture({results:[{published:true,status:'online'}],eligible:1,held:[],deferred:0,deadlineReached:false});
 assert.equal(complete.saved.last_sync_status,'ok');assert.equal(complete.saved.metadata.complete,true);assert.equal(complete.saved.last_error,null);
});
test('collector failure records unknown coverage; heartbeat persistence failure is explicit',async()=>{
 const failed=await heartbeatFixture(null,{collectorError:true});assert.equal(failed.status,503);assert.equal(failed.body.coverage_recorded,true);assert.equal(failed.saved.last_sync_status,'partial');
 for(const key of ['eligible','held','deferred','scanned','published','unverified','online','offline','verifying'])assert.equal(failed.saved.metadata[key],null);
 assert.equal(failed.saved.metadata.counts_known,false);assert.equal(failed.saved.metadata.reason,'collector_unavailable');assert.equal(failed.state.writes.length,1);
 const unavailable=await heartbeatFixture({results:[],eligible:0,held:[],deferred:0,deadlineReached:false},{saveError:true});
 assert.equal(unavailable.status,503);assert.equal(unavailable.body.coverage_recorded,false);assert.equal(unavailable.state.writes.length,0);
});
test('existing diagnostic reader tolerates partial Avigilon metadata without fabricating camera outage',async()=>{
 const html=await readFile(new URL('../../camera-health.html',import.meta.url),'utf8'),fn=html.match(/^function diagnosticReportMarkup\(.*$/m)?.[0];assert.ok(fn);
 const context=vm.createContext({boardDataReady:true,unitDiagnosticFailures:new Set(),unitDiagnosticPending:new Set(),health:{},Date,esc:x=>String(x),CameraDiagnosticReport:{report:(_u,_d,_h,_n,options)=>JSON.stringify(options)},integrationMeta:{avigilon:{last_sync_status:'partial',metadata:{source:'owned_saved_service_ports',complete:false,eligible:1,held:0,deferred:0,published:0,unverified:1,deadline_reached:false}}}});
 vm.runInContext(fn,context);const markup=context.diagnosticReportMarkup('Synthetic',[]);
 assert.match(markup,/"unavailable":false/);assert.match(markup,/"unavailableProviders":\[\]/);
 assert.equal(cameraState({activationState:'active',evidence:cameraEvidence(device())},now),'verifying');
});

test('identical endpoint sets share one in-run observation but keep independent identities and counters',async()=>{
 const f=fixture({masters:[master(),master({unit_tag:'166',source_label:'Sniper 166',tracker_state:'field_or_unknown'})],devices:[device(),device({id:545,unit_key:'SNIPER 166',connection_revision:7,expected_ports:[443,80]})]});
 let calls=0;const fail=async()=>{calls++;return {online:false,latency_ms:null,error:'Connection refused'};};
 await f.run(fail);assert.equal(calls,2);assert.equal(f.state.writes.length,2);
 assert.deepEqual(f.state.health.map(h=>h.consecutive_failures),[1,1]);
 const one=f.state.health.find(h=>h.camera_device_id===545);one.port_status._connection.consecutiveFailures=2;
 await f.run(fail);assert.equal(calls,4); // A new invocation does not reuse the old transport.
 assert.equal(f.state.health.find(h=>h.camera_device_id===518).consecutive_failures,2);
 assert.equal(f.state.health.find(h=>h.camera_device_id===545).consecutive_failures,3);
 assert.deepEqual(new Set(f.state.writes.map(w=>w.args.p_revision)),new Set([2,7]));
 assert.deepEqual(f.state.masters.map(m=>m.tracker_state),['shop','field_or_unknown']);
});
test('shared transport never bypasses either identity reread or endpoint/newer-result CAS',async()=>{
 for(const mode of ['retired','ownership','endpoint','newer']){
  const f=fixture({masters:[master(),master({unit_tag:'166',source_label:'Sniper 166'})],devices:[device(),device({id:545,unit_key:'SNIPER 166'})]});let calls=0;
  if(mode==='endpoint')f.state.beforePublish=()=>{f.state.devices[1].connection_revision=3;};
  if(mode==='newer')f.state.beforePublish=()=>{f.state.health=f.state.health.filter(h=>h.camera_device_id!==545).concat({camera_device_id:545,port_status:{_connection:{checkedAt:new Date(now+1000).toISOString()}}});};
  const r=await f.run(async()=>{calls++;if(mode==='retired')f.state.masters[1].tracker_state='retired';if(mode==='ownership')f.state.devices[1].source='manual';return {online:false,latency_ms:null,error:'Connection refused'};});
  assert.equal(calls,2);assert.equal(r.results.find(r=>r.id===518).published,true);assert.equal(r.results.find(r=>r.id===545).published,false);
  assert.equal(f.state.writes.length,1);assert.equal(f.state.writes[0].args.p_device_id,518);
 }
});
test('transport cache retains actual observation time across waves and separates different complete port sets',async()=>{
 const masters=Array.from({length:11},(_,i)=>master({unit_tag:String(i+1),source_label:'Sniper '+(i+1)}));
 const devices=masters.map((m,i)=>device({id:i+1,unit_key:m.source_label,public_ip:'8.8.4.'+(i+1)}));
 const ordered=scheduledOrder(directCandidates(masters,devices).selected,now);const first=ordered[0].device.id,last=ordered[10].device.id;
 devices.find(d=>d.id===last).public_ip=devices.find(d=>d.id===first).public_ip;
 const f=fixture({masters,devices});let time=now,calls=0;
 await f.run(async()=>{time++;calls++;return {online:true,latency_ms:1};},{startedAt:now,now:()=>time});
 assert.equal(calls,20);assert.equal(f.state.writes.length,11);
 assert.equal(f.state.health.find(h=>h.camera_device_id===first).checked_at,f.state.health.find(h=>h.camera_device_id===last).checked_at);
 const g=fixture({masters:[master(),master({unit_tag:'166',source_label:'Sniper 166'})],devices:[device(),device({id:545,unit_key:'SNIPER 166',expected_ports:[443,8443]})]});let different=0;
 await g.run(async()=>{different++;return {online:true,latency_ms:1};});assert.equal(different,4);assert.equal(g.state.writes.length,2);
});
test('failed or incomplete shared transport stays unverified for each identity without counter writes',async()=>{
 const f=fixture({masters:[master(),master({unit_tag:'166',source_label:'Sniper 166'})],devices:[device(),device({id:545,unit_key:'SNIPER 166'})]});let calls=0;
 const r=await f.run(async()=>{calls++;throw Error('collector unavailable');});assert.equal(calls,2);assert.equal(f.state.writes.length,0);assert.ok(r.results.every(r=>!r.published&&r.reason==='probe_incomplete'));
});

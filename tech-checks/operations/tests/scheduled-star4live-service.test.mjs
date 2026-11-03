import test from 'node:test';
import assert from 'node:assert/strict';
import {collectScheduledStar4Live} from '../../supabase/functions/_shared/scheduledStar4LiveService.ts';
const now=Date.parse('2026-11-03T03:30:00Z');
const device=(over={})=>({id:1,source:'vigilant_control_center',unit_key:'SOLAR SPOTTER 013',device_name:'Synthetic camera',organization:'Synthetic site',activation_state:'active',monitoring_enabled:true,public_ip:'8.8.8.8',expected_ports:[81,443],connection_revision:3,monitoring_profile:'solar_spotter',...over});
const response=(online=true)=>({online,latency_ms:online?2:null,...online?{}:{error:'timeout'}});
function fixture(rows=[device()]){
 const state={rows:structuredClone(rows),health:[],writes:[],reads:[],fail:null,hang:null,publishFail:false,newer:false,beforePublish:null};
 const db={from(table){let signal,range,ids,source;const q={select(){return q},eq(k,v){if(k==='source')source=v;return q},order(){return q},range(a,b){range=[a,b];return q},in(k,v){ids=v;return q},abortSignal(s){signal=s;return q},then(resolve,reject){
  state.reads.push(table);if(state.hang===table)return new Promise(()=>{}).then(resolve,reject);
  let data=table==='camera_devices'?state.rows.filter(d=>(!source||d.source===source)&&(!ids||ids.includes(d.id))):state.health.filter(h=>!ids||ids.includes(h.camera_device_id));
  if(range)data=data.slice(range[0],range[1]+1);
  return Promise.resolve({data:structuredClone(data),error:state.fail===table?{message:'unavailable'}:null}).then(resolve,reject);
 }};return q;},rpc(name,args){const q={abortSignal(){return q},then(resolve,reject){
  assert.equal(name,'publish_camera_connection_v1');state.beforePublish?.();
  const d=state.rows.find(d=>d.id===args.p_device_id);
  const matches=d&&d.connection_revision===args.p_revision&&d.public_ip===args.p_public_ip&&JSON.stringify(d.expected_ports)===JSON.stringify(args.p_expected_ports);
  if(state.publishFail)return Promise.resolve({error:{message:'denied'}}).then(resolve,reject);
  if(!matches||state.newer)return Promise.resolve({data:{ok:false,reason:state.newer?'newer_observation':'connection_changed'}}).then(resolve,reject);
  state.writes.push(structuredClone(args));return Promise.resolve({data:{ok:true}}).then(resolve,reject);
 }};return q;}};
 return {state,run:(probe=async()=>response(),opts={})=>collectScheduledStar4Live(db,probe,{startedAt:now,now:()=>now,...opts})};
}
test('scheduled Star4Live checks configured ports and publishes saved TCP without provider/placement writes',async()=>{
 const f=fixture(),before=structuredClone(f.state.rows),calls=[];
 const r=await f.run(async(host,port)=>{calls.push([host,port]);return response(port===443);});
 assert.deepEqual(calls,[['8.8.8.8',81],['8.8.8.8',443]]);assert.equal(r.published,1);assert.equal(r.results[0].status,'online');
 assert.deepEqual(f.state.rows,before);const w=f.state.writes[0];
 assert.equal(w.p_source,'automatic_tcp_sweep');assert.equal(w.p_monitoring_profile,'solar_spotter');
 assert.equal(w.p_health.checked_at,new Date(now).toISOString());assert.equal(w.p_health.confirmed_outage,false);
 assert.equal('source_status' in w.p_health,false);assert.equal('organization' in w.p_health,false);
 assert.doesNotMatch(JSON.stringify(r),/8\.8\.8\.8|Synthetic site/);
});
test('one complete valid nonresponse is saved Offline; old outage thresholds and provider status do not replace it',async()=>{
 const f=fixture();const r=await f.run(async()=>response(false));
 assert.equal(r.results[0].status,'offline');assert.equal(f.state.writes[0].p_health.ip_reachable,false);
});
test('all four resources behind one saved IP are checked once and retain separate guarded publications',async()=>{
 const f=fixture([1,2,3,4].map(id=>device({id})));let count=0;
 const r=await f.run(async()=>{count++;return response();});
 assert.equal(count,2);assert.equal(r.published,4);assert.deepEqual(f.state.writes.map(w=>w.p_device_id).sort(),[1,2,3,4]);
});
test('no configured IP/port is invented, and inactive, disabled, foreign or terminal records are not probed',async()=>{
 for(const patch of [{monitoring_enabled:false},{activation_state:'deactivated'},{source:'2026_unit_tracker'},{public_ip:null},{public_ip:'127.0.0.1'},{public_ip:'169.254.169.254'},{expected_ports:[]},{expected_ports:[81,81]},{expected_ports:[0]},{connection_revision:null},{monitoring_profile:'sniper'},{device_name:'Retired camera'}]){
  const f=fixture([device(patch)]);let calls=0;const r=await f.run(async()=>{calls++;return response();});assert.equal(calls,0,String(patch));assert.equal(r.published,0);assert.equal(f.state.writes.length,0);
 }
});
test('nullable profile is passed explicitly to the existing publisher',async()=>{
 const f=fixture([device({monitoring_profile:null})]);await f.run();assert.equal(f.state.writes[0].p_monitoring_profile,null);
});
test('configuration/identity/lifecycle change before publication holds the result',async()=>{
 for(const mutate of [s=>s.rows[0].public_ip='9.9.9.9',s=>s.rows[0].connection_revision++,s=>s.rows[0].expected_ports=[8443],s=>s.rows[0].activation_state='decommissioned',s=>s.rows[0].monitoring_enabled=false,s=>s.rows[0].source='manual',s=>s.rows[0].unit_key='Another unit']){
  const f=fixture();let changed=false;const r=await f.run(async()=>{if(!changed){changed=true;mutate(f.state);}return response();});assert.equal(r.results[0].published,false);assert.equal(f.state.writes.length,0,String(mutate));
 }
});
test('CAS rejection, newer saved observations and publication error never claim success',async()=>{
 for(const kind of ['newer','publishFail','cas']){const f=fixture();if(kind==='cas')f.state.beforePublish=()=>f.state.rows[0].connection_revision++;else f.state[kind]=true;
 const r=await f.run();assert.equal(r.published,0);assert.equal(f.state.writes.length,0);assert.equal(r.results[0].published,false);}
});
test('technical, partial, unexplained or malformed probe outcomes do not become Offline',async()=>{
 for(const value of [{online:false,latency_ms:null},{online:false,latency_ms:null,error:'No route to host (os error 113)'},{online:false,latency_ms:null,error:'Unauthorized'},{online:true,latency_ms:null},{online:true,latency_ms:Infinity},{online:'true',latency_ms:1}]){
  const f=fixture(),r=await f.run(async()=>value);assert.equal(r.published,0);assert.equal(f.state.writes.length,0,JSON.stringify(value));
 }
 const f=fixture(),r=await f.run(async()=>{throw Error('transport');});assert.equal(r.published,0);
});
test('inventory/prior-health errors fail before sockets; duplicate IDs reject the complete source',async()=>{
 for(const table of ['camera_devices','camera_health_current']){const f=fixture();f.state.fail=table;let probes=0;await assert.rejects(f.run(async()=>{probes++;return response();}));assert.equal(probes,0);}
 const f=fixture([device(),device()]);await assert.rejects(f.run(),/duplicate resource/);
});
test('abort/deadline prevents further work and deferred rows keep their previous observation time',async()=>{
 const f=fixture([device(),device({id:2})]),controller=new AbortController();controller.abort();await assert.rejects(f.run(undefined,{signal:controller.signal}));assert.equal(f.state.writes.length,0);
 const many=fixture(Array.from({length:17},(_,i)=>device({id:i+1,public_ip:'11.1.1.'+(i+1)})));let at=now;
 const r=await many.run(async()=>{at=now+96000;return response();},{now:()=>at});assert.equal(r.scanned,8);assert.equal(r.deferred,9);assert.equal(r.published,0);
});
test('bounded hung inventory settles without sockets or publication',async()=>{
 const f=fixture();f.state.hang='camera_devices';await assert.rejects(f.run(undefined,{ioTimeoutMs:20}),/timed out/);assert.equal(f.state.writes.length,0);
});

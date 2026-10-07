import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const context=vm.createContext({Intl});
vm.runInContext(readFileSync(new URL('../../camera-health-history.js',import.meta.url),'utf8'),context);
const {port}=context.CameraHealthHistory;
const now=Date.parse('2026-10-07T03:30:00Z');
const fresh='2026-10-07T03:29:00Z',stale='2026-10-07T02:00:00Z';
const snapshot=(result,checked_at=fresh)=>({checked_at,port_status:{443:result}});

test('an aggregate check never fabricates a failure for an absent or malformed port',()=>{
 for(const result of [undefined,null,false,true,0,'false',[],{}, {online:null},{online:'false'},{online:0},{online:'true'},{online:false,attempted:false}]){
  const value=port(snapshot(result),443,now);
  assert.equal(value.state,'unchecked');assert.equal(value.label,'Not checked');assert.equal(value.at,null);
 }
 for(const port_status of [undefined,null,[],false,'invalid',{80:{online:false}}]){
  assert.equal(port({checked_at:fresh,port_status},443,now).state,'unchecked');
 }
 const inherited=Object.create({443:{online:false}});
 assert.equal(port({checked_at:fresh,port_status:inherited},443,now).state,'unchecked');
});

test('only explicit fresh boolean results become responding or no response',()=>{
 const failed=port(snapshot({online:false,error:'timeout'}),443,now);
 assert.equal(failed.state,'failed');assert.equal(failed.label,'No response');
 const responding=port(snapshot({online:true,latency_ms:0}),443,now);
 assert.equal(responding.state,'responding');assert.equal(responding.label,'Responding');assert.equal(responding.latencyMs,0);
 for(const latency_ms of [undefined,null,-1,'4',Infinity,NaN]){
  assert.equal(port(snapshot({online:true,latency_ms}),443,now).latencyMs,null);
 }
 assert.equal(port(snapshot({online:false,latency_ms:5}),443,now).latencyMs,null);
});

test('stale, missing, invalid and future timestamps never imply current port evidence',()=>{
 for(const checked_at of [undefined,null,'',stale,'invalid','2026-02-30T03:29:00Z','2026-10-07T03:31:00Z']){
  for(const online of [true,false]){
   const value=port(snapshot({online,latency_ms:5},checked_at),443,now);
   // The snapshot helper defaults undefined to fresh; test omission explicitly.
   const actual=checked_at===undefined?port({port_status:{443:{online}}},443,now):value;
   assert.equal(actual.state,'unverified');assert.equal(actual.label,'No recent result');assert.equal(actual.latencyMs,null);
  }
 }
});

test('aggregate timestamps cannot freshen stale or malformed per-port timestamps',()=>{
 for(const checked_at of [null,'',stale,'invalid','2026-10-07T03:31:00Z']){
  assert.equal(port(snapshot({online:false,checked_at}),443,now).state,'unverified');
 }
 assert.equal(port(snapshot({online:false,checked_at:fresh},stale),443,now).state,'failed');
});

test('provider-only observations cannot refresh leftover direct port results',()=>{
 for(const detail of ['Star4Live live API reports ONLINE','Control Center live API reports OFFLINE','Reconeyez cloud event: status update']){
  for(const online of [true,false]){
   const value=port({...snapshot({online}),detail},443,now);
   assert.equal(value.state,'unverified');assert.equal(value.label,'No recent result');
  }
 }
 assert.equal(port({...snapshot({online:true}),detail:'Direct service-port check for Reconeyez unit'},443,now).state,'responding');
});

test('each configured direct port is classified using only its own result',()=>{
 const health={checked_at:fresh,port_status:{80:{online:true},443:{online:false},38880:{online:'false'},38881:{online:true,checked_at:stale}}};
 assert.deepEqual([80,443,8443,38880,38881].map(p=>port(health,p,now).state),['responding','failed','unchecked','unchecked','unverified']);
});

test('direct port observation never borrows a newer provider timestamp',()=>{
 const h={checked_at:'2026-10-06T18:00:00Z',overall_status:'online',detail:'Star4Live live API reports ONLINE',port_status:{443:{online:true},_connection:{checkedAt:'2026-10-06T16:00:00+00',status:'online',reachable:true}}};
 const row=port(h,'443',Date.parse('2026-10-06T18:00:00Z'));assert.equal(row.state,'unverified');assert.equal(row.at,'2026-10-06T16:00:00.000Z');
});

test('loaded new endpoint rejects old proof from a concurrent health snapshot',()=>{
 const h={checked_at:fresh,overall_status:'online',port_status:{443:{online:true},_connection:{checkedAt:fresh,status:'online',reachable:true,revision:'1',ip:'203.0.113.10'}}};
 assert.equal(port(h,'443',now,{connection_revision:2,public_ip:'203.0.113.11'}).state,'unchecked');
 assert.equal(port(h,'443',now,{connection_revision:1,public_ip:'203.0.113.10'}).state,'responding');
 assert.equal(port(snapshot({online:true}),'443',now,{connection_revision:2,public_ip:'203.0.113.11'}).state,'unchecked');
});
test('provider-only health never supplies a direct service observation',()=>{const h={overall_status:'online',ip_reachable:true,checked_at:fresh,port_status:{}};const value=context.CameraHealthHistory.connectionSnapshot(h,{source:'reconeyez',connection_revision:0});assert.equal(value.checked_at,null);assert.equal(value.ip_reachable,null);});

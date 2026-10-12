import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({Intl});
vm.runInContext(readFileSync(new URL('../../camera-health-history.js',import.meta.url),'utf8'),context);
const {directDiagnostic}=context.CameraHealthHistory;
const now=Date.parse('2026-10-12T12:30:00Z'),fresh='2026-10-12T12:25:10Z',stale='2026-10-12T11:00:00Z';
const device={source:'vigilant_control_center',public_ip:'192.0.2.10/32',connection_revision:4,expected_ports:[80,443,1400,1500,1600,1700,38880,38881]};
const health=(proof={},ports={80:{online:false},443:{online:false}})=>({
 checked_at:fresh,overall_status:'online',ip_reachable:true,confirmed_outage:true,consecutive_failures:9,
 detail:'Star4Live live API reports ONLINE',port_status:{...ports,_connection:{
  checkedAt:fresh,status:'offline',reachable:false,confirmedOutage:false,consecutiveFailures:1,
  revision:4,ip:'192.0.2.10',...proof
 }}
});
const ports=value=>Array.from(value.ports);
test('an unconfirmed failed direct check never inherits provider health or claims camera OFFLINE',()=>{
 const value=directDiagnostic(device,health(),now);
 assert.equal(value.state,'failed');assert.equal(value.label,'Check failed');
 assert.match(value.detail,/Reachability unverified; outage not confirmed/);
 assert.doesNotMatch(value.label+' '+value.detail,/OFFLINE/);
 for(const consecutiveFailures of [0,1,2,3,9])assert.equal(directDiagnostic(device,health({consecutiveFailures}),now).state,'failed');
});
test('confirmed service outage and successful response remain distinct',()=>{
 const confirmed=directDiagnostic(device,health({confirmedOutage:true,consecutiveFailures:3}),now);
 assert.equal(confirmed.state,'offline');assert.equal(confirmed.label,'Confirmed service outage');
 assert.match(confirmed.detail,/provider camera status is separate/);
 const online=directDiagnostic(device,health({status:'online',reachable:true},{80:{online:false},443:{online:true}}),now);
 assert.equal(online.state,'responding');assert.equal(online.label,'Service reachable');
 assert.match(online.detail,/video not verified/);
});
test('summary lists actual attempted ports and direct time, never all saved ports',()=>{
 const value=directDiagnostic(device,health(),now);
 assert.deepEqual(ports(value),[80,443]);assert.equal(value.checked.at,'2026-10-12T12:25:10.000Z');
 assert.match(value.detail,/Attempted ports: 80, 443\./);assert.match(value.detail,/Last direct check: /);
 assert.doesNotMatch(value.detail,/1400|1500|1600|1700|38880|38881/);
});
test('skipped, malformed, non-port and differently timed records are not claimed as attempted',()=>{
 const value=directDiagnostic(device,health({}, {
  80:{online:false},443:{online:false},1400:{online:false,attempted:false},1500:{online:'false'},1600:{},
  1700:{online:false,checked_at:stale},1800:{online:false,checked_at:'bad'},1900:{online:false,checked_at:'2026-10-12T12:26:00Z'},
  0:{online:false},65536:{online:false},_provider:{online:false},'0443':{online:false}
 }),now);
 assert.deepEqual(ports(value),[80,443]);
 assert.equal(directDiagnostic(device,health({},{}),now).state,'unverified');
});
test('stale direct proof cannot borrow a fresh provider timestamp',()=>{
 const value=directDiagnostic(device,health({checkedAt:stale,confirmedOutage:true}),now);
 assert.equal(value.state,'unverified');assert.equal(value.label,'Reachability unverified');
 assert.equal(value.checked.state,'stale');assert.deepEqual(ports(value),[80,443]);
 assert.match(value.detail,/Previous attempted ports: 80, 443/);assert.match(value.detail,/Previous result; not current/);
});
test('missing, malformed, impossible or future direct times stay unverified',()=>{
 for(const checkedAt of [null,'',false,123,'bad','2026-02-30T12:00:00Z','2026-10-12T12:31:00Z']){
  const value=directDiagnostic(device,health({checkedAt}),now);
  assert.equal(value.state,'unverified');assert.deepEqual(ports(value),[]);
 }
 for(const _connection of [null,false,[],{},'offline'])for(const connection_revision of [0,4]){
  const value=directDiagnostic({...device,connection_revision},{...health(),detail:'Direct check',port_status:{80:{online:false},_connection}},now);
  assert.equal(value.state,'unverified');assert.deepEqual(ports(value),[]);
 }
 for(const value of [null,undefined,false,'offline',[]])assert.equal(directDiagnostic(device,value,now).state,'unverified');
});
test('current connection proof must match both revision and saved IP',()=>{
 for(const proof of [{revision:3},{ip:'192.0.2.11'},{revision:null},{ip:null}]){
  const value=directDiagnostic(device,health(proof),now);
  assert.equal(value.state,'unverified');assert.deepEqual(ports(value),[]);assert.equal(value.checked.at,null);
 }
 assert.equal(directDiagnostic({...device,connection_revision:'4'},health(),now).state,'failed');
});
test('legacy genuine port evidence works only at revision zero; provider pseudo-health is rejected',()=>{
 const legacy={checked_at:fresh,overall_status:'offline',ip_reachable:false,confirmed_outage:false,port_status:{80:{online:false},443:{online:false}}};
 assert.equal(directDiagnostic({...device,connection_revision:0},legacy,now).state,'failed');
 assert.equal(directDiagnostic(device,legacy,now).state,'unverified');
 for(const detail of ['Star4Live live API reports OFFLINE','Control Center live API reports ONLINE','Reconeyez cloud event: online']){
  const value=directDiagnostic({...device,connection_revision:0},{...legacy,detail},now);
  assert.equal(value.state,'unverified');assert.deepEqual(ports(value),[]);assert.equal(value.checked.at,null);
  assert.match(value.detail,/Last direct check: Never recorded\./);assert.doesNotMatch(value.detail,/Oct 12, 2026/);
 }
 for(const source of ['vigilant_control_center','reconeyez']){
  const value=directDiagnostic({...device,source,connection_revision:0},{...legacy,port_status:{}},now);
  assert.equal(value.state,'unverified');assert.equal(value.checked.at,null);
 }
});
test('contradictory or nonboolean reachability does not invent an outage or success',()=>{
 for(const reachable of [null,'false',0])assert.equal(directDiagnostic(device,health({reachable,confirmedOutage:true}),now).state,'unverified');
 assert.equal(directDiagnostic(device,health({reachable:true,confirmedOutage:true}),now).state,'unverified');
 assert.equal(directDiagnostic(device,health({confirmedOutage:true},{80:{online:true},443:{online:false}}),now).state,'unverified');
 for(const status of ['online','unknown','verifying','malformed']){
  const value=directDiagnostic(device,health({status,reachable:false,confirmedOutage:true}),now);
  assert.equal(value.state,'failed');assert.equal(value.label,'Check failed');
  assert.doesNotMatch(value.label,/Confirmed service outage/);
 }
});
test('attempt time has an explicit timezone and formatting rejects invalid calendar dates',()=>{
 const before=process.env.TZ;process.env.TZ='America/Chicago';
 try {
  assert.match(directDiagnostic(device,health(),now).detail,/Oct 12, 2026, 7:25:10 AM CDT/);
  assert.match(directDiagnostic(device,health({checkedAt:'2026-02-30T12:00:00Z'}),now).detail,/Unknown \(invalid timestamp\)/);
 }finally{if(before===undefined)delete process.env.TZ;else process.env.TZ=before;}
});

const detailSource=readFileSync(new URL('../../camera-detail.html',import.meta.url),'utf8');
function detailContext(device,current){
 const value=vm.createContext({Intl,device,current,cameraGroup:d=>d.group||'Vigilant'});
 vm.runInContext(readFileSync(new URL('../../camera-health-history.js',import.meta.url),'utf8'),value);
 vm.runInContext('Date.now=()=>'+now+';const fmt=value=>CameraHealthHistory.format(value);',value);
 for(const name of ['sourceFresh','checkFresh','effectiveHealth','sourceStatusText','sourceDetailText']){
  const at=detailSource.indexOf('function '+name+'(');
  vm.runInContext(detailSource.slice(at,detailSource.indexOf('\n',at)),value);
 }
 return value;
}
test('actual detail wording leaves provider status authoritative through failed, confirmed and online direct checks',()=>{
 for(const source_status of ['online','offline']){
  const deviceFixture={...device,source_status,source_last_seen_at:fresh};
  for(const [proof,portResults,label] of [
   [{},undefined,'Check failed'],
   [{confirmedOutage:true,consecutiveFailures:3},undefined,'Confirmed service outage'],
   [{status:'online',reachable:true},{443:{online:true}},'Service reachable']
  ]){
   const view=detailContext(deviceFixture,health(proof,portResults));
   assert.equal(view.effectiveHealth(view.device,view.current),source_status);
   assert.equal(view.sourceStatusText(),'Vigilant: '+source_status.toUpperCase()+' · Direct diagnostic: '+label);
   assert.match(view.sourceDetailText(),/Attempted ports: (80, )?443\./);
   assert.match(view.sourceDetailText(),/Last direct check: /);
   assert.doesNotMatch(view.sourceDetailText(),/1400|1500|1600|1700/);
  }
 }
});
test('actual detail rejects stale, malformed and old-identity direct proof without changing provider availability',()=>{
 for(const proof of [{checkedAt:stale},{checkedAt:'2026-02-30T12:00:00Z'},{revision:3},{ip:'192.0.2.11'}]){
  const view=detailContext({...device,source_status:'online',source_last_seen_at:fresh},health(proof));
  assert.equal(view.sourceStatusText(),'Vigilant: ONLINE · Direct diagnostic: Reachability unverified');
  assert.equal(view.effectiveHealth(view.device,view.current),'online');
 }
 const cloud=detailContext({...device,group:'Reconeyez',source_status:'offline',source_last_seen_at:fresh},health());
 assert.equal(cloud.sourceStatusText(),'Reconeyez: OFFLINE');
 assert.doesNotMatch(cloud.sourceDetailText(),/Direct port diagnostic/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../camera-health-history.js',import.meta.url),'utf8');
const context=vm.createContext({Intl});vm.runInContext(source,context);
const api=context.CameraHealthHistory;
const now=Date.parse('2026-10-06T12:30:00Z');
const old='2026-10-06T10:55:10Z',fresh='2026-10-06T12:25:10Z';
const ranger={id:159,device_name:'Ranger 022',source_status:'offline',source_last_seen_at:fresh,last_online_at:old};
const current={overall_status:'online',ip_reachable:true,checked_at:'2026-09-30T01:00:00Z'};
test('offline provider has a fresh failed observation and separate historical online time',()=>{
 const value=api.record(ranger,current,'Vigilant',now);
 assert.equal(value.attempt.at,new Date(fresh).toISOString());assert.equal(value.attempt.outcome,'Reported OFFLINE');
 assert.equal(value.success.at,new Date(old).toISOString());assert.equal(value.success.state,'stale');
 assert.match(value.success.note,/Star4Live provider reported online.*Historical/);
});
test('repeated failed observations never advance the last successful connection',()=>{
 for(let minute=26;minute<30;minute++){
 const value=api.record({...ranger,source_last_seen_at:`2026-10-06T12:${minute}:00Z`},current,'Vigilant',now);
 assert.equal(value.success.at,new Date(old).toISOString());assert.equal(value.attempt.outcome,'Reported OFFLINE');
 }
});
test('recovery displays recorded new success rather than synthesizing it from a check',()=>{
 const recovered=api.record({...ranger,source_status:'online',last_online_at:fresh},current,'Vigilant',now);
 assert.equal(recovered.success.at,new Date(fresh).toISOString());
 const unrecorded=api.record({...ranger,source_status:'online',last_online_at:null},current,'Vigilant',now);
 assert.equal(unrecorded.success.at,null);assert.equal(unrecorded.success.state,'missing');
});
test('Reconeyez offline cloud event is never a successful connection or ping',()=>{
 const value=api.record({...ranger,last_probe_online_at:fresh},{},'Reconeyez',now);
 assert.equal(value.attempt.label,'Last cloud status update');assert.equal(value.success.at,new Date(old).toISOString());
 assert.equal(api.record({...ranger,last_online_at:null},{},'Reconeyez',now).success.at,null);
});
test('direct attempt and successful service-port time remain distinct on failure',()=>{
 const device={...ranger,last_probe_online_at:old,last_health_checked_at:fresh};
 const value=api.record(device,{overall_status:'offline',ip_reachable:false,checked_at:fresh,latency_ms:1},'Sniper',now);
 assert.equal(value.attempt.outcome,'No response');assert.equal(value.success.at,new Date(old).toISOString());
 assert.match(value.success.note,/video not verified/);
 assert.equal(api.record({...device,last_probe_online_at:null},{...current,checked_at:fresh},'Sniper',now).success.at,null);
});
test('missing, stale, malformed, future, and zero timestamps never claim current success',()=>{
 for(const value of [undefined,null,''])assert.equal(api.timestamp(value,now).state,'missing');
 for(const value of ['bad date','2027-01-01T00:00:00Z','1970-01-01T00:00:00Z','2026-02-30T01:00:00Z','2026-10-06T10:00:00','2026-10-05T24:00:00Z',123])assert.equal(api.timestamp(value,now).state,'invalid');
 const row=api.record({...ranger,source_last_seen_at:old},{},'Vigilant',now);
 assert.equal(row.attempt.state,'stale');assert.match(row.attempt.outcome,/Stale observation/);
 const html=api.strip([{...ranger,last_online_at:'2027-01-01T00:00:00Z'}],{},()=> 'Vigilant',now);
 assert.match(html,/Unknown \(invalid timestamp\)/);assert.doesNotMatch(html,/2027/);
});
test('display labels the timezone explicitly and keeps date and time',()=>{
 const previous=process.env.TZ;process.env.TZ='America/Chicago';
 try {const formatted=api.format(old,now);assert.match(formatted,/Oct 6, 2026/);assert.match(formatted,/5:55:10 AM CDT/);}
 finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
test('unit aggregation names the resource and does not imply all resources succeeded',()=>{
 const html=api.strip([ranger,{...ranger,id:160,device_name:'Camera <Two>',last_online_at:fresh}],{},()=> 'Vigilant',now);
 assert.match(html,/Camera &lt;Two&gt;/);assert.match(html,/Last check attempted/);assert.match(html,/Last successful connection/);
 assert.doesNotMatch(html,/time-good|last-success-ping|✓|all cameras/i);
});
test('CSV refresh preserves success history and both views share source-aware formatting',()=>{
 const list=readFileSync(new URL('../../camera-health.html',import.meta.url),'utf8');
 const detail=readFileSync(new URL('../../camera-detail.html',import.meta.url),'utf8');
 assert.match(readFileSync(new URL('../../camera-health-overview.js',import.meta.url),'utf8'),/CameraHealthHistory\.strip\(\[d\],health,cameraGroup\)/);
 for(const html of [list,detail])assert.match(html,/camera-health-history\.js\?v=20261006/);
 assert.doesNotMatch(list,/last_online_at:null|✓ LAST SUCCESS|No successful ping recorded/);
 assert.doesNotMatch(detail,/latestSuccessfulPing|Last successful live check/);
 assert.match(detail,/sourceStatusCard.*className='card '/);
 assert.match(detail,/previous result; not current/);
});

test('failed probes before outage confirmation still report an unsuccessful attempt',()=>{
 const value=api.record({last_probe_online_at:old},{overall_status:'verifying',ip_reachable:false,checked_at:fresh},'Sniper',now);
 assert.equal(value.attempt.outcome,'No response');assert.equal(value.success.at,new Date(old).toISOString());
});

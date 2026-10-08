import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const file=name=>readFileSync(new URL('../../'+name,import.meta.url),'utf8');
const context=vm.createContext({Intl});vm.runInContext(file('camera-health-history.js')+'\n'+file('camera-health-overview.js')+'\n'+file('camera-diagnostic-report.js'),context);
const api=context.CameraDiagnosticReport;
const now=Date.parse('2026-10-08T01:30:00Z'),fresh='2026-10-08T01:25:00Z',old='2026-10-07T01:00:00Z';
vm.runInContext('Date.now=()=>'+now,context);
const d={id:901,device_name:'SNIPER 901',source:'manual',activation_state:'active',device_type:'camera',public_ip:'203.0.113.9',connection_revision:2,expected_ports:[443,80],last_probe_online_at:old};
// Released publish_camera_connection_v1 JSON contract: direct proof lives under
// _connection so a provider refresh cannot overwrite the direct observation time.
const health=(patch={},meta={})=>({checked_at:fresh,ip_reachable:true,overall_status:'online',port_status:{443:{online:true,latency_ms:0},80:{online:false,error:'Connection refused (os error 111)'},_connection:{ip:d.public_ip,revision:2,checkedAt:fresh,status:'online',reachable:true,consecutiveFailures:0,confirmedOutage:false,...meta}},...patch});
test('numeric ports exclude metadata, zero, negative, non-integer and out-of-range keys',()=>{
 const row=health();Object.assign(row.port_status,{_provider:{online:false},0:{online:false},65536:{online:false},'1.5':{online:false},'080':{online:false}});
 assert.deepEqual([...api.ports({...d,expected_ports:[443,0,-1,65536,'443','22']},row)],[22,80,443]);
});
test('current matching proof preserves zero latency and safe refused/timeout categories',()=>{
 assert.equal(api.direct(d,health(),now).state,'responding');assert.equal(api.portResult(d,health(),443,now).latencyMs,0);
 assert.equal(api.portResult(d,health(),80,now).label,'Connection refused');
 for(const error of ['timeout','ETIMEDOUT','Connection timed out'])assert.equal(api.portResult(d,health({port_status:{...health().port_status,80:{online:false,error}}}),80,now).label,'Timed out');
 assert.equal(api.portResult(d,health({port_status:{...health().port_status,80:{online:false,error:'Secret provider body https://credentials.example/token'}}}),80,now).label,'Failed (cause unverified)');
});
test('wrong IP/revision and stale proof cannot become responding through fresh provider timestamps',()=>{
 for(const meta of [{ip:'203.0.113.10'},{revision:1},{checkedAt:old}]){
  const h=health({detail:'Star4Live live API',checked_at:fresh},meta);
  assert.notEqual(api.direct(d,h,now).state,'responding');assert.notEqual(api.portResult(d,h,443,now).state,'responding');
 }
 assert.equal(api.direct(d,health({}, {checkedAt:old}),now).state,'stale / not verified');
});
test('false/zero/missing/skipped port data never becomes a failed check',()=>{
 for(const value of [false,0,null,undefined,{}, {online:0},{online:null},{online:false,attempted:false}]){
  const h=health({port_status:{443:value,_connection:health().port_status._connection}});
  assert.equal(api.portResult(d,h,443,now).state,'unchecked');assert.equal(api.direct({...d,expected_ports:[443]},h,now).state,'not checked');
 }
});
test('inventory-only provider timestamps do not establish detector health or a direct response',()=>{
 const detector={...d,source:'reconeyez',public_ip:null,source_imported_at:fresh,source_status:null,source_last_seen_at:null};
 const report=api.report('RECON 901',[detector],{901:{checked_at:fresh,ip_reachable:true,detail:'Reconeyez cloud event: inventory'}},now);
 assert.match(report,/Current provider result: UNKNOWN \/ REVIEW/);assert.match(report,/Inventory sync is not detector health/);assert.match(report,/Current bound direct result: NOT CHECKED/);
 assert.doesNotMatch(report,/Current provider result: OFFLINE/);
});
test('reports separate attempt/success, omit sensitive fields and safely export hostile labels',()=>{
 const hostile={...d,device_name:'SNIPER <img src=x onerror=alert(1)> 901\npassword=secret https://user:pass@example.com?k=token owner@example.com',source_metadata:{password:'DO_NOT_EXPORT'},port_labels:{80:'RAW_LABEL_SECRET'},device_owner:'PERSONAL_CONTACT'};
 const report=api.report('</textarea><script>bad()</script>',[hostile],{901:health()},now);
 assert.match(report,/Last bound direct attempt: 2026-10-08T01:25:00.000Z/);assert.match(report,/Historical direct success: 2026-10-07/);assert.match(report,/video or recording/);
 assert.match(report,/Port 80: Connection refused/);assert.match(report,/Port 443: Responding.*0 ms/);
 assert.doesNotMatch(report,/RAW_LABEL_SECRET|DO_NOT_EXPORT|PERSONAL_CONTACT|owner@example.com|user:pass|password=secret|<img|<script|_connection/);
 assert.match(api.filename('../../unsafe<>name'),/^cos-diagnostic-[a-zA-Z0-9_-]+\.txt$/);
 const failed=api.report('SNIPER 901',[{...d,source:'vigilant_control_center',source_status:'offline',source_last_seen_at:fresh}],{901:health()},now,{unavailable:true});
 assert.match(failed,/Current provider result: UNKNOWN \/ REVIEW/);assert.match(failed,/Current bound direct result: UNKNOWN \/ REVIEW/);
});
test('actual diagnostic consumers use the same bound helper and never enumerate metadata as ports',async()=>{
 const html=file('camera-health.html');const start=html.indexOf('function directEvidence(d)'),end=html.indexOf('function routerEvidence(r)',start);
 const direct=new Function('health','CameraDiagnosticReport',html.slice(start,end)+';return directEvidence;')({901:health({}, {ip:'203.0.113.10'})},api);
 assert.notEqual(direct(d).state,'responding');
 const a=html.indexOf("else if(kind==='ports')"),b=html.indexOf("else if(kind==='logs')",a),node={innerHTML:''};
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const FixedDate=class extends Date {static now(){return now;}};
 await new AsyncFunction('health','CameraDiagnosticReport','CameraHealthHistory','Date','node',`const kind='ports',ds=[${JSON.stringify(d)}],unit='Synthetic',request=1,unitDiagnosticRequest=1,unitDiagnosticFailures=new Set();const verifyDiagnosticDevices=async()=>{},$=()=>node,diagHeader=()=>'',esc=x=>String(x);if(false){} ${html.slice(a,b)}`)({901:health()},api,context.CameraHealthHistory,FixedDate,node);
 assert.match(node.innerHTML,/CONNECTION REFUSED/);assert.match(node.innerHTML,/0 ms/);assert.doesNotMatch(node.innerHTML,/_connection|NO RESPONSE/);
 assert.match(html,/diagnosticTarget\(kind==='report'\)/);assert.doesNotMatch(html,/Checks completed\./);
});

test('inactive and unsupported provider records stay unknown and quoted credentials/contacts are omitted',()=>{
 for(const patch of [{activation_state:'deactivated'},{device_type:'tracker_unit'},{__trackerOnly:true}]){
  const device={...d,source:'reconeyez',source_status:'online',source_last_seen_at:fresh,...patch};
  assert.match(api.report('RII 901',[device],{},now),/Current provider result: UNKNOWN \/ REVIEW/);
 }
 const label=api.safeText('Helios 901 Tel: 415-555-1212 password="two word secret" rtsp://user:pass@host/path?token=secret');
 assert.doesNotMatch(label,/415|two|word|secret|user:pass|rtsp:/);
});

test('cloud-only legacy success timestamps are never relabeled as direct success',()=>{
 const text=api.report('RII 901',[{...d,source:'reconeyez',public_ip:null,last_probe_online_at:fresh}],{},now);
 assert.match(text,/Legacy success timestamp \(direct provenance unverified\)/);assert.doesNotMatch(text,/Historical direct success:/);
});

test('recorded provider synchronization failure stays review even with fresh older observations',()=>{
 const device={...d,source:'vigilant_control_center',source_status:'offline',source_last_seen_at:fresh};
 const text=api.report('Ranger 901',[device],{901:health()},now,{unavailableProviders:['Star4Live']});
 assert.match(text,/Current provider result: UNKNOWN \/ REVIEW/);assert.match(text,/Current bound direct result: RESPONDING/);assert.match(text,/Review provider mapping, authentication/);
 for(const value of ['{"password":"hunter2"}','Call (555)123-4567','Call 15551234567','user=admin&pass=hunter2','//private.example/path?key=hunter2'])assert.doesNotMatch(api.safeText(value),/hunter2|555|1555|admin|private\.example/);
 const unavailable=api.report('Sniper 901',[d],{901:health()},now,{unavailable:true});assert.doesNotMatch(unavailable,/Suggested next step: Service responds/);
});

test('interrupted/overlapping verification records only the latest attempt result independently of view navigation',async()=>{
 const html=file('camera-health.html'),start=html.indexOf('async function verifyDiagnosticDevices('),end=html.indexOf('function directEvidence(d)',start);
 const failures=new Set(),pending=new Set(),versions=new Map(),runs=[];
 const verify=new Function('unitDiagnosticFailures','unitDiagnosticPending','unitVerificationVersions','freshDeviceChecks',html.slice(start,end)+';return verifyDiagnosticDevices;')(failures,pending,versions,()=>new Promise((resolve,reject)=>runs.push({resolve,reject})));
 const a=verify('A',[]);assert.equal(pending.has('A'),true);runs[0].reject(Error('fixture denied'));await assert.rejects(a);assert.equal(failures.has('A'),true);assert.equal(pending.has('A'),false);
 const oldAttempt=verify('A',[]),latest=verify('A',[]);runs[2].resolve();await latest;runs[1].reject(Error('older result'));await assert.rejects(oldAttempt);assert.equal(failures.has('A'),false);
});

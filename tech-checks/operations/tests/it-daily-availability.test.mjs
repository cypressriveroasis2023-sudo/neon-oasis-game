import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../../'+name,import.meta.url),'utf8');
const availability=await import('data:text/javascript;base64,'+Buffer.from(read('it-feature-availability.js')).toString('base64'));
const repair=read('it-send-repair.html');
const helper=repair.match(/async function dailyFeatureAvailable\(\)\{([\s\S]*?)\n\}/)[1];
const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
async function repairGate(role,{active=true,fail=false,subject='synthetic'}={}) {
  const calls=[],tickets={innerHTML:''};
  const db={auth:{getSession:async()=>({data:{session:{user:{id:'synthetic'}}}})},from(table){calls.push(table);return {select(fields){calls.push(fields);return this},eq(field,id){assert.equal(field,'user_id');assert.equal(id,'synthetic');return this},single:async()=>fail?{error:{message:'synthetic'}}:{data:{user_id:subject,role,active}}}}};
  const available=await new AsyncFunction('db','$',helper.replace("const {IT_DAILY_ONLY}=await import('./it-feature-availability.js');",'const IT_DAILY_ONLY=true;'))(db,()=>tickets);
  return {available,calls,tickets};
}
test('daily switch is explicit and limits the desktop to Camera Health',()=>{
  assert.equal(availability.IT_DAILY_ONLY,true);
  assert.deepEqual([...availability.IT_DAILY_WORKSPACES],['Camera Health']);
  assert.deepEqual(availability.IT_DAILY_WORKSPACES.map(availability.itDailyLabel),['Camera Health']);
  assert.doesNotMatch(read('it-feature-availability.js'),/localStorage|fetch\(|mhelp.*===|setTimeout/);
});
test('standalone repair pauses IT before any ticket read or release, including restored sessions',async()=>{
  const result=await repairGate('it');assert.equal(result.available,false);
  assert.match(result.tickets.innerHTML,/paused until further notice/);
  assert.deepEqual(result.calls,['profiles','user_id,role,active,archived_at']);
  assert.match(repair,/async function load\(\)\{ if\(!await dailyFeatureAvailable\(\)\)return;/);
  assert.match(repair,/async function send\(id,no\)\{if\(!await dailyFeatureAvailable\(\)\)return;/);
});
test('repair leaves verified Owner and Service availability unchanged and fails closed on unknown identity',async()=>{
  for(const role of ['owner','service'])assert.equal((await repairGate(role)).available,true);
  for(const options of [{active:false},{fail:true},{subject:'other'}])assert.equal((await repairGate('owner',options)).available,false);
});
test('legacy host adapters withhold extra IT entry points and their token bridges while preserving source modules',()=>{
  assert.match(read('verified-it-fleet-host.js'),/async function present\(\)\{if\(window.COS_IT_DAILY_ONLY\)return;/);
  for(const file of ['production-assignments-host.js','it-ticket-instructions-host.js'])assert.match(read(file),/if \(window.COS_IT_DAILY_ONLY && role === 'it'\) return null;/);
  const host=read('it-daily-host.js');
  assert.match(host,/event.source!==target/);assert.match(host,/generation===revision/);
  assert.doesNotMatch(host,/COS_IT_ASSIGNMENTS_REQUEST|COS_IT_MHELP_REQUEST|my_managed_tickets|my_available_assignments/);
  assert.ok(read('index.html').indexOf('it-daily-host.js')<read('index.html').indexOf('src=".\/app.js'));
});
test('daily frame follows available viewport height without resizing fullscreen or detached frames',()=>{
  const host=read('it-daily-host.js');
  const body=host.match(/function fitDailyFrame\(\) \{([\s\S]*?)\n\}/)[1];
  const fit=new Function('frame','window',body);
  const frame={isConnected:true,style:{},getBoundingClientRect:()=>({top:142})};
  fit(frame,{innerHeight:844});assert.equal(frame.style.height,'690px');
  fit(frame,{innerHeight:640});assert.equal(frame.style.height,'486px');
  fit(frame,{innerHeight:844,visualViewport:{offsetTop:30,height:420}});assert.equal(frame.style.height,'296px');
  frame.getBoundingClientRect=()=>({top:-90});fit(frame,{innerHeight:640});assert.equal(frame.style.height,'628px');
  frame.getBoundingClientRect=()=>({top:NaN});fit(frame,{innerHeight:390});assert.equal(frame.style.height,'628px');
  frame.style.position='fixed';fit(frame,{innerHeight:390});assert.equal(frame.style.height,'628px');
  frame.style.position='';frame.isConnected=false;fit(frame,{innerHeight:390});assert.equal(frame.style.height,'628px');
  assert.doesNotMatch(host,/min-height:(500|560)px/);
});

test('daily landing has no extra Fleet launch and shared modes preserve existing tool labels',()=>{
 const daily=read('operations/src/ITDailyDashboard.tsx'),app=read('operations/src/App.tsx');
 assert.doesNotMatch(daily,/cos-fleet-launch|Open Fleet Dashboard/);
 assert.match(daily,/Camera Health and authorized camera editing/);
 assert.match(app,/active==='Fleet Dashboard'\|\|active==='Camera Health'&&!route.diagnostics/);
 assert.match(app,/initialView=\{active==='Camera Health'\?'fleet':'map'\}/);
 assert.match(app,/openAdvancedDiagnostics=\{!fleetOnly&&!dailyOnly\?/);
});


test('IT desktop lands on Camera Health while phone mounts named handoffs without legacy prep controls',()=>{
 const host=read('it-daily-host.js'),app=read('operations/src/App.tsx');
 assert.match(host,/#camera-health/);assert.match(host,/if\(value.phone\)/);
 assert.match(host,/disposeTransfer=mountTransferDesk/);
 assert.match(app,/dailyOnly\?'Camera Health':'Fleet Dashboard'/);
 assert.match(app,/active==='Camera Health'&&dailyOnly\?<CameraHealthWorkspace/);
 assert.doesNotMatch(app,/dailyOnly\?\[...IT_DAILY_WORKSPACES,'IT Dashboard'\]/);
});

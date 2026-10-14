import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {reconcileFleetSnapshot} from '../src/fleetSnapshot.ts';
import {validateCameraHealth} from '../src/fieldCameraHealth.ts';
import {rememberCameraHistory} from '../src/cameraLastKnown.ts';
import {checkedFieldMap} from '../src/gpsPersistence.ts';
import {CAMERA_AUTO_REFRESH_MS,automaticRefreshDue} from '../src/refreshCadence.ts';

// Execute the exact production hook and API in a small hook/timer host. This
// does not render React, launch a browser, bind a socket, or contact a service.
const sourceRoot=new URL('../src/',import.meta.url);
const compile=name=>ts.transpileModule(readFileSync(new URL(name,sourceRoot),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const apiSource=compile('api.ts'),hookSource=compile('useCameraHealth.ts');
const flush=()=>setImmediate();
const start=Date.parse('2026-10-14T03:16:00Z');
const health={totalDevices:0,online:0,offline:0,review:0,shopRoot:0,healthRows:0,fieldDevices:0,refreshedAt:new Date(start).toISOString(),rows:[],evidenceVersion:2,inventory:{allRecords:0,activeFieldRecords:0,activeShopRecords:0,inactiveRecords:0,unknownScopeRecords:0}};
const fieldMap={items:[],summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0},generatedAt:new Date(start).toISOString()};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture({autoReply=true}={}){
 let clock=start,timerId=0,requestId=0;
 const timers=new Map(),listeners=new Map(),documentListeners=new Map(),requests=[],handshakes=[],events=[];
 const state={token:'synthetic-session-a',role:'owner',autoReply};
 const location={origin:'https://synthetic.example',search:''};
 const add=(target,type,fn)=>{if(!target.has(type))target.set(type,new Set());target.get(type).add(fn);};
 const dispatch=(target,event)=>{for(const fn of [...target.get(event.type)||[]])fn(event);};
 function reply(message=handshakes.at(-1)){dispatch(listeners,{type:'message',origin:location.origin,source:parent,data:{type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:message.requestId,accessToken:state.token,role:state.role}});}
 const parent={postMessage(message,origin){assert.equal(origin,location.origin);handshakes.push(message);if(state.autoReply)queueMicrotask(()=>reply(message));}};
 const schedule=(fn,delay,repeat=false)=>{timers.set(++timerId,{fn,delay,at:clock+delay,repeat});return timerId;};
 const window={parent,addEventListener:(type,fn)=>add(listeners,type,fn),removeEventListener:(type,fn)=>listeners.get(type)?.delete(fn),dispatchEvent(event){events.push(event.type);dispatch(listeners,event);return true;},setTimeout:(fn,delay)=>schedule(fn,delay),clearTimeout:id=>timers.delete(id),setInterval:(fn,delay)=>schedule(fn,delay,true),clearInterval:id=>timers.delete(id)};
 const document={hidden:false,addEventListener:(type,fn)=>add(documentListeners,type,fn),removeEventListener:(type,fn)=>documentListeners.get(type)?.delete(fn)};
 const ClockDate=class extends Date{static now(){return clock;}};
 const exports={};
 const modules={'./fleetSnapshot':{reconcileFleetSnapshot:(h,m)=>reconcileFleetSnapshot(h,m,clock)},'./fieldCameraHealth':{validateCameraHealth},'./cameraLastKnown':{rememberCameraHistory},'./gpsPersistence':{checkedFieldMap},'./refreshCadence':{CAMERA_AUTO_REFRESH_MS,automaticRefreshDue},'../../it-feature-availability':{IT_DAILY_ONLY:true}};
 vm.runInNewContext(apiSource,{exports,window,location,URLSearchParams,AbortController,Event,Error,Date:ClockDate,require:name=>{assert.ok(modules[name],'Unexpected import '+name);return modules[name];},crypto:{randomUUID:()=>`synthetic-request-${++requestId}`},fetch(url,init){assert.equal(url,'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages');const result=deferred();init.signal.addEventListener('abort',()=>result.reject(new Error('Synthetic aborted request')),{once:true});requests.push({url,init,envelope:JSON.parse(init.body),result});return result.promise;}},{filename:'api.ts'});
 const api=exports.api;
 function mount(){
  const values=[],refs=[],effects=[],cleanups=[],historyUpdates=[];let holdHistory=false;
  const react={useCallback:fn=>fn,useRef(value){const ref={current:value};refs.push(ref);return ref;},useState(value){const index=values.length;values.push(value);return [value,next=>{if(index===4&&holdHistory&&typeof next==='function'){historyUpdates.push(next);return;}values[index]=typeof next==='function'?next(values[index]):next;}];},useEffect:fn=>effects.push(fn)};
  const exports={};vm.runInNewContext(hookSource,{exports,window,document,location,Error,Date:ClockDate,require:name=>name==='react'?react:name==='./api'?{api}:modules[name]},{filename:'useCameraHealth.ts'});
  const hook=exports.useCameraHealth();effects.forEach(fn=>cleanups.push(fn()));
  return {refresh:hook.refresh,deferHistory(){holdHistory=true;},flushHistory(){holdHistory=false;while(historyUpdates.length)values[4]=historyUpdates.shift()(values[4]);},get fleet(){return values[0];},get error(){return values[1];},get loading(){return values[2];},get now(){return values[3];},get cameraHistory(){return values[4];},get lastAttemptAt(){return refs[2].current;},unmount(){cleanups.forEach(fn=>fn?.());}};
 }
 async function advance(milliseconds){
  const end=clock+milliseconds;
  while(true){const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!next)break;const [id,timer]=next;clock=timer.at;if(timer.repeat)timer.at+=timer.delay;else timers.delete(id);timer.fn();await flush();}
  clock=end;await flush();
 }
 const answer=(index,data,status=200)=>{assert.ok(requests[index],'Expected synthetic request '+index);requests[index].result.resolve(new Response(JSON.stringify(data),{status}));};
 const answerPair=(index=0)=>{answer(index,{...health,refreshedAt:new Date(clock).toISOString()});answer(index+1,{...fieldMap,generatedAt:new Date(clock).toISOString()});};
 const visible=async value=>{document.hidden=!value;dispatch(documentListeners,{type:'visibilitychange'});await flush();};
 return {api,window,requests,handshakes,state,events,mount,advance,answer,answerPair,visible,reply,hide(){window.dispatchEvent({type:'message',origin:location.origin,source:parent,data:{type:'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'}});},get now(){return clock;}};
}
async function prewarm(f){const pending=f.api.fleet();await flush();f.answerPair();return pending;}
async function boot(){const f=fixture(),hook=f.mount();await flush();f.answerPair();await flush();assert.equal(hook.loading,false);return {f,hook};}

test('a view mounting on a three-minute-old cache rereads at the original four-minute deadline',async()=>{
 const f=fixture(),saved=await prewarm(f);await f.advance(3*60000);const hook=f.mount();await flush();
 assert.equal(hook.fleet,saved);assert.equal(hook.loading,false);assert.equal(f.requests.length,2);
 await f.advance(60000);assert.equal(f.requests.length,4,'cache adoption must not postpone the saved-data read to minute seven');assert.equal(hook.loading,true);assert.equal(hook.fleet,saved,'a pending pair retains the last complete saved snapshot');
 f.answerPair(2);await flush();assert.equal(hook.loading,false);assert.equal(hook.fleet.readStartedAt,start+4*60000);assert.notEqual(hook.fleet,saved);
});

test('snapshot update adoption cannot reset the actual pair deadline',async()=>{
 const {f,hook}=await boot();const saved=hook.fleet;await f.advance(60000);f.window.dispatchEvent(new Event('cos-fleet-snapshot-updated'));await flush();
 assert.equal(hook.fleet,saved);assert.equal(f.requests.length,2);await f.advance(3*60000);assert.equal(f.requests.length,4,'reaccepting a cached snapshot does not restart its age');f.answerPair(2);await flush();
});

test('delayed authentication and a late peer preserve the original paired request start',async()=>{
 const f=fixture({autoReply:false}),first=f.mount();await f.advance(2000);f.reply();f.state.autoReply=true;await flush();assert.equal(f.requests.length,2);
 await f.advance(6000);f.answer(0,health);await f.advance(52000);const peer=f.mount();await flush();assert.equal(f.requests.length,2);assert.equal(first.loading,true);assert.equal(peer.loading,true);
 await f.advance(20000);f.answer(1,fieldMap);await flush();assert.equal(first.fleet,peer.fleet);assert.equal(first.fleet.readStartedAt,start);assert.equal(first.lastAttemptAt,start);assert.equal(peer.lastAttemptAt,start);
 await f.advance(160000);assert.equal(f.requests.length,4,'both consumers share one new pair four minutes from its actual start');f.answerPair(2);await flush();
});

test('a failed read retains its four-minute attempt backoff',async()=>{
 const {f,hook}=await boot();await f.advance(CAMERA_AUTO_REFRESH_MS);assert.equal(f.requests.length,4);f.answer(2,{error:'Synthetic saved camera read unavailable'},503);f.answer(3,fieldMap);await flush();assert.match(hook.error,/Synthetic saved camera read unavailable/);assert.equal(hook.loading,false);assert.equal(hook.lastAttemptAt,start+CAMERA_AUTO_REFRESH_MS);
 await f.advance(3*60000);await f.visible(true);await f.visible(true);assert.equal(f.requests.length,4);await f.advance(60000);assert.equal(f.requests.length,6);f.answerPair(4);await flush();assert.equal(hook.error,'');assert.equal(hook.loading,false);
});

test('hidden tabs pause reads and repeated visibility events resume only one shared pair',async()=>{
 const {f,hook}=await boot();await f.visible(false);await f.advance(20*60000);assert.equal(f.requests.length,2);assert.equal(hook.now,start+20*60000,'the observation clock still advances without renewing saved evidence');
 await f.visible(true);await f.visible(true);await f.visible(true);assert.equal(f.requests.length,4);assert.equal(hook.loading,true);f.answerPair(2);await flush();assert.equal(hook.fleet.readStartedAt,start+20*60000);await f.advance(60000);assert.equal(f.requests.length,4);
});

test('a session change clears the hook and rejects late old-session bodies',async()=>{
 const f=fixture(),hook=f.mount();await flush();const body=deferred();f.requests[0].result.resolve({ok:true,status:200,json:()=>body.promise});await flush();
 f.state.token='synthetic-session-b';const current=f.api.get('/api/jobs');await flush();assert.equal(hook.fleet,null);assert.equal(hook.loading,false);assert.match(hook.error,/session changed/);f.answer(2,{items:[]});await current;
 body.resolve(health);f.answer(1,fieldMap);await flush();assert.equal(hook.fleet,null);assert.equal(hook.loading,false);assert.equal(f.events.filter(type=>type==='cos-fleet-snapshot-updated').length,0);assert.equal(f.events.filter(type=>type==='cos-fleet-snapshot-failed').length,0,'an old account cannot publish a failure into the current session');
 const retry=hook.refresh();await flush();f.answerPair(3);await retry;assert.equal(hook.error,'');assert.equal(hook.fleet.readStartedAt,start);assert.equal(hook.loading,false);
});

for(const source of ['health','fieldMap'])test('a pair never adopts one successful half while the '+source+' response is pending',async()=>{
 const {f,hook}=await boot(),saved=hook.fleet;await f.advance(CAMERA_AUTO_REFRESH_MS);
 if(source==='health')f.answer(3,fieldMap);else f.answer(2,health);await flush();assert.equal(hook.fleet,saved);assert.equal(hook.loading,true);
 if(source==='health')f.answer(2,health);else f.answer(3,fieldMap);await flush();assert.notEqual(hook.fleet,saved);assert.equal(hook.loading,false);assert.equal(hook.fleet.readStartedAt,start+CAMERA_AUTO_REFRESH_MS);
});

const historyUnit={id:'11111111-1111-4111-8111-111111111111',unitNumber:'Helios 1',modelName:'Helios',status:'field',currentLocationType:'field',placement:'FIELD'};
const historyMap={...fieldMap,items:[historyUnit],inventoryItems:[historyUnit],summary:{fieldUnits:1,mappedUnits:0,unitGps:0,missingGps:1}};
const observationAt=new Date(start-60000).toISOString();
const historyHealth={...health,totalDevices:1,fieldDevices:1,review:1,inventory:{...health.inventory,allRecords:1,activeFieldRecords:1},rows:[{id:1,unit:'Helios 1',name:'Synthetic camera',type:'IPC',activationState:'active',scope:'field',status:'review',evidence:{kind:'provider',source:'Star4Live',resource:'camera',active:true,status:'online',observedAt:observationAt,lastOnlineAt:observationAt}}]};
async function bootHistory(){const f=fixture(),hook=f.mount();await flush();f.answer(0,historyHealth);f.answer(1,historyMap);await flush();assert.equal(hook.cameraHistory.size,1);return {f,hook};}

test('the real hook retains actual accepted history through read failure, then drops newer unknown evidence',async()=>{
 const {f,hook}=await bootHistory(),saved=hook.cameraHistory.get(historyUnit.id).observation;
 const failed=hook.refresh(true);await flush();f.answer(2,{error:'Synthetic saved-data read failed'},503);f.answer(3,historyMap);await failed;
 assert.match(hook.error,/failed/);assert.equal(hook.cameraHistory.get(historyUnit.id).observation,saved);assert.equal(saved.observedAt,observationAt);
 const reread=hook.refresh(true);await flush();f.answer(4,{...historyHealth,rows:historyHealth.rows.map(row=>({...row,evidence:{...row.evidence,status:'unknown',observedAt:new Date(f.now).toISOString()}}))});f.answer(5,historyMap);await reread;
 assert.equal(hook.error,'');assert.equal(hook.cameraHistory.size,0);
});

test('session invalidation clears nonempty camera history and rejects late old-session results',async()=>{
 const {f,hook}=await bootHistory(),pending=hook.refresh(true);await flush();f.window.dispatchEvent(new Event('cos-private-data-invalidated'));
 assert.equal(hook.cameraHistory.size,0);assert.equal(hook.fleet,null);f.answer(2,historyHealth);f.answer(3,historyMap);await pending;
 assert.equal(hook.cameraHistory.size,0);assert.equal(hook.fleet,null);
});

test('only a verified parent hide clears camera history, including an in-flight read',async()=>{
 const {f,hook}=await bootHistory(),saved=hook.fleet;
 f.window.dispatchEvent({type:'message',origin:'https://untrusted.example',source:{},data:{type:'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'}});assert.equal(hook.cameraHistory.size,1);
 const pending=hook.refresh(true);await flush();f.hide();assert.equal(hook.cameraHistory.size,0);assert.equal(hook.fleet,saved);assert.equal(hook.error,'');
 f.answer(2,historyHealth);f.answer(3,historyMap);await pending;assert.equal(hook.cameraHistory.size,0);assert.equal(hook.fleet,saved);
});

test('unmount discards hook-local history and a cold remount cannot invent it from cached stale observations',async()=>{
 const {f,hook}=await bootHistory();await f.visible(false);await f.advance(21*60000);
 const reread=f.api.fleet(true);await flush();f.answer(2,historyHealth);f.answer(3,historyMap);await reread;await flush();
 assert.equal(hook.cameraHistory.size,1,'the existing view remembers its actually accepted result');
 hook.unmount();const mounted=f.mount();await flush();
 assert.equal(f.requests.length,4,'the new view adopts the shared saved-data cache without another source read');assert.ok(mounted.fleet);assert.equal(mounted.cameraHistory.size,0,'stale source data alone cannot become a previously verified historical result');mounted.unmount();
});

for(const status of [401,403])test('real '+status+' saved-read denial clears history before late paired data can return',async()=>{
 const {f,hook}=await bootHistory(),pending=hook.refresh(true);await flush();
 f.answer(2,{error:'Synthetic authorization denied'},status);await flush();assert.equal(hook.cameraHistory.size,0);assert.equal(hook.fleet,null);
 f.answer(3,historyMap);await pending;assert.equal(hook.cameraHistory.size,0);assert.equal(hook.fleet,null);assert.equal(hook.loading,false);
});

test('a real same-role bearer rollover clears accepted history and fences old responses',async()=>{
 const {f,hook}=await bootHistory(),pending=hook.refresh(true);await flush();
 const body=deferred();f.requests[2].result.resolve({ok:true,status:200,json:()=>body.promise});await flush();
 f.state.token='synthetic-session-b';const current=f.api.get('/api/jobs');await flush();
 assert.equal(hook.cameraHistory.size,0);assert.equal(hook.fleet,null);f.answer(4,{items:[]});await current;
 body.resolve(historyHealth);f.answer(3,historyMap);await pending;assert.equal(hook.cameraHistory.size,0);assert.equal(hook.fleet,null);
});

test('nonempty history adds no background reads while hidden and cannot advance its source time',async()=>{
 const {f,hook}=await bootHistory(),saved=hook.cameraHistory.get(historyUnit.id).observation;
 await f.visible(false);await f.advance(21*60000);assert.equal(f.requests.length,2);assert.equal(hook.cameraHistory.get(historyUnit.id).observation,saved);assert.equal(saved.observedAt,observationAt);
 await f.visible(true);await f.visible(true);assert.equal(f.requests.length,4,'one existing shared refresh resumes; history has no separate reader');
 f.answer(2,historyHealth);f.answer(3,historyMap);await flush();assert.equal(hook.cameraHistory.get(historyUnit.id).observation.observedAt,observationAt);
 assert.ok(f.requests.every(request=>request.envelope.method==='GET'));assert.deepEqual([...new Set(f.requests.map(request=>request.envelope.path))].sort(),['/api/camera-health/summary-v3','/api/field-map']);
});

test('hide messages require both the exact parent source and the same origin',async()=>{
 const {f,hook}=await bootHistory(),saved=hook.fleet;
 for(const event of [
  {origin:'https://synthetic.example',source:{}},
  {origin:'https://untrusted.example',source:f.window.parent},
 ])f.window.dispatchEvent({type:'message',...event,data:{type:'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'}});
 assert.equal(hook.cameraHistory.size,1);f.hide();assert.equal(hook.cameraHistory.size,0);assert.equal(hook.fleet,saved);assert.equal(hook.error,'');
});

test('healthy hide clears only history and a new accepted refresh establishes new history',async()=>{
 const {f,hook}=await bootHistory(),saved=hook.fleet,calls=f.requests.length;
 f.hide();assert.equal(hook.cameraHistory.size,0);assert.equal(hook.fleet,saved);assert.equal(hook.error,'');assert.equal(hook.loading,false);assert.equal(f.requests.length,calls);
 const next=hook.refresh(true);await flush();f.answer(2,historyHealth);f.answer(3,historyMap);await next;
 assert.equal(hook.error,'');assert.equal(hook.cameraHistory.size,1);assert.equal(hook.cameraHistory.get(historyUnit.id).observation.observedAt,observationAt);
});

test('a pre-hide request awaiting parent authorization cannot repopulate cleared history',async()=>{
 const {f,hook}=await bootHistory(),saved=hook.fleet;f.state.autoReply=false;
 const pending=hook.refresh(true);await flush();assert.equal(f.requests.length,2);
 f.hide();assert.equal(hook.cameraHistory.size,0);assert.equal(hook.fleet,saved);assert.equal(hook.error,'');
 f.reply();f.state.autoReply=true;await flush();assert.equal(f.requests.length,4);f.answer(2,historyHealth);f.answer(3,historyMap);await pending;
 assert.ok(hook.fleet,'baseline current-fleet adoption remains unchanged');assert.equal(hook.error,'');assert.equal(hook.cameraHistory.size,0,'history belongs to the pre-hide generation');
 const current=hook.refresh(true);await flush();f.answer(4,historyHealth);f.answer(5,historyMap);await current;assert.equal(hook.cameraHistory.size,1);
});

test('a queued history updater cannot repopulate evidence after healthy hide',async()=>{
 const {f,hook}=await bootHistory();hook.deferHistory();
 const pending=hook.refresh(true);await flush();f.answer(2,historyHealth);f.answer(3,historyMap);await pending;
 assert.equal(hook.cameraHistory.size,1);const saved=hook.fleet;f.hide();assert.equal(hook.cameraHistory.size,0);
 hook.flushHistory();assert.equal(hook.cameraHistory.size,0,'the updater rechecks its history generation when React applies it');assert.equal(hook.fleet,saved);assert.equal(hook.error,'');
 const current=hook.refresh(true);await flush();f.answer(4,historyHealth);f.answer(5,historyMap);await current;assert.equal(hook.cameraHistory.size,1);
});

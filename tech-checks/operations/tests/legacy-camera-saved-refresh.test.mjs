import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import vm from 'node:vm';

// Execute the actual legacy page's load wrapper, scheduler and event handlers.
// The only substituted boundary is the saved-data reader. No sockets or services.
const html=readFileSync(new URL('../../camera-health.html',import.meta.url),'utf8');
const line=prefix=>html.split('\n').find(value=>value.startsWith(prefix));
const scheduler=html.slice(html.indexOf('// Rearm from the actual saved-data request start'),html.indexOf('function renderProviderHealth(){'));
const start=Date.parse('2026-10-15T15:00:00Z'),minute=60000;
const flush=()=>setImmediate();
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};}
function fixture(){
 let clock=start,nextId=0;
 const timers=new Map(),documentListeners=new Map(),windowListeners=new Map(),requests=[],warnings=[];
 const schedule=(fn,delay,repeat=false)=>{assert.ok(Number.isFinite(delay)&&delay>=0);const id=++nextId;timers.set(id,{fn,at:clock+delay,delay,repeat});return id;};
 const listen=(map,type,fn)=>{if(!map.has(type))map.set(type,[]);map.get(type).push(fn);};
 const dispatch=(map,type)=>{for(const callback of map.get(type)||[])callback({type});};
 const document={hidden:false,addEventListener:(type,fn)=>listen(documentListeners,type,fn)};
 const navigator={onLine:true};
 const context=vm.createContext({Date:class extends Date{static now(){return clock}},document,navigator,profile:{role:'owner'},boardDataReady:true,selectedUnitKey:null,
  console:{warn:(...args)=>warnings.push(args)},setTimeout:(fn,delay)=>schedule(fn,delay),clearTimeout:id=>timers.delete(id),setInterval:(fn,delay)=>schedule(fn,delay,true),clearInterval:id=>timers.delete(id),
  captureCameraView:()=>({search:'SNIPER 308'}),restoreCameraView:()=>{},render:()=>{},renderProviderHealth:()=>{},renderCurrentUnitEvidence:()=>{},renderOperations:()=>{},
  loadCameraHealth(options){const request={options,startedAt:clock,result:deferred()};requests.push(request);return request.result.promise;}});
 context.window={addEventListener:(type,fn)=>listen(windowListeners,type,fn)};
 vm.runInContext(html.slice(html.indexOf('let cameraLoadPromise='),html.indexOf('async function loadCameraHealth('))+'\n'+line('let liveRefreshTimer=')+'\n'+line('function markCameraInteraction(')+'\n'+scheduler,context);
 async function advance(ms){
  const end=clock+ms;
  for(let guard=0;guard<10000;guard++){
   const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
   if(!next){clock=end;await flush();return;}
   const [id,timer]=next;clock=timer.at;if(timer.repeat)timer.at+=timer.delay;else timers.delete(id);timer.fn();await flush();
  }
  assert.fail('Timer loop failed to settle');
 }
 const read=()=>context.load({background:true});
 const reply=async(index=requests.length-1)=>{requests[index].result.resolve();await flush();};
 const visible=async(value)=>{document.hidden=!value;dispatch(documentListeners,'visibilitychange');await flush();};
 const online=async(value)=>{navigator.onLine=value;dispatch(windowListeners,value?'online':'offline');await flush();};
 return {context,requests,warnings,timers,read,reply,advance,visible,online,dispatch:async(type)=>{dispatch(windowListeners,type);await flush();},get now(){return clock;}};
}
async function boot(){const f=fixture();const pending=f.read();await f.reply();await pending;f.context.startLiveUpdates();return f;}

test('actual saved reader runs at four minutes without a polling-phase delay',async()=>{
 const f=await boot();assert.equal(vm.runInContext('CAMERA_AUTO_REFRESH_MS',f.context),4*minute);
 await f.advance(4*minute-1);assert.equal(f.requests.length,1);
 await f.advance(1);assert.equal(f.requests.length,2);assert.equal(f.requests[1].startedAt,start+4*minute);await f.reply();
});

test('an intervening saved reread rephases the deadline instead of skipping a fixed interval',async()=>{
 const f=await boot();await f.advance(3*minute);const one=f.read(),two=f.read();assert.equal(one,two);assert.equal(f.requests.length,2);await f.reply();await one;
 await f.advance(minute);assert.equal(f.requests.length,2,'the original minute-four tick was cancelled');
 await f.advance(3*minute);assert.equal(f.requests.length,3);assert.equal(f.requests[2].startedAt,start+7*minute);await f.reply();
});

test('post-manual-result rereads wait for the old reader, coalesce, and own the next deadline',async()=>{
 const f=await boot();await f.advance(3*minute);const before=f.read(),after=f.context.loadAfterWrite({background:true}),peer=f.context.loadAfterWrite({background:true});
 assert.equal(f.requests.length,2);await f.advance(30000);await f.reply(1);await before;assert.equal(f.requests.length,3);assert.equal(f.requests[2].startedAt,start+3.5*minute);
 await f.reply(2);await Promise.all([after,peer]);await f.advance(4*minute-1);assert.equal(f.requests.length,3);await f.advance(1);assert.equal(f.requests.length,4);await f.reply();
});

test('initial completion does not reset the actual read start',async()=>{
 const f=fixture();const pending=f.read();await f.advance(minute);await f.reply();await pending;f.context.startLiveUpdates();
 await f.advance(3*minute-1);assert.equal(f.requests.length,1);await f.advance(1);assert.equal(f.requests.length,2);await f.reply();
});

test('a long in-flight read never overlaps and catches up once after its elapsed deadline',async()=>{
 const f=await boot();await f.advance(4*minute);assert.equal(f.requests.length,2);
 await f.advance(5*minute);await f.visible(true);await f.dispatch('online');assert.equal(f.requests.length,2);
 await f.reply(1);await f.advance(0);assert.equal(f.requests.length,3);assert.equal(f.requests[2].startedAt,start+9*minute);await f.reply(2);
 await f.advance(4*minute-1);assert.equal(f.requests.length,3);await f.advance(1);assert.equal(f.requests.length,4);await f.reply();
});

test('a failed saved read and its concurrent triggers retain the actual attempt deadline',async()=>{
 const f=await boot();await f.advance(4*minute);const peer=f.context.liveRefresh(true);await f.advance(20000);f.requests[1].result.reject(new Error('Synthetic saved read failed'));await peer;await flush();
 assert.equal(f.warnings.length,1);await f.visible(true);await f.dispatch('online');assert.equal(f.requests.length,2);
 await f.advance(4*minute-20001);assert.equal(f.requests.length,2);await f.advance(1);assert.equal(f.requests.length,3);assert.equal(f.requests[2].startedAt,start+8*minute);await f.reply();
});

test('hidden tabs pause timers and repeated return events coalesce one due read',async()=>{
 const f=await boot();await f.advance(minute);await f.visible(false);await f.advance(19*minute);assert.equal(f.requests.length,1);
 await f.visible(true);await f.visible(true);await f.dispatch('online');assert.equal(f.requests.length,2);assert.equal(f.requests[1].startedAt,start+20*minute);await f.reply();
 await f.visible(true);await f.advance(4*minute-1);assert.equal(f.requests.length,2);await f.advance(1);assert.equal(f.requests.length,3);await f.reply();
});

test('offline tabs pause and an online return catches up only when due',async()=>{
 const f=await boot();await f.advance(minute);await f.online(false);await f.advance(minute);await f.online(true);assert.equal(f.requests.length,1);
 await f.advance(minute);await f.online(false);await f.advance(8*minute);assert.equal(f.requests.length,1);await f.online(true);await f.online(true);assert.equal(f.requests.length,2);await f.reply();
});

test('continuous interaction cannot postpone a due saved read more than five seconds',async()=>{
 const f=await boot();await f.advance(4*minute-500);f.context.markCameraInteraction();await f.advance(500);assert.equal(f.requests.length,1);
 for(let i=0;i<10;i++){f.context.markCameraInteraction();await f.advance(500);}
 assert.equal(f.requests.length,2);assert.equal(f.requests[1].startedAt,start+4*minute+5000);await f.reply();
});

test('starting updates repeatedly leaves one freshness interval and one saved-read timer',async()=>{
 const f=await boot();f.context.startLiveUpdates();f.context.startLiveUpdates();assert.equal(f.timers.size,2);await f.advance(4*minute);assert.equal(f.requests.length,2);await f.reply();
});

test('unavailable authentication cannot keep polling',async()=>{
 const f=await boot();f.context.profile=null;await f.advance(8*minute);assert.equal(f.requests.length,1);assert.equal([...f.timers.values()].filter(x=>!x.repeat).length,0);
});

test('automatic path is saved-data-only and keeps evidence freshness separate from read cadence',()=>{
 const reader=html.slice(html.indexOf('async function loadCameraHealth('),html.indexOf('function applyCameraHealthUrlSearch('));
 assert.doesNotMatch(scheduler,/functions\.invoke|refreshFieldHealth|refreshSniperHealth|verifyNow|syncRecon/);
 assert.doesNotMatch(reader,/functions\.invoke|\.update\(|\.insert\(|\.upsert\(/);
 assert.match(html,/Saved status refreshes every 4 minutes; provider observation times are shown separately/);
 assert.doesNotMatch(html,/Backend checks every 5 minutes|screen refreshes every 10 minutes/);
 assert.match(html,/\$\('refresh'\)\.onclick=refreshFieldHealth/);
 assert.match(readFileSync(new URL('../../camera-health-history.js',import.meta.url),'utf8'),/const ttl = 20 \* 60 \* 1000/);
});


test('canceled post-save queued reads do not start after the shared predecessor',async()=>{
 const f=await boot(),controller=new AbortController();const before=f.read(),queued=f.context.loadAfterWrite({signal:controller.signal});controller.abort();await f.reply();await before;assert.equal(await queued,false);assert.equal(f.requests.length,2);
});

test('aborted readers release coalescing without late cleanup clearing a newer reader',async()=>{
 const f=await boot(),controller=new AbortController();const canceled=f.context.load({signal:controller.signal});assert.equal(f.requests.length,2);controller.abort();assert.equal(await canceled,false);assert.equal(f.requests[1].options.isCurrent(),false);
 const newer=f.read();assert.equal(f.requests.length,3);assert.equal(f.requests[2].options.isCurrent(),true);await f.reply(1);assert.equal(f.read(),newer);assert.equal(f.requests.length,3);await f.reply(2);await newer;
});

test('superseded Manage Units generation suppresses queued reads and invalidates in-flight application',async()=>{
 const f=await boot();let generation=1;const isCurrent=()=>generation===1;
 const before=f.read(),queued=f.context.loadAfterWrite({isCurrent});generation++;await f.reply();await before;assert.equal(await queued,false);assert.equal(f.requests.length,2);
 generation=1;const pending=f.context.load({isCurrent});generation++;assert.equal(f.requests[2].options.isCurrent(),false);await f.reply();await pending;
});

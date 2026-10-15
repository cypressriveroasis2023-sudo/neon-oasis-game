// Transport-only coordinator tests. Synthetic sessions, fetches and timers only.
// Deliberately allow transports/body reads to ignore abort, as cancellation does
// not prove that a remote request or its response body has already drained.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../../camera-placement-controls.js',import.meta.url),'utf8');
const endpoint='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const mapPath='/api/field-map';
const healthPath='/api/camera-health/summary-v3';
const mapName='Field Map inventory';
const healthName='equipment identity';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function flush(){await turn();await turn();}
function deferred(){
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  // A test may reject a synthetic body before the producer has entered json().
  promise.catch(()=>{});
  return {promise,resolve,reject};
}
function observe(promise){
  const result={state:'pending',value:null,error:null};
  result.done=Promise.resolve(promise).then(value=>{result.state='fulfilled';result.value=value;},error=>{result.state='rejected';result.error=error;});
  return result;
}
function fixture(){
  let now=0,nextTimer=0;
  const timers=new Map(),scheduled=[],requests=[];
  const db={};
  const session={user:{id:'synthetic-owner'},access_token:'synthetic-token'};
  const clock={
    setTimeout(callback,delay){
      const id=++nextTimer;
      timers.set(id,{at:now+Number(delay),callback});
      scheduled.push({id,at:now,delay:Number(delay)});
      return id;
    },
    clearTimeout(id){timers.delete(id);},
    async advance(ms){
      const target=now+ms;
      for(;;){
        const due=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
        if(!due)break;
        now=due[1].at;timers.delete(due[0]);due[1].callback();await flush();
      }
      now=target;await flush();
    }
  };
  class FakeDate extends Date{
    constructor(...args){super(...(args.length?args:[now]));}
    static now(){return now;}
  }
  const context=vm.createContext({AbortController,AbortSignal,Date:FakeDate,setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,fetch:(url,options)=>{
    assert.equal(url,endpoint);
    assert.equal(options.method,'POST');
    const body=JSON.parse(options.body);
    assert.equal(body.method,'GET');
    assert.equal(body.body,null);
    assert.ok([mapPath,healthPath].includes(body.path));
    assert.ok(options.signal,'each native transport must have a producer signal');
    const transport=deferred(),json=deferred();
    const request={path:body.path,options,transport,json,jsonReads:0};
    request.headers=(ok=true,status=ok?200:503)=>transport.resolve({ok,status,json(){request.jsonReads++;return json.promise;}});
    request.respond=value=>{request.headers();json.resolve(value);};
    requests.push(request);
    return transport.promise;
  }});
  vm.runInContext(source,context);
  assert.equal(typeof context.CameraPlacementControls.readFleetSources,'function','shared coordinator must expose its transport-only interface');
  const read=(options={})=>observe(context.CameraPlacementControls.readFleetSources({db,session,signal:new AbortController().signal,...options}));
  const pair=index=>{
    const calls=requests.slice(index*2,index*2+2);
    assert.equal(calls.length,2,'one producer must start exactly two native transports');
    const map=calls.find(request=>request.path===mapPath),health=calls.find(request=>request.path===healthPath);
    assert.ok(map);assert.ok(health);
    assert.equal(map.options.signal,health.options.signal,'one producer controls both source transports');
    return {map,health,signal:map.options.signal,respond(marker){map.respond({marker:marker+'-map'});health.respond({marker:marker+'-health'});}};
  };
  return {db,session,read,pair,requests,timers,scheduled,clock};
}
function assertRejected(result){assert.equal(result.state,'rejected');assert.ok(result.error);}
function assertPairValue(result,marker){
  assert.equal(result.state,'fulfilled');
  assert.equal(result.value.snapshot.marker,marker+'-map');
  assert.equal(result.value.health.marker,marker+'-health');
}

test('healthy simultaneous leases share one complete pair and exact transport credentials',async()=>{
  const f=fixture(),firstEvents=[],secondEvents=[];
  const a=f.read({share:true,onSource:value=>firstEvents.push(value)});
  const b=f.read({share:true,session:{user:{id:f.session.user.id},access_token:f.session.access_token},onSource:value=>secondEvents.push(value)});
  await flush();assert.equal(f.requests.length,2);
  const pair=f.pair(0);
  for(const request of f.requests){
    const headers=request.options.headers;
    assert.equal(headers.Authorization??headers.authorization,'Bearer synthetic-token');
  }
  assert.deepEqual(f.scheduled.map(timer=>timer.delay),[30000]);
  pair.map.respond({marker:'shared-map'});await flush();
  assert.deepEqual(firstEvents,[mapName]);assert.deepEqual(secondEvents,[mapName]);
  assert.equal(a.state,'pending');assert.equal(b.state,'pending');
  pair.health.respond({marker:'shared-health'});await flush();
  assertPairValue(a,'shared');assertPairValue(b,'shared');
  assert.deepEqual(firstEvents,[mapName,healthName]);assert.deepEqual(secondEvents,[mapName,healthName]);
  assert.equal(pair.map.jsonReads,1);assert.equal(pair.health.jsonReads,1);assert.equal(f.timers.size,0);
});

test('a pending join receives completed source progress but cannot receive a partial result',async()=>{
  const f=fixture(),a=f.read({share:true});await flush();
  const pair=f.pair(0);pair.map.respond({marker:'partial-map'});await flush();
  const events=[],b=f.read({share:true,onSource:value=>events.push(value)});await flush();
  assert.equal(f.requests.length,2);assert.deepEqual(events,[mapName]);
  assert.equal(a.state,'pending');assert.equal(b.state,'pending');
  pair.health.respond({marker:'partial-health'});await flush();
  assertPairValue(a,'partial');assertPairValue(b,'partial');assert.deepEqual(events,[mapName,healthName]);
});

for(const field of ['db','subject','token'])test('in-flight sharing is fenced by exact '+field,async()=>{
  const f=fixture(),a=f.read({share:true});
  const options=field==='db'?{db:{}}:{session:{user:{id:field==='subject'?'different-owner':f.session.user.id},access_token:field==='token'?'different-token':f.session.access_token}};
  const b=f.read({share:true,...options});await flush();assert.equal(f.requests.length,4);
  f.pair(0).respond('first');f.pair(1).respond('second');await flush();
  assertPairValue(a,'first');assertPairValue(b,'second');
});

test('fence keys capture session values rather than a mutable session object',async()=>{
  const f=fixture(),original={user:{id:f.session.user.id},access_token:f.session.access_token};
  const a=f.read({share:true});await flush();
  f.session.user.id='changed-owner';f.session.access_token='changed-token';
  const b=f.read({share:true}),c=f.read({share:true,session:original});await flush();
  assert.equal(f.requests.length,4);
  f.pair(0).respond('original');f.pair(1).respond('changed');await flush();
  assertPairValue(a,'original');assertPairValue(c,'original');assertPairValue(b,'changed');
});

test('private and omitted-share reads always start fresh even beside a healthy shared pair',async()=>{
  const f=fixture(),shared=f.read({share:true}),privateRead=f.read({share:false}),defaultRead=f.read();await flush();
  assert.equal(f.requests.length,6);
  f.pair(0).respond('shared');f.pair(1).respond('private');f.pair(2).respond('default');await flush();
  assertPairValue(shared,'shared');assertPairValue(privateRead,'private');assertPairValue(defaultRead,'default');
});

test('already-aborted consumers do not start or join a source producer',async()=>{
  const f=fixture(),controller=new AbortController();controller.abort();
  const cancelled=f.read({share:true,signal:controller.signal});await flush();
  assertRejected(cancelled);assert.equal(f.requests.length,0);assert.equal(f.timers.size,0);
  const live=f.read({share:true});await flush();
  const join=f.read({share:true,signal:controller.signal});await flush();
  assertRejected(join);assert.equal(f.requests.length,2);assert.equal(f.pair(0).signal.aborted,false);
  f.pair(0).respond('live');await flush();assertPairValue(live,'live');
});

test('a 15-second display cancellation releases only its lease while the modal keeps waiting',async()=>{
  const f=fixture(),display=new AbortController(),modal=new AbortController(),displayEvents=[],modalEvents=[];
  const a=f.read({share:true,signal:display.signal,onSource:value=>displayEvents.push(value)});
  const b=f.read({share:true,signal:modal.signal,onSource:value=>modalEvents.push(value)});await flush();
  const pair=f.pair(0);assert.notEqual(pair.signal,display.signal);assert.notEqual(pair.signal,modal.signal);
  f.clock.setTimeout(()=>display.abort(),15000);await f.clock.advance(15000);
  assertRejected(a);assert.equal(b.state,'pending');assert.equal(pair.signal.aborted,false);
  pair.respond('modal');await flush();assertPairValue(b,'modal');
  assert.deepEqual(displayEvents,[]);assert.deepEqual(modalEvents,[mapName,healthName]);
  assert.equal(f.requests.length,2);assert.equal(f.timers.size,0);
});

test('the last consumer cancellation aborts both transports and clears the fixed deadline',async()=>{
  const f=fixture(),first=new AbortController(),last=new AbortController();
  const a=f.read({share:true,signal:first.signal}),b=f.read({share:true,signal:last.signal});await flush();
  const pair=f.pair(0);first.abort();await flush();assertRejected(a);assert.equal(pair.signal.aborted,false);
  last.abort();await flush();assertRejected(b);assert.equal(pair.signal.aborted,true);assert.equal(f.timers.size,0);
  // Late success cannot resurrect cancelled consumers.
  pair.respond('late');await flush();assertRejected(a);assertRejected(b);
});

test('the producer deadline is fixed at 30 seconds and a late join never renews it',async()=>{
  const f=fixture(),a=f.read({share:true});await flush();const pair=f.pair(0);
  await f.clock.advance(29999);assert.equal(a.state,'pending');
  const b=f.read({share:true});await flush();assert.equal(f.requests.length,2);
  assert.deepEqual(f.scheduled.map(timer=>timer.delay),[30000]);
  await f.clock.advance(1);assertRejected(a);assertRejected(b);assert.equal(pair.signal.aborted,true);
  assert.equal(f.timers.size,0);
  pair.respond('too-late');await flush();assertRejected(a);assertRejected(b);
});

for(const failedPath of [mapPath,healthPath])for(const failure of ['HTTP','body'])test(failure+' failure in '+failedPath+' aborts the pair and holds the barrier through sibling body drain',async()=>{
  const f=fixture(),a=f.read({share:true}),b=f.read({share:true});await flush();const pair=f.pair(0);
  const bad=failedPath===mapPath?pair.map:pair.health,peer=failedPath===mapPath?pair.health:pair.map;
  peer.headers();await flush();assert.equal(peer.jsonReads,1);
  if(failure==='HTTP')bad.headers(false);
  else{bad.headers();await flush();bad.json.reject(Error('Synthetic malformed JSON'));}
  await flush();assertRejected(a);assertRejected(b);assert.equal(pair.signal.aborted,true);
  const blocked=f.read({share:true});await flush();assertRejected(blocked);assert.equal(f.requests.length,2);
  assert.equal(peer.jsonReads,1,'body was started and remains unresolved after abort');
  peer.json.resolve({marker:'drained-peer'});await flush();
  const retry=f.read({share:true});await flush();assert.equal(f.requests.length,4);
  f.pair(1).respond('retry');await flush();assertPairValue(retry,'retry');
  assertRejected(a);assertRejected(b);
});

test('a transport failure barrier remains until the sibling transport AND its late body settle',async()=>{
  const f=fixture(),a=f.read({share:true});await flush();const pair=f.pair(0);
  pair.map.transport.reject(Error('Synthetic connection failure'));await flush();assertRejected(a);assert.equal(pair.signal.aborted,true);
  const beforeHeaders=f.read({share:true});await flush();assertRejected(beforeHeaders);assert.equal(f.requests.length,2);
  pair.health.headers();await flush();
  const beforeBody=f.read({share:true});await flush();assertRejected(beforeBody);assert.equal(f.requests.length,2);
  assert.equal(pair.health.jsonReads,1);
  pair.health.json.resolve({marker:'late-health'});await flush();
  const retry=f.read({share:true});await flush();assert.equal(f.requests.length,4);
  f.pair(1).respond('fresh');await flush();assertPairValue(retry,'fresh');assertRejected(a);
});

test('a private retry bypasses a failed draining pair without clearing its automatic-read barrier',async()=>{
  const f=fixture(),initial=f.read({share:true});await flush();const old=f.pair(0);
  old.health.headers();await flush();old.map.headers(false);await flush();assertRejected(initial);
  const privateRetry=f.read({share:false});await flush();assert.equal(f.requests.length,4);
  const blocked=f.read({share:true});await flush();assertRejected(blocked);assert.equal(f.requests.length,4);
  f.pair(1).respond('private');await flush();assertPairValue(privateRetry,'private');
  const stillBlocked=f.read({share:true});await flush();assertRejected(stillBlocked);assert.equal(f.requests.length,4);
  old.health.json.resolve({marker:'stale'});await flush();
  const automatic=f.read({share:true});await flush();assert.equal(f.requests.length,6);
  f.pair(2).respond('automatic');await flush();assertPairValue(automatic,'automatic');assertRejected(initial);
});

test('a terminal success is not joinable during its last progress callback and cannot delete the next pair',async()=>{
  const f=fixture();let reentered;
  const first=f.read({share:true,onSource:name=>{if(name===healthName)reentered=f.read({share:true});}});await flush();
  const old=f.pair(0);old.map.respond({marker:'old-map'});await flush();old.health.respond({marker:'old-health'});await flush();
  assertPairValue(first,'old');assert.ok(reentered);assert.equal(reentered.state,'pending');assert.equal(f.requests.length,4);
  // The old all-settled cleanup has run by now. It must not remove pair 2.
  const follower=f.read({share:true});await flush();assert.equal(f.requests.length,4);
  f.pair(1).respond('new');await flush();assertPairValue(reentered,'new');assertPairValue(follower,'new');
});

test('completed pairs are never a cache for later reads',async()=>{
  const f=fixture(),first=f.read({share:true});await flush();f.pair(0).respond('old');await flush();assertPairValue(first,'old');
  const next=f.read({share:true});await flush();assert.equal(f.requests.length,4);assert.equal(next.state,'pending');
  f.pair(1).respond('new');await flush();assertPairValue(next,'new');
});

test('cancelling from source progress cannot poison another active lease or deliver late progress',async()=>{
  const f=fixture(),controller=new AbortController(),events=[];
  const cancelled=f.read({share:true,signal:controller.signal,onSource:name=>{events.push(name);controller.abort();}});
  const live=f.read({share:true});await flush();const pair=f.pair(0);
  pair.map.respond({marker:'live-map'});await flush();assertRejected(cancelled);assert.equal(pair.signal.aborted,false);
  pair.health.respond({marker:'live-health'});await flush();assertPairValue(live,'live');assert.deepEqual(events,[mapName]);
});

test('private freshness is preserved before and after a shared initial read completes',async()=>{
  const f=fixture(),initial=f.read({share:true});await flush();
  const preflight=f.read({share:false});await flush();assert.equal(f.requests.length,4);
  f.pair(1).respond('preflight');await flush();assertPairValue(preflight,'preflight');assert.equal(initial.state,'pending');
  f.pair(0).respond('initial');await flush();assertPairValue(initial,'initial');
  const readback=f.read({share:false});await flush();assert.equal(f.requests.length,6);assert.equal(readback.state,'pending');
  f.pair(2).respond('readback');await flush();assertPairValue(readback,'readback');
});

for(const session of [null,{user:{id:''},access_token:'synthetic-token'},{user:{id:'synthetic-owner'},access_token:''},{user:{id:17},access_token:'synthetic-token'},{user:{id:'synthetic-owner'},access_token:17}])test('missing or malformed session credentials cannot start a pair: '+JSON.stringify(session),async()=>{
  const f=fixture(),read=f.read({share:true,session});await flush();
  assertRejected(read);assert.equal(f.requests.length,0);assert.equal(f.timers.size,0);
});

test('progress callback exceptions cannot reject or poison a shared transport',async()=>{
  const f=fixture(),a=f.read({share:true,onSource:()=>{throw Error('Synthetic presentation failure');}}),b=f.read({share:true});await flush();
  f.pair(0).respond('valid');await flush();assertPairValue(a,'valid');assertPairValue(b,'valid');
});

test('a cancellation caused by another progress callback suppresses the cancelled lease callback',async()=>{
  const f=fixture(),cancelledController=new AbortController(),events=[];
  const live=f.read({share:true,onSource:()=>cancelledController.abort()});
  const cancelled=f.read({share:true,signal:cancelledController.signal,onSource:name=>events.push(name)});await flush();
  const pair=f.pair(0);pair.map.respond({marker:'live-map'});await flush();assertRejected(cancelled);
  assert.deepEqual(events,[],'a released consumer must not receive copied notification work');
  assert.equal(pair.signal.aborted,false);pair.health.respond({marker:'live-health'});await flush();assertPairValue(live,'live');
});

test('a timed-out pair remains an automatic-read barrier until ignored aborts actually drain',async()=>{
  const f=fixture(),a=f.read({share:true});await flush();const old=f.pair(0);
  old.map.headers();old.health.headers();await flush();await f.clock.advance(30000);assertRejected(a);
  const blocked=f.read({share:true});await flush();assertRejected(blocked);assert.equal(f.requests.length,2);
  old.map.json.resolve({marker:'old-map'});await flush();
  const halfDrained=f.read({share:true});await flush();assertRejected(halfDrained);assert.equal(f.requests.length,2);
  old.health.json.resolve({marker:'old-health'});await flush();
  const fresh=f.read({share:true});await flush();assert.equal(f.requests.length,4);
  f.pair(1).respond('fresh');await flush();assertPairValue(fresh,'fresh');assertRejected(a);
});

test('the final released lease holds a drain barrier while an explicit fresh private read proceeds',async()=>{
  const f=fixture(),controller=new AbortController(),cancelled=f.read({share:true,signal:controller.signal});await flush();const old=f.pair(0);
  controller.abort();await flush();assertRejected(cancelled);
  const blocked=f.read({share:true});await flush();assertRejected(blocked);assert.equal(f.requests.length,2);
  const retry=f.read({share:false});await flush();assert.equal(f.requests.length,4);
  f.pair(1).respond('retry');await flush();assertPairValue(retry,'retry');
  old.respond('discarded');await flush();assertRejected(cancelled);
  const fresh=f.read({share:true});await flush();assert.equal(f.requests.length,6);
  f.pair(2).respond('fresh');await flush();assertPairValue(fresh,'fresh');
});

test('health-first progress is replayed to a join without changing result fields',async()=>{
  const f=fixture(),first=f.read({share:true});await flush();const pair=f.pair(0);
  pair.health.respond({marker:'health-first-health'});await flush();
  const events=[],join=f.read({share:true,onSource:name=>events.push(name)});await flush();
  assert.deepEqual(events,[healthName]);assert.equal(join.state,'pending');assert.equal(f.requests.length,2);
  pair.map.respond({marker:'health-first-map'});await flush();assertPairValue(first,'health-first');assertPairValue(join,'health-first');
  assert.deepEqual(events,[healthName,mapName]);
});

test('a synchronous join from partial progress reuses the healthy pair and receives each source once',async()=>{
  const f=fixture(),events=[];let join;
  const first=f.read({share:true,onSource:name=>{if(name===mapName)join=f.read({share:true,onSource:value=>events.push(value)});}});await flush();
  const pair=f.pair(0);pair.map.respond({marker:'reentrant-map'});await flush();
  assert.ok(join);assert.equal(f.requests.length,2);assert.deepEqual(events,[mapName]);assert.equal(join.state,'pending');
  pair.health.respond({marker:'reentrant-health'});await flush();assertPairValue(first,'reentrant');assertPairValue(join,'reentrant');
  assert.deepEqual(events,[mapName,healthName]);
});

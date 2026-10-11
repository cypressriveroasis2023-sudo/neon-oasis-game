import test from 'node:test';
import assert from 'node:assert/strict';
import {captureSourceServiceScope,StaleSourceServiceView} from '../../source-service-lifecycle.js';
import {sourceITSessionIdentity as sourceServiceSessionIdentity} from '../../source-it-lifecycle.js';
const uid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const token=(actor=uid(1),session=uid(2),generation=1)=>[Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),Buffer.from(JSON.stringify({sub:actor,session_id:session,iat:generation})).toString('base64url'),'synthetic'].join('.');
function session(actor=uid(1),id=uid(2),generation=1){return {user:{id:actor},access_token:token(actor,id,generation)};}
function deferred(){let resolve;return {promise:new Promise(r=>resolve=r),resolve};}
function fixture(){
  class Node extends EventTarget{constructor(parent=null){super();this.parentElement=parent;this.children=[];this.isConnected=true;this.hidden=false;this.style={display:'block',visibility:'visible'};this.value='';this.checked=false;parent?.children.push(this);}contains(node){for(let current=node;current;current=current.parentElement)if(current===this)return true;return false;}querySelectorAll(){return [input];}}
  const body=new Node(),view=new Node(body),card=new Node(view),input=new Node(card);let records=[],observer,authHandler,unsubscribed=0,invalidations=0,generation=0;
  const environment=new EventTarget();environment.document=Object.assign(new EventTarget(),{body,hidden:false});environment.location={href:'https://synthetic.invalid/tech-checks',origin:'https://synthetic.invalid'};environment.getComputedStyle=node=>node.style;environment.parent=environment;
  environment.MutationObserver=class{constructor(callback){this.callback=callback;observer=this;}observe(){}disconnect(){this.disconnected=true;}takeRecords(){const list=records;records=[];return list;}};
  let cached=session(),fresh=cached,profile={user_id:uid(1),role:'service',active:true,archived_at:null},effective={id:uid(1),role:'service',owner_test:false},transport=async()=>({data:{session:fresh}});
  const db={auth:{getSession:()=>transport(),onAuthStateChange:handler=>{authHandler=handler;return {data:{subscription:{unsubscribe(){unsubscribed++;}}}};}}};
  const context={db,getSession:()=>cached,getProfile:()=>profile,getRole:()=>profile.role,getEffectiveRole:()=>effective.role,getEffectiveIdentity:()=>effective};
  const capture=extra=>captureSourceServiceScope({context,view,getGeneration:()=>generation,environment,onInvalidate:()=>invalidations++,...extra});
  return {capture,context,environment,view,card,input,body,get cached(){return cached;},setCached:value=>cached=value,setFresh:value=>fresh=value,setProfile:value=>profile={...profile,...value},setEffective:value=>effective={...effective,...value},setTransport:fn=>transport=fn,navigate:()=>generation++,records:value=>records.push(...value),flush:()=>observer.callback(observer.takeRecords()),auth:(event,value)=>authHandler(event,value),counts:()=>({unsubscribed,invalidations}),Node};
}
test('session correlation requires strict JWT shape, matching subject and stable logical session',()=>{
  assert.deepEqual(sourceServiceSessionIdentity(session()),{actor:uid(1),sessionId:uid(2)});
  assert.deepEqual(sourceServiceSessionIdentity(session(uid(1),uid(2),2)),sourceServiceSessionIdentity(session()));
  for(const value of [null,{user:{id:uid(1)},access_token:'opaque'},{user:{id:uid(3)},access_token:token()},{...session(),session_id:uid(4)},{...session(),access_token:token().split('.').slice(0,2).join('.')},{...session(),access_token:token(uid(1),'malformed')}])assert.equal(sourceServiceSessionIdentity(value),null);
});
test('matching INITIAL_SESSION and refresh remain usable; replacement login permanently invalidates',async()=>{
  const f=fixture(),scope=f.capture();f.auth('INITIAL_SESSION',f.cached);assert(scope.isCurrent());
  const refreshed=session(uid(1),uid(2),2);f.setCached(refreshed);f.setFresh(refreshed);f.auth('TOKEN_REFRESHED',refreshed);await scope.assertFresh();
  f.auth('SIGNED_IN',session(uid(1),uid(3)));f.auth('TOKEN_REFRESHED',refreshed);assert.equal(scope.isCurrent(),false);assert.equal(f.counts().invalidations,1);scope.dispose();assert.equal(f.counts().unsubscribed,1);
});
for(const name of ['cached-session','fresh-session','actor','inactive','archived','owner-preview','view-hidden','card-replaced','navigation','href','input'])test(`pending actual fresh-auth read cannot resume after ${name}`,async()=>{
  const f=fixture(),scope=f.capture(),held=deferred();f.setTransport(()=>held.promise);const pending=scope.assertFresh();
  if(name==='cached-session')f.setCached(session(uid(1),uid(3)));
  if(name==='actor')f.setCached(session(uid(3),uid(2)));
  if(name==='inactive')f.setProfile({active:false});
  if(name==='archived')f.setProfile({archived_at:'synthetic'});
  if(name==='owner-preview')f.setEffective({owner_test:true});
  if(name==='view-hidden')f.view.hidden=true;
  if(name==='card-replaced')f.view.children=[new f.Node()];
  if(name==='navigation')f.navigate();
  if(name==='href')f.environment.location.href+='#replacement';
  if(name==='input')f.input.value='replacement';
  held.resolve({data:{session:name==='fresh-session'?session(uid(1),uid(3)):f.cached}});
  await assert.rejects(pending,StaleSourceServiceView);assert.equal(scope.isCurrent(),false);scope.dispose();
});
test('same-task hide/restore and detach/reattach records permanently cancel the captured card',()=>{
  for(const record of ['attribute','remove']){
    const f=fixture(),scope=f.capture();f.records(record==='attribute'?[{type:'attributes',target:f.view}]:[{type:'childList',removedNodes:[f.card]}]);
    assert.equal(scope.isCurrent(),false);assert.equal(f.counts().invalidations,1);scope.dispose();
  }
});
test('Back, Forward, page hide and private invalidation cancel without another request',()=>{
  for(const event of ['popstate','hashchange','pagehide','techcheck:view-changed','techcheck:owner-test-role','cos-private-data-invalidated','cos-workspace-navigation']){
    const f=fixture(),scope=f.capture();f.environment.dispatchEvent(new Event(event));assert.equal(scope.isCurrent(),false);scope.dispose();
  }
});
test('aria-hidden, inert and page background invalidate the original view',()=>{
  for(const mode of ['aria','inert','document']){
    const f=fixture(),scope=f.capture();
    if(mode==='aria')f.body.getAttribute=name=>name==='aria-hidden'?'true':null;
    if(mode==='inert')f.body.inert=true;
    if(mode==='document'){f.environment.document.hidden=true;f.environment.document.dispatchEvent(new Event('visibilitychange'));}
    assert.equal(scope.isCurrent(),false);scope.dispose();
  }
});
test('only verified same-origin parent private-hide messages invalidate embedded source UI',()=>{
  const f=fixture();f.environment.parent={};const scope=f.capture();
  const send=(source,origin)=>f.environment.dispatchEvent(Object.assign(new Event('message'),{source,origin,data:{type:'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'}}));
  send({},f.environment.location.origin);send(f.environment.parent,'https://unrelated.invalid');assert(scope.isCurrent());
  send(f.environment.parent,f.environment.location.origin);assert.equal(scope.isCurrent(),false);scope.dispose();
});
test('fresh-auth error or unavailable auth fails closed; capture rejects inactive actual Service',async()=>{
  const f=fixture(),scope=f.capture();f.setTransport(async()=>({error:new Error('synthetic')}));await assert.rejects(scope.assertFresh(),StaleSourceServiceView);scope.dispose();
  const inactive=fixture();inactive.setProfile({active:false});assert.throws(()=>inactive.capture(),StaleSourceServiceView);
});

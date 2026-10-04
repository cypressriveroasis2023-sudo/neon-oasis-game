import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../../production-assignments-host.js',import.meta.url),'utf8');
const origin='https://cypressriveroasis2023-sudo.github.io';
function harness(role='it'){
  const observers=[],nodes=[];
  class Node{
    constructor(type){this.type=type;this.children=[];this.events={};this.hidden=false;this.classes=new Set();this.classList={contains:v=>this.classes.has(v),add:v=>this.classes.add(v),remove:v=>this.classes.delete(v)};nodes.push(this);if(type==='iframe')this.contentWindow={messages:[],postMessage:(value,target)=>this.contentWindow.messages.push({value,target})};}
    appendChild(child){this.children.push(child);child.parent=this;}
    setAttribute(key,value){this[key]=value;}
    addEventListener(type,fn){(this.events[type]??=[]).push(fn);}
    click(){for(const fn of this.events.click||[])fn();}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(v=>v!==this);this.removed=true;}
  }
  const body=new Node('body'),app=new Node('div'),auth=new Node('div');
  app.id='appView';auth.id='authView';
  const state={role,effectiveRole:role,id:'legacy-tech',profile:{user_id:'legacy-tech',active:true},fresh:async()=>({data:{session:{user:{id:state.id},access_token:'fresh-token'}}})};
  const events={},calls={auth:0};
  const window={location:{origin},addEventListener:(name,fn)=>(events[name]??=[]).push(fn),TechCheckContext:{getRole:()=>state.role,getEffectiveRole:()=>state.effectiveRole,getSession:()=>({user:{id:state.id}}),getProfile:()=>state.profile,db:{auth:{onAuthStateChange:fn=>{state.authListener=fn;return{};},getSession:()=>{calls.auth++;return state.fresh();}}}}};
  const document={body,getElementById:id=>nodes.find(node=>node.id===id)||null,createElement:type=>new Node(type)};
  class MutationObserver{constructor(fn){this.fn=fn;observers.push(this);}observe(){}}
  vm.runInNewContext(source,{window,document,MutationObserver});
  const node=id=>nodes.find(n=>n.id===id&&!n.removed);
  const emit=async(type,data)=>{await Promise.all((events[type]||[]).map(fn=>fn(data)));};
  const refresh=()=>{for(const observer of observers)observer.fn();};
  const open=()=>{node('cosProductionAssignmentsButton').click();return node('cosProductionAssignmentsFrame');};
  const token=(frame,id='request',fromOrigin=origin,fromSource=frame.contentWindow)=>emit('message',{origin:fromOrigin,source:fromSource,data:{type:'COS_OPERATIONS_TOKEN_REQUEST',requestId:id}});
  return{state,calls,body,app,auth,node,emit,refresh,open,token};
}
test('only actual active IT/Service identities can open a separate queue',()=>{
  for(const role of ['it','service']){const h=harness(role);assert.equal(h.node('cosProductionAssignmentsButton').hidden,false);const f=h.open();assert.match(f.src,/mode=production-assignments/);assert.equal(f.referrerPolicy,'same-origin');h.node('cosProductionAssignmentsClose').click();assert.equal(h.node('cosProductionAssignmentsFrame'),undefined);}
  for(const role of ['owner',null,'sales']){const h=harness(role);assert.equal(h.node('cosProductionAssignmentsButton').hidden,true);assert.equal(h.open(),undefined);}
});
test('preview, archived and inactive technicians cannot obtain a frame',()=>{
  for(const mutate of [h=>h.state.effectiveRole='service',h=>h.body.classes.add('owner-test-role-preview'),h=>h.state.profile.active=false,h=>h.state.profile.archived_at='2026-01-01',h=>h.state.profile.user_id='other']){const h=harness();mutate(h);h.refresh();assert.equal(h.node('cosProductionAssignmentsButton').hidden,true);assert.equal(h.open(),undefined);}
});
test('token is fresh, correlated and restricted to exact same-origin frame',async()=>{
  const h=harness(),frame=h.open();
  await h.token(frame,'foreign','https://example.com');await h.token(frame,'sibling',origin,{});assert.equal(h.calls.auth,0);
  await h.token(frame,'good');assert.equal(h.calls.auth,1);assert.equal(frame.contentWindow.messages.length,1);
  const response=frame.contentWindow.messages[0];assert.equal(response.target,origin);assert.equal(response.value.requestId,'good');assert.equal(response.value.accessToken,'fresh-token');assert.equal(response.value.role,'it');
});
test('account changes, logout and preview remove frame without changing tech mounts',()=>{
  for(const mutate of [h=>h.state.id='other',h=>h.state.role='owner',h=>h.app.classes.add('hidden'),h=>h.state.effectiveRole='service']){const h=harness(),frame=h.open();mutate(h);h.refresh();assert.equal(frame.removed,true);assert.equal(h.node('cosProductionAssignmentsOverlay').hidden,true);assert.equal(h.body.classes.has('cos-production-assignments-open'),false);}
});
test('late token response cannot reach a replaced or closed assignment frame',async()=>{
  const h=harness(),frame=h.open();let resolve;h.state.fresh=()=>new Promise(done=>{resolve=done;});
  const request=h.token(frame);h.node('cosProductionAssignmentsClose').click();h.open();resolve({data:{session:{user:{id:'legacy-tech'},access_token:'late'}}});await request;assert.equal(frame.contentWindow.messages.length,0);
});
test('fresh subject mismatch fails closed and owner navigation messages do nothing',async()=>{
  const h=harness(),frame=h.open();h.state.fresh=async()=>({data:{session:{user:{id:'different'},access_token:'wrong'}}});await h.token(frame);assert.equal(frame.removed,true);assert.equal(frame.contentWindow.messages.length,0);
  const next=harness(),nextFrame=next.open();
  await next.emit('message',{origin,source:nextFrame.contentWindow,data:{type:'COS_OPERATIONS_NAVIGATE',route:'accounts'}});assert.equal(next.node('cosProductionAssignmentsOverlay').hidden,false);
  await next.emit('message',{origin,source:nextFrame.contentWindow,data:{type:'COS_OPERATIONS_NAVIGATE',route:'production-return'}});assert.equal(nextFrame.removed,true);
});
test('a changed identity while getSession awaits never receives bearer',async()=>{
  const h=harness(),frame=h.open();let resolve;h.state.fresh=()=>new Promise(done=>{resolve=done;});const request=h.token(frame);h.state.id='other';h.state.profile.user_id='other';resolve({data:{session:{user:{id:'legacy-tech'},access_token:'old'}}});await request;assert.equal(frame.contentWindow.messages[0].value.accessToken,null);
});

test('cross-tab signout and account switch clear displayed queue using auth subscription',()=>{
  for(const session of [null,{user:{id:'different-tech'}}]){const h=harness(),frame=h.open();h.state.authListener(session?'SIGNED_IN':'SIGNED_OUT',session);assert.equal(frame.removed,true);assert.equal(h.node('cosProductionAssignmentsButton').hidden,true);}
});
test('token refresh for same subject preserves frame and native role',()=>{
  const h=harness(),frame=h.open();h.state.authListener('TOKEN_REFRESHED',{user:{id:'legacy-tech'}});assert.equal(frame.removed,undefined);assert.equal(h.node('cosProductionAssignmentsButton').hidden,false);
});

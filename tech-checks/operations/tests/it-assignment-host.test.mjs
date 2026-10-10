import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { setImmediate as tick } from 'node:timers/promises';
const host = readFileSync(new URL('../../verified-it-fleet-host.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
const projections = await import('data:text/javascript;base64,' + Buffer.from(readFileSync(new URL('../../it-mhelp-projection.js', import.meta.url), 'utf8')).toString('base64'));
const subject = '4f7044b5-86b6-411f-8898-39bb64b4ddbc', other = 'b7cc3cbf-d11e-4d4a-9742-c07701857911';
const row = patch => ({ id: '11111111-1111-4111-8111-111111111111', ticket_no: 'SYN-501', site: 'Synthetic shell site', work_type: 'service', scheduled_for: '2026-10-10', scheduled_time: '10:30', assigned_role: 'it', status: 'assigned', assignee_user_id: subject, assignment_scope: 'technician', job_lead_user_id: null, equipment_manifest: [], unit_summary: '', ...patch });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture() {
  const nodes = [], observers = [], events = {}, timers = new Map(), calls = [];
  let nextTimer = 0;
  class Node {
    constructor(tag = 'div') { this.tagName=tag; this.children=[]; this.classes=new Set(); this.classList={contains:key=>this.classes.has(key)}; this.events={}; this.style={}; this.dataset={}; nodes.push(this); if(tag==='iframe')this.contentWindow={messages:[],postMessage:(message,origin)=>this.contentWindow.messages.push({message,origin})}; }
    get isConnected() { return this===body||Boolean(this.parentElement?.isConnected); }
    setAttribute(name,value) { this[name]=value; }
    append(...children) { for(const child of children){child.remove();child.parentElement=this;this.children.push(child);} }
    after(child) { const parent=this.parentElement;child.remove();child.parentElement=parent;parent.children.splice(parent.children.indexOf(this)+1,0,child); }
    remove() { if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null; }
    addEventListener(name,fn) { this.events[name]=fn; }
    getClientRects() { return this.isConnected&&!this.classes.has('hidden')?[1]:[]; }
    showModal() {} focus() {} click() { this.onclick?.(); }
  }
  const body=new Node('body'),app=new Node(),home=new Node(),head=new Node();app.id='appView';home.id='wlItHome';body.append(app);app.append(home);home.append(head);
  const state={id:subject,role:'it',effective:'it',profile:{user_id:subject,active:true},rows:[row()],capability:true};
  state.fresh=()=>({data:{session:state.id?{user:{id:state.id},access_token:'synthetic-only'}:null}});
  state.rpc=name=>name==='my_available_assignments'?{data:state.rows}:name==='my_managed_tickets_v1'?{data:[]}:{data:{fleetRead:state.capability}};
  const context={getSession:()=>state.id?{user:{id:state.id}}:null,getRole:()=>state.role,getEffectiveRole:()=>state.effective,getProfile:()=>state.profile,db:{rpc:async(name,args)=>{calls.push({name,args});return state.rpc(name,args);},auth:{onAuthStateChange:fn=>{state.auth=fn;},getSession:async()=>state.fresh()}}};
  const window={TechCheckContext:context,addEventListener:(name,fn)=>{(events[name]??=[]).push(fn);}};
  const location={origin:'https://synthetic.example',search:'',assign:()=>{throw Error('Unexpected external navigation');}};
  const document={body,getElementById:id=>nodes.find(node=>node.id===id&&node.isConnected),querySelector:selector=>selector==='#wlItHome .wl-it-command-head'?head:null,createElement:tag=>new Node(tag)};
  class MutationObserver { constructor(fn){observers.push(fn);} observe(){} }
  vm.runInNewContext(host,{...projections,window,location,document,MutationObserver,URLSearchParams,AbortController,queueMicrotask,Date,
    setFieldMapDisplay:()=>{},setTimeout:(fn,delay)=>{timers.set(++nextTimer,{fn,delay});return nextTimer;},clearTimeout:id=>timers.delete(id),
    fetch:async()=>({ok:true,json:async()=>({authorized:true,legacyOwner:false,role:'IT',features:{unitTracker:true}})})});
  await tick();await tick();
  const frame=()=>nodes.find(node=>node.tagName==='iframe'&&node.isConnected);
  const emit=async(data,source=frame()?.contentWindow,origin=location.origin)=>{await Promise.all((events.message||[]).map(fn=>fn({data,source,origin})));};
  const refresh=async()=>{for(const fn of observers)fn();await tick();};
  return {state,context,calls,timers,body,app,frame,emit,refresh,
    read:(requestId='queue',source=frame()?.contentWindow,origin=location.origin)=>emit({type:'COS_IT_ASSIGNMENTS_REQUEST',requestId},source,origin),
    close:()=>nodes.find(node=>node.tagName==='button'&&node.isConnected&&node.textContent==='← Return to IT Tech Checks').click(),
    open:()=>nodes.find(node=>node.isConnected&&node.dataset.cosItDashboard==='').click(),
    responses:frame=>frame.contentWindow.messages.map(entry=>entry.message).filter(message=>message.type==='COS_IT_ASSIGNMENTS_RESPONSE'),
  };
}
const queueCalls=f=>f.calls.filter(call=>call.name==='my_available_assignments');
test('actual host uses only the existing current-user IT RPC and projects null-lead own plus department shells',async()=>{
  const f=await fixture();f.state.rows.push(row({id:'22222222-2222-4222-8222-222222222222',assignee_user_id:null,assignment_scope:'department'}));
  const frame=f.frame();await f.read();
  assert.deepEqual(JSON.parse(JSON.stringify(queueCalls(f))),[{name:'my_available_assignments',args:{p_role:'it'}}]);
  const response=f.responses(frame)[0];assert.equal(response.items.length,2);assert.equal(response.items[0].audience,'mine');assert.equal(response.items[1].audience,'department');assert.equal(response.items[0].equipment.length,0);
  assert.ok(f.calls.every(call=>['cos_verified_fleet_capabilities_v1','my_available_assignments'].includes(call.name)));
  assert.doesNotMatch(JSON.stringify(response),/assignee_user|job_lead|access_token/);
});
test('foreign origin, sibling frame and invalid request IDs never trigger an assignment read',async()=>{
  const f=await fixture();await f.read('valid',{},'https://synthetic.example');await f.read('valid',f.frame().contentWindow,'https://other.example');
  for(const requestId of ['',{},'a'.repeat(101),'bad_underscore'])await f.read(requestId);
  assert.equal(queueCalls(f).length,0);
});
test('active role, matching profile, no preview and fresh matching session are all required before the queue read',async()=>{
  for(const change of [f=>f.state.role='owner',f=>f.state.effective='service',f=>f.state.profile.active=false,f=>f.state.profile.archived_at='2026-01-01',f=>f.state.profile.user_id=other,f=>f.body.classes.add('owner-test-role-preview'),f=>f.app.classes.add('hidden'),f=>f.state.fresh=()=>({data:{session:{user:{id:other}}}}),f=>f.state.fresh=()=>({error:{message:'private'},data:{session:{user:{id:subject}}}})]){
    const f=await fixture(),frame=f.frame();change(f);await f.read('blocked',frame.contentWindow);assert.equal(queueCalls(f).length,0);assert.equal(f.responses(frame).some(response=>response.items),false);
  }
});
test('concurrent queue reads share only their pending read and never cache settled assignments',async()=>{
  const f=await fixture(),gate=deferred(),frame=f.frame();f.state.rpc=name=>name==='my_available_assignments'?gate.promise:{data:{fleetRead:true}};
  const one=f.read('one'),two=f.read('two');await tick();assert.equal(queueCalls(f).length,1);gate.resolve({data:f.state.rows});await one;await two;
  assert.equal(f.responses(frame).length,2);f.state.rpc=name=>name==='my_available_assignments'?{data:[]}:{data:{fleetRead:true}};await f.read('three');assert.equal(queueCalls(f).length,2);assert.equal(f.responses(frame).at(-1).items.length,0);
});
test('wrong role/assignee/malformed RPC rows fail independently of the original Ticket Lead reference read',async()=>{
  for(const patch of [{assigned_role:'service'},{assignee_user_id:other},{status:'completed'},{id:'bad'},{ticket_no:'x'.repeat(129)}]){
    const f=await fixture(),frame=f.frame();f.state.rows=[row(patch)];await f.read();assert.equal(f.responses(frame)[0].error,'unavailable');assert.ok(f.frame());
    await f.emit({type:'COS_IT_MHELP_REQUEST',requestId:'references'});assert.equal(frame.contentWindow.messages.at(-1).message.items.length,0);
  }
});
test('late responses after role loss, signout, account switch or Close cannot restore the old queue',async()=>{
  for(const stop of ['role','signout','account','close']){
    const f=await fixture(),frame=f.frame(),gate=deferred();f.state.rpc=name=>name==='my_available_assignments'?gate.promise:{data:{fleetRead:true}};
    const read=f.read();await tick();
    if(stop==='role'){f.state.role='service';await f.refresh();}
    if(stop==='signout'){f.state.id=null;f.state.auth('SIGNED_OUT');await tick();}
    if(stop==='account'){f.state.id=other;f.state.profile.user_id=other;f.state.auth('SIGNED_IN');await tick();}
    if(stop==='close')f.close();
    gate.resolve({data:[row()]});await read;assert.equal(f.responses(frame).length,0);
  }
});
test('a closed frame does not lend its old pending read or denial to its replacement',async()=>{
  const f=await fixture(),oldFrame=f.frame(),gate=deferred();let first=true;
  f.state.rpc=name=>name==='my_available_assignments'?(first?(first=false,gate.promise):{data:[]}):{data:{fleetRead:true}};
  const old=f.read('old');await tick();f.close();f.open();const replacement=f.frame();await f.read('new');assert.equal(f.responses(replacement)[0].items.length,0);
  gate.resolve({error:{message:'private denial'}});await old;assert.equal(f.responses(oldFrame).length,0);assert.equal(f.frame(),replacement);assert.equal(queueCalls(f).length,2);
});
test('fresh-session and capability rechecks prevent response exposure after the RPC',async()=>{
  for(const loss of ['session','capability']){
    const f=await fixture(),frame=f.frame();f.state.rpc=name=>{
      if(name==='my_available_assignments'){if(loss==='session')f.state.fresh=()=>({data:{session:{user:{id:other}}}});else f.state.capability=false;return {data:[row()]};}
      return {data:{fleetRead:f.state.capability}};
    };
    await f.read();assert.equal(f.responses(frame)[0].error,'forbidden');assert.equal(f.frame(),undefined);
  }
});
test('host timeout bounds fresh-session/RPC/capability waits and never replays a write',async()=>{
  const f=await fixture(),frame=f.frame(),gate=deferred();f.state.rpc=name=>name==='my_available_assignments'?gate.promise:{data:{fleetRead:true}};
  const read=f.read();await tick();const timeout=[...f.timers.values()].find(entry=>entry.delay===12000);assert.ok(timeout);timeout.fn();await read;
  assert.equal(f.responses(frame)[0].error,'timeout');assert.equal(queueCalls(f).length,1);gate.resolve({data:[row()]});await tick();assert.equal(f.responses(frame).length,1);
  assert.ok(f.calls.every(call=>['cos_verified_fleet_capabilities_v1','my_available_assignments'].includes(call.name)));
});

test('newer workspace navigation abandons its predecessor read instead of lending it to the next view',async()=>{
  const f=await fixture(),frame=f.frame(),gate=deferred();let first=true;
  await f.emit({type:'COS_OPERATIONS_WORKSPACE_ACTIVE',workspace:'MHelp'});
  f.state.rpc=name=>name==='my_available_assignments'?(first?(first=false,gate.promise):{data:[]}):{data:{fleetRead:true}};
  const old=f.read('old');await tick();await f.emit({type:'COS_OPERATIONS_WORKSPACE_ACTIVE',workspace:'IT Dashboard'});
  await f.read('new');assert.equal(queueCalls(f).length,2);assert.equal(f.responses(frame)[0].requestId,'new');assert.equal(f.responses(frame)[0].items.length,0);
  gate.resolve({data:[row()]});await old;assert.equal(f.responses(frame).length,1);
});

test('an expired fresh-session read cannot start the assignment RPC after the deadline',async()=>{
  const f=await fixture(),frame=f.frame(),gate=deferred();f.state.fresh=()=>gate.promise;
  const read=f.read();await tick();[...f.timers.values()].find(entry=>entry.delay===12000).fn();await read;
  assert.equal(f.responses(frame)[0].error,'timeout');assert.equal(queueCalls(f).length,0);
  gate.resolve({data:{session:{user:{id:subject},access_token:'synthetic-only'}}});await tick();assert.equal(queueCalls(f).length,0);assert.equal(f.responses(frame).length,1);
});

 test('settled assignment views close on exact profile drift or Owner role preview',async()=>{
  for(const change of [f=>f.state.profile.user_id=other,f=>f.body.classes.add('owner-test-role-preview')]){
    const f=await fixture(),frame=f.frame();await f.read();assert.equal(f.responses(frame)[0].items.length,1);const calls=queueCalls(f).length;
    change(f);await f.refresh();assert.equal(f.frame(),undefined);assert.equal(frame.isConnected,false);assert.equal(queueCalls(f).length,calls);
  }
 });


test('pending assignment reads close their own frame on profile drift without waiting for a DOM observer',async()=>{
  for(const change of [f=>f.state.profile.user_id=other,f=>f.state.profile.active=false,f=>f.state.profile.archived_at='2026-10-10',f=>f.state.role='service']){
    for(const failed of [false,true]){
      const f=await fixture(),frame=f.frame(),gate=deferred();
      f.state.rpc=name=>name==='my_available_assignments'?gate.promise:{data:{fleetRead:true}};
      const read=f.read();await tick();change(f);
      gate.resolve(failed?{error:{message:'synthetic denied'}}:{data:[row()]});await read;
      assert.equal(f.frame(),undefined);assert.equal(frame.isConnected,false);assert.equal(f.responses(frame).length,0);
    }
  }
});


test('rejected pending RPCs close only their captured revoked frame, never a replacement',async()=>{
  for(const replace of [false,true]){
    const f=await fixture(),oldFrame=f.frame();let reject;
    const gate=new Promise((_,fail)=>{reject=fail;});
    f.state.rpc=name=>name==='my_available_assignments'?gate:{data:{fleetRead:true}};
    const read=f.read();await tick();
    let replacement;
    if(replace){f.close();f.open();replacement=f.frame();}
    else f.state.profile.user_id=other;
    reject(new Error('synthetic RPC failure'));await read;
    assert.equal(f.responses(oldFrame).length,0);
    assert.equal(f.frame(),replace?replacement:undefined);
  }
});

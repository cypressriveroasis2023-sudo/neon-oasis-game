import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../../it-ticket-instructions-host.js', import.meta.url), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
const tick = () => new Promise(done => setImmediate(done));
const row = (extra = {}) => ({id:'fixture-assignment',ticket_no:'1001',assigned_role:'it',assignee_user_id:'fixture-it',assignment_scope:'person',status:'assigned',job_description:'Install fixture equipment\nAt the north gate.',notes:'Delivery: <img src=x onerror=alert(1)>\nKeep this original line.',...extra});
function harness() {
  const nodes = [], observers = [], events = {}, reads = [];
  class Node {
    constructor(tag = 'div') { this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.text='';this.value='';this.style={display:''};this.classes=new Set();this.events={};this.classList={contains:value=>this.classes.has(value)};nodes.push(this); }
    get isConnected() { return this === body || Boolean(this.parentElement?.isConnected); }
    get textContent() { return this.text + this.children.map(node=>node.textContent).join(''); }
    set textContent(value) { this.text=String(value);this.replaceChildren(); }
    setAttribute(name, value) { this[name]=value; }
    getClientRects() { return !this.isConnected || this.hidden || this.classes.has('hidden') || this.style.display==='none' || (this.parentElement&&!this.parentElement.getClientRects().length) ? [] : [1]; }
    append(...children) { for(const child of children){child.remove();child.parentElement=this;this.children.push(child);} }
    after(child) { const parent=this.parentElement;child.remove();child.parentElement=parent;parent.children.splice(parent.children.indexOf(this)+1,0,child); }
    replaceChildren(...children) { for(const child of this.children)child.parentElement=null;this.children=[];this.append(...children); }
    remove() { if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null; }
    addEventListener(name, handler) { this.events[name]=handler; }
    click() { this.events.click?.({target:this}); }
    closest(selector) { if(selector==='.card')return this.classes.has('card')?this:this.parentElement?.closest(selector);return null; }
    querySelectorAll(selector) { if(selector.startsWith(':scope > ')){let found=[this];for(const part of selector.slice(9).split(' > '))found=found.flatMap(node=>node.children.filter(child=>child.classes.has(part.slice(1))));return found;}return []; }
    querySelector(selector) { const match=node=>selector[0]==='#'?node.id===selector.slice(1):node.classes.has(selector.slice(1));const all=node=>node.children.flatMap(child=>[child,...all(child)]);return all(this).find(match)||null; }
  }
  const body = new Node('body');
  const make = (id, parent=body, cls) => {const node=new Node();node.id=id;if(cls)node.classes.add(cls);parent.append(node);return node;};
  const app=make('appView'),view=make('view-it',app),lookup=make('lookup',view),search=make('wlITJobSearch',lookup),msg=make('wlITJobSearchMsg',lookup),found=make('found',msg,'wl-it-ticket-found'),number=make('',found,'wl-it-ticket-number'),type=make('',found,'wl-it-job-type');
  search.value='1001';number.textContent='#1001';type.textContent='DELIVERY';
  const card=make('setup',view,'card'),head=make('wlCreateHead',card),ticket=make('itTicket',card),nav=make('wlCreateNav',card);card.style.display='none';ticket.value='1001';
  const wizard=make('wlItWizardOnly',view),wizardHead=make('',wizard,'wl-head'),wizardLabel=make('',wizardHead,'small');wizard.style.display='none';wizardLabel.textContent='MHelpDesk Ticket #1001';
  const state={role:'it',effective:'it',id:'fixture-it',profile:{user_id:'fixture-it',active:true},rows:[row()],get:()=>({data:state.rows})};
  state.fresh=()=>({data:{session:{user:{id:state.id}}}});
  const window={TechCheckContext:{getRole:()=>state.role,getEffectiveRole:()=>state.effective,getProfile:()=>state.profile,getSession:()=>({user:{id:state.id}}),db:{auth:{onAuthStateChange:fn=>{state.auth=fn;},getSession:()=>Promise.resolve(state.fresh())},from:table=>{
    const read={table,filters:[]};reads.push(read);const query={select:columns=>{read.columns=columns;return query;},eq:(...args)=>{read.filters.push(['eq',...args]);return query;},in:(...args)=>{read.filters.push(['in',...args]);return query;},order:(...args)=>{read.order=args;return query;},limit:n=>{read.limit=n;return query;},abortSignal:signal=>{read.signal=signal;return query;},then:(yes,no)=>Promise.resolve(state.get(read)).then(yes,no)};return query;
  }}},addEventListener:(name,fn)=>{events[name]=fn;}};
  const document={body,createElement:tag=>new Node(tag),getElementById:id=>nodes.find(node=>node.id===id&&node.isConnected)||null,querySelector:selector=>selector==='#wlITJobSearchMsg .wl-it-ticket-found'?msg.querySelector('.wl-it-ticket-found'):null,addEventListener:(name,fn)=>{events['document:'+name]=fn;}};
  class MutationObserver{constructor(fn){observers.push(fn);}observe(){}}
  vm.runInNewContext(source,{window,document,MutationObserver,AbortController,setTimeout,clearTimeout,queueMicrotask});
  const update=()=>observers.forEach(fn=>fn());
  const settle=async()=>{await tick();update();await tick();};
  const panel=()=>document.getElementById('cosITTicketInstructions');
  const button=label=>nodes.find(node=>node.isConnected&&node.tagName==='BUTTON'&&node.textContent===label);
  const changeTicket=value=>{search.value=value;number.textContent='#'+value;ticket.value=value;events['document:input']({target:search});update();};
  return {make,wizard,wizardHead,wizardLabel,state,reads,body,app,view,lookup,search,found,number,type,card,ticket,head,nav,events,update,settle,panel,button,changeTicket,close:()=>events.pagehide()};
}
test('original notes are rendered literally beside actual lookup using only a narrow assignment read',async()=>{
  const h=harness();await h.settle();assert.match(h.panel().textContent,/Delivery: <img src=x onerror=alert\(1\)>\nKeep this original line\./);assert.match(h.panel().textContent,/Install fixture equipment\nAt the north gate\./);
  assert.equal(h.reads.length,1);assert.equal(h.reads[0].table,'job_assignments');assert.equal(h.reads[0].columns,'id,ticket_no,assigned_role,assignee_user_id,assignment_scope,status,job_description,notes');assert.equal(h.reads[0].limit,10);assert.deepEqual(JSON.parse(JSON.stringify(h.reads[0].filters)),[['eq','ticket_no','1001'],['eq','assigned_role','it'],['in','status',['assigned','started']]]);assert.doesNotMatch(source,/innerHTML|insertAdjacentHTML|\.rpc\(|\.update\(|\.insert\(|localStorage|sessionStorage/);h.close();
});
test('empty-manifest equipment selection has instructions without changing ticket or workflow controls',async()=>{
  const h=harness();await h.settle();h.lookup.style.display='none';h.card.style.display='block';h.update();await h.settle();assert.equal(h.panel().parentElement,h.card);assert.match(h.panel().textContent,/north gate/);assert.equal(h.ticket.value,'1001');assert.equal(h.nav.children.length,0);
  h.card.style.display='none';h.update();assert.equal(h.panel(),null);h.close();
});
test('only the exact current assignee or unclaimed department assignment can supply notes',async()=>{
  for(const extra of [{assignee_user_id:'someone-else'},{assigned_role:'service'},{ticket_no:'9999'},{status:'completed'},{assignee_user_id:null,assignment_scope:'person'}]){
    const h=harness();h.state.rows=[row({...extra,notes:'do not show'})];await h.settle();assert.doesNotMatch(h.panel().textContent,/do not show/);assert.match(h.panel().textContent,/No active IT assignment/);h.close();
  }
  const h=harness();h.state.rows=[row({assignee_user_id:null,assignment_scope:'department',notes:'Shared queue instructions'})];await h.settle();assert.match(h.panel().textContent,/Shared queue instructions/);h.close();
});
test('missing notes, failed reads and malformed instruction fields have honest display states',async()=>{
  for(const [data,message] of [[{data:[row({job_description:null,notes:''})]},/No work or delivery instructions/],[{error:{message:'synthetic'}},/could not be verified/],[{data:[row({notes:{bad:'payload'}})]},/could not be verified/]]){
    const h=harness();h.state.get=()=>data;await h.settle();assert.match(h.panel().textContent,message);assert.equal(h.button('Refresh instructions').disabled,false);h.close();
  }
});
test('role, login, inactive account, profile mismatch, preview and hidden views clear notes',async()=>{
  for(const change of [h=>h.state.role='owner',h=>h.state.effective='service',h=>h.state.profile.active=false,h=>h.state.profile.archived_at='2026-01-01',h=>h.state.profile.user_id='other',h=>h.body.classes.add('owner-test-role-preview'),h=>h.app.style.display='none',h=>h.view.style.display='none',h=>h.state.auth('SIGNED_OUT',null)]){
    const h=harness();await h.settle();change(h);h.update();await tick();assert.equal(h.panel(),null);h.close();
  }
});
test('fresh-session mismatch or error prevents assignment reads and does not loop',async()=>{
  for(const fresh of [{data:{session:{user:{id:'different'}}}},{error:{message:'synthetic'},data:{session:{user:{id:'fixture-it'}}}}]){
    const h=harness();h.state.fresh=()=>fresh;await h.settle();h.button('Refresh instructions').click();await h.settle();const count=h.reads.length;h.update();await tick();assert.equal(h.reads.length,count);assert.equal(h.panel(),null);h.close();
  }
});
test('newer ticket wins; late responses after changed input, close or navigation cannot restore notes',async()=>{
  for(const stop of ['ticket','close','navigation','logout']){
    const h=harness(),pending=deferred();h.state.get=()=>pending.promise;await tick();assert.match(h.panel().textContent,/Loading saved/);
    if(stop==='ticket'){h.state.get=()=>({data:[row({ticket_no:'1002',notes:'NEW TICKET'})]});h.changeTicket('1002');await h.settle();assert.match(h.panel().textContent,/NEW TICKET/);}
    if(stop==='close'){h.button('Close instructions').click();assert.doesNotMatch(h.panel().textContent,/Loading saved/);}
    if(stop==='navigation'){h.view.style.display='none';h.update();}
    if(stop==='logout')h.state.auth('SIGNED_OUT',null);
    pending.resolve({data:[row({notes:'LATE OLD NOTES'})]});await h.settle();assert.doesNotMatch(h.panel()?.textContent||'',/LATE OLD NOTES/);
    if(stop==='close'){h.state.get=()=>({data:[row({notes:'REOPENED'})]});h.button('Show ticket instructions').click();await h.settle();assert.match(h.panel().textContent,/REOPENED/);}
    h.close();
  }
});
test('switching users with an old pending request and returning to lookup rechecks current assignment',async()=>{
  const h=harness(),pending=deferred();h.state.get=()=>pending.promise;await tick();h.state.id='fixture-second';h.state.profile.user_id='fixture-second';h.state.get=()=>({data:[row({assignee_user_id:'fixture-second',notes:'SECOND USER'})]});h.state.auth('SIGNED_IN',{user:{id:'fixture-second'}});await h.settle();assert.match(h.panel().textContent,/SECOND USER/);pending.resolve({data:[row({notes:'FIRST USER'})]});await h.settle();assert.doesNotMatch(h.panel().textContent,/FIRST USER/);
  h.lookup.style.display='none';h.update();assert.equal(h.panel(),null);h.lookup.style.display='';h.events.popstate();await h.settle();assert.match(h.panel().textContent,/SECOND USER/);h.close();
});

test('resumed prep instructions use only the current exact protected header and fail closed on drift',async()=>{
  const h=harness();await h.settle();h.lookup.style.display='none';h.wizard.style.display='';h.update();await h.settle();assert.equal(h.panel().parentElement,h.wizard);assert.match(h.panel().textContent,/north gate/);
  h.state.rows=[row({ticket_no:'1002',notes:'CURRENT PREP'})];h.wizardLabel.textContent='MHelpDesk Ticket #1002';h.update();await h.settle();assert.match(h.panel().textContent,/CURRENT PREP/);assert.doesNotMatch(h.panel().textContent,/Keep this original/);
  for(const label of ['MHelpDesk #1002','MHelpDesk Ticket #','MHelpDesk Ticket #1002\nother','MHelpDesk Ticket # 1002','MHelpDesk Ticket ##1002']){h.wizardLabel.textContent=label;h.update();assert.equal(h.panel(),null);}
  h.wizardLabel.textContent='MHelpDesk Ticket #1002';h.update();await h.settle();const duplicate=h.make('',h.wizardHead,'small');duplicate.textContent='MHelpDesk Ticket #1001';h.update();assert.equal(h.panel(),null);duplicate.remove();h.update();await h.settle();assert.match(h.panel().textContent,/CURRENT PREP/);
  const head=h.make('',h.wizard,'wl-head');h.update();assert.equal(h.panel(),null);head.remove();h.wizardLabel.style.display='none';h.update();assert.equal(h.panel(),null);h.close();
});
test('a replaced or ambiguous prep header cancels pending original-ticket instructions',async()=>{
  const h=harness(),pending=deferred();h.state.get=()=>pending.promise;h.lookup.style.display='none';h.wizard.style.display='';h.update();await tick();assert.match(h.panel().textContent,/Loading saved/);h.wizardLabel.remove();h.update();assert.equal(h.panel(),null);pending.resolve({data:[row({notes:'OLD PREP'})]});await h.settle();assert.equal(h.panel(),null);h.close();
});

test('a stale fresh-session lookup cannot start a data read after the view closes',async()=>{
  const h=harness();await h.settle();const pending=deferred(),reads=h.reads.length;h.state.fresh=()=>pending.promise;h.button('Refresh instructions').click();assert.doesNotMatch(h.panel().textContent,/north gate/);h.view.style.display='none';h.update();pending.resolve({data:{session:{user:{id:'fixture-it'}}}});await h.settle();assert.equal(h.reads.length,reads);assert.equal(h.panel(),null);h.close();
});

test('pagehide observer delivery cannot remount; pageshow rereads the current user and ticket',async()=>{
  const h=harness();await h.settle();const old=deferred();h.state.get=()=>old.promise;h.button('Refresh instructions').click();await tick();const reads=h.reads.length;
  h.events.pagehide();h.update();await tick();h.update();assert.equal(h.panel(),null);assert.equal(h.reads.length,reads);
  old.resolve({data:[row({notes:'OLD PAGE RESPONSE'})]});await h.settle();assert.equal(h.panel(),null);assert.equal(h.reads.length,reads);
  h.state.id='page-second-user';h.state.profile.user_id='page-second-user';h.state.auth('SIGNED_IN',{user:{id:'page-second-user'}});h.changeTicket('1002');await h.settle();assert.equal(h.panel(),null);assert.equal(h.reads.length,reads);
  const fresh=deferred();h.state.fresh=()=>fresh.promise;h.state.get=()=>({data:[row({ticket_no:'1002',assignee_user_id:'page-second-user',notes:'NEW PAGE VERIFIED'})]});h.events.pageshow();h.update();assert.match(h.panel().textContent,/Loading saved/);assert.doesNotMatch(h.panel().textContent,/OLD PAGE RESPONSE/);assert.equal(h.reads.length,reads);
  fresh.resolve({data:{session:{user:{id:'page-second-user'}}}});await h.settle();assert.equal(h.reads.length,reads+1);assert.match(h.panel().textContent,/NEW PAGE VERIFIED/);h.close();h.update();assert.equal(h.panel(),null);
});

import vm from 'node:vm';
import {readFileSync} from 'node:fs';
export const source = readFileSync(new URL('../../../it-ticket-instructions-host.js', import.meta.url), 'utf8');
export const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
export const tick = () => new Promise(done => setImmediate(done));
export const row = (extra = {}) => ({id:'fixture-assignment',ticket_no:'1001',assigned_role:'it',assignee_user_id:'fixture-it',assignment_scope:'technician',status:'assigned',job_description:'Install fixture equipment\nAt the north gate.',notes:'Delivery: <img src=x onerror=alert(1)>\nKeep this original line.',unit_summary:'  Helios unit type\nTechnician chooses the unit.  ',...extra});
export function harness(role = 'it') {
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
  const serviceView=make('view-svc',app),serviceLookup=make('wlSvcLookup',serviceView),serviceSearch=make('wlServiceJobSearch',serviceLookup),serviceMsg=make('wlServiceJobSearchMsg',serviceLookup),serviceFound=make('',serviceMsg,'wl-service-ticket-found'),serviceNumber=make('',serviceFound,'wl-service-ticket-number'),site=make('',serviceFound,'wl-service-ticket-site');
  serviceSearch.value='1001';serviceNumber.textContent='#1001';site.textContent='Fixture site';
  const home=make('wlSvcHome',serviceView),shell=make('',home,'wl-service-simple-shell');home.style.display='none';
  view.style.display=role==='it'?'':'none';serviceView.style.display=role==='service'?'':'none';
  const actor='fixture-'+role;
  const state={role,effective:role,id:actor,profile:{user_id:actor,active:true},rows:[row({assigned_role:role,assignee_user_id:actor})],queueRows:[],rpcReads:[],actions:[],get:()=>({data:state.rows})};
  state.queue=()=>({data:state.queueRows});
  state.fresh=()=>({data:{session:{user:{id:state.id}}}});
  const window={TechCheckContext:{getRole:()=>state.role,getEffectiveRole:()=>state.effective,getProfile:()=>state.profile,getSession:()=>({user:{id:state.id}}),db:{rpc:(name,args)=>{
    if(name!=='my_available_assignments'){state.actions.push({name,args});throw Error('Unexpected action');}
    const read={name,args};state.rpcReads.push(read);const query={select:columns=>{read.columns=columns;return query;},limit:n=>{read.limit=n;return query;},abortSignal:signal=>{read.signal=signal;return query;},then:(yes,no)=>Promise.resolve(state.queue(read)).then(yes,no)};return query;
  },auth:{onAuthStateChange:fn=>{state.auth=fn;},getSession:()=>Promise.resolve(state.fresh())},from:table=>{
    const read={table,filters:[]};reads.push(read);const query={select:columns=>{read.columns=columns;return query;},eq:(...args)=>{read.filters.push(['eq',...args]);return query;},in:(...args)=>{read.filters.push(['in',...args]);return query;},order:(...args)=>{read.order=args;return query;},limit:n=>{read.limit=n;return query;},abortSignal:signal=>{read.signal=signal;return query;},then:(yes,no)=>Promise.resolve(state.get(read)).then(yes,no)};return query;
  }}},addEventListener:(name,fn)=>{events[name]=fn;}};
  const document={body,createElement:tag=>new Node(tag),getElementById:id=>nodes.find(node=>node.id===id&&node.isConnected)||null,querySelector:selector=>selector==='#wlITJobSearchMsg .wl-it-ticket-found'?msg.querySelector('.wl-it-ticket-found'):null,addEventListener:(name,fn)=>{events['document:'+name]=fn;}};
  class MutationObserver{constructor(fn){observers.push(fn);}observe(){}}
  const timeouts = new Map();
  const startTimer = (fn, delay) => { const id=setTimeout(()=>{timeouts.delete(id);fn();},delay);timeouts.set(id,fn);return id; };
  const stopTimer = id => { clearTimeout(id);timeouts.delete(id); };
  const expire = () => { for(const [id,fn] of [...timeouts]){stopTimer(id);fn();} };
  vm.runInNewContext(source,{window,document,MutationObserver,AbortController,setTimeout:startTimer,clearTimeout:stopTimer,queueMicrotask});
  const update=()=>observers.forEach(fn=>fn());
  const settle=async()=>{await tick();update();await tick();};
  const panel=()=>document.getElementById(state.role==='service'?'cosServiceTicketInstructions':'cosITTicketInstructions');
  const queuePanel=()=>document.getElementById('cosServiceAssignmentQueue');
  const button=label=>nodes.find(node=>node.isConnected&&node.tagName==='BUTTON'&&node.textContent===label);
  const changeTicket=value=>{serviceSearch.value=value;serviceNumber.textContent='#'+value;search.value=value;number.textContent='#'+value;ticket.value=value;events['document:input']({target:search});update();};
  return {expire,serviceView,serviceLookup,serviceSearch,serviceMsg,serviceFound,serviceNumber,site,home,shell,queuePanel,make,wizard,wizardHead,wizardLabel,state,reads,body,app,view,lookup,search,found,number,type,card,ticket,head,nav,events,update,settle,panel,button,changeTicket,close:()=>events.pagehide()};
}

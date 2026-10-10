import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fixture} from './helpers/service-ticket-fixture.mjs';
// Runtime dependency/markup smoke checks run the very same protected Service
// renderers as the hosted browser spec. This does not replace browser QA.
function harness(){
 const nodes=new Map();
 class Node {
  constructor(){this.style={};this.children=[];this.innerHTML='';this.textContent='';this.value='';}
  set id(value){this._id=value;nodes.set(value,this);}get id(){return this._id;}
  append(node){this.children.push(node);}prepend(node){this.children.unshift(node);}
  querySelector(selector){return selector==='.wl-service-simple-shell'&&this.innerHTML.includes("class='wl-service-simple-shell'")?{}:null;}
 }
 const make=(id,text='')=>{const node=new Node();node.id=id;node.textContent=text;return node;};
 const view=make('view-svc'),role=make('whoRole','Service Tech');make('whoName','Fixture Technician');
 const context={document:{getElementById:id=>nodes.get(id)||null,createElement:()=>new Node()},structuredClone,requestAnimationFrame:()=>{}};context.window=context;
 vm.createContext(context);vm.runInContext(fixture,context);
 return {nodes,view,role,make,run:script=>vm.runInContext(script,context)};
}
test('actual Service Home keeps manual entry and actual Service lookup produces exact markers for all four routes',async()=>{
 const h=harness();await h.run('showSvcHome()');assert.match(h.nodes.get('wlSvcHome').innerHTML,/Enter Ticket Number/);assert.match(h.nodes.get('wlSvcHome').innerHTML,/wl-service-simple-shell/);
 for(const [index,type] of ['service','delivery','swap','pickup'].entries()){
  await h.run('showServiceJobLookup()');const lookup=h.nodes.get('wlSvcLookup');assert.match(lookup.innerHTML,/id='wlServiceJobSearch'/);
  h.make('wlServiceJobSearch').value=String(1001+index);const msg=h.make('wlServiceJobSearchMsg');await h.run('serviceFindJobByTicket()');
  assert.match(msg.innerHTML,new RegExp("class='wl-service-ticket-number'>#"+(1001+index)+"</div>"));assert.match(msg.innerHTML,/class='wl-service-ticket-site'>Fixture site/);
  assert.equal((msg.innerHTML.match(/class='wl-service-ticket-found'/g)||[]).length,1);
  if(['delivery','swap'].includes(type)){assert.match(msg.innerHTML,/WAITING FOR IT HANDOFF/);assert.match(msg.innerHTML,/YOU CANNOT START YET/);assert.doesNotMatch(msg.innerHTML,/data-wl-service-take-job/);}else assert.match(msg.innerHTML,/data-wl-service-take-job/);
 }
 assert.equal(h.run('fixture.actions.length'),0);
});
test('protected Service lookup gates department versus other assignee and later receive screen removes marker contract',async()=>{
 const h=harness();h.make('wlServiceJobSearch').value='1001';const msg=h.make('wlServiceJobSearchMsg');
 await h.run("fixture.rows[0].assignee_user_id=null;fixture.rows[0].assignment_scope='department';serviceFindJobByTicket()");assert.match(msg.innerHTML,/AVAILABLE TO THE SERVICE TEAM/);
 await h.run("fixture.rows[0].assignee_user_id='other';serviceFindJobByTicket()");assert.match(msg.innerHTML,/NO SERVICE JOB FOUND/);assert.doesNotMatch(msg.innerHTML,/wl-service-ticket-found/);
 await h.run('showReceiveLookup()');assert.match(h.nodes.get('wlSvcLookup').innerHTML,/wlTicketInput/);assert.doesNotMatch(h.nodes.get('wlSvcLookup').innerHTML,/wlServiceJobSearch|wl-service-ticket-found/);assert.equal(h.run('fixture.actions.length'),0);
});

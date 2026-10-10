import test from 'node:test';
import assert from 'node:assert/strict';
import {source, deferred, tick, row, harness} from './helpers/ticket-instructions-host-harness.mjs';
test('original notes are rendered literally beside actual lookup using only a narrow assignment read',async()=>{
  const h=harness();await h.settle();assert.match(h.panel().textContent,/Delivery: <img src=x onerror=alert\(1\)>\nKeep this original line\./);assert.match(h.panel().textContent,/Recorded equipment \/ unit instructions/);assert.match(h.panel().textContent,/  Helios unit type\nTechnician chooses the unit\.  /);assert.match(h.panel().textContent,/Install fixture equipment\nAt the north gate\./);
  assert.equal(h.reads.length,1);assert.equal(h.reads[0].table,'job_assignments');assert.equal(h.reads[0].columns,'id,ticket_no,assigned_role,assignee_user_id,assignment_scope,status,job_description,notes,unit_summary');assert.equal(h.reads[0].limit,10);assert.deepEqual(JSON.parse(JSON.stringify(h.reads[0].filters)),[['eq','ticket_no','1001'],['eq','assigned_role','it'],['in','status',['assigned','started']]]);assert.doesNotMatch(source,/innerHTML|insertAdjacentHTML|\.update\(|\.insert\(|localStorage|sessionStorage/);h.close();
});
test('empty-manifest equipment selection has instructions without changing ticket or workflow controls',async()=>{
  const h=harness();await h.settle();h.lookup.style.display='none';h.card.style.display='block';h.update();await h.settle();assert.equal(h.panel().parentElement,h.card);assert.match(h.panel().textContent,/north gate/);assert.equal(h.ticket.value,'1001');assert.equal(h.nav.children.length,0);
  h.card.style.display='none';h.update();assert.equal(h.panel(),null);h.close();
});
test('only the exact current assignee or unclaimed department assignment can supply notes',async()=>{
  for(const extra of [{assignee_user_id:'someone-else'},{assigned_role:'service'},{ticket_no:'9999'},{status:'completed'},{assignee_user_id:null,assignment_scope:'person'},{assignee_user_id:'',assignment_scope:'department'},{assignee_user_id:null,assignment_scope:'department',status:'started'}]){
    const h=harness();h.state.rows=[row({...extra,notes:'do not show'})];await h.settle();assert.doesNotMatch(h.panel().textContent,/do not show/);assert.match(h.panel().textContent,/No active IT assignment/);h.close();
  }
  const h=harness();h.state.rows=[row({assignee_user_id:null,assignment_scope:'department',notes:'Shared queue instructions'})];await h.settle();assert.match(h.panel().textContent,/Shared queue instructions/);h.close();
});
test('missing notes, failed reads and malformed instruction fields have honest display states',async()=>{
  for(const [data,message] of [[{data:[row({job_description:null,notes:'',unit_summary:null})]},/No work, delivery or unit instructions/],[{error:{message:'synthetic'}},/could not be verified/],[{data:[row({notes:{bad:'payload'}})]},/could not be verified/]]){
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


test('IT lookup, setup and resumed prep use the same 128-character ticket bound',async()=>{
 for(const mode of ['lookup','setup','prep'])for(const length of [81,128,129]){
  const ticket='T'.repeat(length),h=harness();h.state.rows=[row({ticket_no:ticket})];h.changeTicket(ticket);
  if(mode==='setup'){h.lookup.style.display='none';h.card.style.display='';}
  if(mode==='prep'){h.lookup.style.display='none';h.wizard.style.display='';h.wizardLabel.textContent='MHelpDesk Ticket #'+ticket;}
  h.update();await h.settle();
  if(length<=128){assert.match(h.panel().textContent,/north gate/);assert.ok(h.panel().textContent.includes('MHelpDesk #'+ticket));}else assert.equal(h.panel(),null);
  h.close();
 }
});

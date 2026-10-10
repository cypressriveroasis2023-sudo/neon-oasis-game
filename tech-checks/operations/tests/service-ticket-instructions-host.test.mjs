import test from 'node:test';
import assert from 'node:assert/strict';
import {source, deferred, tick, row, harness} from './helpers/ticket-instructions-host-harness.mjs';
const serviceRow = (extra={}) => row({assigned_role:'service',assignee_user_id:'fixture-service',scheduled_for:'2026-10-10',scheduled_time:'09:30:00',...extra});
async function home(h) { h.serviceLookup.style.display='none';h.home.style.display='';h.update();await h.settle(); }

test('Service lookup shows only original work, notes and unit type for every route, including empty manifests',async()=>{
  for(const work_type of ['service','delivery','swap','pickup']){
    const h=harness('service');h.state.rows=[serviceRow({work_type,equipment_manifest:[],unit_summary:'  Helios unit type\n<script>doNotExecute()</script>  '})];await h.settle();
    assert.match(h.panel().textContent,/north gate/);assert.match(h.panel().textContent,/Delivery: <img src=x onerror=alert\(1\)>\nKeep this original line/);assert.match(h.panel().textContent,/Recorded equipment \/ unit instructions  Helios unit type\n<script>doNotExecute\(\)<\/script>  /);
    assert.doesNotMatch(h.panel().textContent,/No equipment|START JOB/);assert.equal(h.reads[0].columns,'id,ticket_no,assigned_role,assignee_user_id,assignment_scope,status,job_description,notes,unit_summary');
    assert.deepEqual(JSON.parse(JSON.stringify(h.reads[0].filters)),[['eq','ticket_no','1001'],['eq','assigned_role','service'],['in','status',['assigned','started']]]);assert.deepEqual(h.state.actions,[]);assert.deepEqual(h.state.rpcReads,[]);h.close();
  }
});
test('Service fails closed on missing, duplicate, hidden or mismatched exact lookup markers',async()=>{
  for(const change of [h=>h.site.remove(),h=>h.site.style.display='none',h=>h.make('',h.serviceFound,'wl-service-ticket-site'),h=>h.make('',h.serviceFound,'wl-service-ticket-number'),h=>h.make('',h.serviceMsg,'wl-service-ticket-found'),h=>h.serviceNumber.textContent='Ticket #1001',h=>h.serviceNumber.textContent='#1001\nother',h=>h.serviceNumber.textContent='# 1001',h=>h.serviceSearch.value='1002',h=>h.serviceSearch.style.display='none',h=>h.serviceFound.style.display='none',h=>h.serviceMsg.style.display='none']){
    const h=harness('service');await h.settle();change(h);h.update();assert.equal(h.panel(),null);h.close();
  }
});
test('Service instructions require current assignee or null unclaimed assigned department work',async()=>{
  for(const extra of [{assigned_role:'it'},{assignee_user_id:'other'},{assignee_user_id:null,assignment_scope:'person'},{assignee_user_id:'',assignment_scope:'department'},{assignee_user_id:null,assignment_scope:'department',status:'started'},{status:'completed'},{ticket_no:'1002'}]){
    const h=harness('service');h.state.rows=[serviceRow({...extra,notes:'PRIVATE OTHER NOTES'})];await h.settle();assert.match(h.panel().textContent,/No active Service assignment/);assert.doesNotMatch(h.panel().textContent,/PRIVATE OTHER NOTES/);h.close();
  }
  for(const extra of [{assignee_user_id:null,assignment_scope:'department'},{status:'started'}]){
    const h=harness('service');h.state.rows=[serviceRow(extra)];await h.settle();assert.match(h.panel().textContent,/north gate/);h.close();
  }
});
test('Service has distinct empty, failure and invalid unit-summary states',async()=>{
  for(const [result,pattern] of [[{data:[serviceRow({job_description:null,notes:null,unit_summary:null})]},/No work, delivery or unit instructions/],[{error:{message:'synthetic'}},/could not be verified/],[{data:[serviceRow({unit_summary:{value:'untrusted'}})]},/could not be verified/]]){
    const h=harness('service');h.state.get=()=>result;await h.settle();assert.match(h.panel().textContent,pattern);h.close();
  }
});
test('late Service instructions are discarded after Close, role switch, newer ticket, hidden lookup and history',async()=>{
  for(const stop of ['close','owner','newer','hidden','history','pagehide']){
    const h=harness('service'),pending=deferred();h.state.get=()=>pending.promise;await tick();assert.match(h.panel().textContent,/Loading saved/);
    if(stop==='close')h.button('Close instructions').click();
    if(stop==='owner'){h.state.role='owner';h.state.effective='service';h.update();}
    if(stop==='newer'){h.state.rows=[serviceRow({ticket_no:'1002',notes:'NEWER'})];h.state.get=()=>({data:h.state.rows});h.changeTicket('1002');await h.settle();assert.match(h.panel().textContent,/NEWER/);}
    if(stop==='hidden')h.serviceLookup.style.display='none';
    if(stop==='history'){h.site.remove();h.events.popstate();}
    if(stop==='pagehide'){h.events.pagehide();h.update();}
    h.update();pending.resolve({data:[serviceRow({notes:'LATE NOTES'})]});await h.settle();assert.doesNotMatch(h.panel()?.textContent||'',/LATE NOTES/);
    if(stop==='close'){h.state.get=()=>({data:[serviceRow({notes:'VERIFIED AGAIN'})]});h.button('Show ticket instructions').click();await h.settle();assert.match(h.panel().textContent,/VERIFIED AGAIN/);}
    h.close();
  }
});
test('Service Home queue reads bounded metadata only and leaves manual ticket verification untouched',async()=>{
  const h=harness('service');h.state.queueRows=[serviceRow(),serviceRow({id:'department',ticket_no:'1002',assignee_user_id:null,assignment_scope:'department',scheduled_for:null,scheduled_time:null})];await home(h);
  assert.match(h.queuePanel().textContent,/Your Service assignments and department queue/);assert.match(h.queuePanel().textContent,/MHelpDesk #1001Assigned to youStatus: AssignedScheduled date: 2026-10-10 · 09:30:00 \(recorded local time\)/);assert.match(h.queuePanel().textContent,/MHelpDesk #1002Department queueStatus: AssignedSchedule not recorded/);
  assert.doesNotMatch(h.queuePanel().textContent,/north gate|<img|Helios|START|CLAIM|No equipment/);assert.equal(h.serviceSearch.value,'1001');assert.equal(h.panel(),null);
  const [read]=h.state.rpcReads;assert.equal(read.name,'my_available_assignments');assert.deepEqual(JSON.parse(JSON.stringify(read.args)),{p_role:'service'});assert.equal(read.columns,'id,ticket_no,assigned_role,assignee_user_id,assignment_scope,status,scheduled_for,scheduled_time');assert.equal(read.limit,51);assert.deepEqual(h.state.actions,[]);h.close();
});
test('Service queue rejects malformed, out-of-scope and duplicate rows without showing a false empty queue',async()=>{
  const invalids=[null,{},...[
    {assigned_role:'it'},{assignee_user_id:'other'},{assignee_user_id:undefined,assignment_scope:'department'},
    {assignee_user_id:null,assignment_scope:'department',status:'started'},{assignee_user_id:'',assignment_scope:'department'},
    {assignee_user_id:null,assignment_scope:'person'},{assignment_scope:'person'},{assignment_scope:'unknown'},{status:'completed'},{id:null},{id:' '},
    {ticket_no:' bad'},{ticket_no:'bad\nline'},{ticket_no:'X'.repeat(129)},
  ].map((extra,i)=>serviceRow({id:'invalid-'+i,ticket_no:'DO-NOT-SHOW-'+i,...extra}))];
  for(const invalid of invalids)for(const mixed of [false,true]){
    const h=harness('service');h.state.queueRows=mixed?[serviceRow(),invalid]:[invalid];await home(h);
    assert.match(h.queuePanel().textContent,/could not be verified/);assert.doesNotMatch(h.queuePanel().textContent,/No active assignments|MHelpDesk #|DO-NOT-SHOW|bad/);h.close();
  }
  const h=harness('service');h.state.queueRows=[serviceRow(),serviceRow({ticket_no:'DUPLICATE-PRIVATE'})];await home(h);
  assert.match(h.queuePanel().textContent,/could not be verified/);assert.doesNotMatch(h.queuePanel().textContent,/No active assignments|MHelpDesk #|DUPLICATE-PRIVATE/);h.close();
});
test('Service queue caps at 50, renders hostile ticket text literally and does not infer missing schedules',async()=>{
  const h=harness('service');h.state.queueRows=Array.from({length:51},(_,i)=>serviceRow({id:String(i),ticket_no:'TICKET-'+i}));h.state.queueRows[0].ticket_no='<img src=x>';h.state.queueRows[0].scheduled_for='2026-02-30';h.state.queueRows[1].scheduled_time='24:61';await home(h);
  assert.match(h.queuePanel().textContent,/MHelpDesk #<img src=x>/);assert.match(h.queuePanel().textContent,/Schedule unavailable/);assert.match(h.queuePanel().textContent,/Showing up to 50/);assert.doesNotMatch(h.queuePanel().textContent,/TICKET-50/);h.close();
});
test('Service queue distinguishes pending, empty, failure and malformed replies',async()=>{
  const h=harness('service'),pending=deferred();h.state.queue=()=>pending.promise;await home(h);assert.match(h.queuePanel().textContent,/Loading Service assignments/);pending.resolve({data:[]});await h.settle();assert.match(h.queuePanel().textContent,/No active assignments are available/);
  for(const result of [{error:{message:'synthetic'}},{data:{}},null]){h.state.queue=()=>result;h.button('Refresh assignments').click();await h.settle();assert.match(h.queuePanel().textContent,/could not be verified/);assert.doesNotMatch(h.queuePanel().textContent,/No active assignments/);assert.equal(h.button('Refresh assignments').disabled,false);}
  h.close();
});
test('Service queue and instructions deny Owner preview, profile drift, inactivity, archive and hidden views',async()=>{
  for(const change of [h=>h.state.role='owner',h=>h.state.effective='it',h=>h.state.profile.active=false,h=>h.state.profile.archived_at='2026-01-01',h=>h.state.profile.user_id='other',h=>h.body.classes.add('owner-test-role-preview'),h=>h.app.style.display='none',h=>h.serviceView.style.display='none',h=>h.state.auth('SIGNED_OUT',null)]){
    const h=harness('service');await h.settle();change(h);h.update();assert.equal(h.panel(),null);h.serviceLookup.style.display='none';h.home.style.display='';h.update();await h.settle();assert.equal(h.queuePanel(),null);assert.equal(h.state.rpcReads.length,0);h.close();
  }
});
test('queue late responses cannot restore hidden, replaced or logged-out Service home',async()=>{
  for(const stop of ['lookup','replacement','logout','pagehide']){
    const h=harness('service'),pending=deferred();h.state.queue=()=>pending.promise;await home(h);assert.match(h.queuePanel().textContent,/Loading Service assignments/);
    if(stop==='lookup'){h.home.style.display='none';h.serviceLookup.style.display='';h.update();}
    if(stop==='replacement'){h.shell.remove();h.make('',h.home,'wl-service-simple-shell');h.state.queue=()=>({data:[serviceRow({ticket_no:'NEW-HOME'})]});h.update();await h.settle();assert.match(h.queuePanel().textContent,/NEW-HOME/);}
    if(stop==='logout')h.state.auth('SIGNED_OUT',null);
    if(stop==='pagehide'){h.events.pagehide();h.update();}
    pending.resolve({data:[serviceRow({ticket_no:'OLD-HOME'})]});await h.settle();assert.doesNotMatch(h.queuePanel()?.textContent||'',/OLD-HOME/);h.close();
  }
});
test('queue auth renewal is verified before reads and changed login rereads without old assignments',async()=>{
  const h=harness('service');await home(h);const pending=deferred(),count=h.state.rpcReads.length;h.state.fresh=()=>pending.promise;h.button('Refresh assignments').click();h.home.style.display='none';h.update();pending.resolve({data:{session:{user:{id:'fixture-service'}}}});await h.settle();assert.equal(h.state.rpcReads.length,count);assert.equal(h.queuePanel(),null);
  h.state.fresh=()=>({data:{session:{user:{id:'other-service'}}}});h.state.id='other-service';h.state.profile.user_id='other-service';h.state.queue=()=>({data:[serviceRow({ticket_no:'OTHER-OWN',assignee_user_id:'other-service'})]});h.state.auth('SIGNED_IN',{user:{id:'other-service'}});await home(h);assert.match(h.queuePanel().textContent,/OTHER-OWN/);assert.doesNotMatch(h.queuePanel().textContent,/MHelpDesk #1001/);h.close();
});
test('queue session errors fail closed without retry loops or action RPCs',async()=>{
  for(const fresh of [{error:{message:'synthetic'}},{data:{session:{user:{id:'other'}}}}]){
    const h=harness('service');await h.settle();h.state.fresh=()=>fresh;await home(h);const count=h.state.rpcReads.length;assert.equal(h.queuePanel(),null);h.update();await h.settle();assert.equal(h.state.rpcReads.length,count);assert.equal(count,0);h.close();
  }
  assert.deepEqual([...source.matchAll(/\.rpc\('([^']+)'/g)].map(match=>match[1]),['my_available_assignments']);assert.doesNotMatch(source,/innerHTML|insertAdjacentHTML|\.update\(|\.insert\(|localStorage|sessionStorage|\.value\s*=/);
});

test('timed-out Service auth renewal cannot later launch an instructions or queue read',async()=>{
 for(const mode of ['instructions','queue']){
  const h=harness('service');await h.settle();if(mode==='queue')await home(h);
  const pending=deferred(),reads=h.reads.length,queues=h.state.rpcReads.length;h.state.fresh=()=>pending.promise;
  h.button(mode==='queue'?'Refresh assignments':'Refresh instructions').click();h.expire();await h.settle();
  assert.match((mode==='queue'?h.queuePanel():h.panel()).textContent,/could not be verified/);
  pending.resolve({data:{session:{user:{id:'fixture-service'}}}});await h.settle();assert.equal(h.reads.length,reads);assert.equal(h.state.rpcReads.length,queues);h.close();
 }
});


test('Service lookup and queue retain 81–128 character ticket identities and reject longer tickets',async()=>{
 for(const length of [81,128,129]){
  const ticket='T'.repeat(length),h=harness('service');h.state.rows=[serviceRow({ticket_no:ticket})];h.changeTicket(ticket);await h.settle();
  if(length<=128){assert.match(h.panel().textContent,/north gate/);assert.ok(h.panel().textContent.includes('MHelpDesk #'+ticket));}else assert.equal(h.panel(),null);
  h.state.queueRows=[serviceRow({ticket_no:ticket})];await home(h);
  if(length<=128)assert.ok(h.queuePanel().textContent.includes('MHelpDesk #'+ticket));else {assert.match(h.queuePanel().textContent,/could not be verified/);assert.doesNotMatch(h.queuePanel().textContent,/No active assignments|MHelpDesk #/);}
  h.close();
 }
});

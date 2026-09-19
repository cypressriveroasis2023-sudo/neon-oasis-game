(() => {
'use strict';
let db=null;
const state={session:null,profile:null,jobs:[],preps:[],techs:[],currentTicket:'',chats:[],chatId:'',pending:new Map(),loaded:false};
const STORE='cos-onsite-vision-chats-v1';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const now=()=>new Date().toISOString();
const dayKey=(d=new Date())=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const id=()=>String(Date.now())+Math.random().toString(36).slice(2,8);
const reEsc=s=>String(s||'').replace(/[.*+?^$()|[\]\\]/g,'\\$&');

async function techCheckDb(){
  const response=await fetch('./app.js?v=startup-fast-v32',{cache:'no-store'});
  if(!response.ok)throw new Error('Could not load the Tech Check connection.');
  const src=await response.text();
  const url=src.match(/const SUPABASE_URL = '([^']+)'/);
  const key=src.match(/const SUPABASE_KEY = '([^']+)'/);
  if(!url||!key)throw new Error('Tech Check connection settings were not found.');
  return supabase.createClient(url[1],key[1]);
}
function loadChats(){try{const x=JSON.parse(localStorage.getItem(STORE)||'[]');state.chats=Array.isArray(x)?x.slice(0,20):[];}catch{state.chats=[];}}
function saveChats(){try{localStorage.setItem(STORE,JSON.stringify(state.chats.slice(0,20)));}catch{}}
function chat(){return state.chats.find(x=>x.id===state.chatId)||null;}
function ensureChat(){
  let c=chat();if(c)return c;
  c={id:id(),title:'New conversation',createdAt:now(),updatedAt:now(),ticket:'',messages:[]};
  state.chats.unshift(c);state.chatId=c.id;saveChats();renderHistory();return c;
}
function newChat(){
  state.currentTicket='';
  const c={id:id(),title:'New conversation',createdAt:now(),updatedAt:now(),ticket:'',messages:[]};
  state.chats.unshift(c);state.chatId=c.id;saveChats();renderHistory();renderThread();renderOrder();closeDrawers();$('visionPrompt')?.focus();
}
function openChat(chatId){
  const c=state.chats.find(x=>x.id===chatId);if(!c)return;
  state.chatId=chatId;state.currentTicket=c.ticket||'';renderHistory();renderThread();renderOrder();closeDrawers();
}
function addMessage(role,text='',html=''){
  const c=ensureChat();c.messages.push({role,text:String(text),html:String(html),at:now()});
  c.updatedAt=now();c.ticket=state.currentTicket||c.ticket||'';saveChats();renderHistory();
}
function titleFrom(text){
  const c=ensureChat();if(c.title!=='New conversation')return;
  const clean=String(text||'').replace(/\s+/g,' ').trim();c.title=clean.length>42?clean.slice(0,39)+'...':clean;saveChats();
}
async function loadData(){
  if($('visionLiveStatus'))$('visionLiveStatus').textContent='SYNC';
  const [jobs,preps,techs]=await Promise.all([
    db.from('job_assignments').select('*').in('status',['assigned','started','completed']).order('assigned_at',{ascending:false}).limit(250),
    db.from('prep_tickets').select('id,ticket_no,site,status,work_type,equipment_manifest,released_by_name,released_at,closed_by_name,closed_at,prep_items(equipment_type,purpose,unit_tag)').order('created_at',{ascending:false}).limit(250),
    db.from('profiles').select('user_id,full_name,username,role,active,archived_at').eq('active',true).is('archived_at',null).in('role',['it','service']).order('full_name')
  ]);
  if(jobs.error)throw jobs.error;
  state.jobs=jobs.data||[];state.preps=preps.data||[];state.techs=techs.data||[];
  if($('visionLiveStatus'))$('visionLiveStatus').textContent='LIVE';
}
async function init(){
  db=await techCheckDb();loadChats();
  const session=(await db.auth.getSession()).data.session;
  if(!session){location.replace('./');return;}
  state.session=session;
  const profileResult=await db.from('profiles').select('*').eq('user_id',session.user.id).single();
  const p=profileResult.data;
  if(profileResult.error||!p||p.role!=='owner'||p.active===false||p.archived_at){location.replace('./');return;}
  state.profile=p;$('visionOwnerName').textContent=(p.full_name||p.username||'Owner')+' - Owner/Admin';
  await loadData();
  if(!state.chats.length)newChat();else state.chatId=state.chats[0].id;
  const q=new URLSearchParams(location.search).get('ticket');
  if(q){
    let c=state.chats.find(row=>String(row.ticket||'')===String(q));
    if(!c){
      c={id:id(),title:'MHelpDesk #'+q,createdAt:now(),updatedAt:now(),ticket:String(q),messages:[]};
      state.chats.unshift(c);
    }
    state.chatId=c.id;state.currentTicket=String(q);c.ticket=state.currentTicket;
    if(!c.messages.length)c.messages.push({role:'assistant',text:'',html:ticketAnswer(q,'I opened this service order for you. Ask who has it, what happens next, or tell me what you want changed.'),at:now()});
    saveChats();
  }else state.currentTicket=chat()?.ticket||'';
  renderHistory();renderThread();renderOrder();$('visionLoading').classList.add('hidden');$('visionApp').classList.remove('hidden');state.loaded=true;setTimeout(()=>bottom(false),30);
}
function renderHistory(){
  const h=$('visionHistory');if(!h)return;
  h.innerHTML=state.chats.length?state.chats.slice(0,14).map(c=>{
    const when=c.updatedAt?new Date(c.updatedAt):null;
    const stamp=when&&!Number.isNaN(when.getTime())?when.toLocaleDateString([], {month:'short',day:'numeric'}):'';
    return '<button type="button" class="'+(c.id===state.chatId?'active':'')+'" data-chat-id="'+esc(c.id)+'">'+esc(c.title||'Conversation')+(stamp?'<small>'+esc(stamp)+(c.ticket?' · #'+esc(c.ticket):'')+'</small>':'')+'</button>';
  }).join(''):'<div class="vision-system-note">No conversations yet.</div>';
  if($('visionConversationTitle'))$('visionConversationTitle').textContent=chat()?.title||'New conversation';
}
function welcome(){
  return '<div class="vision-welcome"><div class="vision-welcome-mark"><img src="./techcheck-eye-192.png?v=1" alt=""></div><div class="vision-kicker">ONSITE VISION</div><h1>Your Tech Check AI workspace.</h1><p>Ask about a job, assign a technician, change the schedule, or work through the next step with Vision. The service order stays in context while you keep talking.</p><div class="vision-quick-grid"><button type="button" data-vision-prompt="What jobs do I have today?">Today\'s jobs</button><button type="button" data-vision-prompt="What jobs do I have Monday?">Monday\'s jobs</button><button type="button" data-vision-prompt="What needs attention right now?">Needs attention</button><button type="button" data-vision-prompt="Show me my active jobs">Active jobs</button></div></div>';
}
function message(m){
  if(m.role==='user')return '<div class="vision-turn user"><div class="vision-bubble">'+esc(m.text)+'</div></div>';
  return '<div class="vision-turn assistant"><div class="vision-bubble"><div class="vision-assistant-head"><img src="./techcheck-eye-favicon-32.png?v=1" alt=""> ONSITE VISION</div>'+(m.html||esc(m.text))+'</div></div>';
}
function renderThread(){
  const h=$('visionThread');if(!h)return;const c=chat();
  h.innerHTML=!c||!c.messages.length?welcome():c.messages.map(message).join('');setTimeout(()=>bottom(false),0);
}
function typing(){return '<div id="visionTyping" class="vision-turn assistant"><div class="vision-bubble"><div class="vision-assistant-head"><img src="./techcheck-eye-favicon-32.png?v=1" alt=""> ONSITE VISION</div><div class="vision-typing"><span>Thinking through Tech Check</span><span class="vision-dots"><i></i><i></i><i></i></span></div></div></div>';}
function bottom(smooth=true){
  const h=$('visionThread');if(!h)return;
  requestAnimationFrame(()=>requestAnimationFrame(()=>h.scrollTo({top:h.scrollHeight,behavior:smooth?'smooth':'auto'})));
}
function prep(ticket){return state.preps.find(p=>String(p.ticket_no||'')===String(ticket))||null;}
function group(ticket){return state.jobs.filter(j=>String(j.ticket_no||'')===String(ticket));}
function active(ticket){return group(ticket).filter(j=>j.status!=='completed');}
function workType(rows,p){
  const purpose=(p?.prep_items||[]).map(x=>String(x.purpose||'').toUpperCase()).find(x=>x==='DELIVERY'||x==='SWAP');
  return String(purpose?purpose.toLowerCase():(rows[0]?.work_type||p?.work_type||'service')).toLowerCase();
}
function schedule(a){
  if(!a?.scheduled_for)return 'No date set';
  const d=new Date(a.scheduled_for+'T12:00:00');
  let s=Number.isNaN(d.getTime())?a.scheduled_for:d.toLocaleDateString([], {weekday:'short',month:'short',day:'numeric',year:'numeric'});
  if(a.scheduled_time){const x=String(a.scheduled_time).split(':').map(Number);s+=' - '+new Date(2000,0,1,x[0]||0,x[1]||0).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});}
  return s;
}
function units(p,a){
  const x=(p?.prep_items||[]).filter(i=>i.unit_tag).map(i=>String(i.equipment_type||'Unit')+' '+String(i.unit_tag));
  return x.length?x.join(', '):(String(a?.unit_summary||'').replace(/^Unit #s:\s*/i,'')||'No unit listed');
}
function assignee(a){return a?.assignee_name||a?.assigned_to_name||(a?.assignment_scope==='department'?(a.assigned_role==='service'?'Service department queue':'IT department queue'):'Unassigned');}
function next(ticket){
  const rows=active(ticket),p=prep(ticket),it=rows.find(x=>x.assigned_role==='it'),svc=rows.find(x=>x.assigned_role==='service'),type=workType(rows,p);
  if(!rows.length)return 'No active Tech Check assignment is open.';
  if(type==='pickup')return svc?'Service should complete the field pickup and return the equipment to IT Intake.':'This pickup needs a Service assignment before field work begins.';
  if(it&&p?.status!=='released'&&p?.status!=='closed')return 'IT needs to finish the Tech Check and create the Service handoff.';
  if(p?.status==='released'&&!svc)return 'The IT handoff is ready. Assign a Service Tech or the Service department queue.';
  if(svc&&svc.requires_it_handoff&&p?.status!=='released'&&p?.status!=='closed')return 'Service is assigned but must wait for IT to release the handoff.';
  if(svc&&(p?.status==='released'||!svc.requires_it_handoff))return 'Service can open the same MHelpDesk ticket, verify the assignment, and continue the field work.';
  return 'Open the active Tech Check assignment and continue the current workflow.';
}
function jobCard(ticket){
  const rows=group(ticket),open=rows.filter(x=>x.status!=='completed'),p=prep(ticket),a=open[0]||rows[0];if(!a&&!p)return '';
  const list=(open.length?open:rows.slice(0,3)).map(r=>'<div class="vision-assignment-row"><span><b>'+esc(String(r.assigned_role||'').toUpperCase())+'</b> - '+esc(assignee(r))+'</span><span>'+esc(String(r.status||'').toUpperCase())+'</span></div>').join('');
  return '<div class="vision-job-card"><div class="vision-job-head"><b>#'+esc(ticket)+' - '+esc(a?.site||p?.site||'No site')+'</b><span class="vision-pill">'+esc(workType(rows,p).toUpperCase())+'</span></div><div class="vision-job-meta"><span>'+esc(schedule(a))+'</span><span>'+esc(units(p,a))+'</span></div><div class="vision-assignment-list">'+list+'</div><div class="vision-next"><b>Next:</b> '+esc(next(ticket))+'</div></div>';
}
function ticketAnswer(ticket,intro=''){
  if(!group(ticket).length&&!prep(ticket))return '<div class="vision-answer-title">I could not find that Tech Check job.</div><div class="vision-answer-copy">I do not see MHelpDesk #'+esc(ticket)+' in the current Tech Check records.</div>';
  state.currentTicket=String(ticket);const c=ensureChat();c.ticket=state.currentTicket;saveChats();setTimeout(renderOrder,0);
  return '<div class="vision-answer-title">MHelpDesk #'+esc(ticket)+'</div>'+(intro?'<div class="vision-answer-copy">'+esc(intro)+'</div>':'')+jobCard(ticket);
}
function renderOrder(){
  const t=$('visionOrderTitle'),h=$('visionOrderBody'),app=$('visionApp');if(!t||!h)return;const ticket=state.currentTicket;
  app?.classList.toggle('has-order',Boolean(ticket));
  if(!ticket){t.textContent='No job selected';h.innerHTML='<div class="vision-empty-order"><span>◎</span><b>No service order open</b><p>Ask Vision about a ticket or unit and the live order context will appear here automatically.</p></div>';return;}
  const rows=group(ticket),open=rows.filter(x=>x.status!=='completed'),p=prep(ticket),a=open[0]||rows[0];
  if(!a&&!p){t.textContent='#'+ticket;h.innerHTML='<div class="vision-direct warn"><b>Job not found</b>This ticket is not in the loaded Tech Check records.</div>';return;}
  t.textContent='#'+ticket;
  const list=(open.length?open:rows).map(r=>'<div class="vision-context-row"><b>'+esc(String(r.assigned_role||'').toUpperCase())+' - '+esc(assignee(r))+'</b><span>'+esc(String(r.status||'').toUpperCase())+(r.requires_it_handoff?' - handoff-gated':'')+'</span></div>').join('');
  h.innerHTML='<div class="vision-context-block"><h3>'+esc(a?.site||p?.site||'No site')+'</h3><div class="vision-context-grid"><div><span>Job</span><b>'+esc(workType(rows,p).toUpperCase())+'</b></div><div><span>Schedule</span><b>'+esc(schedule(a))+'</b></div><div><span>Equipment</span><b>'+esc(units(p,a))+'</b></div><div><span>Prep</span><b>'+esc(String(p?.status||'Not linked').toUpperCase())+'</b></div></div></div><div class="vision-context-block"><h3>Assignments</h3><div class="vision-context-list">'+(list||'<div class="vision-system-note">No active assignments.</div>')+'</div></div><div class="vision-context-block"><h3>What happens next</h3><div class="vision-answer-copy">'+esc(next(ticket))+'</div><div class="vision-order-actions"><button class="primary" type="button" data-order-prompt="Who has this job?">Ask who has it</button><button type="button" data-order-prompt="Assign a Service Tech to this job">Assign Service</button><button type="button" data-order-prompt="What still needs to be done on this job?">Show remaining work</button></div></div>';
}
function ticketFrom(text){const m=String(text||'').match(/\b(?:mhelpdesk|mhelp|ticket|reference|ref)\s*(?:#|number|no\.?)?\s*[:#=-]?\s*(\d{3,})\b/i)||String(text||'').match(/#(\d{3,})\b/);return m?.[1]||'';}
function numberWords(text){const m={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};return String(text||'').replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi,x=>String(m[x.toLowerCase()]||x));}
function unitHint(text){
  const raw=numberWords(text),defs=[['Helios',/\bhelio(?:s)?\s*(?:unit\s*)?(?:#|number|no\.?)?\s*(\d{1,4})\b/i],['Ranger',/\branger\s*(?:unit\s*)?(?:#|number|no\.?)?\s*(\d{1,4})\b/i],['Solar Spotter',/\bsolar\s+spotter\s*(?:unit\s*)?(?:#|number|no\.?)?\s*(\d{1,4})\b/i],['Spotter',/\bspotter\s*(?:unit\s*)?(?:#|number|no\.?)?\s*(\d{1,4})\b/i],['Sniper',/\bsniper\s*(?:unit\s*)?(?:#|number|no\.?)?\s*(\d{1,4})\b/i]];
  for(const d of defs){const x=raw.match(d[1]);if(x)return{type:d[0],tag:String(Number(x[1]))};}return null;
}
function ticketByUnit(h){
  if(!h)return '';const want=String(Number(h.tag));
  for(const p of state.preps){if((p.prep_items||[]).some(x=>{const digits=String(x.unit_tag||'').replace(/\D/g,'');return(!h.type||String(x.equipment_type||'').toLowerCase()===h.type.toLowerCase())&&digits&&String(Number(digits))===want;}))return String(p.ticket_no||'');}
  return '';
}
function dateFrom(text){
  const s=String(text||'').toLowerCase(),base=new Date();if(/\btoday\b/.test(s))return dayKey(base);if(/\btomorrow\b/.test(s)){const d=new Date(base);d.setDate(d.getDate()+1);return dayKey(d);}
  const days={sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6},m=s.match(/\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if(m){const d=new Date(base),n=(days[m[1]]-d.getDay()+7)%7||7;d.setDate(d.getDate()+n);return dayKey(d);}const iso=s.match(/\b(20\d{2}-\d{2}-\d{2})\b/);return iso?.[1]||'';
}
function timeFrom(text){
  const s=String(text||''),m=s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i)||s.match(/\b(?:at|to|for)\s*([01]?\d|2[0-3]):([0-5]\d)\b/i);if(!m)return '';
  let h=Number(m[1]||0),min=Number(m[2]||0),mer=String(m[3]||'').toLowerCase().replace(/\./g,'');if(mer==='pm'&&h<12)h+=12;if(mer==='am'&&h===12)h=0;return h>23||min>59?'':String(h).padStart(2,'0')+':'+String(min).padStart(2,'0');
}
function dateLabel(k){const d=new Date(k+'T12:00:00');return Number.isNaN(d.getTime())?k:d.toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'});}
function dateJobs(k){
  const tickets=[...new Set(state.jobs.filter(j=>j.status!=='completed'&&String(j.scheduled_for||'')===String(k)).map(j=>String(j.ticket_no||'')))].filter(Boolean);
  if(tickets.length===1){
    state.currentTicket=tickets[0];
    const current=ensureChat();
    current.ticket=tickets[0];
    saveChats();
    setTimeout(renderOrder,0);
  }
  return tickets.length?'<div class="vision-answer-title">'+tickets.length+' job'+(tickets.length===1?'':'s')+' on '+esc(dateLabel(k))+'</div><div class="vision-answer-copy">I pulled the live Tech Check schedule and assignments.</div>'+tickets.slice(0,12).map(jobCard).join(''):'<div class="vision-answer-title">No Tech Check jobs are scheduled for '+esc(dateLabel(k))+'.</div>';
}
function findTech(text,role=''){
  const s=String(text||'').toLowerCase(),pool=state.techs.filter(t=>!role||t.role===role),exact=pool.find(t=>[t.full_name,t.username].filter(Boolean).some(v=>s.includes(String(v).toLowerCase())));if(exact)return exact;
  return pool.find(t=>{const first=String(t.full_name||'').trim().split(/\s+/)[0].toLowerCase();return first.length>2&&new RegExp('\\b'+reEsc(first)+'\\b','i').test(s);})||null;
}
function assignIntent(text){
  const s=String(text||'').toLowerCase();
  if(!/\b(assign|task|send|put|give|ask)\b/.test(s)||!/\b(job|ticket|this|service|it|tech|technician|to)\b/.test(s))return null;
  const service=/\bservice\b/.test(s),it=/\bit\b/.test(s),tech=findTech(text,service?'service':it?'it':'');
  if(tech)return{kind:'assign-tech',role:tech.role,tech};
  if(service&&/\b(?:a|any|which)?\s*service\s+(?:tech|technician)\b/.test(s))return{kind:'choose-tech',role:'service'};
  if(it&&/\b(?:a|any|which)?\s*it\s+(?:tech|technician)\b/.test(s))return{kind:'choose-tech',role:'it'};
  if(service)return{kind:'assign-queue',role:'service'};
  if(it)return{kind:'assign-queue',role:'it'};
  return null;
}
function scheduleIntent(text){const d=dateFrom(text),t=timeFrom(text);return(d||t)&&/\b(move|change|set|make|schedule|reschedule|put)\b/i.test(text)?{kind:'schedule',date:d,time:t}:null;}

function isCreateRequest(text){
  const s=String(text||'').toLowerCase();
  return /\b(create|make|start|prepare|set\s*up|setup)\b[\s\S]{0,45}\b(ticket|job|assignment)\b/.test(s)
    || /\b(create|make|start|prepare)\b[\s\S]{0,25}\b(delivery|pickup|swap|service)\b[\s\S]{0,20}\b(ticket|job)\b/.test(s);
}
function draftWorkType(text){
  const s=String(text||'').toLowerCase();
  if(/\b(pickup|pick\s+up)\b/.test(s))return'pickup';
  if(/\b(delivery|deliver|deploy)\b/.test(s))return'delivery';
  if(/\b(swap|swapping)\b/.test(s))return'swap';
  if(/\bservice\b/.test(s))return'service';
  return'';
}
function draftDefaultRole(type){
  if(type==='delivery'||type==='swap')return'it_service';
  if(type==='pickup')return'service_it';
  if(type==='service')return'service';
  return'';
}
function draftFlowLabel(d){
  return d.role==='it_service'?'IT → Service':d.role==='service_it'?'Service → IT':d.role==='it'?'IT only':d.role==='service'?'Service only':'—';
}
function draftEquipmentParse(text){
  const raw=numberWords(String(text||'')),lower=raw.toLowerCase();
  const defs=[
    {category:'device',label:'Solar Spotter',aliases:['solar spotter','solar spotters']},
    {category:'device',label:'Recon 2',aliases:['recon 2','recon ii','recon two']},
    {category:'device',label:'Helios',aliases:['helios','helio']},
    {category:'device',label:'Ranger',aliases:['ranger','rangers']},
    {category:'device',label:'Sniper',aliases:['sniper','snipers']},
    {category:'device',label:'Spotter',aliases:['spotter','spotters']},
    {category:'stand',label:'Solar Stand',aliases:['solar stand','solar stands']},
    {category:'stand',label:'Solar Pole',aliases:['solar pole','solar poles']},
    {category:'stand',label:'110V Stand',aliases:['110v stand','110 v stand','110 volt stand']},
    {category:'stand',label:'Pole',aliases:['pole','poles']}
  ];
  const rows=[];
  for(const def of defs){
    let source=lower;
    if(def.label==='Spotter')source=source.replace(/solar spotters?/g,'');
    if(def.label==='Pole')source=source.replace(/solar poles?/g,'');
    let qty=null,mentioned=false;
    for(const alias of def.aliases){
      const a=reEsc(alias);
      const before=source.match(new RegExp('\\b(\\d+)\\s*(?:x|×)?\\s*'+a+'\\b','i'));
      const after=source.match(new RegExp('\\b'+a+'\\s*(?:x|×)\\s*(\\d+)\\b','i'));
      const one=source.match(new RegExp('\\b(?:a|an)\\s+'+a+'\\b','i'));
      if(before){qty=Number(before[1]);mentioned=true;break;}
      if(after){qty=Number(after[1]);mentioned=true;break;}
      if(one){qty=1;mentioned=true;break;}
      if(new RegExp('\\b'+a+'\\b','i').test(source))mentioned=true;
    }
    if(qty&&qty>0)rows.push({category:def.category,label:def.label,qty});
    else if(mentioned)rows.push({category:def.category,label:def.label,qty:0});
  }
  return rows;
}
function draftMergeEquipment(d,rows){
  for(const row of rows||[]){
    const existing=(d.equipment_manifest||[]).find(x=>x.category===row.category&&String(x.label).toLowerCase()===String(row.label).toLowerCase());
    if(existing){if(row.qty>0)existing.qty=row.qty;}
    else d.equipment_manifest.push({...row});
  }
  d.equipment_manifest=d.equipment_manifest.filter(x=>Number(x.qty||0)>0);
}
function draftDeviceTotal(d){
  return (d.equipment_manifest||[]).filter(x=>x.category==='device').reduce((n,x)=>n+Number(x.qty||0),0);
}
function draftStandTotal(d){
  return (d.equipment_manifest||[]).filter(x=>x.category==='stand').reduce((n,x)=>n+Number(x.qty||0),0);
}
function draftEquipmentText(d){
  return (d.equipment_manifest||[]).map(x=>x.qty+' × '+x.label).join(', ')||'—';
}

function draftPartsParse(text){
  const s=numberWords(String(text||'').toLowerCase());
  const defs=[
    {key:'solar_panel_qty',aliases:['solar panel','solar panels']},
    {key:'battery_replacement_qty',aliases:['replacement battery','replacement batteries','battery replacement','battery replacements']},
    {key:'camera_replacement_qty',aliases:['replacement camera','replacement cameras','camera replacement','camera replacements']},
    {key:'sim_replacement_qty',aliases:['replacement sim','replacement sims','sim replacement','sim replacements','sim card','sim cards']},
    {key:'micro_sd_qty',aliases:['micro sd','micro sds','micro sd card','micro sd cards']}
  ];
  const parts={};
  for(const def of defs){
    for(const alias of def.aliases){
      const a=reEsc(alias);
      const before=s.match(new RegExp('\\b(\\d+)\\s*(?:x|×)?\\s*'+a+'\\b','i'));
      const after=s.match(new RegExp('\\b'+a+'\\s*(?:x|×)\\s*(\\d+)\\b','i'));
      if(before){parts[def.key]=Number(before[1]);break;}
      if(after){parts[def.key]=Number(after[1]);break;}
    }
  }
  return parts;
}
function draftPartsText(d){
  if(!d.parts_answered)return'Not answered';
  const p=d.parts||{},rows=[];
  if(Number(p.solar_panel_qty||0)>0)rows.push(p.solar_panel_qty+' solar panel'+(Number(p.solar_panel_qty)===1?'':'s'));
  if(Number(p.battery_replacement_qty||0)>0)rows.push(p.battery_replacement_qty+' replacement batter'+(Number(p.battery_replacement_qty)===1?'y':'ies'));
  if(Number(p.camera_replacement_qty||0)>0)rows.push(p.camera_replacement_qty+' replacement camera'+(Number(p.camera_replacement_qty)===1?'':'s'));
  if(Number(p.sim_replacement_qty||0)>0)rows.push(p.sim_replacement_qty+' SIM card'+(Number(p.sim_replacement_qty)===1?'':'s'));
  if(Number(p.micro_sd_qty||0)>0)rows.push(p.micro_sd_qty+' micro SD card'+(Number(p.micro_sd_qty)===1?'':'s'));
  return rows.join(', ')||'None';
}
function draftMatchedTechs(text){
  const lower=String(text||'').toLowerCase(),hits=[];
  for(const tech of state.techs){
    const full=String(tech.full_name||'').trim(),user=String(tech.username||'').trim(),first=full.split(/\s+/)[0]||'';
    if((full.length>2&&lower.includes(full.toLowerCase()))||(user.length>2&&new RegExp('\\b'+reEsc(user)+'\\b','i').test(lower))||(first.length>2&&new RegExp('\\b'+reEsc(first)+'\\b','i').test(lower)))hits.push(tech);
  }
  return hits;
}
function draftAssignmentText(d){
  if(!d.assignment_answered)return'Not answered';
  const out=[];
  for(const role of ['it','service']){
    const id=d.assignees?.[role],tech=id?state.techs.find(t=>t.user_id===id):null;
    const needed=d.role===role||d.role==='it_service'||d.role==='service_it';
    if(!needed)continue;
    out.push((role==='it'?'IT':'Service')+': '+(tech?(tech.full_name||tech.username):'Department queue'));
  }
  return out.join(' · ')||'—';
}
function draftStepKeys(){return ['work_type','ticket_no','site','scheduled_for','scheduled_time','equipment_manifest','equipment_numbers','job_description','parts','assignment','notes'];}
function draftChoiceHtml(key,d){
  if(key==='work_type')return '<div class="vision-draft-choices">'+['Delivery','Pickup','Swap','Service'].map(v=>'<button type="button" data-vision-prompt="'+v+'">'+v+'</button>').join('')+'</div>';
  if(key==='scheduled_for')return '<div class="vision-draft-choices"><button type="button" data-vision-prompt="Today">Today</button><button type="button" data-vision-prompt="Tomorrow">Tomorrow</button><button type="button" data-vision-prompt="Monday">Monday</button><button type="button" data-vision-prompt="Tuesday">Tuesday</button></div>';
  if(key==='scheduled_time')return '<div class="vision-draft-choices"><button type="button" data-vision-prompt="8 AM">8 AM</button><button type="button" data-vision-prompt="9 AM">9 AM</button><button type="button" data-vision-prompt="No specific time">No specific time</button></div>';
  if(key==='equipment_manifest'){
    const noEq=d.work_type==='service'?'<button type="button" data-vision-prompt="No equipment">No equipment</button>':'';
    return '<div class="vision-draft-choices"><button type="button" data-vision-prompt="1 Helios">1 Helios</button><button type="button" data-vision-prompt="1 Solar Spotter">1 Solar Spotter</button><button type="button" data-vision-prompt="1 Ranger">1 Ranger</button><button type="button" data-vision-prompt="1 Sniper">1 Sniper</button>'+noEq+'</div>';
  }
  if(key==='equipment_numbers')return '<div class="vision-draft-choices"><button type="button" data-vision-prompt="No equipment numbers yet">No numbers yet</button></div>';
  if(key==='parts')return '<div class="vision-draft-choices"><button type="button" data-vision-prompt="No additional parts">No additional parts</button></div>';
  if(key==='assignment'){
    const people=state.techs.filter(t=>d.role==='it_service'||d.role==='service_it'||t.role===d.role).slice(0,8);
    return '<div class="vision-draft-choices"><button type="button" data-vision-prompt="Use department queues">Department queues</button>'+people.map(t=>'<button type="button" data-vision-prompt="Assign '+esc(t.full_name||t.username)+'">'+esc((t.role==='it'?'IT: ':'Service: ')+(t.full_name||t.username))+'</button>').join('')+'</div>';
  }
  if(key==='notes')return '<div class="vision-draft-choices"><button type="button" data-vision-prompt="No additional notes">No additional notes</button></div>';
  return '';
}

function draftMissingKey(d){
  if(!d.work_type)return'work_type';
  if(!d.ticket_no)return'ticket_no';
  if(!d.site)return'site';
  if(!d.scheduled_for)return'scheduled_for';
  if(!d.time_answered)return'scheduled_time';
  const needsEquipment=d.work_type!=='service';
  if(needsEquipment&&!(d.equipment_manifest||[]).length)return'equipment_manifest';
  if(!needsEquipment&&!d.equipment_answered&&!(d.equipment_manifest||[]).length)return'equipment_manifest';
  if(!d.equipment_numbers_answered)return'equipment_numbers';
  if(!d.job_description)return'job_description';
  if(!d.parts_answered)return'parts';
  if(!d.assignment_answered)return'assignment';
  if(!d.notes_answered)return'notes';
  return'';
}
function draftQuestion(key,d){
  if(key==='work_type')return'What kind of work order are we creating?';
  if(key==='ticket_no')return'What is the MHelpDesk ticket number?';
  if(key==='site')return'What customer or site is listed on the MHelpDesk ticket?';
  if(key==='scheduled_for')return'What date should this work be scheduled for?';
  if(key==='scheduled_time')return'What time should it be scheduled for? If there is no exact time, choose “No specific time.”';
  if(key==='equipment_manifest')return d.work_type==='service'?'Does this Service job need any equipment from the shop?':'What equipment is required, and how many?';
  if(key==='equipment_numbers')return'Do you have the specific unit / stand numbers from MHelpDesk? Type them, or choose “No numbers yet.”';
  if(key==='job_description')return'What should the technician actually do on this work order?';
  if(key==='parts')return'Are any extra parts or supplies required — solar panels, replacement batteries, cameras, SIM cards, or micro SD cards?';
  if(key==='assignment')return'Who should this work be assigned to? Choose a technician or leave each step in its department queue.';
  if(key==='notes')return'Any additional owner notes for the technicians?';
  return'';
}
function draftSummaryHtml(d){
  const when=d.scheduled_for?(dateLabel(d.scheduled_for)+(d.time_answered?(d.scheduled_time?' · '+d.scheduled_time:' · no exact time'):' · time not answered')):'—';
  return '<div class="vision-draft-card"><div class="vision-draft-head"><span><small>NEW TECH CHECK DRAFT</small><b>'+esc(String(d.work_type||'New job').toUpperCase())+'</b></span><span class="vision-pill">'+esc(draftFlowLabel(d))+'</span></div>'
    +'<div class="vision-draft-grid"><div><span>MHelpDesk</span><b>'+(d.ticket_no?'#'+esc(d.ticket_no):'—')+'</b></div><div><span>Site</span><b>'+esc(d.site||'—')+'</b></div><div><span>Schedule</span><b>'+esc(when)+'</b></div><div><span>Equipment</span><b>'+esc(draftEquipmentText(d))+'</b></div><div><span>Assignment</span><b>'+esc(draftAssignmentText(d))+'</b></div><div><span>Parts</span><b>'+esc(draftPartsText(d))+'</b></div></div>'
    +(d.job_description?'<div class="vision-draft-description"><span>Work to perform</span><b>'+esc(d.job_description)+'</b></div>':'')
    +(d.notes?'<div class="vision-draft-description"><span>Owner notes</span><b>'+esc(d.notes)+'</b></div>':'')+'</div>';
}
function draftApplyInput(d,text,initial=false){
  const raw=String(text||'').trim(),expected=draftMissingKey(d),type=draftWorkType(raw);
  if(type){d.work_type=type;d.role=draftDefaultRole(type);}
  const explicitTicket=ticketFrom(raw),bareTicket=!explicitTicket&&/^\s*\d{3,}\s*$/.test(raw)?raw.trim():'';
  if(explicitTicket||bareTicket)d.ticket_no=explicitTicket||bareTicket;
  const siteMatch=raw.match(/\b(?:site|customer)\s*(?:is|:|=|-)\s*([^,.;\n]+)/i);
  if(siteMatch)d.site=String(siteMatch[1]||'').trim();
  const when=dateFrom(raw);if(when)d.scheduled_for=when;
  const clock=timeFrom(raw);if(clock){d.scheduled_time=clock;d.time_answered=true;}
  if(expected==='scheduled_time'&&/\b(no specific time|no time|anytime|skip|none)\b/i.test(raw)){d.scheduled_time='';d.time_answered=true;}
  const equipment=draftEquipmentParse(raw);
  if(equipment.some(x=>x.qty>0)){draftMergeEquipment(d,equipment);d.equipment_answered=true;}
  if(expected==='equipment_manifest'&&/\b(no equipment|none|no shop equipment)\b/i.test(raw)&&d.work_type==='service'){d.equipment_manifest=[];d.equipment_answered=true;d.equipment_numbers_answered=true;}
  const unitMatch=raw.match(/\b(?:unit|units)\s*(?:#s?|numbers?|tags?)?\s*[:=]?\s*([A-Za-z0-9-]+(?:\s*,\s*[A-Za-z0-9-]+)*)/i);
  if(unitMatch){d.unit_numbers=unitMatch[1].trim();d.equipment_numbers_answered=true;}
  const standMatch=raw.match(/\b(?:stand|stands|solar\s+stand|solar\s+stands|pole|poles)\s*(?:#s?|numbers?|tags?)?\s*[:=]?\s*([A-Za-z0-9-]+(?:\s*,\s*[A-Za-z0-9-]+)*)/i);
  if(standMatch){d.stand_numbers=standMatch[1].trim();d.equipment_numbers_answered=true;}
  if(expected==='equipment_numbers'&&/\b(no equipment numbers|no numbers|not yet|unknown|skip|none)\b/i.test(raw))d.equipment_numbers_answered=true;
  const descMatch=raw.match(/\bdescription\s*(?:is|:|=)\s*([^;\n]+)/i);
  if(descMatch)d.job_description=String(descMatch[1]||'').trim();
  const parts=draftPartsParse(raw);
  if(Object.keys(parts).length){d.parts={...(d.parts||{}),...parts};d.parts_answered=true;}
  if(expected==='parts'&&/\b(no additional parts|no parts|none|skip)\b/i.test(raw)){d.parts=d.parts||{};d.parts_answered=true;}
  const techs=draftMatchedTechs(raw);
  if(techs.length){d.assignees=d.assignees||{};techs.forEach(t=>{if(t.role==='it'||t.role==='service')d.assignees[t.role]=t.user_id;});if(expected==='assignment'||/\b(assign|task|send|give)\b/i.test(raw))d.assignment_answered=true;}
  if(expected==='assignment'&&/\b(department queues?|queue|leave.*queue|unassigned)\b/i.test(raw)){d.assignees=d.assignees||{};d.assignment_answered=true;}
  const notesMatch=raw.match(/\bnotes?\s*(?:are|is|:|=)\s*([^;\n]+)/i);
  if(notesMatch){d.notes=String(notesMatch[1]||'').trim();d.notes_answered=true;}
  if(expected==='notes'&&/\b(no additional notes|no notes|none|skip)\b/i.test(raw)){d.notes='';d.notes_answered=true;}
  const recognized=Boolean(type||explicitTicket||bareTicket||siteMatch||when||clock||equipment.some(x=>x.qty>0)||unitMatch||standMatch||descMatch||Object.keys(parts).length||techs.length||notesMatch);
  if(!initial&&!recognized){
    if(expected==='site')d.site=raw;
    else if(expected==='job_description')d.job_description=raw;
    else if(expected==='notes'){d.notes=raw;d.notes_answered=true;}
  }
  return d;
}
function draftResponseHtml(d,started=false){
  const missing=draftMissingKey(d);
  if(missing){
    const keys=draftStepKeys(d),step=Math.max(1,keys.indexOf(missing)+1);
    return '<div class="vision-answer-title">'+(started?'I started the work order. I’ll ask you one thing at a time.':'Got it. Here is the next question.')+'</div>'+draftSummaryHtml(d)
      +'<div class="vision-draft-question"><small>QUESTION '+step+' OF '+keys.length+'</small><b>'+esc(draftQuestion(missing,d))+'</b>'+draftChoiceHtml(missing,d)+'</div>'
      +'<div class="vision-system-note">Answer below or tap one of the choices. Vision remembers the answers already in this draft.</div>';
  }
  const actionId=id();state.pending.set(actionId,{kind:'create-job',draft:JSON.parse(JSON.stringify(d))});
  return '<div class="vision-answer-title">The work order is complete and ready for review.</div>'+draftSummaryHtml(d)
    +'<div class="vision-action-card"><small>READY TO CREATE</small><b>Create this '+esc(String(d.work_type).toUpperCase())+' Tech Check job?</b><p>Vision will create the Tech Check workflow shown above. MHelpDesk remains separate.</p><div class="vision-action-buttons"><button class="vision-confirm" type="button" data-confirm-action="'+esc(actionId)+'">Create Tech Check job</button><button class="vision-cancel" type="button" data-cancel-action="'+esc(actionId)+'">Keep editing</button></div></div>';
}
function startDraft(text){
  state.currentTicket='';
  const d={work_type:'',role:'',ticket_no:'',site:'',scheduled_for:'',scheduled_time:'',time_answered:false,equipment_manifest:[],equipment_answered:false,equipment_numbers_answered:false,unit_numbers:'',stand_numbers:'',job_description:'',parts:{},parts_answered:false,assignees:{},assignment_answered:false,notes:'',notes_answered:false};
  draftApplyInput(d,text,true);
  const current=ensureChat();current.ticket='';current.draft=d;saveChats();renderOrder();
  return draftResponseHtml(d,true);
}
function continueDraft(text){
  const current=ensureChat(),d=current.draft;
  if(!d)return'';
  if(/\b(cancel|never\s+mind|nevermind|discard|stop)\b/i.test(text)){
    current.draft=null;saveChats();
    return '<div class="vision-answer-title">Draft cancelled.</div><div class="vision-answer-copy">No Tech Check job was created.</div>';
  }
  draftApplyInput(d,text,false);current.draft=d;saveChats();
  return draftResponseHtml(d,false);
}
async function createDraftJob(d){
  const duplicate=state.jobs.find(j=>j.status!=='completed'&&String(j.ticket_no||'')===String(d.ticket_no));
  if(duplicate){state.currentTicket=String(d.ticket_no);const current=ensureChat();current.ticket=state.currentTicket;current.draft=null;saveChats();renderOrder();return '<div class="vision-direct warn"><b>That Tech Check job already exists.</b>I did not create a duplicate. I opened the existing MHelpDesk #'+esc(d.ticket_no)+' job instead.</div>'+jobCard(d.ticket_no);}
  const roles=d.role==='it_service'?['it','service']:d.role==='service_it'?['service','it']:d.role?[d.role]:[d.work_type==='service'?'service':'it'],ids=[],parts=d.parts||{};
  for(const role of roles){
    const assignee=d.assignees?.[role]||null;
    const response=await db.rpc('owner_assign_job_v8',{p_ticket_no:String(d.ticket_no),p_site:d.site,p_assigned_role:role,p_assignee_user_id:assignee,p_requested_unit_count:draftDeviceTotal(d),p_unit_summary:[d.unit_numbers?'Unit #s: '+d.unit_numbers:'',d.stand_numbers?'Stand / Solar Stand #s: '+d.stand_numbers:''].filter(Boolean).join(' | '),p_job_description:d.job_description,p_notes:d.notes||'',p_solar_panel_qty:Number(parts.solar_panel_qty||0),p_battery_replacement_qty:Number(parts.battery_replacement_qty||0),p_camera_replacement_qty:Number(parts.camera_replacement_qty||0),p_sim_replacement_qty:Number(parts.sim_replacement_qty||0),p_micro_sd_qty:Number(parts.micro_sd_qty||0),p_equipment_manifest:d.equipment_manifest,p_requires_it_handoff:d.work_type==='pickup'?false:((d.role==='it_service'&&role==='service')||(d.role==='service_it'&&role==='it')),p_scheduled_for:d.scheduled_for,p_work_type:d.work_type});
    if(response.error)throw response.error;
    if(response.data){ids.push(response.data);if(d.scheduled_time){const timeUpdate=await db.from('job_assignments').update({scheduled_time:d.scheduled_time,updated_at:now()}).eq('id',response.data);if(timeUpdate.error)throw timeUpdate.error;}}
  }
  for(const assignmentId of ids){try{await db.functions.invoke('send-techcheck-push',{body:{assignment_id:assignmentId}});}catch{}}
  await loadData();state.currentTicket=String(d.ticket_no);const current=ensureChat();current.ticket=state.currentTicket;current.draft=null;saveChats();renderOrder();
  return '<div class="vision-direct good"><b>Tech Check job created.</b>MHelpDesk #'+esc(d.ticket_no)+' is now set up as a '+esc(String(d.work_type).toUpperCase())+' workflow. '+esc(draftFlowLabel(d))+' is in place.</div>'+jobCard(d.ticket_no);
}
function actionCard(a,ticket){
  if(a.kind==='choose-tech'){
    const people=state.techs.filter(t=>t.role===a.role);
    if(!people.length)return '<div class="vision-direct warn"><b>No active '+esc(a.role==='service'?'Service':'IT')+' technicians are available.</b>You can still ask Vision to send this job to the department queue.</div>';
    const choices=people.map(t=>{
      const name=t.full_name||t.username||'Technician';
      return '<button type="button" data-vision-prompt="Assign '+esc(name)+' as the '+esc(a.role==='service'?'Service Tech':'IT Technician')+' for this job">'+esc(name)+'</button>';
    }).join('');
    return '<div class="vision-action-card"><small>CHOOSE TECHNICIAN</small><b>Who should take MHelpDesk #'+esc(ticket)+'?</b><p>Select a technician and Vision will prepare the assignment for confirmation.</p><div class="vision-tech-choice-grid">'+choices+'</div></div>';
  }
  const actionId=id();state.pending.set(actionId,{...a,ticket});
  if(a.kind==='assign-tech')return '<div class="vision-action-card"><small>PROPOSED CHANGE</small><b>Assign '+esc(a.tech.full_name||a.tech.username)+' as '+esc(a.role==='service'?'Service Tech':'IT Technician')+'</b><p>Ticket #'+esc(ticket)+' will be assigned directly in Tech Check. MHelpDesk will not be changed.</p><div class="vision-action-buttons"><button class="vision-confirm" type="button" data-confirm-action="'+esc(actionId)+'">Confirm assignment</button><button class="vision-cancel" type="button" data-cancel-action="'+esc(actionId)+'">Cancel</button></div></div>';
  if(a.kind==='assign-queue')return '<div class="vision-action-card"><small>PROPOSED CHANGE</small><b>Send ticket #'+esc(ticket)+' to the '+esc(a.role==='service'?'Service':'IT')+' department queue</b><p>A technician in that department can claim it using the exact MHelpDesk ticket number.</p><div class="vision-action-buttons"><button class="vision-confirm" type="button" data-confirm-action="'+esc(actionId)+'">Confirm department assignment</button><button class="vision-cancel" type="button" data-cancel-action="'+esc(actionId)+'">Cancel</button></div></div>';
  const label=[a.date?dateLabel(a.date):'',a.time||''].filter(Boolean).join(' - ');
  return '<div class="vision-action-card"><small>PROPOSED CHANGE</small><b>Update the Tech Check schedule</b><p>Ticket #'+esc(ticket)+' -> '+esc(label)+'</p><div class="vision-action-buttons"><button class="vision-confirm" type="button" data-confirm-action="'+esc(actionId)+'">Confirm schedule change</button><button class="vision-cancel" type="button" data-cancel-action="'+esc(actionId)+'">Cancel</button></div></div>';
}
function who(ticket){
  const rows=active(ticket);return rows.length?'<div class="vision-direct good"><b>Here is who currently has MHelpDesk #'+esc(ticket)+'.</b>'+rows.map(r=>'<div>'+esc(String(r.assigned_role||'').toUpperCase())+': '+esc(assignee(r))+'</div>').join('')+'</div>'+jobCard(ticket):'<div class="vision-direct warn"><b>No active assignment is showing.</b>MHelpDesk #'+esc(ticket)+' has no active IT or Service assignment in Tech Check.</div>';
}
async function answer(text){
  const raw=String(text||'').trim(),lower=raw.toLowerCase();
  const current=chat();
  if(current?.draft)return continueDraft(raw);
  if(isCreateRequest(raw))return startDraft(raw);

  const hint=unitHint(raw);let ticket=ticketFrom(raw)||ticketByUnit(hint);
  if(!ticket&&state.currentTicket&&/\b(this|that|it|job|ticket|order|who|next|assign|task|send|move|change|set|make|finish|remaining)\b/i.test(raw))ticket=state.currentTicket;
  const d=dateFrom(raw);
  if(d&&/\b(job|jobs|schedule|scheduled|what do i have|show me)\b/i.test(raw)&&!/\b(move|change|set|make|reschedule)\b/i.test(raw))return dateJobs(d);
  if(/\b(active jobs?|open jobs?|show me my active jobs?|current jobs?)\b/i.test(lower)){
    const all=[...new Set(state.jobs.filter(j=>j.status!=='completed').map(j=>String(j.ticket_no||'')))].filter(Boolean);
    return all.length?'<div class="vision-answer-title">'+all.length+' active Tech Check job'+(all.length===1?'':'s')+'</div>'+all.slice(0,12).map(jobCard).join(''):'<div class="vision-answer-title">No active Tech Check jobs are open right now.</div>';
  }
  if(/\b(needs? attention|attention|stuck|overdue|problem jobs?)\b/i.test(lower)){
    const all=[...new Set(state.jobs.filter(j=>j.status!=='completed').map(j=>String(j.ticket_no||'')))].filter(Boolean),flag=all.filter(t=>{const p=prep(t),a=active(t);return a.some(x=>x.requires_it_handoff)&&(!p||!['released','closed'].includes(p.status));});
    return flag.length?'<div class="vision-answer-title">'+flag.length+' job'+(flag.length===1?'':'s')+' need workflow attention</div>'+flag.slice(0,10).map(jobCard).join(''):'<div class="vision-answer-title">No handoff blockers are showing right now.</div>';
  }
  if(ticket){
    if(!group(ticket).length&&!prep(ticket))return ticketAnswer(ticket);
    state.currentTicket=ticket;ensureChat().ticket=ticket;saveChats();renderOrder();
    const a=assignIntent(raw);if(a)return '<div class="vision-answer-title">I can prepare that change.</div>'+actionCard(a,ticket)+jobCard(ticket);
    const s=scheduleIntent(raw);if(s)return '<div class="vision-answer-title">I can update the schedule.</div>'+actionCard(s,ticket)+jobCard(ticket);
    if(/\b(who\s+(?:has|is\s+assigned|is\s+handling)|who(?:'s|\s+is)\s+(?:task|assigned|handling)|assignment|assigned\s+to|who\s+has\s+it)\b/i.test(raw))return who(ticket);
    if(/\b(what happens next|what next|still needs|remaining|finish it|what needs to be done)\b/i.test(raw))return '<div class="vision-answer-title">What still needs to happen</div><div class="vision-direct"><b>MHelpDesk #'+esc(ticket)+'</b>'+esc(next(ticket))+'</div>'+jobCard(ticket);
    return ticketAnswer(ticket,'Here is the live Tech Check side of this service order.');
  }
  if(assignIntent(raw))return '<div class="vision-answer-title">Which service order?</div><div class="vision-answer-copy">Tell me the MHelpDesk ticket number or unit first, then I can prepare the assignment.</div>';
  if(scheduleIntent(raw))return '<div class="vision-answer-title">Which service order should I reschedule?</div><div class="vision-answer-copy">Tell me the ticket number or unit and I will keep the date/time change ready.</div>';
  if(/\b(helios).*(steps|workflow|process)|\b(steps|workflow|process).*(helios)\b/i.test(raw))return '<div class="vision-answer-title">Helios delivery workflow</div><div class="vision-direct"><b>Owner -> IT -> Service -> Field -> Owner Final</b>IT prepares Helios and creates the Service handoff. Service performs yard PV/Victron/charging checks and transport prep, then field installation and final proof. Owner completes final verification.</div>';
  return '<div class="vision-answer-title">I can work through the Tech Check record with you.</div><div class="vision-answer-copy">You can ask me to create a new Delivery, Pickup, Swap, or Service job, or work with an existing ticket or unit.</div>';
}
async function send(raw=null){
  const input=$('visionPrompt'),text=String(raw??input?.value??'').trim();if(!text)return;if(input){input.value='';grow(input);}
  titleFrom(text);addMessage('user',text);renderThread();$('visionThread').insertAdjacentHTML('beforeend',typing());bottom();
  try{const html=await answer(text);$('visionTyping')?.remove();addMessage('assistant','',html);renderThread();renderOrder();}
  catch(error){$('visionTyping')?.remove();addMessage('assistant','', '<div class="vision-direct warn"><b>Vision could not finish that request.</b>'+esc(error?.message||'Please try again.')+'</div>');renderThread();}
}
async function execute(actionId){
  const a=state.pending.get(actionId);if(!a)return;state.pending.delete(actionId);
  if(a.kind==='create-job'){
    const html=await createDraftJob(a.draft);
    addMessage('assistant','',html);renderThread();renderOrder();
    return;
  }
  const ticket=a.ticket,rows=active(ticket),p=prep(ticket),base=rows[0]||group(ticket)[0];if(!base)throw new Error('The service order is no longer available.');
  let result='';
  if(a.kind==='schedule'){
    const update={updated_at:now()};if(a.date)update.scheduled_for=a.date;if(a.time)update.scheduled_time=a.time;
    const x=await db.from('job_assignments').update(update).eq('ticket_no',ticket).in('status',['assigned','started']);if(x.error)throw x.error;result='Schedule updated for MHelpDesk #'+ticket+'.';
  }else{
    const existing=rows.find(r=>r.assigned_role===a.role),tech=a.tech||null;
    if(existing){
      const update={assignee_user_id:tech?.user_id||null,assignee_name:tech?(tech.full_name||tech.username):(a.role==='service'?'Service Department':'IT Department'),assignment_scope:tech?'direct':'department',updated_at:now()};
      const x=await db.from('job_assignments').update(update).eq('id',existing.id);if(x.error)throw x.error;
      result=tech?(tech.full_name||tech.username)+' is now assigned to MHelpDesk #'+ticket+'.':'MHelpDesk #'+ticket+' is now in the '+(a.role==='service'?'Service':'IT')+' department queue.';
    }else{
      const x=await db.rpc('owner_assign_job_v8',{p_ticket_no:String(ticket),p_site:base.site||p?.site||'',p_assigned_role:a.role,p_assignee_user_id:tech?.user_id||null,p_requested_unit_count:Number(base.requested_unit_count||0),p_unit_summary:base.unit_summary||'',p_job_description:base.job_description||'',p_notes:base.notes||'',p_solar_panel_qty:Number(base.solar_panel_qty||0),p_battery_replacement_qty:Number(base.battery_replacement_qty||0),p_camera_replacement_qty:Number(base.camera_replacement_qty||0),p_sim_replacement_qty:Number(base.sim_replacement_qty||0),p_micro_sd_qty:Number(base.micro_sd_qty||0),p_equipment_manifest:base.equipment_manifest||p?.equipment_manifest||{},p_requires_it_handoff:a.role==='service'&&String(base.work_type||'').toLowerCase()!=='pickup',p_scheduled_for:base.scheduled_for||dayKey(new Date()),p_work_type:base.work_type||p?.work_type||'service'});
      if(x.error)throw x.error;
      if(x.data&&base.scheduled_time){const t=await db.from('job_assignments').update({scheduled_time:base.scheduled_time,updated_at:now()}).eq('id',x.data);if(t.error)throw t.error;}
      try{if(x.data)await db.functions.invoke('send-techcheck-push',{body:{assignment_id:x.data}});}catch{}
      result=tech?(tech.full_name||tech.username)+' was assigned to MHelpDesk #'+ticket+'.':'MHelpDesk #'+ticket+' was sent to the '+(a.role==='service'?'Service':'IT')+' department queue.';
    }
  }
  await loadData();addMessage('assistant','', '<div class="vision-direct good"><b>Saved in Tech Check.</b>'+esc(result)+' MHelpDesk remains separate.</div>'+jobCard(ticket));renderThread();renderOrder();
}
function grow(el){if(!el)return;el.style.height='auto';el.style.height=Math.min(el.scrollHeight,150)+'px';}
function syncVisualViewport(){
  const vv=window.visualViewport;
  const root=document.documentElement;
  const composer=document.querySelector('.vision-composer-wrap');
  root.style.setProperty('--vision-composer-space',Math.ceil(composer?.getBoundingClientRect().height||92)+'px');
  if(!vv){root.style.setProperty('--vision-visual-bottom','0px');return;}
  const layoutH=document.documentElement.clientHeight||window.innerHeight||vv.height;
  const offset=Math.max(0,layoutH-vv.height-vv.offsetTop);
  root.style.setProperty('--vision-visual-bottom',offset+'px');
}
window.visualViewport?.addEventListener('resize',syncVisualViewport);
window.visualViewport?.addEventListener('scroll',syncVisualViewport);
window.addEventListener('resize',syncVisualViewport);
syncVisualViewport();
if(window.ResizeObserver){
  const composer=document.querySelector('.vision-composer-wrap');
  if(composer)new ResizeObserver(()=>syncVisualViewport()).observe(composer);
}
function closeDrawers(){$('visionApp')?.classList.remove('sidebar-open','order-open');}
function voice(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){addMessage('assistant','', '<div class="vision-system-note">Use the iPhone keyboard microphone for voice dictation on this device.</div>');renderThread();return;}
  const r=new SR();r.lang='en-US';r.interimResults=false;r.maxAlternatives=1;r.onresult=e=>{const text=e.results?.[0]?.[0]?.transcript||'';if(text)send(text);};r.start();
}
document.addEventListener('click',async e=>{
  const c=e.target.closest('[data-chat-id]');if(c)return openChat(c.dataset.chatId);
  const p=e.target.closest('[data-vision-prompt],[data-order-prompt]');if(p)return send(p.dataset.visionPrompt||p.dataset.orderPrompt);
  const confirm=e.target.closest('[data-confirm-action]');if(confirm){confirm.disabled=true;confirm.textContent='Saving...';try{await execute(confirm.dataset.confirmAction);}catch(error){addMessage('assistant','', '<div class="vision-direct warn"><b>That change was not saved.</b>'+esc(error?.message||'Please try again.')+'</div>');renderThread();}return;}
  const cancel=e.target.closest('[data-cancel-action]');if(cancel){state.pending.delete(cancel.dataset.cancelAction);addMessage('assistant','', '<div class="vision-system-note">No changes were made.</div>');renderThread();return;}
  if(e.target.closest('#visionNewChat')||e.target.closest('#visionHeaderNewButton'))return newChat();if(e.target.closest('#visionSendButton'))return send();if(e.target.closest('#visionMenuButton')){$('visionApp').classList.toggle('sidebar-open');return;}if(e.target.closest('#visionOrderButton')){$('visionApp').classList.toggle('order-open');return;}if(e.target.closest('#visionOrderClose')||e.target.closest('#visionShade'))return closeDrawers();
  if(e.target.closest('#visionRefreshButton')){try{await loadData();renderOrder();}catch(error){console.warn(error);}return;}
  if(e.target.closest('#visionVoiceButton'))return voice();
});
document.addEventListener('input',e=>{if(e.target?.id==='visionPrompt')grow(e.target);});
document.addEventListener('keydown',e=>{if(e.target?.id==='visionPrompt'&&e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
init().catch(error=>{$('visionLoading').innerHTML='<b>OnSite Vision could not open.</b><span>'+esc(error?.message||'Return to Tech Check and try again.')+'</span>';});
})();
(() => {
'use strict';
let db=null;
const state={session:null,profile:null,jobs:[],preps:[],techs:[],currentTicket:'',chats:[],chatId:'',pending:new Map(),loaded:false,agentStatus:'unknown',knowledgeEntries:[],knowledgeEditingId:''};
let conversationSyncTimer=null;
let persistenceReady=false;
const STORE='cos-onsite-vision-chats-v1';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const now=()=>new Date().toISOString();
const dayKey=(d=new Date())=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const id=()=>String(Date.now())+Math.random().toString(36).slice(2,8);
const reEsc=s=>String(s||'').replace(/[.*+?^$()|[\]\\]/g,'\\$&');

function techCheckDb(){
  return supabase.createClient(
    'https://goqrnolcvqnirjmzaeyk.supabase.co',
    'sb_publishable__URX6fCOr6KVvGsUsGS7wA_a1AmU7Rw'
  );
}
function visionPersistence(){return window.OnSiteVisionPersistence||null;}
function visionKnowledgeAdmin(){return window.OnSiteVisionKnowledgeAdmin||null;}
function loadChats(){try{const x=JSON.parse(localStorage.getItem(STORE)||'[]');state.chats=Array.isArray(x)?x.slice(0,20):[];}catch{state.chats=[];}}
function queueConversationSync(){
  if(!persistenceReady||!db)return;
  clearTimeout(conversationSyncTimer);
  conversationSyncTimer=setTimeout(async()=>{
    const current=chat();
    if(!current)return;
    try{await visionPersistence()?.save?.(current);}
    catch(error){console.warn('Vision conversation cloud sync',error);}
  },350);
}
function saveChats(){
  try{localStorage.setItem(STORE,JSON.stringify(state.chats.slice(0,20)));}catch{}
  queueConversationSync();
}
async function hydratePersistentChats(){
  const layer=visionPersistence();
  if(!layer?.load){persistenceReady=false;return;}
  try{
    const remote=await layer.load(20);
    const merged=new Map();
    for(const row of [...state.chats,...remote]){
      if(!row?.id)continue;
      const existing=merged.get(row.id);
      const a=existing?.updatedAt?new Date(existing.updatedAt).getTime():0;
      const b=row.updatedAt?new Date(row.updatedAt).getTime():0;
      if(!existing||b>=a)merged.set(row.id,row);
    }
    state.chats=[...merged.values()].sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0)).slice(0,20);
    persistenceReady=true;
    await layer.saveAll?.(state.chats,20);
    try{localStorage.setItem(STORE,JSON.stringify(state.chats));}catch{}
  }catch(error){
    persistenceReady=false;
    console.warn('Vision persistent conversation load',error);
  }
}
function chat(){return state.chats.find(x=>x.id===state.chatId)||null;}
function ensureChat(){
  let c=chat();if(c)return c;
  c={id:id(),title:'New conversation',createdAt:now(),updatedAt:now(),ticket:'',messages:[]};
  state.chats.unshift(c);state.chatId=c.id;saveChats();renderHistory();return c;
}
async function newChat(){
  const previous=chat();
  clearTimeout(conversationSyncTimer);
  if(previous&&persistenceReady&&db){
    try{await visionPersistence()?.save?.(previous);}
    catch(error){console.warn('Vision previous conversation save',error);}
  }
  state.currentTicket='';
  const c={id:id(),title:'New conversation',createdAt:now(),updatedAt:now(),ticket:'',messages:[]};
  state.chats.unshift(c);state.chats=state.chats.slice(0,20);state.chatId=c.id;
  saveChats();renderHistory();renderThread();renderOrder();closeDrawers();
  const prompt=$('visionPrompt');if(prompt){prompt.value='';grow(prompt);prompt.blur();}
}
function openChat(chatId){
  const c=state.chats.find(x=>x.id===chatId);if(!c)return;
  state.chatId=chatId;state.currentTicket=c.ticket||'';renderHistory();renderThread();renderOrder();closeDrawers();
}
function addMessage(role,text='',html=''){
  const c=ensureChat();c.messages.push({id:id(),role,text:String(text),html:String(html),at:now()});
  c.updatedAt=now();c.ticket=state.currentTicket||c.ticket||'';saveChats();renderHistory();
}
function titleFrom(text){
  const c=ensureChat();if(c.title!=='New conversation')return;
  const clean=String(text||'').replace(/\s+/g,' ').trim();c.title=clean.length>42?clean.slice(0,39)+'...':clean;saveChats();
}
function plainHtml(html){
  if(!html)return'';
  const node=document.createElement('div');node.innerHTML=String(html);
  return String(node.textContent||node.innerText||'').replace(/\s+/g,' ').trim();
}
function agentHistory(currentText=''){
  const rows=(chat()?.messages||[]).slice(-12).map(m=>({
    role:m.role,
    content:m.role==='assistant'?plainHtml(m.html||m.text):String(m.text||'').trim()
  })).filter(m=>m.content);
  if(rows.length&&rows[rows.length-1].role==='user'&&rows[rows.length-1].content===String(currentText||'').trim())rows.pop();
  return rows.slice(-10);
}
async function checkAgentStatus(){
  if(!db)return null;
  try{
    const result=await db.functions.invoke('onsite-vision-agent',{body:{mode:'status'}});
    if(result.error||!result.data?.ok){
      state.agentStatus='unknown';
      if($('visionLiveStatus')){$('visionLiveStatus').textContent='DATA LIVE';$('visionLiveStatus').title='Tech Check data is live. Server AI status could not be confirmed.';}
      return null;
    }
    state.agentStatus=result.data.model_configured?'online':'unavailable';
    if($('visionLiveStatus')){
      $('visionLiveStatus').textContent=result.data.model_configured?'AI LIVE':'DATA LIVE';
      $('visionLiveStatus').title=result.data.model_configured
        ?'OnSite Vision server AI '+String(result.data.model||'')+' is connected to live Tech Check data.'
        :'Live Tech Check data is connected. The server AI model credential is not configured, so Vision is using deterministic fallback behavior.';
    }
    return result.data;
  }catch(error){
    state.agentStatus='unknown';
    if($('visionLiveStatus')){$('visionLiveStatus').textContent='DATA LIVE';$('visionLiveStatus').title='Tech Check data is live. Server AI status could not be confirmed.';}
    return null;
  }
}
async function callVisionAgent(text){
  if(state.agentStatus==='unavailable'||!db)return null;
  try{
    const result=await db.functions.invoke('onsite-vision-agent',{body:{
      message:String(text||'').trim(),
      active_ticket:state.currentTicket||'',
      history:agentHistory(text)
    }});
    if(result.error||!result.data?.ok){
      const code=result.data?.code||'';
      if(code==='OPENAI_API_KEY_MISSING')state.agentStatus='unavailable';
      return null;
    }
    state.agentStatus='online';
    return result.data;
  }catch(error){
    console.warn('OnSite Vision server agent fallback',error);
    return null;
  }
}
function agentFactsHtml(facts=[]){
  if(!Array.isArray(facts)||!facts.length)return'';
  return '<div class="vision-agent-facts">'+facts.slice(0,8).map(f=>'<div><small>'+esc(f.certainty||'')+'</small><span>'+esc(f.statement||'')+'</span></div>').join('')+'</div>';
}
function agentProposalHtml(p){
  if(!p||p.type==='none')return'';
  return '<div class="vision-action-card"><small>PROPOSED ACTION</small><b>'+esc(p.summary||String(p.type||'').replaceAll('_',' '))+'</b><p>Vision has not changed Tech Check yet.</p></div>';
}
function knowledgeValue(id){return String($(id)?.value||'').trim();}
function resetKnowledgeForm(){
  state.knowledgeEditingId='';
  if($('visionKnowledgeEntryId'))$('visionKnowledgeEntryId').value='';
  if($('visionKnowledgeEntryTitle'))$('visionKnowledgeEntryTitle').value='';
  if($('visionKnowledgeDomain'))$('visionKnowledgeDomain').value='technical';
  if($('visionKnowledgeEquipment'))$('visionKnowledgeEquipment').value='';
  if($('visionKnowledgeWorkflow'))$('visionKnowledgeWorkflow').value='';
  if($('visionKnowledgeTopic'))$('visionKnowledgeTopic').value='';
  if($('visionKnowledgeContent'))$('visionKnowledgeContent').value='';
  if($('visionKnowledgeSourceKind'))$('visionKnowledgeSourceKind').value='owner';
  if($('visionKnowledgeSourceRef'))$('visionKnowledgeSourceRef').value='';
  if($('visionKnowledgeTags'))$('visionKnowledgeTags').value='';
  if($('visionKnowledgeEditorTitle'))$('visionKnowledgeEditorTitle').textContent='New knowledge';
  $('visionKnowledgeRetire')?.classList.add('hidden');
  $('visionKnowledgeSaveStatus')?.classList.add('hidden');
  renderKnowledgeList();
}
function fillKnowledgeForm(entry){
  if(!entry)return resetKnowledgeForm();
  state.knowledgeEditingId=String(entry.id||'');
  if($('visionKnowledgeEntryId'))$('visionKnowledgeEntryId').value=state.knowledgeEditingId;
  if($('visionKnowledgeEntryTitle'))$('visionKnowledgeEntryTitle').value=entry.title||'';
  if($('visionKnowledgeDomain'))$('visionKnowledgeDomain').value=entry.domain||'technical';
  if($('visionKnowledgeEquipment'))$('visionKnowledgeEquipment').value=entry.equipment_type||'';
  if($('visionKnowledgeWorkflow'))$('visionKnowledgeWorkflow').value=entry.workflow_type||'';
  if($('visionKnowledgeTopic'))$('visionKnowledgeTopic').value=entry.topic||'';
  if($('visionKnowledgeContent'))$('visionKnowledgeContent').value=entry.content||'';
  if($('visionKnowledgeSourceKind'))$('visionKnowledgeSourceKind').value=entry.source_kind||'owner';
  if($('visionKnowledgeSourceRef'))$('visionKnowledgeSourceRef').value=entry.source_ref||'';
  if($('visionKnowledgeTags'))$('visionKnowledgeTags').value=(entry.tags||[]).join(', ');
  if($('visionKnowledgeEditorTitle'))$('visionKnowledgeEditorTitle').textContent=(entry.status==='approved'?'Approved':'Edit')+' · v'+String(entry.version||1);
  $('visionKnowledgeRetire')?.classList.toggle('hidden',entry.status==='retired');
  $('visionKnowledgeSaveStatus')?.classList.add('hidden');
  renderKnowledgeList();
}
function renderKnowledgeList(){
  const host=$('visionKnowledgeList');if(!host)return;
  if(!state.knowledgeEntries.length){
    host.innerHTML='<div class="vision-system-note">No saved knowledge matches this filter.</div>';
    return;
  }
  host.innerHTML=state.knowledgeEntries.map(entry=>{
    const meta=[entry.domain,entry.equipment_type,entry.workflow_type?'Workflow: '+entry.workflow_type:'','v'+String(entry.version||1)].filter(Boolean);
    return '<button type="button" class="vision-knowledge-item '+(String(entry.id)===state.knowledgeEditingId?'active':'')+'" data-knowledge-id="'+esc(entry.id)+'">'
      +'<span class="vision-knowledge-item-head"><b>'+esc(entry.title)+'</b><span class="vision-knowledge-status '+esc(entry.status)+'">'+esc(String(entry.status||'').toUpperCase())+'</span></span>'
      +'<p>'+esc(entry.content||'')+'</p><span class="vision-knowledge-meta">'+meta.map(x=>'<span>'+esc(x)+'</span>').join('')+'</span></button>';
  }).join('');
}
async function loadKnowledgeEntries(){
  const admin=visionKnowledgeAdmin();if(!admin?.list)return;
  const filter=knowledgeValue('visionKnowledgeFilter');
  const host=$('visionKnowledgeList');if(host)host.innerHTML='<div class="vision-system-note">Loading company knowledge…</div>';
  try{
    state.knowledgeEntries=await admin.list(filter,150);
    renderKnowledgeList();
  }catch(error){
    if(host)host.innerHTML='<div class="vision-direct warn"><b>Knowledge could not load.</b>'+esc(error?.message||'Please try again.')+'</div>';
  }
}
function readKnowledgeForm(status){
  return{
    id:state.knowledgeEditingId||null,
    title:knowledgeValue('visionKnowledgeEntryTitle'),
    domain:knowledgeValue('visionKnowledgeDomain')||'technical',
    equipment_type:knowledgeValue('visionKnowledgeEquipment'),
    workflow_type:knowledgeValue('visionKnowledgeWorkflow'),
    topic:knowledgeValue('visionKnowledgeTopic'),
    content:knowledgeValue('visionKnowledgeContent'),
    status,
    source_kind:knowledgeValue('visionKnowledgeSourceKind')||'owner',
    source_ref:knowledgeValue('visionKnowledgeSourceRef'),
    tags:knowledgeValue('visionKnowledgeTags').split(',').map(x=>x.trim()).filter(Boolean)
  };
}
async function saveKnowledgeEntry(status){
  const admin=visionKnowledgeAdmin();if(!admin?.save)throw new Error('Vision knowledge manager is unavailable.');
  const entry=readKnowledgeForm(status);
  if(!entry.title)throw new Error('Give this knowledge entry a title.');
  if(!entry.content)throw new Error('Tell Vision what it should know.');
  const note=$('visionKnowledgeSaveStatus');
  if(note){note.classList.remove('hidden');note.textContent=status==='approved'?'Approving company knowledge…':'Saving knowledge…';}
  const saved=await admin.save(entry);
  state.knowledgeEditingId=String(saved.id||'');
  if(note)note.textContent=status==='approved'?'Approved. Vision can now use this as company knowledge.':'Draft saved. Vision will not use it as company truth until approved.';
  await loadKnowledgeEntries();
  const current=state.knowledgeEntries.find(x=>String(x.id)===state.knowledgeEditingId)||saved;
  fillKnowledgeForm(current);
  if(note){note.classList.remove('hidden');note.textContent=status==='approved'?'Approved. Vision can now use this as company knowledge.':'Draft saved. Vision will not use it as company truth until approved.';}
}
async function openKnowledgeManager(){
  const modal=$('visionKnowledgeModal');if(!modal)return;
  modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');
  document.body.classList.add('vision-modal-open');
  await loadKnowledgeEntries();
  if(!state.knowledgeEditingId)resetKnowledgeForm();
}
function closeKnowledgeManager(){
  const modal=$('visionKnowledgeModal');if(!modal)return;
  modal.classList.add('hidden');modal.setAttribute('aria-hidden','true');
  document.body.classList.remove('vision-modal-open');
}

function visionActions(){return window.OnSiteVisionActions||null;}
function legacyActionPayload(a,ticket){
  if(!a)return null;
  if(a.kind==='assign-tech')return{type:'assign',ticket_no:String(ticket||''),role:a.role||'',technician_name:a.tech?.full_name||a.tech?.username||'',work_type:'',date:'',time:'',summary:'Assign technician',requires_confirmation:true};
  if(a.kind==='assign-queue')return{type:'assign',ticket_no:String(ticket||''),role:a.role||'',technician_name:'',work_type:'',date:'',time:'',summary:'Assign department queue',requires_confirmation:true};
  if(a.kind==='schedule')return{type:'schedule',ticket_no:String(ticket||''),role:'',technician_name:'',work_type:'',date:a.date||'',time:a.time||'',summary:'Update Tech Check schedule',requires_confirmation:true};
  return null;
}
function auditActionLabel(action){
  const type=String(action?.type||'').toLowerCase();
  if(type==='assign')return'Confirm assignment';
  if(type==='schedule')return'Confirm schedule change';
  if(type==='cancel')return'Confirm cancellation';
  if(type==='owner_approve')return'Confirm Owner approval';
  return'Confirm action';
}
async function auditedActionCard(action,userMessage=''){
  const layer=visionActions();
  if(!layer?.prepare)return agentProposalHtml(action);
  const result=await layer.prepare({
    conversation_id:state.chatId||'',
    action,
    user_message:userMessage||''
  });
  const canonical=result?.canonical_action||action||{};
  if(!result?.executable){
    const reason=result?.validation?.reason||'This action requires the guided Tech Check workflow.';
    return '<div class="vision-action-card blocked"><small>GUIDED WORKFLOW REQUIRED</small><b>'+esc(canonical.type?String(canonical.type).replaceAll('_',' '):'Action not available')+'</b><p>'+esc(reason)+'</p><div class="vision-system-note">Vision recorded the request, but it did not change Tech Check.</div></div>';
  }
  const localId=String(result.action_id||id());
  state.pending.set(localId,{
    kind:'audited',
    auditActionId:String(result.action_id||''),
    ticket:String(canonical.ticket_no||action?.ticket_no||state.currentTicket||''),
    actionType:String(canonical.type||action?.type||''),
    canonical
  });
  const summary=action?.summary||(
    canonical.type==='assign'
      ?('Assign '+(canonical.technician_name||((canonical.role==='it'?'IT':'Service')+' Department'))+' to '+String(canonical.role||'').toUpperCase())
      :canonical.type==='schedule'
        ?('Update schedule'+(canonical.date?' to '+canonical.date:'')+(canonical.time?' at '+canonical.time:''))
        :canonical.type==='cancel'
          ?('Cancel '+String(canonical.role||'').toUpperCase()+' assignment')
          :canonical.type==='owner_approve'
            ?'Final Owner verification'
            :String(canonical.type||'Action').replaceAll('_',' ')
  );
  return '<div class="vision-action-card audited"><small>AUDITED PROPOSED ACTION</small><b>'+esc(summary)+'</b><p>Ticket #'+esc(canonical.ticket_no||'')+' · Nothing changes until you confirm.</p><div class="vision-action-buttons"><button class="vision-confirm" type="button" data-confirm-action="'+esc(localId)+'">'+esc(auditActionLabel(canonical))+'</button><button class="vision-cancel" type="button" data-cancel-action="'+esc(localId)+'">Cancel</button></div></div>';
}

async function serverAgentAnswer(raw){
  const result=await callVisionAgent(raw);
  if(!result)return null;

  if(result.active_ticket){
    state.currentTicket=String(result.active_ticket);
    const current=ensureChat();current.ticket=state.currentTicket;saveChats();renderOrder();
  }

  const p={...(result.proposed_action||{type:'none'})};
  if(p.type==='create_job'){
    const seeded=[p.work_type||'',raw].filter(Boolean).join(' ');
    return startDraft(seeded);
  }

  let html='<div class="vision-agent-answer">'+esc(result.answer||'').replace(/\n/g,'<br>')+'</div>'+agentFactsHtml(result.facts||[]);
  const ticket=String(p.ticket_no||result.active_ticket||state.currentTicket||'');
  if(ticket&&!p.ticket_no)p.ticket_no=ticket;

  if(p.type==='assign'){
    let role=String(p.role||'').toLowerCase();
    p.role=role.includes('service')?'service':role.includes('it')?'it':'';
    let techName=String(p.technician_name||'').trim();

    // Owner natural-language override: "assign it to Josh" must bypass a department queue
    // when that name uniquely matches an active technician. The audited confirmation still applies.
    if(!techName){
      const normalizedRaw=String(raw||'').toLowerCase();
      const matches=(state.techs||[]).filter(t=>{
        const names=[t.full_name,t.username].filter(Boolean).map(v=>String(v).trim());
        return names.some(name=>{
          const parts=name.toLowerCase().split(/\s+/).filter(Boolean);
          return normalizedRaw.includes(name.toLowerCase()) || parts.some(part=>part.length>=3&&new RegExp('\\b'+reEsc(part)+'\\b','i').test(raw));
        });
      });
      const unique=[...new Map(matches.map(t=>[String(t.user_id),t])).values()];
      if(unique.length===1){
        const t=unique[0];
        techName=String(t.full_name||t.username||'').trim();
        p.technician_name=techName;
        p.role=String(t.role||p.role||'').toLowerCase();
      }
    }
    if(p.role&&techName&&!findTech(techName,p.role)){
      html+='<div class="vision-direct warn"><b>MISSING INFORMATION</b>I understood the requested technician as '+esc(techName)+', but I could not match that name to an active '+esc(p.role.toUpperCase())+' technician.</div>'+actionCard({kind:'choose-tech',role:p.role},ticket);
      return html;
    }
  }

  if(p.type!=='none'){
    try{html+=await auditedActionCard(p,raw);}
    catch(error){html+='<div class="vision-direct warn"><b>Vision could not prepare that action.</b>'+esc(error?.message||'Please check the request and try again.')+'</div>';}
  }
  return html;
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
  db=await techCheckDb();
  window.OnSiteVisionLiveData?.configure?.(db);
  window.OnSiteVisionActions?.configure?.(db);
  window.OnSiteVisionPersistence?.configure?.(db);
  window.OnSiteVisionKnowledgeAdmin?.configure?.(db);
  loadChats();
  const session=(await db.auth.getSession()).data.session;
  if(!session){location.replace('./');return;}
  state.session=session;
  const profileResult=await db.from('profiles').select('*').eq('user_id',session.user.id).single();
  const p=profileResult.data;
  if(profileResult.error||!p||p.role!=='owner'||p.active===false||p.archived_at){location.replace('./');return;}
  state.profile=p;$('visionOwnerName').textContent=(p.full_name||p.username||'Owner')+' - Owner/Admin';
  await Promise.all([hydratePersistentChats(),loadData()]);
  checkAgentStatus().catch(error=>console.warn('Vision AI status check',error));
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
function sanitizeAssistantHtml(value){
  const template=document.createElement('template');
  template.innerHTML=String(value||'');
  template.content.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form').forEach(node=>node.remove());
  template.content.querySelectorAll('*').forEach(node=>{
    [...node.attributes].forEach(attr=>{
      const name=attr.name.toLowerCase(),val=String(attr.value||'').trim();
      if(name.startsWith('on')||name==='srcdoc'||name==='style')node.removeAttribute(attr.name);
      else if((name==='href'||name==='src'||name==='xlink:href')&&/^(?:javascript|data:text\/html)/i.test(val))node.removeAttribute(attr.name);
    });
    const confirm=node.getAttribute?.('data-confirm-action');
    const cancel=node.getAttribute?.('data-cancel-action');
    if((confirm&&!state.pending.has(confirm))||(cancel&&!state.pending.has(cancel))){
      node.removeAttribute('data-confirm-action');
      node.removeAttribute('data-cancel-action');
      if(node.tagName==='BUTTON'){
        node.disabled=true;
        node.textContent='Expired — ask Vision again';
        node.title='This confirmation belonged to an earlier session. Ask Vision to prepare the action again.';
      }
    }
  });
  return template.innerHTML;
}

function welcome(){
  return '<div class="vision-welcome"><div class="vision-welcome-mark"><img src="./techcheck-eye-192.png?v=1" alt=""></div><div class="vision-kicker">ONSITE VISION</div><h1>Your Tech Check AI workspace.</h1><p>Ask about a job, assign a technician, change the schedule, or work through the next step with Vision. The service order stays in context while you keep talking.</p><div class="vision-quick-grid"><button type="button" data-vision-prompt="What jobs do I have today?">Today\'s jobs</button><button type="button" data-vision-prompt="What jobs do I have Monday?">Monday\'s jobs</button><button type="button" data-vision-prompt="What needs attention right now?">Needs attention</button><button type="button" data-vision-prompt="Show me my active jobs">Active jobs</button><button type="button" data-vision-prompt="Is the system healthy?">System health</button></div></div>';
}
function message(m){
  if(m.role==='user')return '<div class="vision-turn user"><div class="vision-bubble">'+esc(m.text)+'</div></div>';
  return '<div class="vision-turn assistant"><div class="vision-bubble"><div class="vision-assistant-head"><img src="./techcheck-eye-favicon-32.png?v=1" alt=""> ONSITE VISION</div>'+(m.html?sanitizeAssistantHtml(m.html):esc(m.text))+'</div></div>';
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
function visionLiveData(){return window.OnSiteVisionLiveData||null;}
async function liveContext(ticket,force=false){
  const layer=visionLiveData();
  if(!layer?.getJobContext)return null;
  return await layer.getJobContext(String(ticket||''),{force});
}
function liveEngineContext(context){
  const layer=visionLiveData();
  return layer?.forWorkflowEngine?layer.forWorkflowEngine(context):context;
}
function liveScheduleText(context){
  const s=context?.summary||{};
  if(!s.scheduled_for)return'Not scheduled';
  const d=dateLabel(s.scheduled_for);
  return s.scheduled_time?d+' · '+String(s.scheduled_time).slice(0,5):d+' · no exact time';
}
function liveEquipmentText(context){
  const items=Array.isArray(context?.items)?context.items:[];
  if(items.length)return items.map(i=>[i.equipment_type,i.unit_tag?('#'+i.unit_tag):'',i.purpose?('· '+i.purpose):''].filter(Boolean).join(' ')).join(', ');
  const manifest=context?.prep?.equipment_manifest||context?.assignments?.[0]?.equipment_manifest||[];
  return Array.isArray(manifest)&&manifest.length?manifest.map(x=>(Number(x.qty||1)+' × '+String(x.label||'Equipment'))).join(', '):'No equipment recorded';
}
function liveJobCard(context){
  if(!context?.found)return'';
  const engine=visionWorkflowEngine(),wc=liveEngineContext(context);
  const step=engine?.getWorkflowNextStep?engine.getWorkflowNextStep(wc):null;
  const summary=context.summary||{},assignments=Array.isArray(context.assignments)?context.assignments:[],open=assignments.filter(a=>!['completed','cancelled'].includes(a.status));
  const rows=(open.length?open:assignments).map(a=>'<div class="vision-assignment-row"><span><b>'+esc(String(a.assigned_role||'').toUpperCase())+'</b> - '+esc(a.assignee_name||((a.assignment_scope==='department')?'Department queue':'Unassigned'))+'</span><span>'+esc(String(a.status||'').toUpperCase())+'</span></div>').join('');
  const registry=Array.isArray(context.unit_registry)?context.unit_registry:[];
  const lifecycle=registry.length?registry.map(u=>esc((u.equipment_type||'Unit')+' '+(u.unit_tag||'')+' · '+String(u.lifecycle_status||'unknown').replaceAll('_',' '))).join('<br>'):'';
  return '<div class="vision-job-card"><div class="vision-job-head"><b>#'+esc(context.ticket_no)+' - '+esc(summary.site||context.prep?.site||'No site')+'</b><span class="vision-pill">'+esc(String(summary.effective_work_type||'service').toUpperCase())+'</span></div>'
    +'<div class="vision-job-meta"><span>'+esc(liveScheduleText(context))+'</span><span>'+esc(liveEquipmentText(context))+'</span><span>LIVE DATABASE</span></div>'
    +'<div class="vision-assignment-list">'+(rows||'<div class="vision-system-note">No active assignment.</div>')+'</div>'
    +(lifecycle?'<div class="vision-system-note">'+lifecycle+'</div>':'')
    +(step?.next?'<div class="vision-next"><b>Next:</b> '+esc(step.next)+'</div>':'')+'</div>';
}
function liveWhoHtml(context){
  const rows=(context?.assignments||[]).filter(a=>!['completed','cancelled'].includes(a.status));
  return rows.length?'<div class="vision-answer-title">Current Tech Check assignment</div><div class="vision-direct good"><b>VERIFIED DATABASE FACT</b>'+rows.map(a=>'<div>'+esc(String(a.assigned_role||'').toUpperCase())+': '+esc(a.assignee_name||((a.assignment_scope==='department')?'Department queue':'Unassigned'))+' · '+esc(String(a.status||'').toUpperCase())+'</div>').join('')+'</div>'+liveJobCard(context)
    :'<div class="vision-direct warn"><b>VERIFIED DATABASE FACT</b>No active IT or Service assignment is showing for MHelpDesk #'+esc(context?.ticket_no||'')+'.</div>'+liveJobCard(context);
}
function liveBlockersHtml(context){
  const engine=visionWorkflowEngine(),wc=liveEngineContext(context);
  const blockers=engine?.getWorkflowBlockers?engine.getWorkflowBlockers(wc):[];
  if(!blockers.length)return '<div class="vision-answer-title">No workflow blocker is showing.</div><div class="vision-direct good"><b>VERIFIED DATABASE FACT</b>The current records do not show a known Tech Check workflow blocker.</div>'+liveJobCard(context);
  return '<div class="vision-answer-title">What is holding this job up</div>'+blockers.map(b=>'<div class="vision-direct warn"><b>'+esc(b.certainty||'VERIFIED DATABASE FACT')+'</b>'+esc(b.message||b.code||'Workflow blocker')+'</div>').join('')+liveJobCard(context);
}
function liveNextHtml(context){
  const engine=visionWorkflowEngine(),wc=liveEngineContext(context);
  const result=engine?.getWorkflowNextStep?engine.getWorkflowNextStep(wc):null;
  return '<div class="vision-answer-title">What should happen next</div><div class="vision-direct"><b>COMPANY WORKFLOW + LIVE DATABASE</b>'+esc(result?.next||'Continue the active Tech Check workflow.')+'</div>'+liveJobCard(context);
}
function liveEquipmentHtml(context){
  const items=Array.isArray(context?.items)?context.items:[],registry=Array.isArray(context?.unit_registry)?context.unit_registry:[];
  if(!items.length)return '<div class="vision-answer-title">Equipment on this job</div><div class="vision-direct warn"><b>MISSING INFORMATION</b>No prepared equipment items are currently recorded for this ticket.</div>'+liveJobCard(context);
  return '<div class="vision-answer-title">Equipment on this job</div>'+items.map(i=>{
    const u=registry.find(x=>String(x.prep_item_id||'')===String(i.id)||String(x.unit_tag||'')===String(i.unit_tag||''));
    return '<div class="vision-direct good"><b>'+esc(i.equipment_type||'Equipment')+' '+esc(i.unit_tag?('#'+i.unit_tag):'')+'</b>'+esc('Purpose: '+String(i.purpose||'—')+' · Lifecycle: '+String(u?.lifecycle_status||'not recorded').replaceAll('_',' '))+'</div>';
  }).join('')+liveJobCard(context);
}
function liveEvidenceHtml(context){
  const handoff=Array.isArray(context?.handoff_evidence)?context.handoff_evidence:[],solar=Array.isArray(context?.service_solar_evidence)?context.service_solar_evidence:[],returns=Array.isArray(context?.returns)?context.returns:[];
  const returnCount=returns.reduce((n,r)=>n+(r.return_photo_paths?.length||0)+(r.intake_photo_paths?.length||0),0);
  const total=handoff.length+solar.length+returnCount;
  if(!total)return '<div class="vision-answer-title">Evidence for this job</div><div class="vision-direct warn"><b>VERIFIED DATABASE FACT</b>No Tech Check photo/signature evidence is currently recorded for this job.</div>';
  const rows=[
    ...handoff.map(e=>({label:(e.stage||'handoff')+' '+(e.kind||'evidence'),who:e.created_by_name,at:e.created_at})),
    ...solar.map(e=>({label:(e.category||'solar')+' '+(e.kind||'evidence'),who:e.created_by_name,at:e.created_at}))
  ];
  return '<div class="vision-answer-title">'+total+' evidence item'+(total===1?'':'s')+' recorded</div><div class="vision-direct good"><b>VERIFIED DATABASE FACT</b>'+rows.map(e=>'<div>'+esc(e.label)+' · '+esc(e.who||'Unknown signer/uploader')+(e.at?' · '+esc(new Date(e.at).toLocaleString()):'')+'</div>').join('')+(returnCount?'<div>'+returnCount+' return/intake photo record'+(returnCount===1?'':'s')+'</div>':'')+'</div>';
}

async function refreshLiveOrderPanel(ticket){
  const context=await liveContext(ticket,false);
  if(String(state.currentTicket||'')!==String(ticket)||!context?.found)return;
  const t=$('visionOrderTitle'),h=$('visionOrderBody');if(!t||!h)return;
  const engine=visionWorkflowEngine(),wc=liveEngineContext(context),step=engine?.getWorkflowNextStep?.(wc),blockers=engine?.getWorkflowBlockers?.(wc)||[];
  const s=context.summary||{},assignments=(context.assignments||[]).filter(a=>!['completed','cancelled'].includes(a.status));
  const list=assignments.map(a=>'<div class="vision-context-row"><b>'+esc(String(a.assigned_role||'').toUpperCase())+' - '+esc(a.assignee_name||((a.assignment_scope==='department')?'Department queue':'Unassigned'))+'</b><span>'+esc(String(a.status||'').toUpperCase())+'</span></div>').join('');
  t.textContent='#'+ticket;
  h.innerHTML='<div class="vision-context-block"><h3>'+esc(s.site||context.prep?.site||'No site')+'</h3><div class="vision-context-grid">'
    +'<div><span>Workflow</span><b>'+esc(String(s.effective_work_type||'service').toUpperCase())+'</b></div>'
    +'<div><span>Schedule</span><b>'+esc(liveScheduleText(context))+'</b></div>'
    +'<div><span>Equipment</span><b>'+esc(liveEquipmentText(context))+'</b></div>'
    +'<div><span>Prep</span><b>'+esc(String(s.prep_status||'Not linked').toUpperCase())+'</b></div></div></div>'
    +'<div class="vision-context-block"><h3>Assignments</h3><div class="vision-context-list">'+(list||'<div class="vision-system-note">No active Service / IT assignment.</div>')+'</div></div>'
    +'<div class="vision-context-block"><h3>What happens next</h3><div class="vision-answer-copy">'+esc(step?.next||'Continue the active Tech Check workflow.')+'</div>'
    +(blockers.length?'<div class="vision-system-note">'+esc(blockers.length+' blocker'+(blockers.length===1?'':'s')+' detected from live context')+'</div>':'')
    +'<div class="vision-order-actions"><button class="primary" type="button" data-order-prompt="Who has this job?">Ask who has it</button><button type="button" data-order-prompt="What is holding this job up?">Show blockers</button><button type="button" data-order-prompt="What still needs to be done on this job?">Show remaining work</button></div></div>';
}

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
  if(svc&&svc.requires_it_handoff&&p?.status!=='released'&&p?.status!=='closed')return 'Service is assigned but must wait for IT to complete the IT → Service handoff.';
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
  if(!a&&!p){t.textContent='#'+ticket;h.innerHTML='<div class="vision-system-note">Loading live Tech Check context…</div>';refreshLiveOrderPanel(ticket).catch(()=>{h.innerHTML='<div class="vision-direct warn"><b>Job not found</b>This ticket is not visible in the current Tech Check records.</div>';});return;}
  t.textContent='#'+ticket;
  const list=(open.length?open:rows).map(r=>'<div class="vision-context-row"><b>'+esc(String(r.assigned_role||'').toUpperCase())+' - '+esc(assignee(r))+'</b><span>'+esc(String(r.status||'').toUpperCase())+(r.requires_it_handoff?' - handoff-gated':'')+'</span></div>').join('');
  h.innerHTML='<div class="vision-context-block"><h3>'+esc(a?.site||p?.site||'No site')+'</h3><div class="vision-context-grid"><div><span>Job</span><b>'+esc(workType(rows,p).toUpperCase())+'</b></div><div><span>Schedule</span><b>'+esc(schedule(a))+'</b></div><div><span>Equipment</span><b>'+esc(units(p,a))+'</b></div><div><span>Prep</span><b>'+esc(String(p?.status||'Not linked').toUpperCase())+'</b></div></div></div><div class="vision-context-block"><h3>Assignments</h3><div class="vision-context-list">'+(list||'<div class="vision-system-note">No active assignments.</div>')+'</div></div><div class="vision-context-block"><h3>What happens next</h3><div class="vision-answer-copy">'+esc(next(ticket))+'</div><div class="vision-order-actions"><button class="primary" type="button" data-order-prompt="Who has this job?">Ask who has it</button><button type="button" data-order-prompt="Assign a Service Tech to this job">Assign Service</button><button type="button" data-order-prompt="What still needs to be done on this job?">Show remaining work</button></div></div>';
  refreshLiveOrderPanel(ticket).catch(()=>{});
}
function ticketFrom(text){
  const raw=String(text||'');
  const direct=raw.match(/\b(?:mhelpdesk|mhelp|ticket|reference|ref)\s*(?:#|number|no\.?)?\s*[:#=-]?\s*(\d{3,})\b/i)||raw.match(/#(\d{3,})\b/);
  if(direct?.[1])return direct[1];
  // Natural speech often puts the number first: "22712 job ticket".
  const reverse=raw.match(/\b(\d{3,})\b(?=[^.\n]{0,28}\b(?:job|ticket|service\s+order|work\s+order)\b)/i);
  if(reverse?.[1])return reverse[1];
  // A single known Tech Check number is enough context for questions such as
  // "What does 22712 look like?" without treating arbitrary years as tickets.
  const numbers=[...raw.matchAll(/\b(\d{3,})\b/g)].map(m=>m[1]);
  if(numbers.length===1){
    const candidate=numbers[0];
    const known=(state.jobs||[]).some(j=>String(j.ticket_no||'')===candidate)||(state.preps||[]).some(p=>String(p.ticket_no||'')===candidate);
    if(known)return candidate;
  }
  return'';
}
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

function workloadIntent(text){
  const raw=String(text||'').trim(),s=raw.toLowerCase();
  const jobCue=/\b(job|jobs|ticket|tickets|work|workload|schedule|scheduled|assignment|assignments|run|runs|route|day)\b/.test(s);
  const askCue=/\b(how many|what(?:'s| is| are)?|show|list|tell me|does|do|has|have|got|working|busy|on deck|lined up|going on)\b/.test(s);
  const role=/\bservice\b/.test(s)?'service':/\bit\b/.test(s)?'it':'';
  const tech=findTech(raw,role)||findTech(raw);
  if(!jobCue||!askCue||(!role&&!tech))return null;
  // A date-free workload question means today in ordinary conversation.
  const date=dateFrom(raw)||dayKey(new Date());
  return{date,role:tech?.role||role,tech};
}
async function workloadHtml(intent){
  if(!intent)return'';
  const subject=intent.tech?(intent.tech.full_name||intent.tech.username||'That technician'):(intent.role==='it'?'IT':'Service');
  const label=dateLabel(intent.date),today=intent.date===dayKey(new Date());
  const layer=visionLiveData();
  if(layer?.getWorkload){
    const live=await layer.getWorkload({
      date:intent.date,
      role:intent.role||'',
      tech_id:intent.tech?.user_id||'',
      tech_name:intent.tech&&!intent.tech?.user_id?(intent.tech.full_name||intent.tech.username||''):''
    },{force:true});
    const tickets=Array.isArray(live?.tickets)?live.tickets:[];
    if(!tickets.length)return '<div class="vision-answer-title">'+esc(subject)+' has 0 Tech Check jobs '+(today?'today':'on '+esc(label))+'.</div><div class="vision-answer-copy">I checked the live Tech Check assignments. MHelpDesk remains separate.</div>';
    if(tickets.length===1){state.currentTicket=tickets[0];const current=ensureChat();current.ticket=tickets[0];saveChats();setTimeout(renderOrder,0);}
    return '<div class="vision-answer-title">'+esc(subject)+' has '+tickets.length+' Tech Check job'+(tickets.length===1?'':'s')+' '+(today?'today':'on '+esc(label))+'.</div>'
      +'<div class="vision-answer-copy">I checked the live Tech Check assignments. MHelpDesk remains separate.</div>'
      +tickets.slice(0,12).map(ticket=>jobCard(ticket)).join('');
  }
  const rows=state.jobs.filter(j=>{
    if(j.status==='completed'||j.status==='cancelled'||String(j.scheduled_for||'')!==String(intent.date))return false;
    if(intent.role&&String(j.assigned_role||'').toLowerCase()!==intent.role)return false;
    if(intent.tech){
      const uid=String(intent.tech.user_id||''),rowUid=String(j.assignee_user_id||j.assigned_to||j.user_id||''),rowName=String(j.assignee_name||j.assigned_to_name||'').trim().toLowerCase();
      const names=[intent.tech.full_name,intent.tech.username].filter(Boolean).map(v=>String(v).trim().toLowerCase());
      if(uid&&rowUid)return rowUid===uid;
      return names.includes(rowName);
    }
    return true;
  });
  const tickets=[...new Set(rows.map(j=>String(j.ticket_no||'')).filter(Boolean))];
  return tickets.length?'<div class="vision-answer-title">'+esc(subject)+' has '+tickets.length+' Tech Check job'+(tickets.length===1?'':'s')+' '+(today?'today':'on '+esc(label))+'.</div><div class="vision-answer-copy">Live-query support was unavailable, so I used the currently loaded Tech Check assignments. MHelpDesk remains separate.</div>'+tickets.slice(0,12).map(jobCard).join(''):'<div class="vision-answer-title">'+esc(subject)+' has 0 Tech Check jobs '+(today?'today':'on '+esc(label))+'.</div>';
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
  const s=String(text||'').toLowerCase().replace(/pick\s*-?\s*up/g,'pickup');
  const type=/\b(delivery|deliver|deployment|deploy|pickup|swap|service)\b/.test(s);
  const object=/\b(ticket|job|work\s*order|assignment)\b/.test(s);
  const action=/\b(create|make|start|prepare|set\s*up|setup|add|open|build|put\s+in|write\s+up|need|want)\b/.test(s);
  const workloadQuestion=/\b(how many|what|which|show|list|does|do|has|have|got)\b[\s\S]{0,35}\b(ticket|job|work|schedule)\b/.test(s);
  return !workloadQuestion&&(
    /\b(create|make|start|prepare|set\s*up|setup|add|open|build|put\s+in|write\s+up)\b[\s\S]{0,55}\b(ticket|job|work\s*order|assignment)\b/.test(s)
    || (type&&object&&action)
    || /\b(?:i\s+)?(?:need|want)\s+(?:to\s+)?(?:do|put\s+in|set\s+up|make)?\s*(?:a|an)?\s*(delivery|pickup|swap|service)\b/.test(s)
  );
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
    {category:'stand',label:'110V Stand',aliases:['110v stand','110 v stand','110 volt stand']},
    {category:'stand',label:'Pole',aliases:['pole','poles']}
  ];
  const rows=[];
  for(const def of defs){
    let source=lower;
    if(def.label==='Spotter')source=source.replace(/solar spotters?/g,'');
    if(def.label==='Pole')source=source.replace(/solar\s+poles?/g,'');
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
  // A natural work-order instruction such as "swap the solar panel" means
  // one replacement panel even when the Owner does not repeat the quantity.
  // Keep this limited to explicit swap/replace/change language so an ordinary
  // mention of a panel does not invent a part requirement.
  if(!parts.solar_panel_qty){
    const swappedPanel=s.match(/\b(?:swap(?:\s+out)?|replace|change)\s+(?:the\s+)?(?:(\d+)\s+)?solar\s+panels?\b/i);
    if(swappedPanel)parts.solar_panel_qty=Number(swappedPanel[1]||1);
  }
  // In a work-order sentence, "swap/replace/change [the] battery" means a
  // replacement battery. Keep generic battery wording out of other contexts
  // so Vision does not invent replacement parts from normal battery mentions.
  if(!parts.battery_replacement_qty){
    const swappedBattery=s.match(/\b(?:swap(?:\s+out)?|replace|change)\s+(?:the\s+)?(?:(\d+)\s+)?batter(?:y|ies)\b/i);
    if(swappedBattery)parts.battery_replacement_qty=Number(swappedBattery[1]||1);
  }
  return parts;
}
function draftPartsText(d){
  const p=d.parts||{},rows=[];
  if(Number(p.solar_panel_qty||0)>0)rows.push(p.solar_panel_qty+' solar panel'+(Number(p.solar_panel_qty)===1?'':'s'));
  if(Number(p.battery_replacement_qty||0)>0)rows.push(p.battery_replacement_qty+' replacement batter'+(Number(p.battery_replacement_qty)===1?'y':'ies'));
  if(Number(p.camera_replacement_qty||0)>0)rows.push(p.camera_replacement_qty+' replacement camera'+(Number(p.camera_replacement_qty)===1?'':'s'));
  if(Number(p.sim_replacement_qty||0)>0)rows.push(p.sim_replacement_qty+' SIM card'+(Number(p.sim_replacement_qty)===1?'':'s'));
  if(Number(p.micro_sd_qty||0)>0)rows.push(p.micro_sd_qty+' micro SD card'+(Number(p.micro_sd_qty)===1?'':'s'));
  if(!d.parts_answered)return rows.length?'Needs confirmation · '+rows.join(', '):'Not answered';
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
function visionWorkflowEngine(){return window.OnSiteVisionWorkflowEngine||null;}
function normalizeDraftState(d={}){
  if(!d||typeof d!=='object')d={};
  if(!Array.isArray(d.equipment_manifest))d.equipment_manifest=[];
  if(!d.parts||typeof d.parts!=='object'||Array.isArray(d.parts))d.parts={};
  if(!d.assignees||typeof d.assignees!=='object'||Array.isArray(d.assignees))d.assignees={};
  d.work_type=String(d.work_type||'');
  d.role=String(d.role||'');
  d.ticket_no=String(d.ticket_no||'');
  d.site=String(d.site||'');
  d.scheduled_for=String(d.scheduled_for||'');
  d.scheduled_time=String(d.scheduled_time||'');
  d.unit_numbers=String(d.unit_numbers||'');
  d.stand_numbers=String(d.stand_numbers||'');
  d.job_description=String(d.job_description||'');
  d.notes=String(d.notes||'');
  d.time_answered=d.time_answered===true||Boolean(d.scheduled_time);
  d.equipment_answered=d.equipment_answered===true||d.equipment_manifest.length>0;
  d.equipment_numbers_answered=d.equipment_numbers_answered===true||Boolean(d.unit_numbers||d.stand_numbers);
  d.parts_answered=d.parts_answered===true;
  d.assignment_answered=d.assignment_answered===true;
  d.notes_answered=d.notes_answered===true;
  d.draft_version=Math.max(2,Number(d.draft_version||0));
  return d;
}
function draftStepKeys(d={}){
  const engine=visionWorkflowEngine();
  if(engine?.getRequiredFields){
    const fields=engine.getRequiredFields(d.work_type,d.equipment_manifest);
    if(Array.isArray(fields)&&fields.length)return fields;
  }
  return ['work_type','ticket_no','site','scheduled_for','scheduled_time','equipment_manifest','equipment_numbers','job_description','parts','assignment','notes'];
}
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
  d=normalizeDraftState(d||{});
  const engine=visionWorkflowEngine();
  if(engine?.getMissingFields){
    const missing=engine.getMissingFields(d||{});
    if(Array.isArray(missing))return missing[0]||'';
  }
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
  const engine=visionWorkflowEngine();
  if(engine?.getNextBestQuestion){
    const q=engine.getNextBestQuestion(d||{});
    if(q?.key===key&&q?.prompt)return q.prompt;
  }
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
  d=normalizeDraftState(d||{});
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
  const unitMatch=expected==='equipment_numbers'
    ? raw.match(/\b(?:unit|units)\s*(?:#s?|numbers?|tags?)?\s*[:=]?\s*([A-Za-z0-9-]+(?:\s*,\s*[A-Za-z0-9-]+)*)/i)
    : raw.match(/\b(?:unit|units)\s*(?:#s?|numbers?|tags?)\s*[:=]?\s*([A-Za-z0-9-]+(?:\s*,\s*[A-Za-z0-9-]+)*)/i);
  if(unitMatch){d.unit_numbers=unitMatch[1].trim();d.equipment_numbers_answered=true;}
  const standMatch=expected==='equipment_numbers'
    ? raw.match(/\b(?:stand|stands|solar\s+stand|solar\s+stands|pole|poles)\s*(?:#s?|numbers?|tags?)?\s*[:=]?\s*([A-Za-z0-9-]+(?:\s*,\s*[A-Za-z0-9-]+)*)/i)
    : raw.match(/\b(?:stand|stands|solar\s+stand|solar\s+stands|pole|poles)\s*(?:#s?|numbers?|tags?)\s*[:=]?\s*([A-Za-z0-9-]+(?:\s*,\s*[A-Za-z0-9-]+)*)/i);
  if(standMatch){d.stand_numbers=standMatch[1].trim();d.equipment_numbers_answered=true;}
  if(expected==='equipment_numbers'&&/\b(no equipment numbers|no numbers|not yet|unknown|skip|none)\b/i.test(raw))d.equipment_numbers_answered=true;
  const descMatch=raw.match(/\bdescription\s*(?:is|:|=)\s*([^;\n]+)/i);
  if(descMatch)d.job_description=String(descMatch[1]||'').trim();
  const parts=draftPartsParse(raw);
  if(Object.keys(parts).length){
    d.parts={...(d.parts||{}),...parts};
    // Parts mentioned while answering an earlier guided question are useful
    // prefill, but they do not silently complete the future Parts step.
    // The Owner still gets Question 9 to confirm/edit those parts.
    const explicitlyAnsweringParts=expected==='parts'||/\bparts?\s*(?:are|is|:|=)\b/i.test(raw);
    if(explicitlyAnsweringParts)d.parts_answered=true;
  }
  if(expected==='parts'&&/\b(yes|correct|confirmed|that'?s all|those are all)\b/i.test(raw)&&Object.keys(d.parts||{}).length)d.parts_answered=true;
  if(expected==='parts'&&/\b(no additional parts|no parts|none|skip)\b/i.test(raw)){d.parts=d.parts||{};d.parts_answered=true;}
  const techs=draftMatchedTechs(raw);
  if(techs.length){d.assignees=d.assignees||{};techs.forEach(t=>{if(t.role==='it'||t.role==='service')d.assignees[t.role]=t.user_id;});if(expected==='assignment'||/\b(assign|task|send|give)\b/i.test(raw))d.assignment_answered=true;}
  if(expected==='assignment'&&/\b(department queues?|queue|leave.*queue|unassigned)\b/i.test(raw)){d.assignees=d.assignees||{};d.assignment_answered=true;}
  const notesMatch=raw.match(/\bnotes?\s*(?:are|is|:|=)\s*([^;\n]+)/i);
  if(notesMatch){d.notes=String(notesMatch[1]||'').trim();d.notes_answered=true;}
  if(expected==='notes'&&/\b(no additional notes|no notes|none|skip)\b/i.test(raw)){d.notes='';d.notes_answered=true;}
  const recognized=Boolean(type||explicitTicket||bareTicket||siteMatch||when||clock||equipment.some(x=>x.qty>0)||unitMatch||standMatch||descMatch||Object.keys(parts).length||techs.length||notesMatch);
  // Guided interview answers belong to the question currently being asked even
  // when the same sentence also mentions recognizable equipment or parts.
  // Example: "Swap the Ranger, solar panel and battery" must satisfy the
  // work-description step instead of getting stuck because parts were parsed.
  if(!initial){
    if(expected==='site'&&!siteMatch)d.site=raw;
    else if(expected==='job_description'&&!descMatch)d.job_description=raw;
    else if(expected==='notes'&&!notesMatch){d.notes=raw;d.notes_answered=true;}
  }
  return d;
}
function draftResponseHtml(d,started=false,transition=null){
  d=normalizeDraftState(d||{});
  const missing=draftMissingKey(d);
  if(missing){
    const keys=draftStepKeys(d),step=Math.max(1,keys.indexOf(missing)+1);
    const advanced=started||transition?.advanced===true;
    const title=started
      ?'I started the work order. I’ll ask you one thing at a time.'
      :advanced
        ?'Got it. Here is the next question.'
        :'I still need this answer before I can move on.';
    // The full draft summary belongs at the start and final review. Appending it
    // after every answer duplicated the same draft card in the conversation.
    return '<div class="vision-answer-title">'+title+'</div>'+(started?draftSummaryHtml(d):'')
      +'<div class="vision-draft-question"><small>QUESTION '+step+' OF '+keys.length+'</small><b>'+esc(draftQuestion(missing,d))+'</b>'+draftChoiceHtml(missing,d)+'</div>'
      +'<div class="vision-system-note">Answer below or tap one of the choices. Vision remembers the answers already in this draft.</div>';
  }
  const actionId=id();state.pending.set(actionId,{kind:'create-job',draft:JSON.parse(JSON.stringify(d))});
  return '<div class="vision-answer-title">The work order is complete and ready for review.</div>'+draftSummaryHtml(d)
    +'<div class="vision-action-card"><small>READY TO CREATE</small><b>Create this '+esc(String(d.work_type).toUpperCase())+' Tech Check job?</b><p>Vision will create the Tech Check workflow shown above. MHelpDesk remains separate.</p><div class="vision-action-buttons"><button class="vision-confirm" type="button" data-confirm-action="'+esc(actionId)+'">Create Tech Check job</button><button class="vision-cancel" type="button" data-cancel-action="'+esc(actionId)+'">Keep editing</button></div></div>';
}
function startDraft(text){
  state.currentTicket='';
  const d={draft_version:2,work_type:'',role:'',ticket_no:'',site:'',scheduled_for:'',scheduled_time:'',time_answered:false,equipment_manifest:[],equipment_answered:false,equipment_numbers_answered:false,unit_numbers:'',stand_numbers:'',job_description:'',parts:{},parts_answered:false,assignees:{},assignment_answered:false,notes:'',notes_answered:false,last_answered_key:'',last_answered_at:''};
  draftApplyInput(d,text,true);
  const current=ensureChat();current.ticket='';current.draft=d;saveChats();renderOrder();
  return draftResponseHtml(d,true);
}
async function continueDraft(text){
  const current=ensureChat();
  if(!current.draft)return'';
  const d=normalizeDraftState(current.draft);
  if(/\b(cancel|never\s+mind|nevermind|discard|stop)\b/i.test(text)){
    current.draft=null;current.updatedAt=now();saveChats();
    if(persistenceReady&&db){
      clearTimeout(conversationSyncTimer);
      try{await visionPersistence()?.save?.(current);}catch(error){console.warn('Vision draft cancel cloud sync',error);queueConversationSync();}
    }
    return '<div class="vision-answer-title">Draft cancelled.</div><div class="vision-answer-copy">No Tech Check job was created.</div>';
  }
  const before=draftMissingKey(d);
  draftApplyInput(d,text,false);
  const after=draftMissingKey(d);
  const advanced=Boolean(before&&after!==before);
  if(advanced){
    d.last_answered_key=before;
    d.last_answered_at=now();
  }
  current.draft=d;
  current.updatedAt=now();
  saveChats();
  // Save accepted wizard state before the next question is rendered. Local
  // storage is already synchronous; this also closes the cloud-sync race.
  if(persistenceReady&&db){
    clearTimeout(conversationSyncTimer);
    try{await visionPersistence()?.save?.(current);}catch(error){console.warn('Vision draft answer cloud sync',error);queueConversationSync();}
  }
  return draftResponseHtml(d,false,{before,after,advanced});
}
async function createDraftJob(d){
  const engine=visionWorkflowEngine();
  if(engine?.validateDraft){
    const check=engine.validateDraft(d||{});
    if(check?.errors?.length)throw new Error(check.errors.join(' '));
    if(check?.missing?.length)throw new Error('The work order is missing required information: '+check.missing.join(', ')+'.');
  }
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
    if(!people.length)return '<div class="vision-direct warn"><b>No active '+esc(a.role==='service'?'Service':'IT')+' technicians are available.</b>You can still ask Vision to assign this job to the department queue.</div>';
    const choices=people.map(t=>{
      const name=t.full_name||t.username||'Technician';
      return '<button type="button" data-vision-prompt="Assign '+esc(name)+' as the '+esc(a.role==='service'?'Service Tech':'IT Technician')+' for this job">'+esc(name)+'</button>';
    }).join('');
    return '<div class="vision-action-card"><small>CHOOSE TECHNICIAN</small><b>Who should take MHelpDesk #'+esc(ticket)+'?</b><p>Select a technician and Vision will prepare the assignment for confirmation.</p><div class="vision-tech-choice-grid">'+choices+'</div></div>';
  }
  const actionId=id();state.pending.set(actionId,{...a,ticket});
  if(a.kind==='assign-tech')return '<div class="vision-action-card"><small>PROPOSED CHANGE</small><b>Assign '+esc(a.tech.full_name||a.tech.username)+' as '+esc(a.role==='service'?'Service Tech':'IT Technician')+'</b><p>Ticket #'+esc(ticket)+' will be assigned directly in Tech Check. MHelpDesk will not be changed.</p><div class="vision-action-buttons"><button class="vision-confirm" type="button" data-confirm-action="'+esc(actionId)+'">Confirm assignment</button><button class="vision-cancel" type="button" data-cancel-action="'+esc(actionId)+'">Cancel</button></div></div>';
  if(a.kind==='assign-queue')return '<div class="vision-action-card"><small>PROPOSED CHANGE</small><b>Assign ticket #'+esc(ticket)+' to the '+esc(a.role==='service'?'Service':'IT')+' department queue</b><p>A technician in that department can claim it using the exact MHelpDesk ticket number.</p><div class="vision-action-buttons"><button class="vision-confirm" type="button" data-confirm-action="'+esc(actionId)+'">Confirm department assignment</button><button class="vision-cancel" type="button" data-cancel-action="'+esc(actionId)+'">Cancel</button></div></div>';
  const label=[a.date?dateLabel(a.date):'',a.time||''].filter(Boolean).join(' - ');
  return '<div class="vision-action-card"><small>PROPOSED CHANGE</small><b>Update the Tech Check schedule</b><p>Ticket #'+esc(ticket)+' -> '+esc(label)+'</p><div class="vision-action-buttons"><button class="vision-confirm" type="button" data-confirm-action="'+esc(actionId)+'">Confirm schedule change</button><button class="vision-cancel" type="button" data-cancel-action="'+esc(actionId)+'">Cancel</button></div></div>';
}
function who(ticket){
  const rows=active(ticket);return rows.length?'<div class="vision-direct good"><b>Here is who currently has MHelpDesk #'+esc(ticket)+'.</b>'+rows.map(r=>'<div>'+esc(String(r.assigned_role||'').toUpperCase())+': '+esc(assignee(r))+'</div>').join('')+'</div>'+jobCard(ticket):'<div class="vision-direct warn"><b>No active assignment is showing.</b>MHelpDesk #'+esc(ticket)+' has no active IT or Service assignment in Tech Check.</div>';
}
function systemHealthIntent(raw){
  const s=String(raw||'').trim().toLowerCase();
  return /\bhealth\s*check\b|\b(system|database|data|vision|ai)\s+(health|healthy|integrity)\b|\bis\s+(?:the\s+)?(system|database|data|vision|ai)\s+healthy\b|\bcheck\s+(?:the\s+)?(system|database|data|vision|ai)\b/.test(s);
}
function healthRows(items,key='ticket_no'){
  if(!Array.isArray(items)||!items.length)return'';
  return '<div class="vision-system-note">'+items.slice(0,8).map(x=>{
    if(typeof x==='string')return esc(x);
    const main=x?.[key]||x?.name||x?.unit_tag||x?.equipment_type||'Item';
    const detail=Object.entries(x||{}).filter(([k,v])=>k!==key&&k!=='name'&&v!==null&&v!==''&&v!==false).slice(0,3).map(([k,v])=>String(k).replaceAll('_',' ')+': '+String(v)).join(' · ');
    return '<b>'+esc(main)+'</b>'+(detail?' — '+esc(detail):'');
  }).join('<br>')+'</div>';
}
async function systemHealthHtml(){
  const [healthResult,agentResult]=await Promise.all([
    db.rpc('get_owner_system_health_v1'),
    db.functions.invoke('onsite-vision-agent',{body:{mode:'status'}}).catch(()=>({data:null,error:true}))
  ]);
  if(healthResult.error)throw healthResult.error;
  const h=healthResult.data||{};
  const integrity=h.integrity||{},workflow=h.workflow||{},people=h.people||{},vision=h.vision||{},security=h.security||{},database=h.database||{};
  const status=String(h.status||'unknown').toLowerCase();
  const good=status==='healthy'&&Number(h.hard_error_count||0)===0;
  const agent=agentResult?.data||{};
  const criticalGroups=[
    ...(integrity.closed_with_active_assignment||[]),
    ...(integrity.inactive_assignee_on_active_job||[]),
    ...(integrity.released_camera_family_rule_violations||[]),
    ...(integrity.closed_ranger_without_field_victron||[]),
    ...(integrity.closed_swap_missing_return||[]),
    ...(integrity.unit_registry_mismatches||[])
  ];
  let html='<div class="vision-answer-title">'+(good?'System health: HEALTHY':'System health: NEEDS ATTENTION')+'</div>';
  html+='<div class="vision-direct '+(good?'good':'warn')+'"><b>'+esc(String(h.health_version||'Live health check'))+'</b>'+
    (good?'No critical Tech Check data-integrity failures are showing.':'Critical data-integrity issues are present and should be reviewed.')+'</div>';
  html+='<div class="vision-context-block"><h3>Live health summary</h3><div class="vision-context-grid">'+
    '<div><span>HARD ERRORS</span><b>'+esc(h.hard_error_count||0)+'</b></div>'+
    '<div><span>REVIEW ITEMS</span><b>'+esc(h.attention_count||0)+'</b></div>'+
    '<div><span>ANON PRIVILEGED RPCs</span><b>'+esc(security.anonymous_security_definer_functions||0)+'</b></div>'+
    '<div><span>DB MIGRATIONS</span><b>'+esc(database.migration_count||0)+'</b></div>'+
    '<div><span>EDGE AI</span><b>'+esc(agent.ok?((agent.agent_version||'online')+' · '+(agent.model_configured?'AI LIVE':'DATA LIVE')):'Unavailable')+'</b></div>'+
    '<div><span>ACTIVE TICKETS</span><b>'+esc(workflow.active_tickets||0)+'</b></div>'+
  '</div></div>';
  if(criticalGroups.length)html+='<div class="vision-context-block"><h3>Critical integrity issues</h3>'+healthRows(criticalGroups)+'</div>';
  if((workflow.released_without_service||[]).length)html+='<div class="vision-context-block"><h3>Workflow attention</h3><p>IT handoffs waiting for Service assignment.</p>'+healthRows(workflow.released_without_service)+'</div>';
  if((people.duplicate_active_names||[]).length||(people.duplicate_names_all_profiles||[]).length){
    html+='<div class="vision-context-block"><h3>Profile ambiguity</h3><p>Duplicate names are shown as attention items so Vision does not guess which account is intended.</p>'+healthRows(people.duplicate_active_names,'name')+healthRows(people.duplicate_names_all_profiles,'name')+'</div>';
  }
  html+='<div class="vision-context-block"><h3>Vision data</h3><div class="vision-context-grid">'+
    '<div><span>CONVERSATIONS</span><b>'+esc(vision.active_conversations||0)+'</b></div>'+
    '<div><span>MESSAGES</span><b>'+esc(vision.messages||0)+'</b></div>'+
    '<div><span>AUDITED ACTIONS</span><b>'+esc(vision.audited_actions||0)+'</b></div>'+
    '<div><span>FAILED ACTIONS</span><b>'+esc(vision.failed_actions||0)+'</b></div>'+
    '<div><span>MANAGED APPROVALS</span><b>'+esc(vision.approved_knowledge_entries||0)+'</b></div>'+
    '<div><span>MANAGED DRAFTS</span><b>'+esc(vision.draft_knowledge_entries||0)+'</b></div>'+
  '</div></div>';
  const coverage=agent.knowledge_coverage||{};
  html+='<div class="vision-context-block"><h3>AI operating layer</h3><div class="vision-context-grid">'+
    '<div><span>KNOWLEDGE BASELINE</span><b>'+esc(agent.knowledge_version||'unknown')+'</b></div>'+
    '<div><span>SHARED RULES</span><b>'+esc(agent.shared_rules_version||'unknown')+'</b></div>'+
    '<div><span>WORKFLOW ENGINE</span><b>'+esc(agent.workflow_engine_version||'unknown')+'</b></div>'+
    '<div><span>AGENT VERSION</span><b>'+esc(agent.agent_version||'unknown')+'</b></div>'+
    '<div><span>EQUIPMENT DEFINITIONS</span><b>'+esc(coverage.equipment_total??'unknown')+'</b></div>'+
    '<div><span>KNOWN GAP PRODUCTS</span><b>'+esc(coverage.known_gap_product_count??'unknown')+'</b></div>'+
  '</div>'+
  (Array.isArray(coverage.known_gap_products)&&coverage.known_gap_products.length?'<div class="vision-system-note"><b>Known documentation gaps:</b> '+coverage.known_gap_products.map(esc).join(', ')+'. Vision is required to return MISSING INFORMATION rather than invent these procedures.</div>':'')+
  '</div>';
  html+='<div class="vision-system-note">Generated from the live Tech Check database. Managed knowledge counts are extra Owner-approved entries; the verified Company Knowledge baseline is shown separately above. Normal workflow review items are separated from hard integrity failures.</div>';
  return html;
}

function personLookupName(raw){
  const text=String(raw||'').trim();
  // Ticket/unit questions must never be consumed by the people-profile intent.
  if(/\b(assigned|assignment|handling|has\s+it|has\s+this|service\s+order|ticket)\b/i.test(text)||/\b\d{3,}\b/.test(text))return'';
  const match=text.match(/^(?:who(?:'s|\s+is)|tell\s+me\s+about|what\s+does)\s+(.+?)(?:\s+do)?[?.!]*$/i);
  return match?String(match[1]||'').replace(/\b(?:at|for)\s+cameras\s+on\s+site\b.*$/i,'').trim():'';
}
function personRoleLabel(role){
  if(role==='owner')return'Owner/Admin';
  if(role==='it')return'IT Technician';
  if(role==='service')return'Service Technician';
  return String(role||'Company profile');
}
async function personLookupHtml(raw){
  const wanted=personLookupName(raw);if(!wanted)return'';
  const result=await db.from('profiles').select('user_id,full_name,username,role,active,archived_at').order('full_name').limit(250);
  if(result.error)throw result.error;
  const terms=wanted.toLowerCase().split(/\s+/).filter(Boolean);
  const matches=(result.data||[]).filter(p=>{
    const hay=(String(p.full_name||'')+' '+String(p.username||'')).toLowerCase();
    return terms.every(t=>hay.includes(t));
  }).slice(0,12);
  if(!matches.length)return '<div class="vision-answer-title">I could not find '+esc(wanted)+' in Tech Check.</div><div class="vision-answer-copy">No Owner, IT, or Service profile matched that name in the live profile records.</div>';
  const exact=matches.filter(p=>String(p.full_name||'').trim().toLowerCase()===wanted.toLowerCase());
  const rows=exact.length?exact:matches;
  const activeJobsFor=p=>state.jobs.filter(j=>j.status!=='completed'&&(String(j.assignee_user_id||'')===String(p.user_id||'')||String(j.assignee_name||'').trim().toLowerCase()===String(p.full_name||'').trim().toLowerCase()));
  const cards=rows.map(p=>{
    const activeState=p.archived_at?'Archived':p.active===false?'Inactive':'Active';
    const jobs=activeJobsFor(p);
    return '<div class="vision-context-block"><h3>'+esc(p.full_name||p.username||wanted)+'</h3><div class="vision-context-grid"><div><span>ROLE</span><b>'+esc(personRoleLabel(p.role))+'</b></div><div><span>PROFILE</span><b>'+esc(activeState)+'</b></div></div>'+(p.username?'<div class="vision-system-note">Username: '+esc(p.username)+'</div>':'')+(jobs.length?'<div class="vision-system-note">Current Tech Check work: '+jobs.slice(0,4).map(j=>'#'+esc(j.ticket_no||'—')+' · '+esc(j.site||'No site')).join(' · ')+'</div>':'')+'</div>';
  }).join('');
  const note=rows.length>1?'<div class="vision-answer-copy">I found '+rows.length+' profile records with that name, so I am showing each one instead of guessing which account you meant.</div>':'<div class="vision-answer-copy">This is from the live Tech Check profile record.</div>';
  return '<div class="vision-answer-title">'+esc(rows[0].full_name||wanted)+'</div>'+note+cards;
}

function historyCue(raw){
  return /\b(history|historical|previous|previously|past|before|last\s+worked|worked\s+on|problems?|issues?|repairs?|damage|what\s+happened)\b/i.test(String(raw||''));
}
function knownSiteFromText(raw){
  const text=String(raw||'').toLowerCase();
  const sites=[...new Set([
    ...(state.jobs||[]).map(x=>String(x.site||'').trim()),
    ...(state.preps||[]).map(x=>String(x.site||'').trim())
  ].filter(Boolean))].sort((a,b)=>b.length-a.length);
  return sites.find(site=>text.includes(site.toLowerCase()))||'';
}
function historyIntent(raw){
  const text=String(raw||'').trim();
  if(!historyCue(text))return null;
  const unit=unitHint(text);
  if(unit)return{kind:'unit',value:unit.type+' '+unit.tag,unit};
  if(/\b(?:this|that)\s+unit\b/i.test(text)&&state.currentUnitReference){
    return{kind:'unit',value:String(state.currentUnitReference)};
  }
  const tech=findTech(text);
  if(tech&&/\b(tech|technician|worked|history|previous|past)\b/i.test(text)){
    return{kind:'technician',value:tech.user_id||tech.full_name||tech.username,tech};
  }
  const knownSite=knownSiteFromText(text);
  if(knownSite)return{kind:'site',value:knownSite};
  const siteMatch=
    text.match(/\b(?:site|customer)\s+(?:history|problems?|issues?)\s*(?:for|at|of)?\s*[:=-]?\s*(.+?)[?.!]*$/i)||
    text.match(/\b(?:history|problems?|issues?)\s+(?:for|at|of)\s+(.+?)[?.!]*$/i)||
    text.match(/\bwhat\s+(?:problems?|issues)\s+has\s+(.+?)\s+had[?.!]*$/i)||
    text.match(/\bwhat\s+happened\s+at\s+(.+?)[?.!]*$/i);
  if(siteMatch?.[1])return{kind:'site',value:String(siteMatch[1]).trim()};
  return null;
}
function historyDate(value){
  if(!value)return'';
  const d=new Date(value);
  return Number.isNaN(d.getTime())?String(value):d.toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
}
function historyEventHtml(event){
  const e=event||{},meta=[
    e.ticket_no?'MHelpDesk #'+e.ticket_no:'',
    e.site||'',
    e.unit_tag?'Unit '+e.unit_tag:'',
    historyDate(e.event_at)
  ].filter(Boolean);
  return '<div class="vision-context-row"><b>'+esc(e.actor_name||String(e.event_type||'History event').replaceAll('_',' '))+'</b>'
    +'<span>'+esc(e.detail||String(e.event_type||'record').replaceAll('_',' '))+'</span>'
    +(meta.length?'<span>'+meta.map(esc).join(' · ')+'</span>':'')+'</div>';
}
async function companyHistoryHtml(raw){
  const intent=historyIntent(raw);
  if(!intent)return'';
  const layer=visionLiveData();
  if(!layer?.getCompanyHistory)return '<div class="vision-direct warn"><b>Company History is updating.</b>Refresh OnSite Vision and try that history question again.</div>';
  const result=await layer.getCompanyHistory(intent.kind,intent.value,{limit:100});
  if(!result?.found){
    return '<div class="vision-answer-title">No permanent '+esc(intent.kind)+' history found.</div>'
      +'<div class="vision-answer-copy">I checked the Company History read model for '+esc(intent.value)+'. No matching Tech Check history is recorded yet.</div>';
  }
  const events=Array.isArray(result.events)?result.events:[];
  const subject=result.subject||{};
  const title=intent.kind==='technician'
    ?(subject.full_name||subject.username||intent.tech?.full_name||intent.value)
    :intent.kind==='unit'
      ?(subject.unit_tag?((subject.equipment_type||'Unit')+' '+subject.unit_tag):intent.value)
      :(subject.site||intent.value);
  if(intent.kind==='unit'&&/\bwho\s+(?:last|previously)?\s*worked|\bwho\s+worked\s+on/i.test(raw)){
    const workEvent=events.find(e=>e?.actor_name&&['it_verification','service_return','it_intake','unit_work','job_assignment'].includes(String(e.event_type||'')))
      ||events.find(e=>e?.actor_name);
    if(workEvent){
      return '<div class="vision-answer-title">'+esc(workEvent.actor_name)+' is the latest recorded person on '+esc(title)+'.</div>'
        +'<div class="vision-answer-copy">'+esc(workEvent.detail||'Recorded company-history event')+(workEvent.ticket_no?' · MHelpDesk #'+esc(workEvent.ticket_no):'')+(workEvent.event_at?' · '+esc(historyDate(workEvent.event_at)):'')+'</div>'
        +'<div class="vision-context-block"><h3>Recent unit history</h3><div class="vision-context-list">'+events.slice(0,8).map(historyEventHtml).join('')+'</div></div>';
    }
  }
  const kindLabel=intent.kind==='technician'?'Technician History':intent.kind==='unit'?'Unit History':'Customer / Site History';
  return '<div class="vision-answer-title">'+esc(kindLabel)+' · '+esc(title)+'</div>'
    +'<div class="vision-answer-copy">'+esc(String(result.event_count??events.length))+' permanent history event'+((Number(result.event_count??events.length)===1)?'':'s')+' found. Closed jobs and returned equipment remain in this history.</div>'
    +(events.length?'<div class="vision-context-block"><h3>Most recent activity</h3><div class="vision-context-list">'+events.slice(0,12).map(historyEventHtml).join('')+'</div></div>':'<div class="vision-system-note">The subject exists, but there are no dated history events yet.</div>');
}

function offlineEscalationIntent(raw){
  const text=String(raw||'').trim(),lower=text.toLowerCase();
  const offlineCue=/\boffline\b/.test(lower);
  const waitingIt=/\b(waiting\s+(?:for|on)\s+it|cases?\s+(?:waiting|need(?:ing)?)\s+(?:for\s+)?it)\b/i.test(text);
  const ownerDecision=/\b(owner\s+decision|need(?:s|ing)?\s+(?:my|the\s+owner'?s?)\s+decision|cases?\s+(?:for|needing)\s+owner)\b/i.test(text);
  const troubleshooting=/\b(?:already\s+(?:tried|attempted|checked|done)|what\s+troubleshooting\s+(?:has|have)\s+(?:already\s+)?been\s+(?:attempted|tried|done|recorded)|what\s+(?:has|have|did)\s+.*(?:tried|attempted|checked|done)|troubleshooting\b.*\b(?:already|attempted|tried|done|recorded))\b/i.test(text);
  const backup=/\b(backup\s+swap|swap\s+authorized|backup\s+authorized|authorized\s+backup)\b/i.test(text);
  const intake=/\b(failed\s+unit.*(?:it\s+intake|intake)|(?:reach|reached|enter|entered|make\s+it\s+to).*it\s+intake|it\s+intake.*failed\s+unit)\b/i.test(text);
  if(!offlineCue&&!waitingIt&&!ownerDecision&&!backup&&!intake&&!(troubleshooting&&(/\bunit\b/i.test(text)||state.currentTicket)))return null;

  const unit=unitHint(text);
  const explicitTicket=ticketFrom(text);
  const contextualTicket=!explicitTicket&&state.currentTicket&&/\b(this|that|it|case|unit|job|ticket|escalation|problem|swap|intake)\b/i.test(text)
    ?String(state.currentTicket):'';
  const ticket=explicitTicket||contextualTicket||'';
  const unitReference=unit?(unit.type+' '+unit.tag):'';
  let scope='active';
  let detail='';
  if(waitingIt)scope='waiting_it';
  else if(ownerDecision)scope='owner_decision';
  else if(troubleshooting||backup||intake)scope='all';
  if(troubleshooting)detail='troubleshooting';
  else if(backup)detail='backup';
  else if(intake)detail='intake';
  return{scope,detail,unitReference,ticket};
}
function offlineEscalationStatus(value){
  return String(value||'MISSING INFORMATION').replaceAll('_',' ').toUpperCase();
}
function offlineEscalationCard(row){
  const r=row||{};
  const meta=[
    r.ticket_no?'MHelpDesk #'+r.ticket_no:'',
    r.site||'',
    r.updated_at?historyDate(r.updated_at):''
  ].filter(Boolean);
  const people=[
    r.service_tech_name?'Service: '+r.service_tech_name:'',
    r.it_tech_name?'IT: '+r.it_tech_name:''
  ].filter(Boolean);
  return '<div class="vision-context-block"><h3>'+esc((r.equipment_type||'Unit')+' '+(r.unit_tag||'MISSING INFORMATION'))+'</h3>'
    +'<div class="vision-context-grid"><div><span>STATUS</span><b>'+esc(offlineEscalationStatus(r.status))+'</b></div><div><span>POWER VERIFIED</span><b>'+esc(r.service_power_verified===true?'YES':'MISSING INFORMATION')+'</b></div></div>'
    +(meta.length?'<div class="vision-system-note">'+meta.map(esc).join(' · ')+'</div>':'')
    +(people.length?'<div class="vision-system-note">'+people.map(esc).join(' · ')+'</div>':'')
    +'</div>';
}
async function offlineEscalationHtml(raw){
  const intent=offlineEscalationIntent(raw);
  if(!intent)return'';
  const layer=visionLiveData();
  if(!layer?.getOfflineEscalations)return '<div class="vision-direct warn"><b>Offline escalation data is updating.</b>Refresh OnSite Vision and try again.</div>';
  const result=await layer.getOfflineEscalations({
    scope:intent.scope,
    unit_reference:intent.unitReference,
    ticket_no:intent.ticket
  },{force:true,limit:100});
  const rows=Array.isArray(result?.rows)?result.rows:[];
  if(rows.length===1){
    const remembered=rows[0]||{};
    if(remembered.unit_tag)state.currentUnitReference=[remembered.equipment_type,remembered.unit_tag].filter(Boolean).join(' ');
    if(remembered.ticket_no){
      state.currentTicket=String(remembered.ticket_no);
      const current=ensureChat();
      current.ticket=state.currentTicket;
      saveChats();
      renderOrder();
    }
  }

  if(!rows.length){
    let title='No unresolved offline-unit escalations are recorded right now.';
    if(intent.scope==='waiting_it')title='No offline-unit cases are currently waiting for IT.';
    else if(intent.scope==='owner_decision')title='No offline-unit cases currently need an Owner decision.';
    else if(intent.detail||intent.unitReference||intent.ticket)title='No matching offline-unit escalation is recorded.';
    return '<div class="vision-answer-title">'+esc(title)+'</div>'
      +(intent.detail?'<div class="vision-direct warn"><b>MISSING INFORMATION</b>The requested escalation detail was not recorded in a matching Tech Check offline-unit case.</div>':'')
      +'<div class="vision-answer-copy">MHelpDesk remains separate; this answer uses Tech Check records only.</div>';
  }

  if(intent.detail){
    const r=rows[0]||{};
    let detailHtml='';
    if(intent.detail==='troubleshooting'){
      detailHtml='<div class="vision-answer-title">Troubleshooting already recorded</div>'
        +'<div class="vision-context-block"><h3>'+esc((r.equipment_type||'Unit')+' '+(r.unit_tag||'MISSING INFORMATION'))+'</h3><div class="vision-context-list">'
        +'<div class="vision-context-row"><b>Original problem</b><span>'+esc(r.original_problem||'MISSING INFORMATION')+'</span></div>'
        +'<div class="vision-context-row"><b>Service power verification</b><span>'+esc(r.service_power_verified===true?'Verified':'MISSING INFORMATION')+'</span></div>'
        +'<div class="vision-context-row"><b>Service troubleshooting</b><span>'+esc(r.service_troubleshooting_notes||'MISSING INFORMATION')+'</span></div>'
        +'<div class="vision-context-row"><b>IT troubleshooting</b><span>'+esc(r.it_troubleshooting_notes||'MISSING INFORMATION')+'</span></div>'
        +'</div></div>';
    }else if(intent.detail==='backup'){
      const authorized=Boolean(r.backup_authorized_at||r.backup_unit_tag);
      detailHtml='<div class="vision-answer-title">'+(authorized?'A backup swap was authorized.':'No backup swap authorization is recorded on this case.')+'</div>'
        +'<div class="vision-direct '+(authorized?'good':'warn')+'"><b>VERIFIED DATABASE FACT</b>'
        +(authorized
          ?'Authorized backup: '+esc(r.backup_equipment_type||'MISSING INFORMATION')+' '+esc(r.backup_unit_tag||'MISSING INFORMATION')+(r.backup_authorized_at?' · '+esc(historyDate(r.backup_authorized_at)):'')
          :'The current escalation record has no backup authorization timestamp or backup unit recorded.')
        +'</div>';
    }else if(intent.detail==='intake'){
      const arrived=Boolean(r.failed_return_id)||r.status==='failed_unit_in_it_intake';
      detailHtml='<div class="vision-answer-title">'+(arrived?'Yes — the failed unit reached IT Intake.':'No linked failed-unit IT Intake return is recorded yet.')+'</div>'
        +'<div class="vision-direct '+(arrived?'good':'warn')+'"><b>VERIFIED DATABASE FACT</b>'
        +(arrived
          ?'Tech Check records the failed unit in Service Return → IT Intake.'
          :'The offline escalation does not yet have a linked failed-unit return in IT Intake.')
        +'</div>';
    }
    return detailHtml+offlineEscalationCard(r)
      +'<div class="vision-answer-copy">MHelpDesk remains separate; no MHelpDesk record was changed.</div>';
  }

  const title=intent.scope==='waiting_it'
    ?rows.length+' offline case'+(rows.length===1?'':'s')+' waiting for IT'
    :intent.scope==='owner_decision'
      ?rows.length+' offline case'+(rows.length===1?'':'s')+' needing an Owner decision'
      :rows.length+' unresolved offline unit'+(rows.length===1?'':'s');
  return '<div class="vision-answer-title">'+esc(title)+'</div>'
    +'<div class="vision-answer-copy">These are live Tech Check offline-unit escalation records. MHelpDesk remains separate.</div>'
    +rows.slice(0,20).map(offlineEscalationCard).join('');
}


function damageHoldIntent(raw){
  const text=String(raw||'').trim(),lower=text.toLowerCase();
  const needsReplacement=/\b(needs?\s+replacement|need(?:s|ing)?\s+to\s+be\s+replaced|replacement\s+hold|damaged\s+equipment)\b/i.test(text);
  const damageDetail=/\b(what\s+damage|damage\s+(?:did|does|was)|damage\s+notes?|documented\s+damage|what\s+did\s+it\s+document)\b/i.test(text);
  const ownerNotification=/\b(owner\s+(?:was\s+)?notified|notify\s+(?:me|owner)|notification.*damage|damage.*notification|has\s+(?:the\s+)?owner\s+been\s+notified)\b/i.test(text);
  const shopInventory=/\b(back\s+to\s+shop|shop\s+inventory|available\s+(?:in|for)\s+shop|return.*shop)\b/i.test(text);
  const repairStatus=/\b(repair\s+status|replacement\s+status|repair\/replacement|repair\s+or\s+replacement|what\s+happens\s+next.*(?:damage|replacement)|status.*(?:damage|replacement))\b/i.test(text);
  const damageCue=/\b(damage(?:d)?|replacement|repair|maintenance)\b/i.test(text);
  if(!needsReplacement&&!damageDetail&&!ownerNotification&&!(shopInventory&&damageCue)&&!repairStatus)return null;

  const hinted=unitHint(text);
  const generic=text.match(/\bunit\s*(?:#|number|no\.?)*\s*([a-z0-9._-]+)\b/i);
  let unitReference=hinted?(hinted.type+' '+hinted.tag):(generic?.[1]||'');
  if(!unitReference&&/\b(?:this|that)\s+unit\b/i.test(text)&&state.currentUnitReference){
    unitReference=String(state.currentUnitReference);
  }
  const explicitTicket=ticketFrom(text);
  const contextualTicket=!explicitTicket&&state.currentTicket&&/\b(this|that|it|unit|ticket|return|damage|replacement|repair)\b/i.test(text)
    ?String(state.currentTicket):'';
  const ticket=explicitTicket||contextualTicket||'';

  let detail='';
  if(damageDetail)detail='damage';
  else if(ownerNotification)detail='owner_notification';
  else if(shopInventory)detail='shop_inventory';
  else if(repairStatus)detail='repair_status';
  const scope=detail?'all':'active';
  return{scope,detail,unitReference,ticket};
}
function damageHoldCard(row){
  const r=row||{};
  const meta=[
    r.ticket_no?'MHelpDesk #'+r.ticket_no:'',
    r.it_tech_name?'IT: '+r.it_tech_name:'',
    r.it_received_at?historyDate(r.it_received_at):''
  ].filter(Boolean);
  const ownerStatus=r.owner_notified===true?'RECORDED':(r.permanent_damage_report_present?'MISSING INFORMATION':'NOT RECORDED');
  return '<div class="vision-context-block"><h3>'+esc((r.equipment_type||'Equipment')+' '+(r.unit_tag||'MISSING INFORMATION'))+'</h3>'
    +'<div class="vision-context-grid"><div><span>RETURN STATUS</span><b>'+esc(String(r.status||'MISSING INFORMATION').replaceAll('_',' ').toUpperCase())+'</b></div>'
    +'<div><span>INVENTORY STATUS</span><b>'+esc(String(r.asset_inventory_status||'MISSING INFORMATION').replaceAll('_',' ').toUpperCase())+'</b></div>'
    +'<div><span>OWNER NOTIFICATION</span><b>'+esc(ownerStatus)+'</b></div>'
    +'<div><span>SHOP AVAILABLE</span><b>'+esc(r.shop_inventory_blocked?'NO — HOLD ACTIVE':'MISSING INFORMATION')+'</b></div></div>'
    +(meta.length?'<div class="vision-system-note">'+meta.map(esc).join(' · ')+'</div>':'')
    +'</div>';
}
async function damageHoldHtml(raw){
  const intent=damageHoldIntent(raw);
  if(!intent)return'';
  const layer=visionLiveData();
  if(!layer?.getDamageHolds)return '<div class="vision-direct warn"><b>Damage-hold data is updating.</b>Refresh OnSite Vision and try again.</div>';
  const result=await layer.getDamageHolds({
    scope:intent.scope,
    unit_reference:intent.unitReference,
    ticket_no:intent.ticket
  },{force:true,limit:100});
  const rows=Array.isArray(result?.rows)?result.rows:[];

  if(rows.length===1){
    const remembered=rows[0]||{};
    if(remembered.unit_tag)state.currentUnitReference=[remembered.equipment_type,remembered.unit_tag].filter(Boolean).join(' ');
    if(remembered.ticket_no){
      state.currentTicket=String(remembered.ticket_no);
      const current=ensureChat();current.ticket=state.currentTicket;saveChats();renderOrder();
    }
  }

  if(!rows.length){
    if(!intent.detail){
      return '<div class="vision-answer-title">No active damaged-equipment Needs Replacement holds are recorded right now.</div>'
        +'<div class="vision-answer-copy">I checked the live Tech Check return records. MHelpDesk remains separate.</div>';
    }
    return '<div class="vision-answer-title">No matching damage-hold record was found.</div>'
      +'<div class="vision-direct warn"><b>MISSING INFORMATION</b>The requested damage/replacement detail is not recorded in a matching Tech Check return.</div>'
      +'<div class="vision-answer-copy">I am not inferring repair or Shop Inventory status from an absent record.</div>';
  }

  if(intent.detail){
    const r=rows[0]||{};
    if(intent.detail==='damage'){
      const photoCount=Array.isArray(r.intake_photo_paths)?r.intake_photo_paths.length:0;
      return '<div class="vision-answer-title">IT damage documentation</div>'
        +'<div class="vision-context-block"><h3>'+esc((r.equipment_type||'Equipment')+' '+(r.unit_tag||'MISSING INFORMATION'))+'</h3><div class="vision-context-list">'
        +'<div class="vision-context-row"><b>IT damage notes</b><span>'+esc(r.damage_notes||'MISSING INFORMATION')+'</span></div>'
        +'<div class="vision-context-row"><b>IT technician</b><span>'+esc(r.it_tech_name||'MISSING INFORMATION')+'</span></div>'
        +'<div class="vision-context-row"><b>IT Intake evidence</b><span>'+esc(photoCount?photoCount+' photo'+(photoCount===1?'':'s'):'MISSING INFORMATION')+'</span></div>'
        +'<div class="vision-context-row"><b>Return notes</b><span>'+esc(r.return_notes||'MISSING INFORMATION')+'</span></div>'
        +'</div></div>'+damageHoldCard(r);
    }
    if(intent.detail==='owner_notification'){
      if(r.owner_notified){
        return '<div class="vision-answer-title">Yes — an Owner damage notification is recorded.</div>'
          +'<div class="vision-direct good"><b>VERIFIED DATABASE FACT</b>'+esc(String(r.owner_notification_count||1))+' Owner notification record'+(Number(r.owner_notification_count||1)===1?' is':'s are')+' stored for this damage hold'
          +(r.owner_notification_latest_at?' · latest '+esc(historyDate(r.owner_notification_latest_at)):'')+'.</div>'
          +damageHoldCard(r);
      }
      return '<div class="vision-answer-title">Owner notification cannot be verified from the notification records.</div>'
        +'<div class="vision-direct warn"><b>MISSING INFORMATION</b>No matching stored Owner notification row was found for this damage hold.</div>'
        +(r.permanent_damage_report_present?'<div class="vision-system-note">A permanent DAMAGED EQUIPMENT NEEDS REPLACEMENT report is recorded, but I will not substitute that for a missing notification record.</div>':'')
        +damageHoldCard(r);
    }
    if(intent.detail==='shop_inventory'){
      if(r.status==='needs_replacement'){
        return '<div class="vision-answer-title">No — this unit cannot return to available Shop Inventory while the damage hold is active.</div>'
          +'<div class="vision-direct warn"><b>COMPANY RULE</b>A Needs Replacement return is held in Maintenance and the database blocks the generic Shop Inventory path until the damage hold is resolved.</div>'
          +'<div class="vision-direct warn"><b>MISSING INFORMATION</b>The normal final repair/replacement disposition has not been defined or recorded yet.</div>'
          +damageHoldCard(r);
      }
      return '<div class="vision-answer-title">No active Needs Replacement hold is shown on this damage record.</div>'
        +'<div class="vision-direct warn"><b>MISSING INFORMATION</b>That alone does not prove the unit is eligible for Shop Inventory; current workflow and inventory state must also allow it.</div>'
        +damageHoldCard(r);
    }
    if(intent.detail==='repair_status'){
      return '<div class="vision-answer-title">'+esc(r.status==='needs_replacement'?'This unit is on an active Needs Replacement hold.':'Recorded damage / replacement status')+'</div>'
        +'<div class="vision-direct '+(r.status==='needs_replacement'?'warn':'good')+'"><b>VERIFIED DATABASE FACT</b>Return status: '+esc(String(r.status||'MISSING INFORMATION').replaceAll('_',' '))+'. Inventory status: '+esc(String(r.asset_inventory_status||'MISSING INFORMATION').replaceAll('_',' '))+'.</div>'
        +'<div class="vision-direct warn"><b>MISSING INFORMATION</b>The final repair/replacement disposition procedure and outcome are not recorded as completed company procedure.</div>'
        +damageHoldCard(r);
    }
  }

  return '<div class="vision-answer-title">'+rows.length+' damaged unit'+(rows.length===1?'':'s')+' currently need replacement / repair attention</div>'
    +'<div class="vision-answer-copy">These are live Tech Check Needs Replacement holds. They are not available Shop Inventory.</div>'
    +rows.slice(0,20).map(damageHoldCard).join('');
}


function departureReadinessIntent(raw){
  return /\b(truck\s+(?:ready|readiness|minimums?|spares?)|ready\s+to\s+(?:leave|depart|roll|go)|departure\s+readiness|enough\s+(?:charged\s+)?batteries|backup\s+unit.*(?:truck|day)|what.*(?:truck|service).*need.*(?:leave|day))\b/i.test(String(raw||''));
}
async function departureReadinessHtml(raw){
  if(!departureReadinessIntent(raw))return'';
  const layer=visionLiveData();
  if(!layer?.getDepartureReadiness)return '<div class="vision-direct warn"><b>Departure-readiness data is updating.</b>Refresh OnSite Vision and try again.</div>';
  const result=await layer.getDepartureReadiness({ticket_no:ticketFrom(raw)||''},{force:true});
  const counts=result?.counts||{},minimums=result?.minimums||{},blockers=Array.isArray(result?.blockers)?result.blockers:[];
  const rows=[['12V 110Ah charged batteries',counts.standard_12v_110ah??0,minimums.standard_12v_110ah??4],['LiTime 12V 100Ah charged batteries',counts.litime_12v_100ah??0,minimums.litime_12v_100ah??2],['IT-checked-out backup unit',counts.eligible_backup_units??0,minimums.eligible_backup_units??1]];
  return '<div class="vision-answer-title">'+esc(result.ready?'Truck departure minimums are recorded as ready.':'Truck departure minimums are NOT fully recorded as ready.')+'</div>'
    +'<div class="vision-context-block"><h3>Required before Service leaves</h3><div class="vision-context-list">'+rows.map(([label,have,need])=>'<div class="vision-context-row"><b>'+esc(label)+'</b><span>'+esc(String(have))+' / '+esc(String(need))+(Number(have)>=Number(need)?' · READY':' · BLOCKED')+'</span></div>').join('')+'</div></div>'
    +(blockers.length?'<div class="vision-direct warn"><b>BLOCKERS</b>'+blockers.map(esc).join(' ')+'</div>':'<div class="vision-direct good"><b>VERIFIED DATABASE FACT</b>The recorded truck minimums are satisfied.</div>')
    +'<div class="vision-system-note">Battery readiness requires charged/ready plus IT checkout. Backup readiness requires an IT-verified and IT-checked-out Spotter, Sniper, or Solar Spotter checked out for Service. Solar Pole is retired and does not qualify.</div>'
    +'<div class="vision-answer-copy">Anything not recorded in Tech Check is MISSING INFORMATION, not assumed to be on the truck.</div>';
}

function ownerReviewIntent(raw){
  return /\b(ready\s+for\s+owner\s+review|owner\s+review\s+queue|what\s+do\s+i\s+need\s+to\s+review|jobs?\s+(?:ready|waiting)\s+for\s+(?:my|owner)\s+review)\b/i.test(String(raw||''));
}
async function ownerReviewQueueHtml(raw){
  if(!ownerReviewIntent(raw))return'';
  const layer=visionLiveData();
  if(!layer?.getOwnerReviewQueue)return '<div class="vision-direct warn"><b>Owner Review is updating.</b>Refresh OnSite Vision and try again.</div>';
  const rows=await layer.getOwnerReviewQueue({limit:60});
  if(!rows.length)return '<div class="vision-answer-title">Nothing is waiting for Owner Review.</div><div class="vision-answer-copy">The live closeout queue has no completed jobs ready for your review or returned for correction.</div>';
  const card=row=>{
    const o=row.overview||{};
    const items=[
      ['Owner assigned',o.owner_assigned],
      ['IT completed',o.it_completed],
      ['Handoff completed',o.handoff_completed],
      ['Service completed',o.service_completed],
      ['Equipment / returns',o.equipment_returns_accounted_for],
      ['Evidence',o.evidence_complete]
    ];
    return '<div class="vision-context-block"><h3>MHelpDesk #'+esc(row.ticket_no||'—')+' · '+esc(row.site||'No site')+'</h3>'
      +'<div class="vision-context-grid">'+items.map(([k,v])=>'<div><span>'+esc(k)+'</span><b>'+esc(v||'MISSING INFORMATION')+'</b></div>').join('')+'</div>'
      +(row.review_status==='correction_requested'?'<div class="vision-system-note"><b>RETURNED FOR CORRECTION:</b> '+esc(row.correction_reason||'Reason not recorded')+'</div>':'')
      +'</div>';
  };
  return '<div class="vision-answer-title">'+rows.length+' job'+(rows.length===1?'':'s')+' in Ready for Owner Review</div>'
    +'<div class="vision-answer-copy">This is the permanent closeout view: Owner assigned → IT completed → handoff completed → Service completed → equipment/returns accounted for → evidence complete.</div>'
    +rows.slice(0,12).map(card).join('');
}

async function answer(text){
  const raw=String(text||'').trim(),lower=raw.toLowerCase();
  const current=chat();
  if(current?.draft){
    const sideQuestion=/\?$|^(what|how|why|which|does|do|is|are|can|could|should|where|when)\b/i.test(raw);
    if(sideQuestion){
      const review=await ownerReviewQueueHtml(raw);if(review)return review;
      const departure=await departureReadinessHtml(raw);if(departure)return departure;
      const damage=await damageHoldHtml(raw);if(damage)return damage;
      const history=await companyHistoryHtml(raw);if(history)return history;
      const offline=await offlineEscalationHtml(raw);if(offline)return offline;
      const side=await serverAgentAnswer(raw);
      if(side)return side;
    }
    return await continueDraft(raw);
  }
  if(isCreateRequest(raw))return startDraft(raw);

  if(systemHealthIntent(raw))return await systemHealthHtml();

  const workload=workloadIntent(raw);
  if(workload)return workloadHtml(workload);

  const reviewQueue=await ownerReviewQueueHtml(raw);if(reviewQueue)return reviewQueue;
  const departureReadiness=await departureReadinessHtml(raw);if(departureReadiness)return departureReadiness;
  const damageHold=await damageHoldHtml(raw);if(damageHold)return damageHold;
  const companyHistory=await companyHistoryHtml(raw);if(companyHistory)return companyHistory;
  const offlineEscalation=await offlineEscalationHtml(raw);if(offlineEscalation)return offlineEscalation;

  // Resolve an explicit Tech Check ticket/unit before profile lookup or the
  // conversational agent. This prevents a named ticket from being mistaken for
  // a person and prevents the prior active ticket from overriding the number
  // the Owner just typed.
  const hint=unitHint(raw);let ticket=ticketFrom(raw)||ticketByUnit(hint);
  if(!ticket){
    const personReply=await personLookupHtml(raw);
    if(personReply)return personReply;

    const agentReply=await serverAgentAnswer(raw);
    if(agentReply)return agentReply;
  }

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
    const context=await liveContext(ticket,true);
    if(!context?.found&&!group(ticket).length&&!prep(ticket))return ticketAnswer(ticket);
    state.currentTicket=ticket;ensureChat().ticket=ticket;saveChats();renderOrder();
    const a=assignIntent(raw);
    if(a){
      if(a.kind==='choose-tech')return '<div class="vision-answer-title">I can prepare that change.</div>'+actionCard(a,ticket)+(context?.found?liveJobCard(context):jobCard(ticket));
      const payload=legacyActionPayload(a,ticket);
      return '<div class="vision-answer-title">I can prepare that change.</div>'+await auditedActionCard(payload,raw)+(context?.found?liveJobCard(context):jobCard(ticket));
    }
    const s=scheduleIntent(raw);
    if(s){
      const payload=legacyActionPayload(s,ticket);
      return '<div class="vision-answer-title">I can update the schedule.</div>'+await auditedActionCard(payload,raw)+(context?.found?liveJobCard(context):jobCard(ticket));
    }
    if(/\b(who\s+(?:has|is\s+assigned|is\s+handling)|who(?:'s|\s+is)\s+(?:task|assigned|handling)|assignment|assigned\s+to|who\s+has\s+it)\b/i.test(raw))return context?.found?liveWhoHtml(context):who(ticket);
    if(/\b(holding|hold(?:ing)? up|blocked|blocker|stuck|why (?:can'?t|cannot)|what.*preventing)\b/i.test(raw))return context?.found?liveBlockersHtml(context):'<div class="vision-answer-title">I could not load the full blocker context.</div>'+jobCard(ticket);
    if(/\b(what happens next|what next|next steps?|still needs|remaining|finish it|what needs to be done|what should happen next)\b/i.test(raw))return context?.found?liveNextHtml(context):'<div class="vision-answer-title">What still needs to happen</div><div class="vision-direct"><b>MHelpDesk #'+esc(ticket)+'</b>'+esc(next(ticket))+'</div>'+jobCard(ticket);
    if(/\b(show|list|what).*(equipment|unit|units|gear)|\bwhat equipment\b/i.test(raw))return context?.found?liveEquipmentHtml(context):jobCard(ticket);
    if(/\b(show|list|see|what).*(photo|photos|picture|pictures|evidence|signature|signatures)\b/i.test(raw))return context?.found?liveEvidenceHtml(context):'<div class="vision-answer-title">No evidence context is available.</div>';
    return context?.found?'<div class="vision-answer-title">MHelpDesk #'+esc(ticket)+'</div><div class="vision-answer-copy">Here is the current Tech Check context from the live database.</div>'+liveJobCard(context):ticketAnswer(ticket,'Here is the live Tech Check side of this service order.');
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
  const a=state.pending.get(actionId);if(!a)return;

  if(a.kind==='audited'){
    const layer=visionActions();
    if(!layer?.execute)throw new Error('Vision action layer is unavailable.');
    const result=await layer.execute(a.auditActionId);
    state.pending.delete(actionId);
    if(result?.status!=='succeeded')throw new Error(result?.error||'The audited action was not completed.');

    const ticket=a.ticket||result.ticket_no||'';
    if(a.actionType==='assign'&&a.canonical?.create_new_assignment&&ticket){
      try{
        const rows=result.after_state?.assignments||[];
        const role=a.canonical?.role||'';
        const assignment=[...rows].reverse().find(x=>x.assigned_role===role&&['assigned','started'].includes(x.status));
        if(assignment?.id)await db.functions.invoke('send-techcheck-push',{body:{assignment_id:assignment.id}});
      }catch{}
    }

    await loadData();
    visionLiveData()?.invalidate?.(ticket);
    let label='Tech Check action saved.';
    if(a.actionType==='assign')label='Assignment saved in Tech Check.';
    else if(a.actionType==='schedule')label='Schedule updated in Tech Check.';
    else if(a.actionType==='cancel')label='Assignment cancelled in Tech Check.';
    else if(a.actionType==='owner_approve')label='Owner final verification saved in Tech Check.';

    let context=null;
    try{if(ticket)context=await liveContext(ticket,true);}catch{}
    addMessage('assistant','',
      '<div class="vision-direct good"><b>'+esc(label)+'</b>The confirmed action completed successfully and the before/after result was recorded in the Vision audit ledger. MHelpDesk remains separate.</div>'
      +(context?.found?liveJobCard(context):(ticket?jobCard(ticket):''))
    );
    renderThread();renderOrder();
    return;
  }

  state.pending.delete(actionId);
  if(a.kind==='create-job'){
    const html=await createDraftJob(a.draft);
    addMessage('assistant','',html);renderThread();renderOrder();
    return;
  }

  // Legacy non-agent fallback retained only for compatibility with older cached conversations.
  const ticket=a.ticket,rows=active(ticket),p=prep(ticket),base=rows[0]||group(ticket)[0];if(!base)throw new Error('The service order is no longer available.');
  let result='';
  if(a.kind==='schedule'){
    const update={updated_at:now()};if(a.date)update.scheduled_for=a.date;if(a.time)update.scheduled_time=a.time;
    const x=await db.from('job_assignments').update(update).eq('ticket_no',ticket).in('status',['assigned','started']);if(x.error)throw x.error;result='Schedule updated for MHelpDesk #'+ticket+'.';
  }else{
    const existing=rows.find(r=>r.assigned_role===a.role),tech=a.tech||null;
    if(existing){
      const x=await db.rpc('owner_reassign_job_assignment',{p_assignment_id:existing.id,p_assignee_user_id:tech?.user_id||null});if(x.error)throw x.error;
      result=tech?(tech.full_name||tech.username)+' is now assigned to MHelpDesk #'+ticket+'.':'MHelpDesk #'+ticket+' is now in the '+(a.role==='service'?'Service':'IT')+' department queue.';
    }else{
      const x=await db.rpc('owner_assign_job_v8',{p_ticket_no:String(ticket),p_site:base.site||p?.site||'',p_assigned_role:a.role,p_assignee_user_id:tech?.user_id||null,p_requested_unit_count:Number(base.requested_unit_count||0),p_unit_summary:base.unit_summary||'',p_job_description:base.job_description||'',p_notes:base.notes||'',p_solar_panel_qty:Number(base.solar_panel_qty||0),p_battery_replacement_qty:Number(base.battery_replacement_qty||0),p_camera_replacement_qty:Number(base.camera_replacement_qty||0),p_sim_replacement_qty:Number(base.sim_replacement_qty||0),p_micro_sd_qty:Number(base.micro_sd_qty||0),p_equipment_manifest:base.equipment_manifest||p?.equipment_manifest||{},p_requires_it_handoff:a.role==='service'&&String(base.work_type||'').toLowerCase()!=='pickup',p_scheduled_for:base.scheduled_for||dayKey(new Date()),p_work_type:base.work_type||p?.work_type||'service'});
      if(x.error)throw x.error;
      if(x.data&&base.scheduled_time){const t=await db.from('job_assignments').update({scheduled_time:base.scheduled_time,updated_at:now()}).eq('id',x.data);if(t.error)throw t.error;}
      try{if(x.data)await db.functions.invoke('send-techcheck-push',{body:{assignment_id:x.data}});}catch{}
      result=tech?(tech.full_name||tech.username)+' was assigned to MHelpDesk #'+ticket+'.':'MHelpDesk #'+ticket+' was assigned to the '+(a.role==='service'?'Service':'IT')+' department queue.';
    }
  }
  await loadData();visionLiveData()?.invalidate?.(ticket);addMessage('assistant','', '<div class="vision-direct good"><b>Saved in Tech Check.</b>'+esc(result)+' MHelpDesk remains separate.</div>'+jobCard(ticket));renderThread();renderOrder();
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
function closeDrawers(){
  const app=$('visionApp');
  app?.classList.remove('sidebar-open','order-open');
  const panel=$('visionOrderPanel');
  const shade=$('visionShade');
  panel?.setAttribute('aria-hidden','true');
  shade?.setAttribute('aria-hidden','true');
  if(document.activeElement && (panel?.contains(document.activeElement)||$('visionSidebar')?.contains(document.activeElement))) document.activeElement.blur();
}
function openOrderDrawer(){
  closeDrawers();
  const app=$('visionApp'),panel=$('visionOrderPanel'),shade=$('visionShade');
  app?.classList.add('order-open');
  panel?.setAttribute('aria-hidden','false');
  shade?.setAttribute('aria-hidden','false');
}
function toggleOrderDrawer(){
  if($('visionApp')?.classList.contains('order-open')) closeDrawers(); else openOrderDrawer();
}
function voice(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){addMessage('assistant','', '<div class="vision-system-note">Use the iPhone keyboard microphone for voice dictation on this device.</div>');renderThread();return;}
  const r=new SR();r.lang='en-US';r.interimResults=false;r.maxAlternatives=1;r.onresult=e=>{const text=e.results?.[0]?.[0]?.transcript||'';if(text)send(text);};r.start();
}
document.addEventListener('click',async e=>{
  const c=e.target.closest('[data-chat-id]');if(c)return openChat(c.dataset.chatId);
  const p=e.target.closest('[data-vision-prompt],[data-order-prompt]');if(p)return send(p.dataset.visionPrompt||p.dataset.orderPrompt);
  const confirm=e.target.closest('[data-confirm-action]');if(confirm){confirm.disabled=true;confirm.textContent='Saving...';try{await execute(confirm.dataset.confirmAction);}catch(error){addMessage('assistant','', '<div class="vision-direct warn"><b>That change was not saved.</b>'+esc(error?.message||'Please try again.')+'</div>');renderThread();}return;}
  const cancel=e.target.closest('[data-cancel-action]');if(cancel){
    const pending=state.pending.get(cancel.dataset.cancelAction);
    try{if(pending?.kind==='audited'&&pending.auditActionId)await visionActions()?.cancel?.(pending.auditActionId);}catch(error){console.warn('Vision audit cancel',error);}
    state.pending.delete(cancel.dataset.cancelAction);
    addMessage('assistant','', '<div class="vision-system-note">No changes were made. The proposed Vision action was cancelled.</div>');renderThread();return;
  }
  const knowledgeItem=e.target.closest('[data-knowledge-id]');
  if(knowledgeItem){
    const entry=state.knowledgeEntries.find(x=>String(x.id)===String(knowledgeItem.dataset.knowledgeId));
    if(entry)fillKnowledgeForm(entry);
    return;
  }
  if(e.target.closest('#visionTeachButton')){await openKnowledgeManager();return;}
  if(e.target.closest('#visionKnowledgeClose')){closeKnowledgeManager();return;}
  if(e.target.closest('#visionKnowledgeNew')){resetKnowledgeForm();return;}
  if(e.target.closest('#visionKnowledgeSaveDraft')){
    try{await saveKnowledgeEntry('draft');}catch(error){const n=$('visionKnowledgeSaveStatus');if(n){n.classList.remove('hidden');n.textContent=error?.message||'Could not save draft.';}}return;
  }
  if(e.target.closest('#visionKnowledgeApprove')){
    try{await saveKnowledgeEntry('approved');}catch(error){const n=$('visionKnowledgeSaveStatus');if(n){n.classList.remove('hidden');n.textContent=error?.message||'Could not approve knowledge.';}}return;
  }
  if(e.target.closest('#visionKnowledgeRetire')){
    try{await saveKnowledgeEntry('retired');}catch(error){const n=$('visionKnowledgeSaveStatus');if(n){n.classList.remove('hidden');n.textContent=error?.message||'Could not retire knowledge.';}}return;
  }
  if(e.target.closest('#visionNewChat')||e.target.closest('#visionHeaderNewButton'))return newChat();if(e.target.closest('#visionSendButton'))return send();if(e.target.closest('#visionMenuButton')){closeDrawers();$('visionApp').classList.add('sidebar-open');return;}if(e.target.closest('#visionOrderButton'))return toggleOrderDrawer();if(e.target.closest('#visionOrderClose')||e.target.closest('#visionShade'))return closeDrawers();
  if(e.target.closest('#visionRefreshButton')){try{visionLiveData()?.invalidateAll?.();state.agentStatus='unknown';await loadData();await checkAgentStatus();renderOrder();}catch(error){console.warn(error);}return;}
  if(e.target.closest('#visionVoiceButton'))return voice();
});
// iOS/PWA: pointer-up fallback makes Close/backdrop reliable even when a scroll gesture suppresses click.
['visionOrderClose','visionShade'].forEach(id=>$(id)?.addEventListener('pointerup',e=>{e.preventDefault();e.stopPropagation();closeDrawers();},{passive:false}));
document.addEventListener('input',e=>{if(e.target?.id==='visionPrompt')grow(e.target);});
document.addEventListener('change',e=>{if(e.target?.id==='visionKnowledgeFilter')loadKnowledgeEntries();});
document.addEventListener('focusin',e=>{
  if(e.target?.id==='visionPrompt') $('visionApp')?.classList.remove('order-open');
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!$('visionKnowledgeModal')?.classList.contains('hidden')){closeKnowledgeManager();return;}
  if(e.target?.id==='visionPrompt'&&e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}
});
init().catch(error=>{$('visionLoading').innerHTML='<b>OnSite Vision could not open.</b><span>'+esc(error?.message||'Return to Tech Check and try again.')+'</span>';});
})();
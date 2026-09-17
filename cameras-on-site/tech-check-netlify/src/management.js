const manageDb = window.__techCheckDb;
let manageSelectedPrep = null;
let manageRenderingReports = false;
let manageRenderTimer = null;

function mEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[ch]);
}
function mRole() { return document.getElementById('whoRole')?.textContent || ''; }
function isOwner() { return mRole().includes('Owner/Admin'); }
function isITAllowed() { return mRole().includes('IT Tech') || isOwner(); }
function isServiceAllowed() { return mRole().includes('Service Tech') || isOwner(); }
function statusText(status) { return status === 'draft' ? 'PENDING IN IT' : status === 'released' ? 'WAITING FOR SERVICE' : 'COMPLETED / DEPLOYED'; }
function statusClass(status) { return status === 'draft' ? 'amber' : status === 'released' ? 'green' : ''; }
function isTestPrep(prep) { return !!prep.is_test || String(prep.ticket_no || '').toUpperCase().startsWith('TEST-'); }
function unitSummary(prep) {
  return [...(prep.prep_items || [])].sort((a,b)=>a.item_order-b.item_order).map(item =>
    `${item.purpose} ${item.equipment_type === 'Recon 2' ? 'Recon II' : item.equipment_type}${item.unit_tag ? ' ' + item.unit_tag : ''}`
  ).join(' · ');
}

function installManagementStyles() {
  if (document.getElementById('cosManagementStyles')) return;
  const style = document.createElement('style');
  style.id = 'cosManagementStyles';
  style.textContent = `
    .mgmt-card details{border:1px solid #d9e0e6;border-radius:12px;margin-top:10px;background:#fff;overflow:hidden}
    .mgmt-card summary{cursor:pointer;padding:14px 15px;font-weight:900;display:flex;align-items:center;justify-content:space-between;gap:10px;background:#f8fafc}
    .mgmt-card details[open] summary{border-bottom:1px solid #e8edf1}
    .mgmt-body{padding:12px}.mgmt-ticket{border:1px solid #e1e7ec;border-radius:10px;padding:11px;margin-bottom:9px;background:#fff}.mgmt-ticket:last-child{margin-bottom:0}
    .mgmt-count{font-size:12px;border-radius:999px;padding:4px 8px;background:#eaf0f6;white-space:nowrap}.mgmt-search{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:10px}
    .mgmt-editor-card{display:none}.mgmt-editor-card.mgmt-open{display:block}.mgmt-test{border:2px dashed #7c3aed!important;background:#faf7ff!important}
    .mgmt-test-badge{display:inline-block;background:#7c3aed;color:#fff;border-radius:999px;padding:4px 8px;font-size:12px;font-weight:900;margin-left:6px}
    .report-group{margin-top:10px}.report-entry{border-top:1px solid #edf0f2;padding:10px 0}.report-entry:first-child{border-top:0}
    .reason-box{margin-top:7px;background:#fff6df;border-left:4px solid #d89b1d;padding:8px;border-radius:6px}.owner-actions{display:grid;gap:9px;margin-top:10px}.owner-actions button{width:100%}
    .test-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}@media(max-width:680px){.test-grid{grid-template-columns:1fr}.mgmt-search{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

async function fetchAllPreps() {
  const { data, error } = await manageDb.from('prep_tickets').select('*,prep_items(*)').order('created_at',{ascending:false});
  return error ? [] : (data || []);
}

function queueTicketHtml(prep, showOpen=false) {
  const test = isTestPrep(prep);
  return `<div class="mgmt-ticket${test ? ' mgmt-test' : ''}">
    <div class="row"><div><b>MHelpDesk Ticket #${mEsc(prep.ticket_no)}</b>${test ? '<span class="mgmt-test-badge">TEST</span>' : ''}<div class="small">${mEsc(prep.site || 'No site / description')}</div></div><span class="pill ${statusClass(prep.status)}">${statusText(prep.status)}</span></div>
    <div class="small top8">${mEsc(unitSummary(prep) || 'No unit details yet')}</div>
    ${prep.released_by_name ? `<div class="small top8"><b>Prepared by IT:</b> ${mEsc(prep.released_by_name)}</div>` : ''}
    ${prep.closed_by_name ? `<div class="small"><b>Received by Service:</b> ${mEsc(prep.closed_by_name)}</div>` : ''}
    ${showOpen ? `<button class="mini full top8 mgmt-open-prep" data-prep-id="${prep.id}">Open / Edit This Prep</button>` : ''}
  </div>`;
}

function ensureITQueueCard() {
  if (!isITAllowed()) return null;
  let card = document.getElementById('itWorkQueueCard');
  if (card) return card;
  const editorCard = document.getElementById('itPreps')?.closest('.card');
  if (!editorCard) return null;
  editorCard.classList.add('mgmt-editor-card');
  card = document.createElement('div');
  card.id='itWorkQueueCard'; card.className='card mgmt-card';
  card.innerHTML=`<div class="sectiontitle"><h2>IT Equipment Work Queue</h2><span class="pill">Quick View</span></div><div class="small">Pending, sent, and completed equipment stay compact here. Open only what you need.</div><div id="itQueueSections"></div>
    <details><summary>Search Equipment History <span class="mgmt-count">Ticket or Unit #</span></summary><div class="mgmt-body"><div class="mgmt-search"><input id="itHistorySearch" placeholder="Ticket number or unit number"><button id="itHistorySearchBtn" class="mini">Search</button></div><div id="itHistoryResults" class="top10"></div></div></details>`;
  editorCard.before(card);
  const handoff=document.getElementById('itHandoffCard'); if(handoff) handoff.style.display='none';
  return card;
}

async function renderITQueue() {
  if(!isITAllowed()) return;
  const card=ensureITQueueCard(); if(!card) return;
  const preps=await fetchAllPreps();
  const pending=preps.filter(p=>p.status==='draft'); const waiting=preps.filter(p=>p.status==='released'); const completed=preps.filter(p=>p.status==='closed').slice(0,40);
  card.querySelector('#itQueueSections').innerHTML=`
    <details open><summary>Pending Equipment Tickets <span class="mgmt-count">${pending.length}</span></summary><div class="mgmt-body">${pending.length?pending.map(p=>queueTicketHtml(p,true)).join(''):'<div class="ok"><b>No pending IT prep.</b></div>'}</div></details>
    <details ${waiting.length?'open':''}><summary>Sent / Waiting for Service <span class="mgmt-count">${waiting.length}</span></summary><div class="mgmt-body">${waiting.length?waiting.map(p=>queueTicketHtml(p)).join(''):'<div class="small">Nothing waiting for Service.</div>'}</div></details>
    <details><summary>Completed / Deployed <span class="mgmt-count">${completed.length}</span></summary><div class="mgmt-body">${completed.length?completed.map(p=>queueTicketHtml(p)).join(''):'<div class="small">No completed history yet.</div>'}</div></details>`;
  applySelectedEditor(preps); labelTestCards(preps);
}

function applySelectedEditor(preps=null) {
  const list=document.getElementById('itPreps'); const editorCard=list?.closest('.card'); if(!editorCard) return;
  if(Array.isArray(preps) && manageSelectedPrep && !preps.some(p=>p.id===manageSelectedPrep && p.status==='draft')) manageSelectedPrep=null;
  editorCard.classList.toggle('mgmt-open',!!manageSelectedPrep);
  [...list.querySelectorAll('[data-prep-id]')].forEach(card=>{card.style.display=!manageSelectedPrep||card.dataset.prepId===manageSelectedPrep?'':'none';});
  let close=editorCard.querySelector('.mgmt-close-editor');
  if(manageSelectedPrep&&!close){close=document.createElement('button');close.className='mini full mgmt-close-editor';close.textContent='Close Prep Editor';editorCard.insertBefore(close,editorCard.children[1]||null);}
  if(!manageSelectedPrep&&close) close.remove();
}

function labelTestCards(preps) {
  const testIds=new Set(preps.filter(isTestPrep).map(p=>p.id));
  document.querySelectorAll('#itPreps [data-prep-id],#itHandoffList [data-handoff-prep]').forEach(card=>{
    const id=card.dataset.prepId||card.dataset.handoffPrep; if(!testIds.has(id)) return; card.classList.add('mgmt-test');
    const head=card.querySelector('.ticketHead'); if(head&&!head.querySelector('.mgmt-test-badge')) head.insertAdjacentHTML('beforeend','<span class="mgmt-test-badge">TEST</span>');
  });
}

function ensureServiceHistoryCard() {
  if(!isServiceAllowed()) return null;
  let card=document.getElementById('serviceHistoryCard'); if(card) return card;
  const matched=document.getElementById('matchedPreps')?.closest('.card'); if(!matched) return null;
  card=document.createElement('div'); card.id='serviceHistoryCard'; card.className='card mgmt-card';
  card.innerHTML=`<details><summary>My Equipment History <span class="mgmt-count">Completed</span></summary><div class="mgmt-body"><div id="serviceMyHistory"></div></div></details>
    <details><summary>Search Equipment History <span class="mgmt-count">Ticket or Unit #</span></summary><div class="mgmt-body"><div class="mgmt-search"><input id="svcHistorySearch" placeholder="Ticket number or unit number"><button id="svcHistorySearchBtn" class="mini">Search</button></div><div id="svcHistoryResults" class="top10"></div></div></details>`;
  matched.after(card); return card;
}
async function renderServiceHistory(){if(!isServiceAllowed())return;const card=ensureServiceHistoryCard();if(!card)return;const{data:{session}}=await manageDb.auth.getSession();const preps=await fetchAllPreps();const mine=preps.filter(p=>p.status==='closed'&&(isOwner()||p.closed_by===session?.user?.id)).slice(0,30);card.querySelector('#serviceMyHistory').innerHTML=mine.length?mine.map(p=>queueTicketHtml(p)).join(''):'<div class="small">No completed equipment history yet.</div>';}

function normalizeSearch(v){return String(v||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');}
async function runHistorySearch(inputId,resultId){const input=document.getElementById(inputId),results=document.getElementById(resultId),q=normalizeSearch(input?.value);if(!results)return;if(!q){results.innerHTML='<div class="warn">Enter a ticket number or unit number.</div>';return;}const preps=await fetchAllPreps();const found=preps.filter(p=>normalizeSearch(p.ticket_no).includes(q)||(p.prep_items||[]).some(i=>normalizeSearch(i.unit_tag).includes(q))).slice(0,50);results.innerHTML=found.length?found.map(p=>queueTicketHtml(p)).join(''):'<div class="warn">No matching equipment history found.</div>';}

function ensureOwnerManagementCards(){if(!isOwner())return;const owner=document.getElementById('view-owner');if(!owner)return;let controls=document.getElementById('ownerWorkspaceControls');if(!controls){controls=document.createElement('div');controls.id='ownerWorkspaceControls';controls.className='card';controls.innerHTML=`<div class="sectiontitle"><h2>Owner Workspace Controls</h2><span class="pill">Owner Only</span></div><div class="small">Clear technician work screens without deleting accounts. Owner audit reports can be kept separately.</div><div class="owner-actions"><button id="ownerClearWorkspaces" class="btn danger">Clear IT & Service Workspaces — Keep Owner Reports</button><button id="ownerFullReset" class="mini danger">Full Reset — Clear Workflow + Reports, Keep Accounts</button></div>`;const accounts=[...owner.querySelectorAll('.card')].find(c=>c.querySelector('h2')?.textContent.includes('Technician Accounts'));if(accounts)accounts.before(controls);else owner.appendChild(controls);}let test=document.getElementById('ownerTestLab');if(!test){test=document.createElement('div');test.id='ownerTestLab';test.className='card mgmt-card';test.innerHTML=`<div class="sectiontitle"><h2>TEST Area — App Accuracy</h2><span class="mgmt-test-badge">TEST ONLY</span></div><div class="small">Create isolated TEST tickets, run them through IT → Service → field, and verify the app without mixing them into normal Owner reports.</div><details open><summary>Create a Test Ticket <span class="mgmt-count">Owner Only</span></summary><div class="mgmt-body"><div class="test-grid"><div><label>Test Ticket #</label><input id="testTicketNo" placeholder="Auto if blank"></div><div><label>Description</label><input id="testSite" value="App accuracy test"></div><div><label>Equipment</label><select id="testEquipment"><option>Sniper</option><option>Ranger</option><option>Helios</option><option>Solar Spotter</option><option>Spotter</option><option value="Recon 2">Recon II</option><option>110V Stand</option><option>Solar Stand</option></select></div><div><label>Purpose</label><select id="testPurpose"><option>BACKUP</option><option>SWAP</option><option selected>DELIVERY</option></select></div><div><label>Qty</label><input id="testQty" type="number" min="1" value="1"></div></div><button id="createTestTicket" class="btn top10">Create TEST Ticket</button></div></details><details><summary>Current TEST Records <span id="testRecordCount" class="mgmt-count">0</span></summary><div class="mgmt-body"><div id="testRecordList"></div></div></details><details><summary>TEST Audit Reports <span id="testReportCount" class="mgmt-count">0</span></summary><div class="mgmt-body"><div id="testReportList"></div></div></details><button id="clearTestData" class="mini danger full top10">Clear TEST Data Only</button>`;controls.before(test);}const oldReset=document.getElementById('ownerResetCard');if(oldReset)oldReset.style.display='none';}

async function renderOwnerReportsGrouped(){if(!isOwner()||manageRenderingReports)return;const target=document.getElementById('reports');if(!target)return;manageRenderingReports=true;try{const{data,error}=await manageDb.from('reports').select('*').order('created_at',{ascending:false});if(error)return;const production=(data||[]).filter(r=>!r.is_test&&!String(r.ticket_no||'').toUpperCase().startsWith('TEST-'));const groups=new Map();production.forEach(r=>{const n=r.actor_name||'Unknown Technician';if(!groups.has(n))groups.set(n,[]);groups.get(n).push(r);});const signature=production.map(r=>r.id).join(',');if(target.dataset.reportSignature===signature&&target.querySelector('.owner-report-groups'))return;target.dataset.reportSignature=signature;target.innerHTML=`<div class="owner-report-groups">${groups.size?[...groups.entries()].map(([name,reports])=>`<details class="report-group"><summary>${mEsc(name)} <span class="mgmt-count">${reports.length} report${reports.length===1?'':'s'}</span></summary><div class="mgmt-body">${reports.map(r=>`<div class="report-entry"><b>${mEsc(r.kind)}</b>${r.ticket_no?` · Ticket #${mEsc(r.ticket_no)}`:''}<div class="small">${new Date(r.created_at).toLocaleString()}</div><div>${mEsc(r.text||'')}</div>${r.reason?`<div class="reason-box"><b>Reason given:</b> ${mEsc(r.reason)}</div>`:''}</div>`).join('')}</div></details>`).join(''):'<div class="warn">No production reports yet.</div>'}</div>`;}finally{manageRenderingReports=false;}}

async function renderTestLab(){if(!isOwner())return;ensureOwnerManagementCards();const preps=(await fetchAllPreps()).filter(isTestPrep);const{data:reports}=await manageDb.from('reports').select('*').order('created_at',{ascending:false});const testReports=(reports||[]).filter(r=>r.is_test||String(r.ticket_no||'').toUpperCase().startsWith('TEST-'));const c=document.getElementById('testRecordCount'),rc=document.getElementById('testReportCount');if(c)c.textContent=String(preps.length);if(rc)rc.textContent=String(testReports.length);const list=document.getElementById('testRecordList'),rep=document.getElementById('testReportList');if(list)list.innerHTML=preps.length?preps.map(p=>queueTicketHtml(p)).join(''):'<div class="small">No TEST records.</div>';if(rep)rep.innerHTML=testReports.length?testReports.map(r=>`<div class="report-entry"><b>${mEsc(r.kind)}</b>${r.ticket_no?` · ${mEsc(r.ticket_no)}`:''}<div class="small">${mEsc(r.actor_name||'Owner')} · ${new Date(r.created_at).toLocaleString()}</div><div>${mEsc(r.text||'')}</div>${r.reason?`<div class="reason-box"><b>Reason:</b> ${mEsc(r.reason)}</div>`:''}</div>`).join(''):'<div class="small">No TEST reports.</div>';}

async function clearOwnerWorkspaces(){const reason=prompt('Why are you clearing the IT and Service workspaces? Give a short reason for the Owner audit report.');if(!reason?.trim())return;if(!confirm('Clear all IT and Service operational tickets/checks from their screens? Owner reports and technician accounts will be kept.'))return;const{error}=await manageDb.rpc('owner_clear_workspaces',{p_reason:reason.trim()});if(error)return alert(error.message);manageSelectedPrep=null;if(typeof window.refreshData==='function')await window.refreshData();scheduleManagementRender();alert('IT and Service workspaces were cleared. Owner reports were kept.');}
async function fullOwnerReset(){const answer=prompt('This clears workflow data AND Owner reports but keeps technician accounts. Type RESET to continue.');if(answer!=='RESET')return;const{error}=await manageDb.rpc('owner_start_fresh');if(error)return alert(error.message);manageSelectedPrep=null;if(typeof window.refreshData==='function')await window.refreshData();scheduleManagementRender();alert('Full workflow reset complete. Technician accounts were preserved.');}
async function createTestTicket(){const ticket=document.getElementById('testTicketNo')?.value.trim()||`TEST-${String(Date.now()).slice(-6)}`;const site=document.getElementById('testSite')?.value.trim()||'App accuracy test';const equipment=document.getElementById('testEquipment')?.value||'Solar Spotter';const purpose=document.getElementById('testPurpose')?.value||'DELIVERY';const qty=Math.max(1,Number(document.getElementById('testQty')?.value||1));const battery_qty=equipment==='Recon 2'?1:null;const{error}=await manageDb.rpc('owner_create_test_prep',{p_ticket_no:ticket,p_site:site,p_requirements:[{equipment_type:equipment,purpose,qty,battery_qty}]});if(error)return alert(error.message);document.getElementById('testTicketNo').value='';if(typeof window.refreshData==='function')await window.refreshData();scheduleManagementRender();alert(`TEST ticket ${ticket} created. Open IT Tech → Pending Equipment Tickets to run it through the real workflow.`);}
async function clearTestData(){if(!confirm('Clear TEST tickets and TEST reports only? Production workflow data will stay untouched.'))return;const{error}=await manageDb.rpc('owner_clear_test_data');if(error)return alert(error.message);manageSelectedPrep=null;if(typeof window.refreshData==='function')await window.refreshData();scheduleManagementRender();alert('TEST data cleared.');}

async function auditedDelete(button){const card=button.closest('[data-prep-id]'),prepId=card?.dataset.prepId;if(!prepId)return;const reason=prompt('Why are you deleting this equipment prep? A short answer is required for the Owner report.');if(!reason?.trim())return;if(!confirm('Delete this active equipment prep?'))return;const{error}=await manageDb.rpc('delete_it_prep_with_reason',{p_prep_id:prepId,p_reason:reason.trim()});if(error)return alert(error.message);manageSelectedPrep=null;if(typeof window.refreshData==='function')await window.refreshData();scheduleManagementRender();}
async function auditedReopen(button){const handoff=button.closest('[data-handoff-prep]'),prepId=handoff?.dataset.handoffPrep;if(!prepId)return;const reason=prompt('Why are you changing / reopening this sent equipment prep? A short answer is required for the Owner report.');if(!reason?.trim())return;const{error}=await manageDb.rpc('reopen_it_prep_with_reason',{p_prep_id:prepId,p_reason:reason.trim()});if(error)return alert(error.message);manageSelectedPrep=prepId;if(typeof window.refreshData==='function')await window.refreshData();scheduleManagementRender();}

function captureAuditReasons(event){const del=event.target.closest('.cos-delete-prep');if(del){event.preventDefault();event.stopImmediatePropagation();auditedDelete(del);return;}const reopen=event.target.closest('.cos-reopen-prep');if(reopen){event.preventDefault();event.stopImmediatePropagation();auditedReopen(reopen);return;}const save=event.target.closest('.cos-save-draft');if(save){const card=save.closest('[data-prep-id]');const reason=prompt('Why are you changing this equipment prep? Give a short reason for the Owner report.');if(!reason?.trim()){event.preventDefault();event.stopImmediatePropagation();return;}const ticket=card?.querySelector('.cos-ticket')?.value.trim()||'';const test=card?.classList.contains('mgmt-test')||ticket.toUpperCase().startsWith('TEST-');setTimeout(()=>manageDb.rpc('log_tech_change',{p_ticket_no:ticket,p_kind:'IT EQUIPMENT PREP CHANGED',p_reason:reason.trim(),p_text:'Technician saved corrections or changes to an IT equipment prep.',p_is_test:test}),900);}}

function wireManagementEvents(){if(document.body.dataset.managementWired==='true')return;document.body.dataset.managementWired='true';document.addEventListener('click',captureAuditReasons,true);document.addEventListener('click',event=>{const open=event.target.closest('.mgmt-open-prep');if(open){manageSelectedPrep=open.dataset.prepId;applySelectedEditor();document.getElementById('itPreps')?.closest('.card')?.scrollIntoView({behavior:'smooth',block:'start'});return;}if(event.target.closest('.mgmt-close-editor')){manageSelectedPrep=null;applySelectedEditor();return;}if(event.target.id==='itHistorySearchBtn')runHistorySearch('itHistorySearch','itHistoryResults');if(event.target.id==='svcHistorySearchBtn')runHistorySearch('svcHistorySearch','svcHistoryResults');if(event.target.id==='ownerClearWorkspaces')clearOwnerWorkspaces();if(event.target.id==='ownerFullReset')fullOwnerReset();if(event.target.id==='createTestTicket')createTestTicket();if(event.target.id==='clearTestData')clearTestData();});}

function installManagementObservers(){const it=document.getElementById('itPreps');if(it&&it.dataset.manageObserver!=='true'){it.dataset.manageObserver='true';new MutationObserver(scheduleManagementRender).observe(it,{childList:true});}const matched=document.getElementById('matchedPreps');if(matched&&matched.dataset.manageObserver!=='true'){matched.dataset.manageObserver='true';new MutationObserver(scheduleManagementRender).observe(matched,{childList:true});}const reports=document.getElementById('reports');if(reports&&reports.dataset.manageObserver!=='true'){reports.dataset.manageObserver='true';new MutationObserver(()=>setTimeout(renderOwnerReportsGrouped,50)).observe(reports,{childList:true});}}
async function renderManagement(){installManagementStyles();wireManagementEvents();installManagementObservers();if(isITAllowed())await renderITQueue();if(isServiceAllowed())await renderServiceHistory();if(isOwner()){ensureOwnerManagementCards();await renderOwnerReportsGrouped();await renderTestLab();}}
function scheduleManagementRender(){clearTimeout(manageRenderTimer);manageRenderTimer=setTimeout(renderManagement,120);}
function installManagement(){installManagementStyles();wireManagementEvents();installManagementObservers();scheduleManagementRender();const role=document.getElementById('whoRole');if(role)new MutationObserver(scheduleManagementRender).observe(role,{childList:true,subtree:true,characterData:true});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installManagement);else installManagement();

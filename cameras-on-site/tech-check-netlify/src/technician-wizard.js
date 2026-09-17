const wizDb = window.__techCheckDb;

let itCreateStep = 0;
let activeItPrepId = null;
let activeItPrepStep = 0;
let activeSvcPrepId = null;
let activeSvcStep = 0;
let inspectionStep = 0;
let wizTimer = null;

function wzRole(){ return document.getElementById('whoRole')?.textContent || ''; }
function wzIT(){ return wzRole().includes('IT Tech') || wzRole().includes('Owner/Admin'); }
function wzSvc(){ return wzRole().includes('Service Tech') || wzRole().includes('Owner/Admin'); }
function wzEsc(v){ return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[c]); }
function wzShow(el,on=true){ if(el) el.classList.toggle('wizard-hidden',!on); }
function wzText(el,text){ if(el) el.textContent=text; }

function installWizardStyles(){
  if(document.getElementById('techWizardStyles')) return;
  const s=document.createElement('style'); s.id='techWizardStyles'; s.textContent=`
    .wizard-hidden{display:none!important}
    .wizard-home{border:0!important;background:transparent!important;padding:0!important;box-shadow:none!important}
    .wizard-title{font-size:27px;font-weight:950;line-height:1.12;margin:4px 0 7px;color:#17212b}
    .wizard-sub{font-size:15px;color:#63707c;margin-bottom:14px}
    .wizard-menu{display:grid;gap:12px}
    .wizard-menu button,.wizard-big{width:100%;min-height:78px;border:0;border-radius:18px;padding:16px 18px;font-size:20px;font-weight:950;text-align:left;box-shadow:0 2px 7px rgba(0,0,0,.08)}
    .wizard-blue{background:#176fbd!important;color:#fff!important}.wizard-amber{background:#fff0cb!important;color:#825000!important}.wizard-green{background:#e3f6ea!important;color:#17653f!important}.wizard-gray{background:#edf1f4!important;color:#44515c!important}.wizard-red{background:#b82418!important;color:#fff!important}
    .wizard-count{float:right;border-radius:999px;padding:4px 9px;background:rgba(255,255,255,.8);color:#28343e;font-size:13px}
    .wizard-back{margin-bottom:12px;background:#edf1f4!important;color:#34414c!important;border:0!important;border-radius:12px!important;padding:11px 14px!important;font-weight:900!important;width:100%}
    .wizard-head{border:2px solid #b8d9f4;background:#f4faff;border-radius:15px;padding:13px;margin-bottom:13px}.wizard-head .step{font-size:11px;font-weight:950;color:#1769aa;text-transform:uppercase;letter-spacing:.4px}.wizard-head h2{margin:4px 0 2px!important;font-size:23px}.wizard-progress{height:7px;background:#e2e7eb;border-radius:999px;overflow:hidden;margin-top:9px}.wizard-progress span{display:block;height:100%;background:#1d74bd}
    .wizard-nav{display:grid;grid-template-columns:1fr 2fr;gap:9px;margin-top:14px}.wizard-nav button{min-height:54px;border:0;border-radius:13px;font-size:16px;font-weight:950}.wizard-prev{background:#edf1f4;color:#3d4a55}.wizard-next{background:#176fbd;color:#fff}.wizard-finish{background:#198754!important;color:#fff!important}
    .wizard-list{display:grid;gap:10px}.wizard-ticket{border:2px solid #dce3e9;background:#fff;border-radius:14px;padding:14px;text-align:left}.wizard-ticket b{font-size:18px}.wizard-ticket .small{margin-top:4px}.wizard-ticket button{margin-top:10px}
    .wizard-prep-card>.ticketHead{margin-bottom:12px}.wizard-prep-card .cos-rows{display:block}.wizard-prep-card .cos-struct-row{margin:0}.wizard-review{border:2px solid #a7d3b8;background:#effaf3;border-radius:13px;padding:12px;margin:10px 0}.wizard-review div{margin:5px 0}
    .wizard-question{border:2px solid #c6dff3;background:#f8fcff;border-radius:16px;padding:16px;margin:10px 0}.wizard-question-number{font-size:12px;font-weight:950;color:#1769aa;text-transform:uppercase}.wizard-question .pf-title{font-size:21px;margin:8px 0 15px}.wizard-question .pf-options{gap:12px}.wizard-question .pf-option{min-height:66px;font-size:18px;border-radius:14px}
    .wizard-fail-now{background:#ffebe9;border:2px solid #efaaa4;border-radius:13px;padding:12px;margin:12px 0;color:#9c2119}.wizard-fail-now a{display:block;margin-top:8px;background:#b82418;color:#fff!important;text-decoration:none;text-align:center;padding:13px;border-radius:10px;font-weight:950}
    .wizard-signature-replace{width:100%;margin-top:8px!important}
    .wizard-home-note{background:#f4f7f9;border-radius:12px;padding:10px;font-size:12px;color:#64717c;margin-top:13px}
    @media(max-width:560px){.wizard-title{font-size:25px}.wizard-menu button,.wizard-big{font-size:19px}.wizard-nav{grid-template-columns:1fr 1.6fr}}
  `; document.head.appendChild(s);
}

function itView(){ return document.getElementById('view-it'); }
function svcView(){ return document.getElementById('view-svc'); }
function itCreateCard(){ return document.getElementById('itTicket')?.closest('.card'); }
function itPrepCard(){ return document.getElementById('itPreps')?.closest('.card'); }
function itQueueCard(){ return document.getElementById('itWorkQueueCard'); }
function svcLookupCard(){ return document.getElementById('svcLookup')?.closest('.card'); }
function svcMatchedCard(){ return document.getElementById('matchedPreps')?.closest('.card'); }
function svcTruckCard(){ return document.getElementById('truckChecks')?.closest('.card'); }

function ensureBack(view,id,label,fnName){
  let b=document.getElementById(id); if(b) return b;
  b=document.createElement('button'); b.id=id; b.type='button'; b.className='wizard-back wizard-hidden'; b.textContent='← '+label; b.dataset.wizAction=fnName;
  view?.insertBefore(b,view.firstElementChild); return b;
}

function hideDirectChildren(view,keep=[]){
  if(!view) return;
  [...view.children].forEach(el=>wzShow(el,keep.includes(el)));
}

async function getPrepCounts(){
  if(!wizDb) return {draft:0,released:0,closed:0};
  const {data}=await wizDb.from('prep_tickets').select('status');
  const rows=data||[]; return {draft:rows.filter(x=>x.status==='draft').length,released:rows.filter(x=>x.status==='released').length,closed:rows.filter(x=>x.status==='closed').length};
}

async function ensureITHome(){
  const view=itView(); if(!view) return null;
  let home=document.getElementById('itWizardHome');
  if(!home){home=document.createElement('div');home.id='itWizardHome';home.className='card wizard-home';view.insertBefore(home,view.firstElementChild);}
  const c=await getPrepCounts();
  home.innerHTML=`<div class="wizard-title">What do you need to do?</div><div class="wizard-sub">Pick one. The app will walk you through the rest.</div><div class="wizard-menu"><button class="wizard-blue" data-wiz-it="new">＋ Start New Equipment Prep</button><button class="wizard-amber" data-wiz-it="pending">▶ Continue Pending Prep <span class="wizard-count">${c.draft}</span></button><button class="wizard-gray" data-wiz-it="history">☰ Status & History <span class="wizard-count">${c.released+c.closed}</span></button></div><div class="wizard-home-note">Only the current step is shown. Completed work stays out of the way in Status & History.</div>`;
  return home;
}

async function showITHome(){
  activeItPrepId=null; const view=itView(); if(!view) return;
  const home=await ensureITHome(); hideDirectChildren(view,[home]); window.scrollTo({top:0,behavior:'smooth'});
}

function ensureCreateHeader(card){
  let h=card.querySelector('#itCreateWizardHeader'); if(h) return h;
  h=document.createElement('div');h.id='itCreateWizardHeader';h.className='wizard-head';card.prepend(h);return h;
}
function ensureCreateNav(card){
  let n=card.querySelector('#itCreateWizardNav');if(n)return n;
  n=document.createElement('div');n.id='itCreateWizardNav';n.className='wizard-nav';n.innerHTML='<button class="wizard-prev" data-wiz-create="prev">Back</button><button class="wizard-next" data-wiz-create="next">Next</button>';card.appendChild(n);return n;
}
function createParts(card){
  return {section:card.querySelector('.sectiontitle'),intro:card.querySelector('.sectiontitle')?.nextElementSibling,ticket:card.querySelector('.grid'),eqTitle:[...card.querySelectorAll('h3')].find(x=>/Equipment Required/i.test(x.textContent)),eq:card.querySelector('.grid3'),recon:document.getElementById('reconBatteryWrap'),add:[...card.querySelectorAll('button')].find(b=>/Add Requirement/i.test(b.textContent)),draft:document.getElementById('needDraft'),create:[...card.querySelectorAll('button')].find(b=>/Create IT Equipment Prep/i.test(b.textContent)),msg:document.getElementById('itCreateMessage')};
}
function showCreateStep(step){
  const card=itCreateCard();if(!card)return;itCreateStep=Math.max(0,Math.min(2,step));const p=createParts(card);const h=ensureCreateHeader(card),nav=ensureCreateNav(card);
  [p.section,p.intro,p.ticket,p.eqTitle,p.eq,p.recon,p.add,p.draft,p.create,p.msg].forEach(x=>{if(x)x.style.display='none';});
  const labels=[['Step 1 of 3','Enter the MHelpDesk ticket'],['Step 2 of 3','Add what the ticket requires'],['Step 3 of 3','Review and create the prep']];
  h.innerHTML=`<div class="step">${labels[itCreateStep][0]}</div><h2>${labels[itCreateStep][1]}</h2><div class="wizard-progress"><span style="width:${((itCreateStep+1)/3)*100}%"></span></div>`;
  if(itCreateStep===0){if(p.ticket)p.ticket.style.display='grid';}
  if(itCreateStep===1){if(p.eqTitle)p.eqTitle.style.display='block';if(p.eq)p.eq.style.display='grid';if(p.add)p.add.style.display='block';if(p.draft)p.draft.style.display='block';if(p.recon)p.recon.style.display=document.getElementById('needType')?.value==='Recon 2'?'block':'none';}
  if(itCreateStep===2){if(p.ticket)p.ticket.style.display='grid';if(p.draft)p.draft.style.display='block';if(p.create)p.create.style.display='block';if(p.msg)p.msg.style.display='block';}
  nav.style.display='grid';const prev=nav.querySelector('[data-wiz-create="prev"]'),next=nav.querySelector('[data-wiz-create="next"]');prev.textContent=itCreateStep===0?'← IT Home':'Back';next.style.display=itCreateStep===2?'none':'block';
}
function startNewPrep(){
  const view=itView(),card=itCreateCard(),back=ensureBack(view,'itWizardBack','IT Home','it-home');if(!view||!card)return;hideDirectChildren(view,[back,card]);wzShow(back,true);showCreateStep(0);window.scrollTo({top:0,behavior:'smooth'});
}
function validateCreateNext(){
  if(itCreateStep===0 && !document.getElementById('itTicket')?.value.trim()){alert('Enter the MHelpDesk ticket number first.');return false;}
  if(itCreateStep===1 && !(document.getElementById('needDraft')?.children.length)){alert('Add at least one equipment requirement first.');return false;}
  return true;
}

async function showPendingChooser(){
  const view=itView(),back=ensureBack(view,'itWizardBack','IT Home','it-home');if(!view)return;let card=document.getElementById('itPendingChooser');if(!card){card=document.createElement('div');card.id='itPendingChooser';card.className='card';view.appendChild(card);}const {data}=await wizDb.from('prep_tickets').select('id,ticket_no,site,status,created_at').eq('status','draft').order('created_at',{ascending:true});const rows=data||[];card.innerHTML=`<div class="wizard-head"><div class="step">Pending IT Work</div><h2>${rows.length?'Choose a ticket to continue':'Nothing is waiting in IT'}</h2></div><div class="wizard-list">${rows.map(r=>`<div class="wizard-ticket"><b>MHelpDesk #${wzEsc(r.ticket_no)}</b><div class="small">${wzEsc(r.site||'No site / description')}</div><button class="wizard-big wizard-blue" data-wiz-open-it="${r.id}">Continue This Prep →</button></div>`).join('') || '<div class="ok"><b>No pending prep.</b><div class="small">Go back and start a new equipment prep.</div></div>'}</div>`;hideDirectChildren(view,[back,card]);wzShow(back,true);window.scrollTo({top:0,behavior:'smooth'});
}

function prepRows(card){return [...card.querySelectorAll('.cos-struct-row')];}
function prepEvidence(card){return card.querySelector('.evidence-panel[data-evidence-stage="it"]');}
function fixSingleSignature(panel){
  if(!panel)return;const saved=panel.querySelector('.evidence-saved'),sig=panel.querySelector('.evidence-signature');if(saved&&sig&&panel.dataset.replacing!=='true'){sig.style.display='none';let b=panel.querySelector('.wizard-signature-replace');if(!b){b=document.createElement('button');b.type='button';b.className='mini wizard-signature-replace';b.textContent='Replace Signature';b.dataset.wizReplaceSig='it';saved.after(b);}}}
function evidenceStep(panel,mode){
  if(!panel)return;fixSingleSignature(panel);const upload=panel.querySelector('.evidence-upload'),saved=panel.querySelector('.evidence-saved'),sig=panel.querySelector('.evidence-signature'),lock=panel.querySelector('.evidence-lock');
  [...panel.children].forEach(ch=>{if(ch.classList.contains('evidence-head')||ch.classList.contains('evidence-note'))ch.style.display='';else ch.style.display='none';});
  if(mode==='photo'){if(upload)upload.style.display='block';const gallery=panel.querySelector('.evidence-gallery');if(gallery?.parentElement)gallery.parentElement.style.display='block';}
  if(mode==='signature'){if(saved)saved.style.display='block';if(sig && (!saved || panel.dataset.replacing==='true'))sig.style.display='block';const rb=panel.querySelector('.wizard-signature-replace');if(rb)rb.style.display='block';}
  if(lock)lock.style.display='block';
}
function validateItUnit(row){
  if(!row.querySelector('.cos-unit-tag')?.value.trim()){alert('Enter the exact unit tag before continuing.');return false;}
  for(const cls of ['.cos-power','.cos-functions','.cos-safe']) if(!row.querySelector(cls)?.checked){alert('Complete all three unit checks before continuing.');return false;}
  if(row.querySelector('.cos-purpose')?.value==='DELIVERY'){const checks=[...row.querySelectorAll('.deliveryChecks input[type="checkbox"]')];if(checks.some(x=>!x.checked)){alert('Complete all DELIVERY readiness checks before continuing.');return false;}}
  return true;
}
function buildItReview(card){
  let r=card.querySelector('#itWizardReview');if(!r){r=document.createElement('div');r.id='itWizardReview';r.className='wizard-review';card.querySelector(':scope > .row')?.before(r);}const rows=prepRows(card);r.innerHTML='<b>Ready to send to Service</b>'+rows.map(x=>`<div>${wzEsc(x.querySelector('.cos-purpose')?.value)} · ${wzEsc(x.querySelector('.cos-eq')?.value)} · Unit ${wzEsc(x.querySelector('.cos-unit-tag')?.value||'')}</div>`).join('')+'<div class="small">Photos and signature must be saved before the Send button becomes active.</div>';return r;
}
function ensurePrepNav(card){
  let nav=card.querySelector('#itPrepWizardNav');if(nav)return nav;nav=document.createElement('div');nav.id='itPrepWizardNav';nav.className='wizard-nav';nav.innerHTML='<button class="wizard-prev" data-wiz-it-prep="prev">Back</button><button class="wizard-next" data-wiz-it-prep="next">Next</button>';card.appendChild(nav);return nav;
}
function ensurePrepHeader(card){let h=card.querySelector('#itPrepWizardHeader');if(h)return h;h=document.createElement('div');h.id='itPrepWizardHeader';h.className='wizard-head';card.prepend(h);return h;}
function showItPrepStep(){
  if(!activeItPrepId)return;const card=document.querySelector(`#itPreps [data-prep-id="${activeItPrepId}"]`);if(!card)return;card.classList.add('wizard-prep-card');const rows=prepRows(card),evidence=prepEvidence(card);const total=rows.length+4;activeItPrepStep=Math.max(0,Math.min(total-1,activeItPrepStep));const header=ensurePrepHeader(card),nav=ensurePrepNav(card);
  [...card.children].forEach(ch=>{if(ch===header||ch===nav)return;ch.style.display='none';});rows.forEach(r=>r.style.display='none');
  const ticketHead=card.querySelector(':scope > .ticketHead'),grid=card.querySelector(':scope > .grid'),rowsWrap=card.querySelector(':scope > .cos-rows'),action=card.querySelector(':scope > .row');
  let title=''; if(activeItPrepStep===0){title='Confirm ticket information';wzShow(ticketHead,true);wzShow(grid,true);} else if(activeItPrepStep<=rows.length){const i=activeItPrepStep-1;title=`Check unit ${i+1} of ${rows.length}`;wzShow(ticketHead,true);wzShow(rowsWrap,true);rows[i].style.display='block';} else if(activeItPrepStep===rows.length+1){title='Take photos of what is leaving';wzShow(ticketHead,true);wzShow(evidence,true);evidenceStep(evidence,'photo');} else if(activeItPrepStep===rows.length+2){title='IT signature';wzShow(ticketHead,true);wzShow(evidence,true);evidenceStep(evidence,'signature');} else {title='Review and send to Service';wzShow(ticketHead,true);const review=buildItReview(card);wzShow(review,true);wzShow(action,true);if(action){action.querySelector('.cos-save-draft')?.classList.add('wizard-hidden');action.querySelector('.cos-delete-prep')?.classList.add('wizard-hidden');}}
  header.innerHTML=`<div class="step">Step ${activeItPrepStep+1} of ${total}</div><h2>${title}</h2><div class="wizard-progress"><span style="width:${((activeItPrepStep+1)/total)*100}%"></span></div>`;
  const prev=nav.querySelector('[data-wiz-it-prep="prev"]'),next=nav.querySelector('[data-wiz-it-prep="next"]');next.style.display=activeItPrepStep===total-1?'none':'block';prev.textContent=activeItPrepStep===0?'← Pending Tickets':'Back';nav.style.display='grid';
}
async function openItPrep(id){
  activeItPrepId=id;activeItPrepStep=0;const view=itView(),back=ensureBack(view,'itWizardBack','IT Home','it-home'),pc=itPrepCard();if(!pc)return;hideDirectChildren(view,[back,pc]);wzShow(back,true);[...document.querySelectorAll('#itPreps > .item.prepared[data-prep-id]')].forEach(c=>wzShow(c,c.dataset.prepId===id));setTimeout(showItPrepStep,250);window.scrollTo({top:0,behavior:'smooth'});
}
function validateItPrepNext(){
  const card=document.querySelector(`#itPreps [data-prep-id="${activeItPrepId}"]`);if(!card)return false;const rows=prepRows(card),evidence=prepEvidence(card);if(activeItPrepStep===0&&!card.querySelector('.cos-ticket')?.value.trim()){alert('Enter the ticket number.');return false;}if(activeItPrepStep>0&&activeItPrepStep<=rows.length)return validateItUnit(rows[activeItPrepStep-1]);if(activeItPrepStep===rows.length+1&&!evidence?.querySelector('.evidence-photo')){alert('Upload at least one photo before continuing.');return false;}if(activeItPrepStep===rows.length+2&&!evidence?.querySelector('.evidence-saved')){alert('Save the IT signature before continuing.');return false;}return true;
}
async function showITHistory(){const view=itView(),back=ensureBack(view,'itWizardBack','IT Home','it-home'),q=itQueueCard(),h=document.getElementById('itHandoffCard');const keep=[back];if(q)keep.push(q);if(h)keep.push(h);hideDirectChildren(view,keep);wzShow(back,true);window.scrollTo({top:0,behavior:'smooth'});}

async function ensureSvcHome(){
  const view=svcView();if(!view)return null;let home=document.getElementById('svcWizardHome');if(!home){home=document.createElement('div');home.id='svcWizardHome';home.className='card wizard-home';view.insertBefore(home,view.firstElementChild);}home.innerHTML=`<div class="wizard-title">What are you doing now?</div><div class="wizard-sub">Choose one. You will only see one step at a time.</div><div class="wizard-menu"><button class="wizard-blue" data-wiz-svc="receive">1 · Receive Equipment</button><button class="wizard-amber" data-wiz-svc="inspection">2 · Truck / Trailer Inspection</button><button class="wizard-gray" data-wiz-svc="history">3 · History</button></div>`;return home;
}
async function showSvcHome(){activeSvcPrepId=null;const view=svcView();if(!view)return;const home=await ensureSvcHome();hideDirectChildren(view,[home]);window.scrollTo({top:0,behavior:'smooth'});}
function showSvcLookup(){const view=svcView(),back=ensureBack(view,'svcWizardBack','Service Home','svc-home'),card=svcLookupCard();if(!card)return;hideDirectChildren(view,[back,card]);wzShow(back,true);const h=card.querySelector('.sectiontitle h2');if(h)h.textContent='Step 1 — Enter the MHelpDesk Ticket';window.scrollTo({top:0,behavior:'smooth'});}
function svcEvidence(card){return card.querySelector('.evidence-panel[data-evidence-stage="service"]');}
function fixServiceSignature(panel){if(!panel)return;const saved=panel.querySelector('.evidence-saved'),sig=panel.querySelector('.evidence-signature');if(saved&&sig&&panel.dataset.replacing!=='true'){sig.style.display='none';let b=panel.querySelector('.wizard-signature-replace');if(!b){b=document.createElement('button');b.type='button';b.className='mini wizard-signature-replace';b.textContent='Replace Signature';b.dataset.wizReplaceSig='service';saved.after(b);}}}
function serviceEvidenceStep(panel,mode){if(!panel)return;fixServiceSignature(panel);evidenceStep(panel,mode);}
function ensureSvcPrepHeader(card){let h=card.querySelector('#svcPrepWizardHeader');if(h)return h;h=document.createElement('div');h.id='svcPrepWizardHeader';h.className='wizard-head';card.prepend(h);return h;}
function ensureSvcPrepNav(card){let n=card.querySelector('#svcPrepWizardNav');if(n)return n;n=document.createElement('div');n.id='svcPrepWizardNav';n.className='wizard-nav';n.innerHTML='<button class="wizard-prev" data-wiz-svc-prep="prev">Back</button><button class="wizard-next" data-wiz-svc-prep="next">Next</button>';card.appendChild(n);return n;}
function validateSvcUnit(unit){if(!unit.querySelector('input[id^="exact_"]')?.checked){alert('Confirm that you physically have this exact unit.');return false;}const count=unit.querySelector('input[id^="sbatt_"]');const ok=unit.querySelector('input[id^="sbattok_"]');if(count&&count.value===''){alert('Enter the battery or battery-box count.');return false;}if(ok&&!ok.checked){alert('Confirm the battery count before continuing.');return false;}return true;}
function showSvcPrepStep(){
  const prepCard=[...document.querySelectorAll('#matchedPreps > .item.prepared')].find(c=>c.dataset.prepId===activeSvcPrepId)||document.querySelector('#matchedPreps > .item.prepared');if(!prepCard)return;activeSvcPrepId=prepCard.dataset.prepId||activeSvcPrepId;const units=[...prepCard.querySelectorAll(':scope > .unitConfirm')],proof=prepCard.querySelector(':scope > .evidence-proof'),evidence=svcEvidence(prepCard),final=[...prepCard.querySelectorAll(':scope > button')].find(b=>/Complete Equipment Checkout Verification/i.test(b.textContent));const total=units.length+4;activeSvcStep=Math.max(0,Math.min(total-1,activeSvcStep));const header=ensureSvcPrepHeader(prepCard),nav=ensureSvcPrepNav(prepCard);
  [...prepCard.children].forEach(ch=>{if(ch===header||ch===nav)return;ch.style.display='none';});let title='';const ticket=prepCard.querySelector(':scope > .ticketHead'),stamp=prepCard.querySelector(':scope > .handoff-stamp-fixed');
  if(activeSvcStep===0){title='Compare IT photos before accepting';wzShow(ticket,true);wzShow(stamp,true);wzShow(proof,true);}else if(activeSvcStep<=units.length){const i=activeSvcStep-1;title=`Verify unit ${i+1} of ${units.length}`;wzShow(ticket,true);wzShow(units[i],true);}else if(activeSvcStep===units.length+1){title='Take photos of what you received';wzShow(ticket,true);wzShow(evidence,true);serviceEvidenceStep(evidence,'photo');}else if(activeSvcStep===units.length+2){title='Service signature';wzShow(ticket,true);wzShow(evidence,true);serviceEvidenceStep(evidence,'signature');}else{title='Final check — accept equipment';wzShow(ticket,true);wzShow(stamp,true);wzShow(final,true);}
  header.innerHTML=`<div class="step">Step ${activeSvcStep+1} of ${total}</div><h2>${title}</h2><div class="wizard-progress"><span style="width:${((activeSvcStep+1)/total)*100}%"></span></div>`;const next=nav.querySelector('[data-wiz-svc-prep="next"]');next.style.display=activeSvcStep===total-1?'none':'block';nav.querySelector('[data-wiz-svc-prep="prev"]').textContent=activeSvcStep===0?'← Ticket Lookup':'Back';
}
function validateSvcNext(){const card=[...document.querySelectorAll('#matchedPreps > .item.prepared')].find(c=>c.dataset.prepId===activeSvcPrepId)||document.querySelector('#matchedPreps > .item.prepared');if(!card)return false;const units=[...card.querySelectorAll(':scope > .unitConfirm')],evidence=svcEvidence(card);if(activeSvcStep>0&&activeSvcStep<=units.length)return validateSvcUnit(units[activeSvcStep-1]);if(activeSvcStep===units.length+1&&!evidence?.querySelector('.evidence-photo')){alert('Take or upload at least one Service receipt photo.');return false;}if(activeSvcStep===units.length+2&&!evidence?.querySelector('.evidence-saved')){alert('Save the Service signature before continuing.');return false;}return true;}
function openSvcMatchedWizard(){const view=svcView(),back=ensureBack(view,'svcWizardBack','Service Home','svc-home'),card=svcMatchedCard();if(!card)return;hideDirectChildren(view,[back,card]);wzShow(back,true);const prep=document.querySelector('#matchedPreps > .item.prepared');if(!prep)return;activeSvcPrepId=prep.dataset.prepId||null;activeSvcStep=0;setTimeout(showSvcPrepStep,300);window.scrollTo({top:0,behavior:'smooth'});}

function inspectionQuestionEls(){return [...document.querySelectorAll('#truckChecks .pf-check')];}
function trailerQuestionEls(){return [...document.querySelectorAll('#trailerChecks .pf-check')];}
function ensureInspectionUI(card){
  let h=card.querySelector('#inspectionWizardHeader');if(!h){h=document.createElement('div');h.id='inspectionWizardHeader';h.className='wizard-head';card.prepend(h);}let review=card.querySelector('#inspectionReviewJobs');if(!review){review=document.createElement('div');review.id='inspectionReviewJobs';review.className='wizard-question';review.innerHTML='<div class="wizard-question-number">Before inspection</div><div class="pf-title">Did you review today’s MHelpDesk jobs?</div><button class="wizard-big wizard-blue" data-wiz-reviewed="yes">Yes — I reviewed them</button>';}if(!review.parentElement)card.appendChild(review);let trailer=card.querySelector('#inspectionTrailerChoice');if(!trailer){trailer=document.createElement('div');trailer.id='inspectionTrailerChoice';trailer.className='wizard-question';trailer.innerHTML='<div class="wizard-question-number">Trailer</div><div class="pf-title">Are you taking a trailer today?</div><div class="wizard-nav"><button class="wizard-prev" data-wiz-trailer="no">No Trailer</button><button class="wizard-next" data-wiz-trailer="yes">Yes, Taking Trailer</button></div>';card.appendChild(trailer);}let nav=card.querySelector('#inspectionWizardNav');if(!nav){nav=document.createElement('div');nav.id='inspectionWizardNav';nav.className='wizard-nav';nav.innerHTML='<button class="wizard-prev" data-wiz-inspect="prev">Back</button><button class="wizard-next" data-wiz-inspect="next">Next</button>';card.appendChild(nav);}let fail=card.querySelector('#inspectionWizardFail');if(!fail){fail=document.createElement('div');fail.id='inspectionWizardFail';fail.className='wizard-fail-now wizard-hidden';fail.innerHTML='<b>FAILED ITEM — STOP AND CALL OPERATIONS MANAGER</b><a href="tel:+13463149208">Call Operations Manager — (346) 314-9208</a>';card.appendChild(fail);}return {h,review,trailer,nav,fail};
}
function inspectionSequence(){const taking=!!document.getElementById('takingTrailer')?.checked;return [{type:'review'},...inspectionQuestionEls().map((el,i)=>({type:'truck',el,i})),{type:'trailerChoice'},...(taking?trailerQuestionEls().map((el,i)=>({type:'trailer',el,i})):[]),{type:'submit'}];}
function showInspectionStep(){
  const card=svcTruckCard();if(!card)return;const ui=ensureInspectionUI(card),seq=inspectionSequence();inspectionStep=Math.max(0,Math.min(seq.length-1,inspectionStep));inspectionQuestionEls().forEach(x=>x.style.display='none');trailerQuestionEls().forEach(x=>x.style.display='none');wzShow(document.getElementById('truckChecks'),false);wzShow(document.getElementById('trailerArea'),false);wzShow(document.getElementById('truckStatus'),false);const originalTrailer=document.getElementById('takingTrailer')?.closest('.check');wzShow(originalTrailer,false);[ui.review,ui.trailer].forEach(x=>wzShow(x,false));const submit=[...card.querySelectorAll(':scope > button')].find(b=>/Submit Morning/i.test(b.textContent));wzShow(submit,false);wzShow(document.getElementById('morningMessage'),false);wzShow(document.getElementById('operationsCallBox'),false);const cur=seq[inspectionStep];let title='';
  if(cur.type==='review'){title='Review MHelpDesk jobs';wzShow(ui.review,true);}if(cur.type==='truck'){title=`Truck check ${cur.i+1} of ${inspectionQuestionEls().length}`;wzShow(document.getElementById('truckChecks'),true);cur.el.style.display='block';cur.el.classList.add('wizard-question');}if(cur.type==='trailerChoice'){title='Trailer today?';wzShow(ui.trailer,true);}if(cur.type==='trailer'){title=`Trailer check ${cur.i+1} of ${trailerQuestionEls().length}`;wzShow(document.getElementById('trailerArea'),true);document.getElementById('trailerArea')?.classList.remove('hidden');cur.el.style.display='block';cur.el.classList.add('wizard-question');}if(cur.type==='submit'){title='Review and submit to Owner';wzShow(document.getElementById('truckStatus'),true);wzShow(submit,true);wzShow(document.getElementById('morningMessage'),true);wzShow(document.getElementById('operationsCallBox'),true);}
  ui.h.innerHTML=`<div class="step">Step ${inspectionStep+1} of ${seq.length}</div><h2>${title}</h2><div class="wizard-progress"><span style="width:${((inspectionStep+1)/seq.length)*100}%"></span></div>`;ui.nav.style.display=cur.type==='trailerChoice'||cur.type==='submit'?'none':'grid';ui.nav.querySelector('[data-wiz-inspect="prev"]').textContent=inspectionStep===0?'← Service Home':'Back';ui.nav.querySelector('[data-wiz-inspect="next"]').style.display=cur.type==='review'?'none':'block';const failed=document.querySelector('#truckChecks input[value="false"]:checked')||document.querySelector('#trailerChecks input[value="false"]:checked');wzShow(ui.fail,!!failed);
}
function showInspection(){const view=svcView(),back=ensureBack(view,'svcWizardBack','Service Home','svc-home'),card=svcTruckCard();if(!card)return;hideDirectChildren(view,[back,card]);wzShow(back,true);inspectionStep=0;showInspectionStep();window.scrollTo({top:0,behavior:'smooth'});}
function validateInspectionNext(){const seq=inspectionSequence(),cur=seq[inspectionStep];if(cur?.type==='truck'||cur?.type==='trailer'){if(!cur.el.querySelector('input[type="radio"]:checked')){alert('Choose PASS or FAIL before continuing.');return false;}}return true;}
function showSvcHistory(){const view=svcView(),back=ensureBack(view,'svcWizardBack','Service Home','svc-home'),history=document.getElementById('serviceInspectionHistory');if(!history){alert('No inspection history is available yet.');return;}hideDirectChildren(view,[back,history]);wzShow(back,true);history.querySelector('details')?.setAttribute('open','');window.scrollTo({top:0,behavior:'smooth'});}

function heartbeat(){
  clearTimeout(wizTimer);wizTimer=setTimeout(()=>{
    installWizardStyles();document.querySelectorAll('.evidence-panel').forEach(p=>{if(p.dataset.evidenceStage==='it')fixSingleSignature(p);else fixServiceSignature(p);});
    if(activeItPrepId)showItPrepStep();if(activeSvcPrepId)showSvcPrepStep();
    const it=viewVisible(itView());if(it&&!activeItPrepId&&!document.getElementById('itWizardHome')?.classList.contains('wizard-hidden'))ensureITHome();
  },120);
}
function viewVisible(v){return v&&!v.classList.contains('hidden');}

document.addEventListener('click',async ev=>{
  const it=ev.target.closest('[data-wiz-it]');if(it){if(it.dataset.wizIt==='new')startNewPrep();if(it.dataset.wizIt==='pending')showPendingChooser();if(it.dataset.wizIt==='history')showITHistory();return;}
  const a=ev.target.closest('[data-wiz-action]');if(a){if(a.dataset.wizAction==='it-home')showITHome();if(a.dataset.wizAction==='svc-home')showSvcHome();return;}
  const c=ev.target.closest('[data-wiz-create]');if(c){if(c.dataset.wizCreate==='prev'){if(itCreateStep===0)showITHome();else showCreateStep(itCreateStep-1);}else if(validateCreateNext())showCreateStep(itCreateStep+1);return;}
  const open=ev.target.closest('[data-wiz-open-it]');if(open){openItPrep(open.dataset.wizOpenIt);return;}
  const ip=ev.target.closest('[data-wiz-it-prep]');if(ip){if(ip.dataset.wizItPrep==='prev'){if(activeItPrepStep===0)showPendingChooser();else{activeItPrepStep--;showItPrepStep();}}else if(validateItPrepNext()){activeItPrepStep++;showItPrepStep();}return;}
  const rep=ev.target.closest('[data-wiz-replace-sig]');if(rep){const panel=rep.closest('.evidence-panel');if(panel){panel.dataset.replacing='true';const sig=panel.querySelector('.evidence-signature');if(sig)sig.style.display='block';rep.style.display='none';}return;}
  const sigReplace=ev.target.closest('.wizard-signature-replace');if(sigReplace){const panel=sigReplace.closest('.evidence-panel');if(panel){panel.dataset.replacing='true';const sig=panel.querySelector('.evidence-signature');if(sig)sig.style.display='block';sigReplace.style.display='none';}return;}
  const sm=ev.target.closest('[data-wiz-svc]');if(sm){if(sm.dataset.wizSvc==='receive')showSvcLookup();if(sm.dataset.wizSvc==='inspection')showInspection();if(sm.dataset.wizSvc==='history')showSvcHistory();return;}
  const sp=ev.target.closest('[data-wiz-svc-prep]');if(sp){if(sp.dataset.wizSvcPrep==='prev'){if(activeSvcStep===0)showSvcLookup();else{activeSvcStep--;showSvcPrepStep();}}else if(validateSvcNext()){activeSvcStep++;showSvcPrepStep();}return;}
  const rev=ev.target.closest('[data-wiz-reviewed]');if(rev){const cb=document.getElementById('mhelpReviewed');if(cb){cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));}inspectionStep++;showInspectionStep();return;}
  const tr=ev.target.closest('[data-wiz-trailer]');if(tr){const cb=document.getElementById('takingTrailer');if(cb){cb.checked=tr.dataset.wizTrailer==='yes';cb.dispatchEvent(new Event('change',{bubbles:true}));}inspectionStep++;showInspectionStep();return;}
  const ins=ev.target.closest('[data-wiz-inspect]');if(ins){if(ins.dataset.wizInspect==='prev'){if(inspectionStep===0)showSvcHome();else{inspectionStep--;showInspectionStep();}}else if(validateInspectionNext()){inspectionStep++;showInspectionStep();}return;}
  if(ev.target.closest('#tab-it'))setTimeout(showITHome,180);if(ev.target.closest('#tab-svc'))setTimeout(showSvcHome,180);
  if(ev.target.closest('button[onclick*="findPrep"]'))setTimeout(()=>{if(document.querySelector('#matchedPreps > .item.prepared'))openSvcMatchedWizard();},500);
  if(ev.target.closest('.evidence-upload-photos,.evidence-save-signature'))setTimeout(heartbeat,650);
  if(ev.target.closest('.cos-send-service'))setTimeout(showITHome,700);
  if(ev.target.closest('button[onclick*="closePreparedTicket"]'))setTimeout(showSvcHome,700);
  if(ev.target.closest('button[onclick*="createPrep"]'))setTimeout(()=>{if(/created/i.test(document.getElementById('itCreateMessage')?.textContent||''))showPendingChooser();},700);
  if(ev.target.closest('#truckChecks .pf-option,#trailerChecks .pf-option'))setTimeout(showInspectionStep,100);
});

function installWizard(){
  installWizardStyles();ensureBack(itView(),'itWizardBack','IT Home','it-home');ensureBack(svcView(),'svcWizardBack','Service Home','svc-home');
  if(wzIT())ensureITHome();if(wzSvc())ensureSvcHome();
  setTimeout(()=>{if(viewVisible(itView()))showITHome();if(viewVisible(svcView()))showSvcHome();},450);
  setInterval(heartbeat,1200);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installWizard);else installWizard();

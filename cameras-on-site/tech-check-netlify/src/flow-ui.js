const flowDb = window.__techCheckDb;
let flowTimer = null;
let flowSubmittingWrapped = false;

const FLOW_TRUCK_LABELS = [
  'Fuel level', 'Tires', 'Headlights / signals / brake lights', 'Windshield / mirrors',
  'Visible fluid leaks', 'Tools / service supplies', 'Ladders / cargo / equipment secured', 'Truck cab / bed organized'
];
const FLOW_TRAILER_LABELS = [
  'Trailer tires','Hitch / coupler','Safety chains','Trailer plug / lights / signals',
  'Jack / supports','Load balance / tie-down','Structural condition'
];

function flEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[c]);}
function flRole(){return document.getElementById('whoRole')?.textContent||'';}
function flOwner(){return flRole().includes('Owner/Admin');}
function flIT(){return flRole().includes('IT Tech')||flOwner();}
function flService(){return flRole().includes('Service Tech')||flOwner();}
function flAllBooleanValues(obj){return Object.values(obj||{}).filter(v=>typeof v==='boolean');}
function flFailedLabels(obj,labels,prefix){const out=[];for(let i=0;i<labels.length;i++){if(obj?.[`${prefix}_${i+1}`]===false)out.push(labels[i]);}return out;}

function installFlowStyles(){
  if(document.getElementById('cosFlowStyles'))return;
  const s=document.createElement('style');s.id='cosFlowStyles';s.textContent=`
    :root{--fblue:#1769aa;--fblue2:#e8f4ff;--famber:#9a5c00;--famber2:#fff3d8;--fgreen:#177245;--fgreen2:#e8f7ef;--fred:#af261d;--fred2:#ffebe9;--fgray:#596672;--fgray2:#f0f3f6}
    .flow-guide{border:2px solid #bfdcf3!important;background:linear-gradient(180deg,#f5fbff,#fff)!important}.flow-guide .small{color:#53697b}
    .flow-steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-top:12px}.flow-steps.three{grid-template-columns:repeat(3,minmax(0,1fr))}
    .flow-step{border:2px solid #d7dee5;background:#fff;border-radius:13px;padding:10px 6px;text-align:center;min-height:68px;display:flex;flex-direction:column;justify-content:center;gap:3px}.flow-step b{font-size:12px}.flow-step span{font-size:10px;font-weight:800;color:#697682}
    .flow-step.current{border-color:var(--fblue);background:var(--fblue2);box-shadow:0 0 0 2px rgba(23,105,170,.08)}.flow-step.current b{color:var(--fblue)}
    .flow-step.done{border-color:#8fcdaa;background:var(--fgreen2)}.flow-step.done b{color:var(--fgreen)}.flow-step.wait{border-color:#e4b45e;background:var(--famber2)}.flow-step.wait b{color:var(--famber)}
    .flow-status{display:inline-flex;align-items:center;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:900;white-space:nowrap}.flow-status.pending{background:var(--famber2);color:var(--famber)}.flow-status.waiting{background:var(--fblue2);color:var(--fblue)}.flow-status.complete{background:var(--fgreen2);color:var(--fgreen)}.flow-status.fail{background:var(--fred2);color:var(--fred)}.flow-status.history{background:var(--fgray2);color:var(--fgray)}
    .flow-queue-pills{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0}.flow-queue-pills button{border:0;border-radius:999px;padding:8px 11px;font-size:12px;font-weight:900}.flow-queue-pills .pending{background:var(--famber2);color:var(--famber)}.flow-queue-pills .waiting{background:var(--fblue2);color:var(--fblue)}.flow-queue-pills .complete{background:var(--fgreen2);color:var(--fgreen)}.flow-queue-pills .history{background:var(--fgray2);color:var(--fgray)}
    #itWorkQueueCard details>summary{border-left:5px solid #aab4be}.flow-summary-pending{background:var(--famber2)!important;border-left-color:#d99a28!important}.flow-summary-waiting{background:var(--fblue2)!important;border-left-color:var(--fblue)!important}.flow-summary-complete{background:var(--fgreen2)!important;border-left-color:var(--fgreen)!important}.flow-summary-history{background:var(--fgray2)!important;border-left-color:#7d8b96!important}
    .flow-add-toggle{background:#e9f4fe!important;color:#135e94!important;margin:10px 0}.flow-add-hidden{display:none!important}
    .flow-step-card{border-left:6px solid var(--fblue)!important}.flow-step-card.waiting{border-left-color:#d89927!important}.flow-step-card.complete{border-left-color:var(--fgreen)!important}
    .inspection-history details{border:1px solid #dbe2e8;border-radius:12px;overflow:hidden}.inspection-history summary{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px;background:var(--fgray2);font-weight:900;cursor:pointer}.inspection-history-body{padding:10px}
    .inspection-record{border:1px solid #dfe5ea;border-radius:11px;padding:10px;margin-top:8px;background:#fff}.inspection-record:first-child{margin-top:0}.inspection-record.failed{border-color:#efb2ad;background:#fff8f7}.inspection-record.okay{border-color:#b8ddc9;background:#f8fcfa}.inspection-meta{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.inspection-fails{margin-top:7px;padding:7px;background:#fff0ef;border-radius:8px;color:#962219;font-size:12px}
    .flow-current-inspection{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}.flow-current-inspection b{font-size:17px}.flow-current-inspection .flow-status{font-size:12px}
    @media(max-width:620px){.flow-steps{grid-template-columns:repeat(2,minmax(0,1fr))}.flow-steps.three{grid-template-columns:repeat(3,minmax(0,1fr))}}
  `;document.head.appendChild(s);
}

function ensureGuide(viewId,id,title,subtitle,steps){
  const view=document.getElementById(viewId);if(!view)return null;let card=document.getElementById(id);if(card)return card;
  card=document.createElement('div');card.id=id;card.className='card flow-guide';card.innerHTML=`<div class="sectiontitle"><h2>${flEsc(title)}</h2><span class="pill">Workflow</span></div><div class="small">${flEsc(subtitle)}</div><div class="flow-steps ${steps.length===3?'three':''}">${steps.map((s,i)=>`<div class="flow-step" data-flow-step="${i}"><b>${flEsc(s.title)}</b><span>${flEsc(s.sub)}</span></div>`).join('')}</div>`;
  view.insertBefore(card,view.firstElementChild);return card;
}

function setGuide(card,current,doneBefore=true){if(!card)return;card.querySelectorAll('.flow-step').forEach((el,i)=>{el.classList.remove('current','done','wait');if(i===current)el.classList.add('current');else if(doneBefore&&i<current)el.classList.add('done');else if(i>current)el.classList.add('wait');});}

async function updateGuides(){
  if(!flowDb)return;
  if(flIT()){
    const card=ensureGuide('view-it','itFlowGuide','IT Equipment Handoff','Work left to right. Old work stays in the compact queue below.',[
      {title:'1 · Create Ticket',sub:'Read MHelpDesk'}, {title:'2 · Prepare & Verify',sub:'Unit tags + checks'}, {title:'3 · Photo, Sign & Send',sub:'Handoff to Service'}
    ]);
    const {data}=await flowDb.from('prep_tickets').select('status').order('created_at',{ascending:false}).limit(50);
    const drafts=(data||[]).filter(x=>x.status==='draft').length, waiting=(data||[]).filter(x=>x.status==='released').length;
    setGuide(card,drafts?1:waiting?2:0,drafts||waiting);
  }
  if(flService()){
    const card=ensureGuide('view-svc','serviceFlowGuide','Service Tech Morning Flow','Complete each step in order before leaving the shop.',[
      {title:'1 · Receive',sub:'Match ticket'}, {title:'2 · Verify',sub:'Photo + signature'}, {title:'3 · Inspect',sub:'Truck / trailer'}, {title:'4 · Submit',sub:'Owner receives report'}
    ]);
    const matched=document.querySelectorAll('#matchedPreps > .item.prepared').length;
    const reviewed=!!document.getElementById('mhelpReviewed')?.checked;
    const radios=[...document.querySelectorAll('#truckChecks input[type="radio"]:checked')].length;
    let current=0;if(matched)current=1;else if(reviewed||radios)current=2;
    const today=await fetchInspectionHistory();if(today.some(r=>{const d=new Date(r.submitted_at),n=new Date();return d.toDateString()===n.toDateString();}))current=3;
    setGuide(card,current,true);
  }
}

function decorateITQueue(){
  const card=document.getElementById('itWorkQueueCard');if(!card)return;
  const sections=document.getElementById('itQueueSections');if(!sections)return;
  const details=[...sections.querySelectorAll(':scope > details')];
  const classes=['flow-summary-pending','flow-summary-waiting','flow-summary-complete'];details.forEach((d,i)=>d.querySelector('summary')?.classList.add(classes[i]||'flow-summary-history'));
  const search=[...card.querySelectorAll(':scope > details')].find(d=>/Search Equipment History/i.test(d.querySelector('summary')?.textContent||''));search?.querySelector('summary')?.classList.add('flow-summary-history');
  let pills=card.querySelector('.flow-queue-pills');if(!pills){pills=document.createElement('div');pills.className='flow-queue-pills';sections.before(pills);}
  const labels=[['Pending','pending'],['Waiting for Service','waiting'],['Completed','complete']];pills.innerHTML=labels.map((x,i)=>`<button type="button" class="${x[1]}" data-flow-detail="${i}">${x[0]} ${details[i]?.querySelector('.mgmt-count')?.textContent||'0'}</button>`).join('')+`<button type="button" class="history" data-flow-history="true">History Search</button>`;
}

function collapseAddEquipment(){
  document.querySelectorAll('#itPreps .item.prepared[data-prep-id]').forEach(card=>{
    const box=card.querySelector('.unitForm');if(!box||box.dataset.flowCollapsed==='true')return;box.dataset.flowCollapsed='true';box.classList.add('flow-add-hidden');
    const btn=document.createElement('button');btn.type='button';btn.className='mini full flow-add-toggle';btn.textContent='+ Add Another Equipment Item';box.before(btn);
  });
}

function decorateServiceCards(){
  const start=document.getElementById('svcLookup')?.closest('.card');if(start){start.classList.add('flow-step-card');const h=start.querySelector('h2');if(h&&!h.dataset.flowNamed){h.dataset.flowNamed='true';h.textContent='Step 1 — Receive IT-Prepared Equipment';}}
  const matched=document.getElementById('matchedPreps')?.closest('.card');if(matched){matched.classList.add('flow-step-card');const h=matched.querySelector('h2');if(h&&!h.dataset.flowNamed){h.dataset.flowNamed='true';h.textContent='Step 2 — Verify Equipment Received';}}
  const truck=document.getElementById('truckChecks')?.closest('.card');if(truck){truck.classList.add('flow-step-card');let head=truck.querySelector('.flow-current-inspection');if(!head){const old=truck.querySelector('h2');if(old)old.style.display='none';head=document.createElement('div');head.className='flow-current-inspection';head.innerHTML='<b>Step 3 — Truck / Trailer Inspection</b><span class="flow-status pending">CURRENT CHECK</span>';truck.insertBefore(head,truck.firstElementChild);}const submit=[...truck.querySelectorAll('button')].find(b=>/Finish & Submit Morning Check/i.test(b.textContent));if(submit)submit.textContent='Step 4 — Submit Morning Readiness to Owner';}
}

async function fetchInspectionHistory(){if(!flowDb||!flService())return[];const{data,error}=await flowDb.from('morning_checks').select('*').order('submitted_at',{ascending:false}).limit(60);return error?[]:(data||[]);}
function inspectionRecordHtml(r){
  const truckVals=flAllBooleanValues(r.truck_checks),truckFail=truckVals.some(v=>v===false);const trailerVals=flAllBooleanValues(r.trailer_checks),trailerFail=!!r.taking_trailer&&trailerVals.some(v=>v===false);const failed=truckFail||trailerFail;
  const fails=[...flFailedLabels(r.truck_checks,FLOW_TRUCK_LABELS,'truck'),...flFailedLabels(r.trailer_checks,FLOW_TRAILER_LABELS,'trailer')];
  return `<div class="inspection-record ${failed?'failed':'okay'}"><div class="inspection-meta"><div><b>${new Date(r.submitted_at).toLocaleDateString()}</b><div class="small">${new Date(r.submitted_at).toLocaleTimeString()}</div></div>${failed?'<span class="flow-status fail">FAILED — MANAGER CALL</span>':'<span class="flow-status complete">PASSED</span>'}</div><div class="small top8"><b>Truck:</b> ${truckFail?'FAILED':'PASS'} · <b>Trailer:</b> ${!r.taking_trailer?'Not taken':trailerFail?'FAILED':'PASS'}</div>${fails.length?`<div class="inspection-fails"><b>Failed items:</b> ${fails.map(flEsc).join(' · ')}</div>`:''}</div>`;
}
async function renderInspectionHistory(){
  if(!flService())return;const truck=document.getElementById('truckChecks')?.closest('.card');if(!truck)return;let card=document.getElementById('serviceInspectionHistory');if(!card){card=document.createElement('div');card.id='serviceInspectionHistory';card.className='card inspection-history';card.innerHTML='<details><summary><span>Inspection History</span><span id="inspectionHistoryCount" class="flow-status history">0 submitted</span></summary><div id="inspectionHistoryBody" class="inspection-history-body"></div></details>';truck.before(card);}const rows=await fetchInspectionHistory();const count=card.querySelector('#inspectionHistoryCount'),body=card.querySelector('#inspectionHistoryBody');if(count)count.textContent=`${rows.length} submitted`;if(body)body.innerHTML=rows.length?rows.map(inspectionRecordHtml).join(''):'<div class="small">No submitted truck/trailer inspections yet.</div>';
}

function wrapSubmit(){if(flowSubmittingWrapped||typeof window.submitMorning!=='function')return;flowSubmittingWrapped=true;const original=window.submitMorning;window.submitMorning=async function(...args){await original(...args);setTimeout(async()=>{const message=document.getElementById('morningMessage');if(/submitted/i.test(message?.textContent||'')){const duplicate=document.getElementById('operationsCallBox');if(duplicate)duplicate.innerHTML='';await renderInspectionHistory();await updateGuides();document.getElementById('serviceInspectionHistory')?.querySelector('details')?.setAttribute('open','');}},120);};}

function flowRefresh(){clearTimeout(flowTimer);flowTimer=setTimeout(async()=>{decorateITQueue();collapseAddEquipment();decorateServiceCards();await renderInspectionHistory();await updateGuides();wrapSubmit();},110);}
function observeFlow(id){const n=document.getElementById(id);if(!n||n.dataset.flowObserved==='true')return;n.dataset.flowObserved='true';new MutationObserver(flowRefresh).observe(n,{childList:true});}

document.addEventListener('click',ev=>{const add=ev.target.closest('.flow-add-toggle');if(add){const box=add.nextElementSibling;box?.classList.toggle('flow-add-hidden');add.textContent=box?.classList.contains('flow-add-hidden')?'+ Add Another Equipment Item':'− Hide Add Equipment';return;}const nav=ev.target.closest('[data-flow-detail]');if(nav){const i=Number(nav.dataset.flowDetail),details=[...document.querySelectorAll('#itQueueSections > details')];details.forEach((d,j)=>d.open=j===i);details[i]?.scrollIntoView({behavior:'smooth',block:'start'});return;}const hist=ev.target.closest('[data-flow-history]');if(hist){const d=[...document.querySelectorAll('#itWorkQueueCard > details')].find(x=>/Search Equipment History/i.test(x.querySelector('summary')?.textContent||''));if(d){d.open=true;d.scrollIntoView({behavior:'smooth',block:'start'});}return;}});
document.addEventListener('change',ev=>{if(ev.target.closest('#view-svc'))flowRefresh();});

function flowInstall(){installFlowStyles();observeFlow('itPreps');observeFlow('itQueueSections');observeFlow('matchedPreps');flowRefresh();setTimeout(()=>{observeFlow('itPreps');observeFlow('itQueueSections');observeFlow('matchedPreps');flowRefresh();},450);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',flowInstall);else flowInstall();

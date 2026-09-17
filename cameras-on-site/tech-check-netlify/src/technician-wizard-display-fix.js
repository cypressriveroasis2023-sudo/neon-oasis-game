function wfForce(el,display){if(!el)return;el.style.setProperty('display',display,'important');}
function wfHide(el){if(!el)return;el.style.setProperty('display','none','important');}
function wfVisible(el){return !!el && !el.closest('.wizard-hidden') && !el.classList.contains('wizard-hidden');}
function wfStep(header){const m=(header?.querySelector('.step')?.textContent||'').match(/(\d+)/);return m?Number(m[1]):1;}

function repairCreateWizard(){
  const card=document.getElementById('itTicket')?.closest('.card'),head=card?.querySelector('#itCreateWizardHeader');
  if(!card||!head||card.classList.contains('wizard-hidden'))return;
  const step=wfStep(head),section=card.querySelector('.sectiontitle'),intro=section?.nextElementSibling,ticket=card.querySelector('.grid'),eqTitle=[...card.querySelectorAll('h3')].find(x=>/Equipment Required/i.test(x.textContent)),eq=card.querySelector('.grid3'),recon=document.getElementById('reconBatteryWrap'),add=[...card.querySelectorAll('button')].find(b=>/Add Requirement/i.test(b.textContent)),draft=document.getElementById('needDraft'),create=[...card.querySelectorAll('button')].find(b=>/Create IT Equipment Prep/i.test(b.textContent)),msg=document.getElementById('itCreateMessage'),nav=card.querySelector('#itCreateWizardNav');
  [section,intro,ticket,eqTitle,eq,recon,add,draft,create,msg].forEach(wfHide);wfForce(head,'block');wfForce(nav,'grid');
  if(step===1)wfForce(ticket,'grid');
  if(step===2){wfForce(eqTitle,'block');wfForce(eq,'grid');wfForce(add,'block');wfForce(draft,'block');if(document.getElementById('needType')?.value==='Recon 2')wfForce(recon,'block');}
  if(step===3){wfForce(ticket,'grid');wfForce(draft,'block');wfForce(create,'block');wfForce(msg,'block');}
}

function repairItPrepWizard(){
  const head=document.querySelector('#itPreps #itPrepWizardHeader');if(!head)return;const card=head.closest('.item.prepared');if(!card||card.closest('.card')?.classList.contains('wizard-hidden'))return;
  const step=wfStep(head),rows=[...card.querySelectorAll('.cos-struct-row')],ticket=card.querySelector(':scope > .ticketHead'),grid=card.querySelector(':scope > .grid'),rowsWrap=card.querySelector(':scope > .cos-rows'),evidence=card.querySelector(':scope > .evidence-panel[data-evidence-stage="it"]'),review=card.querySelector('#itWizardReview'),action=card.querySelector(':scope > .row'),nav=card.querySelector('#itPrepWizardNav');
  [...card.children].forEach(ch=>{if(ch!==head&&ch!==nav)wfHide(ch);});rows.forEach(wfHide);wfForce(head,'block');wfForce(nav,'grid');
  if(step===1){wfForce(ticket,'flex');wfForce(grid,'grid');}
  else if(step<=rows.length+1){wfForce(ticket,'flex');wfForce(rowsWrap,'block');wfForce(rows[step-2],'block');}
  else if(step===rows.length+2||step===rows.length+3){wfForce(ticket,'flex');wfForce(evidence,'block');}
  else {wfForce(ticket,'flex');wfForce(review,'block');wfForce(action,'flex');}
}

function repairServicePrepWizard(){
  const head=document.querySelector('#matchedPreps #svcPrepWizardHeader');if(!head)return;const card=head.closest('.item.prepared');if(!card||card.closest('.card')?.classList.contains('wizard-hidden'))return;
  const step=wfStep(head),units=[...card.querySelectorAll(':scope > .unitConfirm')],ticket=card.querySelector(':scope > .ticketHead'),stamp=card.querySelector(':scope > .handoff-stamp-fixed'),proof=card.querySelector(':scope > .evidence-proof'),evidence=card.querySelector(':scope > .evidence-panel[data-evidence-stage="service"]'),final=[...card.querySelectorAll(':scope > button')].find(b=>/Complete Equipment Checkout Verification/i.test(b.textContent)),nav=card.querySelector('#svcPrepWizardNav');
  [...card.children].forEach(ch=>{if(ch!==head&&ch!==nav)wfHide(ch);});wfForce(head,'block');wfForce(nav,'grid');
  if(step===1){wfForce(ticket,'flex');wfForce(stamp,'block');wfForce(proof,'block');}
  else if(step<=units.length+1){wfForce(ticket,'flex');wfForce(units[step-2],'block');}
  else if(step===units.length+2||step===units.length+3){wfForce(ticket,'flex');wfForce(evidence,'block');}
  else {wfForce(ticket,'flex');wfForce(stamp,'block');wfForce(final,'block');}
}

function repairInspectionWizard(){
  const card=document.getElementById('truckChecks')?.closest('.card'),head=card?.querySelector('#inspectionWizardHeader');if(!card||!head||card.classList.contains('wizard-hidden'))return;
  const step=wfStep(head),truck=[...document.querySelectorAll('#truckChecks .pf-check')],trailer=[...document.querySelectorAll('#trailerChecks .pf-check')],taking=!!document.getElementById('takingTrailer')?.checked;
  const seq=[{t:'review'},...truck.map((el,i)=>({t:'truck',el,i})),{t:'choice'},...(taking?trailer.map((el,i)=>({t:'trailer',el,i})):[]),{t:'submit'}],cur=seq[Math.max(0,Math.min(seq.length-1,step-1))];
  const review=card.querySelector('#inspectionReviewJobs'),choice=card.querySelector('#inspectionTrailerChoice'),truckBox=document.getElementById('truckChecks'),trailerArea=document.getElementById('trailerArea'),status=document.getElementById('truckStatus'),msg=document.getElementById('morningMessage'),call=document.getElementById('operationsCallBox'),nav=card.querySelector('#inspectionWizardNav'),submit=[...card.querySelectorAll(':scope > button')].find(b=>/Submit Morning/i.test(b.textContent));
  [review,choice,truckBox,trailerArea,status,msg,call,submit].forEach(wfHide);truck.forEach(wfHide);trailer.forEach(wfHide);wfForce(head,'block');
  if(cur?.t==='review')wfForce(review,'block');
  if(cur?.t==='truck'){wfForce(truckBox,'block');wfForce(cur.el,'block');}
  if(cur?.t==='choice')wfForce(choice,'block');
  if(cur?.t==='trailer'){wfForce(trailerArea,'block');wfForce(cur.el,'block');}
  if(cur?.t==='submit'){wfForce(status,'block');wfForce(msg,'block');wfForce(call,'block');wfForce(submit,'block');}
  if(cur?.t!=='choice'&&cur?.t!=='submit')wfForce(nav,'grid');else wfHide(nav);
}

function repairSavedSignatures(){
  document.querySelectorAll('.evidence-panel').forEach(panel=>{const saved=panel.querySelector('.evidence-saved'),sig=panel.querySelector('.evidence-signature');if(saved&&sig&&panel.dataset.replacing!=='true')wfHide(sig);});
}
function repairWizard(){repairCreateWizard();repairItPrepWizard();repairServicePrepWizard();repairInspectionWizard();repairSavedSignatures();}
setInterval(repairWizard,250);
document.addEventListener('click',()=>setTimeout(repairWizard,60));

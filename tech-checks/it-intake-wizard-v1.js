// IT Intake wizard state and rendering.
// Database transitions remain in intake-shared-v1.js.
const labels=window.TechCheckRules?.itIntakeChecklist||[];
let wizard={row:null,step:0,answers:Array(labels.length).fill(null),notes:'',photo:null,meta:{}};
let intakeActionSubmitting=false;
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function getState(){return wizard;}
function setState(next){wizard=next;return wizard;}
function reset(){wizard={row:null,step:0,answers:Array(labels.length).fill(null),notes:'',photo:null,meta:{}};return wizard;}
function start(row){
  if(!row)return null;
  const record=window.TechCheckIntake.readRecord(row.damage_notes);
  const saved=Array.isArray(record.meta?.answers)?record.meta.answers:[];
  const answers=Array(labels.length).fill(null).map((_,i)=>typeof saved[i]==='boolean'?saved[i]:null);
  let step=answers.findIndex(v=>v!==true);
  if(step<0)step=row.intake_photo_paths?.length?labels.length+1:labels.length;
  return setState({row,step,answers,notes:record.notes,photo:null,meta:record.meta||{}});
}
function reviewFlags(){
  const row=wizard.row,answered=wizard.answers.filter(v=>v!==null).length,noCount=wizard.answers.filter(v=>v===false).length,remaining=wizard.answers.length-answered,flags=[],yes=i=>wizard.answers[i]===true;
  if(yes(1)&&!row?.return_photo_paths?.length)flags.push('Evidence mismatch: Service damage/photo review is YES, but no Service return photo is attached.');
  if(yes(0)&&!String(row?.unit_tag||'').trim())flags.push('Evidence mismatch: unit/tag verification is YES, but the returned unit tag is missing.');
  if(wizard.step>labels.length&&!wizard.photo&&!row?.intake_photo_paths?.length)flags.push('Required IT Intake photo is still missing.');
  if(yes(12)&&!wizard.meta?.cancellationDoc)flags.push('Evidence mismatch: SIM cancellation documentation is YES, but the date/job/unit/initials record is missing.');
  if(noCount)flags.push(noCount+' intake check'+(noCount===1?' is':'s are')+' marked NO.');
  if(row?.return_notes)flags.push('Service documented return/damage notes — review them against the photos.');
  if(!row?.return_photo_paths?.length)flags.push('No Service return photo is attached.');
  return {answered,noCount,remaining,flags,pct:Math.round(answered/Math.max(1,wizard.answers.length)*100)};
}
async function render({view,progress,photoHtml,hideChildren,resetPosition,onEmpty}){
  const row=wizard.row;if(!row)return onEmpty?.();
  let card=document.getElementById('wlIntakeForm');if(!card){card=document.createElement('div');card.id='wlIntakeForm';card.className='card wl-it-simple-card';view.append(card);}
  const photos=await photoHtml(row.return_photo_paths);
  if(wizard.step<labels.length){
    const i=wizard.step,answer=wizard.answers[i];
    card.innerHTML=`${progress(`${row.unit_tag} · IT INTAKE`,labels[i],i+1,labels.length+2)}<div class='wl-review'><b>${esc(row.unit_tag)} · ${esc(row.equipment_type||'Unit')}</b><div>MHelpDesk #${esc(row.ticket_no)}</div><div>Returned by ${esc(row.service_tech_name)}</div>${row.return_notes?`<div class='warn top8'><b>Service notes</b><div>${esc(row.return_notes)}</div></div>`:''}${photos?`<div class='wl-return-gallery top8'>${photos}</div>`:''}</div><div class='wl-question wl-it-intake-bool'><div class='qnum'>INTAKE CHECK ${i+1} OF ${labels.length}</div><div class='qtext'>${esc(labels[i])}</div><div class='wl-options'><button class='pass ${answer===true?'on':''}' data-wl-intake-answer='yes'>YES</button><button class='fail ${answer===false?'on':''}' data-wl-intake-answer='no'>NO</button></div>${answer===false?`<div class='wl-stop'><b>STOP — THIS UNIT CANNOT CONTINUE TO INVENTORY.</b><div>Fix the problem and tap YES. If it cannot be corrected, document it as damaged / needs replacement.</div><button class='wl-it-escalate top10' data-wl-intake-escalate>DOCUMENT DAMAGE / REPLACEMENT →</button></div>`:''}</div><button class='wl-service-backstep' data-wl-intake-prev ${i===0?'disabled':''}>← PREVIOUS QUESTION</button>`;
  }else if(wizard.step===labels.length){
    card.innerHTML=`${progress(`${row.unit_tag} · IT INTAKE`,'TAKE AN IT INTAKE PHOTO',labels.length+1,labels.length+2)}<div class='wl-review'><b>Service return evidence</b>${row.return_notes?`<div class='warn top8'><b>Service notes</b><div>${esc(row.return_notes)}</div></div>`:''}<div class='wl-return-gallery'>${photos}</div></div><div class='wl-question'><div class='qtext'>TAKE A CURRENT PHOTO OF ${esc(row.unit_tag)} IN THE SHOP.</div><label class='wl-photo-button' for='wlIntakePhoto'>📷 TAKE / CHOOSE UNIT PHOTO</label><input id='wlIntakePhoto' class='wl-photo-input' type='file' accept='image/*'><div class='wl-return-preview ${wizard.photo?'':'hidden'}'>${wizard.photo?`<img src='${URL.createObjectURL(wizard.photo)}' alt='Selected IT intake unit photo'>`:''}</div></div><div class='wl-nav'><button class='wl-prev' data-wl-intake-prev>Back</button><button class='wl-next' data-wl-intake-next>REVIEW →</button></div>`;
  }else{
    const ready=wizard.answers.every(v=>v===true),noCount=wizard.answers.filter(v=>v===false).length,doc=wizard.meta?.cancellationDoc;
    card.innerHTML=`${progress(`${row.unit_tag} · IT INTAKE`,ready?'READY FOR PENDING MHELPDESK INVENTORY':'UNIT NEEDS ATTENTION',labels.length+2,labels.length+2)}<div class='wl-review'><b>${esc(row.unit_tag)} · ${esc(row.equipment_type||'Unit')}</b><div><b>MHelpDesk #${esc(row.ticket_no)}</b></div><div>${ready?`✓ All ${labels.length} required intake checks are YES.`:`${noCount} failed check${noCount===1?'':'s'} — this unit cannot become Shop Inventory.`}</div>${doc?`<div class='ok top8'>SIM cancellation documentation recorded.</div>`:''}</div><label>Damage / intake notes</label><textarea id='wlIntakeNotes' rows='4' placeholder='Describe damage, missing items, repair needed, or other notes'>${esc(wizard.notes)}</textarea>${ready?`<div class='wl-it-good top10'>✓ IT INTAKE COMPLETE</div><button class='wl-it-start top10' data-wl-intake-finish>SEND TO PENDING MHELPDESK INVENTORY →</button>`:`<div class='wl-stop'><b>DO NOT RETURN THIS UNIT TO INVENTORY.</b><div>Document what is wrong and send it to the Owner as Needs Replacement.</div></div><button class='wl-it-start top10' data-wl-intake-replacement>MARK NEEDS REPLACEMENT → OWNER</button>`}<button class='wl-service-backstep top10' data-wl-intake-prev>← BACK</button>`;
  }
  hideChildren(view,[card]);resetPosition();
}
async function handleClick(event,deps={}){
  const target=event?.target;if(!target?.closest)return false;
  const render=()=>deps.render?.();
  const startButton=target.closest('[data-wl-intake-start]');
  if(startButton){await deps.start?.(startButton.dataset.wlIntakeStart);return true;}
  const answer=target.closest('[data-wl-intake-answer]');
  if(answer){
    const value=answer.dataset.wlIntakeAnswer==='yes';wizard.answers[wizard.step]=value;const row=wizard.row;
    if(row?.id){
      const tech=await deps.identity();
      if(wizard.step===12&&value)wizard.meta.cancellationDoc=window.TechCheckIntake.documentation(row,tech);
      wizard.meta.answers=[...wizard.answers];
      try{const update=await window.TechCheckIntake.saveProgress({returnId:row.id,notes:wizard.notes,meta:wizard.meta});row.damage_notes=update.damage_notes;}catch(error){alert(error.message);return true;}
    }
    if(value)wizard.step++;await render();return true;
  }
  if(target.closest('[data-wl-intake-escalate]')){wizard.step=labels.length;await render();return true;}
  if(target.closest('[data-wl-intake-next]')){
    if(wizard.step<labels.length&&wizard.answers[wizard.step]!==true){alert('This step is blocked. Fix the issue and tap YES, or document it as Needs Replacement.');return true;}
    if(wizard.step===labels.length){const file=document.getElementById('wlIntakePhoto')?.files?.[0];if(!file&&!wizard.photo){alert('Take or choose the IT intake photo first.');return true;}if(file)wizard.photo=file;}
    wizard.step++;await render();return true;
  }
  if(target.closest('[data-wl-intake-prev]')){if(wizard.step===labels.length+1)wizard.notes=document.getElementById('wlIntakeNotes')?.value||wizard.notes;wizard.step=Math.max(0,wizard.step-1);await render();return true;}
  const replacementAction=target.closest('[data-wl-intake-replacement]');
  if(replacementAction){
    if(intakeActionSubmitting)return true;
    wizard.notes=document.getElementById('wlIntakeNotes')?.value||wizard.notes||'';const row=wizard.row;
    if(!row?.id){alert('This intake record is no longer available.');return true;}
    if(!wizard.notes.trim()){alert('Describe the damage and what needs replacement before notifying the Owner.');return true;}
    intakeActionSubmitting=true;
    const originalText=replacementAction.textContent;
    replacementAction.disabled=true;
    replacementAction.textContent='SAVING…';
    try{
      const file=document.getElementById('wlIntakePhoto')?.files?.[0];if(file)wizard.photo=file;let paths=row.intake_photo_paths||[];
      if(wizard.photo)paths=await deps.uploadPhotos([wizard.photo],row.id,'it-replacement');
      if(!paths.length){alert('Take or choose an IT Intake photo showing the damaged equipment first.');return true;}
      await window.TechCheckIntake.markNeedsReplacement({returnId:row.id,damageNotes:wizard.notes,intakePhotoPaths:paths});
      await deps.identity();
      reset();deps.remember?.('it',row.ticket_no,'OWNER FOLLOW-UP CREATED');await deps.home?.();
    }catch(error){
      alert(error?.message||'Could not mark this equipment as needing replacement.');
    }finally{
      intakeActionSubmitting=false;
      if(document.contains(replacementAction)){replacementAction.disabled=false;replacementAction.textContent=originalText;}
    }
    return true;
  }
  const finishAction=target.closest('[data-wl-intake-finish]');
  if(finishAction){
    if(intakeActionSubmitting)return true;
    wizard.notes=document.getElementById('wlIntakeNotes')?.value||'';
    const row=wizard.row,answers=wizard.answers;
    if(!row?.id){alert('This intake record is no longer available.');return true;}
    if(!answers.every(v=>v===true)){alert('Every IT intake check must be YES before this unit can move to MHelpDesk inventory.');return true;}
    intakeActionSubmitting=true;
    const originalText=finishAction.textContent;
    finishAction.disabled=true;
    finishAction.textContent='SAVING INTAKE…';
    try{
      const tech=await deps.identity();
      const paths=wizard.photo?await deps.uploadPhotos([wizard.photo],row.id,'it'):row.intake_photo_paths||[];
      if(!paths.length){alert('Take or choose the required IT Intake photo before finishing intake.');return true;}
      wizard.meta.answers=[...answers];
      const result=await window.TechCheckIntake.finishIntake({row,tech,notes:wizard.notes,meta:wizard.meta,intakePhotoPaths:paths});
      wizard.meta=result.meta;
      reset();deps.remember?.('it',row.ticket_no,'IT INTAKE COMPLETE');await deps.home?.();
    }catch(error){
      alert(error?.message||'Could not complete IT Intake.');
    }finally{
      intakeActionSubmitting=false;
      if(document.contains(finishAction)){finishAction.disabled=false;finishAction.textContent=originalText;}
    }
    return true;
  }
  return false;
}

async function rows(){
  const ctx=window.TechCheckContext;if(!ctx?.db)throw new Error('Tech Check application context is not ready.');
  const {data,error}=await ctx.db.from('unit_returns').select('*').order('returned_at',{ascending:false});if(error)throw error;return data||[];
}
async function counts(){
  const all=await rows(),waitingRows=all.filter(r=>r.status==='waiting_it');
  return {waiting:waitingRows.length,inventory:all.filter(r=>r.status==='pending_mhelp_inventory').length,replacement:all.filter(r=>r.status==='needs_replacement').length,completed:all.filter(r=>r.status==='completed').length,nextWaiting:waitingRows[waitingRows.length-1]||null};
}
async function showHome(deps={}){
  const view=deps.view?.();if(!view)return;let card=document.getElementById('wlItIntake');
  if(!card){card=document.createElement('div');card.id='wlItIntake';card.className='card wl-home';view.append(card);}
  const c=await counts();card.className='card wl-home';
  card.innerHTML=`<div class='wl-mode-pills'><button class='wl-mode-card' data-wl-mode='deployment'><span class='wl-mode-title'>Deployment</span><span class='wl-mode-sub'>Prepare & hand off equipment</span></button><button class='on wl-mode-card' data-wl-mode='intake'><span class='wl-mode-title'>Intake & Returns</span><span class='wl-mode-sub'>Process returned units</span><span class='wl-mode-badge'>${c.waiting+c.inventory}</span></button></div><div class='wl-title'>What do you need to do?</div><div class='wl-sub'>Process returned Service units the same way as Deployment: one unit and one step at a time.</div><div class='wl-menu'><button class='${c.waiting?'wl-red':'wl-gray'}' data-wl-intake-view='waiting'>▶ Start / Continue Returned Unit <span class='wl-count'>${c.waiting}</span></button><button class='${c.inventory?'wl-red':'wl-gray'}' data-wl-intake-view='inventory'>▣ Pending MHelpDesk Inventory <span class='wl-count'>${c.inventory}</span></button><button class='wl-gray' data-wl-intake-view='history'>☰ Status & History <span class='wl-count'>${c.completed}</span></button></div>`;
  deps.hideChildren?.(view,[card]);deps.resetPosition?.();
}
async function showList(kind='waiting',deps={}){
  const all=await rows(),filtered=kind==='waiting'?all.filter(r=>r.status==='waiting_it'):kind==='inventory'?[]:all.filter(r=>r.status==='completed'),view=deps.view?.();if(!view)return;
  let card=document.getElementById('wlIntakeList');if(!card){card=document.createElement('div');card.id='wlIntakeList';card.className='card';view.append(card);}
  const title=kind==='waiting'?'Choose a returned unit to check':kind==='inventory'?'Owner/Manager handles MHelpDesk inventory':'Completed returned-unit history',kicker=kind==='waiting'?'Returned / Waiting for IT':kind==='inventory'?'Sent to Owner / Manager':'Intake Status & History';
  const items=await Promise.all(filtered.map(async r=>`<div class='wl-ticket'><b>${esc(r.unit_tag||(r.equipment_type==='110V Stand'?'No tag':'Unit'))} · ${esc(r.equipment_type||'Unit')}</b><div><b>MHelpDesk #${esc(r.ticket_no)}</b></div><div class='small'>Returned by ${esc(r.service_tech_name)} · ${new Date(r.returned_at).toLocaleString()}</div>${r.return_notes?`<div class='small top8'>Service notes: ${esc(r.return_notes)}</div>`:''}<div class='wl-return-gallery'>${await deps.photoHtml(r.return_photo_paths)}${kind!=='waiting'?await deps.photoHtml(r.intake_photo_paths):''}</div>${kind==='waiting'?`<button class='wl-big wl-blue top10' data-wl-intake-start='${r.id}'>Start / Continue This Unit →</button>`:`<div class='ok top10'>✓ Completed · ${esc(r.it_tech_name||'IT')}</div>`}</div>`));
  card.innerHTML=`${deps.progress(kicker,title,1,1)}<button class='wl-back' data-wl-mode='intake'>← Intake / Returns Home</button>${kind==='inventory'?`<div class='ok'><b>✓ IT sends completed intake to the Owner/Manager.</b><div>You do not add units back to MHelpDesk inventory here. The Owner/Manager completes that final step from the Owner dashboard.</div></div>`:items.join('')||`<div class='ok'><b>${kind==='history'?'No completed intake yet.':'Nothing waiting here.'}</b></div>`}`;
  deps.hideChildren?.(view,[card]);deps.resetPosition?.();
}

window.TechCheckITIntake=Object.freeze({labels,getState,setState,reset,start,reviewFlags,render,handleClick,rows,counts,showHome,showList});

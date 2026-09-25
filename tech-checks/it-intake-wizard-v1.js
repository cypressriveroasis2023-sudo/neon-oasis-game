// IT Intake wizard state and rendering.
// Database transitions remain in intake-shared-v1.js.
const labels=window.TechCheckRules?.itIntakeChecklist||[];
let wizard={row:null,step:0,answers:Array(labels.length).fill(null),notes:'',photo:null,meta:{}};
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
window.TechCheckITIntake=Object.freeze({labels,getState,setState,reset,start,reviewFlags,render});

// IT Prep presentation helpers.
// Pure markup only: no database writes and no workflow transitions.
function stepHtml(item,step,index,total,unitNo,deps={}){
  const esc=deps.esc||((v)=>String(v??''));const boolAnswered=deps.boolAnswered||(()=>false),boolValue=deps.boolValue||(()=>false);
  if(step.kind==='tag'){
    const type=String(item?.equipment_type||'unit'),example=type==='Helios'?'Example: 007.':'Enter the tag exactly as printed on the equipment.';
    return `<div class='wl-question'><div class='qnum'>UNIT ${unitNo} · STEP ${index+1} OF ${total}</div><div class='qtext'>${esc(step.label)}</div><input id='wlItUnitValue' value='${esc(item.unit_tag||'')}' placeholder='${step.optional?'ENTER TAG IF PRESENT':'EXACT UNIT TAG'}'>${step.optional?"<div class='wl-note top8'>No tag is valid for a 110V Stand. Leave this blank if the stand does not have one.</div>":`<details class='wl-step-help top8'><summary>Need help?</summary><div class='wl-note top8'>Type the unit number exactly as it appears on the ${esc(type)}. ${esc(example)} Do not guess.</div></details>`}</div>`;
  }
  if(step.kind==='number'){
    const min=Number(step.min??(step.field==='battery_count'?item.required_battery_count:1)??1),value=item[step.field]??(step.field==='battery_count'?item.required_battery_count:min),helios=step.field==='battery_count'&&item?.equipment_type==='Helios';
    const label=helios?'Confirm 1 Helios battery box is prepared':step.label,note=helios?'Helios uses one internal battery box. Do not count Solar Stand batteries.':`Required minimum: ${min}`;
    return `<div class='wl-question'><div class='qnum'>UNIT ${unitNo} · STEP ${index+1} OF ${total}</div><div class='qtext'>${esc(label)}</div><input id='wlItUnitValue' type='number' inputmode='numeric' min='${min}' value='${esc(value??'')}'><div class='wl-note top8'>${esc(note)}</div></div>`;
  }
  const answered=boolAnswered(item,step.field),value=boolValue(item,step.field),yes=answered&&value===true,no=answered&&value!==true;
  return `<div class='wl-question wl-it-auto-bool'><div class='qnum'>UNIT ${unitNo} · STEP ${index+1} OF ${total}</div><div class='qtext'>${esc(step.label)}</div><div class='wl-options'><button class='pass ${yes?'on':''}' data-wl-it-answer='yes'>YES</button><button class='fail ${no?'on':''}' data-wl-it-answer='no'>NO</button></div>${no?`<div class='wl-stop'><b>STOP — FIX THIS FIRST.</b><div>When the problem is corrected, tap YES. This equipment cannot move forward while this answer is NO.</div></div>`:''}</div>`;
}
function equipmentReviewHtml(item,ev,unitNo,deps={}){
  const esc=deps.esc||((x)=>String(x??'')),type=String(item?.equipment_type||deps.typeChoice||'Equipment'),issues=item?deps.issues(item,ev||[],unitNo):[],flags=[],low=type.toLowerCase();
  if(low.includes('helios'))flags.push('Helios focus: cameras → modem → antenna → camera/modem programming → ports/configuration; verify 3 × 1TB SD cards.');
  if(low.includes('solar spotter'))flags.push('Solar Spotter IT check does not include battery checkout. The Solar Stand and its battery setup are verified on the Service side (4 × AGM 12V 110Ah or 1 × 12V 350Ah per stand).');
  if(low.includes('ranger'))flags.push('Ranger: verify MPPT update, MPPT operation, and charging. Service should receive 1 solar panel per Ranger.');
  if(low.includes('helios'))flags.push('Verify Camera 1: 81/554/1400 · Camera 2: 81/554/1500 · PTZ: 81/554/1600 · IP Speaker: 81/554/1700.');
  return `<div class='wl-ai-panel wl-ai-equipment'><div class='wl-ai-head'>${deps.title('Equipment Check')}<b>${issues.length?'VERIFY '+issues.length+' ITEM'+(issues.length===1?'':'S'):'ON TRACK'}</b></div><div class='wl-ai-line'><b>${esc(type)}</b> · Item ${unitNo}</div>${flags.length?`<div class='wl-ai-line'>${flags.map(x=>'• '+esc(x)).join('<br>')}</div>`:''}${issues.length?`<div class='wl-ai-warn'>${issues.slice(0,5).map(x=>'⚠ '+esc(x.label||x.message||x.phase||'Required check incomplete')).join('<br>')}</div>`:`<div class='wl-ai-good'>✓ No required-item conflicts detected at this point.</div>`}<div class='small top8'>AI Assist does not answer checks or approve equipment for the technician.</div></div>`;
}
function ticketSummaryHtml(prep,items,deps={}){
  const esc=deps.esc||((x)=>String(x??'')),units=items.map((item,index)=>({item,index})).filter(r=>r.item.purpose!=='BACKUP').map(({item,index})=>`<div class='wl-simple-unit'><div><b>${esc(item.equipment_type)} ${esc(item.unit_tag||'')}</b><span>Unit ${index+1} · ${esc(item.purpose)}</span></div><div class='wl-simple-unit-ok'>✓ READY</div><button class='mini' data-wl-final-unit='${index}'>Review / Adjust Unit</button></div>`).join('');
  return `<div class='wl-simple-ticket'><div class='wl-simple-ticket-number'>MHelpDesk #${esc(prep.ticket_no)}</div><div class='small'>${esc(prep.site||'')}</div></div><div class='wl-simple-units'>${units||"<div class='small'>No equipment prepared yet.</div>"}</div>`;
}
function partsSummaryHtml(prep,deps={}){
 const esc=deps.esc||((x)=>String(x??'')),rows=deps.partsRows(prep).filter(r=>r.qty>0);if(!rows.length)return '';
 return `<div class='wl-simple-extra wl-readonly-extra'><div class='qnum'>ASSIGNED LOOSE PARTS</div><div><b>${rows.map(r=>r.qty+' × '+esc(r.label)).join(' · ')}</b></div><div class='small'>ASSIGNED — READ ONLY</div></div>`;
}
function spareSummaryHtml(items,rows,deps={}){
 const esc=deps.esc||((x)=>String(x??'')),units=(items||[]).filter(i=>i.purpose==='BACKUP'),batteries=(rows||[]).filter(r=>Number(r.qty_prepared||0)>0),bits=[];
 if(units.length)bits.push(units.map(i=>esc(i.equipment_type)+' '+esc(i.unit_tag||'')).join(' · '));if(batteries.length)bits.push(batteries.map(r=>Number(r.qty_prepared)+' × '+esc(r.battery_type)).join(' · '));if(!bits.length)return '';
 return `<div class='wl-simple-extra wl-readonly-extra'><div class='qnum'>ASSIGNED TRUCK SPARES / BACKUPS</div><div><b>${bits.join(' · ')}</b></div><div class='small'>ASSIGNED — READ ONLY</div></div>`;
}
function finalLockHtml(){return `<div class='wl-it-final-lock'><b>✓ TICKET CONTENTS LOCKED</b><span>At handoff, IT can only review or correct a unit check. Equipment, parts, and spares cannot be added from this screen.</span></div>`;}

function issueLinksHtml(item,evidence,unitNo,deps={}){
  const esc=deps.esc||((x)=>String(x??'')),issues=deps.issues?deps.issues(item,evidence||[],unitNo):[];
  if(!issues.length)return '';
  return `<div class='wl-stop'><b>${issues.length} issue${issues.length===1?'':'s'} need attention.</b><div>Tap an issue to go directly back to it.</div><div class='wl-issue-list'>${issues.map((issue,index)=>`<button class='wl-issue-link' data-wl-issue-unit='${unitNo-1}' data-wl-issue-phase='${issue.phase}' data-wl-issue-index='${issue.index}'><b>Issue ${index+1}: ${esc(issue.label)}</b><span>Go to this issue →</span></button>`).join('')}</div></div>`;
}
function unitReviewHtml(item,evidence,unitNo,deps={}){
  const esc=deps.esc||((x)=>String(x??'')),unitEvidence=deps.unitEvidence||(()=>[]),stepsData=deps.stepsData||(()=>[]),boolValue=deps.boolValue||(()=>false),itemIdentity=deps.itemIdentity||((_,n)=>`Unit ${n}`),unitSignature=deps.unitSignature||(()=>null);
  const photos=unitEvidence(evidence||[],unitNo,'photo'),steps=stepsData(item,unitNo).filter(s=>s.kind==='bool'),passed=steps.filter(s=>boolValue(item,s.field)===true).length,identity=itemIdentity(item,unitNo),sig=unitSignature(evidence||[],unitNo);
  return `<div class='wl-simple-complete'>
    <div class='wl-simple-complete-title'>${esc(identity)} is ready</div>
    <div>✓ ${passed} checks complete</div>
    <div>✓ ${photos.length?'Photo saved':'Photo needed'}</div>
    <div>✓ ${sig?'Signed by '+esc(sig.created_by_name||'IT Technician'):'Signature needed'}</div>
  </div>`;
}


function wizardCard(view){
  let wizard=document.getElementById('wlItWizardOnly');
  if(!wizard){wizard=document.createElement('div');wizard.id='wlItWizardOnly';wizard.className='card';view?.append(wizard);}
  return wizard;
}
function typeMissingHtml(unitNo,totalUnits,deps={}){
  const progress=deps.progress||(()=>''),esc=deps.esc||((x)=>String(x??''));
  return progress(`Item ${unitNo} of ${totalUnits}`,'Equipment type missing',1,1)+`<div class='wl-stop'><b>OWNER ACTION NEEDED</b><div>This ticket does not say what equipment IT should prepare. Go back and have the Owner correct the assignment.</div></div><div class='wl-nav'><button class='wl-prev' data-wl-home='it'>← IT Home</button><span></span></div>`;
}
function purposeHtml(unitNo,totalUnits,typeChoice,purposeChoice,options,serviceJob,deps={}){
  const progress=deps.progress||(()=>''),esc=deps.esc||((x)=>String(x??''));
  const question=serviceJob?'IS THIS UNIT REPLACING A UNIT ALREADY AT THE SITE?':'Confirm this unit purpose';
  const note=serviceJob
    ? (typeChoice==='110V Stand'?'110V Stand is swap-only. If it is not replacing a site stand, the Owner assignment needs to be corrected.':'YES uses the SWAP return path. NO treats the unit as Service support / backup equipment.')
    : 'Tech Check selected the purpose from the Owner job type.';
  return progress(`Unit ${unitNo} of ${totalUnits}`,serviceJob?'One simple purpose question':'Confirm unit purpose',1,1)+
    `<div class='wl-question'><div class='qtext'>${esc(question)}</div><div class='wl-options'>${(options||[]).map(row=>`<button class='${purposeChoice===row.value?'pass on':'pass'}' data-wl-unit-purpose='${row.value}'>${esc(row.label)}</button>`).join('')}</div><div class='wl-note'>${esc(note)}</div></div><div class='wl-nav'><button class='wl-prev' data-wl-it-prev>Back</button><button class='wl-next' data-wl-it-next>Next →</button></div>`;
}
function reconHtml(unitNo,totalUnits,reconRequired,deps={}){
  const progress=deps.progress||(()=>''),value=Math.max(1,Number(reconRequired||1));
  return progress(`Unit ${unitNo} of ${totalUnits}`,'Recon II camera count',1,1)+`<div class='wl-question'><div class='qtext'>How many cameras are going on this Recon II for this deployment?</div><input id='wlReconRequired' type='number' inputmode='numeric' min='1' value='${value}'></div><div class='wl-note top8'>Battery quantity is entered separately during the unit check after the Recon II is programmed and ready.</div><div class='wl-nav'><button class='wl-prev' data-wl-it-prev>Back</button><button class='wl-next' data-wl-it-next>Next →</button></div>`;
}
function checksHtml(item,unitNo,totalUnits,questionIndex,steps,deps={}){
  const progress=deps.progress||(()=>''),esc=deps.esc||((x)=>String(x??'')),step=(steps||[])[questionIndex],stepCount=Math.max(1,(steps||[]).length),equipmentName=item?.equipment_type||'Equipment';
  const question=stepHtml(item,step,questionIndex,(steps||[]).length,unitNo,{esc,boolAnswered:deps.boolAnswered,boolValue:deps.boolValue});
  const nav=step?.kind==='bool'
    ? `<div class='wl-nav'><button class='wl-prev' data-wl-it-prev>Back</button><span></span></div>`
    : `<div class='wl-nav'><button class='wl-prev' data-wl-it-prev>Back</button><button class='wl-next' data-wl-it-next>${questionIndex===(steps||[]).length-1?'Next: Photo →':'Next →'}</button></div>`;
  return progress(`Unit ${unitNo} of ${totalUnits}`,`${equipmentName} · Step ${questionIndex+1} of ${stepCount}`,questionIndex+1,stepCount)+question+nav;
}
function reviewPhaseHtml(identity,unitNo,totalUnits,ready,reviewHtml,issuesHtml){
  return `${reviewHtml||''}${ready?'':(issuesHtml||'')}${ready?'':`<div class='wl-stop'><b>ONE MORE THING</b><div>Finish the item shown above.</div><button class='wl-big wl-red top10' data-wl-fix-issues>Fix It →</button></div>`}<div class='wl-nav'><button class='wl-prev' data-wl-it-prev>Back</button><button class='wl-next' data-wl-it-next ${ready?'':'disabled'}>${unitNo<totalUnits?`Next: Unit ${unitNo+1} →`:'Next: Ticket Summary →'}</button></div>`;
}


function partsOnlyFinalHtml(prep,ready,photoHtml,signatureHtml,deps={}){
  const progress=deps.progress||(()=>''),esc=deps.esc||((x)=>String(x??'')),parts=partsSummaryHtml(prep,{esc,partsRows:deps.partsRows||(()=>[])});
  return progress('PARTS-ONLY IT HANDOFF',ready?'READY — HAND OFF PARTS':'Verify the loose parts',1,1)+
    `<div class='wl-review'><b>MHelpDesk #${esc(prep?.ticket_no||'')}</b><div>${esc(prep?.site||'')}</div><div class='small'>No whole unit or stand is leaving the shop on this ticket.</div></div>`+
    parts+
    `<div class='wl-question top10'><div class='qnum'>PARTS-ONLY HANDOFF</div><div class='qtext'>VERIFY THE EXACT PARTS AND QUANTITIES</div><div class='small'>Photograph the actual parts IT is giving Service, then sign the ticket-level IT handoff.</div></div>`+
    (photoHtml||'')+
    (signatureHtml||'')+
    `<div id='wlSendItMsg'></div>`+
    (ready?`<div class='ok top10'><b>✓ PARTS HANDOFF READY</b><div>Service will verify these same parts, photo evidence, and quantities before accepting the handoff.</div></div>`:`<div class='wl-stop top10'><b>PHOTO + IT SIGNATURE REQUIRED</b><div>Save one clear parts photo and the IT final sign-off before handing this ticket to Service.</div></div>`)+
    `<button class='wl-big wl-green top10' style='font-size:18px;min-height:58px' data-wl-send-it ${ready?'':'disabled'}>HAND OFF PARTS TO SERVICE →</button>
    <div class='wl-nav'><button class='wl-prev' data-wl-home='it'>← IT Home</button><button class='wl-next' data-wl-it='history'>Status & History →</button></div>`;
}
function finalTicketHtml(prep,items,spareBatteries,state={},deps={}){
  const progress=deps.progress||(()=>''),esc=deps.esc||((x)=>String(x??'')),ready=Boolean(state.ready);
  const spareUnitsCheckedOut=Boolean(state.spareUnitsCheckedOut),spareBatteriesReady=Boolean(state.spareBatteriesReady),spareBatteriesCheckedOut=Boolean(state.spareBatteriesCheckedOut);
  return progress('Ticket Summary',ready?'Ready to hand off':'Finish this ticket',1,1)+
    finalLockHtml()+
    ticketSummaryHtml(prep,items||[],{esc})+
    partsSummaryHtml(prep,{esc,partsRows:deps.partsRows||(()=>[])})+
    spareSummaryHtml(items||[],spareBatteries||[],{esc})+
    (!spareUnitsCheckedOut?`<div class='wl-stop top10'><b>SPARE NOT CHECKED OUT</b><div>Finish the truck spare checkout.</div></div>`:'')+
    ((!spareBatteriesReady||!spareBatteriesCheckedOut)?`<div class='wl-stop top10'><b>SPARE BATTERY NOT READY</b><div>Finish the spare battery checkout.</div></div>`:'')+
    `<div id='wlSendItMsg'></div>`+
    `<button class='wl-big wl-red wl-primary-handoff top10' data-wl-send-it ${ready?'':'disabled'}>HAND OFF TO SERVICE →</button>
    <div class='wl-nav wl-simple-final-nav'><button class='wl-prev' data-wl-final-last-unit>← Back</button><span></span></div>`;
}

window.TechCheckITPrepView=Object.freeze({stepHtml,equipmentReviewHtml,ticketSummaryHtml,partsSummaryHtml,spareSummaryHtml,finalLockHtml,issueLinksHtml,unitReviewHtml,wizardCard,typeMissingHtml,purposeHtml,reconHtml,checksHtml,reviewPhaseHtml,partsOnlyFinalHtml,finalTicketHtml});

// IT Prep wizard navigation state.
// Keeps unit/question/phase transitions deterministic while the existing renderer remains unchanged.
function nextAfterCheck(state,stepCount){
  const next={...state};
  if(next.questionIndex<stepCount-1)next.questionIndex++;else next.phase='photo';
  return next;
}
function nextAfterReview(state,totalUnits){
  const next={...state};
  if(next.unitIndex<totalUnits-1){next.unitIndex++;next.questionIndex=0;next.phase='type';next.typeChoice='';next.purposeChoice='';next.reconRequired=1;}
  else{next.unitIndex=totalUnits;next.phase='final';next.finalView='summary';}
  return next;
}
function previous(state,{itemCount=0,stepCount=0,autoPurpose=false}={}){
  const next={...state};
  if(next.phase==='final'){next.finalView='summary';next.unitIndex=Math.max(0,itemCount-1);next.phase='review';return {state:next};}
  if(next.phase==='signature'){next.phase='photo';return {state:next};}
  if(next.phase==='review'){next.phase='signature';return {state:next};}
  if(next.phase==='photo'){next.phase='checks';next.questionIndex=Math.max(0,stepCount-1);return {state:next};}
  if(next.phase==='checks'){
    if(next.questionIndex>0){next.questionIndex--;return {state:next};}
    if(autoPurpose){if(next.unitIndex===0)return {state:next,action:'pending'};next.unitIndex--;next.phase='review';return {state:next};}
    next.phase='purpose';return {state:next};
  }
  if(next.phase==='recon'){next.phase='purpose';return {state:next};}
  if(next.phase==='purpose'||next.phase==='type'){if(next.unitIndex===0)return {state:next,action:'pending'};next.unitIndex--;next.phase='review';return {state:next};}
  return {state:next};
}
function finalLastUnit(state,items=[]){
  const next={...state,finalView:'summary'},job=items.map((item,index)=>({item,index})).filter(r=>r.item.purpose!=='BACKUP');
  next.unitIndex=job.length?job[job.length-1].index:Math.max(0,items.length-1);next.phase='review';return next;
}
async function handleQuestionClick(event,state,deps={}){
  const target=event?.target;if(!target?.closest)return {handled:false,state};
  let next={...state};
  const answer=target.closest('[data-wl-it-answer]');
  if(answer&&next.phase==='checks'){
    const item=deps.currentItem(),steps=deps.steps(item,next.unitIndex+1),step=steps[next.questionIndex];
    if(!step||step.kind!=='bool')return {handled:true,state:next};
    const value=answer.dataset.wlItAnswer==='yes';item[step.field]=value;deps.recordAnswer?.(item,step.field,value);
    const buttons=answer.closest('.wl-options')?.querySelectorAll('button')||[];buttons.forEach(b=>b.disabled=true);
    if(!await deps.persist()){buttons.forEach(b=>b.disabled=false);return {handled:true,state:next};}
    if(value)next=nextAfterCheck(next,deps.steps(deps.currentItem(),next.unitIndex+1).length);
    return {handled:true,state:next,render:true};
  }
  if(!target.closest('[data-wl-it-next]'))return {handled:false,state:next};
  const items=deps.items(),totalUnits=deps.totalUnits(items);
  if(next.phase==='type')return {handled:true,state:next,render:true};
  if(next.phase==='purpose'){
    if(!next.purposeChoice){alert('Choose BACKUP, SWAP, or DELIVERY first.');return {handled:true,state:next};}
    if(!deps.purposeAllowed(next.typeChoice,next.purposeChoice)){alert('That purpose is not available for this equipment type and job.');return {handled:true,state:next};}
    if(next.typeChoice==='Recon 2'){next.phase='recon';return {handled:true,state:next,render:true};}
    if(!await deps.configure())return {handled:true,state:next};next.questionIndex=0;next.phase='checks';return {handled:true,state:next,render:true};
  }
  if(next.phase==='recon'){
    const value=Math.max(1,Number(document.getElementById('wlReconRequired')?.value||0));
    if(value<1){alert('Enter how many cameras are going on this Recon II.');return {handled:true,state:next};}
    next.reconRequired=value;deps.setReconRequired?.(value);if(!await deps.configure())return {handled:true,state:next};next.questionIndex=0;next.phase='checks';return {handled:true,state:next,render:true};
  }
  if(next.phase==='checks'){
    const item=deps.currentItem(),steps=deps.steps(item,next.unitIndex+1),step=steps[next.questionIndex];let save=false;
    if(step.kind==='tag'){const value=document.getElementById('wlItUnitValue')?.value.trim()||'';if(!value&&!step.optional){alert('Enter the exact unit tag first.');return {handled:true,state:next};}item.unit_tag=value;save=true;}
    else if(step.kind==='number'){const value=Number(document.getElementById('wlItUnitValue')?.value||0),min=Number(step.min??(step.field==='battery_count'?item.required_battery_count:1)??1);if(value<min){alert(`This check requires at least ${min}.`);return {handled:true,state:next};}item[step.field]=value;save=true;}
    else if(!deps.boolAnswered(item,step.field)){alert('Choose YES or NO first.');return {handled:true,state:next};}
    if(save&&!await deps.persist())return {handled:true,state:next};next=nextAfterCheck(next,steps.length);return {handled:true,state:next,render:true};
  }
  if(next.phase==='photo'){
    const ev=await deps.evidence(),item=deps.currentItem(),identity=deps.identity(item,next.unitIndex+1);
    if(!deps.unitEvidence(ev,next.unitIndex+1,'photo').length){alert(`Take and save a photo of ${identity} before continuing.`);return {handled:true,state:next};}
    if(!deps.photoTagReady(item)){alert(`Confirm that the photo clearly shows unit tag ${item.unit_tag} and matches ${identity} before continuing.`);return {handled:true,state:next};}
    next.phase='signature';return {handled:true,state:next,render:true};
  }
  if(next.phase==='signature'){const ev=await deps.evidence();if(!deps.unitSignature(ev,next.unitIndex+1)){alert(`Sign Unit ${next.unitIndex+1} before continuing.`);return {handled:true,state:next};}next.phase='review';return {handled:true,state:next,render:true};}
  if(next.phase==='review'){const ev=await deps.evidence(),issues=deps.issues(deps.currentItem(),ev,next.unitIndex+1);if(issues.length){next.phase=issues[0].phase;next.questionIndex=issues[0].index||0;}else next=nextAfterReview(next,totalUnits);return {handled:true,state:next,render:true};}
  return {handled:true,state:next};
}

async function handleReviewClick(event,state,deps={}){
  const target=event?.target;if(!target?.closest)return {handled:false,state};let next={...state};
  const photoTag=target.closest('[data-wl-photo-tag]');
  if(photoTag&&next.phase==='photo'){
    const item=deps.currentItem();if(!item)return {handled:true,state:next};
    const matches=photoTag.dataset.wlPhotoTag==='yes';
    if(matches&&item.ai_tag_scan_status==='mismatch'){alert(`AI read a different tag than ${item.unit_tag}. Retake a clear tag photo before approving this unit.`);return {handled:true,state:next};}
    const error=await deps.confirmPhotoTag(item.id,matches);if(error){alert(error.message);return {handled:true,state:next};}
    await deps.reload();
    if(!matches)alert(`Retake the photo so the unit tag for ${deps.identity(deps.currentItem(),next.unitIndex+1)} is clearly visible and matches the equipment.`);
    return {handled:true,state:next,render:true};
  }
  const issue=target.closest('[data-wl-issue-unit]');
  if(issue){if(!deps.hasPrep())return {handled:true,state:next};next.unitIndex=Number(issue.dataset.wlIssueUnit||0);next.phase=issue.dataset.wlIssuePhase||'checks';next.questionIndex=Number(issue.dataset.wlIssueIndex||0);return {handled:true,state:next,render:true};}
  if(target.closest('[data-wl-fix-issues]')){
    if(!deps.hasPrep())return {handled:true,state:next};const item=deps.items()[next.unitIndex],ev=await deps.evidence(),first=deps.issues(item,ev,next.unitIndex+1)[0];
    if(first){next.phase=first.phase;next.questionIndex=first.index||0;}return {handled:true,state:next,render:true};
  }
  const view=target.closest('[data-wl-final-view]');
  if(view&&next.phase==='final'){next.finalView=view.dataset.wlFinalView||'summary';return {handled:true,state:next,render:true};}
  const unit=target.closest('[data-wl-final-unit]');
  if(unit&&next.phase==='final'){next.finalView='summary';next.unitIndex=Math.max(0,Number(unit.dataset.wlFinalUnit||0));next.phase='review';return {handled:true,state:next,render:true};}
  if(target.closest('[data-wl-final-last-unit]')&&next.phase==='final')return {handled:true,state:finalLastUnit(next,deps.items()),render:true};
  return {handled:false,state:next};
}


function photoTagReady(item){
  if(item?.equipment_type==='110V Stand'&&!String(item?.unit_tag||'').trim())return true;
  return item?.photo_tag_match_ok===true;
}
function unitIssues(item,evidence,unitNo,deps={}){
  const steps=(deps.steps?deps.steps(item,unitNo):[])||[],issues=[];
  const boolValue=deps.boolValue||((row,field)=>row?.[field]);
  steps.forEach((step,index)=>{
    const failed=step.kind==='number'
      ? Number(item?.[step.field]||0)<Number(step.min??(step.field==='battery_count'?item?.required_battery_count:1)??1)
      : step.kind==='tag'
        ? (!step.optional&&!String(item?.[step.field]||'').trim())
        : boolValue(item,step.field)!==true;
    if(failed)issues.push({phase:'checks',index,label:step.label});
  });
  const unitEvidence=deps.unitEvidence||(()=>[]);
  if(!unitEvidence(evidence||[],unitNo,'photo').length)issues.push({phase:'photo',index:0,label:'Required equipment photo is missing.'});
  else if(!(deps.photoTagReady||photoTagReady)(item))issues.push({phase:'photo',index:0,label:`Confirm the photo clearly shows and matches unit tag ${item?.unit_tag||''}.`});
  const unitSignature=deps.unitSignature||(()=>null);
  if(!unitSignature(evidence||[],unitNo))issues.push({phase:'signature',index:0,label:'IT technician signature is missing.'});
  return issues;
}


function initialState(prep,items=[],evidence=[],deps={}){
  const expectedUnits=prep?.expected_unit_count||items.length;
  const issues=deps.issues||(()=>[]);
  let firstIncomplete=items.findIndex((item,index)=>issues(item,evidence,index+1).length>0);
  if(firstIncomplete<0)firstIncomplete=items.length;
  const state={expectedUnits,unitIndex:firstIncomplete,questionIndex:0,phase:'type'};
  if(state.unitIndex>=expectedUnits){
    state.phase='final';
    state.finalView='summary';
    return state;
  }
  const manifestExpanded=deps.manifestExpanded||(()=>[]);
  const purposeFromWorkType=deps.purposeFromWorkType||(()=> '');
  if(state.unitIndex>=items.length){
    state.typeChoice=manifestExpanded(prep?.equipment_manifest||[])[state.unitIndex]||'';
    state.purposeChoice=purposeFromWorkType(prep?.work_type)||'';
    state.reconRequired=1;
    return state;
  }
  const item=items[state.unitIndex],unitNo=state.unitIndex+1;
  state.typeChoice=item?.equipment_type||'';
  state.purposeChoice=item?.purpose||'';
  state.reconRequired=Number(item?.recon_camera_count||1);
  const requiredType=manifestExpanded(prep?.equipment_manifest||[])[state.unitIndex]||'';
  if((requiredType&&item?.equipment_type!==requiredType)||!item?.equipment_type||!item?.purpose){
    state.phase='type';
    state.typeChoice=requiredType||item?.equipment_type||'';
    state.purposeChoice=item?.purpose||purposeFromWorkType(prep?.work_type)||'';
    return state;
  }
  const found=issues(item,evidence,unitNo);
  if(!found.length)state.phase='review';
  else{
    state.phase=found[0].phase;
    state.questionIndex=found[0].index||0;
  }
  return state;
}


function finalReadiness(prep,items=[],evidence=[],spareBatteries=[],deps={}){
  const totalUnits=prep?.expected_unit_count||deps.expectedUnits||items.length;
  const issues=deps.issues||(()=>[]);
  const partsTotal=deps.partsTotal||(()=>0);
  const itemReady=items.length===totalUnits&&items.every((item,index)=>issues(item,evidence,index+1).length===0);
  const spareUnits=items.filter(row=>row?.purpose==='BACKUP');
  const spareUnitsCheckedOut=spareUnits.every(row=>Boolean(row?.spare_it_checked_out_at));
  const spareBatteriesReady=(spareBatteries||[]).every(row=>Boolean(row?.ready_ok));
  const spareBatteriesCheckedOut=(spareBatteries||[]).every(row=>Boolean(row?.it_checked_out_at));
  const partsOnly=totalUnits===0&&items.length===0&&partsTotal(prep)>0;
  const globalItPhotos=(evidence||[]).filter(row=>row?.kind==='photo'&&!row?.prep_item_id);
  const globalItSignature=[...(evidence||[])].reverse().find(row=>row?.kind==='signature'&&!row?.prep_item_id);
  const partsOnlyProofReady=!partsOnly||(globalItPhotos.length>=1&&Boolean(globalItSignature));
  const ready=itemReady&&spareUnitsCheckedOut&&spareBatteriesReady&&spareBatteriesCheckedOut&&partsOnlyProofReady;
  return {totalUnits,itemReady,spareUnitsCheckedOut,spareBatteriesReady,spareBatteriesCheckedOut,partsOnly,partsOnlyProofReady,ready};
}


function typePhaseDecision({lockedType='',autoPurpose='',currentItem=null,purposeAllowed=()=>false}={}){
  if(!lockedType)return {phase:'type',missingType:true};
  const base={typeChoice:lockedType};
  if(autoPurpose&&purposeAllowed(lockedType,autoPurpose)){
    const purposeChoice=autoPurpose;
    if(lockedType==='Recon 2')return {...base,purposeChoice,phase:'recon',configure:false};
    const configure=!currentItem||currentItem.equipment_type!==lockedType||currentItem.purpose!==autoPurpose;
    return {...base,purposeChoice,phase:'checks',questionIndex:0,configure};
  }
  return {...base,purposeChoice:currentItem?.purpose||'',phase:'purpose',configure:false};
}


function releaseReadiness(prep,items=[],evidence=[],deps={}){
  const expected=prep?.expected_unit_count||deps.expectedUnits||items.length;
  const partsOnly=expected===0&&items.length===0&&(deps.partsTotal||(()=>0))(prep)>0;
  const issues=deps.issues||(()=>[]);
  const itemReady=items.length===expected&&items.every((item,index)=>issues(item,evidence,index+1).length===0);
  const partsPhotoReady=!partsOnly||(evidence||[]).some(row=>row?.kind==='photo'&&!row?.prep_item_id);
  const partsSignatureReady=!partsOnly||(evidence||[]).some(row=>row?.kind==='signature'&&!row?.prep_item_id);
  const ready=itemReady&&partsPhotoReady&&partsSignatureReady;
  return {expected,partsOnly,itemReady,partsPhotoReady,partsSignatureReady,ready};
}


async function releaseHandoff(prep,items=[],evidence=[],deps={}){
  const state=releaseReadiness(prep,items,evidence,{
    expectedUnits:deps.expectedUnits,
    issues:deps.issues,
    partsTotal:deps.partsTotal
  });
  const {expected,partsOnly,ready}=state;
  const notify=deps.alert||window.alert;
  if(!ready){
    if(partsOnly)notify('Take one clear photo of the loose parts and save the IT final signature before handing them to Service.');
    else notify(`Complete all ${expected} equipment items with checks, a photo showing the matching tag, and an IT signature before handing off to Service.`);
    return {...state,completed:false,blocked:true};
  }
  const doc=deps.document||document;
  const button=doc.querySelector?.('[data-wl-send-it]')||null;
  const msg=doc.getElementById?.('wlSendItMsg')||null;
  if(button){button.disabled=true;button.textContent='Creating Service handoff…';}
  if(msg)msg.innerHTML="<div class='warn top10'><b>Creating Service handoff…</b></div>";
  doc.body?.classList.add('busy');
  try{
    const ticketNo=prep?.ticket_no||'';
    await deps.verifyItems?.(items);
    await deps.releasePrep?.(prep?.id);
    await deps.refresh?.();
    return {...state,completed:true,ticketNo};
  }catch(error){
    if(button){button.disabled=false;button.textContent=partsOnly?'Hand Off Parts to Service →':'Hand Off to Service Tech →';}
    const esc=deps.escape||((value)=>String(value??''));
    if(msg)msg.innerHTML=`<div class='bad top10'><b>Could not create the Service handoff.</b><div>${esc(error?.message||'Please try again.')}</div></div>`;
    return {...state,completed:false,error};
  }finally{
    doc.body?.classList.remove('busy');
  }
}

window.TechCheckITPrepWizard=Object.freeze({nextAfterCheck,nextAfterReview,previous,finalLastUnit,handleQuestionClick,handleReviewClick,photoTagReady,unitIssues,initialState,finalReadiness,typePhaseDecision,releaseReadiness,releaseHandoff});

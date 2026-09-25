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

window.TechCheckITPrepWizard=Object.freeze({nextAfterCheck,nextAfterReview,previous,finalLastUnit,handleQuestionClick,handleReviewClick,photoTagReady,unitIssues});

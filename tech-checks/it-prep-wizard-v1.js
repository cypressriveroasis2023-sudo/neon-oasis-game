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
window.TechCheckITPrepWizard=Object.freeze({nextAfterCheck,nextAfterReview,previous,finalLastUnit});

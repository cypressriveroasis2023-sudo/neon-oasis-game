// Presentation only. The signed submission, evidence and authorization stay in desk.js.
export function guideTransferForm(form,{state,steps,onReview,onError}){
 const progress=document.createElement('h2');progress.tabIndex=-1;progress.dataset.transferProgress='';
 const controls=document.createElement('nav');controls.className='tc-guide-controls';controls.setAttribute('aria-label','Transfer steps');
 const make=(text,action)=>{const node=document.createElement('button');node.type='button';node.textContent=text;node.onclick=action;return node;};
 const paint=(focus=false)=>{
  state.step=Math.max(0,Math.min(state.step||0,steps.length-1));
  for(const [index,step] of steps.entries())for(const node of step.nodes)node.hidden=!state.all&&index!==state.step;
  progress.textContent=state.all?'All transfer steps':`Step ${state.step+1} of ${steps.length} · ${steps[state.step].title}`;
  back.hidden=state.all||state.step===0;next.hidden=state.all||state.step===steps.length-1;
  toggle.textContent=state.all?'Use guided steps':'Show all steps';
  onReview();if(focus)progress.focus();
 };
 const back=make('Previous step',()=>{state.step--;paint(true);});
 const next=make('Continue',()=>{
  const invalid=steps[state.step].nodes.flatMap(node=>[node,...node.querySelectorAll('input,select,textarea')]).find(node=>node.willValidate&&!node.checkValidity());
  if(invalid){onError('Complete '+(invalid.getAttribute('aria-label')||invalid.closest('label')?.firstChild?.textContent||'the required field')+' before continuing.',invalid);return;}
  if(steps[state.step].validate){const issue=steps[state.step].validate();if(issue){onError(issue);return;}}
  state.step++;paint(true);
 });
 const toggle=make('Show all steps',()=>{state.all=!state.all;paint(true);});toggle.className='tc-secondary';
 controls.append(back,next,toggle);form.prepend(progress);form.append(controls);
 // Reveal the original invalid control rather than bypassing validation on hidden steps.
 form.revealTransferControl=control=>{const index=steps.findIndex(step=>step.nodes.some(node=>node===control||node.contains(control)));if(index>=0){state.step=index;paint();}};
 paint();
}

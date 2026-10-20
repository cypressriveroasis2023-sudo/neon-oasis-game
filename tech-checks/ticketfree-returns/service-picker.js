import {selectionKey,itemName,itemReason,reasonLabel,selectItem,cataloguePage} from './batch-model.js?v=simple-20261020';
const node=(tag,text='',cls='')=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;};
const button=(text,fn,cls='')=>{const b=node('button',text,cls);b.type='button';b.onclick=fn;return b;};
export function servicePicker(root,{data,draft,save,redraw,appendEvidence,submit,tell}) {
 const dialog=root.closest('dialog'),locked=Boolean(draft.request),fields=node('fieldset');fields.disabled=locked;root.append(fields);
 const change=()=>{save().catch(e=>tell(e.message,true));};
 const render=()=>{change();redraw();if(dialog)dialog.scrollTop=0;};
 const available=data.truck.filter(t=>t.status==='assigned'&&t.unit_tag);
 const extraActions=[];
 const selected=e=>draft.items.some(i=>selectionKey(i)===selectionKey(e));
 const mode=draft.simpleMode||(draft.items.length?(draft.items.every(i=>itemReason(i)===itemReason(draft.items[0]))?itemReason(draft.items[0]):'batch'):null);
 const step=locked?'form':draft.simpleStep||(draft.items.length?'form':'home');
 function begin(value){
  if(mode!==value){draft.items=[];draft.pendingUsedKey='';draft.notes='';draft.photos=[];}
  draft.simpleMode=value;draft.simpleStep='form';draft.query='';draft.page=0;render();
 }
 function back(){draft.simpleStep='home';render();}
 function choose(target,item=null){draft.choiceTarget=target;draft.choiceId=item?.id||null;draft.simpleMode=mode;draft.simpleStep='choose';draft.query='';draft.page=0;render();}
 function selection(label,item,target,edit=null){
  const b=button('',()=>choose(target,edit),'cos-simple-selection');
  b.setAttribute('aria-label',label+': '+(item?itemName(item):'Choose equipment'));
  b.append(node('span',label),node('strong',item?itemName(item):'Choose equipment'),node('small',item?'Change':'Tap to choose'));
  return b;
 }
 function details(){const d=node('details','','cos-simple-details');d.append(node('summary','Notes, photos & more'),...extraActions);appendEvidence(d);root.append(d);}
 function saveButton(text){
  root.append(button(locked?'Retry saved returns':text,()=>{if(!draft.items.length){tell('Choose the equipment you are bringing back.',true);return;}submit();},'cos-ticketfree-primary'));
 }
 if(step==='home'){
  fields.append(node('h2','What are you doing?'));
  for(const [value,title,description,icon]of [['swap','Swap equipment','Replace a unit at a site','⇄'],['pickup','Pick up equipment','Bring a unit back','↓']]){
   const b=button('',()=>begin(value),'cos-simple-action');b.setAttribute('aria-label',title);b.append(node('span',icon,'cos-simple-icon'),node('strong',title),node('small',description));fields.append(b);
  }
  fields.append(button('Return unused equipment',()=>begin('truck_return'),'cos-simple-unused'));
  if(draft.items.length)fields.append(button('Continue selected equipment',()=>{draft.simpleStep='form';render();}));
  return;
 }
 if(step==='choose'){
  fields.append(button('‹ Back',()=>{draft.simpleStep='form';render();},'cos-simple-back'));
  const used=draft.choiceTarget==='used',truck=mode==='truck_return';
  fields.append(node('h2',used?'What did you install?':truck?'Return unused equipment':'What are you bringing back?'));
  const search=node('input');search.type='search';search.placeholder='Type a family and unit number';search.value=draft.query||'';search.setAttribute('aria-label','Search equipment');
  const list=node('div','','cos-simple-options'),summary=node('p','','cos-simple-count'),pager=node('div','','cos-return-pager');
  const editing=draft.items.find(i=>i.id===draft.choiceId);
  const source=used||truck?available:data.equipment.filter(e=>!available.some(t=>selectionKey(t)===selectionKey(e)||(t.family===e.family&&t.unit_tag===e.unit_tag)));
  function picked(e){
   if(used){if(editing)editing.usedKey=e.equipment_key;else draft.pendingUsedKey=e.equipment_key;}
   else if(editing){const at=draft.items.indexOf(editing);draft.items[at]={...e,id:editing.id,source:editing.source,reason:itemReason(editing),usedKey:editing.usedKey||''};}
   else selectItem(draft,e,mode==='truck_return'?'truck':mode==='swap'?'swap':'pickup');
   draft.simpleStep='form';render();
  }
  function show(){
   const result=cataloguePage(source,draft.query,'',draft.page,12);draft.page=result.page;list.replaceChildren();
   for(const e of result.items){
    const conflict=draft.items.some(i=>i.id!==editing?.id&&(selectionKey(i)===selectionKey(e)||i.usedKey===e.equipment_key));
    const b=button(itemName(e),()=>picked(e),'cos-simple-option');b.setAttribute('aria-label','Select '+itemName(e));
    b.disabled=conflict||(used&&!e.equipment_key)||(!used&&Boolean(e.equipment_key)&&e.equipment_key===(editing?.usedKey||draft.pendingUsedKey));
    if(used&&!e.equipment_key)b.append(node('small','IT must verify this unit ID first.'));
    else if(conflict)b.append(node('small','Already selected'));
    list.append(b);
   }
   summary.textContent=result.count?result.start+'–'+result.end+' of '+result.count:'No matching equipment.';
   const previous=button('Previous',()=>{draft.page--;show();change();}),next=button('Next',()=>{draft.page++;show();change();});previous.disabled=result.page===0;next.disabled=result.page===result.pages-1;pager.replaceChildren(previous,next);pager.hidden=result.pages===1;
  }
  search.oninput=()=>{draft.query=search.value;draft.page=0;show();change();};fields.append(search,summary,list,pager);show();return;
 }
 if(locked){
  fields.append(node('h2','Verify saved return'),node('p','Retry this saved request to confirm it.'));
  for(const item of draft.items){const card=node('article','','cos-simple-review');card.append(node('strong',itemName(item)),node('small',reasonLabel(itemReason(item))));if(item.usedKey)card.append(node('p','Installed: '+itemName(data.truck.find(t=>t.equipment_key===item.usedKey)||{name:item.usedKey})));fields.append(card);}
  saveButton('Retry saved returns');return;
 }
 fields.append(button('‹ Back',back,'cos-simple-back'));
 fields.append(node('h2',mode==='swap'?'Record a swap':mode==='pickup'?'Pick up equipment':mode==='truck_return'?'Return unused equipment':'Review returns'));
 if(mode==='truck_return'){
  fields.append(button('Select all truck equipment',()=>{for(const e of available)if(!selected(e))selectItem(draft,e,'truck');render();},'cos-simple-unused'));
  const grid=node('div','','cos-simple-options');
  for(const e of available){
   const label=node('label','','cos-return-pick'),input=node('input'),copy=node('span');input.type='checkbox';input.checked=selected(e);input.setAttribute('aria-label','Return '+itemName(e));input.onchange=()=>{selectItem(draft,e,'truck');render();};copy.append(node('strong',itemName(e)));if(!e.equipment_key)copy.append(node('small','IT will verify the unit ID.'));label.append(input,copy);grid.append(label);
  }
  fields.append(grid);if(!available.length)fields.append(node('p','No unused equipment is assigned to your truck.'));
 }else{
  const entries=draft.items.length?draft.items:[null];
  for(const item of entries){
   const pair=node('div','','cos-simple-pair'),reason=item?itemReason(item):mode;
   if(reason==='swap'){
    const key=item?.usedKey||(!item?draft.pendingUsedKey:''),used=data.truck.find(t=>key&&t.equipment_key===key);
    pair.append(selection('I installed from my truck',used,'used',item),node('div','⇅','cos-simple-arrow'));
   }
   pair.append(selection('I am bringing back',item,'returned',item));
   if(reason==='swap'){
    const key=item?.usedKey||(!item?draft.pendingUsedKey:''),used=data.truck.find(t=>key&&t.equipment_key===key);
    if(used)pair.append(node('p',itemName(used)+' leaves truck stock','cos-return-used'));
   }
   if(item)extraActions.push(button('Remove '+itemName(item),()=>{draft.items=draft.items.filter(i=>i.id!==item.id);render();},'cos-simple-remove'));
   fields.append(pair);
  }
  if(draft.items.length&&mode!=='batch')extraActions.push(button(mode==='swap'?'Add another swap':'Add another unit',()=>{draft.pendingUsedKey='';choose('returned');},'cos-simple-unused'));
 }
 saveButton(mode==='swap'?'Save swap':mode==='pickup'?'Save pickup':'Save return');
 if(draft.items.length)root.append(node('small','IT will receive '+draft.items.map(itemName).join(', ')+'.','cos-simple-helper'));
 details();
}

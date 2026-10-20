import {selectionKey,itemName,selectItem,cataloguePage} from './batch-model.js?v=multi-20261020';
const node=(tag,text='',cls='')=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;};
const button=(text,fn,cls='')=>{const b=node('button',text,cls);b.type='button';b.onclick=fn;return b;};
export function servicePicker(root,{data,draft,save,redraw,appendEvidence,submit,tell}) {
 const locked=Boolean(draft.request),fields=node('fieldset');fields.disabled=locked;root.append(fields);
 const changed=()=>{save().catch(e=>tell(e.message,true));};
 const rerender=()=>{changed();redraw();};
 const selected=e=>draft.items.some(i=>selectionKey(i)===selectionKey(e));
 const usedKeys=()=>draft.items.map(i=>i.usedKey).filter(Boolean);
 const available=data.truck.filter(t=>t.status==='assigned'&&t.unit_tag);
 const toggle=(e,source)=>{selectItem(draft,e,source);rerender();};
 const tabs=node('div','','cos-return-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Return source');
 for(const [value,text] of [['truck','Truck equipment'],['site','Removed from site']]){
  const b=button(text,()=>{draft.tab=value;rerender();});b.setAttribute('aria-pressed',String(draft.tab===value));tabs.append(b);
 }
 fields.append(tabs);
 if(locked)root.prepend(node('p','A saved request needs verification. Retry the same selection; no duplicate returns will be created.','cos-ticketfree-warning'));
 function card(e,source) {
  const label=node('label','','cos-return-pick'),input=node('input'),copy=node('span');input.type='checkbox';input.checked=selected(e);
  input.setAttribute('aria-label','Return '+itemName(e));input.disabled=usedKeys().includes(e.equipment_key);
  input.onchange=()=>toggle(e,source);
  copy.append(node('strong',itemName(e)));
  if(!e.equipment_key)copy.append(node('small','Unit ID needs verification. IT can receive it, but cannot mark it ready yet.'));
  else copy.append(node('small',input.disabled?'Selected as an installed replacement':input.checked?'Selected for return':source==='truck'?'Tap to return this unit':'Tap to add to this return'));
  label.append(input,copy);return label;
 }
 if(draft.tab==='truck'){
  fields.append(node('h3','Return from my truck'),node('p','Tap every unit you are bringing back.'));
  const all=button('Select all truck equipment',()=>{
   for(const t of available)if(!selected(t)&&!usedKeys().includes(t.equipment_key))selectItem(draft,t,'truck');rerender();
  });all.disabled=!available.length;fields.append(all);
  const grid=node('div','','cos-return-grid');for(const t of available)grid.append(card(t,'truck'));fields.append(grid);
  for(const t of data.truck.filter(t=>t.status!=='assigned'))fields.append(node('p',itemName(t)+' — '+(t.status==='used_restock_due'?'Used or returned; waiting for replenishment':'Not assigned')));
  if(!available.length)fields.append(node('p','No units are currently on your truck. Use Removed from site for equipment collected in the field.'));
 }else{
  fields.append(node('h3','Equipment removed from site'),node('p','Search any family and number. Add one or more units; record a replacement only when you installed one.'));
  const search=node('input');search.type='search';search.placeholder='Example: Sniper 176 or Spotter 257HDC2';search.value=draft.query||'';search.setAttribute('aria-label','Search returned equipment');
  const families=node('div','','cos-return-families');families.setAttribute('role','group');families.setAttribute('aria-label','Equipment family');
  const results=node('div','','cos-return-results'),summary=node('p'),pager=node('div','','cos-return-pager');summary.setAttribute('role','status');
  function show(){
   families.replaceChildren();
   for(const family of ['',...new Set(data.equipment.map(e=>e.family))].sort()){
    const b=button(family||'All families',()=>{draft.family=family;draft.page=0;show();changed();});b.setAttribute('aria-pressed',String((draft.family||'')===family));families.append(b);
   }
   const result=cataloguePage(data.equipment,draft.query,draft.family,draft.page);draft.page=result.page;
   results.replaceChildren();for(const e of result.items)results.append(card(e,'site'));
   summary.textContent=result.count?'Showing '+result.start+'–'+result.end+' of '+result.count+' units':'No exact catalogue results. Check the family and unit tag; other families are never substituted.';
   const prev=button('Previous units',()=>{draft.page--;show();changed();}),next=button('Next units',()=>{draft.page++;show();changed();});prev.disabled=result.page===0;next.disabled=result.page===result.pages-1;
   pager.replaceChildren(prev,node('span','Page '+(result.page+1)+' of '+result.pages),next);
  }
  search.oninput=()=>{draft.query=search.value;draft.page=0;show();changed();};fields.append(search,families,summary,results,pager);show();
 }
 const review=node('section','','cos-return-selection');review.append(node('h3','Sending to IT ('+draft.items.length+')'));
 if(!draft.items.length)review.append(node('p','No equipment selected yet.'));
 for(const item of draft.items){
  const line=node('article','','cos-ticketfree-return');line.append(node('strong',itemName(item)),node('small',item.source==='truck'?'Returning from truck':'Removed from site'));
  if(!item.equipment_key)line.append(node('p','IT will verify this unit ID before it is added to available inventory.'));
  if(item.source==='site'&&item.equipment_key){
   const details=node('details');if(item.usedKey)details.open=true;details.append(node('summary',item.usedKey?'Replacement installed: '+item.usedKey:'Record replacement installed (optional)'));
   const options=[{equipment_key:'',name:'No replacement installed'},...available];
   for(const t of options){
    const label=node('label','','cos-return-radio'),radio=node('input');radio.type='radio';radio.name='replacement-'+item.id;radio.checked=(item.usedKey||'')===(t.equipment_key||'');
    const none=t.equipment_key==='';radio.disabled=!none&&(!t.equipment_key||draft.items.some(i=>i.equipment_key===t.equipment_key)||draft.items.some(i=>i!==item&&i.usedKey===t.equipment_key));
    radio.setAttribute('aria-label',(none?'No replacement':'Install '+itemName(t))+' for '+itemName(item));
    radio.onchange=()=>{item.usedKey=t.equipment_key;rerender();};label.append(radio,node('span',itemName(t)+(radio.disabled?' — unavailable for this swap':'')));details.append(label);
   }
   line.append(details);
  }
  line.append(button('Remove '+itemName(item),()=>{draft.items=draft.items.filter(i=>i.id!==item.id);rerender();}));review.append(line);
 }
 fields.append(review);appendEvidence(fields);
 const send=button(locked?'Retry saved returns':'Send '+draft.items.length+' unit'+(draft.items.length===1?'':'s')+' to IT',submit,'cos-ticketfree-primary');
 send.disabled=!draft.items.length;root.append(send,node('small','IT receives each unit separately. Nothing becomes Ready inventory until IT checks it in.'));
}

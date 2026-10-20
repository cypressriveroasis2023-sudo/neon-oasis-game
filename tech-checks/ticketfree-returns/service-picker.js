import {selectionKey,itemName,itemReason,reasonLabel,selectItem,cataloguePage} from './batch-model.js?v=swap-pickup-20261020';
const node=(tag,text='',cls='')=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;};
const button=(text,fn,cls='')=>{const b=node('button',text,cls);b.type='button';b.onclick=fn;return b;};
export function servicePicker(root,{data,draft,save,redraw,appendEvidence,submit,tell}) {
 const locked=Boolean(draft.request),fields=node('fieldset');fields.disabled=locked;root.append(fields);
 const changed=()=>{save().catch(e=>tell(e.message,true));};
 const dialog=root.closest('dialog');
 const rerender=(top=false)=>{changed();redraw();if(top&&dialog)dialog.scrollTop=0;};
 const selected=e=>draft.items.some(i=>selectionKey(i)===selectionKey(e));
 const usedKeys=()=>draft.items.map(i=>i.usedKey).filter(Boolean);
 const available=data.truck.filter(t=>t.status==='assigned'&&t.unit_tag);
 const unavailable=e=>!e.equipment_key||selected(e)||usedKeys().includes(e.equipment_key);
 const toggle=(e,source)=>{selectItem(draft,e,source);rerender();};
 const startSwap=e=>{draft.pendingUsedKey=e.equipment_key;draft.tab='swap';draft.query='';draft.family='';draft.page=0;rerender(true);};
 const tabs=node('div','','cos-return-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Equipment action');
 for(const [value,text] of [['truck','My truck equipment'],['swap','Used for swap'],['pickup','Pickup from site']]){
  const b=button(text,()=>{draft.tab=value;if(value!=='swap')draft.pendingUsedKey='';rerender(true);});b.setAttribute('aria-pressed',String(draft.tab===value));tabs.append(b);
 }
 fields.append(tabs);
 if(locked)root.prepend(node('p','A saved request needs verification. Retry the same selection; no duplicate returns will be created.','cos-ticketfree-warning'));
 function card(e,source) {
  const label=node('label','','cos-return-pick'),input=node('input'),copy=node('span');input.type='checkbox';input.checked=selected(e);
  input.setAttribute('aria-label','Return '+itemName(e));input.disabled=Boolean(e.equipment_key&&usedKeys().includes(e.equipment_key));
  input.onchange=()=>toggle(e,source);copy.append(node('strong',itemName(e)));
  if(!e.equipment_key)copy.append(node('small','Unit ID needs verification. IT can receive it, but cannot mark it ready yet.'));
  else copy.append(node('small',input.disabled?'Selected as an installed replacement':input.checked?'Selected for return':source==='truck'?'Return unused equipment to IT':source==='swap'?'Removed during a swap':'Collected on a pickup — no replacement'));
  label.append(input,copy);return label;
 }
 if(draft.tab==='truck'){
  fields.append(node('h3','My truck equipment'),node('p','Tap Used for swap for installed units. Check unused units to return them.'));
  const all=button('Select all unused truck equipment',()=>{
   for(const t of available)if(!selected(t)&&!usedKeys().includes(t.equipment_key))selectItem(draft,t,'truck');rerender();
  });all.disabled=!available.length;fields.append(all);
  const grid=node('div','','cos-return-grid');
  for(const t of available){
   const unit=node('article','','cos-truck-action');unit.append(card(t,'truck'));
   const use=button('Used '+itemName(t)+' for swap',()=>startSwap(t));use.disabled=unavailable(t);unit.append(use);
   if(!t.equipment_key)unit.append(node('small','IT must verify the unit ID before this unit can be recorded as installed.'));
   grid.append(unit);
  }
  fields.append(grid);
  const used=data.truck.filter(t=>t.status!=='assigned'&&t.unit_tag);
  if(used.length){
   fields.append(node('h3','No longer available on my truck'));
   for(const t of used){
    const swap=data.returns.find(r=>r.used_key&&r.used_key===t.equipment_key),returned=data.returns.find(r=>r.source_mode==='truck_return'&&r.family===t.family&&r.unit_tag===t.unit_tag);
    fields.append(node('p',itemName(t)+' — '+(swap?'Used for swap · installed at site':returned?'Returned to IT · replenishment due':'Unavailable · replenishment due')));
   }
  }
  if(!available.length)fields.append(node('p','No available units are currently on your truck. Use Pickup from site for equipment collected without a replacement.'));
 }else{
  const swap=draft.tab==='swap',pending=available.find(t=>t.equipment_key&&t.equipment_key===draft.pendingUsedKey);
  fields.append(node('h3',swap?'Equipment removed during a swap':'Equipment collected on a pickup'));
  fields.append(node('p',swap?'Select the unit you removed. Pair it with the equipment you installed from your truck below.':'Select the equipment you collected. A pickup does not use replacement stock from your truck.'));
  if(pending)fields.append(node('p','Used from my truck: '+itemName(pending)+'. Select the equipment it replaced.','cos-return-used'));
  const search=node('input');search.type='search';search.placeholder='Example: Sniper 176 or Spotter 257HDC2';search.value=draft.query||'';search.setAttribute('aria-label','Search returned equipment');
  const families=node('div','','cos-return-families');families.setAttribute('role','group');families.setAttribute('aria-label','Equipment family');
  const results=node('div','','cos-return-results'),summary=node('p'),pager=node('div','','cos-return-pager');summary.setAttribute('role','status');
  // Assigned truck stock has its own actions; it cannot be mislabeled as a site pickup.
  const catalogue=data.equipment.filter(e=>!available.some(t=>selectionKey(t)===selectionKey(e)));
  function show(){
   families.replaceChildren();
   for(const family of ['',...new Set(catalogue.map(e=>e.family))].sort()){
    const b=button(family||'All families',()=>{draft.family=family;draft.page=0;show();changed();});b.setAttribute('aria-pressed',String((draft.family||'')===family));families.append(b);
   }
   const result=cataloguePage(catalogue,draft.query,draft.family,draft.page);draft.page=result.page;
   results.replaceChildren();for(const e of result.items)results.append(card(e,swap?'swap':'pickup'));
   summary.textContent=result.count?'Showing '+result.start+'–'+result.end+' of '+result.count+' units':'No exact catalogue results. Check the family and unit tag; other families are never substituted.';
   const prev=button('Previous units',()=>{draft.page--;show();changed();}),next=button('Next units',()=>{draft.page++;show();changed();});prev.disabled=result.page===0;next.disabled=result.page===result.pages-1;
   pager.replaceChildren(prev,node('span','Page '+(result.page+1)+' of '+result.pages),next);
  }
  search.oninput=()=>{draft.query=search.value;draft.page=0;show();changed();};fields.append(search,families,summary,results,pager);show();
 }
 const review=node('section','','cos-return-selection');review.append(node('h3','Sending to IT ('+draft.items.length+')'));
 if(!draft.items.length)review.append(node('p','No equipment selected yet.'));
 for(const item of draft.items){
  const reason=itemReason(item),line=node('article','','cos-ticketfree-return');line.append(node('strong',itemName(item)),node('small','Reason: '+reasonLabel(reason)));
  if(!item.equipment_key)line.append(node('p','IT will verify this unit ID before it is added to available inventory.'));
  if(item.source==='site'&&item.equipment_key){
   const reasons=node('div','','cos-return-reasons');reasons.setAttribute('role','group');reasons.setAttribute('aria-label','Return reason for '+itemName(item));
   for(const [value,text]of [['swap','Return from swap'],['pickup','Pickup — no replacement']]){
    const b=button(text,()=>{item.reason=value;if(value==='pickup')item.usedKey='';rerender();});b.setAttribute('aria-pressed',String(reason===value));reasons.append(b);
   }
   line.append(reasons);
   if(reason==='swap'){
    line.append(node('p','Equipment used from my truck (required)'));
    for(const t of available){
     const label=node('label','','cos-return-radio'),radio=node('input');radio.type='radio';radio.name='replacement-'+item.id;
     radio.checked=Boolean(t.equipment_key)&&item.usedKey===t.equipment_key;radio.disabled=!t.equipment_key||selected(t)||draft.items.some(i=>i!==item&&i.usedKey===t.equipment_key);
     radio.setAttribute('aria-label','Install '+itemName(t)+' for '+itemName(item));
     radio.onchange=()=>{item.usedKey=t.equipment_key;rerender();};label.append(radio,node('span',itemName(t)+(radio.disabled?' — unavailable for this swap':'')));line.append(label);
    }
    const installed=available.find(t=>t.equipment_key&&t.equipment_key===item.usedKey);
    line.append(node('p',installed?itemName(installed)+' will be removed from available truck inventory. '+itemName(item)+' will be sent to IT.':'Choose the installed unit before saving this swap.',installed?'cos-return-used':'cos-ticketfree-warning'));
   }
  }
  line.append(button('Remove '+itemName(item),()=>{draft.items=draft.items.filter(i=>i.id!==item.id);rerender();}));review.append(line);
 }
 fields.append(review);appendEvidence(fields);
 const send=button(locked?'Retry saved returns':'Send '+draft.items.length+' unit'+(draft.items.length===1?'':'s')+' to IT',submit,'cos-ticketfree-primary');
 send.disabled=!draft.items.length;root.append(send,node('small','Saving a swap removes the installed equipment from truck availability. Returned equipment becomes available only after IT checks it in.'));
}

import {ticketfreeClient} from './client.js';
import {INTAKE_CHECKS,stateLabel,freshDraft,assertIntake} from './model.js';
import {deviceDraft,transferJpeg} from '../transfers/client.js';
const node=(tag,text='',cls='')=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,run,cls='')=>{const b=node('button',text,cls);b.type='button';b.addEventListener('click',run);return b;};
const stamp=value=>value?new Date(value).toLocaleString():'';
function labeled(text,control){const l=node('label',text);l.append(control);return l;}
function choose(options,value='',label='') {
 const s=node('select');if(label)s.setAttribute('aria-label',label);
 for(const [v,t] of options){const o=node('option',t);o.value=v;s.append(o);}s.value=value;return s;
}
export function openTicketfreeReturns(context,{onSaved=()=>{}}={}) {
 const client=ticketfreeClient(context),dialog=node('dialog','','cos-ticketfree-dialog'),title=node('h2',client.role==='service'?'Return Equipment to IT':'Returned by Service'),status=node('p','','cos-ticketfree-status'),body=node('div'),toolbar=node('div','','cos-ticketfree-toolbar');
 let alive=true,generation=0,data=null,draft=null,draftKey='',busy=false,saveChain=Promise.resolve();
 const valid=()=>alive&&client.current()&&dialog.isConnected;
 const tell=(text,error=false)=>{if(!valid())return;status.textContent=text;status.setAttribute('role',error?'alert':'status');};
 const keep=()=>{const snapshot=structuredClone(draft),key=draftKey;saveChain=saveChain.catch(()=>{}).then(()=>deviceDraft(key,snapshot));return saveChain;};
 const close=()=>{if(busy)return;if(draft)void keep().catch(()=>{});alive=false;generation++;dialog.close();dialog.remove();};
 const refresh=button('Refresh',()=>void load());
 toolbar.append(title,refresh,button('Close',close));dialog.append(toolbar,status,body);document.body.append(dialog);
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.showModal();
 async function load(message='') {
  const rev=++generation;tell('Loading saved truck and return records…');refresh.disabled=true;
  try{const next=await client.read();if(!valid()||rev!==generation)return;data=next;
   if(client.role==='service'&&!draft){draftKey='ticketfree:submit:'+client.actor;draft=await deviceDraft(draftKey)||freshDraft('submit');if(!valid()||rev!==generation)return;}
   render();tell(message||'No MHelpDesk ticket is required. Sending a return does not mark it received.');
  }catch(e){tell(e.message,true);}finally{if(valid())refresh.disabled=false;}
 }
 function section(label){const s=node('section','','cos-ticketfree-section');s.append(node('h3',label));body.append(s);return s;}
 function render() {
  if(!valid()||!data)return;body.replaceChildren();
  if(draft?.kind==='receive'){renderIntake();return;}
  if(client.role==='service')renderService();
  renderReturns();
 }
 function renderService() {
  const truck=section('On my truck'),list=node('div','','cos-ticketfree-truck');
  for(const t of data.truck){const row=node('div');row.append(node('strong',t.family+' '+(t.unit_tag||'—')),node('span',t.status==='assigned'?'On truck':t.status==='used_restock_due'?'Used / awaiting replenishment':'Not assigned'));list.append(row);}
  if(!data.truck.length)list.append(node('p','No truck units are currently assigned. You can still send a removed field unit to IT.'));
  truck.append(list);
  const s=section('Record a swap or return'),form=node('form'),fields=node('fieldset');fields.disabled=Boolean(draft.request);
  if(draft.request)s.append(node('p','A previous save needs verification. Retry the saved request without changing its equipment.','cos-ticketfree-warning'));
  const used=choose([['','No replacement used — return only'],...data.truck.filter(t=>t.status==='assigned'&&t.equipment_key).map(t=>[t.equipment_key,t.family+' '+t.unit_tag])],draft.usedKey,'Replacement used from my truck');
  used.onchange=()=>{draft.usedKey=used.value;void keep().catch(e=>tell(e.message,true));};fields.append(labeled('Replacement used from my truck',used));
  const search=node('input');search.type='search';search.placeholder='Search returned unit: family or exact number';search.setAttribute('aria-label','Search returned equipment');
  const selected=choose([['','Choose the unit being brought back']],draft.returnedKey,'Equipment being returned to IT');selected.size=5;
  const updateOptions=()=>{const query=search.value.trim().toLowerCase(),found=data.equipment.filter(e=>e.name.toLowerCase().includes(query)||e.equipment_key.toLowerCase().includes(query));
   const retain=data.equipment.find(e=>e.equipment_key===draft.returnedKey),items=found.slice(0,100);if(retain&&!items.includes(retain))items.unshift(retain);
   selected.replaceChildren();const empty=node('option','Choose the unit being brought back');empty.value='';selected.append(empty);
   for(const e of items){const o=node('option',e.name);o.value=e.equipment_key;selected.append(o);}selected.value=draft.returnedKey;
  };
  search.oninput=updateOptions;selected.onchange=()=>{draft.returnedKey=selected.value;void keep().catch(e=>tell(e.message,true));};updateOptions();
  fields.append(labeled('Equipment being returned to IT',search),selected,node('small','Search by family and number. Exact suffixes and leading zeroes are preserved.'));
  appendNotesPhotos(fields);form.append(fields,button(draft.request?'Retry and verify saved return':'Send to IT',()=>void submit(),'cos-ticketfree-primary'));form.onsubmit=e=>{e.preventDefault();void submit();};s.append(form);
 }
 function appendNotesPhotos(fields) {
  const notes=node('textarea');notes.rows=3;notes.maxLength=2000;notes.value=draft.notes;notes.placeholder=draft.kind==='receive'?'Intake notes; required when repair is needed':'Location or condition notes (optional)';notes.oninput=()=>{draft.notes=notes.value;void keep().catch(e=>tell(e.message,true));};fields.append(labeled('Notes',notes));
  const photos=node('input');photos.type='file';photos.accept='image/*';photos.multiple=true;photos.setAttribute('capture','environment');photos.setAttribute('aria-label','Add optional equipment photos');
  photos.onchange=async()=>{if(busy)return;busy=true;const rev=generation;try{for(const file of photos.files){if(draft.photos.length>=8)throw new Error('Use no more than eight photos.');const jpeg=await transferJpeg(file);if(!valid()||rev!==generation)return;draft.photos.push(jpeg);}await keep();if(valid()){render();tell('Photos kept in this device draft until submission.');}}catch(e){tell(e.message,true);}finally{busy=false;}};
  fields.append(labeled('Photos (optional)',photos),node('small',draft.photos.length+' photo(s) in this draft'));
  if(draft.photos.length)fields.append(button('Clear draft photos',()=>{draft.photos=[];void keep();render();}));
 }
 function renderReturns() {
  const pending=data.returns.filter(r=>r.state==='waiting_it'),recent=data.returns.filter(r=>r.state!=='waiting_it');
  const s=section('Waiting for IT ('+data.pending_count+')');if(!pending.length)s.append(node('p','No equipment is waiting for IT check-in.'));
  for(const r of pending)s.append(returnCard(r));
  if(recent.length){const history=section('Recent check-ins');for(const r of recent.slice(0,30))history.append(returnCard(r));}
 }
 function returnCard(r,allowAction=true) {
  const card=node('article','','cos-ticketfree-return');card.dataset.returnId=r.id;
  card.append(node('strong',r.family+' '+r.unit_tag),node('span',stateLabel(r.state)),node('small','From '+r.service_tech_name+' · '+stamp(r.submitted_at)));
  if(r.used_key)card.append(node('p','Replacement used: '+r.used_family+' '+r.used_tag));
  if(r.notes)card.append(node('p',r.notes));
  if(r.received_at)card.append(node('small','Received by '+r.it_tech_name+' · '+stamp(r.received_at)));
  if(r.intake_notes)card.append(node('p',r.intake_notes));
  if(r.photos?.length)card.append(button('View return photos',()=>void showPhotos(r.photos,card)));
  if(allowAction&&client.role!=='service'&&r.state==='waiting_it')card.append(button('Check in this equipment',()=>void beginIntake(r),'cos-ticketfree-primary'));
  return card;
 }
 async function showPhotos(paths,card) {
  try{for(const path of paths){const url=await client.photoUrl(path);if(!valid()||!card.isConnected)return;const image=node('img');image.alt='Saved equipment return evidence';image.src=url;image.loading='lazy';card.append(image);}}catch(e){tell(e.message,true);}
 }
 async function beginIntake(r) {
  if(busy)return;const rev=++generation;
  try{draftKey='ticketfree:receive:'+client.actor+':'+r.id;const saved=await deviceDraft(draftKey);if(!valid()||rev!==generation)return;draft=saved||freshDraft('receive',r.id);draft.returnRevision=r.revision;render();tell('Confirm physical receipt, then record condition.');}catch(e){tell(e.message,true);}
 }
 function renderIntake() {
  const r=data.returns.find(x=>x.id===draft.returnId);if(!r){tell('This return is no longer in the queue. Refresh before continuing.',true);return;}
  const s=section('Check in '+r.family+' '+r.unit_tag);s.append(returnCard(r,false));
  const form=node('form'),fields=node('fieldset');fields.disabled=Boolean(draft.request);
  if(draft.request)s.append(node('p','Retry this saved receipt to verify it before starting another check-in.','cos-ticketfree-warning'));
  for(const [key,label] of INTAKE_CHECKS){const select=choose([['','Choose…'],['true','Pass / not applicable'],['false','Issue found']],typeof draft.checks[key]==='boolean'?String(draft.checks[key]):'',label);
   select.onchange=()=>{if(select.value==='')delete draft.checks[key];else draft.checks[key]=select.value==='true';void keep();};fields.append(labeled(label,select));}
  const received=node('input');received.type='checkbox';received.checked=draft.received;received.onchange=()=>{draft.received=received.checked;void keep();};fields.append(labeled('I have physically received and verified this unit.',received));
  const disposition=choose([['','Choose inventory destination'],['ready','Ready Shop inventory'],['repair','Needs repair — not available stock']],draft.disposition,'Inventory destination');disposition.onchange=()=>{draft.disposition=disposition.value;void keep();};fields.append(labeled('Inventory destination',disposition));appendNotesPhotos(fields);
  form.append(fields,button(draft.request?'Retry and verify check-in':'Complete IT check-in',()=>void submit(),'cos-ticketfree-primary'));
  form.onsubmit=e=>{e.preventDefault();void submit();};s.append(form,button('Back to return queue',()=>{void keep();draft=null;draftKey='';render();}));
 }
 async function submit() {
  if(busy||!draft||!valid())return;busy=true;const originalDraft=draft,rev=generation;
  const controls=[...dialog.querySelectorAll('button,input,select,textarea')].map(n=>[n,n.disabled]);for(const [n]of controls)n.disabled=true;
  try{
   client.assert();
   if(!draft.request){
    if(draft.kind==='submit'){
     if(!data.equipment.some(e=>e.equipment_key===draft.returnedKey))throw new Error('Choose the equipment being returned to IT.');
     if(draft.usedKey===draft.returnedKey)throw new Error('Choose different installed and removed units. For unused equipment, leave the replacement empty.');
    }else assertIntake(draft);
    const paths=await client.paths(draft.id,draft.photos);if(!valid()||rev!==generation)return;
    draft.request=draft.kind==='submit'?{p_request_id:draft.id,p_returned_key:draft.returnedKey,p_used_key:draft.usedKey||null,p_notes:draft.notes,p_photos:paths}:{p_request_id:draft.id,p_return_id:draft.returnId,p_revision:draft.returnRevision,p_received:draft.received,p_disposition:draft.disposition,p_checks:draft.checks,p_notes:draft.notes,p_photos:paths};
    await keep();
   }
   tell('Saving this equipment movement…');const result=await client.submit(draft.kind,draft.request,draft.photos);if(!valid()||rev!==generation)return;
   await deviceDraft(draftKey,null,true);client.assert();draft=null;draftKey='';onSaved(result);await load(stateLabel(result.state)+'. Saved in COS.');
  }catch(e){if(valid()&&draft===originalDraft){if(e.rejected){draft.request=null;await keep().catch(()=>{});}render();tell(e.message+(draft.request?' The same request is retained for a safe retry.':''),true);}}
  finally{busy=false;for(const [n,disabled]of controls)if(n.isConnected)n.disabled=disabled;}
 }
 void load();
 return ()=>{busy=false;close();};
}
let mounted=null,owner='',closePanel=null,scheduled=false,lastCountAt=0,countBusy=false;
const scope=()=>{
 const c=window.TechCheckContext,p=c?.getProfile?.(),id=c?.getSession()?.user?.id,role=c?.getRole?.();
 if(!id||p?.user_id!==id||p.active!==true||p.archived_at||!['service','it','owner'].includes(role)||document.getElementById('appView')?.classList.contains('hidden')||document.body.classList.contains('owner-test-role-preview'))return null;
 return {c,id,role};
};
function sync() {
 const s=scope(),identity=s?s.id+':'+s.role:'';
 if(owner!==identity){closePanel?.();closePanel=null;mounted?.remove();mounted=null;owner=identity;lastCountAt=0;}
 if(!s)return;
 const target=s.role==='service'?document.querySelector('#wlSvcHome .wl-service-action-list')||document.getElementById('wlSvcTruckInventory'):document.getElementById('cosITDailyHost');
 if(!target)return;
 if(!mounted?.isConnected||mounted.parentElement!==target){mounted?.remove();mounted=button(s.role==='service'?'Return to IT':'Returned by Service — Check In',()=>{
   closePanel?.();closePanel=openTicketfreeReturns(s.c,{onSaved:()=>{lastCountAt=0;void updateCount();window.dispatchEvent(new CustomEvent('techcheck:ticketfree-return-saved'));}});
  },'cos-ticketfree-launch');mounted.dataset.cosTicketfreeReturns='';target.prepend(mounted);}
 if(s.role!=='service')void updateCount();
}
async function updateCount() {
 const s=scope(),button=mounted,id=owner;
 if(!s||s.role==='service'||!button?.isConnected||countBusy||Date.now()-lastCountAt<60000||document.hidden)return;
 countBusy=true;lastCountAt=Date.now();
 try{const data=await ticketfreeClient(s.c).read();if(owner===id&&button.isConnected)button.textContent='Returned by Service ('+data.pending_count+') — Check In';}
 catch{if(owner===id&&button.isConnected)button.title='Return count could not refresh. Open the queue to retry.';}
 finally{countBusy=false;}
}
function schedule(){if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;sync();});}
if(typeof document!=='undefined'){
 const css=node('link');css.rel='stylesheet';css.href=new URL('./style.css?v=20261019',import.meta.url).href;document.head.append(css);
 new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
 for(const event of ['techcheck:view-changed','techcheck:data-refreshed','pageshow','online'])window.addEventListener(event,schedule);
 document.addEventListener('visibilitychange',()=>{lastCountAt=0;schedule();});
 setInterval(()=>void updateCount(),60000);schedule();
}

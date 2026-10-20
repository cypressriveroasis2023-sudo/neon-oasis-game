import {ticketfreeClient} from './client.js?v=swap-pickup-20261020';
import {batchDraft,prepareBatch,reasonLabel,savedReturnReason} from './batch-model.js?v=swap-pickup-20261020';
import {servicePicker} from './service-picker.js?v=swap-pickup-20261020';
import {INTAKE_CHECKS,stateLabel,freshDraft,assertIntake} from './model.js?v=multi-20261020';
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
 const client=ticketfreeClient(context),dialog=node('dialog','','cos-ticketfree-dialog'),title=node('h2',client.role==='service'?'Swaps & returns to IT':'Returned by Service'),status=node('p','','cos-ticketfree-status'),body=node('div'),toolbar=node('div','','cos-ticketfree-toolbar');
 let alive=true,generation=0,data=null,draft=null,draftKey='',busy=false,saveChain=Promise.resolve();
 const valid=()=>alive&&client.current()&&dialog.isConnected;
 const tell=(text,error=false)=>{if(!valid())return;status.textContent=text;status.setAttribute('role',error?'alert':'status');if(error)dialog.scrollTop=0;};
 const keep=()=>{const snapshot=structuredClone(draft),key=draftKey;saveChain=saveChain.catch(()=>{}).then(()=>deviceDraft(key,snapshot));return saveChain;};
 const close=()=>{if(busy)return;if(draft)void keep().catch(()=>{});alive=false;generation++;dialog.close();dialog.remove();};
 const refresh=button('Refresh',()=>void load());
 toolbar.append(title,refresh,button('Close',close));dialog.append(toolbar,status,body);document.body.append(dialog);
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.showModal();
 async function load(message='') {
  const rev=++generation;tell('Loading saved truck and return records…');refresh.disabled=true;
  try{const next=await client.read();if(!valid()||rev!==generation)return;data=next;
   if(client.role==='service'&&!draft){draftKey='ticketfree:submit:'+client.actor;draft=batchDraft(await deviceDraft(draftKey)||freshDraft('submit'),data.equipment);if(!valid()||rev!==generation)return;}
   render();dialog.scrollTop=0;tell(message||(client.role==='service'?'Choose a swap, pickup or unused return. No ticket needed.':'Review returns and confirm physical receipt.'));
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
  const root=section('Equipment action');
  servicePicker(root,{data,draft,save:keep,redraw:render,appendEvidence:appendNotesPhotos,submit:()=>void submit(),tell});
 }
 function appendNotesPhotos(fields) {
  const notes=node('textarea');notes.rows=3;notes.maxLength=2000;notes.value=draft.notes;notes.placeholder=draft.kind==='receive'?'Intake notes; required when repair is needed':'Location or condition notes (optional)';notes.oninput=()=>{draft.notes=notes.value;void keep().catch(e=>tell(e.message,true));};fields.append(labeled('Notes',notes));
  const photos=node('input');photos.type='file';photos.accept='image/*';photos.multiple=true;photos.setAttribute('capture','environment');photos.setAttribute('aria-label','Add optional equipment photos');
  photos.onchange=async()=>{if(busy)return;busy=true;const rev=generation;try{for(const file of photos.files){if(draft.photos.length>=8)throw new Error('Use no more than eight photos.');const jpeg=await transferJpeg(file);if(!valid()||rev!==generation)return;draft.photos.push(jpeg);}await keep();if(valid()){render();tell('Photos kept in this device draft until submission.');}}catch(e){tell(e.message,true);}finally{busy=false;}};
  fields.append(labeled('Photos (optional)',photos),node('small',draft.photos.length+' photo(s) in this draft'));
  if(draft.photos.length)fields.append(button('Clear draft photos',()=>{draft.photos=[];void keep();render();}));
 }
 function renderReturns() {
  const pending=data.returns.filter(r=>r.state==='waiting_it'),review=data.returns.filter(r=>r.state==='identity_review'),recent=data.returns.filter(r=>!['waiting_it','identity_review'].includes(r.state));
  const s=section('Waiting for IT ('+data.pending_count+')');if(!pending.length)s.append(node('p','No equipment is waiting for IT check-in.'));
  for(const r of pending)s.append(returnCard(r));
  if(review.length){const held=section('Received — Unit ID review ('+review.length+')');for(const r of review)held.append(returnCard(r));}
  if(recent.length){const history=section('Recent check-ins');for(const r of recent.slice(0,30))history.append(returnCard(r));}
 }
 function returnCard(r,allowAction=true) {
  const card=node('article','','cos-ticketfree-return');card.dataset.returnId=r.id;
  card.append(node('strong',r.family+' '+r.unit_tag),node('span',stateLabel(r.state)),node('small','From '+r.service_tech_name+' · '+stamp(r.submitted_at)));
  card.append(node('p','Reason: '+reasonLabel(savedReturnReason(r))));
  if(r.used_key)card.append(node('p','Used from truck: '+r.used_family+' '+r.used_tag+' · installed at site, no longer available on truck'));
  if(r.notes)card.append(node('p',r.notes));
  if(r.received_at)card.append(node('small','Received by '+r.it_tech_name+' · '+stamp(r.received_at)));
  if(r.intake_notes)card.append(node('p',r.intake_notes));
  if(r.identity_state==='needs_review')card.append(node('p','Unit ID verification required before this equipment can become Ready inventory.'));
  if(r.photos?.length)card.append(button('View return photos',()=>void showPhotos(r.photos,card)));
  if(allowAction&&client.role!=='service'&&r.state==='waiting_it')card.append(button('Check in this equipment',()=>void beginIntake(r),'cos-ticketfree-primary'));
  return card;
 }
 async function showPhotos(paths,card) {
  try{for(const path of paths){const url=await client.photoUrl(path);if(!valid()||!card.isConnected)return;const image=node('img');image.alt='Saved equipment return evidence';image.src=url;image.loading='lazy';card.append(image);}}catch(e){tell(e.message,true);}
 }
 async function beginIntake(r) {
  if(busy)return;const rev=++generation;
  try{draftKey='ticketfree:receive:'+client.actor+':'+r.id;const saved=await deviceDraft(draftKey);if(!valid()||rev!==generation)return;draft=saved||freshDraft('receive',r.id);draft.returnRevision=r.revision;draft.needsReview=r.identity_state==='needs_review';if(draft.needsReview)draft.disposition='review';render();tell('Confirm physical receipt, then record condition.');}catch(e){tell(e.message,true);}
 }
 function renderIntake() {
  const r=data.returns.find(x=>x.id===draft.returnId);if(!r){tell('This return is no longer in the queue. Refresh before continuing.',true);return;}
  const s=section('Check in '+r.family+' '+r.unit_tag);s.append(returnCard(r,false));
  const form=node('form'),fields=node('fieldset');fields.disabled=Boolean(draft.request);
  if(draft.request)s.append(node('p','Retry this saved receipt to verify it before starting another check-in.','cos-ticketfree-warning'));
  for(const [key,label] of INTAKE_CHECKS){const select=choose([['','Choose…'],['true','Pass / not applicable'],['false','Issue found']],typeof draft.checks[key]==='boolean'?String(draft.checks[key]):'',label);
   select.onchange=()=>{if(select.value==='')delete draft.checks[key];else draft.checks[key]=select.value==='true';void keep();};fields.append(labeled(label,select));}
  const received=node('input');received.type='checkbox';received.checked=draft.received;received.onchange=()=>{draft.received=received.checked;void keep();};fields.append(labeled('I have physically received and verified this unit.',received));
  const disposition=choose(draft.needsReview?[['review','Received — Unit ID review required']]:[['','Choose inventory destination'],['ready','Ready Shop inventory'],['repair','Needs repair — not available stock']],draft.disposition,'Inventory destination');disposition.onchange=()=>{draft.disposition=disposition.value;void keep();};fields.append(labeled('Inventory destination',disposition));appendNotesPhotos(fields);
  form.append(fields,button(draft.request?'Retry and verify check-in':'Complete IT check-in',()=>void submit(),'cos-ticketfree-primary'));
  form.onsubmit=e=>{e.preventDefault();void submit();};s.append(form,button('Back to return queue',()=>{void keep();draft=null;draftKey='';render();}));
 }
 async function submit() {
  if(busy||!draft||!valid())return;busy=true;const originalDraft=draft,rev=generation;
  const controls=[...dialog.querySelectorAll('button,input,select,textarea')].map(n=>[n,n.disabled]);for(const [n]of controls)n.disabled=true;
  try{
   client.assert();
   if(!draft.request){
    if(draft.kind==='submit')draft.request=await prepareBatch(draft,client);
    else {
     assertIntake(draft);
     const paths=await client.paths(draft.id,draft.photos);
     draft.request={p_request_id:draft.id,p_return_id:draft.returnId,p_revision:draft.returnRevision,p_received:draft.received,p_disposition:draft.disposition,p_checks:draft.checks,p_notes:draft.notes,p_photos:paths};
    }
    if(!valid()||rev!==generation)return;
    await keep();
   }
   tell('Saving this equipment movement…');
   const result=draft.kind==='submit'?await client.submitBatch(draft.request,draft.photos):await client.submit(draft.kind,draft.request,draft.photos);
   if(!valid()||rev!==generation)return;
   const swaps=draft.kind==='submit'?draft.request.p_items.filter(i=>i.used_key).length:0;
   const message=draft.kind==='submit'?result.results.length+' unit(s) sent to IT.'+(swaps?' '+swaps+' installed replacement(s) removed from available truck inventory.':' Waiting for physical check-in.'):stateLabel(result.state)+'. Saved in COS.';
   await saveChain;
   await deviceDraft(draftKey,null,true);client.assert();draft=null;draftKey='';onSaved(result);await load(message);
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
 if(!mounted?.isConnected||mounted.parentElement!==target){mounted?.remove();mounted=button(s.role==='service'?'Swap / Pickup / Return to IT':'Returned by Service — Check In',()=>{
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
 const css=node('link');css.rel='stylesheet';css.href=new URL('./style.css?v=swap-pickup-20261020',import.meta.url).href;document.head.append(css);
 new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
 for(const event of ['techcheck:view-changed','techcheck:data-refreshed','pageshow','online'])window.addEventListener(event,schedule);
 document.addEventListener('visibilitychange',()=>{lastCountAt=0;schedule();});
 setInterval(()=>void updateCount(),60000);schedule();
}

import {transferTitle} from './model.js';
import {deviceDraft,transferJpeg} from './client.js';
import {correctionClient} from './correction-client.js';
import {SELF_CONFIRMATION,CITED_CONFIRMATION,centralTime,centralDateTimeToISO,httpsEvidence,draftItems,manifestFromDraft,correctionChanges,validateCorrection} from './correction-model.js';

const element=(tag,text='',className='')=>{const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node;};
const button=(text,action,secondary=false)=>{const node=element('button',text,secondary?'tc-secondary':'');node.type='button';node.onclick=action;return node;};
const label=(text,control)=>{const node=element('label',text);node.append(control);return node;};
function field(type,value,onChange,caption){const node=element(type==='textarea'?'textarea':'input');if(type!=='textarea')node.type=type;node.value=value||'';node.setAttribute('aria-label',caption);node.addEventListener('input',()=>onChange(node.value));return node;}
function link(text,url){const safe=httpsEvidence(url);if(!safe)return null;const node=element('a',text);node.href=safe;node.target='_blank';node.rel='noopener noreferrer';return node;}
const display=value=>Array.isArray(value)?value.map(item=>typeof item==='object'?item.name+' × '+item.quantity:item).join(', ')||'None listed':String(value??'Not recorded');
const itemText=item=>`${item.family} ${item.unit_tag}\nSaved identity: ${item.equipment_key}\nSIM cards: ${display(item.sims)}\nBattery count: ${item.battery_count}\nAdditional parts: ${display(item.parts)}`;
function loadStyle(){if(!document.querySelector('[data-transfer-style]')){const node=element('link');node.rel='stylesheet';node.href=new URL('./desk.css',import.meta.url).href;node.dataset.transferStyle='';document.head.append(node);}if(!document.querySelector('[data-correction-style]')){const node=element('link');node.rel='stylesheet';node.href=new URL('./corrections.css',import.meta.url).href;node.dataset.correctionStyle='';document.head.append(node);}}

// A correction is an attributed revision. It never asks for, copies, or replaces
// the original signature, and it never submits a Service acceptance.
export function mountCorrectionDesk(root,context,{transferId=null,onClose=null}={}) {
  loadStyle();root.classList.add('tc-transfer','tc-corrections');root.setAttribute('aria-label','Handoff corrections');
  const client=correctionClient(context),urls=new Set();
  let disposed=false,generation=0,data=null,draft=null,activeTransfer=null,storageKey='',busy=false,pendingPhotos=0,statusNode=null;
  const current=()=>!disposed&&root.isConnected&&client.current();
  const guard=()=>{client.assert();if(disposed||!root.isConnected)throw new Error('This correction screen is no longer active.');};
  const reset=()=>{for(const url of urls)URL.revokeObjectURL(url);urls.clear();root.replaceChildren();statusNode=null;};
  const message=(text,error=false)=>{if(!current())return;if(!statusNode?.isConnected){statusNode=element('p','','tc-status');root.append(statusNode);}statusNode.textContent=text;statusNode.setAttribute('role',error?'alert':'status');};
  const persist=async()=>{guard();await deviceDraft(storageKey,draft);guard();};
  const invalidate=()=>{draft.confirmed=false;const checkbox=root.querySelector('[data-correction-confirmation]');if(checkbox)checkbox.checked=false;};
  const changed=()=>{invalidate();persist().catch(error=>message(error.message,true));};
  const heading=detail=>{root.append(element('small','CAMERAS ONSITE · TECHCHECK'),element('h1','Handoff corrections'));if(detail)root.append(element('p',detail));};
  function close(){if(busy||pendingPhotos)return;if(onClose)onClose();else void load();}
  function details(title,contents){const node=element('details');node.append(element('summary',title),...contents);return node;}
  function manifest(title,items){const node=element('section');node.append(element('h3',title));for(const item of items||[])node.append(element('pre',itemText(item),'tc-expected'));return node;}
  function diffTable(before,after){
    const wrapper=element('div','','tc-correction-table'),table=element('table');table.append(element('caption','What changed'));
    const header=element('tr');for(const caption of ['Saved identity / field','Before','After'])header.append(element('th',caption));const head=element('thead');head.append(header);table.append(head);
    const body=element('tbody');for(const change of correctionChanges(before,after)){const row=element('tr');row.append(element('th',change.equipment_key+' · '+change.field),element('td',display(change.before)),element('td',display(change.after)));body.append(row);}table.append(body);wrapper.append(table);return wrapper;
  }
  function evidence(container,photos){
    const seen=new Set();for(const photo of photos||[]){if(seen.has(photo.path))continue;seen.add(photo.path);
      container.append(button(photo.kind==='signature'?'View original signature':'View saved photo · '+photo.equipment_key,async()=>{
        try{const url=await client.photoUrl(photo.path);guard();const target=new URL(url,location.href);if(target.protocol!=='https:'&&target.origin!==location.origin)throw new Error('Saved photo link is unavailable.');const node=element('a','Open saved evidence photo');node.href=target.href;node.target='_blank';node.rel='noopener noreferrer';container.append(node);}catch(error){message(error.message,true);}
      },true));
    }
  }
  function history(transfer){
    const original=transfer.original,blocks=[];
    if(original){
      const source=manifest('Original submitted details',original.snapshot?.actual||original.snapshot?.expected||[]);
      source.append(element('p',`Submitted by ${original.actor_name||transfer.it_name} · ${centralTime(original.signed_at)}`),element('small','Original event '+original.event_id));
      const report=link('Open original signed handoff',original.report_url),folder=link('Open original archive',original.drive_folder_id?'https://drive.google.com/drive/folders/'+original.drive_folder_id:null);if(report)source.append(report);if(folder)source.append(folder);evidence(source,original.photos);
      blocks.push(details('Original signed submission — preserved', [source]));
    }
    for(const correction of transfer.corrections||[]){
      const entry=element('article','','tc-card');entry.dataset.correctionId=correction.correction_id;
      entry.append(element('h3','Correction revision '+correction.revision),element('p','Reason: '+correction.reason),element('p',`Applied by ${correction.applied_by?.name||'Recorded actor'} · ${centralTime(correction.created_at)}`),element('small','Acting account: '+correction.applied_by?.id),element('p',`Confirmed by ${correction.confirmed_by?.name||transfer.it_name} · ${centralTime(correction.confirmed_by?.confirmed_at)}`));
      entry.append(element('p',correction.confirmed_by?.mode==='cited'?'Technician confirmation recorded from cited evidence. The applying account remains separately identified.':'The original submitting technician confirmed this correction in their own account.'));
      if(correction.technician_reply)entry.append(element('blockquote',correction.technician_reply));
      const source=link('Technician confirmation evidence',correction.evidence_reference),report=link('Open archived correction',correction.report_url),folder=link('Open correction evidence archive',correction.drive_folder_id?'https://drive.google.com/drive/folders/'+correction.drive_folder_id:null);for(const node of [source,report,folder])if(node)entry.append(node);
      entry.append(diffTable(correction.before,correction.after),details('Full before and after details',[manifest('Before this correction',correction.before),manifest('After this correction',correction.after)]));evidence(entry,correction.photos);
      entry.append(element('p',correction.delivery==='sent'?'Correction archived; James notification sent.':['review','blocked'].includes(correction.delivery)?'Correction saved. Archive or notification needs review; sending is not confirmed.':'Correction saved. Archive and James notification are pending.','tc-draft-note'),element('small','Correction '+correction.correction_id));blocks.push(entry);
    }
    if(!(transfer.corrections||[]).length)blocks.push(element('p','No correction revisions have been recorded.'));
    return blocks;
  }
  function home(notice=''){
    reset();draft=null;activeTransfer=null;
    heading('Review the original signed handoff and any linked corrections. Service must separately verify and accept the actual equipment.');
    if(onClose)root.append(button('Back to handoffs',close,true));
    if(!data.ready)root.append(element('p','Corrections are held until the reviewed database and archive delivery release gates are enabled. Saved history remains available.','tc-status'));
    if(!data.transfers.length)root.append(element('p','No handoffs are available for this account.'));
    for(const transfer of data.transfers){
      const card=element('article','','tc-card');card.dataset.transferId=transfer.id;
      card.append(element('h2',`${transfer.it_name} → ${transfer.service_name}`),element('strong',transferTitle(transfer.state)),element('small','Handoff '+transfer.id+' · current revision '+transfer.revision),manifest('Current saved handoff details',transfer.manifest));
      if(transfer.can_correct_self)card.append(button('Correct this handoff',()=>start(transfer.id,'self')));
      else if(transfer.can_apply_cited)card.append(button('Apply technician-confirmed correction',()=>start(transfer.id,'cited')));
      else if(transfer.correction_block_reason)card.append(element('p',transfer.correction_block_reason,'tc-draft-note'));
      card.append(...history(transfer));root.append(card);
    }
    root.append(button('Reload corrections',()=>load(),true));if(notice)message(notice);
  }
  async function load(notice=''){
    const turn=++generation;reset();heading();message('Reading saved handoffs and correction history…');
    try{const result=await client.read(transferId);guard();if(turn!==generation)return;data=result;home(notice);}catch(error){if(current()&&turn===generation){message(error.unavailable?'Audited corrections have not been installed yet. Existing handoffs remain available.':error.message,true);root.append(button('Retry reading corrections',()=>load(),true));if(onClose)root.append(button('Back to handoffs',close,true));}}
  }
  function allowed(transfer,mode){return data.ready&&(mode==='self'?transfer.can_correct_self:transfer.can_apply_cited);}
  async function start(id,mode){
    if(busy)return;const turn=++generation;busy=true;
    try{
      const fresh=await client.read(id);guard();if(turn!==generation)return;data=fresh;
      const transfer=fresh.transfers.find(row=>row.id===id);if(!transfer)throw new Error('This handoff is no longer available to your account.');
      storageKey=client.actor+':correction:'+id;const saved=await deviceDraft(storageKey);guard();if(turn!==generation)return;
      if(saved?.request){
        const recorded=transfer.corrections.find(row=>client.verified(row,saved.request));
        if(recorded){await deviceDraft(storageKey,undefined,true);guard();home('Correction saved. The server readback confirms revision '+recorded.revision+'.');return;}
      }
      if(!saved?.request&&!allowed(transfer,mode))throw new Error(transfer.correction_block_reason||'This handoff cannot be corrected in the current state.');
      activeTransfer=transfer;draft=saved||{id:crypto.randomUUID(),transferId:id,revision:transfer.revision,mode,items:draftItems(transfer.manifest),photos:[],reason:'',technicianReply:'',evidenceReference:'',confirmedAt:'',confirmed:false,request:null};
      if(draft.mode!==mode&&!draft.request)throw new Error('A correction draft for another confirmation mode is already saved. Reopen that draft before continuing.');
      await persist();render();
    }catch(error){message(error.message,true);}finally{busy=false;}
  }
  function canSelect(item){return item.supported!==false&&(!item.hold_reason)&&(!item.reserved||item.reservation_transfer_id===activeTransfer.id)&&item.tracker_state==='shop';}
  function render(){
    reset();heading(`${activeTransfer.it_name} → ${activeTransfer.service_name} · revision ${draft.revision}`);
    root.append(element('small','Handoff '+activeTransfer.id),element('p','The original signed PDF, signature, photographs and submitted answers stay unchanged. This adds a correction revision and updates only the pending equipment reservation.'));
    root.append(button('Back to saved handoff',()=>{if(!busy)void load();},true));
    if(draft.request){
      root.append(element('p','This correction request is saved on this device and may already be recorded. Retry the same request to verify its saved result. Its details cannot be changed during an uncertain save.'),diffTable(activeTransfer.manifest,draft.request.p_items),button('Retry saving correction',()=>complete()));
      if(draft.rejected)root.append(button('Discard rejected draft and review latest handoff',()=>discard(),true));
      return;
    }
    if(draft.revision!==activeTransfer.revision){
      root.append(element('p','Your saved draft refers to an older revision. Review the latest saved handoff before creating another correction. No change has been applied.','tc-status'),manifest('Draft details',manifestFromDraft(draft.items)),manifest('Latest saved details',activeTransfer.manifest),button('Discard stale draft and review latest handoff',()=>discard(),true));return;
    }
    const form=element('form');form.noValidate=true;form.setAttribute('aria-label','Handoff correction form');form.onsubmit=event=>{event.preventDefault();void complete();};
    form.append(manifest('Before this correction',activeTransfer.manifest));
    draft.items.forEach((item,index)=>{
      const group=element('fieldset');group.append(element('legend','Corrected equipment '+(index+1)));
      const select=element('select');select.required=true;select.setAttribute('aria-label','Corrected unit');
      for(const equipment of data.equipment){const option=new Option((equipment.unit_name||equipment.family+' '+equipment.unit_tag)+' · '+equipment.equipment_key+(canSelect(equipment)?'':' · unavailable'),equipment.equipment_key);option.disabled=!canSelect(equipment)&&equipment.equipment_key!==item.equipment_key;select.append(option);}
      select.value=item.equipment_key;
      select.onchange=()=>{const selected=data.equipment.find(row=>row.equipment_key===select.value);if(!selected)return;if(draft.items.some((row,i)=>i!==index&&row.equipment_key===selected.equipment_key)){select.value=item.equipment_key;message('That exact unit is already listed.',true);return;}const old=item.equipment_key;item.equipment_key=selected.equipment_key;item.family=selected.family;item.unit_tag=selected.unit_tag;draft.photos=draft.photos.filter(photo=>photo.equipment_key!==old);changed();render();};group.append(label('Corrected unit',select),element('small','Choose the physically verified unit. Never infer its tag from the original manifest.'));
      for(const [key,caption,type] of [['batteryText','Battery count','number'],['simText','SIM cards','textarea'],['partsText','Additional parts','textarea']]){
        const control=field(type,item[key],value=>{item[key]=value;changed();},caption);if(type==='number'){control.required=true;control.min='0';control.max='9999';control.step='1';}group.append(label(caption,control));
      }
      group.append(element('small','SIM cards: one exact identifier per line, or blank when none were part of this handoff. Service obtains SIMs separately; a Simetry request belongs in the mHelp service ticket.'),element('small','Additional parts: part name | quantity, one per line; leave blank or enter N/A when none.'));
      const photo=element('input');photo.type='file';photo.accept='image/*';photo.setAttribute('aria-label','Matching unit and tag photo');
      const preview=element('div','','tc-evidence'),savedPhoto=draft.photos.find(row=>row.equipment_key===item.equipment_key);
      const show=blob=>{const url=URL.createObjectURL(blob);urls.add(url);const img=element('img');img.alt='Matching photo for '+item.family+' '+item.unit_tag;img.src=url;const open=element('a','Open selected photo at full size');open.href=url;open.target='_blank';open.rel='noopener noreferrer';preview.replaceChildren(img,element('small','Photo saved with this draft.'),open)};if(savedPhoto)show(savedPhoto.blob);
      photo.onchange=async()=>{if(busy||!photo.files[0])return;const ownerDraft=draft,key=item.equipment_key,turn=generation;pendingPhotos++;photo.disabled=true;try{const blob=await transferJpeg(photo.files[0]);guard();if(draft!==ownerDraft||turn!==generation||item.equipment_key!==key)return;draft.photos=draft.photos.filter(row=>row.equipment_key!==key);draft.photos.push({equipment_key:key,blob});changed();show(blob);}catch(error){message(error.message,true);}finally{pendingPhotos--;if(photo.isConnected)photo.disabled=false;}};
      group.append(label('Matching unit and tag photo',photo),element('small','The photo must clearly show this unit and its attached identifying tag. A new photo is required for each changed or added unit.'),preview);
      if(draft.items.length>1)group.append(button('Remove this unit from pending handoff',()=>{if(busy||pendingPhotos)return;draft.items.splice(index,1);draft.photos=draft.photos.filter(row=>row.equipment_key!==item.equipment_key);changed();render();},true));
      form.append(group);
    });
    if(draft.items.length<20)form.append(button('Add another corrected unit',()=>{const next=data.equipment.find(row=>canSelect(row)&&!draft.items.some(item=>item.equipment_key===row.equipment_key));if(!next){message('No additional available registered unit can be added.',true);return;}draft.items.push({...next,simText:'',batteryText:'',partsText:''});changed();render();},true));
    const reason=field('textarea',draft.reason,value=>{draft.reason=value;changed();},'Reason for correction');reason.required=true;reason.maxLength=2000;form.append(label('Reason for correction',reason));
    if(draft.mode==='cited'){
      form.append(element('h2','Technician confirmation'),element('p','Record '+activeTransfer.it_name+'’s documented reply. You are applying this correction as '+(context.getProfile().full_name||context.getProfile().username)+'.'));
      const timestamp=field('datetime-local',draft.confirmedAt,value=>{draft.confirmedAt=value;changed();},'Technician confirmation date and time');timestamp.required=true;timestamp.step='1';form.append(label('Technician confirmation date and time',timestamp),element('small','Enter Central time (America/Chicago), regardless of this device’s time zone.'));
      const reply=field('textarea',draft.technicianReply,value=>{draft.technicianReply=value;changed();},'Technician reply');reply.required=true;reply.maxLength=5000;form.append(label('Technician reply',reply));
      const source=field('url',draft.evidenceReference,value=>{draft.evidenceReference=value;changed();},'Technician evidence link');source.required=true;source.maxLength=2000;form.append(label('Technician evidence link',source),element('small','Use the stable Google Drive, Docs or Gmail HTTPS link to the technician’s reply or saved evidence. The matching photo is also required above.'));
    }
    const confirm=element('input');confirm.type='checkbox';confirm.required=true;confirm.checked=draft.confirmed;confirm.dataset.correctionConfirmation='';confirm.onchange=()=>{draft.confirmed=confirm.checked;persist().catch(error=>message(error.message,true));};const confirmationLabel=label(draft.mode==='self'?SELF_CONFIRMATION:CITED_CONFIRMATION,confirm);confirmationLabel.className='tc-correction-confirm';form.append(confirmationLabel);
    form.append(element('p','Service acceptance remains pending. This correction does not add permanent truck stock or record a return. The linked correction archive and James notification are queued after saving.','tc-draft-note'));
    const submit=element('button','Save correction');submit.type='submit';form.append(submit);root.append(form);
  }
  async function discard(){if(busy)return;try{await deviceDraft(storageKey,undefined,true);guard();draft=null;await load('The unsaved or rejected draft was discarded. Review the latest saved handoff before starting again.');}catch(error){message(error.message,true);}}
  async function complete(){
    if(busy)return;if(pendingPhotos){message('Wait for the matching photo to finish processing before saving.',true);return;}
    const turn=generation;busy=true;
    try{
      guard();if(navigator.onLine===false)throw new Error('Reconnect before saving. Your correction draft is kept on this device.');
      if(!draft.request){
        const invalid=[...root.querySelectorAll('form input,form textarea,form select')].find(node=>node.willValidate&&!node.checkValidity());
        if(invalid){invalid.setAttribute('aria-invalid','true');invalid.focus();throw new Error(invalid.type==='checkbox'?'Confirm the corrected details and matching photo before saving.':'Complete '+(invalid.getAttribute('aria-label')||'the required field')+' before saving.');}
        const confirmation={mode:draft.mode,confirmed:draft.confirmed,technician_id:activeTransfer.original.actor_id};
        if(draft.mode==='cited')Object.assign(confirmation,{technician_confirmed_at:centralDateTimeToISO(draft.confirmedAt),technician_reply:draft.technicianReply.trim(),evidence_reference:httpsEvidence(draft.evidenceReference)});
        const items=manifestFromDraft(draft.items),photos=draft.photos.filter(photo=>items.some(item=>item.equipment_key===photo.equipment_key));
        validateCorrection({transfer:activeTransfer,items,equipment:data.equipment,reason:draft.reason,photos,confirmation});
        for(const node of root.querySelectorAll('input,select,textarea,button'))node.disabled=true;
        const paths=await client.paths(draft.id,photos);guard();if(turn!==generation)return;
        draft.photos=photos;draft.request={p_request_id:draft.id,p_transfer_id:activeTransfer.id,p_expected_revision:draft.revision,p_items:items,p_photos:paths,p_reason:draft.reason.trim(),p_confirmation:confirmation};
        await persist();guard();
      }
      message('Saving the correction and verifying the recorded revision…');
      await client.submit(draft.request,draft.photos,(count,total)=>message('Uploading matching evidence '+count+' of '+total+'…'));guard();if(turn!==generation)return;
      const readback=await client.read(activeTransfer.id);guard();if(turn!==generation)return;
      const saved=readback.transfers.find(row=>row.id===activeTransfer.id)?.corrections.find(row=>client.verified(row,draft.request));
      if(!saved)throw new Error('The correction save replied, but its saved readback is not confirmed. Retry the same correction.');
      await deviceDraft(storageKey,undefined,true);guard();data=readback;home('Correction saved. Server readback verified revision '+saved.revision+'. Service acceptance remains separate.');
    }catch(error){
      if(current()&&turn===generation){if(draft?.request){draft.rejected=error.rejected===true;await persist().catch(()=>{});render();}message(error.message,true);}
    }finally{busy=false;if(current())for(const node of root.querySelectorAll('input,select,textarea,button'))node.disabled=false;}
  }
  const checkIdentity=()=>{if(disposed||client.current())return;generation++;reset();root.append(element('p','Your account changed. Reopen handoffs with your own account.'));};
  const auth=context.db.auth?.onAuthStateChange?.(()=>queueMicrotask(checkIdentity));
  for(const event of ['techcheck:data-refreshed','techcheck:view-changed'])window.addEventListener(event,checkIdentity);
  void load();
  return ()=>{disposed=true;generation++;for(const url of urls)URL.revokeObjectURL(url);urls.clear();auth?.data?.subscription?.unsubscribe?.();for(const event of ['techcheck:data-refreshed','techcheck:view-changed'])window.removeEventListener(event,checkIdentity);root.replaceChildren();};
}

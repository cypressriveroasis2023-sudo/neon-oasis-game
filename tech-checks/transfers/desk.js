import '../tech-check-rules.js';
import {createDailySignoff,newSignature,signatureJpeg,hasSignatureInk} from '../service-signoff-ui.js';
import {normalizeManifest,receiptDifferences,TRANSFER_STATEMENT,INTAKE_CHECKS,transferTitle} from './model.js';
import {transferClient,deviceDraft,transferJpeg} from './client.js';
const element=(tag,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n;};
const button=(text,fn,secondary=false)=>{const b=element('button',text,secondary?'tc-secondary':'');b.type='button';b.onclick=fn;return b;};
const label=(text,input)=>{const l=element('label',text);l.append(input);return l;};
const number=value=>value===''?NaN:Number(value);
const lines=value=>String(value||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
const noExtraParts=value=>/^(?:none|n\/?a|no(?:\s+additional|\s+extra)?\s+parts?)\.?$/i.test(String(value||'').trim());
const parts=value=>noExtraParts(value)?[]:lines(value).map((line,index)=>{const match=line.match(/^(.+?)\s*(?:\|\s*|:\s*|\s+[x×]\s*)(\d+)$/i);if(!match||!match[1].trim())throw new Error('Additional parts, line '+(index+1)+': use part name | quantity (example: SD card | 1). Leave this field blank or enter N/A if there are no extra parts.');return {name:match[1].trim(),quantity:number(match[2])};});
const itemInput=item=>({equipment_key:item.equipment_key,family:item.family,unit_tag:item.unit_tag,sims:lines(item.simText),battery_count:number(item.batteryText),parts:parts(item.partsText)});
const expectedText=item=>`${item.family} ${item.unit_tag}\nSIM: ${item.sims.join(', ')||'None listed'}\nUnit batteries: ${item.battery_count}\nParts: ${item.parts.map(p=>p.name+' × '+p.quantity).join(', ')||'None listed'}`;
function input(type,value,changed){const n=document.createElement(type==='textarea'?'textarea':'input');if(type!=='textarea')n.type=type;n.value=value??'';n.addEventListener('input',()=>changed(n.value));return n;}
function loadStyle(){if(document.querySelector('[data-transfer-style]'))return;const l=document.createElement('link');l.rel='stylesheet';l.href=new URL('./desk.css',import.meta.url).href;l.dataset.transferStyle='';document.head.append(l);}
// Mounts inside the original TechCheck page, using its current account and database.
export function mountTransferDesk(root,context,{role='it',onUnavailable=null}={}){
 loadStyle();root.classList.add('tc-transfer');root.setAttribute('aria-label',role==='it'?'IT equipment check in and check out':'Equipment received from IT');
 const client=transferClient(context),urls=new Set();let disposed=false,data=null,contract=null,draft=null,storageKey='',busy=false,pending=0,statusNode=null,revision=0;
 const current=()=>!disposed&&client.current()&&root.isConnected;
 const guard=()=>{client.assert();if(disposed||!root.isConnected)throw new Error('This transfer screen is no longer active.');};
 const message=(text,error=false)=>{if(!current())return;if(!statusNode?.isConnected){statusNode=element('p','','tc-status');root.append(statusNode);}statusNode.textContent=text;statusNode.setAttribute('role',error?'alert':'status');};

 const showSubmitError=(detail,control=null)=>{
  if(!current())return;
  let alert=root.querySelector('[data-transfer-submit-error]');
  if(!alert){alert=element('p','','tc-submit-error');alert.setAttribute('role','alert');alert.dataset.transferSubmitError='';const submit=root.querySelector('button[type=submit]');if(submit)submit.before(alert);else root.append(alert);}
  alert.textContent=detail;
  if(control?.isConnected){control.setAttribute('aria-invalid','true');control.scrollIntoView({block:'center'});control.focus({preventScroll:true});}
  else alert.scrollIntoView({block:'center'});
 };
 const fieldFor=(index,field)=>root.querySelector('[data-transfer-item="'+index+'"][data-transfer-field="'+field+'"]');
 function validateBeforeSubmit(){
  if(!draft||draft.request)return null;
  const form=root.querySelector('form');
  if(!form)return null;
  const invalid=[...form.querySelectorAll('input,select,textarea')].find(control=>control.willValidate&&!control.checkValidity());
  if(invalid){
   const caption=invalid.getAttribute('aria-label')||invalid.closest('label')?.firstChild?.textContent?.trim()||'required field';
   return {detail:invalid.type==='checkbox'?'Finish the required equipment check before sending. Every required check must pass; report failed checks instead of marking them as passed.':'Complete '+caption+' before sending.',control:invalid};
  }
  if(!draft.items.some(item=>!item.missing))return {detail:'Add at least one equipment unit to this handoff.'};
  for(let index=0;index<draft.items.length;index++){
   const item=draft.items[index];if(item.missing)continue;
   try{parts(item.partsText);}catch(error){return {detail:error.message,control:fieldFor(index,'partsText')};}
   if(draft.kind==='checkout'){
    const minimum=contract?.families?.[item.workflow_type]?.minimum_batteries;
    if(Number.isInteger(minimum)&&number(item.batteryText)<minimum)return {detail:item.family+' '+item.unit_tag+' requires at least '+minimum+' batteries / battery boxes. Verify the actual count.',control:fieldFor(index,'batteryText')};
   }
   if(!draft.photos.some(photo=>photo.equipment_key===item.equipment_key))return {detail:'Add the required equipment photo for '+item.family+' '+item.unit_tag+' before sending.',control:root.querySelector('[data-transfer-photo="'+index+'"]')};
  }
  if(!draft.signature.confirmed)return {detail:'Sign and check the accuracy confirmation before sending.',control:form.querySelector('.cos-daily-signoff input[type=checkbox]')};
  if(draft.signature.method==='drawn'&&!hasSignatureInk(draft.signature))return {detail:'Draw your signature, or select Type signature and enter your account name.',control:form.querySelector('.cos-signature-canvas')};
  return null;
 }
 const reset=()=>{for(const url of urls)URL.revokeObjectURL(url);urls.clear();root.replaceChildren();statusNode=null;};
 const persist=async()=>{guard();await deviceDraft(storageKey,draft);guard();};
 const invalidate=()=>{if(draft?.signature)draft.signature.confirmed=false;const c=root.querySelector('.cos-daily-signoff input[type=checkbox]');if(c)c.checked=false;};
 const changed=()=>{invalidate();persist().catch(e=>message(e.message,true));};
 function heading(text,detail){root.append(element('small','CAMERAS ONSITE · TECHCHECK'),element('h1',text));if(detail)root.append(element('p',detail));}
 async function load(notice=''){
  const turn=++revision;reset();heading(role==='it'?'Equipment handoffs':'Equipment received from IT');message('Reading your saved handoffs…');
  try{const [result,rules]=await Promise.all([client.read(),contract?Promise.resolve(contract):fetch(new URL('./checklist-contract.json',import.meta.url)).then(r=>{if(!r.ok)throw new Error('Equipment checks unavailable.');return r.json();})]);guard();if(turn!==revision)return;if(result.role!==role)throw new Error('Your current role does not match this screen.');data=result;contract=rules;home(notice);}
  catch(e){if(current()&&turn===revision){if(onUnavailable){onUnavailable(e.reason||'unavailable');return;}message('Handoffs unavailable. '+e.message+' Saved handoff status could not be verified.',true);root.append(button('Retry handoffs',()=>load()));}}
 }
 function home(notice=''){
  reset();draft=null;heading(role==='it'?'Check equipment. Hand it over.':'Equipment received from IT',role==='it'?'Check only the equipment being transferred. Service completes their own truck inventory.':'Physically verify the equipment assigned to you. IT sending it does not mean you accepted it.');
  if(role==='it'){const actions=element('div','','tc-actions');actions.append(button('Check Out / Hand Off',()=>start('checkout')),button('Check In / Return',()=>chooseReturns(),true));root.append(actions);}
  const relevant=data.transfers.filter(t=>role==='it'||['awaiting_service','discrepancy','accepted'].includes(t.state));
  root.append(element('h2',role==='it'?'Handoffs and returns':'Your equipment handoffs'));
  if(!relevant.length)root.append(element('p','No handoffs in the current saved view.'));
  for(const t of relevant){const c=element('article','','tc-card');c.append(element('h3',t.manifest.map(i=>i.family+' '+i.unit_tag).join(' · ')),element('p',`${t.it_name} → ${t.service_name}`),element('strong',transferTitle(t.state)),element('small','Handoff '+t.id));
   if(role==='service'&&['awaiting_service','discrepancy'].includes(t.state))c.append(button('Verify equipment received',()=>start('receipt',t)));
   if(role==='it'&&t.state==='accepted')c.append(button('Check in this handoff',()=>start('return',t)));
   const details=element('details');details.append(element('summary','Saved checks, notes and evidence'));
   for(const e of t.events||[]){const block=element('div');block.append(element('p',`${e.actor_name} · ${e.kind} · ${new Date(e.signed_at).toLocaleString('en-US',{timeZone:'America/Chicago',hour12:false})} Central`),element('p',e.snapshot?.notes||''));
    if(e.report_url){const link=element('a','Open signed handoff report');link.href=e.report_url;link.target='_blank';link.rel='noopener noreferrer';block.append(link);}
    if(e.delivery)block.append(element('small',e.delivery==='sent'?'Report saved in Drive and emailed':e.delivery==='review'?'Report delivery needs IT review':'Report delivery pending'));
    if(e.snapshot?.differences?.length)block.append(element('pre',JSON.stringify(e.snapshot.differences,null,2),'tc-expected'));
    for(const p of e.photos||[])block.append(button('View '+(p.kind==='signature'?'signature':'equipment photo'),async()=>{try{const url=await client.photoUrl(p.path);guard();const a=element('a','Open saved photo');a.href=url;a.target='_blank';a.rel='noopener noreferrer';block.append(a);}catch(err){message(err.message,true);}},true));details.append(block);
   }c.append(details);root.append(c);
  }
  root.append(button('Reload handoffs',()=>load(),true),element('p','Signed handoff reports and photos save to TechCheck Drive. Delivery retries automatically.','tc-draft-note'));
  if(notice)message(notice);
 }
 function chooseReturns(){reset();heading('Check In / Return','Choose a handoff accepted by Service. Returns remain held for inventory review or repair.');root.append(button('Back',()=>home(),true));const rows=data.transfers.filter(t=>t.state==='accepted');if(!rows.length)root.append(element('p','No accepted handoffs are available for return.'));for(const t of rows)root.append(button(t.service_name+' · '+t.manifest.map(i=>i.family+' '+i.unit_tag).join(', '),()=>start('return',t)));}
 async function start(kind,transfer=null){
  if(busy)return;const turn=++revision;storageKey=client.actor+':'+kind+':'+(transfer?.id||'new');
  try{const saved=await deviceDraft(storageKey);guard();if(turn!==revision)return;
   draft=saved||{kind,id:crypto.randomUUID(),transferId:transfer?.id||null,revision:transfer?.revision||0,serviceActor:transfer?.service_actor||'',items:(transfer?.manifest||[]).map(i=>({...i,family:kind==='receipt'?'':i.family,unit_tag:kind==='receipt'?'':i.unit_tag,simText:kind==='receipt'?'':i.sims.join('\n'),batteryText:kind==='receipt'?'':String(i.battery_count),partsText:kind==='receipt'?'':i.parts.map(p=>p.name+' | '+p.quantity).join('\n'),checks:{},missing:false})),photos:[],signature:newSignature(),notes:'',request:null};
   if(transfer&&draft.revision!==transfer.revision&&!draft.request)throw new Error('Your saved draft refers to an older handoff. Reload and review before continuing.');
   await persist();render(transfer);
  }catch(e){message(e.message,true);}
 }
 function render(transfer){
  reset();heading({checkout:'Check Out / Hand Off',receipt:'Verify equipment received',return:'Check In / Return'}[draft.kind]);root.append(button('Back to handoffs',()=>load(),true));
  if(draft.request){root.append(element('p','This submission may already be saved. Retry exactly the same submission to verify it; do not create a duplicate.'),button('Retry same submission',()=>complete(transfer)));return;}
  const form=element('form');form.noValidate=true;form.setAttribute('aria-label','Equipment transfer form');form.onsubmit=e=>{e.preventDefault();void complete(transfer);};
  if(draft.kind==='checkout'){
   const recipient=element('select');recipient.required=true;recipient.setAttribute('aria-label','Receiving Service technician');recipient.append(new Option('Choose Service technician',''));for(const tech of data.technicians)recipient.append(new Option(tech.name,tech.id));recipient.value=draft.serviceActor;recipient.onchange=()=>{draft.serviceActor=recipient.value;changed();};form.append(label('Hand off to',recipient));
   const equipment=element('select');equipment.setAttribute('aria-label','Select equipment');equipment.append(new Option('Choose a saved Shop unit',''));for(const item of data.equipment){const option=new Option((item.unit_name||item.family+' '+item.unit_tag)+(item.hold_reason?' · '+item.hold_reason:item.reserved?' · already held':!item.supported?' · check mapping required':item.tracker_state!=='shop'?' · not Shop':''),item.equipment_key);option.disabled=item.reserved||!item.supported||item.tracker_state!=='shop';equipment.append(option);}
   form.append(label('Equipment',equipment),button('Add unit to handoff',()=>{const e=data.equipment.find(i=>i.equipment_key===equipment.value);if(!e)return message('Select an available Shop unit.',true);if(draft.items.some(i=>i.equipment_key===e.equipment_key))return message('That unit is already included.',true);if(draft.items.length>=20)return message('Use at most 20 units.',true);draft.items.push({equipment_key:e.equipment_key,family:e.family,unit_tag:e.unit_tag,workflow_type:e.workflow_type,simText:'',batteryText:'',partsText:'',checks:{},missing:false});changed();render(transfer);},true));
  }else form.append(element('p',`${transfer.it_name} → ${transfer.service_name}`),element('small','Handoff '+transfer.id));
  draft.items.forEach((item,index)=>{
   const expected=transfer?.manifest.find(i=>i.equipment_key===item.equipment_key),group=element('fieldset');group.append(element('legend',(expected?.family||item.family)+' '+(expected?.unit_tag||item.unit_tag)));
   if(expected)group.append(element('pre','IT sent:\n'+expectedText(expected),'tc-expected'));
   if(draft.kind==='receipt'){const missing=element('input');missing.type='checkbox';missing.checked=item.missing;missing.onchange=()=>{item.missing=missing.checked;changed();render(transfer);};group.append(label('I did not receive this item',missing));}
   if(!item.missing){
    for(const [field,caption,type] of [['family','Unit family / name','text'],['unit_tag','Unit number','text'],['simText','Exact SIM numbers (one per line; blank only when none)','textarea'],['batteryText','Batteries / battery boxes on this unit','number'],['partsText','Additional parts (one per line: name | quantity)','textarea']]){
     const n=input(type,item[field],value=>{item[field]=value;changed();});n.setAttribute('aria-label',caption+' '+(index+1));n.dataset.transferItem=String(index);n.dataset.transferField=field;if(['family','unit_tag','batteryText'].includes(field))n.required=true;if(draft.kind==='return')n.readOnly=true;if(type==='number'){n.min='0';n.max='9999';n.step='1';}group.append(label(field==='partsText'?'Additional parts (optional — name | quantity, or N/A for none)':caption,n));if(field==='partsText')group.append(element('small','Example: SD card | 1. Leave blank if no additional parts.'));
    }
    const fields=draft.kind==='checkout'?(window.TechCheckRules.itChecklist({equipment_type:item.workflow_type,purpose:'BACKUP',unit_tag:item.unit_tag,required_battery_count:contract.families[item.workflow_type]?.minimum_batteries},1).filter(s=>s.kind==='bool')):draft.kind==='return'?INTAKE_CHECKS.map(field=>({field,label:field.replaceAll('_',' ')})):[];
    if(draft.kind==='checkout')group.append(element('small','Existing IT check-only / BACKUP checklist. This does not dispatch a field job.'));
    for(const step of fields){const caption=step.label.replaceAll('{UNIT}',item.unit_tag).replaceAll('2026 Unit Tracker','2027 Unit Tracker');if(draft.kind==='return'){const n=element('select');n.required=true;n.append(new Option('Choose result',''),new Option('Pass','true'),new Option('Needs repair / attention','false'));n.value=item.checks[step.field]===undefined?'':String(item.checks[step.field]);n.onchange=()=>{item.checks[step.field]=n.value===''?undefined:n.value==='true';changed();};group.append(label(caption,n));}else{const n=element('input');n.type='checkbox';n.required=true;n.checked=item.checks[step.field]===true;n.onchange=()=>{item.checks[step.field]=n.checked;changed();};group.append(label(caption,n));}}
    const photoInput=element('input');photoInput.type='file';photoInput.accept='image/*';photoInput.setAttribute('aria-label','Equipment photo '+(index+1));photoInput.dataset.transferPhoto=String(index);
    const preview=element('div','','tc-evidence'),old=draft.photos.find(p=>p.equipment_key===item.equipment_key);const show=blob=>{const url=URL.createObjectURL(blob);urls.add(url);const img=element('img');img.alt='Saved equipment photo';img.src=url;preview.replaceChildren(img);};if(old)show(old.blob);
    photoInput.onchange=async()=>{if(busy||!photoInput.files[0])return;const ownerDraft=draft,formRevision=revision;pending++;photoInput.disabled=true;try{const blob=await transferJpeg(photoInput.files[0]);guard();if(draft!==ownerDraft||formRevision!==revision)return;draft.photos=draft.photos.filter(p=>p.equipment_key!==item.equipment_key).concat({equipment_key:item.equipment_key,kind:'unit',blob});invalidate();await persist();show(blob);message('Photo saved in this device draft.');}catch(e){message(e.message,true);}finally{pending--;photoInput.disabled=false;photoInput.value='';}};
    group.append(label('Equipment photo — required',photoInput),preview);
   }
   if(draft.kind==='checkout')group.append(button('Remove unit',()=>{draft.items.splice(index,1);draft.photos=draft.photos.filter(p=>p.equipment_key!==item.equipment_key);changed();render(transfer);},true));form.append(group);
  });
  const notes=input('textarea',draft.notes,value=>{draft.notes=value;changed();});notes.maxLength=2000;notes.setAttribute('aria-label','Transfer notes');form.append(label('Notes / problems / missing parts',notes));
  const name=context.getProfile()?.full_name||context.getProfile()?.username||'';
  form.append(createDailySignoff({state:draft.signature,actorName:name,statementText:TRANSFER_STATEMENT,isBusy:()=>busy,onChange:()=>persist().catch(e=>message(e.message,true))}));
  const submit=element('button',draft.kind==='checkout'?'Sign & send handoff':draft.kind==='return'?'Sign & record return':'Sign & verify received equipment');submit.type='submit';form.append(submit);root.append(form,element('p','A saved transfer does not update permanent truck stock, physical Field/Shop placement, or camera health.','tc-draft-note'));
 }
 async function complete(transfer){
  if(busy)return;const issue=validateBeforeSubmit();if(issue){showSubmitError(issue.detail,issue.control);return;}busy=true;const controls=[...root.querySelectorAll('button,input,select,textarea')].map(n=>[n,n.disabled]);for(const [n] of controls)n.disabled=true;
  try{
   guard();if(pending)throw new Error('Wait for the photo to finish saving.');if(!navigator.onLine)throw new Error('Offline. Your draft stays on this device; reconnect and retry.');
   let photos;
   if(!draft.request){
    const items=normalizeManifest(draft.items.filter(i=>!i.missing).map(itemInput),{allowEmpty:draft.kind==='receipt'});
    if(!draft.signature.confirmed)throw new Error('Sign and confirm the accuracy statement.');
    const name=context.getProfile()?.full_name||context.getProfile()?.username||'';const sig={method:draft.signature.method,name:draft.signature.method==='typed'?draft.signature.typedName:name,confirmed:true};
    if(sig.name.trim().replace(/\s+/g,' ').toLowerCase()!==name.trim().replace(/\s+/g,' ').toLowerCase())throw new Error('Use the name on your signed-in account.');
    photos=draft.photos.filter(p=>items.some(i=>i.equipment_key===p.equipment_key));
    if(items.some(i=>!photos.some(p=>p.equipment_key===i.equipment_key)))throw new Error('Photograph each received or transferred unit.');
    if(sig.method==='drawn'){const blob=draft.signature.blob||await signatureJpeg(draft.signature);photos=photos.concat({kind:'signature',equipment_key:'',blob});}
    const paths=await client.paths(draft.id,photos);guard();if(sig.method==='drawn')sig.path=paths.find(p=>p.kind==='signature').path;
    draft.request={p_request_id:draft.id,p_transfer_id:draft.transferId||draft.id,p_kind:draft.kind,p_expected_revision:draft.revision,p_service_actor:draft.serviceActor,p_items:items,p_checks:Object.fromEntries(draft.items.map(i=>[i.equipment_key,i.checks])),p_signature:sig,p_photos:paths,p_notes:draft.notes};draft.submissionPhotos=photos;await persist();
   }else photos=draft.submissionPhotos;
   const result=await client.submit(draft.request,photos,(n,total)=>message(`Saving evidence ${n} of ${total}…`));guard();
   await deviceDraft(storageKey,null,true).catch(()=>{});guard();
   await load(transferTitle(result.state)+'. Saved in COS; transfer report delivery is pending.');
  }catch(e){if(current()){if(e.unavailable&&onUnavailable){onUnavailable(e.reason||'unavailable');return;}if(e.rejected&&draft){draft.request=null;draft.submissionPhotos=null;await persist().catch(()=>{});}if(draft?.request)render(transfer);showSubmitError(e.message);}}
  finally{busy=false;for(const [n,disabled] of controls)if(n.isConnected)n.disabled=disabled;}
 }
 void load();
 return ()=>{disposed=true;revision++;for(const u of urls)URL.revokeObjectURL(u);urls.clear();root.replaceChildren();};
}

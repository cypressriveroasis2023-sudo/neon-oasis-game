import '../tech-check-rules.js';
import {createDailySignoff,newSignature,signatureJpeg,hasSignatureInk} from '../service-signoff-ui.js';
import {normalizeManifest,receiptDifferences,latestReceiptEvent,canRecordReceipt,TRANSFER_STATEMENT,INTAKE_CHECKS,transferTitle,TRANSFER_PURPOSES,transferPurposeLabel,hasTransferPurpose,installationBatteryPlan} from './model.js';
import {transferClient,deviceDraft,transferJpeg} from './client.js';
const element=(tag,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n;};
const button=(text,fn,secondary=false)=>{const b=element('button',text,secondary?'tc-secondary':'');b.type='button';b.onclick=fn;return b;};
const label=(text,input)=>{const l=element('label',text);l.append(input);return l;};
const number=value=>value===''?NaN:Number(value);
const lines=value=>String(value||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
const noExtraParts=value=>/^(?:none|n\/?a|no(?:\s+additional|\s+extra)?\s+parts?)\.?$/i.test(String(value||'').trim());
const parts=value=>noExtraParts(value)?[]:lines(value).map((line,index)=>{const match=line.match(/^(.+?)\s*(?:\|\s*|:\s*|\s+[x×]\s*)(\d+)$/i);if(!match||!match[1].trim())throw new Error('Additional parts, line '+(index+1)+': use part name | quantity (example: SD card | 1). Leave this field blank or enter N/A if there are no extra parts.');return {name:match[1].trim(),quantity:number(match[2])};});
const itemInput=(item,purpose)=>({equipment_key:item.equipment_key,family:item.family,unit_tag:item.unit_tag,sims:lines(item.simText),battery_count:purpose==='truck_replenishment'?null:number(item.batteryText),battery_configuration:purpose==='truck_replenishment'?null:installationBatteryPlan(item.family,item.batteryConfiguration).configuration||null,parts:parts(item.partsText)});
const expectedText=(item,purpose)=>`${item.family} ${item.unit_tag}\nSIM: ${item.sims.join(', ')||'None listed'}${purpose==='truck_replenishment'?'':'\nUnit batteries: '+item.battery_count+(item.battery_configuration?' · '+installationBatteryPlan(item.family,item.battery_configuration).description:'')}\nParts: ${item.parts.map(p=>p.name+' × '+p.quantity).join(', ')||'None listed'}`;
const differenceLabel={family:'Unit family',unit_tag:'Unit number',sims:'SIM numbers',battery_count:'Batteries / battery boxes',battery_configuration:'Installation battery setup',parts:'Additional parts',item:'Equipment'};
const differenceValue=value=>Array.isArray(value)?value.map(v=>typeof v==='object'?v.name+' × '+v.quantity:v).join(', ')||'None':String(value??'None');
const differenceText=diff=>(differenceLabel[diff.field]||diff.field)+': IT sent '+differenceValue(diff.expected)+'; receipt records '+differenceValue(diff.actual)+'.';
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
 const needsPhoto=item=>item.requirePhoto===true||!(draft?.kind==='receipt'&&draft.purpose==='truck_replenishment'&&item.receiptMode!=='difference'&&item.receivedAsListed===true);
 function validateBeforeSubmit(){
  if(!draft||draft.request)return null;
  const form=root.querySelector('form');
  if(!form)return null;
  const invalid=[...form.querySelectorAll('input,select,textarea')].find(control=>control.willValidate&&!control.checkValidity());
  if(invalid){
   const caption=invalid.getAttribute('aria-label')||invalid.closest('label')?.firstChild?.textContent?.trim()||'required field';
   return {detail:invalid.type==='checkbox'?'Finish the required equipment check before sending. Every required check must pass; report failed checks instead of marking them as passed.':'Complete '+caption+' before sending.',control:invalid};
  }
  if(draft.kind==='checkout'&&!draft.items.some(item=>!item.missing))return {detail:'Add at least one equipment unit to this handoff.'};
  if(draft.kind!=='return'&&!hasTransferPurpose(draft.purpose))return {detail:'IT / Owner must choose whether this handoff is for truck replenishment or installation before it can be signed.'};
  for(let index=0;index<draft.items.length;index++){
   const item=draft.items[index];if(item.missing)continue;
   if(draft.kind==='receipt'&&draft.purpose==='truck_replenishment'&&item.receiptMode!=='difference'&&!item.receivedAsListed)return {detail:'Confirm that you received '+item.family+' '+item.unit_tag+' as listed, or report what is different or missing.',control:fieldFor(index,'receivedAsListed')};
   try{parts(item.partsText);}catch(error){return {detail:error.message,control:fieldFor(index,'partsText')};}
   if(draft.kind==='checkout'&&draft.purpose==='installation'){
    const plan=installationBatteryPlan(item.workflow_type||item.family,item.batteryConfiguration),count=number(item.batteryText);
    if(!plan.configuration)return {detail:'Choose the installation battery setup for '+item.family+' '+item.unit_tag+'.',control:fieldFor(index,'batteryConfiguration')};
    if(count<plan.minimum||plan.exact&&count!==plan.count)return {detail:item.family+' '+item.unit_tag+' requires '+plan.description+'. Verify the actual count.',control:fieldFor(index,'batteryText')};
   }
   if(needsPhoto(item)&&!draft.photos.some(photo=>photo.equipment_key===item.equipment_key))return {detail:'Add the required equipment photo for '+item.family+' '+item.unit_tag+' before sending.',control:root.querySelector('[data-transfer-photo="'+index+'"]')};
  }
  if(!draft.signature.confirmed)return {detail:'Sign and check the accuracy confirmation before sending.',control:form.querySelector('.cos-daily-signoff input[type=checkbox]')};
  if(draft.signature.method==='drawn'&&!hasSignatureInk(draft.signature))return {detail:'Draw your signature, or select Type signature and enter your account name.',control:form.querySelector('.cos-signature-canvas')};
  return null;
 }
 const reset=()=>{for(const url of urls)URL.revokeObjectURL(url);urls.clear();root.replaceChildren();statusNode=null;};
 const persist=async()=>{guard();await deviceDraft(storageKey,draft);guard();};
 const invalidate=()=>{if(draft?.signature)draft.signature.confirmed=false;const c=root.querySelector('.cos-daily-signoff input[type=checkbox]');if(c)c.checked=false;};
 const changed=()=>{invalidate();updateReceiptReview();persist().catch(e=>message(e.message,true));};
 function updateReceiptReview(){
  const review=root.querySelector('[data-receipt-comparison]');if(!review||draft?.kind!=='receipt')return;
  review.hidden=draft.purpose==='truck_replenishment'&&draft.items.every(item=>item.receiptMode!=='difference'&&!item.missing);
  if(review.hidden)return;
  review.replaceChildren(element('h2','Before you sign'));
  try{
   if(draft.purpose==='truck_replenishment'&&draft.items.some(item=>!item.missing&&item.receiptMode!=='difference'&&!item.receivedAsListed))throw new Error('Confirm receipt first.');
   const transfer=data.transfers.find(t=>t.id===draft.transferId),items=normalizeManifest(draft.items.filter(i=>!i.missing).map(item=>itemInput(item,draft.purpose)),{allowEmpty:true,purpose:draft.purpose,requirePlan:false}),differences=receiptDifferences(transfer.manifest,items,{purpose:draft.purpose});
   if(differences.length){review.append(element('p','These details differ from IT’s handoff. Your receipt will be saved for IT / Owner review. Record what you actually received.'));const list=element('ul');for(const diff of differences)list.append(element('li',differenceText(diff)));review.append(list);}
   else review.append(element('p','Your entries match IT’s handoff. Sign only after you have physically checked the equipment.'));
  }catch{review.append(element('p','Complete the received-equipment details above to compare them with IT’s handoff.'));}
 }
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
  for(const t of relevant){const c=element('article','','tc-card');c.append(element('h3',t.manifest.map(i=>i.family+' '+i.unit_tag).join(' · ')),element('strong',transferPurposeLabel(t.purpose),'tc-purpose'),element('p',`${t.it_name} → ${t.service_name}`),element('strong',transferTitle(t.state)),element('small','Handoff '+t.id));
   const receipt=latestReceiptEvent(t);
   if(!hasTransferPurpose(t.purpose)&&['awaiting_service','discrepancy'].includes(t.state))c.append(element('p','IT / Owner must record whether this equipment is for truck replenishment or installation. Service can confirm receipt after that purpose is saved.','tc-purpose-note'));
   if(t.can_classify_purpose)c.append(button('Choose handoff purpose',()=>classifyPurpose(t),true));
   if(role==='it'){
    const homeRevision=revision;void deviceDraft(client.actor+':purpose:'+t.id).then(savedPurpose=>{if(!current()||homeRevision!==revision||!c.isConnected||!savedPurpose?.request)return;c.append(button('Verify saved purpose update',()=>classifyPurpose(t),true));}).catch(()=>{});
   }
   if(canRecordReceipt(t)&&receipt)c.append(element('p','The handoff purpose has been clarified. Your earlier signed receipts are preserved. Confirm what you received under the purpose shown above.','tc-purpose-note'));
   if(receipt){
    const saved=element('section','','tc-receipt-saved');saved.setAttribute('aria-label','Saved Service receipt');saved.append(element('strong',canRecordReceipt(t)?'Earlier Service receipt saved':t.state==='discrepancy'?'Receipt saved — needs review':'Service receipt saved'),element('p',t.state==='discrepancy'?'The receipt is complete and saved. IT / Owner must review the differences. Do not submit this handoff again.':canRecordReceipt(t)?'These are the original receipt details. A new confirmation is required for the clarified purpose.':'The signed receipt is saved below.'),element('small','Latest receipt: '+new Date(receipt.signed_at).toLocaleString('en-US',{timeZone:'America/Chicago',hour12:false})+' Central'));
    if(!canRecordReceipt(t)&&receipt.snapshot?.differences?.length){const list=element('ul');for(const diff of receipt.snapshot.differences)list.append(element('li',differenceText(diff)));saved.append(list);}
    c.append(saved);
    if(role==='service'){
     const homeRevision=revision;void deviceDraft(client.actor+':receipt:'+t.id).then(savedDraft=>{if(!current()||homeRevision!==revision||!c.isConnected||!savedDraft?.request||!(t.events||[]).some(event=>event.kind==='receipt'&&event.id===savedDraft.request.p_request_id))return;c.append(button('Verify saved submission',()=>start('receipt',t),true));}).catch(()=>{});
    }
   }else if(t.state==='discrepancy')c.append(element('p','This handoff needs IT / Owner review. Reload to check its saved receipt details before continuing.'));
   if(role==='service'&&canRecordReceipt(t))c.append(button('Verify equipment received',()=>start('receipt',t)));
   if(role==='it'&&t.state==='accepted')c.append(button('Check in this handoff',()=>start('return',t)));
   const details=element('details');details.append(element('summary','Saved checks, notes and evidence'));
   for(const e of t.events||[]){const block=element('div');block.append(element('p',`${e.actor_name} · ${e.kind} · ${new Date(e.signed_at).toLocaleString('en-US',{timeZone:'America/Chicago',hour12:false})} Central`),element('p',e.snapshot?.notes||''));
    if(e.report_url){const link=element('a',e.kind==='purpose_amendment'?'Open purpose update report':'Open signed handoff report');link.href=e.report_url;link.target='_blank';link.rel='noopener noreferrer';block.append(link);}
    if(e.delivery)block.append(element('small',e.delivery==='sent'?'Report saved in Drive and emailed':e.delivery==='review'?'Report delivery needs IT review':'Report delivery pending'));
    if(e.snapshot?.differences?.length)block.append(element('pre',JSON.stringify(e.snapshot.differences,null,2),'tc-expected'));
    for(const p of e.photos||[])block.append(button('View '+(p.kind==='signature'?'signature':'equipment photo'),async()=>{try{const url=await client.photoUrl(p.path);guard();const a=element('a','Open saved photo');a.href=url;a.target='_blank';a.rel='noopener noreferrer';block.append(a);}catch(err){message(err.message,true);}},true));details.append(block);
   }c.append(details);root.append(c);
  }
  root.append(button('Reload handoffs',()=>load(),true),element('p','Signed handoff reports and photos save to TechCheck Drive. Delivery retries automatically.','tc-draft-note'));
  if(notice)message(notice);
 }
 async function classifyPurpose(transfer){
  if(busy)return;const turn=++revision,key=client.actor+':purpose:'+transfer.id;
  try{
   let saved=await deviceDraft(key);guard();if(turn!==revision)return;
   const state=saved||{id:crypto.randomUUID(),purpose:'',reason:'',revision:transfer.revision,items:transfer.manifest.map(item=>({...item,batteryText:'',batteryConfiguration:installationBatteryPlan(item.family).configuration})),request:null};
   if(!state.request&&state.revision!==transfer.revision){await deviceDraft(key,undefined,true);await load('The handoff changed. Review its latest saved details before choosing its purpose.');return;}
   const remember=()=>deviceDraft(key,state).catch(error=>message(error.message,true));
   const paint=()=>{
    reset();heading('Choose handoff purpose','This saves an audited purpose update. Service must give a new confirmation; earlier signatures and receipts stay in the history.');root.append(button('Back to handoffs',()=>load(),true));
    if(state.request){root.append(element('p','This purpose update may already be saved. Retry the same update to verify it.'),button('Retry same purpose update',()=>save()));return;}
    const form=element('form');form.noValidate=true;form.setAttribute('aria-label','Handoff purpose update');form.onsubmit=event=>{event.preventDefault();void save();};
    const purpose=element('select');purpose.required=true;purpose.setAttribute('aria-label','What is this equipment for?');purpose.append(new Option('Choose the handoff purpose',''));for(const [value,caption] of Object.entries(TRANSFER_PURPOSES))purpose.append(new Option(caption,value));purpose.value=state.purpose;purpose.onchange=()=>{state.purpose=purpose.value;void remember();paint();};form.append(label('What is this equipment for?',purpose));
    for(let index=0;index<state.items.length;index++){
     const item=state.items[index],group=element('fieldset');group.append(element('legend',item.family+' '+item.unit_tag),element('pre',expectedText(item,'truck_replenishment'),'tc-expected'));
     if(state.purpose==='installation'){
      const plan=installationBatteryPlan(item.family,item.batteryConfiguration);
      if(plan.selectable){const setup=element('select');setup.required=true;setup.setAttribute('aria-label','Installation battery setup '+(index+1));setup.append(new Option('Choose installation battery setup',''));for(const option of plan.options)setup.append(new Option(option.label,option.value));setup.value=item.batteryConfiguration;setup.onchange=()=>{item.batteryConfiguration=setup.value;void remember();};group.append(label('Installation battery setup',setup));}
      else group.append(element('p','Required installation package: '+plan.description));
      const count=input('number',item.batteryText,value=>{item.batteryText=value;void remember();});count.required=true;count.min='0';count.max='9999';count.step='1';count.setAttribute('aria-label','Installation battery quantity '+(index+1));group.append(label('Installation battery quantity',count));
     }
     form.append(group);
    }
    if(state.purpose==='truck_replenishment')form.append(element('p','Service will confirm the equipment received. Spare batteries remain in the separate daily truck inventory.','tc-purpose-note'));
    const reason=input('textarea',state.reason,value=>{state.reason=value;void remember();});reason.required=true;reason.maxLength=2000;reason.setAttribute('aria-label','Reason for purpose update');form.append(label('Reason for purpose update',reason));const submit=element('button','Save purpose & request confirmation');submit.type='submit';form.append(submit);root.append(form);
   };
   const save=async()=>{
    if(busy)return;
    if(!state.request){
     const invalid=[...root.querySelectorAll('input,select,textarea')].find(control=>control.willValidate&&!control.checkValidity());if(invalid){showSubmitError('Complete '+(invalid.getAttribute('aria-label')||'the required field')+'.',invalid);return;}
     if(!hasTransferPurpose(state.purpose)||!state.reason.trim()){showSubmitError('Choose a purpose and record why it is being clarified.');return;}
     try{
      const items=state.items.map(item=>{const plan=installationBatteryPlan(item.family,item.batteryConfiguration),count=number(item.batteryText);if(state.purpose==='installation'&&(!plan.configuration||!Number.isInteger(count)||count<plan.minimum||plan.exact&&count!==plan.count))throw new Error(item.family+' '+item.unit_tag+' requires '+plan.description+'.');return {...item,battery_count:state.purpose==='truck_replenishment'?null:count,battery_configuration:state.purpose==='truck_replenishment'?null:plan.configuration};});
      state.request={p_request_id:state.id,p_transfer_id:transfer.id,p_expected_revision:state.revision,p_purpose:state.purpose,p_items:normalizeManifest(items,{purpose:state.purpose}),p_reason:state.reason.trim()};await deviceDraft(key,state);
     }catch(error){showSubmitError(error.message);return;}
    }
    busy=true;const controls=[...root.querySelectorAll('button,input,select,textarea')];for(const control of controls)control.disabled=true;
    try{guard();if(!navigator.onLine)throw new Error('Offline. Reconnect and retry the same purpose update.');await client.classify(state.request);guard();await deviceDraft(key,undefined,true);guard();await load('Purpose saved. Service must confirm receipt under the recorded purpose. Earlier signed receipts are unchanged.');}
    catch(error){if(current()){if(error.rejected){state.request=null;await deviceDraft(key,state).catch(()=>{});}paint();showSubmitError(error.message);}}
    finally{busy=false;for(const control of controls)if(control.isConnected)control.disabled=false;}
   };
   paint();
  }catch(error){message(error.message,true);}
 }
 function chooseReturns(){reset();heading('Check In / Return','Choose a handoff accepted by Service. Returns remain held for inventory review or repair.');root.append(button('Back',()=>home(),true));const rows=data.transfers.filter(t=>t.state==='accepted');if(!rows.length)root.append(element('p','No accepted handoffs are available for return.'));for(const t of rows)root.append(button(t.service_name+' · '+t.manifest.map(i=>i.family+' '+i.unit_tag).join(', '),()=>start('return',t)));}
 async function start(kind,transfer=null){
  if(busy)return;const turn=++revision;storageKey=client.actor+':'+kind+':'+(transfer?.id||'new');
  try{const saved=await deviceDraft(storageKey);guard();if(turn!==revision)return;
   if(kind==='receipt'&&!canRecordReceipt(transfer)&&(!saved?.request||!(transfer.events||[]).some(event=>event.kind==='receipt'&&event.id===saved.request.p_request_id))){home('This handoff already needs IT / Owner review. Check the saved receipt below; do not submit it again.');return;}
   const purpose=transfer?.purpose||'';
   draft=saved||{kind,id:crypto.randomUUID(),transferId:transfer?.id||null,revision:transfer?.revision||0,serviceActor:transfer?.service_actor||'',purpose,items:(transfer?.manifest||[]).map(i=>{
    const simpleReceipt=kind==='receipt'&&purpose==='truck_replenishment',independent=kind==='receipt'&&!simpleReceipt;
    return {...i,family:independent?'':i.family,unit_tag:independent?'':i.unit_tag,simText:independent?'':i.sims.join('\n'),batteryText:kind==='receipt'?'':String(i.battery_count??''),batteryConfiguration:i.battery_configuration||installationBatteryPlan(i.family).configuration,partsText:independent?'':i.parts.map(p=>p.name+' | '+p.quantity).join('\n'),receiptMode:'as_listed',receivedAsListed:false,checks:{},missing:false};
   }),photos:[],signature:newSignature(),notes:'',request:null};
   if(transfer&&draft.revision!==transfer.revision&&!draft.request){
    reset();heading('Handoff changed','Your unsent draft refers to an older revision. Review the latest saved details before recording what you actually received.');
    root.append(element('small','Handoff '+transfer.id+' · current revision '+transfer.revision));
    for(const item of transfer.manifest)root.append(element('pre',expectedText(item,transfer.purpose),'tc-expected'));
    root.append(button('Discard stale draft and review latest handoff',async()=>{if(busy)return;try{guard();await deviceDraft(storageKey,undefined,true);guard();draft=null;await load('The old unsent draft was discarded. Review the latest handoff and verify the equipment yourself.');}catch(error){message(error.message,true);}},true),button('Back to handoffs',()=>load(),true));
    return;
   }
   await persist();render(transfer);
  }catch(e){message(e.message,true);}
 }
 function originalEvidence(group,transfer,item,expected=item){
  const event=(transfer?.events||[]).find(event=>event.kind==='checkout');
  const photo=(event?.photos||[]).find(photo=>photo.kind==='unit'&&photo.equipment_key===item.equipment_key);
  const fallback=()=>{if(!group.isConnected||group.querySelector('[data-add-current-photo]')||item.requirePhoto)return;const add=button('Add a current equipment photo',()=>{item.requirePhoto=true;changed();render(transfer);},true);add.dataset.addCurrentPhoto='';group.append(element('small','The original IT photo is unavailable. Add a current equipment photo to complete the receipt.'),add);};
  if(!photo){queueMicrotask(fallback);return;}
  const evidence=element('figure','','tc-evidence tc-original-evidence');evidence.append(element('figcaption','Original IT handoff photo — provided by '+transfer.it_name));group.append(evidence);
  void client.photoUrl(photo.path).then(url=>{if(!current()||!evidence.isConnected)return;const img=element('img');img.alt='Original IT handoff photo for '+expected.family+' '+expected.unit_tag;img.onerror=fallback;img.src=url;evidence.prepend(img);}).catch(fallback);
 }
 function photoField(group,item,index){
  const photoInput=element('input');photoInput.type='file';photoInput.accept='image/*';photoInput.setAttribute('aria-label','Equipment photo '+(index+1));photoInput.dataset.transferPhoto=String(index);
  const preview=element('div','','tc-evidence'),old=draft.photos.find(p=>p.equipment_key===item.equipment_key);const show=blob=>{const url=URL.createObjectURL(blob);urls.add(url);const img=element('img');img.alt='Saved equipment photo';img.src=url;preview.replaceChildren(img);};if(old)show(old.blob);
  photoInput.onchange=async()=>{if(busy||!photoInput.files[0])return;const ownerDraft=draft,formRevision=revision;pending++;photoInput.disabled=true;try{const blob=await transferJpeg(photoInput.files[0]);guard();if(draft!==ownerDraft||formRevision!==revision)return;draft.photos=draft.photos.filter(p=>p.equipment_key!==item.equipment_key).concat({equipment_key:item.equipment_key,kind:'unit',blob});invalidate();await persist();show(blob);message('Photo saved in this device draft.');}catch(e){message(e.message,true);}finally{pending--;photoInput.disabled=false;photoInput.value='';}};
  group.append(label('Equipment photo — required',photoInput),preview);
 }
 function render(transfer){
  reset();heading({checkout:'Check Out / Hand Off',receipt:'Verify equipment received',return:'Check In / Return'}[draft.kind]);root.append(button('Back to handoffs',()=>load(),true));
  if(draft.request){root.append(element('p','This submission may already be saved. Retry exactly the same submission to verify it; do not create a duplicate.'),button('Retry same submission',()=>complete(transfer)));return;}
  const form=element('form');form.noValidate=true;form.setAttribute('aria-label','Equipment transfer form');form.onsubmit=e=>{e.preventDefault();void complete(transfer);};
  if(draft.kind==='checkout'){
   const purpose=element('select');purpose.required=true;purpose.setAttribute('aria-label','What is this equipment for?');purpose.append(new Option('Choose the handoff purpose',''));for(const [value,caption] of Object.entries(TRANSFER_PURPOSES))purpose.append(new Option(caption,value));purpose.value=draft.purpose;purpose.onchange=()=>{draft.purpose=purpose.value;for(const item of draft.items){item.checks={};item.batteryText=purpose.value==='installation'&&installationBatteryPlan(item.workflow_type||item.family).count===0?'0':'';item.batteryConfiguration=installationBatteryPlan(item.workflow_type||item.family).configuration;}changed();render(transfer);};form.append(label('What is this equipment for?',purpose));
   if(draft.purpose==='truck_replenishment')form.append(element('p','Truck replenishment — add these units to the truck. Spare batteries are counted separately in the daily truck inventory.','tc-purpose-note'));
   if(draft.purpose==='installation')form.append(element('p','Installation — prepare the equipment and its required installation battery package.','tc-purpose-note'));
   const recipient=element('select');recipient.required=true;recipient.setAttribute('aria-label','Receiving Service technician');recipient.append(new Option('Choose Service technician',''));for(const tech of data.technicians)recipient.append(new Option(tech.name,tech.id));recipient.value=draft.serviceActor;recipient.onchange=()=>{draft.serviceActor=recipient.value;changed();};form.append(label('Hand off to',recipient));
   const equipment=element('select');equipment.setAttribute('aria-label','Select equipment');equipment.append(new Option('Choose a saved Shop unit',''));for(const item of data.equipment){const option=new Option((item.unit_name||item.family+' '+item.unit_tag)+(item.hold_reason?' · '+item.hold_reason:item.reserved?' · already held':!item.supported?' · check mapping required':item.tracker_state!=='shop'?' · not Shop':''),item.equipment_key);option.disabled=item.reserved||!item.supported||item.tracker_state!=='shop';equipment.append(option);}
   form.append(label('Equipment',equipment),button('Add unit to handoff',()=>{if(!hasTransferPurpose(draft.purpose))return message('Choose the handoff purpose first.',true);const e=data.equipment.find(i=>i.equipment_key===equipment.value);if(!e)return message('Select an available Shop unit.',true);if(draft.items.some(i=>i.equipment_key===e.equipment_key))return message('That unit is already included.',true);if(draft.items.length>=20)return message('Use at most 20 units.',true);const plan=installationBatteryPlan(e.workflow_type||e.family);draft.items.push({equipment_key:e.equipment_key,family:e.family,unit_tag:e.unit_tag,workflow_type:e.workflow_type,simText:'',batteryText:draft.purpose==='installation'&&plan.count===0?'0':'',batteryConfiguration:plan.configuration,partsText:'',checks:{},missing:false});changed();render(transfer);},true));
  }else{
   form.append(element('strong',transferPurposeLabel(draft.purpose),'tc-purpose'),element('p',`${transfer.it_name} → ${transfer.service_name}`),element('small','Handoff '+transfer.id));
   if(draft.purpose==='truck_replenishment')form.append(element('p','Confirm the equipment you received. Spare batteries are counted separately in your daily truck inventory.','tc-purpose-note'));
  }
  draft.items.forEach((item,index)=>{
   const expected=transfer?.manifest.find(i=>i.equipment_key===item.equipment_key),group=element('fieldset');group.append(element('legend',(expected?.family||item.family)+' '+(expected?.unit_tag||item.unit_tag)));
   const simpleReceipt=draft.kind==='receipt'&&draft.purpose==='truck_replenishment',asListed=simpleReceipt&&item.receiptMode!=='difference';
   if(expected)group.append(element('pre','IT sent:\n'+expectedText(expected,draft.purpose),'tc-expected'));
   if(simpleReceipt){
    originalEvidence(group,transfer,item,expected);
    if(asListed){
     const confirm=element('input');confirm.type='checkbox';confirm.required=true;confirm.checked=item.receivedAsListed===true;confirm.dataset.transferItem=String(index);confirm.dataset.transferField='receivedAsListed';confirm.onchange=()=>{item.receivedAsListed=confirm.checked;item.missing=false;changed();};group.append(label('I received this equipment as listed',confirm));
     group.append(button('Something is different or missing',()=>{item.receiptMode='difference';item.receivedAsListed=false;item.family='';item.unit_tag='';item.simText='';item.partsText='';changed();render(transfer);},true));
     if(item.requirePhoto)photoField(group,item,index);
    }else group.append(element('p','Record what you actually received. The differences will be saved for IT / Owner review.'),button('Receive this equipment as listed',()=>{item.receiptMode='as_listed';item.receivedAsListed=false;item.missing=false;item.family=expected.family;item.unit_tag=expected.unit_tag;item.simText=expected.sims.join('\n');item.partsText=expected.parts.map(p=>p.name+' | '+p.quantity).join('\n');draft.photos=draft.photos.filter(photo=>photo.equipment_key!==item.equipment_key);changed();render(transfer);},true));
   }
   if(draft.kind==='receipt'&&!asListed){const missing=element('input');missing.type='checkbox';missing.checked=item.missing;missing.onchange=()=>{item.missing=missing.checked;changed();render(transfer);};group.append(label('I did not receive this item',missing));}
   if(!item.missing&&!asListed){
    const inputs=[['family','Unit family / name','text'],['unit_tag','Unit number','text'],['simText','Exact SIM numbers (one per line; blank only when none)','textarea']];
    if(draft.purpose!=='truck_replenishment')inputs.push(['batteryText','Batteries / battery boxes on this unit','number']);
    inputs.push(['partsText','Additional parts (one per line: name | quantity)','textarea']);
    if(draft.purpose==='installation'){
     const plan=installationBatteryPlan(expected?.family||item.workflow_type||item.family,item.batteryConfiguration);
     if(plan.selectable){const configuration=element('select');configuration.required=true;configuration.setAttribute('aria-label','Installation battery setup '+(index+1));configuration.dataset.transferItem=String(index);configuration.dataset.transferField='batteryConfiguration';configuration.append(new Option('Choose installation battery setup',''));for(const option of plan.options)configuration.append(new Option(option.label,option.value));configuration.value=item.batteryConfiguration;configuration.disabled=draft.kind==='return';configuration.onchange=()=>{item.batteryConfiguration=configuration.value;changed();render(transfer);};group.append(label('Installation battery setup',configuration));}
     else group.append(element('p','Required installation package: '+plan.description,'tc-purpose-note'));
    }
    for(const [field,caption,type] of inputs){
     const n=input(type,item[field],value=>{item[field]=value;changed();});n.setAttribute('aria-label',caption+' '+(index+1));n.dataset.transferItem=String(index);n.dataset.transferField=field;if(['family','unit_tag','batteryText'].includes(field))n.required=true;if(draft.kind==='return')n.readOnly=true;if(type==='number'){n.min='0';n.max='9999';n.step='1';}group.append(label(field==='partsText'?'Additional parts (optional — name | quantity, or N/A for none)':caption,n));if(field==='partsText')group.append(element('small','Example: SD card | 1. Leave blank if no additional parts.'));
     if(draft.kind==='receipt'&&field==='batteryText')group.append(element('small','Count batteries of the required installation type shown above. If that type was not received, enter 0 and explain the difference in Notes.'));
    }
    const skippedBatteryChecks=['delivery_batteries_charged_ok','helios_battery_box_installed_ok','helios_battery_120v_charged_ok'];
    const fields=draft.kind==='checkout'?(window.TechCheckRules.itChecklist({equipment_type:item.workflow_type,purpose:draft.purpose==='installation'?'DELIVERY':'BACKUP',unit_tag:item.unit_tag,required_battery_count:installationBatteryPlan(item.workflow_type,item.batteryConfiguration).minimum??0},1).filter(s=>s.kind==='bool'&&(draft.purpose!=='truck_replenishment'||!skippedBatteryChecks.includes(s.field)))):draft.kind==='return'?INTAKE_CHECKS.filter(field=>draft.purpose!=='truck_replenishment'||field!=='batteries_ok').map(field=>({field,label:field.replaceAll('_',' ')})):[];
    if(draft.kind==='checkout')group.append(element('small',draft.purpose==='installation'?'Installation preparation checks. Service verifies the received installation package.':'Truck replenishment equipment checks. Daily truck inventory records spare batteries separately.'));
    for(const step of fields){let caption=step.label.replaceAll('{UNIT}',item.unit_tag).replaceAll('2026 Unit Tracker','2027 Unit Tracker');if(draft.purpose==='truck_replenishment'&&item.workflow_type==='Ranger'&&step.field==='functions_ok')caption='Camera, MPPT, router and all required functions work correctly';if(draft.purpose==='installation'&&item.workflow_type==='Ranger'&&step.field==='delivery_batteries_charged_ok')caption='Is the required LiFePO4 battery charged and ready with this Ranger?';if(draft.kind==='return'){const n=element('select');n.required=true;n.append(new Option('Choose result',''),new Option('Pass','true'),new Option('Needs repair / attention','false'));n.value=item.checks[step.field]===undefined?'':String(item.checks[step.field]);n.onchange=()=>{item.checks[step.field]=n.value===''?undefined:n.value==='true';changed();};group.append(label(caption,n));}else{const n=element('input');n.type='checkbox';n.required=true;n.checked=item.checks[step.field]===true;n.onchange=()=>{item.checks[step.field]=n.checked;changed();};group.append(label(caption,n));}}
    photoField(group,item,index);
   }
   if(draft.kind==='checkout')group.append(button('Remove unit',()=>{draft.items.splice(index,1);draft.photos=draft.photos.filter(p=>p.equipment_key!==item.equipment_key);changed();render(transfer);},true));form.append(group);
  });
  const notes=input('textarea',draft.notes,value=>{draft.notes=value;changed();});notes.maxLength=2000;notes.setAttribute('aria-label','Transfer notes');const notesLabel=label('Notes / problems / missing parts',notes);if(draft.kind==='receipt'&&draft.purpose==='truck_replenishment'){const optional=element('details');optional.append(element('summary','Add a note (optional)'),notesLabel);form.append(optional);}else form.append(notesLabel);
  if(draft.kind==='receipt'){const review=element('section','','tc-receipt-comparison');review.dataset.receiptComparison='';review.setAttribute('aria-label','Receipt comparison');form.append(review);}
  const name=context.getProfile()?.full_name||context.getProfile()?.username||'';
  form.append(createDailySignoff({state:draft.signature,actorName:name,statementText:TRANSFER_STATEMENT,isBusy:()=>busy,onChange:()=>persist().catch(e=>message(e.message,true))}));
  const submit=element('button',draft.kind==='checkout'?'Sign & send handoff':draft.kind==='return'?'Sign & record return':draft.purpose==='truck_replenishment'?'Sign & confirm received':'Sign & verify received equipment');submit.type='submit';form.append(submit);root.append(form,element('p','A saved transfer does not update permanent truck stock, physical Field/Shop placement, or camera health.','tc-draft-note'));
  updateReceiptReview();
 }
 async function complete(transfer){
  if(busy)return;const issue=validateBeforeSubmit();if(issue){showSubmitError(issue.detail,issue.control);return;}busy=true;const controls=[...root.querySelectorAll('button,input,select,textarea')].map(n=>[n,n.disabled]);for(const [n] of controls)n.disabled=true;
  try{
   guard();if(pending)throw new Error('Wait for the photo to finish saving.');if(!navigator.onLine)throw new Error('Offline. Your draft stays on this device; reconnect and retry.');
   let photos;
   if(!draft.request){
    const items=normalizeManifest(draft.items.filter(i=>!i.missing).map(item=>itemInput(item,draft.purpose)),{allowEmpty:draft.kind==='receipt',purpose:draft.purpose,requirePlan:draft.kind==='checkout'});
    if(!draft.signature.confirmed)throw new Error('Sign and confirm the accuracy statement.');
    const name=context.getProfile()?.full_name||context.getProfile()?.username||'';const sig={method:draft.signature.method,name:draft.signature.method==='typed'?draft.signature.typedName:name,confirmed:true};
    if(sig.name.trim().replace(/\s+/g,' ').toLowerCase()!==name.trim().replace(/\s+/g,' ').toLowerCase())throw new Error('Use the name on your signed-in account.');
    photos=draft.photos.filter(p=>draft.items.some(i=>!i.missing&&i.equipment_key===p.equipment_key&&needsPhoto(i)));
    if(draft.items.some(i=>!i.missing&&needsPhoto(i)&&!photos.some(p=>p.equipment_key===i.equipment_key)))throw new Error('Photograph each received or transferred unit.');
    if(sig.method==='drawn'){const blob=draft.signature.blob||await signatureJpeg(draft.signature);photos=photos.concat({kind:'signature',equipment_key:'',blob});}
    const paths=await client.paths(draft.id,photos);guard();if(sig.method==='drawn')sig.path=paths.find(p=>p.kind==='signature').path;
    draft.request={p_request_id:draft.id,p_transfer_id:draft.transferId||draft.id,p_kind:draft.kind,p_expected_revision:draft.revision,p_service_actor:draft.serviceActor,p_items:items,p_checks:Object.fromEntries(draft.items.map(i=>[i.equipment_key,i.checks])),p_signature:sig,p_photos:paths,p_notes:draft.notes,...(hasTransferPurpose(draft.purpose)?{p_purpose:draft.purpose}:{})};draft.submissionPhotos=photos;await persist();
   }else photos=draft.submissionPhotos;
   const result=await client.submit(draft.request,photos,(n,total)=>message(`Saving evidence ${n} of ${total}…`));guard();
   await deviceDraft(storageKey,null,true).catch(()=>{});guard();
   await load(result.replayed&&transfer?.purpose_revision&&result.purpose_revision!==transfer.purpose_revision?'Earlier receipt verified and saved. Review the current handoff purpose; any new confirmation is shown below.':result.state==='discrepancy'?'Receipt saved. IT / Owner must review the differences. You do not need to submit it again.':transferTitle(result.state)+'. Saved in COS; check the saved report below for delivery status.');
  }catch(e){if(current()){if(e.unavailable&&onUnavailable){onUnavailable(e.reason||'unavailable');return;}if(e.receiptRecorded){await load(e.message);return;}if(e.rejected&&draft){draft.request=null;draft.submissionPhotos=null;await persist().catch(()=>{});if(draft.kind==='receipt'){await load(e.message);return;}render(transfer);}else if(draft?.request)render(transfer);showSubmitError(e.message);}}
  finally{busy=false;for(const [n,disabled] of controls)if(n.isConnected)n.disabled=disabled;}
 }
 void load();
 return ()=>{disposed=true;revision++;for(const u of urls)URL.revokeObjectURL(u);urls.clear();root.replaceChildren();};
}

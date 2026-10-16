import {createDailySignoff,newSignature,signatureJpeg} from './service-signoff-ui.js?v=20261016';
// Daily evidence and one atomic completion. Authorization stays on the server.
const context = () => window.TechCheckContext;
const types = ['Sniper','Ranger','Spotter','Solar Spotter'];
const simCards = ['SIM Card 1','SIM Card 2','SIM Card 3'];
const batteryTypes = ['Recon batteries','AGM 12V 110Ah','LiTime 12V 100Ah','12V 35Ah'];
const counts = {recon_battery_qty:['wlTruckReconQty',25],agm_12v_110ah_qty:['wlTruckAgmQty',4],litime_12v_100ah_qty:['wlTruckLiTimeQty',2],battery_12v_35ah_qty:['wlTruck35AhQty',4]};
const day = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const actor = () => context()?.getRole()==='service' && !document.getElementById('appView')?.classList.contains('hidden') ? context()?.getSession()?.user?.id : null;
let current = null, currentDay = '', draft = null, busy = false, photosPending = 0, changes = 0, statusKey = '', scheduled = false;
const previewUrls = new Map();
const dbPromise = new Promise((resolve,reject) => {
  const request = indexedDB.open('techcheck-daily-evidence-v1',1);
  request.onupgradeneeded = () => request.result.createObjectStore('drafts');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error('Device storage is unavailable. Allow site storage before adding photos.'));
});
// Opening the app must not produce an unhandled rejection when storage is blocked.
dbPromise.catch(()=>{});
async function device(mode, action) {
  const db = await dbPromise;
  return new Promise((resolve,reject) => {
    const tx=db.transaction('drafts',mode), request=action(tx.objectStore('drafts'));
    tx.oncomplete=()=>resolve(request?.result);
    tx.onerror=()=>reject(new Error('Could not preserve the daily check on this device. Free some storage and retry.'));
    tx.onabort=tx.onerror;
  });
}
const key = id => id+':'+day();
const save = () => {
  const item=draft, storageKey=current+':'+currentDay;
  return device('readwrite',store=>store.put(item,storageKey));
};
function message(text,error=false) {
  const target=document.querySelector('#wlSvcTruckInventory [data-wl-truck-save-status]');
  if(target){target.textContent=text;target.classList.add('cos-daily-status');target.setAttribute('role',error?'alert':'status');}
}
function valueSnapshot() {
  const units=Object.fromEntries([...document.querySelectorAll('[data-wl-truck-unit-entry]')].map(el=>[el.dataset.wlTruckUnitEntry,el.value.trim()]));
  const sims=Object.fromEntries([...document.querySelectorAll('[data-wl-truck-sim-entry]')].map(el=>[el.dataset.wlTruckSimEntry,el.value.trim()]));
  const stock=Object.fromEntries(Object.entries(counts).map(([name,[id]])=>[name,document.getElementById(id)?.value ?? '']));
  return {units,sims,stock};
}
function restoreValues(card) {
  const v=draft?.values;
  if(!v)return;
  for(const el of card.querySelectorAll('[data-wl-truck-unit-entry]'))if(v.units[el.dataset.wlTruckUnitEntry]!==undefined)el.value=v.units[el.dataset.wlTruckUnitEntry];
  for(const el of card.querySelectorAll('[data-wl-truck-sim-entry]'))if(v.sims[el.dataset.wlTruckSimEntry]!==undefined)el.value=v.sims[el.dataset.wlTruckSimEntry];
  for(const [name,[id]] of Object.entries(counts))if(v.stock[name]!==undefined)document.getElementById(id).value=v.stock[name];
}
async function jpeg(file) {
  if(!file || file.size>25*1024*1024)throw new Error('Choose a photo smaller than 25 MB.');
  const url=URL.createObjectURL(file), image=new Image();
  try {
    image.src=url;await image.decode();
    const scale=Math.min(1,1920/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.88));
    if(!blob || blob.size>5*1024*1024)throw new Error('Photo is too large. Take a closer, clear photo and retry.');
    return blob;
  }catch(error){throw new Error(error?.message?.includes('large')?error.message:'This photo could not be opened. Take a JPG photo with the camera and retry.');}
  finally{URL.revokeObjectURL(url);}
}
function photoInput(category,view,caption,required) {
  const label=document.createElement('label');label.append(caption+(required?' · required':' · optional'));
  const input=document.createElement('input');input.type='file';input.accept='image/*';input.setAttribute('aria-label',category+' '+caption);input.dataset.dailyPhoto=category+':'+view;
  const preview=document.createElement('img');preview.alt=category+' '+caption;preview.hidden=true;
  const show=blob=>{if(previewUrls.has(input))URL.revokeObjectURL(previewUrls.get(input));const url=URL.createObjectURL(blob);previewUrls.set(input,url);preview.src=url;preview.hidden=false;};
  const existing=draft.photos.find(p=>p.category===category&&p.view===view);if(existing)show(existing.blob);
  input.addEventListener('change',async()=>{
    const id=current, version=changes;
    if(busy || !input.files[0])return;
    input.disabled=true;photosPending++;
    try{
      const blob=await jpeg(input.files[0]);
      if(actor()!==id || current!==id || changes!==version)return;
      const ownerDraft=draft,previous=ownerDraft.photos;
      ownerDraft.photos=previous.filter(p=>p.category!==category||p.view!==view).concat({category,view,blob});invalidateSignoff();
      try{await save();}catch(error){ownerDraft.photos=previous;throw error;}
      if(actor()!==id||changes!==version)return;show(blob);message('Photo saved on this device. Check that the number or tag is readable.');
    }catch(error){if(actor()===id&&changes===version)message(error.message,true);}finally{photosPending--;input.disabled=false;input.value='';}
  });
  label.append(input,preview);return label;
}
function invalidateSignoff(){
  if(draft?.signature)draft.signature.confirmed=false;
  const input=document.querySelector('.cos-daily-signoff input[type="checkbox"]');if(input)input.checked=false;
}
function extraImages(){
  const id=current,version=changes;
  const field=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Additional image attachments';field.append(legend);
  const label=document.createElement('label');label.append('Attach saved images (optional, up to 10)');
  const input=document.createElement('input');input.type='file';input.accept='image/*';input.multiple=true;input.setAttribute('aria-label','Attach extra images');label.append(input);
  const list=document.createElement('div');
  function render(){
    if(actor()!==id||changes!==version)return;
    list.replaceChildren();
    for(const photo of draft.photos.filter(p=>p.category==='Additional images')){
      const item=document.createElement('div'),image=document.createElement('img'),remove=document.createElement('button');
      const url=URL.createObjectURL(photo.blob);previewUrls.set(image,url);image.src=url;image.alt=photo.filename||'Additional image '+photo.view;
      remove.type='button';remove.textContent='Remove attachment '+photo.view;
      remove.addEventListener('click',async()=>{if(busy||actor()!==id||changes!==version)return;const ownerDraft=draft,previous=ownerDraft.photos;ownerDraft.photos=previous.filter(p=>p!==photo);invalidateSignoff();try{await save();render();}catch(error){ownerDraft.photos=previous;if(actor()===id&&changes===version)message(error.message,true);}});
      item.append(image,remove);list.append(item);
    }
  }
  input.addEventListener('change',async()=>{
    const files=[...input.files],id=current,version=changes;if(busy||!files.length)return;
    if(files.length+draft.photos.filter(p=>p.category==='Additional images').length>10){input.value='';return message('Attach up to 10 additional images.',true);}
    input.disabled=true;photosPending++;
    try{
      for(const file of files){
        const blob=await jpeg(file);if(actor()!==id||changes!==version)return;
        const occupied=new Set(draft.photos.filter(p=>p.category==='Additional images').map(p=>p.view));
        const view=Array.from({length:10},(_,i)=>String(i+1)).find(v=>!occupied.has(v));
        const ownerDraft=draft,previous=ownerDraft.photos;ownerDraft.photos=previous.concat({category:'Additional images',view,blob,filename:file.name.slice(0,150)});invalidateSignoff();
        try{await save();}catch(error){ownerDraft.photos=previous;throw error;}
      }
      render();message('Additional images saved on this device. Review and sign below.');
    }catch(error){if(actor()===id&&changes===version){render();message(error.message,true);}}finally{photosPending--;input.disabled=false;input.value='';}
  });
  field.append(label,list);render();return field;
}
function decorate(card) {
  if(card.dataset.dailyEvidenceKey!==current+':'+currentDay){card.querySelector('.cos-daily-evidence')?.remove();card.dataset.dailyEvidenceKey=current+':'+currentDay;}
  if(card.querySelector('.cos-daily-evidence') || !card.querySelector('[data-wl-save-truck-inventory]') || !draft)return;
  restoreValues(card);
  const section=document.createElement('section');section.className='cos-daily-evidence';
  const heading=document.createElement('h3');heading.textContent='Truck photos';
  const info=document.createElement('p');info.textContent='Photograph the actual stock today. Each unit needs a clear front photo and a rear photo showing its unit tag. Photograph each battery type separately. Each of the three SIM cards needs its own front and back photo, with the SIM number readable.';section.append(heading,info);
  for(const category of [...types,...batteryTypes,...simCards]){
    const field=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=category;field.append(legend);
    if(types.includes(category))field.append(photoInput(category,'front','Front photo',true),photoInput(category,'tag','Rear unit tag photo',true));
    else if(simCards.includes(category))field.append(photoInput(category,'front','Front photo',true),photoInput(category,'back','Back photo',true));
    else field.append(photoInput(category,'1','Photo 1',true),photoInput(category,'2','Photo 2',false));
    section.append(field);
  }
  draft.signature ||= newSignature();
  const id=current,version=changes;
  section.append(extraImages(),createDailySignoff({state:draft.signature,actorName:context()?.getProfile()?.full_name||context()?.getProfile()?.username||'Technician',isBusy:()=>busy,onChange:()=>{if(actor()===id&&changes===version)save().catch(error=>message(error.message,true));}}));
  const button=card.querySelector('[data-wl-save-truck-inventory]');button.before(section);button.textContent='Complete & Send to Ops Manager';
  message('Complete saves your inspection, inventory and photos, then returns to the main screen. Delivery status appears there.');
}
async function rpc(name,args) {
  const {data,error}=await context().db.rpc(name,args);if(error)throw new Error(error.message||'Could not save the daily check.');return data;
}
function deliveryCopy(report) {
  if(report?.delivery_status==='sent')return 'Daily check completed. Report and photos saved to Drive and emailed to the Ops Manager.';
  if(report)return 'Daily check completed and safely saved. Drive/email delivery is pending'+(report.delivery_status==='blocked'?' — manager connection required.':'.');
  return 'Complete today’s truck inventory and photos to finish your daily check.';
}
async function homeStatus(id) {
  const home=document.querySelector('#wlSvcHome .wl-service-simple-shell');if(!home || home.closest('#wlSvcHome').style.display==='none')return;
  const loadKey=id+':'+day();if(statusKey===loadKey && home.querySelector('[data-daily-delivery-status]'))return;
  statusKey=loadKey;
  const text=home.querySelector('[data-daily-delivery-status]')||document.createElement('p');text.dataset.dailyDeliveryStatus='';text.setAttribute('role','status');text.textContent='Checking daily report status…';if(!text.isConnected)home.append(text);
  try{
    const reports=await rpc('service_daily_report_status_v1',{});
    if(actor()!==id || !text.isConnected)return;
    text.textContent=deliveryCopy(reports?.[0]);
    if(!reports?.length){const button=home.querySelector('[data-wl-service-truck-inventory]');button?.classList.remove('complete');const small=button?.querySelector('small');if(small)small.textContent='Inventory & photos required';}
  }catch{if(actor()===id && text.isConnected)text.textContent='Daily report status unavailable. Reconnect to verify completion.';}
}
async function sync() {
  for(const [node,url] of previewUrls)if(!node.isConnected){URL.revokeObjectURL(url);previewUrls.delete(node);}
  const id=actor();
  if(current && current!==id){
    document.querySelectorAll('.cos-daily-evidence').forEach(node=>node.remove());
    document.querySelectorAll('#wlSvcTruckInventory input').forEach(input=>{input.value='';input.checked=false;});
  }
  if(id!==current || currentDay!==day()){current=id;currentDay=day();draft=null;changes++;statusKey='';if(id){const version=changes;try{const saved=await device('readonly',store=>store.get(key(id)));if(actor()!==id||changes!==version)return;draft=saved||{id:crypto.randomUUID(),photos:[],values:null};if(!draft.signature||draft.photos.some(photo=>['SIM cards','Batteries'].includes(photo.category))){draft.id=crypto.randomUUID();draft.photos=draft.photos.filter(photo=>!['SIM cards','Batteries'].includes(photo.category));draft.signature ||= newSignature();await save();}}catch(error){message(error.message,true);return;}}}
  if(!id)return;
  const card=document.getElementById('wlSvcTruckInventory');if(card)decorate(card);
  await homeStatus(id);
}
function schedule(){if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;sync();});}
new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});
for(const event of ['techcheck:view-changed','techcheck:data-refreshed','pageshow','online'])window.addEventListener(event,schedule);
// Capture before the protected delegated handlers, so this is one transaction.
document.addEventListener('input',event=>{
  if(!actor() || busy || !draft || !event.target.closest('#wlSvcTruckInventory') || event.target.type==='file')return;
  if(!event.target.closest('.cos-daily-signoff'))invalidateSignoff();draft.values=valueSnapshot();save().catch(error=>message(error.message,true));
});
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-wl-save-truck-inventory], [data-wl-submit-truck-inventory]');
  if(!button || !actor())return;
  event.preventDefault();event.stopImmediatePropagation();
  if(busy)return;
  const id=actor(),version=changes;
  busy=true;button.disabled=true;
  const locked=[...button.closest('#wlSvcTruckInventory').querySelectorAll('input,button')].map(node=>[node,node.disabled]);
  for(const [node] of locked)node.disabled=true;
  try{
    if(photosPending)throw new Error('Wait for the current photo to finish saving, then complete.');
    if(!draft)throw new Error('Device storage is unavailable. Allow site storage and reopen inventory.');
    if(currentDay!==day())throw new Error('A new work day has started. Reopen inventory and take today’s photos before completing.');
    if(!navigator.onLine)throw new Error('You are offline. Your entries and photos remain on this device. Reconnect and complete again.');
    const values=valueSnapshot();
    if(types.some(type=>!values.units[type])||[1,2,3].some(n=>!values.sims[n]))throw new Error('Enter all four unit numbers and all three exact SIM numbers.');
    for(const [name,[,minimum]] of Object.entries(counts)){const n=Number(values.stock[name]);if(!Number.isSafeInteger(n)||n<minimum)throw new Error('Truck stock is short. Verify all required battery quantities before completing.');values.stock[name]=n;}
    for(const category of types)for(const view of ['front','tag'])if(!draft.photos.some(p=>p.category===category&&p.view===view))throw new Error('Add the front and rear unit tag photos for '+category+'.');
    for(const category of simCards)for(const view of ['front','back'])if(!draft.photos.some(p=>p.category===category&&p.view===view))throw new Error('Add the '+view+' photo for '+category+'.');
    for(const category of batteryTypes)if(!draft.photos.some(p=>p.category===category&&p.view==='1'))throw new Error('Add a photo of the '+category+'.');
    const signature=draft.signature;
    if(!signature?.confirmed)throw new Error('Sign and confirm that this report is accurate before completing.');
    const accountName=context()?.getProfile()?.full_name||context()?.getProfile()?.username||'';
    const normalize=name=>name.trim().replace(/\s+/g,' ').toLowerCase();
    if(signature.method==='typed'&&normalize(signature.typedName||'')!==normalize(accountName))throw new Error('Type your full name exactly as shown for the signed-in technician.');
    if(signature.method==='drawn'&&!signature.blob)signature.blob=await signatureJpeg(signature);
    draft.values=values;await save();
    const photos=[];
    const evidence=signature.method==='drawn'?draft.photos.concat({category:'Technician signature',view:'signature',blob:signature.blob}):draft.photos;
    const assertIdentity=()=>{if(actor()!==id||changes!==version)throw new Error('Your session changed. Sign in again to finish this check.');};
    // A completed report's evidence is immutable. If the earlier response was
    // lost, replay completion without trying to upload into its sealed folder.
    const previous=await rpc('service_daily_report_status_v1',{});
    const alreadyAccepted=previous?.some(report=>report.id===draft.id);
    for(const photo of evidence){
      assertIdentity();message('Saving photos '+(photos.length+1)+' of '+evidence.length+'…');
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await photo.blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
      const path=id+'/'+draft.id+'/'+hash+'.jpg';
      if(!alreadyAccepted){
        const {error}=await context().db.storage.from('service-daily-evidence').upload(path,photo.blob,{contentType:'image/jpeg',upsert:false});
        if(error && String(error.statusCode)!=='409')throw new Error('Photo upload failed. Your photos remain on this device; reconnect and retry.');
      }
      photos.push({category:photo.category,view:photo.view,path,...(photo.filename?{filename:photo.filename}: {})});
    }
    assertIdentity();message('Completing your daily check…');
    const saved=await rpc('complete_service_daily_report_v4',{p_report_id:draft.id,p_units:values.units,p_sims:values.sims,p_stock:values.stock,p_photos:photos,p_signature:{method:signature.method,name:signature.method==='typed'?signature.typedName.trim():accountName,confirmed:true,...(signature.method==='drawn'?{path:photos.find(p=>p.category==='Technician signature').path}:{})}});
    if(!saved?.inventory_ready)throw new Error('The server has not confirmed truck readiness. Your draft is preserved.');
    assertIdentity();
    // Accepted submission remains authoritative even if device cleanup fails.
    await device('readwrite',store=>store.delete(key(id))).catch(()=>{});
    draft={id:crypto.randomUUID(),photos:[],values:null};statusKey='';
    const back=document.querySelector('#wlSvcTruckInventory [data-wl-home="svc"]');if(back){back.disabled=false;back.click();}
    context().db.functions.invoke('service-daily-delivery',{body:{report_id:saved.id}}).then(()=>{statusKey='';schedule();}).catch(()=>{});
    schedule();window.scrollTo({top:0,left:0,behavior:'instant'});
  }catch(error){if(actor()===id){
    if(error.message?.includes('already used') && draft){draft.id=crypto.randomUUID();await save().catch(()=>{});}
    message(error.message||'Could not complete. Your draft is preserved.',true);
  }}
  finally{busy=false;for(const [node,disabled] of locked)if(node.isConnected)node.disabled=disabled;if(button.isConnected)button.disabled=false;}
},true);
sync();

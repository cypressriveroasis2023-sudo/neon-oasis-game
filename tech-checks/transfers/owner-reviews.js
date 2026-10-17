import {requestLocationProof} from './client.js';
const node=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
export function mountOwnerReturnReviews(root,context){
 const actor=context.getSession()?.user?.id;let disposed=false,generation=0;
 const current=()=>!disposed&&root.isConnected&&actor&&context.getSession()?.user?.id===actor&&context.getRole()==='owner'&&(!context.getEffectiveRole||context.getEffectiveRole()==='owner')&&context.getProfile()?.user_id===actor&&context.getProfile()?.active===true&&!context.getProfile()?.archived_at;
 const assert=()=>{if(!current())throw new Error('Your Owner session changed. Reopen the inventory review.');};
 async function rpc(name,args={}){assert();const result=await context.db.rpc(name,args);assert();if(result.error)throw Object.assign(new Error(result.error.message||'Inventory review unavailable.'),{rejected:['P0001','42501','23514'].includes(result.error.code)});return result.data;}
 async function load(){
  if(!current())return;const turn=++generation;root.replaceChildren(node('h2','Named handoff returns'),node('p','Reading current IT intake reviews…'));
  try{
   const data=await rpc('owner_techcheck_return_reviews_v6');if(!current()||turn!==generation)return;
   if(data?.version!==6||data.actor_id!==actor||!Array.isArray(data.items))throw new Error('Current return reviews could not be verified.');
   root.replaceChildren(node('h2','Named handoff returns'),node('p','Review the IT intake and complete the MHelpDesk inventory step before releasing each unit. A saved return alone does not make equipment available.'));
   if(!data.items.length)root.append(node('p','No named handoff returns are waiting for inventory review.'));
   for(const item of data.items){
    const card=node('article');card.className='card';card.append(node('h3',item.family+' '+item.unit_tag),node('p','Handoff '+item.transfer_id+' · IT return '+item.return_event_id),node('p',item.snapshot?.notes||''));
    const details=node('details');details.append(node('summary','Signed IT intake'),node('pre',JSON.stringify({checks:item.snapshot?.checks,signature:item.snapshot?.signature},null,2)));card.append(details);
    for(const photo of item.photos||[]){const view=node('button','View '+(photo.kind==='signature'?'IT signature':'intake photo'));view.type='button';view.onclick=async()=>{try{assert();const result=await context.db.storage.from('techcheck-transfer-evidence').createSignedUrl(photo.path,300);assert();if(result.error||!result.data?.signedUrl)throw new Error('Saved intake image unavailable.');const a=node('a','Open saved evidence');a.href=result.data.signedUrl;a.target='_blank';a.rel='noopener noreferrer';card.append(a);}catch(e){status.textContent=e.message;}};card.append(view);}
    const status=node('p');status.setAttribute('role','status');
    if(item.passed!==true){card.append(node('p','Repair hold. IT must complete and sign a new physical inspection after repair.'),status);root.append(card);continue;}
    const form=node('form'),notes=node('textarea');notes.required=true;notes.minLength=10;notes.maxLength=2000;notes.setAttribute('aria-label','Inventory review notes for '+item.family+' '+item.unit_tag);
    const label=node('label','MHelpDesk inventory reference and review notes');label.append(notes);
    const confirmed=node('input');confirmed.type='checkbox';confirmed.required=true;const confirmLabel=node('label','I completed the MHelpDesk inventory review for this exact unit.');confirmLabel.append(confirmed);
    const save=node('button','Verify Shop & release this unit');save.type='submit';form.append(label,confirmLabel,save);card.append(form,status);root.append(card);
    let request=null,busy=false;
    form.onsubmit=async event=>{
     event.preventDefault();if(busy)return;busy=true;notes.disabled=true;confirmed.disabled=true;save.disabled=true;
     try{
      assert();if(!request){if(!confirmed.checked||notes.value.trim().length<10)throw new Error('Confirm the inventory review and record its reference.');request={p_request_id:crypto.randomUUID(),p_transfer_id:item.transfer_id,p_equipment_key:item.equipment_key,p_return_event_id:item.return_event_id,p_inventory_confirmed:true,p_notes:notes.value.trim()};}
      status.textContent='Verifying current Shop placement and the signed intake…';
      const proof=await requestLocationProof(context,request.p_request_id,'inventory_release',[item]);assert();
      const saved=await rpc('owner_release_techcheck_return_v7',{...request,p_location_proof:proof});
      if(saved?.id!==request.p_request_id||saved.equipment_key!==item.equipment_key||saved.released!==true)throw new Error('The release response could not be verified. Retry the same review.');
      card.replaceChildren(node('h3',item.family+' '+item.unit_tag),node('p','Inventory review completed. This unit is released to Shop inventory.'));
     }catch(e){if(current()){status.textContent=e.message;status.setAttribute('role','alert');if(e.rejected)request=null;save.textContent=request?'Retry same inventory review':'Verify Shop & release this unit';}}
     finally{busy=false;if(current()){save.disabled=false;notes.disabled=confirmed.disabled=Boolean(request);}}
    };
   }
   const reload=node('button','Reload return reviews');reload.type='button';reload.onclick=()=>load();root.append(reload);
  }catch(e){if(current()&&turn===generation){root.replaceChildren(node('h2','Named handoff returns'));const status=node('p',e.message);status.setAttribute('role','status');root.append(status);}}
 }
 void load();return()=>{disposed=true;generation++;root.replaceChildren();};
}

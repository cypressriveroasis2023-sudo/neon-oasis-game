/* Owner-confirmed physical placement. Never changes or infers camera health. */
(function(root){
  'use strict';
  let active=null;
  function stateMatches(state,key){return state&&state.unitKey===key&&['SHOP','FIELD','UNKNOWN'].includes(state.placement)&&(state.auditId===null||typeof state.auditId==='string')&&typeof state.siteLabel==='string'&&typeof state.streetAddress==='string'&&state.canMove===true;}
  async function open({db,key,placement,onSaved}){
    if(active)return;
    if(!db||!key||!['SHOP','FIELD'].includes(placement))return;
    const dialog=document.createElement('dialog');dialog.className='cos-placement-dialog';dialog.setAttribute('aria-labelledby','cosPlacementTitle');
    dialog.innerHTML='<form><h2 id="cosPlacementTitle"></h2><p class="placement-explanation">This changes the unit’s physical location. Camera online/offline status still comes from its health checks.</p><p class="placement-unit"></p><label class="placement-site-label">Current job / site<input name="site" maxlength="250" autocomplete="off"></label><label class="placement-address-label">Current installation street address<input name="address" maxlength="600" autocomplete="street-address"></label><label>Reason for move<input name="reason" maxlength="1000" required autocomplete="off"></label><label class="placement-confirm"><input name="confirmed" type="checkbox" required> I confirm this is the unit’s current physical placement.</label><p class="placement-pin-note"></p><p class="placement-feedback" role="status">Reading the current unit…</p><div class="placement-buttons"><button type="button" class="placement-cancel">Cancel</button><button type="submit" disabled>Save placement</button></div></form>';
    document.body.append(dialog);active={dialog,pending:false};const context=active,form=dialog.querySelector('form'),input=name=>form.elements.namedItem(name),feedback=dialog.querySelector('.placement-feedback'),submit=form.querySelector('[type=submit]'),cancel=form.querySelector('.placement-cancel');
    dialog.querySelector('h2').textContent=placement==='FIELD'?'Move to Field':'Move to Shop / ROOT';dialog.querySelector('.placement-unit').textContent=key;
    dialog.querySelector('.placement-pin-note').textContent=placement==='FIELD'?'The unit returns to the field list. Confirm its installation pin on the Field Map after the move.':'The unit leaves the installed field map and stays searchable in Shop / ROOT. Its location history is kept.';
    for(const name of ['site','address']){input(name).required=placement==='FIELD';input(name).closest('label').hidden=placement!=='FIELD';}
    const close=()=>{if(context.pending)return;dialog.close();dialog.remove();if(active===context)active=null;};cancel.onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.showModal();let state,requestId=crypto.randomUUID(),uncertain=false;
    try{const result=await db.rpc('owner_camera_unit_placement_state_v2',{p_unit_key:key});if(result.error)throw result.error;if(!stateMatches(result.data,key))throw new Error('Current placement could not be verified.');state=result.data;input('site').value=state.siteLabel;input('address').value=state.streetAddress;feedback.textContent='';submit.disabled=false;input(placement==='FIELD'?'site':'reason').focus();}catch(error){feedback.textContent='Placement controls are unavailable: '+(error?.message||error)+'. No change was made.';}
    form.onsubmit=async event=>{
      event.preventDefault();if(context.pending||uncertain||!state||!form.reportValidity())return;
      const site=placement==='FIELD'?input('site').value.trim():'',address=placement==='FIELD'?input('address').value.trim():'',reason=input('reason').value.trim();
      if(!reason||(placement==='FIELD'&&(!site||!address))){feedback.textContent='Enter the current site, street address and reason.';return;}
      context.pending=true;submit.disabled=true;cancel.disabled=true;for(const element of form.querySelectorAll('input'))element.disabled=true;feedback.textContent='Saving physical placement…';
      try{
        const result=await db.rpc('owner_set_camera_unit_placement_v2',{p_unit_key:key,p_placement:placement,p_site_label:site,p_street_address:address,p_reason:reason,p_expected_audit_id:state.auditId,p_request_id:requestId});
        if(result.error)throw result.error;
        const saved=result.data;
        if(!saved||saved.ok!==true||saved.unit_key!==key||saved.placement!==placement||saved.request_id!==requestId||typeof saved.audit_id!=='string')throw new Error('The save receipt was incomplete.');
        const fresh=await db.rpc('owner_camera_unit_placement_state_v2',{p_unit_key:key});
        if(fresh.error||!stateMatches(fresh.data,key)||fresh.data.auditId!==saved.audit_id||fresh.data.placement!==placement||(placement==='FIELD'&&(fresh.data.streetAddress!==address||fresh.data.siteLabel!==site)))throw new Error('Saved placement could not be verified after reload.');
        await onSaved?.(saved);context.pending=false;close();
      }catch(error){uncertain=true;feedback.textContent='The move could not be confirmed: '+(error?.message||error)+'. Close and refresh this unit before trying again.';}
      finally{context.pending=false;cancel.disabled=false;}
    };
  }
  root.CameraPlacementControls={open,stateMatches};
})(globalThis);

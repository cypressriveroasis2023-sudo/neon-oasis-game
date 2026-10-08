/* Owner-confirmed physical placement. Reads the effective map address; never writes GPS or camera health. */
(function(root){
  'use strict';
  const endpoint='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
  const object=v=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
  const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
  const text=v=>typeof v==='string'&&v.trim()!=='';
  const auditKey=v=>typeof v==='string'?v.trim().toUpperCase():'';
  const normal=v=>typeof v==='string'?v.trim().replace(/\s+/g,' ').toLowerCase():'';
  const resourceId=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):typeof v==='string'&&/^[1-9]\d*$/.test(v)?v:null;
  const sameSet=(a,b)=>a.length===b.length&&new Set(a).size===a.length&&new Set(b).size===b.length&&a.every(x=>b.includes(x));
  const fail=message=>{throw new Error(message);};
  let active=null;
  // Kept in parity with the deployed placement projection. Full family, decimals and suffixes are retained.
  function placementMatchKey(value){
    if(typeof value!=='string')return '';
    const m=/^(SNIPER\s*[24]|RECON\s*(?:2|II)|SOLAR\s*(?:STAND\s*72|POLE\s*72|SKID\s*144))(?=\s|[-#])\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)(HD4|HDC[24]S?)?$/i.exec(value.trim())
      ||/^(HELIOS|RANGER|AXIS\s*SOLAR\s*SPOTTER|AXIS\s*SPOTTER|SOLAR\s*SPOTTER|SPOTTER|SS\s*HYBRID|SNIPER|CAM\s*V|RECON|RII|RI|RSU|ALPHA)\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)(HD4|HDC[24]S?)?$/i.exec(value.trim());
    if(!m)return 'full:'+value.trim().replace(/\s+/g,' ').toUpperCase();
    const f=m[1].toUpperCase().replace(/\s/g,''),family=({RI:'RECON',RII:'RECON2',RECONII:'RECON2'})[f]||f;
    const [whole,fraction]=m[2].split('.');if(Number(whole)===0)return 'full:'+value.trim().replace(/\s+/g,' ').toUpperCase();
    return 'typed:'+family+'|'+Number(whole)+(fraction===undefined?'':'.'+fraction)+(m[3]?'|'+m[3].toUpperCase():'');
  }
  // Denial only, never a positive family/number/suffix alias.
  function placementIdentityConcernKey(value){
    const key=placementMatchKey(value);if(!key.startsWith('typed:'))return key;
    const [family,number]=key.slice(6).split('|');
    const related=['SPOTTER','SOLARSPOTTER','AXISSPOTTER','AXISSOLARSPOTTER'].includes(family)?'SPOTTER':/^SNIPER[24]?$/.test(family)?'SNIPER':/^RECON2?$/.test(family)?'RECON':family;
    return 'concern:'+related+'|'+number;
  }
  function allIdentities(health){
    if(health.ownerConfirmedIdentityVersion===undefined?health.ownerConfirmedUnitIdentities!==undefined:health.ownerConfirmedIdentityVersion!==1||!Array.isArray(health.ownerConfirmedUnitIdentities)||health.ownerConfirmedUnitIdentities.length>1000||health.ownerConfirmedUnitIdentities.some(p=>p.kind!=='owner_confirmed_native'))fail('Owner-confirmed identity contract is unavailable.');
    if(health.unitIdentities.some(p=>p.kind==='owner_confirmed_native'))fail('Owner-confirmed identities require their additive contract.');
    return [...health.unitIdentities,...(health.ownerConfirmedUnitIdentities||[])];
  }
  function stateMatches(state,key){return object(state)&&state.unitKey===key&&['SHOP','FIELD','UNKNOWN'].includes(state.placement)&&(state.auditId===null||resourceId(state.auditId)===state.auditId)&&typeof state.siteLabel==='string'&&typeof state.streetAddress==='string'&&state.canMove===true;}
  const revisionFields=['importedPlacement','importedInstallation','id','unitNumber','site','address','addressSource','addressUpdatedAt','installedSiteId','currentLocationType','status','readOnly','placement','placementSource','placementStatus','placementUnitKey','placementAuditId','placementUpdatedAt','recordSource','sourceVerifiedAt','snapshotImportedAt','activeJobNumber','latitude','longitude','coordinateSource','gpsRecordedAt','hasUnitGps','locationVerification','locationVerifiedAt','locationHistoryId','locationNote','gpsAccuracyM','historicalLatitude','historicalLongitude','historicalCoordinateSource','historicalRecordedAt'];
  const rowRevision=row=>JSON.stringify(revisionFields.map(key=>row[key]??null));
  const legacyRevision=state=>JSON.stringify([state.unitKey,state.placement,state.siteLabel,state.streetAddress,state.auditId,state.canMove]);
  // A newer backend explicitly advertises the existing raw-key writer's native projection.
  // Health and legacy state are independently refreshed; a proof alone is not writer support.
  function nativeAliasCapability(snapshot,health,row,key,ids,state){
    if(snapshot.placementProjectionVersion!==2)return null;
    const targets=snapshot.nativePlacementAliases;
    if(!Array.isArray(targets)||targets.length>1000||targets.some(t=>!object(t)||t.contract!=='COS_NATIVE_PLACEMENT_ALIAS_V1'||t.writerContract!=='COS_CAMERA_PLACEMENT_V2'||!uuid(t.unitId)||!text(t.unitNumber)||!text(t.unitKey)||!Array.isArray(t.deviceIds)||!t.deviceIds.length||!t.deviceIds.every(id=>resourceId(id)===id)||new Set(t.deviceIds).size!==t.deviceIds.length||!/^[a-f0-9]{64}$/.test(t.proof)||(t.auditId!==null&&resourceId(t.auditId)!==t.auditId)))fail('Native placement capability is incomplete or incompatible.');
    const related=targets.filter(t=>t.unitId===row.id||auditKey(t.unitKey)===auditKey(key)||t.deviceIds.some(id=>ids.includes(id)));
    if(!related.length)return null;
    const target=related[0],proofs=allIdentities(health).filter(p=>p.unitId===row.id),proof=proofs[0];
    if(related.length!==1||proofs.length!==1||!['native_provider','owner_confirmed_native'].includes(proof.kind)||target.unitId!==row.id||row.readOnly!==false||target.unitNumber!==row.unitNumber||target.unitKey!==key||proof.unitNumber!==target.unitNumber||proof.proof!==target.proof||!sameSet(target.deviceIds,ids)||!sameSet(proof.deviceIds,ids)||!sameSet(proof.unitKeys,[key])||target.auditId!==state.auditId
      ||health.rows.filter(r=>!r.trackerOnly&&auditKey(r.unit)===auditKey(key)).some(r=>r.unit!==key)
      ||health.rows.some(r=>!r.trackerOnly&&placementMatchKey(r.unit)===placementMatchKey(row.unitNumber)&&r.unit!==key)
      ||snapshot.inventoryItems.some(r=>r.id!==row.id&&[placementMatchKey(key),placementMatchKey(row.unitNumber)].includes(placementMatchKey(r.unitNumber))))fail('The native placement capability or reviewed association changed. Reload the unit.');
    return {contract:target.contract,writerContract:target.writerContract,unitId:target.unitId,unitNumber:target.unitNumber,unitKey:target.unitKey,deviceIds:[...target.deviceIds].sort(),proof:target.proof,auditId:target.auditId};
  }
  function resolvePlacement(snapshot,health,state,key){
    if(!stateMatches(state,key))fail('Current camera placement could not be verified.');
    if(!object(snapshot)||!Array.isArray(snapshot.items)||!Array.isArray(snapshot.inventoryItems)||!object(snapshot.summary)||!Number.isFinite(Date.parse(snapshot.generatedAt))||snapshot.inventoryItems.length>100000||snapshot.items.length>100000)fail('The current Field Map address is unavailable.');
    const inventory=snapshot.inventoryItems,items=snapshot.items;
    if(inventory.some(row=>!object(row)||!uuid(row.id)||!text(row.unitNumber)||typeof row.readOnly!=='boolean')||new Set(inventory.map(row=>row.id)).size!==inventory.length||items.some(row=>!object(row)||!uuid(row.id)||!text(row.unitNumber))||new Set(items.map(row=>row.id)).size!==items.length)fail('Field inventory has missing or duplicate identities.');
    const inventoryById=new Map(inventory.map(row=>[row.id,row]));
    if(snapshot.summary.fieldUnits!==items.length||items.some(row=>!inventoryById.has(row.id)||rowRevision(row)!==rowRevision(inventoryById.get(row.id))))fail('The field and equipment inventories are incomplete or disagree.');
    if(!object(health)||health.evidenceVersion!==2||health.identityVersion!==1||!Array.isArray(health.rows)||!Array.isArray(health.unitIdentities)||!Array.isArray(health.identityWarnings)||health.rows.length>100000||health.unitIdentities.length>1000||health.identityWarnings.length>1000)fail('Current equipment identity could not be verified.');
    if(health.rows.some(row=>!object(row)||!text(String(row.id??''))||typeof row.unit!=='string')||new Set(health.rows.map(row=>String(row.id))).size!==health.rows.length)fail('Camera resource identities are inconsistent.');
    const identities=allIdentities(health),warnings=health.identityWarnings;
    for(const identity of identities){
      if(!object(identity)||!uuid(identity.unitId)||!text(identity.unitNumber)||!['native_provider','owner_placement','owner_confirmed_native'].includes(identity.kind)||!Array.isArray(identity.deviceIds)||!identity.deviceIds.length||!identity.deviceIds.every(id=>resourceId(id)===id)||new Set(identity.deviceIds).size!==identity.deviceIds.length||!Array.isArray(identity.unitKeys)||!identity.unitKeys.length||!identity.unitKeys.every(text)||new Set(identity.unitKeys).size!==identity.unitKeys.length||!/^[a-f0-9]{64}$/.test(identity.proof)||identity.kind==='owner_placement'&&resourceId(identity.placementAuditId)!==identity.placementAuditId)fail('Equipment identity proof is malformed.');
    }
    if(new Set(identities.map(identity=>identity.unitId)).size!==identities.length||warnings.some(w=>!object(w)||!text(w.unitId)||!text(w.reason)||!Array.isArray(w.deviceIds)||!w.deviceIds.every(id=>resourceId(id)===id)||!Array.isArray(w.unitKeys)||!w.unitKeys.every(text)))fail('Equipment identity proof is inconsistent.');
    const matchKey=placementMatchKey(key),group=health.rows.filter(row=>!row.trackerOnly&&auditKey(row.unit)===auditKey(key));
    if(!group.length||group.some(row=>!resourceId(row.id)))fail('This camera unit no longer has a complete source identity.');
    const aliases=health.rows.filter(row=>!row.trackerOnly&&placementMatchKey(row.unit)===matchKey);
    if(new Set(aliases.map(row=>auditKey(row.unit))).size!==1)fail('Camera aliases are ambiguous. Review this unit before changing its address.');
    const ids=group.map(row=>resourceId(row.id));
    const related=claim=>claim.deviceIds.some(id=>ids.includes(id))||claim.unitKeys.some(unit=>auditKey(unit)===auditKey(key));
    if(warnings.some(related))fail('The saved camera-to-equipment identity needs review.');
    const proofs=identities.filter(related),candidates=inventory.filter(row=>placementMatchKey(row.unitNumber)===matchKey);
    if(candidates.length>1||proofs.length>1)fail('More than one equipment record matches this camera.');
    const reviews=snapshot.placementReviews??[];
    if(!Array.isArray(reviews)||reviews.some(review=>!object(review)||!text(review.unitNumber)))fail('Placement review evidence is unavailable.');
    if(reviews.some(review=>placementMatchKey(review.unitNumber)===matchKey))fail('The unit’s physical placement needs identity review.');
    const identityRevision=JSON.stringify([group.map(item=>[String(item.id),item.unit]).sort((a,b)=>a[0].localeCompare(b[0])),proofs.map(proof=>[proof.unitId,proof.unitNumber,proof.kind,[...proof.deviceIds].sort(),[...proof.unitKeys].sort(),proof.proof,proof.placementAuditId??null])]);
    // A camera-only SHOP control is intentionally absent from the field projection. Keep its existing explicit move path without inventing a native UUID or an address.
    if(!proofs.length&&!candidates.length&&state.placement==='SHOP'&&!state.streetAddress.trim()&&inventory.some(row=>row.readOnly===false&&placementIdentityConcernKey(row.unitNumber)===placementIdentityConcernKey(key)))fail('A possible existing equipment model or suffix needs explicit Owner identity review before moving this camera.');
    if(!proofs.length&&!candidates.length&&state.placement==='SHOP'&&!state.streetAddress.trim())return {row:null,field:false,newInstallation:true,writerCompatible:true,site:'',address:'',revision:JSON.stringify(['camera_only_shop',key,identityRevision,legacyRevision(state)])};
    let row;
    if(proofs.length){
      const proof=proofs[0],matches=inventory.filter(item=>item.id===proof.unitId);
      if(matches.length!==1||matches[0].unitNumber!==proof.unitNumber||candidates.some(candidate=>candidate.id!==proof.unitId)||!sameSet(proof.deviceIds,ids)||!sameSet(proof.unitKeys,[...new Set(group.map(item=>item.unit))])||identities.some(other=>other!==proof&&other.deviceIds.some(id=>proof.deviceIds.includes(id))))fail('The verified source group or equipment association changed.');
      row=matches[0];
      if(proof.kind==='owner_placement'&&(row.placementAuditId!==proof.placementAuditId||row.placementUnitKey!==proof.unitNumber))fail('The saved Owner placement identity changed.');
    }else{
      if(candidates.length!==1)fail('No unique current equipment record matches this camera.');
      row=candidates[0];
      if(identities.some(identity=>identity.unitId===row.id))fail('This equipment belongs to a different verified camera group.');
    }
    if(warnings.some(warning=>warning.unitId===row.id))fail('The current equipment identity needs review.');
    if(row.placementStatus==='needs_identity_review'||row.placement==='UNKNOWN'||reviews.some(review=>placementMatchKey(review.unitNumber)===matchKey||placementMatchKey(review.unitNumber)===placementMatchKey(row.unitNumber)))fail('The unit’s physical placement needs identity review.');
    if(row.currentLocationType!=null&&typeof row.currentLocationType!=='string'||row.activeJobNumber!=null&&typeof row.activeJobNumber!=='string')fail('The current placement source is malformed.');
    const ownerFields=['placement','placementUnitKey','placementAuditId','placementUpdatedAt'].some(name=>row[name]!=null);
    if((ownerFields||row.placementSource!=null)&&row.placementSource!=='owner')fail('Owner placement evidence is incomplete. Reload the unit.');
    const fieldRows=items.filter(item=>item.id===row.id),field=fieldRows.length===1;
    if(field&&rowRevision(fieldRows[0])!==rowRevision(row))fail('The field and equipment address records disagree.');
    const declaredField=row.placement==='FIELD'||row.placement!=='SHOP'&&(['field','site'].includes(normal(row.currentLocationType))||['assigned','in_transit','installed','returning'].includes(row.status));
    const declaredShop=row.placement==='SHOP'||normal(row.currentLocationType)==='shop';
    if(field&&declaredShop||!field&&(declaredField||!declaredShop&&state.placement!=='SHOP'))fail('The current field placement is incomplete or unresolved. Review the Field Map record first.');
    // Imported FIELD membership is not a native installation. A confirmed SHOP unit
    // may be deployed even when that historical tracker entry has no site/address.
    // Keep the complete old row in the revision fingerprint; never rewrite it here.
    const unassignedTrackerField=field&&row.status==='field'&&row.placement==null&&row.placementSource==null&&row.installedSiteId==null&&row.activeJobNumber==null
      &&text(row.recordSource)&&row.addressSource===row.recordSource
      &&(row.readOnly===true?normal(row.currentLocationType)==='field':!normal(row.currentLocationType))
      &&row.locationVerification!=='owner_verified'&&row.locationVerifiedAt==null&&row.locationHistoryId==null;
    const explicitOwnerShop=row.placementSource==='owner'&&row.placement==='SHOP';
    if(!field&&!explicitOwnerShop&&(row.installedSiteId!=null||row.locationVerification==='owner_verified'||row.locationVerifiedAt!=null||row.locationHistoryId!=null))fail('The saved installation or verified location needs placement review before deployment.');
    // A typed, current imported SHOP presentation may supersede old inferred
    // provider placement, but never a saved Owner address or placement audit.
    const imported=row.importedInstallation;
    const importedShop=row.importedPlacement==='SHOP'&&row.placementSource==null&&row.placement==null&&row.placementAuditId==null
      &&object(imported)&&imported.nativeUnitId===row.id&&imported.entityKind===(row.readOnly?'tracker':'equipment_unit')
      &&uuid(imported.sourceRevision)&&resourceId(imported.productId)===imported.productId&&resourceId(imported.eventId)===imported.eventId
      &&/^[a-f0-9]{64}$/.test(imported.nativeGuardSha256)&&!state.streetAddress.trim();
    if(row.importedPlacement==='SHOP'&&row.placementSource!=='owner'&&!importedShop)fail('The imported Shop placement proof is incomplete. Reload the unit.');
    const newInstallation=(state.placement==='SHOP'||importedShop)&&(!field||unassignedTrackerField);
    if(newInstallation&&row.placementSource!=='owner'&&row.activeJobNumber!=null)fail('The current equipment has an active job. Review its placement before deploying it.');
    // Empty recorded details can be repaired. Missing fields/types indicate a broken
    // source contract and must never masquerade as an empty editable installation.
    if(!Object.prototype.hasOwnProperty.call(row,'site')||!Object.prototype.hasOwnProperty.call(row,'address')||row.site!=null&&typeof row.site!=='string'||row.address!=null&&typeof row.address!=='string')fail('The current installation address response is incomplete or malformed. Reload the unit.');
    if((row.site||'').length>250||(row.address||'').length>600)fail('The current installation address cannot be edited in this form.');
    if(row.placementSource==='owner'){
      if(!resourceId(row.placementAuditId)||row.placementAuditId!==state.auditId||auditKey(row.placementUnitKey)!==auditKey(key)||row.placement!==state.placement||row.placement==='FIELD'&&(row.address!==state.streetAddress||row.site!==state.siteLabel))fail('Camera placement changed while the address was loading. Reload the unit.');
    }else if(state.streetAddress.trim())fail('Camera and Field Map placement revisions disagree. Reload the unit.');
    if(row.locationVerification==='owner_verified'&&(!text(row.address)||!uuid(row.locationHistoryId)||!Number.isFinite(Date.parse(row.locationVerifiedAt))||typeof row.latitude!=='number'||Math.abs(row.latitude)>90||!Number.isFinite(row.latitude)||typeof row.longitude!=='number'||Math.abs(row.longitude)>180||!Number.isFinite(row.longitude)))fail('The verified location record is incomplete.');
    const nativeAlias=nativeAliasCapability(snapshot,health,row,key,ids,state);
    return {row,field:field&&!newInstallation,newInstallation,nativeAlias,writerCompatible:placementMatchKey(row.unitNumber)===matchKey||Boolean(nativeAlias),site:newInstallation?'':row.site||'',address:newInstallation?'':row.address||'',revision:JSON.stringify([rowRevision(row),field,newInstallation,identityRevision,legacyRevision(state),nativeAlias])};
  }
  async function readCurrentData(db,key,signal){
    const sessionResult=await db.auth.getSession(),session=sessionResult.data?.session;
    if(sessionResult.error||!text(session?.access_token)||!text(session?.user?.id))fail('Sign in again to verify the saved field address.');
    const get=async path=>{
      const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({path,method:'GET',body:null}),signal,cache:'no-store'});
      if(!response.ok)fail(response.status===401||response.status===403?'Your current account cannot verify the field address.':'The current field address is unavailable. Try again after refreshing.');
      try{return await response.json();}catch{fail('The saved field address response is incomplete.');}
    };
    const [legacy,snapshot,health]=await Promise.all([db.rpc('owner_camera_unit_placement_state_v2',{p_unit_key:key}),get('/api/field-map'),get('/api/camera-health/summary-v3')]);
    if(legacy.error)throw legacy.error;
    const current=resolvePlacement(snapshot,health,legacy.data,key),fresh=await db.auth.getSession();
    if(fresh.error||fresh.data?.session?.user?.id!==session.user.id||!text(fresh.data?.session?.access_token))fail('The signed-in account changed. Reopen the unit.');
    return {...current,state:legacy.data,subject:session.user.id};
  }
  function readCurrent(db,key,signal){
    // Bound the entire read, including Supabase/session promises that do not accept a fetch signal.
    if(signal.aborted)return Promise.reject(new Error('The saved placement read was cancelled or timed out.'));
    return new Promise((resolve,reject)=>{
      const abort=()=>reject(new Error('The saved placement read was cancelled or timed out. Refresh the unit before trying again.'));
      signal.addEventListener('abort',abort,{once:true});
      readCurrentData(db,key,signal).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
    });
  }
  async function open({db,key,placement,onSaved}){
    if(active||!db||!text(key)||!['SHOP','FIELD'].includes(placement))return;
    const dialog=document.createElement('dialog');dialog.className='cos-placement-dialog';dialog.setAttribute('aria-labelledby','cosPlacementTitle');
    dialog.innerHTML='<form novalidate><h2 id="cosPlacementTitle"></h2><p class="placement-explanation">This changes the unit’s physical location. Camera online/offline status still comes from its health checks.</p><p class="placement-unit"></p><label class="placement-site-label">Current job / site<input name="site" maxlength="250" autocomplete="off"></label><label class="placement-address-label">Current installation address (street, city, state and ZIP)<input name="address" maxlength="600" autocomplete="street-address" placeholder="Street address, city, state and ZIP code"><small>Use the complete address so COS can locate the new site automatically.</small></label><label>Reason for move<input name="reason" maxlength="1000" required autocomplete="off"></label><label class="placement-confirm"><input name="confirmed" type="checkbox" required> I confirm this is the unit’s current physical placement.</label><p class="placement-pin-note"></p><p class="placement-feedback" role="status">Reading the current unit and Field Map address…</p><div class="placement-buttons"><button type="button" class="placement-cancel">Cancel</button><button type="submit" disabled>Save placement</button></div></form>';
    document.body.append(dialog);active={dialog,pending:false,controller:new AbortController()};
    const context=active,form=dialog.querySelector('form'),input=name=>form.elements.namedItem(name),feedback=dialog.querySelector('.placement-feedback'),submit=form.querySelector('[type=submit]'),cancel=form.querySelector('.placement-cancel'),note=dialog.querySelector('.placement-pin-note');
    const alive=()=>active===context&&dialog.isConnected;
    const disableInputs=value=>{for(const element of form.querySelectorAll('input'))element.disabled=value;};
    const requestSignal=()=>AbortSignal.any([context.controller.signal,AbortSignal.timeout(30000)]);
    dialog.querySelector('h2').textContent=placement==='FIELD'?'Move to Field':'Move to Shop / ROOT';dialog.querySelector('.placement-unit').textContent=key;
    note.textContent=placement==='FIELD'?'Loading the current saved installation. Opening this form does not change its address or verified pin.':'The unit leaves the installed field map and stays searchable in Shop / ROOT. Its location history is kept.';
    for(const name of ['site','address']){input(name).required=placement==='FIELD';input(name).closest('label').hidden=placement!=='FIELD';}
    disableInputs(true);
    const close=()=>{if(context.pending)return;context.controller.abort();dialog.close();dialog.remove();if(active===context)active=null;window.removeEventListener('popstate',close);window.removeEventListener('hashchange',close);};
    cancel.onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});window.addEventListener('popstate',close);window.addEventListener('hashchange',close);
    dialog.showModal();let baseline,requestId=crypto.randomUUID(),uncertain=false;
    try{
      baseline=await readCurrent(db,key,requestSignal());if(!alive())return;
      input('site').value=baseline.site;input('address').value=baseline.address;feedback.textContent='';disableInputs(!baseline.writerCompatible);submit.disabled=!baseline.writerCompatible;
      if(placement==='FIELD'){
        if(baseline.field)dialog.querySelector('h2').textContent='Update field address';
        note.textContent=baseline.field?(!text(baseline.site)||!text(baseline.address)?'The saved installation details are incomplete. Enter the current site and complete address, then confirm the correction.':baseline.row.locationVerification==='owner_verified'?'The current Field Map address and verified pin are loaded. An unchanged address will not create a move.':'The current Field Map address is loaded. An unchanged address will not create a move.'):'Enter the new installation address. A confirmed move will locate the saved address automatically; address pins remain approximate until verified on site.';
      }
      if(!baseline.writerCompatible){feedback.textContent='The verified address is shown, but this equipment alias needs a placement-link review before a move can be saved.';}else input(placement==='FIELD'?'site':'reason').focus();
    }catch(error){if(alive())feedback.textContent='Placement controls are unavailable: '+(error?.message||error)+'. No change was made.';}
    form.onsubmit=async event=>{
      event.preventDefault();if(!alive()||context.pending||uncertain||!baseline||!baseline.writerCompatible)return;
      const site=placement==='FIELD'?input('site').value.trim():'',address=placement==='FIELD'?input('address').value.trim():'',reason=input('reason').value.trim();
      if(placement==='FIELD'&&baseline.field&&text(baseline.address)&&(text(baseline.site)||baseline.row.locationVerification==='owner_verified')&&normal(address)===normal(baseline.address)){
        feedback.textContent=normal(site)===normal(baseline.site)?'The installation address is unchanged. No move was saved; the existing location and verified pin are kept.':'The installation address is unchanged. No move or site-name edit was saved; update the site record to change only its name.';return;
      }
      if(!form.reportValidity()||!reason||(placement==='FIELD'&&(!site||!address)))return;
      context.pending=true;submit.disabled=true;cancel.disabled=true;disableInputs(true);feedback.textContent='Checking the current placement before saving…';
      let writing=false;
      try{
        const current=await readCurrent(db,key,requestSignal());
        if(current.subject!==baseline.subject||current.revision!==baseline.revision)throw new Error('The saved address, placement or equipment identity changed. Close and reopen the unit before saving.');
        // This is a frontend freshness check, not an atomic cross-database lock. The existing writer also guards its own audit revision.
        writing=true;feedback.textContent='Saving physical placement…';
        const result=await db.rpc('owner_set_camera_unit_placement_v2',{p_unit_key:key,p_placement:placement,p_site_label:site,p_street_address:address,p_reason:reason,p_expected_audit_id:current.state.auditId,p_request_id:requestId});
        if(result.error)throw result.error;const saved=result.data;
        if(!saved||saved.ok!==true||saved.unit_key!==key||saved.placement!==placement||saved.request_id!==requestId||resourceId(saved.audit_id)!==saved.audit_id)throw new Error('The save receipt was incomplete.');
        const fresh=await db.rpc('owner_camera_unit_placement_state_v2',{p_unit_key:key});
        if(fresh.error||!stateMatches(fresh.data,key)||fresh.data.auditId!==saved.audit_id||fresh.data.placement!==placement||(placement==='FIELD'&&(fresh.data.streetAddress!==address||fresh.data.siteLabel!==site)))throw new Error('Saved placement could not be verified after reload.');
        if(baseline.nativeAlias){
          // Never replay a committed write when either database's independent readback is uncertain.
          const projected=await readCurrent(db,key,requestSignal()),target=projected.nativeAlias,expected=baseline.nativeAlias;
          if(projected.subject!==baseline.subject||!target||target.unitId!==expected.unitId||target.unitNumber!==expected.unitNumber||target.unitKey!==key||target.proof!==expected.proof||!sameSet(target.deviceIds,expected.deviceIds)||target.auditId!==saved.audit_id||projected.state.auditId!==saved.audit_id||projected.row?.placementAuditId!==saved.audit_id||projected.row?.placementUnitKey!==key||projected.row?.placement!==placement||projected.row?.placementSource!=='owner'||(placement==='FIELD'&&(!projected.field||projected.address!==address||projected.site!==site))||(placement==='SHOP'&&projected.field))throw new Error('Saved placement was not confirmed on exactly one reviewed native map record.');
        }
        // Placement is committed. Geocoding failure must never be reported as a failed move.
        if(placement==='FIELD'){
          feedback.textContent='Placement saved. Locating the installation address…';
          try{
            const session=await db.auth.getSession(),token=session.data?.session?.access_token;
            if(!token||session.data?.session?.user?.id!==baseline.subject)throw new Error('Sign in again to check the address lookup.');
            const response=await fetch('https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/camera-field-geocode',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({unitKey:key,auditId:saved.audit_id}),signal:AbortSignal.timeout(15000),cache:'no-store'});
            if(!response.ok)throw new Error('The address lookup is queued for background processing.');
          }catch{ /* Durable queue survives navigation or a failed immediate lookup. */ }
        }
        await onSaved?.(saved);context.pending=false;close();
      }catch(error){uncertain=true;feedback.textContent=(writing?'The move could not be confirmed: ':'No move was saved: ')+(error?.message||error)+'. Close and refresh this unit before trying again.';}
      finally{context.pending=false;cancel.disabled=false;}
    };
  }
  root.CameraPlacementControls={open,stateMatches,placementMatchKey,resolvePlacement};
})(globalThis);

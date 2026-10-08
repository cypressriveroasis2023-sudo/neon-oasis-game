/* Read-only physical placement from the same authenticated DTO as Field Map.
 * Verified device-ID proofs or the existing guarded full-family/variant matcher only.
 * Bare numbers, IP addresses, source-site labels, and unreviewed aliases never join.
 * The server owns source/Owner/GPS precedence. Raw camera observations stay untouched.
 */
(function(root){
  'use strict';
  const endpoint='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
  const object=v=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
  const text=v=>typeof v==='string'&&v.trim()!=='';
  const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
  const id=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):typeof v==='string'&&/^[1-9]\d*$/.test(v)?v:null;
  const label=v=>typeof v==='string'?v.trim().replace(/\s+/g,' ').toUpperCase():'';
  const same=(a,b)=>a.length===b.length&&new Set(a).size===a.length&&new Set(b).size===b.length&&a.every(v=>b.includes(v));
  const stable=v=>JSON.stringify(v,(_,value)=>object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
  const signature=ds=>stable(ds.map(d=>[id(d.id),d.unit_key||'',d.activation_source||'',d.organization||'']).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const maxAge=20*60*1000;
  let client=null;
  function resolve(snapshot,health,devices,{partial=false,now=Date.now()}={}){
    const fail=message=>{throw new Error(message);};
    const date=Date.parse(snapshot?.generatedAt||'');
    if(!object(snapshot)||!Array.isArray(snapshot.inventoryItems)||!Array.isArray(snapshot.items)||!object(snapshot.summary)||!Number.isFinite(date)||date>now+60000||now-date>maxAge||snapshot.inventoryItems.length>100000||snapshot.items.length>100000)fail('Current Field Map placement is unavailable or stale.');
    const inventory=snapshot.inventoryItems,fields=snapshot.items;
    if(inventory.some(r=>!object(r)||!uuid(r.id)||!text(r.unitNumber)||typeof r.readOnly!=='boolean'||!Object.hasOwn(r,'site')||!Object.hasOwn(r,'address')||r.site!=null&&typeof r.site!=='string'||r.address!=null&&typeof r.address!=='string')||new Set(inventory.map(r=>r.id)).size!==inventory.length||fields.some(r=>!object(r)||!uuid(r.id))||new Set(fields.map(r=>r.id)).size!==fields.length||fields.length!==snapshot.summary.fieldUnits||fields.some(r=>!inventory.some(i=>i.id===r.id&&stable(i)===stable(r))))fail('Field Map inventory identities are incomplete or inconsistent.');
    if(!object(health)||health.identityVersion!==1||health.evidenceVersion!==2||!Array.isArray(health.unitIdentities)||!Array.isArray(health.identityWarnings)||!Array.isArray(health.rows)||health.unitIdentities.length>1000||health.identityWarnings.length>1000||health.rows.length>100000)fail('Verified camera-to-equipment identities are unavailable.');
    const hasOwner=health.ownerConfirmedIdentityVersion!==undefined||health.ownerConfirmedUnitIdentities!==undefined;
    if(hasOwner&&(health.ownerConfirmedIdentityVersion!==1||!Array.isArray(health.ownerConfirmedUnitIdentities)||health.ownerConfirmedUnitIdentities.length>1000))fail('Owner-confirmed equipment identity contract is incomplete.');
    if(health.unitIdentities.some(i=>!object(i)||!['native_provider','owner_placement'].includes(i.kind))||(health.ownerConfirmedUnitIdentities||[]).some(i=>!object(i)||i.kind!=='owner_confirmed_native'))fail('Equipment identity contract kinds are inconsistent.');
    const identities=[...health.unitIdentities,...(health.ownerConfirmedUnitIdentities||[])],warnings=health.identityWarnings,rows=health.rows;
    if(rows.some(r=>!object(r)||!text(String(r.id??''))||typeof r.unit!=='string')||new Set(rows.map(r=>String(r.id))).size!==rows.length)fail('Camera source identities are duplicated or incomplete.');
    if(identities.some(i=>!object(i)||!uuid(i.unitId)||!text(i.unitNumber)||!['native_provider','owner_placement','owner_confirmed_native'].includes(i.kind)||!Array.isArray(i.deviceIds)||!i.deviceIds.length||!i.deviceIds.every(v=>id(v)===v)||!same(i.deviceIds,i.deviceIds)||!Array.isArray(i.unitKeys)||!i.unitKeys.length||!i.unitKeys.every(text)||!same(i.unitKeys,i.unitKeys)||!/^[a-f0-9]{64}$/.test(i.proof)||i.kind==='owner_placement'&&id(i.placementAuditId)!==i.placementAuditId))fail('Equipment identity proof is malformed.');
    if(warnings.some(w=>!object(w)||!text(w.unitId)||!text(w.reason)||w.deviceIds!==undefined&&(!Array.isArray(w.deviceIds)||!w.deviceIds.every(v=>id(v)===v))||w.unitKeys!==undefined&&(!Array.isArray(w.unitKeys)||!w.unitKeys.every(text))))fail('Equipment identity warnings are malformed.');
    const reviews=snapshot.placementReviews??[];
    if(!Array.isArray(reviews)||reviews.some(r=>!object(r)||!text(r.unitNumber)))fail('Placement review evidence is incomplete.');
    const result=new Map(),matchKey=root.CameraPlacementControls?.placementMatchKey;
    const typed=value=>{const key=matchKey?.(value);return typeof key==='string'&&key.startsWith('typed:')?key:null;};
    const unverified=reason=>({status:'unresolved',scope:'unknown',reason});
    for(const device of devices){
      const key=id(device.id),unit=device.unit_key;
      if(!key||device.__trackerOnly){continue;}
      const related=c=>c.deviceIds?.includes(key)||c.unitKeys?.some(k=>label(k)===label(unit));
      const claims=identities.filter(related),warning=warnings.find(w=>related(w)||w.deviceIds===undefined&&w.unitKeys===undefined);
      // The same narrow fallback as the address editor. Normalization is shared,
      // never copied or broadened. A saved warning/claim always blocks this path.
      if(!claims.length&&!warning&&typed(unit)){
        const typedKey=typed(unit),candidates=inventory.filter(r=>typed(r.unitNumber)===typedKey),group=rows.filter(r=>!r.trackerOnly&&label(r.unit)===label(unit)),aliases=rows.filter(r=>!r.trackerOnly&&typed(r.unit)===typedKey);
        const ambiguous=new Set(aliases.map(r=>r.unit.trim().toUpperCase())).size!==1||!group.length||group.some(r=>!id(r.id))||!group.some(r=>String(r.id)===key&&r.unit===unit);
        if(candidates.length===1&&!ambiguous){
          const row=candidates[0],ids=group.map(r=>String(r.id)),unitKeys=[...new Set(group.map(r=>r.unit))];
          const blocked=identities.some(i=>i.unitId===row.id||i.deviceIds.some(v=>ids.includes(v))||i.unitKeys.some(k=>typed(k)===typedKey))||warnings.some(w=>w.unitId===row.id||w.deviceIds?.some(v=>ids.includes(v))||w.unitKeys?.some(k=>typed(k)===typedKey))||reviews.some(r=>typed(r.unitNumber)===typedKey);
          if(!blocked)claims.push({unitId:row.id,unitNumber:row.unitNumber,kind:'exact_full_identifier',deviceIds:ids,unitKeys});
        }
      }
      let value;
      if(warning)value=unverified('Equipment link needs review: '+warning.reason);
      else if(claims.length!==1)value=unverified(claims.length?'Conflicting equipment links need review.':'No verified equipment link. Source group remains separate.');
      else{
        const claim=claims[0],mapped=inventory.filter(r=>r.id===claim.unitId),source=rows.filter(r=>claim.deviceIds.includes(String(r.id))),wholeGroup=rows.filter(r=>claim.unitKeys.includes(r.unit));
        const localGroup=devices.filter(d=>claim.unitKeys.some(k=>label(k)===label(d.unit_key)));
        const conflict=claim.kind!=='exact_full_identifier'&&identities.filter(i=>i.unitId===claim.unitId).length!==1||identities.some(i=>i!==claim&&i.deviceIds.some(v=>claim.deviceIds.includes(v)))||!same(source.map(r=>String(r.id)),claim.deviceIds)||!same(wholeGroup.map(r=>String(r.id)),claim.deviceIds)||source.some(r=>r.trackerOnly||!claim.unitKeys.includes(r.unit)||claim.kind==='native_provider'&&(r.evidence?.kind!=='provider'||r.evidence?.source!=='Star4Live'))||!source.some(r=>String(r.id)===key&&r.unit===unit)||!partial&&!same(localGroup.map(d=>id(d.id)),claim.deviceIds)||devices.filter(d=>id(d.id)===key).length!==1;
        if(conflict||mapped.length!==1||mapped[0].unitNumber!==claim.unitNumber||inventory.filter(r=>label(r.unitNumber)===label(claim.unitNumber)).length!==1)value=unverified('The complete camera group or equipment link changed. Refresh and review.');
        else{
          const row=mapped[0],inField=fields.some(r=>r.id===row.id),atShop=String(row.currentLocationType||'').toLowerCase()==='shop'||row.placement==='SHOP';
          const ownerFields=['placement','placementUnitKey','placementAuditId','placementUpdatedAt'].some(k=>row[k]!=null),badOwner=(ownerFields||row.placementSource!=null)&&row.placementSource!=='owner'||row.placementSource==='owner'&&(!['FIELD','SHOP'].includes(row.placement)||!id(row.placementAuditId)||!text(row.placementUnitKey));
          if(badOwner||row.currentLocationType!=null&&typeof row.currentLocationType!=='string'||row.activeJobNumber!=null&&typeof row.activeJobNumber!=='string'||warnings.some(w=>w.unitId===row.id)||reviews.some(r=>r.unitId===row.id||label(r.unitNumber)===label(row.unitNumber))||row.placementStatus==='needs_identity_review'||row.placement==='UNKNOWN'||inField&&atShop||!inField&&!atShop||claim.kind==='owner_placement'&&(row.placementAuditId!==claim.placementAuditId||row.placementUnitKey!==claim.unitNumber))value=unverified('Current physical placement needs identity review.');
          else if(device.activation_source==='owner_location_override_v2'&&(row.placementSource!=='owner'||label(device.organization)!==label(row.placement==='SHOP'?'root':row.site)))value=unverified('The Owner placement changed. Refresh the saved unit.');
          else value={status:'ready',scope:inField?'field':'shop',site:row.site||'',address:row.address||'',unitId:row.id,unitNumber:row.unitNumber,source:(row.placementSource==='owner'?'Owner-confirmed placement':row.importedInstallation?'mHelpDesk equipment document':'Current Field Map record')+(claim.kind==='exact_full_identifier'?' · Exact full unit identifier':''),identityBasis:claim.kind,row,proof:claim.proof||null,generatedAt:snapshot.generatedAt,reason:''};
        }
      }
      result.set(key,{...value,deviceSignature:signature([device])});
    }
    return result;
  }
  function create({db,getDevices,onChange=()=>{},partial=false,timeoutMs=15000}){
    let values=new Map(),status='loading',revision=0,controller=null,loadedAt=0,subject=null,stopped=false,expiryTimer=null;
    const emit=()=>{if(!stopped)onChange();};
    const view={
      get(device){
        const value=values.get(id(device?.id));
        if(!value||value.deviceSignature!==signature([device]))return {status:status==='ready'?'unresolved':status,scope:'unknown',reason:status==='loading'?'Reading current physical placement…':status==='ready'?'No verified equipment link. Source group remains separate.':'Current physical placement unavailable. Refresh to verify.'};
        const fresh=status==='ready'&&Date.now()-loadedAt<=maxAge;
        if(fresh)return value;
        if(value.status!=='ready')return {status:status==='loading'?'loading':'unavailable',scope:'unknown',reason:status==='loading'?'Reading current physical placement…':'Current physical placement unavailable. Equipment link still needs review.'};
        return {...value,status:status==='loading'?'loading':'stale',lastRead:true,reason:status==='loading'?'Refreshing physical placement; showing the previous read.':'Last read placement; current placement is unavailable. Refresh to verify.'};
      },
      async refresh(){
        if(stopped)return;
        const request=++revision;controller?.abort();controller=new AbortController();const current=controller;
        status='loading';emit();let timer,abort;
        try{
          const run=async()=>{
            const sessionResult=await db.auth.getSession(),session=sessionResult.data?.session;
            if(sessionResult.error||!text(session?.access_token)||!text(session?.user?.id))throw new Error('Current account unavailable.');
            if(request!==revision||stopped)throw new Error('Placement read superseded.');
            if(subject&&subject!==session.user.id){values.clear();emit();}subject=session.user.id;
            const ds=getDevices().slice(),before=signature(ds);
            const get=async path=>{
              const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({path,method:'GET',body:null}),cache:'no-store',signal:current.signal});
              if(!response.ok)throw new Error('Current physical placement unavailable.');
              return response.json();
            };
            const [snapshot,health]=await Promise.all([get('/api/field-map'),get('/api/camera-health/summary-v3')]);
            const resolved=resolve(snapshot,health,ds,{partial}),fresh=await db.auth.getSession();
            if(request!==revision||stopped)throw new Error('Placement read superseded.');
            if(fresh.error||fresh.data?.session?.user?.id!==subject||!text(fresh.data?.session?.access_token)){values.clear();throw new Error('Signed-in account changed.');}
            if(before!==signature(getDevices()))throw new Error('Displayed camera group changed.');
            return resolved;
          };
          const resolved=await Promise.race([run(),new Promise((_,reject)=>{abort=()=>reject(new Error('Placement read cancelled.'));current.signal.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{current.abort();},timeoutMs);})]);
          if(request!==revision||stopped)return;
          values=resolved;loadedAt=Date.now();status='ready';clearTimeout(expiryTimer);expiryTimer=setTimeout(()=>{if(status==='ready'){status='stale';emit();}},maxAge+1);expiryTimer?.unref?.();
        }catch{if(request!==revision||stopped)return;status=values.size?'stale':'unavailable';}
        finally{clearTimeout(timer);if(abort)current.signal.removeEventListener('abort',abort);if(request===revision)emit();}
      },
      clear(){++revision;controller?.abort();clearTimeout(expiryTimer);values.clear();status='unavailable';subject=null;emit();},
      dispose(){stopped=true;view.clear();subscription?.unsubscribe();if(client===view)client=null;}
    };
    const subscription=db.auth.onAuthStateChange?.((_event,session)=>{if(subject&&session?.user?.id!==subject)view.clear();})?.data?.subscription;
    client=view;return view;
  }
  const get=device=>client?client.get(device):null;
  const locationText=device=>{
    const value=get(device);if(!value)return device?.organization||'Site not linked';
    if(value.status==='ready')return (value.scope==='shop'?'SHOP / ROOT':value.scope==='field'?'FIELD':'LOCATION REVIEW')+(value.scope==='field'&&value.site&&value.site!=='SHOP / ROOT'?' · '+value.site:'')+(value.scope==='field'&&value.address?' · '+value.address:'');
    if(value.lastRead)return value.scope==='shop'?'Last read: SHOP / ROOT':'Last read: FIELD · '+[value.site,value.address].filter(Boolean).join(' · ');
    return 'Location unverified · source organization: '+(device?.organization||'not recorded');
  };
  function markup(device,{includeLocation=true}={}){
    const value=get(device);if(!value)return '';
    const links=value.status==='ready'&&value.scope==='field'&&value.address?'<a href="https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(value.address)+'" target="_blank" rel="noopener noreferrer">Look up recorded installation address ↗</a>':'';
    return '<div class="effective-placement" data-placement-status="'+esc(value.status)+'">'+(includeLocation?'<b>Physical placement: '+esc(locationText(device))+'</b>':'')+'<span>'+esc(value.status==='ready'?value.source:value.reason)+'</span><span>Provider organization: '+esc(device.organization||'not recorded')+' · Activation: '+esc(device.activation_state||'unknown')+'</span>'+links+'</div>';
  }
  root.CameraEffectivePlacement={resolve,create,get,locationText,markup,fieldLabel:device=>{const value=get(device);return value?.status==='ready'?value.unitNumber:device?.unit_key||device?.device_name||'';}};
})(globalThis);

import {sameManifest} from './correction-model.js';

export function correctionClient(context) {
  const actor=context.getSession()?.user?.id,role=context.getRole();
  const current=()=>{const profile=context.getProfile();return Boolean(actor&&context.getSession()?.user?.id===actor&&context.getRole()===role&&profile?.user_id===actor&&profile.active===true&&!profile.archived_at&&(!context.getEffectiveRole||context.getEffectiveRole()===role)&&!document.body.classList.contains('owner-test-role-preview'));};
  const assert=()=>{if(!current())throw new Error('Your account or permissions changed. Reopen handoffs with your own account.');};
  async function rpc(name,args={}) {
    assert();let timer;
    try {
      const result=await Promise.race([context.db.rpc(name,args),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('The saved result could not be read. Reconnect and retry the same request.')),15000);})]);
      assert();if(result.error)throw Object.assign(new Error(result.error.message||'Correction request failed.'),{rejected:['P0001','42501','22P02','23505','23514'].includes(result.error.code),unavailable:result.error.code==='PGRST202'});
      return result.data;
    } finally {clearTimeout(timer);}
  }
  async function read(transferId=null) {
    const result=await rpc('techcheck_transfer_correction_context_v1',transferId?{p_transfer_id:transferId}:{});
    if(result?.version!==1||result.actor_id!==actor||result.role!==role||!['owner','it','service'].includes(role)||typeof result.ready!=='boolean'||!Array.isArray(result.transfers)||!Array.isArray(result.equipment))throw new Error('The correction record or signed-in identity could not be verified.');
    return result;
  }
  async function paths(requestId,photos) {
    const result=[];
    for(const photo of photos){
      assert();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await photo.blob.arrayBuffer()))].map(byte=>byte.toString(16).padStart(2,'0')).join('');assert();
      const path=actor+'/'+requestId+'/'+hash+'.jpg';
      // One clearly legible photograph can show the unit and its attached tag.
      for(const kind of ['unit','tag'])result.push({equipment_key:photo.equipment_key,kind,path});
    }
    return result;
  }
  function verified(saved,args) {
    try{
      const confirmation=args.p_confirmation,captured=saved?.confirmation;
      const photos=value=>JSON.stringify(value.map(photo=>({equipment_key:photo.equipment_key,kind:photo.kind,path:photo.path})).sort((a,b)=>(a.equipment_key+'|'+a.kind+'|'+a.path).localeCompare(b.equipment_key+'|'+b.kind+'|'+b.path)));
      const time=value=>typeof value==='string'?Date.parse(value):NaN;
      const confirmed=time(captured?.confirmed_at),applied=time(saved?.created_at);
      return saved?.correction_id===args.p_request_id&&saved.transfer_id===args.p_transfer_id&&saved.base_revision===args.p_expected_revision&&saved.revision===args.p_expected_revision+1&&saved.state==='awaiting_service'
        &&saved.applied_by?.id===actor&&saved.applied_by?.role===role&&saved.confirmation_recorded_by===actor&&captured?.recorded_by===actor
        &&saved.original_technician?.id===confirmation.technician_id&&saved.confirmed_by?.id===confirmation.technician_id&&captured?.technician_id===confirmation.technician_id
        &&saved.mode===confirmation.mode&&saved.confirmed_by?.mode===confirmation.mode&&captured?.mode===confirmation.mode
        &&Number.isFinite(confirmed)&&Number.isFinite(applied)&&confirmed<=applied&&time(saved.confirmed_by.confirmed_at)===confirmed
        &&(confirmation.mode==='self'?confirmed===applied&&!saved.technician_reply&&!saved.evidence_reference:
          confirmed===time(confirmation.technician_confirmed_at)&&saved.technician_reply===confirmation.technician_reply&&captured.technician_reply===confirmation.technician_reply&&saved.evidence_reference===confirmation.evidence_reference&&captured.evidence_reference===confirmation.evidence_reference)
        &&saved.reason===args.p_reason&&sameManifest(saved.after,args.p_items)&&photos(saved.photos)===photos(args.p_photos);
    }catch{return false;}
  }
  async function submit(args,photos,onProgress=()=>{}) {
    assert();const before=await read(args.p_transfer_id),existing=before.transfers.flatMap(t=>t.corrections||[]).find(c=>c.correction_id===args.p_request_id);
    if(!existing){
      if(!before.ready)throw Object.assign(new Error('Corrections are not enabled. Your draft is kept on this device.'),{rejected:true});
      const uploaded=new Set();
      for(let i=0;i<photos.length;i++){
        const photo=photos[i],entry=args.p_photos.find(p=>p.equipment_key===photo.equipment_key&&p.kind==='unit');
        if(!entry)throw new Error('The saved photo does not match this correction request.');
        if(!uploaded.has(entry.path)){
          assert();const {error}=await context.db.storage.from('techcheck-transfer-evidence').upload(entry.path,photo.blob,{contentType:'image/jpeg',upsert:false});assert();
          if(error&&String(error.statusCode)!=='409')throw new Error('The matching photo could not be uploaded. Reconnect and retry the same correction.');
          uploaded.add(entry.path);
        }
        onProgress(i+1,photos.length);
      }
    }
    const result=await rpc('submit_techcheck_transfer_correction_v1',args);
    if(!verified(result,args))throw new Error('The correction save reply could not be verified. Retry the same correction.');
    return result;
  }
  async function photoUrl(path) {
    assert();const {data,error}=await context.db.storage.from('techcheck-transfer-evidence').createSignedUrl(path,300);assert();
    if(error||!data?.signedUrl)throw new Error('The saved evidence photo could not be opened.');return data.signedUrl;
  }
  return {actor,role,current,assert,read,paths,submit,verified,photoUrl};
}

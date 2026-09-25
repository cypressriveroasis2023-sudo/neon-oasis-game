// Shared handoff evidence behavior used by IT and Service.
// Database reads, photo preparation, uploads, and signature canvas mechanics live here.
const EVIDENCE_BUCKET='handoff-evidence';

async function rows(prepId,stage){
  const ctx=window.TechCheckContext;if(!ctx?.db)throw new Error('Tech Check application context is not ready.');
  const {data,error}=await ctx.db.from('handoff_evidence').select('*').eq('prep_ticket_id',prepId).eq('stage',stage).order('created_at',{ascending:true});
  if(error)throw error;
  const result=data||[];
  await Promise.all(result.map(async row=>{
    const {data:urlData}=await ctx.db.storage.from(EVIDENCE_BUCKET).createSignedUrl(row.storage_path,3600);
    row.url=urlData?.signedUrl||'';
  }));
  return result;
}

async function optimizePhoto(file){
  if(!file||!file.type?.startsWith('image/'))return file;
  if(file.size<=900000&&/image\/jpe?g/i.test(file.type))return file;
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((resolve,reject)=>{const el=new Image();el.onload=()=>resolve(el);el.onerror=reject;el.src=url;});
    const maxDimension=1600;
    const scale=Math.min(1,maxDimension/Math.max(img.naturalWidth||1,img.naturalHeight||1));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round((img.naturalWidth||1)*scale));
    canvas.height=Math.max(1,Math.round((img.naturalHeight||1)*scale));
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Could not prepare photo.')),'image/jpeg',0.78));
    const base=(file.name||'photo').replace(/\.[^.]+$/,'');
    return new File([blob],`${base}.jpg`,{type:'image/jpeg',lastModified:Date.now()});
  }catch{
    return file;
  }finally{
    URL.revokeObjectURL(url);
  }
}

async function evidenceContentHash(file){
  if(!globalThis.crypto?.subtle)throw new Error('Secure evidence hashing is unavailable on this device. Reload Tech Check over HTTPS and try again.');
  const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}

async function upload(prepId,stage,kind,file,name,itemId=null){
  const ctx=window.TechCheckContext;if(!ctx?.db)throw new Error('Tech Check application context is not ready.');
  const {data:{session}}=await ctx.db.auth.getSession();
  if(!session?.user?.id)throw new Error('Please sign in again.');
  const contentType=file.type||(kind==='signature'?'image/png':'image/jpeg');
  const ext=kind==='signature'?'png':contentType==='image/png'?'png':contentType==='image/webp'?'webp':'jpg';
  const hash=await evidenceContentHash(file);
  const path=`${session.user.id}/${prepId}/${stage}/${itemId||'ticket'}/${kind}-${hash}.${ext}`;
  const {error:uploadError}=await ctx.db.storage.from(EVIDENCE_BUCKET).upload(path,file,{contentType,upsert:true});
  if(uploadError)throw uploadError;
  const {error:recordError}=itemId
    ? await ctx.db.rpc('record_unit_handoff_evidence',{p_prep_id:prepId,p_item_id:itemId,p_stage:stage,p_kind:kind,p_storage_path:path,p_original_name:name||null})
    : await ctx.db.rpc('record_handoff_evidence',{p_prep_id:prepId,p_stage:stage,p_kind:kind,p_storage_path:path,p_original_name:name||null});
  if(recordError){
    // The RPC may have committed even if the phone lost the response.
    // Verify the exact storage path before deleting the uploaded file or retrying.
    const {data:recorded,error:verifyError}=await ctx.db.from('handoff_evidence')
      .select('id')
      .eq('storage_path',path)
      .maybeSingle();
    if(recorded?.id)return path;
    if(!verifyError)await ctx.db.storage.from(EVIDENCE_BUCKET).remove([path]).catch(()=>null);
    if(verifyError)throw new Error('Connection was interrupted while saving evidence. Tech Check could not safely verify the result. Reconnect and retry this same step; the database will keep only the current evidence for the item.');
    throw recordError;
  }
  return path;
}

function wireCanvas(canvas){
  if(!canvas||canvas.dataset.wired)return;
  canvas.dataset.wired='1';
  canvas.style.touchAction='none';
  const dpr=Math.max(1,globalThis.devicePixelRatio||1);
  const w=Math.max(280,canvas.getBoundingClientRect().width||300);
  const targetHeight=canvas.closest('.wl-solar-sign-card')?150:135;
  canvas.width=w*dpr;
  canvas.height=targetHeight*dpr;
  const ctx=canvas.getContext('2d');
  ctx.scale(dpr,dpr);
  ctx.lineWidth=2.5;
  ctx.lineCap='round';
  ctx.strokeStyle='#0b1720';
  let draw=false;
  const blockTouch=e=>{e.preventDefault();e.stopPropagation();};
  canvas.addEventListener('touchstart',blockTouch,{passive:false});
  canvas.addEventListener('touchmove',blockTouch,{passive:false});
  const pt=e=>{const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
  canvas.onpointerdown=e=>{
    draw=true;
    canvas.setPointerCapture?.(e.pointerId);
    const p=pt(e);
    ctx.beginPath();
    ctx.moveTo(p.x,p.y);
    canvas.dataset.ink='1';
    e.preventDefault();
    e.stopPropagation();
  };
  canvas.onpointermove=e=>{
    if(!draw)return;
    const p=pt(e);
    ctx.lineTo(p.x,p.y);
    ctx.stroke();
    e.preventDefault();
    e.stopPropagation();
  };
  const finish=e=>{
    draw=false;
    try{if(e?.pointerId!=null&&canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId);}catch{}
    e?.preventDefault?.();
    e?.stopPropagation?.();
  };
  canvas.onpointerup=finish;
  canvas.onpointercancel=finish;
}

function blobFromCanvas(canvas){
  return new Promise(resolve=>canvas.toBlob(resolve,'image/png',.92));
}


function unitRows(rows,unitNo,kind){
  const prefix=`unit-${unitNo}-`;
  return (rows||[]).filter(row=>row?.kind===kind&&String(row?.original_name||'').startsWith(prefix));
}
function unitSignature(rows,unitNo){
  return [...(rows||[])].reverse().find(row=>row?.kind==='signature'&&row?.original_name===`unit-${unitNo}-signature.png`)||null;
}


async function handlePhotoUpload(event,deps={}){
  const target=event?.target;
  if(!target?.closest)return {handled:false};
  const button=target.closest('[data-wl-upload]');
  if(!button)return {handled:false};

  const panel=button.closest('.wl-proof');
  if(!panel)return {handled:true,saved:false,reason:'missing_panel'};
  const inputs=[...(panel.querySelectorAll('.wl-file')||[])];
  const files=inputs.flatMap(input=>[...(input.files||[])]);
  const notify=deps.alert||globalThis.alert;
  if(!files.length){
    notify?.('Take or select at least one photo.');
    return {handled:true,saved:false,reason:'missing_photo'};
  }

  const unitNo=Number(panel.dataset.unit||0)||null;
  const expected=Number(panel.dataset.expected||0)||null;
  const item=await deps.resolveItem?.({panel,unitNo})||null;
  const itemId=item?.id||null;

  if(unitNo&&files.length!==1){
    notify?.('Take exactly one photo for this item.');
    return {handled:true,saved:false,reason:'wrong_unit_photo_count'};
  }

  const valid=await deps.validate?.({panel,files,unitNo,expected,item,itemId});
  if(valid===false)return {handled:true,saved:false,reason:'validation_failed'};

  button.disabled=true;
  button.textContent=files.length>1?`Preparing ${files.length} photos…`:'Preparing photo…';

  try{
    const optimize=deps.optimizePhoto||optimizePhoto;
    const optimized=await Promise.all(files.map(optimize));
    const extra=await deps.beforeUpload?.({button,panel,files,optimized,unitNo,expected,item,itemId})||null;
    button.textContent=files.length>1?`Saving ${files.length} photos…`:'Saving photo…';

    const saveEvidence=deps.uploadEvidence||upload;
    await Promise.all(optimized.map((file,index)=>{
      const original=file.name||files[index].name;
      const evidenceName=unitNo?`unit-${unitNo}-photo-${original}`:original;
      return saveEvidence(panel.dataset.proof,panel.dataset.stage,'photo',file,evidenceName,itemId);
    }));

    await deps.afterUpload?.({button,panel,files,optimized,unitNo,expected,item,itemId,extra});
    const consumed=await deps.afterSuccess?.({button,panel,files,optimized,unitNo,expected,item,itemId,extra});
    if(!consumed)await deps.refreshPanel?.(panel);
    return {handled:true,saved:true,unitNo,itemId};
  }catch(error){
    button.disabled=false;
    button.textContent='Save Photo';
    notify?.(error?.message||'Upload failed.');
    return {handled:true,saved:false,error};
  }
}

window.TechCheckEvidence=Object.freeze({rows,optimizePhoto,upload,wireCanvas,blobFromCanvas,unitRows,unitSignature,handlePhotoUpload});

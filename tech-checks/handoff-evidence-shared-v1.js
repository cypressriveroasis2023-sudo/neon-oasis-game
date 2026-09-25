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

async function upload(prepId,stage,kind,file,name,itemId=null){
  const ctx=window.TechCheckContext;if(!ctx?.db)throw new Error('Tech Check application context is not ready.');
  const {data:{session}}=await ctx.db.auth.getSession();
  if(!session?.user?.id)throw new Error('Please sign in again.');
  const ext=kind==='signature'?'png':((name||'photo.jpg').split('.').pop()||'jpg').toLowerCase();
  const path=`${session.user.id}/${prepId}/${stage}/${itemId||'ticket'}/${kind}-${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const {error:uploadError}=await ctx.db.storage.from(EVIDENCE_BUCKET).upload(path,file,{contentType:file.type||(kind==='signature'?'image/png':'image/jpeg')});
  if(uploadError)throw uploadError;
  const {error:recordError}=itemId
    ? await ctx.db.rpc('record_unit_handoff_evidence',{p_prep_id:prepId,p_item_id:itemId,p_stage:stage,p_kind:kind,p_storage_path:path,p_original_name:name||null})
    : await ctx.db.rpc('record_handoff_evidence',{p_prep_id:prepId,p_stage:stage,p_kind:kind,p_storage_path:path,p_original_name:name||null});
  if(recordError)throw recordError;
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

window.TechCheckEvidence=Object.freeze({rows,optimizePhoto,upload,wireCanvas,blobFromCanvas});

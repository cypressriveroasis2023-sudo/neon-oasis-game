// Uses the existing signed-in Supabase client. No new identity or credentials.
export function transferClient(context) {
 const actor=context.getSession()?.user?.id;
 const current=()=>Boolean(actor&&context.getSession()?.user?.id===actor);
 const assert=()=>{if(!current())throw new Error('Your session changed. Sign in again.');};
 const rpc=async(name,args={})=>{assert();const {data,error}=await context.db.rpc(name,args);assert();if(error)throw Object.assign(new Error(error.message||'Transfer request failed.'),{rejected:['P0001','42501','22P02','23505','23514'].includes(error.code)});return data;};
 const read=async()=>{const data=await rpc('techcheck_transfer_context_v1');if(data?.version!==1||!['it','service'].includes(data.role)||!Array.isArray(data.transfers)||!Array.isArray(data.equipment)||!Array.isArray(data.technicians))throw new Error('Transfer information is unavailable or incomplete.');return data;};
 async function submit(args,photos,onProgress=()=>{}) {
  assert();const before=await read();
  const accepted=before.transfers.flatMap(t=>t.events||[]).find(e=>e.id===args.p_request_id);
  for(let i=0;i<photos.length;i++){
   assert();if(!accepted){const {error}=await context.db.storage.from('techcheck-transfer-evidence').upload(args.p_photos[i].path,photos[i].blob,{contentType:'image/jpeg',upsert:false});assert();if(error&&String(error.statusCode)!=='409')throw new Error('Photo upload failed. Your draft is retained; reconnect and retry.');}
   onProgress(i+1,photos.length);
  }
  const result=await rpc('submit_techcheck_transfer_v1',args);
  if(result?.event_id!==args.p_request_id||result?.transfer_id!==args.p_transfer_id||!Number.isInteger(result.revision))throw new Error('The submission result could not be verified. Retry the same request.');
  return result;
 }
 async function paths(id,photos){const result=[];for(const p of photos){assert();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await p.blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');result.push({equipment_key:p.equipment_key||'',kind:p.kind,path:actor+'/'+id+'/'+hash+'.jpg'});}return result;}
 return {actor,current,assert,read,submit,paths,photoUrl:async path=>{assert();const {data,error}=await context.db.storage.from('techcheck-transfer-evidence').createSignedUrl(path,300);assert();if(error||!data?.signedUrl)throw new Error('Saved photo unavailable.');return data.signedUrl;}};
}
let storePromise;
function database(){if(!storePromise)storePromise=new Promise((resolve,reject)=>{const r=indexedDB.open('techcheck-transfer-drafts-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('Device storage is unavailable. Enable storage before starting a handoff.'));});return storePromise;}
export async function deviceDraft(key,value,remove=false){
 const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('drafts',value===undefined&&!remove?'readonly':'readwrite'),store=tx.objectStore('drafts');const r=remove?store.delete(key):value===undefined?store.get(key):store.put(value,key);tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(new Error('The transfer draft could not be preserved on this device.'));tx.onabort=tx.onerror;});
}
export async function transferJpeg(file){
 if(!file||file.size>25*1024*1024)throw new Error('Choose an image smaller than 25 MB.');
 const url=URL.createObjectURL(file);
 try{const image=new Image();image.src=url;await image.decode();const scale=Math.min(1,1920/Math.max(image.width,image.height)),c=document.createElement('canvas');c.width=Math.round(image.width*scale);c.height=Math.round(image.height*scale);c.getContext('2d').drawImage(image,0,0,c.width,c.height);const blob=await new Promise(resolve=>c.toBlob(resolve,'image/jpeg',.88));if(!blob||blob.size>5*1024*1024)throw new Error('Image too large.');return blob;}
 finally{URL.revokeObjectURL(url);}
}

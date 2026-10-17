// Uses the existing signed-in Supabase client. No new identity or credentials.
import {transferReadiness,transferReadinessMessage} from './readiness.js';
export function transferClient(context) {
 const actor=context.getSession()?.user?.id,role=context.getRole();
 const current=()=>{const p=context.getProfile();return Boolean(actor&&context.getSession()?.user?.id===actor&&context.getRole()===role&&p?.user_id===actor&&p?.active===true&&!p?.archived_at);};
 const assert=()=>{if(!current())throw new Error('Your session changed. Sign in again.');};
 const rpc=async(name,args={})=>{assert();const {data,error}=await context.db.rpc(name,args);assert();if(error)throw Object.assign(new Error(error.message||'Transfer request failed.'),{rejected:['P0001','42501','22P02','23505','23514'].includes(error.code),unavailable:error.code==='PGRST202',reason:error.code==='PGRST202'?'not_installed':undefined});return data;};
 const read=async()=>{const readiness=await transferReadiness(context,role);assert();if(!readiness.ready)throw Object.assign(new Error(transferReadinessMessage(readiness.reason)),{unavailable:true,reason:readiness.reason});const data=await rpc('techcheck_transfer_context_v1');if(data?.version!==1||!['it','service'].includes(data.role)||!Array.isArray(data.transfers)||!Array.isArray(data.equipment)||!Array.isArray(data.technicians))throw new Error('Transfer information is unavailable or incomplete.');return data;};
 async function submit(args,photos,onProgress=()=>{}) {
  assert();const before=await read();
  const accepted=before.transfers.flatMap(t=>t.events||[]).find(e=>e.id===args.p_request_id);
  for(let i=0;i<photos.length;i++){
   assert();if(!accepted){const {error}=await context.db.storage.from('techcheck-transfer-evidence').upload(args.p_photos[i].path,photos[i].blob,{contentType:'image/jpeg',upsert:false});assert();if(error&&String(error.statusCode)!=='409')throw new Error('Photo upload failed. Your draft is retained; reconnect and retry.');}
   onProgress(i+1,photos.length);
  }
  const proof=args.p_kind==='checkout'&&!accepted?await requestLocationProof(context,args.p_request_id,'checkout',args.p_items):null;assert();
  const result=await rpc(proof?'submit_techcheck_transfer_v7':'submit_techcheck_transfer_v1',proof?{...args,p_location_proof:proof}:args);
  if(result?.event_id!==args.p_request_id||result?.transfer_id!==args.p_transfer_id||!Number.isInteger(result.revision))throw new Error('The submission result could not be verified. Retry the same request.');
  return result;
 }
 async function paths(id,photos){const result=[];for(const p of photos){assert();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await p.blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');result.push({equipment_key:p.equipment_key||'',kind:p.kind,path:actor+'/'+id+'/'+hash+'.jpg'});}return result;}
 return {actor,current,assert,read,submit,paths,photoUrl:async path=>{assert();const {data,error}=await context.db.storage.from('techcheck-transfer-evidence').createSignedUrl(path,300);assert();if(error||!data?.signedUrl)throw new Error('Saved photo unavailable.');return data.signedUrl;}};
}
export async function requestLocationProof(context,requestId,purpose,items){
 const actor=context.getSession()?.user?.id;
 const current=()=>actor&&context.getSession()?.user?.id===actor&&context.getProfile()?.user_id===actor&&context.getProfile()?.active===true&&!context.getProfile()?.archived_at;
 if(!current())throw new Error('Your session changed. Sign in again.');
 const fresh=context.db.auth?.getSession?await context.db.auth.getSession():{data:{session:context.getSession()}};
 if(!current()||fresh?.data?.session?.user?.id!==actor||!fresh.data.session.access_token)throw new Error('Your session changed. Sign in again.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
 try{
  const response=await fetch('https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer '+fresh.data.session.access_token,'Content-Type':'application/json'},body:JSON.stringify({path:'/api/techcheck/location-proof',method:'POST',body:{request_id:requestId,purpose,items:items.map(({equipment_key,family,unit_tag})=>({equipment_key,family,unit_tag}))}}),cache:'no-store',redirect:'error',signal:controller.signal});
  const proof=await response.json();if(!current())throw new Error('Your session changed. Sign in again.');
  if(!response.ok)throw new Error(typeof proof?.error==='string'?proof.error:'Current Shop placement could not be verified.');
  if(typeof proof?.payload!=='string'||proof.payload.length>30000||typeof proof.signature!=='string'||!/^[a-f0-9]{64}$/.test(proof.signature))throw new Error('Shop verification returned an invalid proof.');
  return proof;
 }finally{clearTimeout(timer);controller.abort();}
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

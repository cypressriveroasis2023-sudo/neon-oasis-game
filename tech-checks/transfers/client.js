// Uses the existing signed-in Supabase client. No new identity or credentials.
import {transferReadiness,transferReadinessMessage} from './readiness.js';
import {canRecordReceipt} from './model.js';
export function transferClient(context) {
 const actor=context.getSession()?.user?.id,role=context.getRole();
 const current=()=>{const p=context.getProfile();return Boolean(actor&&context.getSession()?.user?.id===actor&&context.getRole()===role&&p?.user_id===actor&&p?.active===true&&!p?.archived_at);};
 const owner=()=>current()&&context.getProfile()?.role==='owner';
 const assert=()=>{if(!current())throw new Error('Your session changed. Sign in again.');};
 const rpc=async(name,args={})=>{assert();const {data,error}=await context.db.rpc(name,args);assert();if(error)throw Object.assign(new Error(error.message||'Transfer request failed.'),{rejected:['P0001','42501','22P02','23505','23514'].includes(error.code),unavailable:error.code==='PGRST202',reason:error.code==='PGRST202'?'not_installed':undefined});return data;};
 const read=async()=>{const readiness=await transferReadiness(context,role);assert();if(!readiness.ready)throw Object.assign(new Error(transferReadinessMessage(readiness.reason)),{unavailable:true,reason:readiness.reason});const data=await rpc('techcheck_transfer_context_v1');if(data?.version!==1||!['it','service'].includes(data.role)||!Array.isArray(data.transfers)||!Array.isArray(data.equipment)||!Array.isArray(data.technicians))throw new Error('Transfer information is unavailable or incomplete.');return data;};
 async function submit(args,photos,onProgress=()=>{}) {
  assert();const before=await read();
  const accepted=before.transfers.flatMap(t=>t.events||[]).find(e=>e.id===args.p_request_id);
  const transfer=before.transfers.find(t=>t.id===args.p_transfer_id);
  if(args.p_kind==='receipt'&&!accepted&&!canRecordReceipt(transfer))throw Object.assign(new Error('A new receipt cannot be recorded for this handoff. Reload its saved details; any recorded differences need IT / Owner review.'),{rejected:true,receiptRecorded:true});
  if(args.p_kind==='receipt'&&!accepted&&transfer.revision!==args.p_expected_revision)throw Object.assign(new Error('The handoff changed before this receipt was saved. Review the current purpose and discard the stale draft before signing again.'),{rejected:true,staleDraft:true});
  for(let i=0;i<photos.length;i++){
   assert();if(!accepted){const {error}=await context.db.storage.from('techcheck-transfer-evidence').upload(args.p_photos[i].path,photos[i].blob,{contentType:'image/jpeg',upsert:false});assert();if(error&&String(error.statusCode)!=='409')throw new Error('Photo upload failed. Your draft is retained; reconnect and retry.');}
   onProgress(i+1,photos.length);
  }
  // Frozen drafts from the previous client keep their original RPC and exact
  // payload. New purpose-aware submissions always use the explicit v2 contract.
  const result=await rpc(Object.hasOwn(args,'p_purpose')?'submit_techcheck_transfer_v2':'submit_techcheck_transfer_v1',args);
  if(result?.event_id!==args.p_request_id||result?.transfer_id!==args.p_transfer_id||!Number.isInteger(result.revision))throw new Error('The submission result could not be verified. Retry the same request.');
  return result;
 }
 async function paths(id,photos){const result=[];for(const p of photos){assert();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await p.blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');result.push({equipment_key:p.equipment_key||'',kind:p.kind,path:actor+'/'+id+'/'+hash+'.jpg'});}return result;}
 async function classify(args){const result=await rpc('classify_techcheck_transfer_purpose_v1',args);if(result?.event_id!==args.p_request_id||result?.transfer_id!==args.p_transfer_id||!Number.isInteger(result.revision))throw new Error('The purpose update could not be verified. Retry the same update.');return result;}
 async function ownerResolve(args){if(!owner())throw new Error('Owner account required.');const result=await rpc('owner_resolve_techcheck_transfer_v1',args);if(result?.event_id!==args.p_request_id||result?.transfer_id!==args.p_transfer_id||result?.state!=='accepted'||!Number.isInteger(result.revision))throw new Error('The Owner completion could not be verified. Retry the same completion.');return result;}
 // The SIM drawer, for the pick list. Optional: a handoff never waits on it or fails because of it.
 const simDrawer=async()=>{try{const data=await rpc('sim_drawer_v1');return Array.isArray(data?.cards)?data.cards.filter(c=>c&&c.status==='in_drawer'&&typeof c.sim==='string').map(c=>({sim:c.sim,carrier:typeof c.carrier==='string'?c.carrier:''})):null;}catch{return null;}};
 return {actor,current,owner,assert,read,submit,classify,ownerResolve,paths,simDrawer,photoUrl:async path=>{assert();const {data,error}=await context.db.storage.from('techcheck-transfer-evidence').createSignedUrl(path,300);assert();if(error||!data?.signedUrl)throw new Error('Saved photo unavailable.');return data.signedUrl;}};
}
let storePromise;
function database(){if(!storePromise)storePromise=new Promise((resolve,reject)=>{const r=indexedDB.open('techcheck-transfer-drafts-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('Device storage is unavailable. Enable storage before starting a handoff.'));});return storePromise;}
// Safari in private mode (and the iPhone test browser) refuses to keep Blob
// photos in on-device storage. Keep them as plain bytes and turn them back into
// photos when the draft is read. Drafts saved earlier with real Blobs still open.
async function draftBytes(value){
 if(value instanceof Blob)return {__cosBlob:1,type:value.type,bytes:await value.arrayBuffer()};
 if(Array.isArray(value))return Promise.all(value.map(draftBytes));
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){const out={};for(const [k,v] of Object.entries(value))out[k]=await draftBytes(v);return out;}
 return value;
}
function draftBlobs(value){
 if(value&&typeof value==='object'&&value.__cosBlob===1&&value.bytes instanceof ArrayBuffer)return new Blob([value.bytes],{type:value.type||'image/jpeg'});
 if(Array.isArray(value))return value.map(draftBlobs);
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){const out={};for(const [k,v] of Object.entries(value))out[k]=draftBlobs(v);return out;}
 return value;
}
export async function deviceDraft(key,value,remove=false){
 const stored=value===undefined||remove?value:await draftBytes(value);
 const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('drafts',value===undefined&&!remove?'readonly':'readwrite'),store=tx.objectStore('drafts');const r=remove?store.delete(key):value===undefined?store.get(key):store.put(stored,key);tx.oncomplete=()=>resolve(value===undefined&&!remove?draftBlobs(r.result):r.result);tx.onerror=()=>reject(new Error('The transfer draft could not be preserved on this device.'));tx.onabort=tx.onerror;});
}
// Read a photo into something a canvas can draw. createImageBitmap reads the file
// directly; the <img> path is the fallback. Safari can reject image.decode() with
// "Loading was canceled", so the fallback waits for the load event instead.
// Nothing here may hang: after 15 seconds the tech gets a clear message.
export function loadPhotoImage(source){
 const timeout=new Promise((_,reject)=>setTimeout(()=>reject(new Error('This photo took too long to read. Take it again.')),15000));
 const read=(async()=>{
  if(typeof source!=='string'&&typeof createImageBitmap==='function'){try{return await createImageBitmap(source);}catch{}}
  const url=typeof source==='string'?source:URL.createObjectURL(source);
  try{return await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('This photo could not be read. Take it again.'));image.src=url;});}
  finally{if(typeof source!=='string')setTimeout(()=>URL.revokeObjectURL(url),0);}
 })();
 return Promise.race([read,timeout]);
}
export async function transferJpeg(file){
 if(!file||file.size>25*1024*1024)throw new Error('Choose an image smaller than 25 MB.');
 const image=await loadPhotoImage(file);
 const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height;
 if(!w||!h)throw new Error('This photo could not be read. Take it again.');
 const scale=Math.min(1,1920/Math.max(w,h)),c=document.createElement('canvas');c.width=Math.round(w*scale);c.height=Math.round(h*scale);c.getContext('2d').drawImage(image,0,0,c.width,c.height);image.close?.();
 const blob=await Promise.race([new Promise(resolve=>c.toBlob(resolve,'image/jpeg',.88)),new Promise((_,reject)=>setTimeout(()=>reject(new Error('This photo took too long to save. Take it again.')),15000))]);if(!blob||blob.size>5*1024*1024)throw new Error('Image too large.');return blob;
}

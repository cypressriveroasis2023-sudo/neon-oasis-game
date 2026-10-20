import {validateContext} from './model.js';
export const BUCKET='techcheck-ticketfree-evidence';
export function ticketfreeClient(context) {
 const actor=context.getSession()?.user?.id,role=context.getRole();
 const current=()=>{const p=context.getProfile();return Boolean(actor&&context.getSession()?.user?.id===actor&&context.getRole()===role&&p?.user_id===actor&&p.active===true&&!p.archived_at);};
 const assert=()=>{if(!current())throw new Error('Your signed-in account changed. Reopen this screen.');};
 const rpc=async(name,args={})=>{assert();const {data,error}=await context.db.rpc(name,args);assert();if(error)throw Object.assign(new Error(error.message||'The return request could not be verified.'),{rejected:['P0001','42501','22P02','23505','23514','22023'].includes(error.code)});return data;};
 const read=async()=>validateContext(await rpc('techcheck_ticketfree_context_v1'),actor,role);
 async function paths(id,photos) {
  const out=[];
  for(const photo of photos){assert();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await photo.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');out.push(actor+'/'+id+'/'+hash+'.jpg');}
  assert();return out;
 }
 async function submit(kind,args,photos) {
  assert();
  if(photos.length!==args.p_photos.length)throw new Error('The saved photo list changed. Reopen the retained draft.');
  for(let i=0;i<photos.length;i++){
   const {error}=await context.db.storage.from(BUCKET).upload(args.p_photos[i],photos[i],{contentType:'image/jpeg',upsert:false});assert();
   if(error&&String(error.statusCode)!=='409')throw new Error('Photo upload failed. Your draft is retained; reconnect and retry.');
  }
  const result=await rpc(kind==='submit'?'submit_techcheck_ticketfree_return_v1':'receive_techcheck_ticketfree_return_v1',args);
  if(result?.request_id!==args.p_request_id||result?.return_id!==(kind==='submit'?args.p_request_id:args.p_return_id)||![1,2].includes(result.revision))throw new Error('The save result was not verified. Retry the same request; do not create another return.');
  return result;
 }
 const photoUrl=async path=>{assert();const {data,error}=await context.db.storage.from(BUCKET).createSignedUrl(path,300);assert();if(error||!data?.signedUrl)throw new Error('Saved photo unavailable.');return data.signedUrl;};
 return {actor,role,current,assert,read,paths,submit,photoUrl};
}

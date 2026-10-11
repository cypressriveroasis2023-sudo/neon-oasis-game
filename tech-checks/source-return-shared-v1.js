// Reconstructed source-only return transport. Backend authority is mandatory;
// this browser fence prevents stale views from sending or publishing work.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const changed=()=>Object.assign(Error('This source return view changed. Reopen the current assignment.'),{code:'SOURCE_RETURN_VIEW_CHANGED'});
const uuid=value=>{if(!UUID.test(value||''))throw Error('An exact record identifier is required.');return value;};
export const isSourceAssignment=row=>row?.created_from==='mhelpdesk_service_intake';
export const PICKUP_SERVICE_CONFIRMATION='I confirm this is the complete actual returned-unit set for this Pickup. Send this set to the assigned IT team for intake.';
export const PICKUP_IT_CONFIRMATION='I confirm every item in this exact sealed returned-unit set has completed its required IT intake disposition.';
export function logicalSession(session){
 try{const actor=uuid(session?.user?.id),token=session?.access_token;if(typeof token!=='string'||token.length>16384)return null;const parts=token.split('.');if(parts.length!==3||parts.some(part=>!part.length||!/^[A-Za-z0-9_-]+$/.test(part)))return null;
  const claims=JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
  return claims.sub===actor&&UUID.test(claims.session_id||'')?{actor,session:claims.session_id}:null;
 }catch{return null;}
}
const same=(a,b)=>Boolean(a&&b&&a.actor===b.actor&&a.session===b.session);
const visible=node=>Boolean(node?.isConnected&&node.getClientRects?.().length&&!node.closest?.('[hidden],[aria-hidden="true"]')&&(!globalThis.getComputedStyle||getComputedStyle(node).visibility!=='hidden'));
export function captureSourceReturnScope({context,role,view,isCurrent=()=>true,window:win=globalThis.window,document:doc=globalThis.document}){
 const app=context(),db=app?.db,identity=logicalSession(app?.getSession?.()),profile=app?.getProfile?.();
 const profileKey=JSON.stringify([profile?.user_id,profile?.role,profile?.active,profile?.archived_at||null]);
 const href=win?.location?.href;let invalid=false,disposed=false;
 function current(){const c=context(),p=c?.getProfile?.(),effective=c?.getEffectiveIdentity?.();return Boolean(!invalid&&!disposed&&identity&&db===c?.db&&same(identity,logicalSession(c?.getSession?.()))
  &&p?.user_id===identity.actor&&p.role===role&&p.active===true&&!p.archived_at&&JSON.stringify([p.user_id,p.role,p.active,p.archived_at||null])===profileKey
  &&effective?.id===identity.actor&&effective.role===role&&!effective.owner_test&&(!c.getEffectiveRole||c.getEffectiveRole()===role)
  &&href===win?.location?.href&&visible(view)&&isCurrent());}
 const invalidate=()=>{invalid=true;};
 const events=['popstate','hashchange','pagehide','cos-private-data-invalidated'];for(const event of events)win?.addEventListener?.(event,invalidate);
 const onNavigation=event=>{if(event.target?.closest?.('[data-wl-home],[data-wl-mode],[data-wl-menu-go],[data-wl-menu-signout]'))invalidate();};doc?.addEventListener?.('click',onNavigation,true);
 const subscription=db?.auth?.onAuthStateChange?.((event,session)=>{if(event==='SIGNED_OUT'||!same(identity,logicalSession(session)))invalidate();})?.data?.subscription;
 const Observer=win?.MutationObserver;const observer=Observer?new Observer(records=>{
  const affects=node=>Boolean(node===view||node?.contains?.(view));
  const interrupted=records.some(record=>record.type==='childList'&&[...(record.removedNodes||[])].some(affects)
   ||record.type==='attributes'&&affects(record.target)&&['hidden','aria-hidden','style','class'].includes(record.attributeName));
  if(interrupted||!current())invalidate();
 }):null;observer?.observe(doc.documentElement,{subtree:true,childList:true,attributes:true,attributeOldValue:true,attributeFilter:['class','style','hidden','aria-hidden']});
 const assert=()=>{if(!current())throw changed();};
 async function assertFresh(){assert();let result;try{result=await db.auth.getSession();}catch{invalidate();throw changed();}if(result?.error||!same(identity,logicalSession(result?.data?.session))){invalidate();throw changed();}assert();}
 function dispose(){disposed=true;subscription?.unsubscribe?.();observer?.disconnect();for(const event of events)win?.removeEventListener?.(event,invalidate);doc?.removeEventListener?.('click',onNavigation,true);}
 const scope=Object.freeze({actorId:identity?.actor,db,role,current,assert,assertFresh,invalidate,dispose});
 if(!current()){dispose();throw changed();}return scope;
}
export function canonicalJSON(value){
 let nodes=0;
 function encode(v,depth){
  if(depth>16||++nodes>10000)throw Error('Source request exceeds the bounded JSON structure.');
  if(v===null||typeof v==='boolean')return JSON.stringify(v);
  if(typeof v==='string'){if(v.length>20000)throw Error('Source request text is too long.');return JSON.stringify(v);}
  if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(item=>encode(item,depth+1)).join(',')+']';
  if(v&&Object.getPrototypeOf(v)===Object.prototype)return '{'+Object.keys(v).sort().map(key=>encode(key,depth+1)+':'+encode(v[key],depth+1)).join(',')+'}';
  throw Error('Only bounded JSON values may be saved in a source request.');
 }
 const result=encode(value,0);if(new TextEncoder().encode(result).length>65536)throw Error('Source request exceeds 64 KiB.');return result;
}
// Journal keys contain actor and exact assignment/return identifiers, never a
// session token. Compare-and-swap prevents a late operation clearing new work.
export function sourceJournal(storage,{actorId,assignmentId,returnId}){
 const key=`cos-source-return-v1:${uuid(actorId)}:${uuid(assignmentId)}:${uuid(returnId)}`;
 return Object.freeze({key,read(){return storage.getItem(key);},parse(){const raw=storage.getItem(key);return raw===null?null:JSON.parse(raw);},save(expected,value){if(storage.getItem(key)!==expected)throw Error('A newer source request is already saved.');const raw=canonicalJSON(value);storage.setItem(key,raw);return raw;},clear(expected){if(storage.getItem(key)!==expected)throw Error('A newer source request must not be cleared.');storage.removeItem(key);}});
}
export async function prepareSourceUploadIntent(scope,{returnId,files,stage='service',existing=null,save}){
 uuid(returnId);if(!['service','intake'].includes(stage)||!Array.isArray(files)||files.length<1||files.length>20)throw Error('One to twenty actual evidence photos are required.');
 const intent=[];
 for(let index=0;index<files.length;index++){
  scope.assert();const file=files[index];if(!file||!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)||!file.size||file.size>20*1024*1024)throw Error('Choose a supported, nonempty evidence photo under 20 MB.');
  const bytes=await file.arrayBuffer();scope.assert();const digest=await crypto.subtle.digest('SHA-256',bytes);scope.assert();const hash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  const name=String(file.name||'photo').replace(/[^A-Za-z0-9._-]/g,'_').slice(-96)||'photo';
  intent.push({path:`${scope.actorId}/${returnId}/returns/${stage}/${index+1}-${hash}-${name}`,sha256:hash,size:file.size,type:file.type});
 }
 if(existing&&canonicalJSON(existing)!==canonicalJSON(intent))throw Error('The saved evidence is unconfirmed. Retry the exact same files and paths.');
 await scope.assertFresh();await save(intent);await scope.assertFresh();return intent;
}
export async function uploadSourceEvidence(scope,{intent,files,bucket='handoff-evidence'}){
 if(bucket!=='handoff-evidence'||!Array.isArray(intent)||intent.length!==files.length)throw Error('The exact saved evidence intent is required.');
 if(intent.length<1||intent.length>20)throw Error('One to twenty saved evidence photos are required.');
 // Rehash the actual immutable File bytes before every transport, including
 // retries. An actor prefix alone is not proof of the saved upload intent.
 const paths=[],savedIntent=structuredClone(intent),savedFiles=files.slice();
 for(let i=0;i<savedIntent.length;i++){
  const entry=savedIntent[i],file=savedFiles[i],parts=String(entry?.path||'').split('/');
  if(parts.length!==5||parts[0]!==scope.actorId||!UUID.test(parts[1])||parts[2]!=='returns'||!['service','intake'].includes(parts[3]))throw Error('This saved evidence path is invalid.');
  await prepareSourceUploadIntent(scope,{returnId:parts[1],stage:parts[3],files:[file],save:()=>{},existing:null}).then(single=>{
   const expected={...single[0],path:single[0].path.replace('/1-','/'+(i+1)+'-')};
   if(canonicalJSON(expected)!==canonicalJSON(entry))throw Error('The actual evidence file does not match the saved immutable intent.');
  });
  await scope.assertFresh();const result=await scope.db.storage.from(bucket).upload(entry.path,file,{upsert:false,contentType:entry.type});await scope.assertFresh();
  if(result?.error&&Number(result.error.statusCode||result.error.status)!==409)throw result.error;
  paths.push(entry.path);
  // 409 is provisional only. The backend must prove current object ownership,
  // identity, metadata and linkage before accepting a source return or intake.
 }
 return paths;
}
export function prepareSourceRequest({requestId,action,expectedRevision,...payload}){
 uuid(requestId);if(typeof action!=='string'||!action||action.length>64)throw Error('An exact source action is required.');
 if(expectedRevision!==undefined&&(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)&&!(/^[a-f0-9]{32,64}$/.test(expectedRevision)))throw Error('Review the exact current source revision.');
 const request={...payload,action,requestId,...(expectedRevision===undefined?{}:{expectedRevision})};canonicalJSON(request);return request;
}
export async function sourceReturnRPC(scope,{assignmentId,returnId=null,request,validate}){
 uuid(assignmentId);if(returnId!==null)uuid(returnId);if(!request||typeof validate!=='function')throw Error('A bounded request and exact receipt validator are required.');canonicalJSON(request);
 await scope.assertFresh();const response=await scope.db.rpc('service_source_return_v1',{p_assignment_id:assignmentId,p_return_id:returnId,p_request:structuredClone(request)});await scope.assertFresh();
 if(response?.error)throw response.error;if(!validate(response?.data))throw Error('The exact source result could not be confirmed. Keep the saved request for recovery.');return response.data;
}
export function sourceRequestReceipt(request,returnId){return value=>Boolean(value&&['recorded','existing'].includes(value.state)&&value.request_id===request.requestId&&value.return_id===returnId);}
// Staged continuation for Add Return and restored drafts: never publish data
// discovered under an old login after remembered-unit lookup or persistence.
export async function stageSourceReturn(scope,{read,save,publish}){await scope.assertFresh();const draft=await read();await scope.assertFresh();await save(draft);await scope.assertFresh();return publish(draft);}

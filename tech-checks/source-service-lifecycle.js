import {sourceITSessionIdentity as sourceServiceSessionIdentity} from './source-it-lifecycle.js';
// Source-only Service browser correlation; backend membership is authoritative.
export class StaleSourceServiceView extends Error {
  constructor(){super('This Service view changed. Reopen the assigned job before continuing.');this.name='StaleSourceServiceView';}
}
function sameSession(a,b){return Boolean(a&&b&&a.actor===b.actor&&a.sessionId===b.sessionId);}
function ownService(context){
  try{
    const session=sourceServiceSessionIdentity(context?.getSession?.()),profile=context?.getProfile?.(),effective=context?.getEffectiveIdentity?.();
    if(!session||context?.getRole?.()!=='service'||context?.getEffectiveRole?.()!=='service'||profile?.role!=='service'||profile.active!==true||profile.archived_at||profile.user_id!==session.actor||effective?.id!==session.actor||effective.role!=='service'||effective.owner_test)return null;
    return session;
  }catch{return null;}
}
function visible(node,environment){
  if(!node?.isConnected)return false;
  for(let item=node;item;item=item.parentElement){
    if(item.hidden||item.inert||item.getAttribute?.('aria-hidden')==='true')return false;
    const style=environment.getComputedStyle(item);
    if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse')return false;
  }
  return true;
}
function visibleCards(view,environment){return Array.from(view.children||[]).filter(node=>visible(node,environment));}
function fields(view){return Array.from(view.querySelectorAll('input,textarea,select')).map(node=>({node,value:node.value,checked:node.checked}));}

// Call synchronously before the first await. A cancelled scope never becomes
// valid again, including same-task hide/restore and same-account new login.
export function captureSourceServiceScope({context,view,getGeneration=()=>0,observeInputs=true,onInvalidate=()=>{},environment=globalThis.window}={}){
  let stopped=false,disposed=false,observer=null,subscription=null;
  const cleanups=[];
  const readContext=typeof context==='function'?context:()=>context;
  const readView=typeof view==='function'?view:()=>view;
  const initialContext=readContext(),db=initialContext?.db,identity=ownService(initialContext),root=readView();
  if(!identity||!db?.auth?.getSession||!environment?.getComputedStyle||!environment?.MutationObserver||environment.document?.hidden||!visible(root,environment))throw new StaleSourceServiceView();
  const initialGeneration=getGeneration(),href=String(environment.location?.href||''),cards=visibleCards(root,environment),inputs=observeInputs?fields(root):[];
  const ancestors=[];for(let node=root;node;node=node.parentElement)ancestors.push(node);
  function stop(){if(stopped||disposed)return;stopped=true;try{onInvalidate();}catch{}}
  function relevant(records){
    return records.some(record=>{
      if(record.type==='attributes')return ancestors.includes(record.target)||cards.includes(record.target);
      if(record.type==='childList')return Array.from(record.removedNodes||[]).some(node=>ancestors.includes(node)||cards.includes(node)||node.contains?.(root)||cards.some(card=>node.contains?.(card)));
      return false;
    });
  }
  function current(){
    if(stopped||disposed)return false;
    try{
      if(relevant(observer?.takeRecords?.()||[]))stop();
      const ctx=readContext(),nowCards=visibleCards(root,environment);
      if(stopped||ctx?.db!==db||!sameSession(identity,ownService(ctx))||readView()!==root||getGeneration()!==initialGeneration||String(environment.location?.href||'')!==href||environment.document?.hidden||!visible(root,environment)||nowCards.length!==cards.length||cards.some((card,index)=>nowCards[index]!==card)||inputs.some(({node,value,checked})=>!node.isConnected||node.value!==value||node.checked!==checked))stop();
    }catch{stop();}
    return !stopped&&!disposed;
  }
  function assert(){if(!current())throw new StaleSourceServiceView();}
  async function assertFresh(){
    assert();let response;
    try{response=await db.auth.getSession();}catch{stop();throw new StaleSourceServiceView();}
    assert();
    if(response?.error||!sameSession(identity,sourceServiceSessionIdentity(response?.data?.session))){stop();throw new StaleSourceServiceView();}
    return true;
  }
  function listen(target,name,handler){target.addEventListener(name,handler,true);cleanups.push(()=>target.removeEventListener(name,handler,true));}
  for(const name of ['popstate','hashchange','pagehide','techcheck:view-changed','techcheck:owner-test-role','cos-private-data-invalidated','cos-workspace-navigation'])listen(environment,name,stop);
  listen(environment.document,'visibilitychange',()=>{if(environment.document.hidden)stop();});
  listen(environment,'message',event=>{if(environment.parent&&environment.parent!==environment&&event.source===environment.parent&&event.origin===environment.location.origin&&event.data?.type==='COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE')stop();});
  if(observeInputs){const changed=event=>{if(root.contains(event.target))stop();};listen(root,'input',changed);listen(root,'change',changed);}
  observer=new environment.MutationObserver(records=>{if(relevant(records))stop();else current();});
  observer.observe(environment.document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','aria-hidden','inert','class','style']});
  const registration=db.auth.onAuthStateChange?.((event,session)=>{
    if(event==='SIGNED_OUT'||!sameSession(identity,sourceServiceSessionIdentity(session)))stop();
  });
  subscription=registration?.data?.subscription||registration?.subscription||null;
  function dispose(){if(disposed)return;disposed=true;observer?.disconnect();subscription?.unsubscribe?.();for(const remove of cleanups)remove();}
  return Object.freeze({actor:identity.actor,sessionId:identity.sessionId,db,view:root,isCurrent:current,assert,assertFresh,dispose,cancel:stop});
}

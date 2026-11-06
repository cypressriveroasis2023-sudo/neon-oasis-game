// Source-only request/view correlation. Server membership and write admission
// remain authoritative; decoding a JWT here does not authenticate its claims.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class StaleSourceITView extends Error {
  constructor(){super('This IT view changed. Reopen the assigned job before continuing.');this.name='StaleSourceITView';}
}
export function sourceITSessionIdentity(session){
  try{
    const actor=session?.user?.id,token=session?.access_token;
    if(!UUID.test(actor||'')||typeof token!=='string'||token.length>16384)return null;
    const parts=token.split('.');
    if(parts.length!==3||parts.some(part=>!part||!/^[A-Za-z0-9_-]+$/.test(part)))return null;
    const text=atob(parts[1].replace(/-/g,'+').replace(/_/g,'/'));
    const claims=JSON.parse(text);
    if(!claims||typeof claims!=='object'||Array.isArray(claims)||claims.sub!==actor||!UUID.test(claims.session_id||''))return null;
    if(session.session_id!=null&&session.session_id!==claims.session_id)return null;
    return Object.freeze({actor,sessionId:claims.session_id});
  }catch{return null;}
}
function sameSession(a,b){return Boolean(a&&b&&a.actor===b.actor&&a.sessionId===b.sessionId);}
function ownIT(context){
  try{
    const session=sourceITSessionIdentity(context?.getSession?.()),profile=context?.getProfile?.(),effective=context?.getEffectiveIdentity?.();
    if(!session||context?.getRole?.()!=='it'||context?.getEffectiveRole?.()!=='it'||profile?.role!=='it'||profile.active!==true||profile.archived_at||profile.user_id!==session.actor||effective?.id!==session.actor||effective.role!=='it'||effective.owner_test)return null;
    return session;
  }catch{return null;}
}
function visible(node,environment){
  if(!node?.isConnected)return false;
  for(let item=node;item;item=item.parentElement){
    if(item.hidden)return false;
    const style=environment.getComputedStyle(item);
    if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse')return false;
  }
  return true;
}
function visibleCards(view,environment){return Array.from(view.children||[]).filter(node=>visible(node,environment));}
function fields(view){return Array.from(view.querySelectorAll('input,textarea,select')).map(node=>({node,value:node.value,checked:node.checked}));}

// Call synchronously before the first await. A cancelled scope never becomes
// valid again, including same-task hide/restore and same-account new login.
export function captureSourceITScope({context,view,getGeneration=()=>0,observeInputs=true,onInvalidate=()=>{},environment=globalThis.window}={}){
  let stopped=false,disposed=false,observer=null,subscription=null;
  const cleanups=[];
  const readContext=typeof context==='function'?context:()=>context;
  const readView=typeof view==='function'?view:()=>view;
  const initialContext=readContext(),db=initialContext?.db,identity=ownIT(initialContext),root=readView();
  if(!identity||!db?.auth?.getSession||!environment?.getComputedStyle||!environment?.MutationObserver||!visible(root,environment))throw new StaleSourceITView();
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
      if(stopped||ctx?.db!==db||!sameSession(identity,ownIT(ctx))||readView()!==root||getGeneration()!==initialGeneration||String(environment.location?.href||'')!==href||!visible(root,environment)||nowCards.length!==cards.length||cards.some((card,index)=>nowCards[index]!==card)||inputs.some(({node,value,checked})=>!node.isConnected||node.value!==value||node.checked!==checked))stop();
    }catch{stop();}
    return !stopped&&!disposed;
  }
  function assert(){if(!current())throw new StaleSourceITView();}
  async function assertFresh(){
    assert();let response;
    try{response=await db.auth.getSession();}catch{stop();throw new StaleSourceITView();}
    assert();
    if(response?.error||!sameSession(identity,sourceITSessionIdentity(response?.data?.session))){stop();throw new StaleSourceITView();}
    return true;
  }
  function listen(target,name,handler){target.addEventListener(name,handler,true);cleanups.push(()=>target.removeEventListener(name,handler,true));}
  for(const name of ['popstate','hashchange','pagehide','techcheck:view-changed','techcheck:hide-private-evidence'])listen(environment,name,stop);
  if(observeInputs){const changed=event=>{if(root.contains(event.target))stop();};listen(root,'input',changed);listen(root,'change',changed);}
  observer=new environment.MutationObserver(records=>{if(relevant(records))stop();else current();});
  observer.observe(environment.document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','class','style']});
  const registration=db.auth.onAuthStateChange?.((event,session)=>{
    if(event==='SIGNED_OUT'||!sameSession(identity,sourceITSessionIdentity(session)))stop();
  });
  subscription=registration?.data?.subscription||registration?.subscription||null;
  function dispose(){if(disposed)return;disposed=true;observer?.disconnect();subscription?.unsubscribe?.();for(const remove of cleanups)remove();}
  return Object.freeze({actor:identity.actor,sessionId:identity.sessionId,db,view:root,isCurrent:current,assert,assertFresh,dispose,cancel:stop});
}

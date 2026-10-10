import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {checkedReconnectStatus,type ReconnectStatus,type ReconnectAttempt} from './mhelpReconnectModel';
const ROOT='/api/mhelpdesk/partner/reconnect';
const valid=(v:string)=>v.length>0&&v.length<=16384&&!/[\s\x00-\x1f\x7f]/.test(v);
export default function MhelpReconnect(){
 const [open,setOpen]=useState(false),[status,setStatus]=useState<ReconnectStatus|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const access=useRef<HTMLInputElement>(null),refresh=useRef<HTMLInputElement>(null),attempt=useRef<ReconnectAttempt|null>(null),pending=useRef(false),generation=useRef(0),request=useRef<AbortController|null>(null);
 const clear=()=>{if(access.current)access.current.value='';if(refresh.current)refresh.current.value='';};
 const close=()=>{request.current?.abort();clear();generation.current++;setOpen(false);setStatus(null);setMessage('');};
 useEffect(()=>{
  const invalidate=()=>{request.current?.abort();clear();generation.current++;setOpen(false);setStatus(null);setMessage('');};
  const hidden=()=>{if(document.hidden)invalidate();};
  const parentHidden=(event:MessageEvent)=>{if(window.parent!==window&&event.source===window.parent&&event.origin===location.origin&&event.data?.type==='COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE')invalidate();};
  window.addEventListener('cos-private-data-invalidated',invalidate);window.addEventListener('cos-workspace-navigation',invalidate);window.addEventListener('hashchange',invalidate);window.addEventListener('popstate',invalidate);window.addEventListener('pagehide',invalidate);window.addEventListener('message',parentHidden);document.addEventListener('visibilitychange',hidden);
  return()=>{request.current?.abort();clear();generation.current++;window.removeEventListener('cos-private-data-invalidated',invalidate);window.removeEventListener('cos-workspace-navigation',invalidate);window.removeEventListener('hashchange',invalidate);window.removeEventListener('popstate',invalidate);window.removeEventListener('pagehide',invalidate);window.removeEventListener('message',parentHidden);document.removeEventListener('visibilitychange',hidden);};
 },[]);
 const check=async()=>{
  if(pending.current)return;pending.current=true;setBusy(true);setOpen(true);setMessage('');clear();const gen=++generation.current,controller=new AbortController();request.current=controller;
  try{
   const prior=attempt.current;
   const response=checkedReconnectStatus((await api.post(ROOT+'/status',prior?{requestId:prior.requestId,expectedRevision:prior.expectedRevision}:{},{signal:controller.signal})).data,prior||undefined);
   if(gen!==generation.current)return;
   setStatus(response);
   if(response.state==='committed'){attempt.current=null;setMessage('Reconnect saved. Renewal and access to the same mHelpDesk portal were verified.');}
   else if(response.state==='pending')setMessage('This reconnect is still in progress. Wait, then check its result.');
   else if(prior){attempt.current=null;setMessage('This attempt has no confirmed saved result. Reopen the form and use a fresh matching pair before trying again.');setStatus(null);}
  }catch{if(gen===generation.current)setMessage('The reconnect result could not be verified. Check the result before trying again.');}
  finally{if(request.current===controller)request.current=null;pending.current=false;setBusy(false);}
 };
 const submit=async(event:React.FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(pending.current||attempt.current||status?.state!=='ready'||!status.portalId||!status.revision)return;
  const accessToken=access.current?.value||'',refreshToken=refresh.current?.value||'';
  if(!valid(accessToken)||!valid(refreshToken)){clear();setMessage('Enter a fresh access token and its matching refresh token. Spaces are not allowed.');return;}
  const next={requestId:crypto.randomUUID(),expectedRevision:status.revision,portalId:status.portalId};attempt.current=next;
  const body={accessToken,refreshToken,expectedRevision:next.expectedRevision,requestId:next.requestId};
  clear();pending.current=true;setBusy(true);setMessage('');setStatus(null);const gen=++generation.current,controller=new AbortController();request.current=controller;
  try{
   const response=checkedReconnectStatus((await api.post(ROOT,body,{signal:controller.signal})).data,next);
   if(response.state!=='committed')throw Error('Unconfirmed');
   if(gen!==generation.current)return;
   attempt.current=null;setStatus(response);setMessage('Reconnect saved. Renewal and access to the same mHelpDesk portal were verified.');
  }catch{if(gen===generation.current)setMessage('Reconnect could not be confirmed. Check its result before trying again.');}
  finally{body.accessToken='';body.refreshToken='';if(request.current===controller)request.current=null;pending.current=false;setBusy(false);}
 };
 return <section aria-label='Secure mHelpDesk reconnect'>
  <button className='secondary' disabled={busy} onClick={()=>void check()}>{attempt.current?'Check reconnect result':'Reconnect mHelpDesk'}</button>
  {open&&<div>
   <h4>Reconnect the existing mHelpDesk account</h4>
   {message&&<p role='status'>{message}</p>}
   {busy&&attempt.current&&<p role='status'>Reconnect is being verified. Closing cancels an unsent request. A submitted request may still finish; check its result before trying again.</p>}
   {status?.state==='unavailable'&&<p>The protected token store is not initialized. Reconnect is unavailable.</p>}
   {status?.state==='ready'&&!attempt.current&&<form onSubmit={event=>void submit(event)} autoComplete='off'>
    <p>Company portal: <strong>{status.portalId}</strong>. Connection revision: {status.revision}.</p>
    <p>Obtain a fresh matching access-token and refresh-token pair yourself from mHelpDesk Developer Access. Keep the existing API Key and Secret unchanged. Never send tokens in chat.</p>
    <p>Submitting replaces the stored pair for this portal and restores persistent API access using the existing client credentials. COS verifies the token renewal before saving. The fields clear when submitted or closed.</p>
    <label>Fresh access token<input ref={access} type='password' autoComplete='off' data-1p-ignore='true' data-lpignore='true' autoCapitalize='none' spellCheck={false} maxLength={16384} required disabled={busy}/></label>
    <label>Matching refresh token<input ref={refresh} type='password' autoComplete='off' data-1p-ignore='true' data-lpignore='true' autoCapitalize='none' spellCheck={false} maxLength={16384} required disabled={busy}/></label>
    <button type='submit' disabled={busy}>Replace pair and verify renewal</button>
   </form>}
   <button className='secondary' type='button' onClick={close}>Close reconnect</button>
  </div>}
 </section>;
}

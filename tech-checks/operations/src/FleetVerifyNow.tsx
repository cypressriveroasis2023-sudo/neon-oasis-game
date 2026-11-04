import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {runFleetVerification,verificationSummaryText,type VerifyProduct,type VerificationRow} from './fleetVerificationRun';
const verifyingProducts=new Set<string>();
export default function FleetVerifyNow({products,onComplete,label='Verify now',disabled=false,onBusyChange}:{products:VerifyProduct[];onComplete:(connections?:unknown)=>Promise<unknown>;label?:string;disabled?:boolean;onBusyChange?:(busy:boolean)=>void}){
 const [busy,setBusy]=useState(false),[phase,setPhase]=useState<'checking'|'reading'>('checking'),[message,setMessage]=useState(''),[results,setResults]=useState<VerificationRow[]>([]);
 const active=useRef<AbortController|null>(null),locked=useRef<string[]>([]);
 const callbacks=useRef({onComplete,onBusyChange});callbacks.current={onComplete,onBusyChange};
 const unlock=()=>{locked.current.forEach(id=>verifyingProducts.delete(id));locked.current=[];};
 // Callback identity changes during a parent readback must not cancel a run.
 useEffect(()=>{
  const clear=()=>{if(active.current){active.current.abort();active.current=null;unlock();callbacks.current.onBusyChange?.(false);}};
  const invalidated=()=>{clear();setBusy(false);setResults([]);setMessage('Your session changed. Reload COS before verifying again.');};
  window.addEventListener('cos-private-data-invalidated',invalidated);
  return()=>{window.removeEventListener('cos-private-data-invalidated',invalidated);clear();};
 },[]);
 const run=async()=>{
  if(active.current||disabled||!products.length)return;
  if(products.some(p=>verifyingProducts.has(p.productId))){setMessage('This equipment is already being verified. Wait for the current check.');return;}
  locked.current=products.map(p=>p.productId);locked.current.forEach(id=>verifyingProducts.add(id));
  const controller=new AbortController(),session=api.captureSession();active.current=controller;setBusy(true);setPhase('checking');callbacks.current.onBusyChange?.(true);setResults([]);setMessage('Checking current tracker IPs and all enabled service ports…');
  const current=()=>active.current===controller&&!controller.signal.aborted&&session();
  try{
   const summary=await runFleetVerification(products,{
    current,
    check:async productIds=>(await api.post<unknown>('/api/product-connections/verify',{productIds},{signal:controller.signal})).data,
    readback:connections=>callbacks.current.onComplete(connections),
    progress:(rows,total,nextPhase)=>{if(current()){setResults(rows);setPhase(nextPhase);setMessage('Processed '+rows.length+' of '+total+'. '+(nextPhase==='reading'?'Updating Fleet from saved evidence…':'Continuing with the remaining units…'));}},
   });
   if(current()&&summary)setMessage(verificationSummaryText(summary));
  }catch(error){if(current())setMessage(error instanceof Error?error.message:'The check could not complete. Refresh saved results before retrying.');}
  finally{if(active.current===controller){active.current=null;unlock();setBusy(false);callbacks.current.onBusyChange?.(false);}}
 };
 return <div className='cos-verify-now'>
  <button type='button' disabled={busy||disabled||!products.length} onClick={()=>void run()}>{busy?(phase==='checking'?'Verifying…':'Updating totals…'):label}</button>
  <div aria-live='polite'>{message&&<p role='status'>{message}</p>}{results.length>0&&<ul>{results.map(r=><li key={r.productId}><strong>{r.name}: {r.outcome==='not_confirmed'?'Check not confirmed':r.status==='unknown'?'Unresolved':r.status==='online'?'Online':'Offline'}</strong><small>{r.reason}</small>{r.checkedAt&&<small>Completed check: {new Date(r.checkedAt).toLocaleString('en-US',{timeZone:'America/Chicago',timeZoneName:'short'})}</small>}{r.status==='unknown'&&r.outcome==='returned'&&<a href={'../../camera-health.html?q='+encodeURIComponent(r.name)}>Review camera setup →</a>}</li>)}</ul>}</div>
 </div>;
}

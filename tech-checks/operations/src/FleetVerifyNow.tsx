import {useEffect,useRef,useState} from 'react';
import {api} from './api';
const verifyingProducts=new Set<string>();
type Product={productId:string;unitNumber:string};
type Result={productId:string;status:'online'|'offline'|'unknown';reason:string;checkedAt:string|null};
export default function FleetVerifyNow({products,onComplete,label='Verify now',disabled=false,onBusyChange}:{products:Product[];onComplete:(connections?:unknown)=>Promise<unknown>;label?:string;disabled?:boolean;onBusyChange?:(busy:boolean)=>void}){
 const [busy,setBusy]=useState(false),[phase,setPhase]=useState('checking'),[message,setMessage]=useState(''),[results,setResults]=useState<(Result&{name:string})[]>([]);
 const active=useRef<AbortController|null>(null),locked=useRef<string[]>([]);
 const unlock=()=>{locked.current.forEach(id=>verifyingProducts.delete(id));locked.current=[];};
 useEffect(()=>()=>{if(active.current){active.current.abort();active.current=null;unlock();onBusyChange?.(false);}},[onBusyChange]);
 const run=async()=>{
  if(active.current||disabled||!products.length)return;
  if(products.some(p=>verifyingProducts.has(p.productId))){setMessage('This equipment is already being verified. Wait for the current check.');return;}
  locked.current=products.map(p=>p.productId);locked.current.forEach(id=>verifyingProducts.add(id));
  const controller=new AbortController(),session=api.captureSession();active.current=controller;setBusy(true);setPhase('checking');onBusyChange?.(true);setResults([]);setMessage('Checking current tracker IPs and all enabled service ports…');
  const current=()=>active.current===controller&&!controller.signal.aborted&&session();
  try{
   const snapshot=[...new Map(products.map(p=>[p.productId,p])).values()],accepted:(Result&{name:string})[]=[];
   let connections:unknown;
   for(let i=0;i<snapshot.length;i+=4){
    const batch=snapshot.slice(i,i+4),response=await api.post<any>('/api/product-connections/verify',{productIds:batch.map(p=>p.productId)},{signal:controller.signal});
    if(!current())return;
    const value=response.data;
    if(value?.contract!=='COS_VERIFY_PRODUCTS_NOW_V1'||!Array.isArray(value.items)||value.items.length!==batch.length||new Set(value.items.map((r:any)=>r.productId)).size!==batch.length||value.items.some((r:any)=>!batch.some(p=>p.productId===r.productId)||!['online','offline','unknown'].includes(r.status)||typeof r.reason!=='string'||r.reason.length>2000||r.status!=='unknown'&&(typeof r.checkedAt!=='string'||!Number.isFinite(Date.parse(r.checkedAt)))))throw Error('The check result could not be confirmed. Refresh saved results before retrying.');
    connections=value.connections;
    accepted.push(...value.items.map((r:Result)=>({...r,name:batch.find(p=>p.productId===r.productId)!.unitNumber})));
    setResults([...accepted]);setMessage('Checked '+accepted.length+' of '+snapshot.length+'. Updating saved fleet totals…');
   }
   setPhase('reading');await onComplete(connections);if(current())setMessage('Verification finished. Fleet totals reloaded from saved evidence. Any unfinished check shows its next step below.');
  }catch(error){if(current()){setMessage(error instanceof Error?error.message:'The check could not complete. Refresh saved results before retrying.');}}
  finally{if(active.current===controller){active.current=null;unlock();setBusy(false);onBusyChange?.(false);}}
 };
 return <div className='cos-verify-now'>
  <button type='button' disabled={busy||disabled||!products.length} onClick={()=>void run()}>{busy?(phase==='checking'?'Verifying…':'Updating totals…'):label}</button>
  <div aria-live='polite'>{message&&<p role='status'>{message}</p>}{results.length>0&&<ul>{results.map(r=><li key={r.productId}><strong>{r.name}: {r.status==='unknown'?'Needs correction':r.status==='online'?'Online':'Offline'}</strong><small>{r.reason}</small>{r.checkedAt&&<small>Completed check: {new Date(r.checkedAt).toLocaleString()}</small>}{r.status==='unknown'&&<a href={'../../camera-health.html?q='+encodeURIComponent(r.name)}>Open camera setup →</a>}</li>)}</ul>}</div>
 </div>;
}

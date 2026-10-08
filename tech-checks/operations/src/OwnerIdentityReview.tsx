import {useEffect,useRef,useState} from 'react';
import {api} from './api';
type Review={contract:string;nativeUnits:{id:string;unitNumber:string}[];rawKeys:string[];confirmations:{id:string;unitId:string;unitNumber:string;unitKey:string;status:string;revision:string;provenance:string}[]};
type Preview={contract:string;unitId:string;unitNumber:string;unitKey:string;deviceIds:string[];reviewToken:string;provenance:string};
/** Existing Owner account only. No label heuristics, provider claims or placement writes. */
export default function OwnerIdentityReview({unitKey,onChanged}:{unitKey:string;onChanged?:()=>void}){
 const [open,setOpen]=useState(false),[data,setData]=useState<Review|null>(null),[unitId,setUnitId]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[message,setMessage]=useState('');
 const generation=useRef(0),pending=useRef(false);
 useEffect(()=>()=>{generation.current++;},[]);
 const load=async()=>{
  if(pending.current)return;
  const version=++generation.current;pending.current=true;setBusy(true);setData(null);setPreview(null);setUnitId('');setConfirmed(false);setReason('');setMessage('Reading current identity commitments…');
  try{const next=(await api.get<Review>('/api/owner-identity/review')).data;if(version!==generation.current)return;if(next.contract!=='COS_OWNER_CONFIRMED_IDENTITY_V1'||!Array.isArray(next.nativeUnits)||!Array.isArray(next.rawKeys)||!Array.isArray(next.confirmations))throw new Error('The identity review response is incomplete.');setData(next);setUncertain(false);setMessage('');}
  catch(e){if(version===generation.current)setMessage(e instanceof Error?e.message:'Identity review unavailable.');}
  finally{pending.current=false;if(version===generation.current)setBusy(false);}
 };
 const run=async(action:'preview'|'confirm'|'revoke',claimId?:string)=>{
  if(pending.current||uncertain||!data)return;
  pending.current=true;setBusy(true);setMessage('Checking current records…');const version=generation.current;let writing=false;
  try{
   if(action==='preview'){
    const result=(await api.post<Preview>('/api/owner-identity/preview',{unitId,unitKey})).data;
    if(version!==generation.current)return;
    if(result.contract!=='COS_OWNER_CONFIRMED_IDENTITY_V1'||result.unitId!==unitId||result.unitKey!==unitKey||result.provenance!=='owner_confirmation'||!Array.isArray(result.deviceIds)||!result.deviceIds.length||!/^[a-f0-9]{64}$/.test(result.reviewToken))throw new Error('Identity preview is incomplete.');
    setPreview(result);setMessage('Review both exact records and every camera resource before confirming.');
   }else{
    if(!reason.trim()||action==='confirm'&&(!preview||!confirmed))throw new Error('Record your reason and confirm the same physical equipment.');
    writing=true;
    if(action==='confirm')await api.post('/api/owner-identity/confirm',{unitId,unitKey,reviewToken:preview!.reviewToken,requestId:crypto.randomUUID(),confirmationText:reason.trim()});
    else {await api.post('/api/owner-identity/revoke',{claimId,expectedRevision:'1',requestId:crypto.randomUUID(),reason:reason.trim()});if(version===generation.current)setData(old=>old?{...old,confirmations:old.confirmations.map(c=>c.id===claimId?{...c,status:'revoked',revision:'2'}:c)}:old);}
    if(version!==generation.current)return;
    setPreview(null);setUncertain(true);setMessage(action==='confirm'?'Owner identity confirmation saved and re-read. Reload saved results before editing field information.':'Identity revoked and re-read. Its resource commitments and audit history remain reserved.');onChanged?.();
   }
  }catch(e){if(version===generation.current){if(writing)setUncertain(true);setMessage((writing?'The outcome needs a fresh read. Do not repeat this request. ':'')+(e instanceof Error?e.message:'Identity review failed.'));}}
  finally{pending.current=false;if(version===generation.current)setBusy(false);}
 };
 const existing=data?.confirmations.filter(c=>c.unitKey===unitKey)||[];
 if(!open)return <button className='secondary' type='button' onClick={()=>{setOpen(true);void load();}}>Review equipment identity</button>;
 return <section className='camera-identity-review' aria-label='Owner equipment identity review'>
  <h4>Owner equipment identity review</h4><p>Camera group: <b>{unitKey}</b>. This records your confirmation of the physical equipment. Provider observations, camera status, installation address and map pin are unchanged.</p>
  <p>Different families, numbers and suffixes remain separate unless you explicitly confirm these exact records.</p>
  {message&&<p role='status'>{message}</p>}
  {data&&!existing.length&&<>
   <label>Exact registered equipment<select aria-label='Exact registered equipment' disabled={busy||uncertain} value={unitId} onChange={e=>{setUnitId(e.target.value);setPreview(null);setConfirmed(false);}}><option value=''>Choose after checking the physical equipment</option>{data.nativeUnits.map(u=><option key={u.id} value={u.id}>{u.unitNumber} · {u.id}</option>)}</select></label>
   <button type='button' disabled={busy||uncertain||!unitId||!data.rawKeys.includes(unitKey)} onClick={()=>void run('preview')}>Review exact association</button>
   {preview&&<><p>Registered equipment: <b>{preview.unitNumber}</b> · {preview.unitId}</p><p>Complete camera resources: {preview.deviceIds.join(', ')}</p><label><input type='checkbox' checked={confirmed} disabled={busy||uncertain} onChange={e=>setConfirmed(e.target.checked)}/> I confirm these exact records identify the same physical equipment.</label></>}
  </>}
  {existing.map(c=><p key={c.id}>Saved Owner confirmation: {c.unitNumber} · {c.unitId} · {c.status}. {c.status==='active'&&<button type='button' disabled={busy||uncertain||!reason.trim()} onClick={()=>void run('revoke',c.id)}>Revoke this identity link</button>}</p>)}
  {data&&<label>How did you verify this, or why are you revoking it?<textarea aria-label='Identity review reason' maxLength={4000} disabled={busy||uncertain} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
  {preview&&<button type='button' disabled={busy||uncertain||!confirmed||!reason.trim()} onClick={()=>void run('confirm')}>Save Owner identity confirmation</button>}
  <button type='button' className='secondary' disabled={busy} onClick={()=>void load()}>Reload identity review</button><button type='button' className='secondary' disabled={busy} onClick={()=>{generation.current++;setOpen(false);setPreview(null);}}>Close identity review</button>
 </section>;
}

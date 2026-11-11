import {useEffect,useRef,useState} from 'react';
import {api} from './api';
// The record a person keeps for one mHelp Product ID. Owner and IT can both
// edit it; every save is stored with who made it, when and why.
type Field='displayName'|'placement'|'customer'|'siteName'|'address'|'deviceLink'|'note';
type Rec=Record<Field,string|null>;
type Saved={contract:'COS_MANUAL_EQUIPMENT_V1';productId:string;revision:number;auditId:string|null;recordedAt:string|null;recordedBy:string|null;recordedByName:string|null;record:Rec;proof:string};
type History={items:{auditId:string;revision:number;actorId:string;actorName:string|null;recordedAt:string;reason:string;before:Rec;after:Rec}[]};
const FIELDS:[Field,string,number][]=[['displayName','Unit name',120],['customer','Customer',200],['siteName','Site',200],['address','Address',400],['deviceLink','Camera device (name or ID in the camera system)',200],['note','Note',1000]];
const LABEL:Record<Field,string>={displayName:'Unit name',placement:'Placement',customer:'Customer',siteName:'Site',address:'Address',deviceLink:'Camera device',note:'Note'};
const blank:Rec={displayName:null,placement:null,customer:null,siteName:null,address:null,deviceLink:null,note:null};
const when=(value:string|null)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'';
const shown=(value:string|null,field:Field)=>value===null?'not set':field==='placement'?(value==='FIELD'?'Field':'Shop'):value;
function checked(value:any,productId:string):Saved{
 const record=value?.record;
 if(value?.contract!=='COS_MANUAL_EQUIPMENT_V1'||value.productId!==productId||!Number.isInteger(value.revision)||typeof value.proof!=='string'||!record||Object.keys(blank).some(key=>!(record[key]===null||typeof record[key]==='string')))throw Error('The saved record could not be verified. Reload it.');
 return value as Saved;
}
const message=(cause:unknown,fallback:string)=>{const data=(cause as any)?.response?.data;return typeof data?.error==='string'&&data.error?data.error:cause instanceof Error&&cause.message?cause.message:fallback;};
const conflict=(cause:unknown)=>(cause as any)?.response?.status===409;

export default function FleetManualRecord({productId,unitName,onSaved}:{productId:string;unitName:string;onSaved?:(value:Saved)=>void}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[saved,setSaved]=useState<Saved|null>(null),[form,setForm]=useState<Rec>(blank),[reason,setReason]=useState('');
 const [error,setError]=useState(''),[stale,setStale]=useState(false),[done,setDone]=useState(''),[history,setHistory]=useState<History|null>(null);
 const alive=useRef(true),pending=useRef(false),attempt=useRef<{key:string;requestId:string}|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const path='/api/fleet/products/'+productId+'/manual-record';
 async function load(keepMessage=false){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');setStale(false);if(!keepMessage)setDone('');
  try{const value=checked((await api.get(path)).data,productId);if(!alive.current)return;setSaved(value);setForm(value.record);setHistory(null);attempt.current=null;}
  catch(cause){if(alive.current)setError(message(cause,'The record could not be loaded.'));}
  finally{pending.current=false;if(alive.current)setBusy(false);}
 }
 const changes=()=>{const next:Partial<Rec>={};if(!saved)return next;for(const key of Object.keys(blank) as Field[]){const value=(form[key]||'').trim()||null;if(value!==saved.record[key])next[key]=value;}return next;};
 const changed=Object.keys(changes()).length>0;
 async function save(){
  if(pending.current||!saved||!changed||!reason.trim())return;
  const body={expected:{productId,revision:saved.revision,auditId:saved.auditId,proof:saved.proof},reason:reason.trim(),changes:changes()};
  // Retrying the very same save reuses its id, so it can never be recorded twice.
  const key=JSON.stringify(body);if(attempt.current?.key!==key)attempt.current={key,requestId:crypto.randomUUID()};
  pending.current=true;setBusy(true);setError('');setDone('');
  try{
   const value=checked((await api.post(path,{...body,requestId:attempt.current.requestId})).data,productId);
   if((value as any).saved!==true)throw Error('The save could not be confirmed. Reload the record.');
   if(!alive.current)return;
   setSaved(value);setForm(value.record);setReason('');setHistory(null);attempt.current=null;
   setDone('Saved'+(value.recordedByName?' by '+value.recordedByName:'')+(value.recordedAt?' · '+when(value.recordedAt):'')+'.'+('placement' in body.changes?' Field and Shop counts update at the next refresh, or press Refresh data.':''));onSaved?.(value);
  }catch(cause){if(alive.current){setStale(conflict(cause));setError(message(cause,'The save could not be confirmed. Reload the record before trying again.'));}}
  finally{pending.current=false;if(alive.current)setBusy(false);}
 }
 async function showHistory(){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');
  try{const value=(await api.get(path+'/history')).data as History;if(!Array.isArray(value?.items))throw Error('The history could not be verified.');if(alive.current)setHistory(value);}
  catch(cause){if(alive.current)setError(message(cause,'The history could not be loaded.'));}
  finally{pending.current=false;if(alive.current)setBusy(false);}
 }
 if(!open)return <button type='button' className='cos-manual-record-open' onClick={()=>{setOpen(true);void load();}}>Edit record</button>;
 return <section className='cos-manual-record' aria-label={'Manual record for '+unitName}>
  <div className='cos-manual-record-title'><h4>Edit {unitName} · Product {productId}</h4><button type='button' aria-label='Close manual record' onClick={()=>setOpen(false)}>×</button></div>
  {saved&&<p className='cos-manual-record-trail'>{saved.revision===0?'No one has edited this record yet. Anything left blank keeps the mHelp value.':'Last changed'+(saved.recordedByName?' by '+saved.recordedByName:'')+' · '+when(saved.recordedAt)+' · change '+saved.revision+'. Anything left blank keeps the mHelp value.'}</p>}
  {busy&&!saved&&<p role='status'>Loading the saved record…</p>}
  {saved&&<form onSubmit={event=>{event.preventDefault();void save();}}>
   <label>Placement<select aria-label='Placement' value={form.placement||''} disabled={busy||stale} onChange={event=>setForm({...form,placement:event.target.value||null})}><option value=''>Not set (use mHelp)</option><option value='FIELD'>Field</option><option value='SHOP'>Shop</option></select></label>
   {FIELDS.map(([key,label,limit])=><label key={key}>{label}<input aria-label={label} maxLength={limit} value={form[key]||''} disabled={busy||stale} onChange={event=>setForm({...form,[key]:event.target.value})}/></label>)}
   <label>Reason for this change<input aria-label='Reason for this change' maxLength={1000} value={reason} disabled={busy||stale} placeholder='Installed today, returned to shop, corrected name…' onChange={event=>setReason(event.target.value)}/></label>
   <div className='cos-manual-record-actions'>
    <button type='submit' className='cos-card-pill' disabled={busy||stale||!changed||!reason.trim()}>{busy?'Working…':'Save record'}</button>
    <button type='button' disabled={busy} onClick={()=>void load()}>{stale?'Reload the record':'Reload'}</button>
    <button type='button' disabled={busy} onClick={()=>void showHistory()}>Show history</button>
   </div>
  </form>}
  {error&&<p role='alert'>{error}{stale?' Your changes were not saved.':''}</p>}
  {done&&<p role='status'><strong>{done}</strong></p>}
  {history&&<div className='cos-manual-record-history' aria-label='Change history'>{history.items.length?<ol>{history.items.map(item=><li key={item.auditId}><strong>{when(item.recordedAt)} · {item.actorName||'Name unavailable'}</strong><small>{item.reason}</small>{(Object.keys(blank) as Field[]).filter(key=>item.before?.[key]!==item.after?.[key]).map(key=><small key={key}>{LABEL[key]}: {shown(item.before?.[key]??null,key)} → {shown(item.after?.[key]??null,key)}</small>)}</li>)}</ol>:<p>No changes have been recorded.</p>}</div>}
 </section>;
}

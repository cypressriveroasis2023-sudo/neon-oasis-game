import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {checkedControl,fields,ownerConnection,validateSettings} from './ownerEquipmentCore';
import './ownerEquipmentEditor.css';
type Props={productId:string;onSaved:()=>void;onBusyChange?:(busy:boolean)=>void};
type Draft={placement:string;customer:string;site:string;address:string;publicIp:string;ports:string;monitoringEnabled:boolean;latitude:string;longitude:string};
const address=(a:any)=>typeof a==='string'?a:[a?.street,a?.city,[a?.state,a?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
const from=(v:any):Draft=>{const s=v.saved?.active?v.saved.settings:{...v.source,address:address(v.source.address),site:'',publicIp:'',ports:[],monitoringEnabled:false,latitude:null,longitude:null};return {...s,customer:s.customer||'',site:s.site||'',ports:(s.ports||[]).join(', '),latitude:s.latitude==null?'':String(s.latitude),longitude:s.longitude==null?'':String(s.longitude)};};
const values=(d:Draft)=>validateSettings({placement:d.placement,customer:d.customer.trim(),site:d.site.trim(),address:d.address.trim(),publicIp:d.publicIp.trim(),ports:d.ports.trim()?d.ports.trim().split(/[\s,]+/).map(Number):[],monitoringEnabled:d.monitoringEnabled,latitude:d.latitude.trim()===''?null:Number(d.latitude),longitude:d.longitude.trim()===''?null:Number(d.longitude)});
const same=(a:any,b:any)=>JSON.stringify(fields.map(k=>a?.[k]))===JSON.stringify(fields.map(k=>b?.[k]));
export default function OwnerEquipmentEditor({productId,onSaved,onBusyChange}:Props){
 const [record,setRecord]=useState<any>(null),[draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[needsRead,setNeedsRead]=useState(false),[invalid,setInvalid]=useState(false);
 const alive=useRef(true),running=useRef(false),controller=useRef<AbortController|null>(null),callbacks=useRef({onSaved,onBusyChange});callbacks.current={onSaved,onBusyChange};
 const path='/api/owner-equipment/'+productId;
 const accept=(v:any)=>{if(v?.contract!=='COS_OWNER_EQUIPMENT_RECORD_V1'||v.source?.productId!==productId||v.saved&&!checkedControl(v.saved,productId))throw Error('The complete saved equipment record could not be verified.');if(alive.current){setRecord(v);setDraft(from(v));setNeedsRead(false);setConfirmed(Boolean(v.saved?.active&&v.saved.settings.publicIp));}return v;};
 const read=async(signal:AbortSignal)=>accept((await api.get(path,{signal})).data);
 const task=async(work:(signal:AbortSignal)=>Promise<void>)=>{
  if(running.current||invalid)return;running.current=true;controller.current=new AbortController();setBusy(true);setError('');setNotice('');callbacks.current.onBusyChange?.(true);
  try{await work(controller.current.signal);}catch(e){if(alive.current)setError(e instanceof Error?e.message:'The operation could not complete.');}
  finally{running.current=false;if(alive.current){setBusy(false);callbacks.current.onBusyChange?.(false);}}
 };
 useEffect(()=>{
  alive.current=true;const c=new AbortController();controller.current=c;
  setBusy(true);running.current=true;
  void read(c.signal).catch(e=>{if(alive.current)setError(e instanceof Error?e.message:'Equipment settings could not load.');}).finally(()=>{running.current=false;if(alive.current)setBusy(false);});
  const revoke=()=>{alive.current=false;c.abort();controller.current?.abort();setInvalid(true);setRecord(null);setDraft(null);setBusy(false);callbacks.current.onBusyChange?.(false);};
  window.addEventListener('cos-private-data-invalidated',revoke);
  return()=>{alive.current=false;c.abort();controller.current?.abort();callbacks.current.onBusyChange?.(false);window.removeEventListener('cos-private-data-invalidated',revoke);};
 },[productId]);
 const check=async(signal:AbortSignal)=>{
  const result=(await api.post(path+'/check',{}, {signal})).data;
  if(result.state==='already_running'){setNotice('A check is already running for this saved target. Reload settings to read its completed result.');return;}
  await read(signal);if(!alive.current)return;callbacks.current.onSaved();
  if(result.checkSaved!==true){setError(result.lastAttempt?.reason||'The check did not complete. Your saved settings and previous completed reading are retained.');return;}
  setNotice('New connection reading saved: '+String(result.lastCompleted?.status||'unknown').toUpperCase()+'.');
 };
 const save=(runCheck:boolean)=>void task(async signal=>{
  if(!draft||!record||needsRead)throw Error('Reload the saved settings before editing again.');
  const settings=values(draft);if(settings.publicIp&&!confirmed)throw Error('Confirm that the IP is assigned to this exact equipment Product ID.');
  if(reason.trim().length<3)throw Error('Enter a brief reason for this correction.');
  if(runCheck&&!settings.monitoringEnabled)throw Error('Enable monitoring before Save and check. Save alone works without a connection.');
  let submitted=false;
  try{
   submitted=true;const result=(await api.post(path,{action:'save',requestId:crypto.randomUUID(),expectedRevision:record.saved?.revision||0,settings,reason:reason.trim(),endpointConfirmed:confirmed},{signal})).data;
   const verified=await read(signal);
   if(!checkedControl(result,productId)||!verified.saved?.active||verified.saved.revision!==result.revision||!same(verified.saved.settings,settings))throw Error('Save may have succeeded, but readback did not match. Reload before saving again.');
   if(!alive.current)return;setReason('');setNotice('Settings saved and read back from COS. mHelp and the 2027 tracker were not changed.');callbacks.current.onSaved();
  }catch(e){if(submitted&&alive.current)setNeedsRead(true);throw e;}
  if(runCheck)await check(signal);
 });
 const release=()=>void task(async signal=>{
  if(!record?.saved||reason.trim().length<3)throw Error('Enter a reason before returning to source settings.');
  try{
   const r=(await api.post(path,{action:'release',requestId:crypto.randomUUID(),expectedRevision:record.saved.revision,settings:{},reason:reason.trim(),endpointConfirmed:false},{signal})).data;
   const v=await read(signal);if(v.saved?.active||v.saved?.revision!==r.revision)throw Error('Release could not be confirmed. Reload before retrying.');
   if(alive.current){setNotice('Owner override released. Existing mHelp/tracker rules are active again; audit history is retained.');setReason('');callbacks.current.onSaved();}
  }catch(e){if(alive.current)setNeedsRead(true);throw e;}
 });
 const change=(key:keyof Draft,value:string|boolean)=>{setDraft(d=>d?{...d,[key]:value}:d);setNotice('');if(key==='publicIp')setConfirmed(false);};
 const saved=record?.saved,observation=ownerConnection(saved),last=saved?.lastCompleted;
 let dirty=true;try{dirty=!draft||!saved?.active||!same(values(draft),saved.settings);}catch{}
 return <section className='cos-owner-equipment-editor' aria-label='Owner equipment settings'>
  <header><div><h3>Owner settings</h3><p>Product ID <strong>{productId}</strong> · {record?.source?.unitNumber||'Equipment'}</p></div><button type='button' disabled={busy||invalid} onClick={()=>void task(async signal=>{await read(signal);})}>Reload settings</button></header>
  <p className='cos-owner-save-scope'><strong>{saved?.active?'Owner override active':'Source settings'}</strong> · These controls save in COS. They do not write to mHelp or the 2027 tracker. Imports cannot silently overwrite an active Owner override.</p>
  {invalid&&<p role='alert'>Your private session changed. Sign in again before editing equipment.</p>}
  {error&&<p className='operations-error' role='alert'>{error}</p>}{notice&&<p className='operations-notice' role='status'>{notice}</p>}
  {!draft&&!invalid&&<p role='status'>{busy?'Reading saved equipment settings…':'Settings unavailable. Reload to retry.'}</p>}
  {draft&&<fieldset disabled={busy||invalid||needsRead}><legend>Equipment setup</legend><div className='cos-owner-setting-grid'>
   <label>Placement<select aria-label='Owner placement' value={draft.placement} onChange={e=>change('placement',e.target.value)}><option value='FIELD'>Field</option><option value='SHOP'>Shop / ROOT</option></select></label>
   <label>Customer<input aria-label='Owner customer' maxLength={250} value={draft.customer} onChange={e=>change('customer',e.target.value)}/></label>
   <label>Site<input aria-label='Owner site' maxLength={250} value={draft.site} onChange={e=>change('site',e.target.value)}/></label>
   <label className='cos-owner-wide'>Service address<input aria-label='Owner service address' maxLength={600} value={draft.address} onChange={e=>change('address',e.target.value)}/></label>
   <label>Public IP<input aria-label='Owner public IP' value={draft.publicIp} maxLength={15} placeholder='Public IPv4 address' onChange={e=>change('publicIp',e.target.value)}/></label>
   <label>Service ports<input aria-label='Owner service ports' value={draft.ports} placeholder='For example: 1400, 1500, 1600, 1700' onChange={e=>change('ports',e.target.value)}/></label>
   <button type='button' className='cos-owner-wide' onClick={()=>void task(async signal=>{const v=(await api.get(path+'/tracker',{signal})).data;if(v.productId!==productId)throw Error('Tracker identity mismatch.');if(!v.publicIp)throw Error('This Product ID has no IP in the current 2027 tracker.');if(alive.current){change('publicIp',v.publicIp);setNotice('Current tracker IP loaded into the form. Review and Save to use it. No check has run.');}})}>Read current 2027 tracker IP</button>
   <label>Latitude (optional)<input aria-label='Owner latitude' inputMode='decimal' value={draft.latitude} onChange={e=>change('latitude',e.target.value)}/></label>
   <label>Longitude (optional)<input aria-label='Owner longitude' inputMode='decimal' value={draft.longitude} onChange={e=>change('longitude',e.target.value)}/></label>
  </div><p>GPS is not required. Optional coordinates are labeled Owner map location, not live GPS.</p>
  <label className='cos-owner-check'><input type='checkbox' checked={draft.monitoringEnabled} onChange={e=>change('monitoringEnabled',e.target.checked)}/>Enable automatic connection checks</label>
  <label className='cos-owner-check'><input type='checkbox' checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I confirm this IP is assigned to Product {productId}. This does not certify every camera or video.</label>
  <label>Correction reason<input aria-label='Owner correction reason' maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} placeholder='What are you correcting?'/></label>
  <div className='cos-owner-actions'><button type='button' onClick={()=>save(false)}>Save settings</button><button type='button' onClick={()=>save(true)}>Save and check</button><button type='button' disabled={!saved?.active||dirty||!saved.settings.monitoringEnabled} onClick={()=>void task(check)}>Check saved target</button>{saved?.active&&<button type='button' onClick={release}>Use source settings again</button>}</div>
  </fieldset>}
  {busy&&<p role='status'>Working on this equipment record…</p>}{needsRead&&<p role='alert'>The last save outcome needs confirmation. Reload settings before another write.</p>}
  {saved&&<section aria-label='Saved Owner connection reading' className='cos-owner-reading'><h4>{saved.active?'Saved connection status':'Historical Owner configuration'}</h4><strong>{saved.active?observation?.status==='unknown'?'UNVERIFIED':String(observation?.status||'unknown').toUpperCase():'Override inactive'}</strong><p>{observation?.reason}</p><p>Settings revision {saved.revision} · connection revision {saved.connectionRevision}</p>{last&&<p>Last completed: <b>{String(last.status).toUpperCase()}</b> · {new Date(last.checkedAt).toLocaleString('en-US',{timeZone:'America/Chicago'})} Central · {last.publicIp} · ports {last.ports?.join(', ')}</p>}{saved.lastAttempt?.state==='failed'&&<p>Latest attempt failed: {saved.lastAttempt.reason}. The previous completed result was not overwritten.</p>}<p>Checks run from the COS cloud. Opening this panel never starts a camera check. Shop equipment remains outside Field outage totals.</p></section>}
 </section>;
}

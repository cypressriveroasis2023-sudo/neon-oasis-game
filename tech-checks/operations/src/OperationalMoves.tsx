import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {api} from './api';
import {checkedMoveCommand,checkedMoveReceipt,checkedOperationalSnapshot} from '../../supabase/functions/cos-operations-pages/operationalMoves';
import './operationalMoves.css';

type Snapshot=ReturnType<typeof checkedOperationalSnapshot>;
type Equipment=Snapshot['items'][number];
type Destination='SHOP'|'FIELD';
const errorMessage=(cause:unknown)=>cause instanceof Error?cause.message:'The placement command is unavailable. No change is confirmed.';
const syncText=(status:string)=>({
 source_recorded:'Recorded source',pending:'Tracker sync pending',published:'Tracker synced',
 conflict:'Tracker conflict — review required',failed:'Tracker retry needed'
} as Record<string,string>)[status]||'Sync status unknown';
const fullAddress=(address:unknown)=>{
 if(!address||typeof address!=='object'||Array.isArray(address))return '';
 const a=address as Record<string,unknown>;
 const parts=[a.street,a.city,a.state,a.zip].filter(v=>typeof v==='string'&&v.trim()) as string[];
 return parts.join(', ');
};
export default function OperationalMoves({canManage,show}:{canManage:boolean;show:(message:string)=>void}){
 const[snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const[query,setQuery]=useState(''),[placeFilter,setPlaceFilter]=useState('ALL'),[selectedId,setSelectedId]=useState('');
 const[editing,setEditing]=useState(false),[customer,setCustomer]=useState(''),[site,setSite]=useState(''),[address,setAddress]=useState('');
 const[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [uncertain,setUncertain]=useState(false);
 const sequence=useRef(0),mounted=useRef(false),pending=useRef<ReturnType<typeof checkedMoveCommand>|null>(null);
 const refresh=useCallback(async()=>{
  if(!canManage)return;
  const request=++sequence.current;setLoading(true);
  try{
   const current=checkedOperationalSnapshot((await api.get('/api/operational-units')).data);
   if(!mounted.current||request!==sequence.current)return;
   setSnapshot(current);setError('');
   setSelectedId(previous=>current.items.some(row=>row.productId===previous)?previous:'');
   return current;
  }catch(cause){
   if(mounted.current&&request===sequence.current)setError('Fast transfer data unavailable: '+errorMessage(cause));
  }finally{if(mounted.current&&request===sequence.current)setLoading(false);}
 },[canManage]);
 useEffect(()=>{mounted.current=true;if(canManage)void refresh();return()=>{mounted.current=false;sequence.current++;};},[canManage,refresh]);
 const filtered=useMemo(()=>{
  const lower=query.trim().toLowerCase();
  return (snapshot?.items||[]).filter(row=>(placeFilter==='ALL'||row.placement===placeFilter)
   &&(!lower||[row.unitNumber,row.productId,row.customer,row.site,row.address].some(v=>v.toLowerCase().includes(lower))));
 },[snapshot,query,placeFilter]);
 const selected=snapshot?.items.find(row=>row.productId===selectedId)||null;
 const choose=(row:Equipment)=>{
  if(busy||uncertain)return;
  setSelectedId(row.productId);setEditing(false);setNotice('');setError('');
  setCustomer(row.placement==='FIELD'?row.customer:'');
  setSite(row.placement==='FIELD'?row.site:'');
  setAddress(row.placement==='FIELD'?row.address:fullAddress(row.sourceAddress));
  pending.current=null;
 };
 const commit=async(destination:Destination)=>{
  if(!selected||!snapshot||busy||loading)return;
  let command:ReturnType<typeof checkedMoveCommand>;
  try{
   const parameters={
    productId:selected.productId,expectedSourceSha256:snapshot.sourceSha256,
    expectedRevision:selected.revision,requestId:pending.current?.requestId||crypto.randomUUID(),
    placement:destination,customer:destination==='FIELD'?customer.trim():'',
    site:destination==='FIELD'?site.trim():'',address:destination==='FIELD'?address.trim():''
   };
   command=checkedMoveCommand(parameters);
  }catch(cause){setError(errorMessage(cause));return;}
  if(pending.current&&JSON.stringify(pending.current)!==JSON.stringify(command)){
   setError('The previous save status is uncertain. Resolve it before changing the request.');return;
  }
  pending.current=command;setBusy(true);setError('');setNotice('');
  try{
   const receipt=checkedMoveReceipt((await api.post('/api/operational-units/move',command)).data,command);
   if(!mounted.current)return;
   setUncertain(false);setEditing(false);pending.current=null;
   setNotice(selected.unitNumber+' moved to '+destination+'. COS confirmed the placement. The 2027 tracker will be verified separately.');
   show(selected.unitNumber+' '+(destination==='SHOP'?'returned to Shop':'deployed to Field')+'. Tracker sync is separate.');
   await refresh();
  }catch(cause){
   if(!mounted.current)return;
   setUncertain(true);
   setError('Save confirmation could not be verified: '+errorMessage(cause)+' The exact move may already be saved. Do not submit another request until checking.');
  }finally{if(mounted.current)setBusy(false);}
 };
 const resolveUncertain=async()=>{
  if(!pending.current||busy)return;
  const old=pending.current;setBusy(true);
  try{
   const current=await refresh();
   if(!mounted.current||!current)return;
   const row=current.items.find(row=>row.productId===old.productId);
   if(!row)throw new Error('The product is no longer in the saved census.');
   if(row.revision===old.expectedRevision+1&&row.placement===old.placement){
    setUncertain(false);setEditing(false);pending.current=null;
    setNotice('The saved placement was verified. Tracker status: '+syncText(row.syncState)+'.');
   }else if(row.revision===old.expectedRevision){
    setUncertain(false);
    setNotice('No completed transfer was found. The exact request may be retried.');
   }else throw new Error('Another placement revision exists. Review the new state before attempting a move.');
  }catch(cause){setError(errorMessage(cause));}finally{if(mounted.current)setBusy(false);}
 };
 if(!canManage)return null;
 return <section className='cos-operational-moves' aria-label='Fast Field and Shop transfers'>
  <div className='cos-operational-moves-head'>
   <div><h3>Move units · Field / Shop</h3><p>Move equipment immediately in COS. Map pins and camera status do not block a transfer.</p></div>
   <button type='button' className='secondary' disabled={busy||loading||uncertain} onClick={()=>void refresh()}>{loading?'Loading…':'Refresh units'}</button>
  </div>
  {notice&&<p className='operations-notice' role='status'>{notice}</p>}
  {error&&<p className='operations-error' role='alert'>{error}</p>}
  {uncertain&&<button type='button' className='secondary' disabled={busy||loading} onClick={()=>void resolveUncertain()}>Verify last move before retry</button>}
  <div className='cos-operational-moves-layout'>
   <div>
    <div className='cos-operational-moves-filters'>
     <label>Search unit or Product ID<input aria-label='Search operational units' value={query} onChange={e=>setQuery(e.target.value)} placeholder='Ranger 028, Product ID…'/></label>
     <label>Location<select aria-label='Operational location filter' value={placeFilter} onChange={e=>setPlaceFilter(e.target.value)}>
      <option value='ALL'>All locations</option><option value='FIELD'>Field</option><option value='SHOP'>root:shop</option>
     </select></label>
    </div>
    <p className='cos-operational-moves-meta'>{loading?'Loading saved COS equipment…':snapshot?filtered.length+' matching equipment · '+snapshot.items.length+' saved Product IDs':'No live transfer data available'}</p>
    <div className='cos-operational-moves-list' role='list'>
     {filtered.slice(0,80).map(row=><button type='button' role='listitem' key={row.productId} className={'cos-operational-move-unit'+(selectedId===row.productId?' selected':'')} disabled={busy||uncertain} onClick={()=>choose(row)}>
      <span><strong>{row.unitNumber}</strong><small>Product {row.productId} · {row.customer}</small></span>
      <span><b>{row.placement==='SHOP'?'SHOP':'FIELD'}</b><small>{syncText(row.syncState)}</small></span>
     </button>)}
     {filtered.length>80&&<p className='cos-operational-moves-meta'>Showing first 80 matches. Search to select another unit.</p>}
    </div>
   </div>
   <div className='cos-operational-moves-detail'>
    {!selected?<p>Select a unit to move it between the Field and root:shop.</p>:<>
     <h4>{selected.unitNumber}</h4>
     <p>mHelp Product ID: {selected.productId} · Currently {selected.placement==='SHOP'?'root:shop':'in the Field'}</p>
     <dl><div><dt>Customer</dt><dd>{selected.customer||'Not specified'}</dd></div><div><dt>Site</dt><dd>{selected.site||'Not specified'}</dd></div><div><dt>Address</dt><dd>{selected.address||'No active address recorded'}</dd></div><div><dt>2027 Tracker</dt><dd>{syncText(selected.syncState)}</dd></div></dl>
     {selected.lifecycle!=='UNFLAGGED'?<p role='alert'>Transfer held: {selected.lifecycle.replaceAll('_',' ')} equipment requires lifecycle review.</p>:<>
      <div className='cos-operational-moves-actions'>
       <button type='button' disabled={busy||loading||uncertain||selected.placement==='SHOP'} onClick={()=>void commit('SHOP')}>{busy?'Saving…':'Move to root:shop'}</button>
       <button type='button' className='secondary' disabled={busy||loading||uncertain} onClick={()=>{setEditing(true);setError('');}}>Deploy / change Field site</button>
      </div>
      {editing&&<form className='cos-operational-deploy-form' onSubmit={e=>{e.preventDefault();void commit('FIELD');}}>
       <label>Customer name<input required maxLength={250} value={customer} onChange={e=>setCustomer(e.target.value)} placeholder='Choose customer'/></label>
       <label>Site / project<input required maxLength={250} value={site} onChange={e=>setSite(e.target.value)} placeholder='Site or job name'/></label>
       <label>Full physical address<input required maxLength={600} value={address} onChange={e=>setAddress(e.target.value)} placeholder='Street, city, state, ZIP'/></label>
       <p>Field activation saves the address now. The map pin is added independently; actual camera connectivity remains separate.</p>
       <div className='cos-operational-moves-actions'><button type='submit' disabled={busy||loading||uncertain}>{busy?'Deploying…':'Activate in Field'}</button><button type='button' className='secondary' disabled={busy} onClick={()=>setEditing(false)}>Cancel</button></div>
      </form>}
     </>}
    </>}
   </div>
  </div>
 </section>;
}

import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from './api';
import './directoryWorkspace.css';
import {DirectorySaveError,equipmentSnapshot,equipmentStatuses,saveDirectory,searchRecords} from './directoryData.js';
import type {Row} from './directoryData.js';
const message=(cause:unknown)=>cause instanceof Error?cause.message:'Equipment registry could not be loaded.';
export default function EquipmentWorkspace({show}:{show:(message:string)=>void}) {
  const[data,setData]=useState<{items:Row[];models:Row[]}|null>(null),[form,setForm]=useState<Row|null>(null);
  const[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[query,setQuery]=useState('');
  const[error,setError]=useState(''),[saveError,setSaveError]=useState(''),[uncertain,setUncertain]=useState(false);
  const revision=useRef(0);
  const load=useCallback(async()=>{
    const request=++revision.current;setLoading(true);
    try{const next=equipmentSnapshot((await api.get('/api/equipment')).data);if(request!==revision.current)return;setData(next);setError('');return next;}
    catch(cause){if(request===revision.current)setError(message(cause));}
    finally{if(request===revision.current)setLoading(false);}
  },[]);
  useEffect(()=>{void load();return()=>{revision.current+=1;};},[load]);
  const edit=(value:Row)=>{setForm({...value});setSaveError('');setUncertain(false);};
  const reload=async()=>{const next=await load();if(next&&uncertain){setForm(null);setSaveError('');setUncertain(false);show('Fresh records loaded. Review the saved unit before making another change.');}};
  const save=async()=>{
    if(!form||busy||uncertain)return;const request=revision.current;setBusy(true);setSaveError('');
    try{const result=await saveDirectory(api,'Equipment',form);if(request!==revision.current)return;setData(equipmentSnapshot(result.data));setForm(null);show('Equipment unit saved and verified.');}
    catch(cause){if(request!==revision.current)return;setSaveError(message(cause));setUncertain(cause instanceof DirectorySaveError&&cause.phase==='uncertain');}
    finally{if(request===revision.current)setBusy(false);}
  };
  const set=(key:string,value:string)=>setForm(current=>current?{...current,[key]:value}:current);
  const filtered=searchRecords(data?.items||[],query,['unitNumber','serialNumber','modelName','modelCode','status','activeJobNumber','installedSite','customer']);
  return <section className='panel module operations-equipment' aria-label='Equipment Workspace'>
    <div className='panelhead'><h2>Live Equipment Operations</h2><span>COS production registry</span></div>
    <div className='purchase-actions'>
      <button disabled={busy||!data||uncertain} onClick={()=>edit({modelId:'',unitNumber:'',serialNumber:'',status:'available',currentLocationType:'shop'})}>+ ADD EQUIPMENT UNIT</button>
      <button className='secondary' disabled={loading||busy} onClick={()=>void reload()}>{loading?'REFRESHING…':'REFRESH RECORDS'}</button>
      <input aria-label='Search equipment' value={query} onChange={event=>setQuery(event.target.value)} placeholder='Search unit, model, serial, job, site…'/>
      {data&&<span>{data.items.length} production units</span>}
    </div>
    {error&&<div className='operations-error' role='alert'>{error}{data&&<p>Showing the last successful registry.</p>}</div>}
    {saveError&&!form&&<div className='operations-error' role='alert'>{saveError}</div>}
    {!data&&!error&&<div className='loading' role='status'>Loading production equipment registry…</div>}
    {form&&<section className='quote-card directory-editor' aria-label={(form.id?'Edit':'Add')+' Equipment Unit'}>
      <div className='quote-section-head'><div><h3>{form.id?'Edit':'Add'} Equipment Unit</h3><small>Owner registry controls for the COS production inventory.</small></div><div className='purchase-actions'><button className='secondary' disabled={busy} onClick={()=>{setForm(null);if(!uncertain)setSaveError('');}}>Cancel</button><button disabled={busy||uncertain} onClick={()=>void save()}>{busy?'SAVING…':'SAVE UNIT'}</button></div></div>
      {saveError&&<div className='operations-error' role='alert'>{saveError}</div>}
      <fieldset disabled={busy||uncertain} style={{border:0,padding:0,margin:0,minWidth:0}}><div className='quote-detail-grid'>
        <label>Model *<select value={form.modelId||''} onChange={event=>set('modelId',event.target.value)}><option value=''>Select model</option>{data?.models.map(model=><option key={model.id} value={model.id}>{model.name}{model.code?' · '+model.code:''}</option>)}</select></label>
        <label>Unit Number *<input value={form.unitNumber||''} onChange={event=>set('unitNumber',event.target.value)}/></label>
        <label>Serial Number<input value={form.serialNumber||''} onChange={event=>set('serialNumber',event.target.value)}/></label>
        <label>Status<select value={form.status||''} onChange={event=>set('status',event.target.value)}><option value=''>Select status</option>{equipmentStatuses.map(status=><option key={status} value={status}>{status.replaceAll('_',' ')}</option>)}</select></label>
        <label>Location Type<input value={form.currentLocationType||''} onChange={event=>set('currentLocationType',event.target.value)} placeholder='shop / field / truck'/></label>
      </div></fieldset>
    </section>}
    {data&&<div className='records'>{filtered.length?filtered.map(unit=><div className='record op-record' key={unit.id}>
      <div><strong>{unit.modelName} · {unit.unitNumber}</strong><small>{[unit.serialNumber&&'Serial '+unit.serialNumber,unit.status,unit.currentLocationType,unit.activeJobNumber&&'Job '+unit.activeJobNumber,unit.installedSite,unit.customer].filter(Boolean).join(' · ')}</small></div>
      <div className='row-actions'><em>{String(unit.status||'').replaceAll('_',' ')}</em><button className='secondary' disabled={busy||uncertain} onClick={()=>edit(unit)}>Edit</button></div>
    </div>):<div className='loading'>No equipment units match this view.</div>}</div>}
  </section>;
}

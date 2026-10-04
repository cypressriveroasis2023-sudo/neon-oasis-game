import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from './api';
import './directoryWorkspace.css';
import {DirectorySaveError,definition,records,saveDirectory,searchRecords} from './directoryData.js';
import type {Row} from './directoryData.js';

type Kind='Customers'|'Sites';
const errorText=(cause:unknown,fallback:string)=>cause instanceof Error?cause.message:fallback;
const fresh=(kind:Kind):Row=>kind==='Customers'
  ?{name:'',legalName:'',notes:'',status:'active'}
  :{customerId:'',name:'',addressLine1:'',addressLine2:'',city:'',stateRegion:'TX',postalCode:'',country:'US',accessInstructions:'',parkingInstructions:'',safetyNotes:'',operationalNotes:'',status:'active'};

export default function DirectoryWorkspace({kind,show}:{kind:Kind;show:(message:string)=>void}) {
  const[rows,setRows]=useState<Row[]|null>(null),[customers,setCustomers]=useState<Row[]>([]);
  const[form,setForm]=useState<Row|null>(null),[query,setQuery]=useState(''),[loading,setLoading]=useState(true);
  const[busy,setBusy]=useState(false),[error,setError]=useState(''),[saveError,setSaveError]=useState(''),[uncertain,setUncertain]=useState(false);
  const revision=useRef(0);
  const load=useCallback(async()=>{
    const request=++revision.current;setLoading(true);
    try {
      const result=await api.get(definition(kind).endpoint);
      const next=records(result.data,kind);
      const people=kind==='Sites'?records((await api.get('/api/customers')).data,'Customers'):[];
      if(request!==revision.current)return;
      setRows(next);setCustomers(people);setError('');return next;
    }catch(cause){if(request===revision.current)setError(errorText(cause,kind+' could not be loaded.'));}
    finally{if(request===revision.current)setLoading(false);}
  },[kind]);
  useEffect(()=>{setRows(null);setCustomers([]);setForm(null);setQuery('');setBusy(false);setSaveError('');setUncertain(false);void load();return()=>{revision.current+=1;};},[load]);
  const edit=(row:Row)=>{setForm({...row});setSaveError('');setUncertain(false);};
  const reload=async()=>{const next=await load();if(next&&uncertain){setForm(null);setSaveError('');setUncertain(false);show('Fresh records loaded. Review the saved record before making another change.');}};
  const save=async()=>{
    if(!form||busy||uncertain)return;
    const request=revision.current;setBusy(true);setSaveError('');
    try{
      const result=await saveDirectory(api,kind,form);
      if(request!==revision.current)return;
      setRows(records(result.data,kind));setForm(null);
      show(definition(kind).title+' saved and verified.');
    }catch(cause){
      if(request!==revision.current)return;
      setSaveError(errorText(cause,'The save could not be confirmed.'));
      setUncertain(cause instanceof DirectorySaveError&&cause.phase==='uncertain');
    }finally{if(request===revision.current)setBusy(false);}
  };
  const filtered=searchRecords(rows||[],query,kind==='Customers'
    ?['name','legalName','customerNumber','notes','status']
    :['name','customer','siteNumber','addressLine1','addressLine2','city','stateRegion','postalCode','status','accessInstructions','parkingInstructions','safetyNotes']);
  const set=(key:string,value:string)=>setForm(current=>current?{...current,[key]:value}:current);
  const field=(key:string,label:string,large=false)=>large
    ?<label className='wide' key={key}>{label}<textarea value={form?.[key]||''} onChange={event=>set(key,event.target.value)}/></label>
    :<label key={key}>{label}<input value={form?.[key]||''} onChange={event=>set(key,event.target.value)}/></label>;
  return <section className='panel module operations-directory' aria-label={kind+' Workspace'}>
    <div className='panelhead'><h2>{kind} Workspace</h2><span>Live operational data</span></div>
    <div className='purchase-actions'>
      <button disabled={busy||!rows||uncertain} onClick={()=>edit(fresh(kind))}>+ NEW {kind.slice(0,-1).toUpperCase()}</button>
      <button className='secondary' disabled={loading||busy} onClick={()=>void reload()}>{loading?'REFRESHING…':'REFRESH RECORDS'}</button>
      <input aria-label={'Search '+kind.toLowerCase()} value={query} onChange={event=>setQuery(event.target.value)} placeholder={kind==='Customers'?'Search customer, legal name, notes…':'Search customer, site, location, instructions…'}/>
      {rows&&<span>{rows.length} production record{rows.length===1?'':'s'}</span>}
    </div>
    {error&&<div className='operations-error' role='alert'>{error}{rows&&<p>Showing the last successful records.</p>}</div>}
    {saveError&&!form&&<div className='operations-error' role='alert'>{saveError}</div>}
    {!rows&&!error&&<div className='loading' role='status'>Loading live {kind.toLowerCase()}…</div>}
    {form&&<section className='quote-card directory-editor' aria-label={(form.id?'Edit ':'New ')+kind.slice(0,-1)}>
      <div className='quote-section-head'>
        <div><h3>{form.id?'Edit':'New'} {kind.slice(0,-1)}</h3><small>Changes save to the COS production database.</small></div>
        <div className='purchase-actions'><button className='secondary' disabled={busy} onClick={()=>{setForm(null);if(!uncertain)setSaveError('');}}>Cancel</button><button disabled={busy||uncertain} onClick={()=>void save()}>{busy?'SAVING…':'SAVE'}</button></div>
      </div>
      {saveError&&<div className='operations-error' role='alert'>{saveError}</div>}
      <fieldset disabled={busy||uncertain} style={{border:0,padding:0,margin:0,minWidth:0}}>
        {kind==='Customers'?<div className='quote-detail-grid'>
          {field('name','Customer Name *')}{field('legalName','Legal Name')}
          <label>Status<select value={form.status||'active'} onChange={event=>set('status',event.target.value)}><option value='active'>Active</option><option value='inactive'>Inactive</option></select></label>
          {field('notes','Notes',true)}
        </div>:<div className='crm-form-section'>
          <h4>Customer & Site</h4><div className='quote-detail-grid'>
            <label>Customer *<select value={form.customerId||''} onChange={event=>set('customerId',event.target.value)}><option value=''>Select customer</option>{customers.map(customer=><option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
            {field('name','Site Name *')}
            <label>Status<select value={form.status||'active'} onChange={event=>set('status',event.target.value)}><option value='active'>Active</option><option value='inactive'>Inactive</option></select></label>
          </div>
          <h4>Location</h4><div className='quote-detail-grid'>{[['addressLine1','Address'],['addressLine2','Address 2'],['city','City'],['stateRegion','State'],['postalCode','ZIP'],['country','Country']].map(([key,label])=>field(key,label))}</div>
          <h4>Technician Instructions</h4><div className='quote-detail-grid'>{[['accessInstructions','Access Instructions'],['parkingInstructions','Parking Instructions'],['safetyNotes','Safety Notes'],['operationalNotes','Operational Notes']].map(([key,label])=>field(key,label,true))}</div>
        </div>}
      </fieldset>
    </section>}
    {rows&&<div className='records'>{filtered.length?filtered.map(row=><div className='record op-record' key={row.id}>
      <div><strong>{row.name}</strong><small>{kind==='Customers'
        ?[row.customerNumber,Number.isFinite(row.siteCount)?row.siteCount+' sites':null,Number.isFinite(row.jobCount)?row.jobCount+' jobs':null,Number.isFinite(row.quoteCount)?row.quoteCount+' quotes':null].filter(Boolean).join(' · ')
        :['Customer: '+(row.customer||'Unassigned'),'Site: '+row.name,'Location: '+([row.addressLine1,row.addressLine2,row.city,row.stateRegion,row.postalCode].filter(Boolean).join(', ')||'No address'),Number.isFinite(row.jobCount)?row.jobCount+' jobs':null].filter(Boolean).join(' · ')}</small>
        {kind==='Sites'&&(row.accessInstructions||row.parkingInstructions||row.safetyNotes)&&<div className='audit-mini'>{row.accessInstructions&&<span>Access: {row.accessInstructions}</span>}{row.parkingInstructions&&<span>Parking: {row.parkingInstructions}</span>}{row.safetyNotes&&<span>Safety: {row.safetyNotes}</span>}</div>}
      </div>
      <div className='row-actions'><em>{String(row.status||'record').replaceAll('_',' ')}</em><button className='secondary' disabled={busy||uncertain} onClick={()=>edit(row)}>Edit</button></div>
    </div>):<div className='loading'>{query?'No '+kind.toLowerCase()+' match this view.':'No '+kind.toLowerCase()+' records yet.'}</div>}</div>}
  </section>;
}

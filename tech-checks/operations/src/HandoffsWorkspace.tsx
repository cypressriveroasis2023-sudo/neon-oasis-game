import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { recordItems, type OperationsRecord } from './operationsWorkflowData';
import { boardDateLabel } from './dailyBoardData';
import './operationsWorkflows.css';
export default function HandoffsWorkspace({show}:{show:(message:string)=>void}) {
  const [rows,setRows]=useState<OperationsRecord[]|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const revision=useRef(0);
  const refresh=useCallback(async()=>{
    const request=++revision.current;setLoading(true);
    try{
      const items=recordItems((await api.get('/api/handoffs')).data);
      if(items.some(row=>typeof row.jobId!=='string'||typeof row.toVisitId!=='string'))throw new Error('Handoffs returned incomplete routing records.');
      if(request===revision.current){setRows(items);setError('');}
    }catch(cause){if(request===revision.current){const message=cause instanceof Error?cause.message:'Handoffs could not be loaded.';setError(message);show(message);}}
    finally{if(request===revision.current)setLoading(false);}
  },[show]);
  useEffect(()=>{void refresh();const updated=()=>void refresh();window.addEventListener('cos-board-updated',updated);return()=>{revision.current+=1;window.removeEventListener('cos-board-updated',updated);};},[refresh]);
  return <div className='ops-workflows' aria-label='Department Handoffs' aria-busy={loading}>
    <div className='purchase-actions'><span>{rows?rows.length+' native department handoffs':'Handoff counts unavailable'}</span><button className='secondary' disabled={loading} onClick={()=>void refresh()}>{loading?'Refreshing…':'Refresh handoffs'}</button></div>
    {error&&<div className='daily-board-error' role='alert'>{error}{rows&&<p>Showing the last successful routing records.</p>}</div>}
    {!rows&&!error?<div className='loading' role='status'>Loading native department handoffs…</div>:<div className='records'>{(rows||[]).map(handoff=><div className='record op-record' key={handoff.jobId+'-'+handoff.toVisitId}><div><strong>{handoff.jobNumber} · {handoff.customer}</strong><small>{handoff.site} · {handoff.jobType} · {handoff.equipmentUnitTag||'Equipment unit not set'}</small><div className='audit-mini'><span>FROM: {String(handoff.fromDepartment||'').toUpperCase()} · {handoff.fromTechnician||'Completed technician'} · {String(handoff.fromVisitType||'').replaceAll('_',' ')}</span><span>TO: {String(handoff.toDepartment||'').toUpperCase()} · {handoff.toTechnician||'Unassigned'} · {String(handoff.toVisitType||'').replaceAll('_',' ')}</span><span>{handoff.scheduledStart?'Scheduled '+boardDateLabel(handoff.scheduledStart):'Ready for Operations scheduling and assignment'}</span></div></div><em>{handoff.status}</em></div>)}{rows?.length===0&&<div className='loading'>No department handoffs are currently waiting for the next COS stage.</div>}</div>}
  </div>;
}

import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {checkedMhelpTicketPreview,ticketPreviewGaps,type MhelpTicketPreview as Preview} from './mhelpTicketPreviewModel';
import {mhelpTicketPreviewErrorMessage} from './mhelpTicketPreviewError';

const chicagoTime=(value:string)=>new Date(value).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
/** Rendered only inside the existing Owner mHelpDesk review. No request runs on mount. */
export default function MhelpTicketPreview(){
  const [preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [day,setDay]=useState<'today'|'previous'>('today');
  const active=useRef(true),pending=useRef(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const run=async(requestedDay:'today'|'previous')=>{
    if(pending.current)return;
    pending.current=true;setBusy(true);setDay(requestedDay);setError('');setPreview(null);
    try{
      // Existing api.post obtains the signed-in parent session. Server selects a fixed Chicago day.
      const result=checkedMhelpTicketPreview((await api.post('/api/mhelpdesk/partner/tickets/preview',requestedDay==='previous'?{day:'previous'}:{})).data);
      if(active.current)setPreview(result);
    }catch(cause){
      if(active.current)setError(mhelpTicketPreviewErrorMessage(cause));
    }finally{pending.current=false;if(active.current)setBusy(false);}
  };
  const gaps=preview?ticketPreviewGaps(preview):[];
  return <section className='unit-tracker-source' aria-label='mHelpDesk ticket type preview' aria-busy={busy}>
    <h4>mHelpDesk ticket types</h4>
    <p>Read today’s or the previous day’s ticket counts and type IDs in Central Time. This is a read-only preview. This preview does not change tickets or assignments.</p>
    <button className='secondary' disabled={busy} onClick={()=>void run('today')}>{busy&&day==='today'?'Reading today’s ticket types…':'Preview today’s ticket types'}</button>
    <button className='secondary' disabled={busy} onClick={()=>void run('previous')}>{busy&&day==='previous'?'Reading previous day’s ticket types…':'Preview previous day’s ticket types'}</button>
    <p>The previous-day preview reads the prior Central Time calendar day for review. It does not import historical tickets.</p>
    {error&&<p className='operations-error' role='alert'>{error}</p>}
    {preview&&<>
      <p role='status'><strong>{preview.previewCount} tickets</strong> read from verified mHelpDesk portal {preview.verifiedPortalId}.</p>
      <p>Preview: {day==='previous'?'previous day':'today'} (Central Time).</p>
      <p>Creation window: after {chicagoTime(preview.window.createdAfter)} and before {chicagoTime(preview.window.createdBefore)}. Read {chicagoTime(preview.readAt)}.</p>
      <p>{preview.metrics.assignedTickets} with a recorded assignee · {preview.metrics.missingAssignmentFields} with assignment unknown · {preview.metrics.deletedTickets} marked deleted in mHelpDesk.</p>
      {preview.types.length>0?<div className='unit-tracker-table-wrap'><table className='unit-tracker-table'><caption>Verified mHelpDesk type IDs and counts</caption><thead><tr><th scope='col'>mHelpDesk type</th><th scope='col'>Tickets in window</th></tr></thead><tbody>{preview.types.map(type=><tr key={type.typeId}><td>{type.typeName}<small>Type ID {type.typeId} · {type.isActive?'Active':'Inactive'}</small></td><td>{type.count}</td></tr>)}</tbody></table></div>:<p>No ticket types were returned.</p>}
      {gaps.length>0?<><h4>Fields needing review</h4><ul>{gaps.map(gap=><li key={gap}>{gap}</li>)}</ul></>:<p>No missing or unrecognized fields were flagged by this preview.</p>}
      <p>Workflow routing uses separately reviewed type and technician mappings. Check Automatic ticket intake for saved configuration and polling status.</p>
    </>}
  </section>;
}

import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {checkedMhelpTicketPreview,ticketPreviewGaps,type MhelpTicketPreview as Preview} from './mhelpTicketPreviewModel';
import {mhelpTicketPreviewErrorMessage} from './mhelpTicketPreviewError';

const chicagoTime=(value:string)=>new Date(value).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
/** Rendered only inside the existing Owner mHelpDesk review. No request runs on mount. */
export default function MhelpTicketPreview(){
  const [preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const active=useRef(true),pending=useRef(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const run=async()=>{
    if(pending.current)return;
    pending.current=true;setBusy(true);setError('');setPreview(null);
    try{
      // Existing api.post obtains the signed-in parent session. Server selects today's Chicago window.
      const result=checkedMhelpTicketPreview((await api.post('/api/mhelpdesk/partner/tickets/preview',{})).data);
      if(active.current)setPreview(result);
    }catch(cause){
      if(active.current)setError(mhelpTicketPreviewErrorMessage(cause));
    }finally{pending.current=false;if(active.current)setBusy(false);}
  };
  const gaps=preview?ticketPreviewGaps(preview):[];
  return <section className='unit-tracker-source' aria-label='mHelpDesk ticket type preview' aria-busy={busy}>
    <h4>Today’s mHelpDesk tickets</h4>
    <p>Read today’s ticket counts and type IDs in Central Time. Automatic intake is paused. This preview does not change tickets or assignments.</p>
    <button className='secondary' disabled={busy} onClick={()=>void run()}>{busy?'Reading today’s ticket types…':'Preview today’s ticket types'}</button>
    {error&&<p className='operations-error' role='alert'>{error}</p>}
    {preview&&<>
      <p role='status'><strong>{preview.previewCount} tickets</strong> read from verified mHelpDesk portal {preview.verifiedPortalId}.</p>
      <p>Creation window: after {chicagoTime(preview.window.createdAfter)} and before {chicagoTime(preview.window.createdBefore)}. Read {chicagoTime(preview.readAt)}.</p>
      <p>{preview.metrics.assignedTickets} with a recorded assignee · {preview.metrics.missingAssignmentFields} with assignment unknown · {preview.metrics.deletedTickets} marked deleted in mHelpDesk.</p>
      {preview.types.length>0?<div className='unit-tracker-table-wrap'><table className='unit-tracker-table'><caption>Verified mHelpDesk type IDs and counts</caption><thead><tr><th>mHelpDesk type</th><th>Tickets today</th></tr></thead><tbody>{preview.types.map(type=><tr key={type.typeId}><td>{type.typeName}<small>Type ID {type.typeId} · {type.isActive?'Active':'Inactive'}</small></td><td>{type.count}</td></tr>)}</tbody></table></div>:<p>No ticket types were returned.</p>}
      {gaps.length>0?<><h4>Fields needing review</h4><ul>{gaps.map(gap=><li key={gap}>{gap}</li>)}</ul></>:<p>No missing or unrecognized fields were flagged by this preview.</p>}
      <p>These type IDs still need a reviewed Service, Install, Swap or Pickup mapping before intake can be enabled.</p>
    </>}
  </section>;
}

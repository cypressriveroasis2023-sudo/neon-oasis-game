import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {checkedMhelpTicketPreview,ticketPreviewGaps,ticketEvidenceKinds,ticketEvidenceFormats,ticketEvidenceFields,ticketItemEvidenceFields,ticketCustomEvidenceFields,type TicketFieldEvidence,type TicketCollectionEvidence,type TicketOperationalEvidence,type MhelpTicketPreview as Preview} from './mhelpTicketPreviewModel';
import {mhelpTicketPreviewErrorMessage} from './mhelpTicketPreviewError';

const chicagoTime=(value:string)=>new Date(value).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
const formatLabels:Record<typeof ticketEvidenceFormats[number],string>={numeric:'Numeric string',iso_with_zone:'ISO with timezone',iso_without_zone:'ISO without timezone',dotnet:'.NET date string',other:'Other string'};
function kindSummary(kinds:TicketFieldEvidence['kinds']){
  return ticketEvidenceKinds.filter(key=>kinds[key]).map(key=>`${key}: ${kinds[key]}`).join(' · ')||'No observations';
}
function EvidenceFields<K extends string>({caption,fields,keys}:{caption:string;fields:Record<K,TicketFieldEvidence>;keys:readonly K[]}){
  return <div className='unit-tracker-table-wrap'><table className='unit-tracker-table'><caption>{caption}</caption><thead><tr><th scope='col'>Source field</th><th scope='col'>Observed kinds</th><th scope='col'>String availability</th><th scope='col'>String formats</th></tr></thead><tbody>{keys.map(key=>{
    const field=fields[key];
    return <tr key={key}><td>{key}{(key==='scheduledDate'||key==='neededBy')&&<small>Deprecated source field</small>}</td><td>{kindSummary(field.kinds)}</td><td>{field.nonemptyStrings} nonempty · {field.emptyStrings} empty</td><td>{ticketEvidenceFormats.filter(format=>field.formats[format]).map(format=>`${formatLabels[format]}: ${field.formats[format]}`).join(' · ')||'No string observations'}</td></tr>;
  })}</tbody></table></div>;
}
function CollectionEvidence<K extends string>({name,collection,keys}:{name:string;collection:TicketCollectionEvidence<K>;keys:readonly K[]}){
  return <section aria-label={`${name} structural evidence`}>
    <h4>{name}</h4>
    <p>Collection kinds across sampled tickets: {kindSummary(collection.kinds)}.</p>
    <p>{collection.emptyArrays} empty arrays · {collection.nonemptyArrays} nonempty arrays · {collection.totalEntries} array entries within sampled tickets · {collection.sampledEntries} nested entries sampled.</p>
    <p>Nested entry kinds: {kindSummary(collection.entryKinds)}. Field counts below cover only those {collection.sampledEntries} sampled entries.</p>
    {collection.sampledEntries===0&&<p>No nested entries were available to inspect in this sample.</p>}
    <EvidenceFields caption={`${name} sampled nested field shapes`} fields={collection.fields} keys={keys}/>
  </section>;
}
function OperationalEvidence({evidence}:{evidence:TicketOperationalEvidence|undefined}){
  return <section aria-label='mHelpDesk operational structural evidence'>
    <h4>Operational field evidence</h4>
    {evidence?<>
      <p>Structural evidence from the first at most 50 already-read tickets: {evidence.sampledTickets} tickets sampled. At most 50 nested entries per collection are sampled across those tickets.</p>
      <p>Array totals cover only sampled tickets. They do not prove total-window coverage. Absent, null, empty and nonempty observations stay separate. Field content availability means only nonempty-string structural evidence; no ticket text or nested values are displayed.</p>
      {evidence.sampledTickets===0&&<p>No tickets were available in this window. The empty sample provides no operational field evidence.</p>}
      <p>{evidence.siteIdTickets} sampled tickets have a service-location ID. Native site linkage remains unverified.</p>
      <EvidenceFields caption='Sampled ticket field shapes' fields={evidence.fields} keys={ticketEvidenceFields}/>
      <p>scheduledDate and neededBy are deprecated in the documented model. These source shapes do not establish a verified schedule or readiness.</p>
      <CollectionEvidence name='Items' collection={evidence.collections.items} keys={ticketItemEvidenceFields}/>
      <p>Documented items have no equipmentId field. A priceListId is not an equipment ID; equipment linkage remains unverified.</p>
      <CollectionEvidence name='Custom fields' collection={evidence.collections.customFields} keys={ticketCustomEvidenceFields}/>
    </>:<p>Operational field evidence is unavailable in this response. Ticket counts and dictionaries remain available; work-text availability, schedule, readiness, site and equipment linkage are unverified.</p>}
  </section>;
}
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
      const result=checkedMhelpTicketPreview((await api.post('/api/mhelpdesk/partner/tickets/preview',{evidence:'operational_structure_v1',...(requestedDay==='previous'?{day:'previous'}:{})})).data);
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
      <h4>mHelpDesk status dictionary</h4>
      {preview.statuses.length>0?<div className='unit-tracker-table-wrap'><table className='unit-tracker-table'><caption>Verified mHelpDesk statuses and counts</caption><thead><tr><th scope='col'>Status ID</th><th scope='col'>Status text</th><th scope='col'>Display text</th><th scope='col'>Parent ID</th><th scope='col'>Can be parent</th><th scope='col'>Ordinary status count</th><th scope='col'>Custom status count</th></tr></thead><tbody>{preview.statuses.map(status=><tr key={status.statusId}><td>{status.statusId}</td><td>{status.statusText}</td><td>{status.displayText}</td><td>{status.parentId??'None'}</td><td>{status.canBeParent?'Yes':'No'}</td><td>{status.statusCount}</td><td>{status.customStatusCount}</td></tr>)}</tbody></table></div>:<p>No status dictionary entries were returned.</p>}
      <p>Status labels and parent relationships are source dictionary evidence; they do not establish COS workflow meaning or readiness.</p>
      <OperationalEvidence evidence={preview.operationalEvidence}/>
      {gaps.length>0?<><h4>Fields needing review</h4><ul>{gaps.map(gap=><li key={gap}>{gap}</li>)}</ul></>:<p>No missing or unrecognized fields were flagged by this preview.</p>}
      <p>Workflow routing uses separately reviewed type and technician mappings. Check Automatic ticket intake for saved configuration and polling status.</p>
    </>}
  </section>;
}

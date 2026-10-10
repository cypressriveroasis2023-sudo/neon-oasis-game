import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import type {MhelpReadGuard} from './mhelpReadGuard';
import {checkedMhelpTicketPreview,ticketPreviewGaps,ticketDetailEvidenceFields,ticketDetailItemEvidenceFields,ticketDetailCustomEvidenceFields,type TicketDetailEvidence,ticketEvidenceKinds,ticketEvidenceFormats,ticketEvidenceFields,ticketItemEvidenceFields,ticketCustomEvidenceFields,type TicketFieldEvidence,type TicketCollectionEvidence,type TicketOperationalEvidence,type MhelpTicketPreview as Preview} from './mhelpTicketPreviewModel';
import {ticketAppointmentEvidenceFields,ticketAppointmentReviewKeys,type TicketAppointmentEvidence} from './mhelpAppointmentPreviewModel';
import {ticketAppointmentVariantCapability as ticketAppointmentEvidenceCapability,ticketAppointmentVariantFields,ticketAppointmentEnvelopeKeys,ticketAppointmentUserFields,ticketAppointmentUserReferenceFormats,ticketAppointmentCandidatePairFields,type TicketAppointmentVariantEvidence,type TicketAppointmentVariantDiagnostics} from './mhelpAppointmentVariantPreviewModel';
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
    <p>Nested entry kinds: {kindSummary(collection.entryKinds)}.{keys.length>0&&<> Field counts below cover only those {collection.sampledEntries} sampled entries.</>}</p>
    {collection.sampledEntries===0&&<p>No nested entries were available to inspect in this sample.</p>}
    {keys.length>0&&<EvidenceFields caption={`${name} sampled nested field shapes`} fields={collection.fields} keys={keys}/>}
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
export function MhelpTicketDetailEvidence({evidence}:{evidence:TicketDetailEvidence|undefined}){
  return <section aria-label='mHelpDesk single-ticket detail structural evidence'>
    <h4>Single-ticket detail evidence</h4>
    {!evidence?<p>Single-ticket detail evidence is unavailable in this response. No detail read is established by these ticket counts or list-field shapes.</p>:evidence.state==='selection_unavailable'?<p>{evidence.reason==='empty_window'?'No tickets were found in the selected window.':'More than one ticket was found in the selected window.'} A unique ticket could not be selected. No ticket detail was read.</p>:<>
      <p>One server-selected ticket detail was read from the same creation window. Only fixed field shapes and counts are shown. No ticket identifiers, text, contact details, billing values or nested values are displayed in this evidence.</p>
      <p>{evidence.availability.description==='nonempty_text_present'?'Nonempty text is present in at least one of subject, summary or comment.':'No nonempty text was found in subject, summary or comment.'} This is structural availability only; the work description is not displayed or interpreted.</p>
      <p>Site remains unresolved because no site join was performed. Schedule remains unverified: scheduledDate and neededBy are deprecated GET fields. These observations do not establish readiness or workflow routing.</p>
      <EvidenceFields caption='Single-ticket detail field shapes' fields={evidence.fields} keys={ticketDetailEvidenceFields}/>
      <p>Nested evidence covers at most 50 entries per collection from this one detail only. Collection totals do not establish equipment identity, assignment, or mapped operational meaning.</p>
      <CollectionEvidence name='Detail items' collection={evidence.collections.items} keys={ticketDetailItemEvidenceFields}/>
      <CollectionEvidence name='Detail custom fields' collection={evidence.collections.customFields} keys={ticketDetailCustomEvidenceFields}/>
      <CollectionEvidence name='Detail equipment candidate' collection={evidence.collections.equipment} keys={[] as const}/>
      <p>Equipment is only a POST/PUT write-model candidate; a GET equipment contract has not been verified. Only collection and entry counts are shown, with no equipment fields or linkage claims. Items and custom fields remain unmapped structures.</p>
    </>}
  </section>;
}
const appointmentReviewLabels:Record<typeof ticketAppointmentReviewKeys[number],string>={deleted:'Deleted ticket or appointment',hidden:'Hidden appointment',team:'Team assignment needing review',recurrence:'Recurrence needing review',missingFlags:'Missing deletion or visibility flags',missingUser:'Missing or unsupported user reference',invalidTime:'Unverified time or all-day state',invalidIdentity:'Unverified appointment identity'};
const userReferenceFormatLabels:Record<typeof ticketAppointmentUserReferenceFormats[number],string>={numeric:'Numeric string',uuid_like:'UUID-like string',email_like:'Email-like string',other:'Other string'};
function MhelpAppointmentVariantDiagnostics({diagnostics,rootKind}:{diagnostics:TicketAppointmentVariantDiagnostics;rootKind:string}){
  return <section aria-label='mHelpDesk appointment field-variant diagnostics'>
    <h4>Appointment field-variant diagnostics</h4>
    <p>The appointment field-name and envelope contract remains unresolved. Each fixed spelling is inspected separately; similar names are not verified aliases. These diagnostics do not establish appointment existence, absence, schedule, technician identity, or a source-to-COS mapping.</p>
    <p>Root kind: {rootKind}. Inspected row kinds: {kindSummary(diagnostics.rowKinds)}. Empty object rows: {diagnostics.emptyObjectRows}. Root array entries: {diagnostics.rootArrayEntries===null?'not an array':diagnostics.rootArrayEntries}.</p>
    <p>Suppressed envelope keys: {diagnostics.suppressedEnvelopeKeys} · Suppressed row-key occurrences: {diagnostics.suppressedRowKeys}. Unknown names and all source values are withheld.</p>
    <div className='unit-tracker-table-wrap'><table className='unit-tracker-table'><caption>Fixed appointment envelope descriptors</caption><thead><tr><th scope='col'>Fixed envelope field</th><th scope='col'>Observed kind</th><th scope='col'>Bounded integer count</th><th scope='col'>Array entries</th></tr></thead><tbody>{ticketAppointmentEnvelopeKeys.map(key=>{const descriptor=diagnostics.envelope[key];return <tr key={key}><td>{key}</td><td>{descriptor.kind}</td><td>{descriptor.integerCount===null?'Unavailable':descriptor.integerCount}</td><td>{descriptor.arrayEntries===null?'Not inspected':descriptor.arrayEntries}</td></tr>;})}</tbody></table></div>
    <p>Only the results array contributes inspected appointment rows. Alternate envelope collections are counted only; their entries are not inspected or substituted.</p>
    <EvidenceFields caption='Inspected appointment field-variant shapes' fields={diagnostics.fields} keys={ticketAppointmentVariantFields}/>
    <div className='unit-tracker-table-wrap'><table className='unit-tracker-table'><caption>Fixed appointment user-reference string formats</caption><thead><tr><th scope='col'>Fixed source field</th><th scope='col'>Observed string formats</th></tr></thead><tbody>{ticketAppointmentUserFields.map(key=><tr key={key}><td>{key}</td><td>{ticketAppointmentUserReferenceFormats.filter(format=>diagnostics.userReferenceFormats[key][format]).map(format=>`${userReferenceFormatLabels[format]}: ${diagnostics.userReferenceFormats[key][format]}`).join(' · ')||'No string observations'}</td></tr>)}</tbody></table></div>
    <p>User-reference formats describe string shapes only. No source reference, email address, or verified identity mapping is shown.</p>
    <div className='unit-tracker-table-wrap'><table className='unit-tracker-table'><caption>Fixed appointment ticket-and-portal candidate comparisons</caption><thead><tr><th scope='col'>Fixed ticket field</th><th scope='col'>Fixed portal field</th><th scope='col'>Comparable integer pairs</th><th scope='col'>Equal to selected ticket and portal</th></tr></thead><tbody>{ticketAppointmentCandidatePairFields.map((pair,index)=><tr key={`${pair.ticket}-${pair.portal}`}><td>{pair.ticket}</td><td>{pair.portal}</td><td>{diagnostics.candidatePairs.comparable[index]}</td><td>{diagnostics.candidatePairs.matching[index]}</td></tr>)}</tbody></table></div>
    <p>Conflicting ticket-ID spellings: {diagnostics.candidatePairs.ticketAliasConflicts} rows · Conflicting portal-ID spellings: {diagnostics.candidatePairs.portalAliasConflicts} rows.</p>
    <p>These are unverified candidate comparisons using positive integers only, with no conversion from strings. Equality does not verify field meaning, appointment linkage, schedule, or identity. Variant spellings are not used for matching in the documented-field summary.</p>
  </section>;
}
export function MhelpAppointmentEvidence({evidence}:{evidence:TicketAppointmentEvidence|TicketAppointmentVariantEvidence|undefined}){
  return <section aria-label='mHelpDesk appointment structural evidence'>
    <h4>Appointment evidence</h4>
    {!evidence?<p>Appointment evidence is unavailable in this response. No appointment read is established; schedule and technician assignment remain unverified.</p>:<>
      <p>Server-defined scheduled period: {chicagoTime(evidence.window.startDateUtc)} to {chicagoTime(evidence.window.endDateUtc)} (end excluded). {evidence.window.calendarDays} calendar days in {evidence.window.timeZone}, beginning at the selected creation-day midnight.</p>
      {evidence.state==='selection_unavailable'?<p>{evidence.reason==='empty_window'?'No tickets were found in the creation window.':'More than one ticket was found in the creation window.'} A unique ticket could not be selected. No appointments were read.</p>:<>
        <p>One bounded appointment-list read inspected this scheduled period for the same server-selected ticket. {evidence.sampledAppointments} appointment rows inspected; reported total: {evidence.reportedTotal===null?'unverified':evidence.reportedTotal}. Page limit: {evidence.pageLimit}. Field counts cover all inspected rows in this period.</p>
        <p>{evidence.completeness==='complete'?'The reported count matches the inspected rows.':evidence.completeness==='incomplete'?'The appointment page is incomplete. Additional rows were not fetched; linkage remains unverified.':'The appointment envelope is unverified; complete coverage cannot be established.'}</p>
        <p>{evidence.contract==='cos-mhelpdesk-appointment-evidence-v2'&&<>Documented TicketId/PortalId spellings only: </>}{evidence.exactMatchCount} exact structural ticket-and-portal matches · {evidence.unverifiedLinkageCount} rows with unverified linkage.</p>
        <p>{evidence.linkage==='single_structural_match'?'One structural match was found. The candidate appointment contract still does not verify an operational schedule or technician assignment.':evidence.linkage==='no_match_in_window'?'No match was found within this inspected schedule window. An appointment may exist outside this period; the ticket’s scheduling status remains unverified.':evidence.linkage==='ambiguous_matches'?'Multiple structural matches were found. The appointment is ambiguous; scheduling and assignment remain unverified.':evidence.linkage==='review_required'?'The structural match requires review. Deleted, hidden, team, recurring or incomplete appointment details cannot establish scheduling or assignment.':'Ticket-to-appointment linkage remains unverified. This response cannot establish scheduling or assignment.'}</p>
        {ticketAppointmentReviewKeys.some(key=>evidence.reviewCounts[key]>0)&&<ul aria-label='Appointment review reasons'>{ticketAppointmentReviewKeys.filter(key=>evidence.reviewCounts[key]>0).map(key=><li key={key}>{appointmentReviewLabels[key]}: {evidence.reviewCounts[key]}</li>)}</ul>}
        <EvidenceFields caption='Inspected appointment field shapes' fields={evidence.fields} keys={ticketAppointmentEvidenceFields}/>
        {evidence.contract==='cos-mhelpdesk-appointment-evidence-v2'&&<MhelpAppointmentVariantDiagnostics diagnostics={evidence.diagnostics} rootKind={evidence.envelope.rootKind}/>}
        <p>Only fixed shapes and counts are shown. No appointment date values, technician identities, ticket text or source values are displayed. No staff lookup was performed; the technician remains unresolved.</p>
      </>}
      <p>These observations do not establish work-order readiness or workflow routing. Site and technician mappings still need separate verification.</p>
    </>}
  </section>;
}
/** Rendered only inside the existing Owner mHelpDesk review. No request runs on mount. */
export default function MhelpTicketPreview({disabled=false,readGuard}:{disabled?:boolean;readGuard?:MhelpReadGuard}={}){
  const [preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [day,setDay]=useState<'today'|'previous'>('today');
  const active=useRef(true),pending=useRef(false),sequence=useRef(0);
  useEffect(()=>{active.current=true;return()=>{active.current=false;sequence.current++;};},[]);
  const run=async(requestedDay:'today'|'previous')=>{
    if(pending.current||disabled)return;
    const lease=readGuard?.acquire();if(readGuard&&lease===null)return;
    pending.current=true;const request=++sequence.current;setBusy(true);setDay(requestedDay);setError('');setPreview(null);
    try{
      // Existing api.post obtains the signed-in parent session. Server selects a fixed Chicago day.
      const result=checkedMhelpTicketPreview((await api.post('/api/mhelpdesk/partner/tickets/preview',{evidence:ticketAppointmentEvidenceCapability,...(requestedDay==='previous'?{day:'previous'}:{})})).data);
      if(active.current&&request===sequence.current)setPreview(result);
    }catch(cause){
      if(active.current&&request===sequence.current)setError(mhelpTicketPreviewErrorMessage(cause));
    }finally{if(lease)readGuard?.release(lease);if(request===sequence.current){pending.current=false;if(active.current)setBusy(false);}}
  };
  const gaps=preview?ticketPreviewGaps(preview):[];
  return <section className='unit-tracker-source' aria-label='mHelpDesk ticket type preview' aria-busy={busy}>
    <h4>mHelpDesk ticket types</h4>
    <p>Read today’s or the previous day’s ticket counts and type IDs in Central Time. This is a read-only preview. This preview does not change tickets or assignments.</p>
    <p>Each explicit preview allows at most one additional ticket detail read, only when exactly one ticket is found. The server selects that ticket from the same window. It may then inspect one seven-calendar-day scheduled period for that same server-selected ticket, beginning at the selected creation-day midnight in America/Chicago. No appointments are read for empty or multiple-ticket windows. You cannot enter dates, filters or URLs, and you cannot enter or select a ticket ID. No detail is read automatically.</p>
    <p>The preview also counts fixed appointment field-name variants and envelope shapes. Unknown field names and all source values are withheld; similar spellings do not verify mappings.</p>
    <p>A work-order shell does not require equipment or a Ticket Lead. Technicians choose the unit later; ticket notes hold the work instructions. Scheduling and source-to-COS mappings remain unverified by this preview.</p>
    <button className='secondary' disabled={busy||disabled} onClick={()=>void run('today')}>{busy&&day==='today'?'Reading today’s ticket types…':'Preview today’s ticket types'}</button>
    <button className='secondary' disabled={busy||disabled} onClick={()=>void run('previous')}>{busy&&day==='previous'?'Reading previous day’s ticket types…':'Preview previous day’s ticket types'}</button>
    <p>The previous-day preview reads the prior Central Time calendar day for review. It does not import historical tickets.</p>
    {error&&<p className='operations-error' role='alert'>{error}</p>}
    {preview&&<>
      <p role='status'><strong>{preview.previewCount} ticket{preview.previewCount===1?'':'s'}</strong> read from verified mHelpDesk portal {preview.verifiedPortalId}.</p>
      <p>Preview: {day==='previous'?'previous day':'today'} (Central Time).</p>
      <p>Creation window: after {chicagoTime(preview.window.createdAfter)} and before {chicagoTime(preview.window.createdBefore)}. Read {chicagoTime(preview.readAt)}.</p>
      <p>{preview.metrics.assignedTickets} with a recorded assignee · {preview.metrics.missingAssignmentFields} with assignment unknown · {preview.metrics.deletedTickets} marked deleted in mHelpDesk.</p>
      {preview.types.length>0?<div className='unit-tracker-table-wrap'><table className='unit-tracker-table'><caption>Verified mHelpDesk type IDs and counts</caption><thead><tr><th scope='col'>mHelpDesk type</th><th scope='col'>Tickets in window</th></tr></thead><tbody>{preview.types.map(type=><tr key={type.typeId}><td>{type.typeName}<small>Type ID {type.typeId} · {type.isActive?'Active':'Inactive'}</small></td><td>{type.count}</td></tr>)}</tbody></table></div>:<p>No ticket types were returned.</p>}
      <h4>mHelpDesk status dictionary</h4>
      {preview.statuses.length>0?<div className='unit-tracker-table-wrap'><table className='unit-tracker-table'><caption>Verified mHelpDesk statuses and counts</caption><thead><tr><th scope='col'>Status ID</th><th scope='col'>Status text</th><th scope='col'>Display text</th><th scope='col'>Parent ID</th><th scope='col'>Can be parent</th><th scope='col'>Ordinary status count</th><th scope='col'>Custom status count</th></tr></thead><tbody>{preview.statuses.map(status=><tr key={status.statusId}><td>{status.statusId}</td><td>{status.statusText}</td><td>{status.displayText}</td><td>{status.parentId??'None'}</td><td>{status.canBeParent?'Yes':'No'}</td><td>{status.statusCount}</td><td>{status.customStatusCount}</td></tr>)}</tbody></table></div>:<p>No status dictionary entries were returned.</p>}
      <p>Status labels and parent relationships are source dictionary evidence; they do not establish COS workflow meaning or readiness.</p>
      <OperationalEvidence evidence={preview.operationalEvidence}/>
      <MhelpTicketDetailEvidence evidence={preview.detailEvidence}/>
      <MhelpAppointmentEvidence evidence={preview.appointmentEvidence}/>
      {gaps.length>0?<><h4>Fields needing review</h4><ul>{gaps.map(gap=><li key={gap}>{gap}</li>)}</ul></>:<p>No missing or unrecognized fields were flagged by this preview.</p>}
      <p>Workflow routing uses separately reviewed type and technician mappings. Check Automatic ticket intake for saved configuration and polling status.</p>
    </>}
  </section>;
}

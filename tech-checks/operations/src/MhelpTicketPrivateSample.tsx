import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from './api';
import type {MhelpReadGuard} from './mhelpReadGuard';
import {ticketAppointmentCandidatePairFields,ticketAppointmentUserFields,ticketAppointmentUserReferenceFormats} from './mhelpAppointmentVariantPreviewModel';
import {mhelpTicketPreviewErrorMessage} from './mhelpTicketPreviewError';
import {checkedMhelpTicketPrivateSample,checkedPrivateSampleRequest,privateSampleDateRange,privateSampleItemFields,privateSampleAppointmentFields,privateSampleStructureFields,privateSampleEnvelopeKeys,type PrivateSampleCell,type TicketPrivateSample} from './mhelpTicketPrivateSampleModel';
const labels:Record<typeof privateSampleItemFields[number],string>={name:'Recorded item name',Name:'Recorded Name (casing candidate)',description:'Recorded item description',Description:'Recorded Description (casing candidate)',notes:'Recorded item notes',Notes:'Recorded Notes (casing candidate)',quantity:'Recorded quantity (unclassified)',Quantity:'Recorded Quantity (casing candidate, unclassified)',durationSeconds:'Recorded durationSeconds (unclassified)',DurationSeconds:'Recorded DurationSeconds (casing candidate, unclassified)'};
function Cell({cell}:{cell:PrivateSampleCell}){
 return cell.state==='value'?<><span className='mhelp-private-literal'>{cell.value}</span><small className='mhelp-private-kind'>Recorded {typeof cell.value}</small></>:<span>{cell.state==='absent'?'Absent':cell.state==='null'?'Null':cell.state==='suppressed'?'Withheld by safety checks':'Unsupported source value'}</span>;
}
export function PrivateSampleResult({sample}:{sample:TicketPrivateSample}){
 return <section aria-label='Private ticket inspection result'>
  <p>Ticket number {sample.request.ticketNumber} · Appointment day {sample.request.appointmentDay} in America/Chicago. This is a read-only inspection. Schema, staff identity and source-to-COS mapping remain unverified.</p>
  <p>Source text and recorded quantities are shown literally. A quantity or duration is not a count of physical units. No staff row, schedule, equipment assignment or work instruction is selected or rewritten.</p>
  {sample.state==='selection_unavailable'?<p role='status'>{sample.reason==='ticket_not_found'?'No matching ticket number was found in this bounded appointment-day page.':sample.reason==='ambiguous_ticket_number'?'More than one ticket has the requested number in this appointment-day page.':'The appointment-day ticket page is incomplete or unsupported.'} No ticket detail or appointments were read. Page limit: {sample.selection.pageLimit}; inspected tickets: {sample.selection.sampledTickets}; reported total: {sample.selection.reportedTotal}; matching ticket numbers: {sample.selection.matchingTickets}. This does not establish whether the ticket or an appointment exists outside this inspected source window.</p>:<>
   <p>Verified source selection: portal {sample.selected.portalId}, ticket ID {sample.selected.ticketId}, ticket number {sample.selected.ticketNumber}. Source selection does not verify a native COS mapping.</p>
   <h5>Operational item values</h5>
   <p>Item collection: {sample.items.state}. {sample.items.totalEntries===null?'Entry count unavailable.':`${sample.items.totalEntries} recorded entries.`} {sample.items.truncated?'Only the first 50 entries are shown.':''} Mixed equipment, services, plans and time entries stay unclassified.</p>
   {sample.items.rows.map(row=><section key={row.index} aria-label={`Recorded item ${row.index+1}`}><h6>Recorded item {row.index+1}</h6><dl>{privateSampleItemFields.map(key=><div key={key}><dt>{labels[key]}</dt><dd><Cell cell={row.fields[key]}/></dd></div>)}</dl></section>)}
   <h5>Strictly matching appointment values</h5>
   <p>{sample.appointments.sampledAppointments} appointment rows inspected · {sample.appointments.matchingAppointments} strict ticket-and-portal candidates · {sample.appointments.suppressedAppointments} rows withheld. Coverage: {sample.appointments.completeness}. {sample.appointments.truncated?'Only the first 50 matching candidates are shown.':''}</p>
   <p>Only rows with matching positive-integer ticket and portal references and no conflicting identity spellings can show values. Similar field spellings remain separate and unverified. Recorded times and text may disagree; no value is chosen as authoritative. No Staff lookup was performed.</p>
   {sample.appointments.rows.length===0&&<p>No appointment values qualified for this private view. An appointment may still exist; no scheduling conclusion can be drawn.</p>}
   {sample.appointments.rows.map(row=><section key={row.index} aria-label={`Appointment source row ${row.index+1}`}><h6>Appointment source row {row.index+1}</h6><dl>{privateSampleAppointmentFields.map(key=><div key={key}><dt>{key}</dt><dd><Cell cell={row.fields[key]}/></dd></div>)}</dl></section>)}
   <details><summary>All-row structural descriptors</summary>
    <p>These fixed shapes include unmatched rows without exposing their values.</p>
    <p>Root kind: {sample.appointments.structure.rootKind}. Root array entries: {sample.appointments.structure.rootArrayEntries??'not an array'}. Row kinds: {Object.entries(sample.appointments.structure.rowKinds).map(([kind,n])=>`${kind}: ${n}`).join(' · ')||'No observations'}. Empty object rows: {sample.appointments.structure.emptyObjectRows}.</p>
    <div className='unit-tracker-table-wrap'><table className='unit-tracker-table'><caption>Private sample fixed envelope descriptors</caption><thead><tr><th>Fixed field</th><th>Kind</th><th>Count</th><th>Array entries</th></tr></thead><tbody>{privateSampleEnvelopeKeys.map(key=>{const descriptor=sample.appointments.structure.envelope[key];return <tr key={key}><td>{key}</td><td>{descriptor.kind}</td><td>{descriptor.integerCount??'Unavailable'}</td><td>{descriptor.arrayEntries??'Not inspected'}</td></tr>;})}</tbody></table></div>
    <div className='unit-tracker-table-wrap'><table className='unit-tracker-table'><caption>Private sample appointment field shapes</caption><thead><tr><th>Fixed field</th><th>Observed kinds</th><th>String counts</th><th>String formats</th></tr></thead><tbody>{privateSampleStructureFields.map(key=>{const field=sample.appointments.structure.fields[key];return <tr key={key}><td>{key}</td><td>{Object.entries(field.kinds).map(([kind,n])=>`${kind}: ${n}`).join(' · ')||'No observations'}</td><td>{field.nonemptyStrings} nonempty · {field.emptyStrings} empty</td><td>{Object.entries(field.formats).map(([format,n])=>`${format}: ${n}`).join(' · ')||'No string observations'}</td></tr>;})}</tbody></table></div>
    <div className='unit-tracker-table-wrap'><table className='unit-tracker-table'><caption>Private sample candidate identity comparisons</caption><thead><tr><th>Ticket field</th><th>Portal field</th><th>Comparable</th><th>Exact selected pair</th></tr></thead><tbody>{ticketAppointmentCandidatePairFields.map(({ticket,portal},i)=><tr key={`${ticket}-${portal}`}><td>{ticket}</td><td>{portal}</td><td>{sample.appointments.structure.candidatePairs.comparable[i]}</td><td>{sample.appointments.structure.candidatePairs.matching[i]}</td></tr>)}</tbody></table></div>
    <p>Conflicting ticket spellings: {sample.appointments.structure.candidatePairs.ticketAliasConflicts}; portal spellings: {sample.appointments.structure.candidatePairs.portalAliasConflicts}; appointment identities: {sample.appointments.structure.aliasConflicts.identity}; user references: {sample.appointments.structure.aliasConflicts.user}; starts: {sample.appointments.structure.aliasConflicts.start}; ends: {sample.appointments.structure.aliasConflicts.end}. These counts do not verify a mapping.</p>
    <ul aria-label='Private sample user-reference formats'>{ticketAppointmentUserFields.map(key=><li key={key}>{key}: {ticketAppointmentUserReferenceFormats.filter(format=>sample.appointments.structure.userReferenceFormats[key][format]).map(format=>`${format}: ${sample.appointments.structure.userReferenceFormats[key][format]}`).join(' · ')||'No string observations'}</li>)}</ul>
    <p>Suppressed envelope keys: {sample.appointments.structure.suppressedEnvelopeKeys}. Suppressed row-key occurrences: {sample.appointments.structure.suppressedRowKeys}. Unknown names and source values are withheld.</p>
   </details>
  </>}
  <p>Nothing was imported, assigned, completed or sent back to mHelpDesk. Billing, customer/contact objects, attachments and arbitrary custom fields are excluded.</p>
 </section>;
}
/** Private operational values live only in this component and clear on every boundary. */
export default function MhelpTicketPrivateSample({disabled=false,readGuard}:{disabled?:boolean;readGuard?:MhelpReadGuard}={}){
 const [open,setOpen]=useState(false),[ticketNumber,setTicketNumber]=useState(''),[appointmentDay,setAppointmentDay]=useState('');
 const [sample,setSample]=useState<TicketPrivateSample|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const active=useRef(true),sequence=useRef(0),pending=useRef(false),controller=useRef<AbortController|null>(null),lease=useRef<symbol|null>(null);
 const clear=useCallback((close=false)=>{sequence.current++;controller.current?.abort();controller.current=null;pending.current=false;if(lease.current)readGuard?.release(lease.current);lease.current=null;setBusy(false);setSample(null);setError('');if(close){setOpen(false);setTicketNumber('');setAppointmentDay('');}},[readGuard]);
 useEffect(()=>{
  active.current=true;
  const navigate=()=>clear(true),authChanged=()=>{clear(true);setError('Your Owner session could not be verified. Return to Tech Check and sign in again.');},hidden=()=>{if(document.visibilityState==='hidden')clear(true);};
  const parentHidden=(event:MessageEvent)=>{if(window.parent!==window&&event.source===window.parent&&event.origin===location.origin&&event.data?.type==='COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE')clear(true);};
  window.addEventListener('cos-private-data-invalidated',authChanged);window.addEventListener('cos-workspace-navigation',navigate);window.addEventListener('hashchange',navigate);window.addEventListener('popstate',navigate);window.addEventListener('pagehide',navigate);window.addEventListener('message',parentHidden);document.addEventListener('visibilitychange',hidden);
  return()=>{active.current=false;sequence.current++;controller.current?.abort();controller.current=null;pending.current=false;if(lease.current)readGuard?.release(lease.current);lease.current=null;window.removeEventListener('cos-private-data-invalidated',authChanged);window.removeEventListener('cos-workspace-navigation',navigate);window.removeEventListener('hashchange',navigate);window.removeEventListener('popstate',navigate);window.removeEventListener('pagehide',navigate);window.removeEventListener('message',parentHidden);document.removeEventListener('visibilitychange',hidden);};
 },[clear,readGuard]);
 const run=async()=>{
  if(disabled||pending.current)return;
  clear();let request;
  try{request=checkedPrivateSampleRequest({ticketNumber:ticketNumber.trim(),appointmentDay},new Date());}catch{setError('Enter a positive ticket number and a valid appointment day within 31 Chicago calendar days before or after today.');return;}
  const acquired=readGuard?.acquire();if(readGuard&&acquired===null)return;lease.current=acquired??null;
  pending.current=true;setBusy(true);const revision=++sequence.current,abort=new AbortController();controller.current=abort;
  try{
   const result=await api.post('/api/mhelpdesk/partner/tickets/preview',{evidence:'ticket_private_sample_v1',...request},{signal:abort.signal});
   if(!active.current||revision!==sequence.current||abort.signal.aborted)return;
   setSample(checkedMhelpTicketPrivateSample(result.data,request));
  }catch(cause){if(active.current&&revision===sequence.current&&!abort.signal.aborted){setSample(null);setError(mhelpTicketPreviewErrorMessage(cause));}}
  finally{if(acquired)readGuard?.release(acquired);if(active.current&&revision===sequence.current){pending.current=false;lease.current=null;controller.current=null;setBusy(false);}}
 };
 const range=privateSampleDateRange(new Date());
 return <section className='unit-tracker-source mhelp-private-sample' aria-label='Private mHelpDesk ticket inspection' aria-busy={busy}>
  <h4>Inspect one ticket privately</h4>
  <p>Read one ticket’s operational items and strictly matching appointment candidates. This does not import or change records.</p>
  {error&&<p className='operations-error' role='alert'>{error}</p>}
  {!open?<button type='button' className='secondary' disabled={disabled} onClick={()=>{setError('');setOpen(true);}}>Open private ticket inspection</button>:<>
   <p>Enter the displayed ticket number and one appointment day in America/Chicago, within 31 calendar days before or after today. One bounded ticket page selects the internal identity; a unique verified result permits one detail and one appointment read. No billing or Staff lookup is included.</p>
   <form onSubmit={event=>{event.preventDefault();void run();}}>
    <label>Ticket number<input name='ticketNumber' inputMode='numeric' autoComplete='off' maxLength={15} value={ticketNumber} onChange={event=>{clear();setTicketNumber(event.target.value);}} required pattern='[1-9][0-9]{0,14}'/></label>
    <label>Appointment day (America/Chicago)<input name='appointmentDay' type='date' value={appointmentDay} min={range.min} max={range.max} autoComplete='off' onChange={event=>{clear();setAppointmentDay(event.target.value);}} required/></label>
    <button type='submit' className='secondary' disabled={busy||disabled}>{busy?'Reading private ticket…':'Inspect ticket privately'}</button>
    <button type='button' className='secondary' onClick={()=>clear(true)}>Close private inspection</button>
   </form>
   <p>Values stay only in this open view and clear on input changes, Close, navigation, sign-out or hiding the workspace. There is no export or saved copy.</p>
   {sample&&<PrivateSampleResult sample={sample}/>}
  </>}
 </section>;
}

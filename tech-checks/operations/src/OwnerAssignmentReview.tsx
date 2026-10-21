import {useState} from 'react';
import type {AssignmentReview,Assignment,AssignmentReference,AssignmentReviewItem} from '../../supabase/functions/cos-operations-pages/mhelpEquipmentAssignmentReview';
const describe=(a:Assignment)=>`${a.placement} · ${a.customer} (customer ${a.customerId}) · ${[a.address.street,a.address.city,a.address.state,a.address.zip].filter(Boolean).join(', ')}`;
const reference=(a:AssignmentReference)=>`${a.placement} · customer ${a.customerId} · service location ${a.serviceLocationId??'None'} · observed ${a.observedAt}`;
const sourceChanged=(r:AssignmentReviewItem)=>r.sourceAssignmentChanged??(r.before.placement!==r.after.placement||r.before.customerId!==r.after.customerId||r.before.customer!==r.after.customer);
const identity=(r:AssignmentReviewItem)=><>Native: {r.identity.nativeLabel||'None — tracker-only'} {r.identity.nativeUnitId||''}. Internal tracker: {r.identity.trackerLabel||'None'} {r.identity.trackerId||''}.</>;
export default function OwnerAssignmentReview({review,pending,onApprove}:{review:AssignmentReview;pending:boolean;onApprove:(note:string)=>void}){
 const [confirmed,setConfirmed]=useState(false),[note,setNote]=useState(''),[manifestOpen,setManifestOpen]=useState(false);
 const items=[...new Map(review.items.map(r=>[r.productId,r])).values()];
 const changes=items.filter(sourceChanged),timestamps=items.filter(r=>r.continuity?.kind==='timestamp_only'),historical=items.filter(r=>r.continuity?.kind==='assignment_difference');
 const changeIds=new Set(changes.map(r=>r.productId)),historicalOnly=historical.filter(r=>!changeIds.has(r.productId)),historicalOverlap=historical.filter(r=>changeIds.has(r.productId));
 const other=items.filter(r=>!sourceChanged(r)&&!r.continuity),blocked=items.filter(r=>!r.eligible);
 const card=(r:AssignmentReviewItem)=><article key={r.productId} data-assignment-product={r.productId}>
  <h5>{r.unitNumber} · Product {r.productId}</h5>
  <p>Before: {describe(r.before)}</p><p>Proposed: {describe(r.after)}</p>
  <p>{identity(r)}</p>
  <p>Current COS internal assignment: {r.current.internalTrackerPlacement} · {r.current.internalTrackerCustomer} · {r.current.internalTrackerSite}. Native placement: {r.current.nativePlacement||'Not recorded'}.</p>
  {r.continuity&&<><p>Previous assignment evidence: {reference(r.continuity.previousAssignment)}</p><p>Current assignment evidence: {reference(r.continuity.currentAssignment)}</p></>}
  {r.guardChanged&&<p><strong>Protected state changed.</strong> Confirm the same existing equipment and the recorded Shop receipt {r.current.shopReceiptId} from {r.current.shopRecordedAt}. Approval records this exact current state; the move is not repeated.</p>}
 </article>;
 return <section aria-label='Review existing equipment assignments'>
  <h4>Review existing equipment assignments</h4>
  <p>These are COS internal records. The Google 2027 workbook was checked separately. This review retains the existing identities and recorded moves.</p>
  <p><strong>{changes.length} CSV assignment changes</strong> · {timestamps.length} timestamp-only evidence references · {historical.length} historical assignment differences · {items.length} unique Product IDs. Review reasons may overlap; each Product ID is approved once.</p>
  <p>Saved GPS and history remain preserved. The proposed service address is source evidence only, not verified installation GPS or live camera health.</p>
  {blocked.length>0&&<div role='alert'><strong>{blocked.length} equipment reviews remain blocked.</strong><ul>{blocked.map(r=><li key={r.productId}>Product {r.productId}: {r.blocker}</li>)}</ul></div>}
  {changes.length>0&&<section aria-label='CSV assignment changes'><h4>CSV assignment changes ({changes.length})</h4>{changes.map(card)}</section>}
  {historical.length>0&&<section aria-label='Historical assignment differences'><h4>Historical assignment differences ({historical.length})</h4>
   <p>These saved references describe earlier assignments. Review each previous reference against the current evidence and the proposed source assignment.</p>
   {historicalOnly.map(card)}
   {historicalOverlap.length>0&&<p>Also reviewed in the CSV changes above: {historicalOverlap.map(r=>'Product '+r.productId).join(', ')}.</p>}
  </section>}
  {timestamps.length>0&&<details onToggle={event=>setManifestOpen(event.currentTarget.open)}>
   <summary>Inspect {timestamps.length} timestamp-only evidence references</summary>
   <p>The customer, placement, service location and exact equipment identities agree. Approval records the current observation reference while retaining the previous evidence.</p>
   {manifestOpen&&<div style={{overflowX:'auto'}}><table aria-label='Timestamp-only Product ID manifest'><thead><tr><th>Product ID / equipment</th><th>Previous observation</th><th>Current observation</th><th>Assignment and identities</th></tr></thead><tbody>
    {timestamps.map(r=><tr key={r.productId}><td>{r.productId} · {r.unitNumber}{sourceChanged(r)&&<p>CSV change shown above.</p>}</td><td>{r.continuity!.previousAssignment.observedAt}</td><td>{r.continuity!.currentAssignment.observedAt}</td><td>{reference(r.continuity!.currentAssignment)}<p>{identity(r)}</p>{r.guardChanged&&<p>Protected state changed; recorded Shop receipt {r.current.shopReceiptId} from {r.current.shopRecordedAt}. Current native placement: {r.current.nativePlacement}; status: {r.current.nativeStatus}.</p>}</td></tr>)}
   </tbody></table></div>}
  </details>}
  {other.length>0&&<section aria-label='Other protected identity reviews'><h4>Other protected identity reviews ({other.length})</h4>{other.map(card)}</section>}
  {review.approved?<p role='status'>Assignment review recorded for this stage. Final commit will recheck all protected state.</p>:<>
   <label><input type='checkbox' checked={confirmed} disabled={pending} onChange={e=>setConfirmed(e.target.checked)}/> I confirm the CSV assignment changes, timestamp-only continuity manifest, historical assignment differences, and existing native/tracker identities, including the recorded Shop receipts.</label>
   <label>Assignment review note (at least 24 characters)<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={800} disabled={pending}/></label>
   <button disabled={pending||!confirmed||note.trim().length<24||!items.length||blocked.length>0} onClick={()=>onApprove(note.trim())}>Approve these assignments for this stage</button>
  </>}
 </section>;
}

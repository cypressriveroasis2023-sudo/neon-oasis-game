import {useState} from 'react';
import type {AssignmentReview,Assignment} from '../../supabase/functions/cos-operations-pages/mhelpEquipmentAssignmentReview';
const describe=(a:Assignment)=>`${a.placement} · ${a.customer} (customer ${a.customerId}) · ${[a.address.street,a.address.city,a.address.state,a.address.zip].filter(Boolean).join(', ')}`;
export default function OwnerAssignmentReview({review,pending,onApprove}:{review:AssignmentReview;pending:boolean;onApprove:(note:string)=>void}){
 const [confirmed,setConfirmed]=useState(false),[note,setNote]=useState('');
 return <section aria-label='Review existing equipment assignments'>
  <h4>Review existing equipment assignments</h4>
  <p>These are COS internal records. The Google 2027 workbook was checked separately. This review retains the existing identities; it does not create equipment or repeat recorded moves.</p>
  {review.items.map(r=><article key={r.productId}>
   <h5>{r.unitNumber} · Product {r.productId}</h5>
   <p>Before: {describe(r.before)}</p><p>Proposed: {describe(r.after)}</p>
   <p>Existing native: {r.identity.nativeLabel||'None — tracker-only'} {r.identity.nativeUnitId||''}. Existing internal tracker: {r.identity.trackerLabel||'None'} {r.identity.trackerId||''}.</p>
   <p>Current COS internal assignment: {r.current.internalTrackerPlacement} · {r.current.internalTrackerCustomer} · {r.current.internalTrackerSite}. Native placement: {r.current.nativePlacement||'Not recorded'}.</p>
   {r.guardChanged&&<p><strong>Protected state changed.</strong> Confirm the same existing equipment and the recorded Shop receipt {r.current.shopReceiptId} from {r.current.shopRecordedAt}. Approval records this exact current state; the move is not repeated.</p>}
   <p>Saved GPS and history remain preserved. The proposed service address is source evidence only, not verified installation GPS or live camera health.</p>
   {!r.eligible&&<p role='alert'>{r.blocker}</p>}
  </article>)}
  {review.approved?<p role='status'>Assignment review recorded for this stage. Final commit will recheck all protected state.</p>:<>
   <label><input type='checkbox' checked={confirmed} disabled={pending} onChange={e=>setConfirmed(e.target.checked)}/> I confirm every before/after assignment and the existing native/tracker identities shown above, including the current state of any recorded Shop moves.</label>
   <label>Assignment review note (at least 24 characters)<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={800} disabled={pending}/></label>
   <button disabled={pending||!confirmed||note.trim().length<24||!review.items.length||review.items.some(r=>!r.eligible)} onClick={()=>onApprove(note.trim())}>Approve these assignments for this stage</button>
  </>}
 </section>;
}

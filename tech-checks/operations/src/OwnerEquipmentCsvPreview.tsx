import {useRef,useState} from 'react';
import {api} from './api';
import OwnerAssignmentReview from './OwnerAssignmentReview';
import type {AssignmentReview} from '../../supabase/functions/cos-operations-pages/mhelpEquipmentAssignmentReview';
import type {OwnerEquipmentReview} from '../../supabase/functions/cos-operations-pages/mhelpEquipmentOwnerReview';

/** Existing Owner session only; the server repeats the Owner permission check.
 * This is a read-only PREVIEW. It has deliberately no commit action until an
 * independently reviewed current-guarded database admission exists. */
type StageReceipt={contract:'COS_OWNER_EQUIPMENT_STAGE_V1';stageId:string;sourceSha256:string;productIdsMatched:number;recordedField:number;recordedShop:number;expiresInMinutes:number;previewOnly:true;readyToCommit:false};
type AppliedReceipt={contract:'COS_OWNER_EQUIPMENT_COMMIT_V1';sourceSha256:string;records:number;field:number;shop:number;applied:true};
export default function OwnerEquipmentCsvPreview({allowStage=false,onCommitted}:{allowStage?:boolean;onCommitted?:()=>void}){
 const fileRef=useRef<HTMLInputElement>(null);
 const [pending,setPending]=useState(false),[failure,setFailure]=useState(''),[preview,setPreview]=useState<OwnerEquipmentReview|null>(null);
 const [expected,setExpected]=useState('');
 const [assignmentReview,setAssignmentReview]=useState<AssignmentReview|null>(null);
 const [stage,setStage]=useState<StageReceipt|null>(null),[applied,setApplied]=useState<AppliedReceipt|null>(null);
 const [approval,setApproval]=useState(false),[confirmationText,setConfirmationText]=useState('');
 const run=async()=>{
  if(pending)return;
  setFailure('');setPreview(null);setStage(null);setAssignmentReview(null);setApplied(null);setApproval(false);
  const file=fileRef.current?.files?.[0];
  if(!file){setFailure('Choose the original complete mHelpDesk equipment CSV.');return;}
  if(!/\.csv$/i.test(file.name)||file.size<1||file.size>2*1024*1024){setFailure('Choose an equipment CSV no larger than 2 MiB.');return;}
  if(expected.trim()&&!/^[a-f0-9]{64}$/.test(expected.trim())){setFailure('Enter a valid lowercase SHA-256, or leave it blank.');return;}
  setPending(true);
  try{
   // Read original bytes; File.text() could discard BOM and change the source hash.
   const bytes=new Uint8Array(await file.arrayBuffer()),parts:string[]=[];
   for(let i=0;i<bytes.length;i+=8192)parts.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
   const result=(await api.post<OwnerEquipmentReview>('/api/mhelpdesk/equipment/preview',{
    bytesBase64:btoa(parts.join('')),sourceFilename:file.name,...(expected.trim()?{expectedSha256:expected.trim()}:{})
   })).data;
   if(result.contract!=='COS_MHELP_EQUIPMENT_CSV_PREVIEW_V1'||result.previewOnly!==true||result.readyToCommit!==false)throw Error('The equipment preview was not verified.');
   setPreview(result);
  }catch(e){setFailure(e instanceof Error?e.message:'The equipment preview is unavailable. No records were changed.');}
  finally{setPending(false);}
 };
 const original=async()=>{
  const file=fileRef.current?.files?.[0];
  if(!file||!/\.csv$/i.test(file.name)||file.size<1||file.size>2*1024*1024)throw Error('Choose the full original mHelp equipment CSV.');
  const bytes=new Uint8Array(await file.arrayBuffer()),parts:string[]=[];
  for(let i=0;i<bytes.length;i+=8192)parts.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
  return {bytesBase64:btoa(parts.join('')),sourceFilename:file.name,...(expected.trim()?{expectedSha256:expected.trim()}:{})};
 };
 const stageChanges=async()=>{
  if(!allowStage||!preview||preview.censusStatus!=='verified'||pending)return;
  setFailure('');setStage(null);setAssignmentReview(null);setApplied(null);setPending(true);
  try{
   const result=(await api.post<StageReceipt>('/api/mhelpdesk/equipment/stage',{...await original(),requestId:crypto.randomUUID()})).data;
   if(result.contract!=='COS_OWNER_EQUIPMENT_STAGE_V1'||result.previewOnly!==true||result.readyToCommit!==false||
      result.sourceSha256!==preview.sourceSha256||result.recordedField!==preview.inventory.field||result.recordedShop!==preview.inventory.shop)throw Error('The guarded source receipt is incomplete.');
   setStage(result);setApproval(false);setConfirmationText('');
  }catch(e){setFailure(e instanceof Error?e.message:'The Owner source review is unavailable. No equipment was changed.');}
  finally{setPending(false);}
 };
 const reviewAssignments=async(action:'read'|'approve',note?:string)=>{
  if(!stage||pending)return;
  setPending(true);setFailure('');setApproval(false);
  try{const result=(await api.post<AssignmentReview>('/api/mhelpdesk/equipment/assignments',{
   ...await original(),stageId:stage.stageId,action,...(action==='approve'?{reviewDigest:assignmentReview?.reviewDigest,confirmationText:note}:{})
  })).data;
   if(result.contract!=='COS_OWNER_ASSIGNMENT_REVIEW_V1'||result.stageId!==stage.stageId||result.sourceSha256!==stage.sourceSha256)throw Error('Assignment review receipt does not match this stage.');
   setAssignmentReview(result);
  }catch(e){setAssignmentReview(null);setFailure(e instanceof Error?e.message:'Current assignment review is unavailable.');}
  finally{setPending(false);}
 };
 const assignmentsReady=assignmentReview&&(assignmentReview.approved||assignmentReview.items.length===0);
 const commitChanges=async()=>{
  if(!allowStage||!stage||!preview||!assignmentsReady||!approval||confirmationText.trim().length<24||pending)return;
  setFailure('');setPending(true);
  try{
   const result=(await api.post<AppliedReceipt>('/api/mhelpdesk/equipment/commit',{
    ...await original(),stageId:stage.stageId,confirmationText:confirmationText.trim(),
   })).data;
   if(result.contract!=='COS_OWNER_EQUIPMENT_COMMIT_V1'||result.applied!==true||
      result.sourceSha256!==stage.sourceSha256||result.records!==preview.inventory.total||
      result.field!==preview.inventory.field||result.shop!==preview.inventory.shop)throw Error('The source was not verified as committed.');
   setApplied(result);onCommitted?.();
  }catch(e){setFailure(e instanceof Error?e.message:'The protected save was not verified. Read back before retrying.');}
  finally{setPending(false);}
 };
 return <section className='cos-fleet-source-group' aria-label='Owner equipment inventory CSV preview'>
  <h3>mHelpDesk equipment CSV · Owner review</h3>
  <p>Compare a complete mHelpDesk export against the last reviewed COS source upload. The 2027 Unit Tracker is operational; the 2026 tracker is historical only.</p>
  <p><strong>Preview only.</strong> This control cannot change placements, device associations, IPs, GPS, or history. A separate guarded Owner commit is required after identity review.</p>
  <label htmlFor='cos-mhelp-equipment-csv'>Original mHelpDesk equipment CSV</label>
  <input id='cos-mhelp-equipment-csv' ref={fileRef} type='file' accept='.csv,text/csv' onChange={()=>{setPreview(null);setStage(null);setAssignmentReview(null);setApplied(null);setFailure('');}} disabled={pending}/>
  <label htmlFor='cos-mhelp-equipment-sha'>Expected source SHA-256 (optional, from manifest)</label>
  <input id='cos-mhelp-equipment-sha' type='text' maxLength={64} autoComplete='off' spellCheck={false} value={expected} onChange={event=>{setExpected(event.target.value);setPreview(null);setStage(null);setAssignmentReview(null);setApplied(null);}} placeholder='64 lowercase hex characters' disabled={pending}/>
  <button type='button' disabled={pending} onClick={run}>{pending?'Checking original CSV…':'Preview equipment changes'}</button>
  {failure&&<p role='alert'>{failure}</p>}
  {preview&&<div aria-live='polite'>
   <p><strong>Source verified.</strong> SHA-256: <code>{preview.sourceSha256}</code></p>
   <p><strong>{preview.inventory.total} equipment</strong> · {preview.inventory.field} Field · {preview.inventory.shop} Shop · {preview.inventory.inactive} marked Do Not Use/Missing.</p>
   <p>Product IDs: {preview.changes.unchanged} unchanged · {preview.changes.added} added · {preview.changes.absent} absent. Placement changes: {preview.changes.placement}; customer changes: {preview.changes.customer}; address changes: {preview.changes.address}; held ID collisions: {preview.changes.identityReview}.</p>
   {preview.samples.length>0&&<details><summary>Source differences ({preview.samples.length} displayed)</summary>
    <ul>{preview.samples.map((item,i)=><li key={item.productId+'-'+item.kind+'-'+i}><strong>{item.unitNumber}</strong> · {item.kind.replaceAll('_',' ')} · {item.previousPlacement||'New'} → {item.proposedPlacement||'Not in export'} · {item.reason}</li>)}</ul>
   </details>}
   <p><strong>2027 Product ID proof:</strong> {preview.censusStatus==='verified'?'Verified against current 2027 workbook':'Unavailable — no equipment writes permitted'}.</p>
   <p><strong>Admission review:</strong> {preview.admission.counts.unchanged} unchanged · {preview.admission.counts.assignment_change} assignment changes · {preview.admission.counts.new_source_only} new source records · {preview.admission.totalHeld} held for protected identity or placement review. An explicit guarded Owner commit is required.</p>
   <p role='status'>{preview.guardNotice}</p>
   {preview.censusStatus==='unavailable'&&preview.censusFailureReason&&<p role='status'>{preview.censusFailureReason}</p>}
   {allowStage&&preview.censusStatus==='verified'&&!stage&&<button type='button' onClick={stageChanges} disabled={pending}>Stage reviewed inventory (no Fleet changes)</button>}
   {!allowStage&&<p>Protected equipment save is awaiting independently reviewed backend installation. Preview remains read-only.</p>}
   {stage&&!applied&&<section aria-label='Protected Owner approval'>
    <p><strong>Staged source:</strong> {stage.productIdsMatched} products · {stage.recordedField} Field · {stage.recordedShop} Shop. Identity holds remain separate from camera identities.</p>
    {!assignmentReview&&<button type='button' disabled={pending} onClick={()=>reviewAssignments('read')}>Review current assignment identities</button>}
    {assignmentReview&&assignmentReview.items.length>0&&<OwnerAssignmentReview key={assignmentReview.reviewDigest} review={assignmentReview} pending={pending} onApprove={note=>reviewAssignments('approve',note)}/>}
    <label><input type='checkbox' checked={approval} onChange={e=>setApproval(e.target.checked)} disabled={pending}/> I reviewed the changed and held source assignments; do not merge unverified camera identities or GPS.</label>
    <label htmlFor='cos-owner-equipment-approval-note'>Owner approval note (at least 24 characters)</label>
    <textarea id='cos-owner-equipment-approval-note' value={confirmationText} onChange={e=>setConfirmationText(e.target.value)} maxLength={800} disabled={pending} rows={3}/>
    <button type='button' disabled={pending||!assignmentsReady||!approval||confirmationText.trim().length<24} onClick={commitChanges}>Apply reviewed source through protected COS backend</button>
   </section>}
   {applied&&<p role='status'><strong>Committed source receipt verified:</strong> {applied.records} records · {applied.field} Field · {applied.shop} Shop. Live Fleet/map and camera status require separate readback.</p>}
  </div>}
 </section>;
}

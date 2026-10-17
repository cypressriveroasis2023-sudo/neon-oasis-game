import {useRef,useState} from 'react';
import {api} from './api';
import type {OwnerEquipmentReview} from '../../supabase/functions/cos-operations-pages/mhelpEquipmentOwnerReview';

/** Existing Owner session only; the server repeats the Owner permission check.
 * This is a read-only PREVIEW. It has deliberately no commit action until an
 * independently reviewed current-guarded database admission exists. */
export default function OwnerEquipmentCsvPreview(){
 const fileRef=useRef<HTMLInputElement>(null);
 const [pending,setPending]=useState(false),[failure,setFailure]=useState(''),[preview,setPreview]=useState<OwnerEquipmentReview|null>(null);
 const [expected,setExpected]=useState('');
 const run=async()=>{
  if(pending)return;
  setFailure('');setPreview(null);
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
 return <section className='cos-fleet-source-group' aria-label='Owner equipment inventory CSV preview'>
  <h3>mHelpDesk equipment CSV · Owner review</h3>
  <p>Compare a complete mHelpDesk export against the last reviewed COS source upload. The 2027 Unit Tracker is operational; the 2026 tracker is historical only.</p>
  <p><strong>Preview only.</strong> This control cannot change placements, device associations, IPs, GPS, or history. A separate guarded Owner commit is required after identity review.</p>
  <label htmlFor='cos-mhelp-equipment-csv'>Original mHelpDesk equipment CSV</label>
  <input id='cos-mhelp-equipment-csv' ref={fileRef} type='file' accept='.csv,text/csv' onChange={()=>{setPreview(null);setFailure('');}} disabled={pending}/>
  <label htmlFor='cos-mhelp-equipment-sha'>Expected source SHA-256 (optional, from manifest)</label>
  <input id='cos-mhelp-equipment-sha' type='text' maxLength={64} autoComplete='off' spellCheck={false} value={expected} onChange={event=>{setExpected(event.target.value);setPreview(null);}} placeholder='64 lowercase hex characters' disabled={pending}/>
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
   <p><strong>Admission review:</strong> {preview.admission.counts.unchanged} unchanged · {preview.admission.counts.assignment_change} assignment changes · {preview.admission.counts.new_source_only} new source records · {preview.admission.totalHeld} held for protected identity or placement review. No commit is enabled.</p>
   <p role='status'>{preview.guardNotice}</p>
  </div>}
 </section>;
}

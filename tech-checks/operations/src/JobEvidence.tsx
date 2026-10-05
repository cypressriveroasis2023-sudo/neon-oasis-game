import { type OperationsRecord } from './operationsWorkflowData';
import { api } from './api';
import PrivateEvidence from './PrivateEvidence';
const list = (value: unknown): OperationsRecord[] => Array.isArray(value) ? value.filter(row=>row&&typeof row==='object'&&!Array.isArray(row)) : [];
function EvidencePhoto({ photo }: { photo: OperationsRecord }) {
  return <figure>
    <PrivateEvidence api={api} value={photo.url} documentId={photo.id} label='photo'/>
    <figcaption>{photo.stage || 'Field Work'} · {photo.department || 'Field'} · {photo.by || photo.recordedBy || 'Recorded evidence'}<small>{photo.kind || 'photo'}</small></figcaption>
  </figure>;
}
function SignatureLink({ signature }: { signature: OperationsRecord }) {
  return <span>{signature.kind === 'technician' ? 'Technician' : 'Customer / site'} signature · {signature.name || 'Recorded signer'}{signature.by || signature.capturedBy ? ' · captured by ' + (signature.by || signature.capturedBy) : ''}
    <PrivateEvidence api={api} value={signature.url} documentId={signature.documentId} label='signature'/>
  </span>;
}
export default function JobEvidence({job}:{job:OperationsRecord}) {
  const checks=list(job.techCheckHistory),photos=list(job.photos),signatures=list(job.signatures),notes=list(job.notes);
  const loaded={checks:Array.isArray(job.techCheckHistory),photos:Array.isArray(job.photos),signatures:Array.isArray(job.signatures),notes:Array.isArray(job.notes)};
  const answers=checks.flatMap(check=>list(check.answers));
  const failures=answers.filter(answer=>String(answer.answer).toUpperCase()==='NO').length;
  return <div className='evidence-summary' aria-label={'Field evidence for '+(job.jobNumber||'COS Job')}>
    <b>Field Evidence · Full Job History</b>
    {job.damageReported&&<strong>RETURNED UNIT DAMAGE REPORTED — KEEP OUT OF READY INVENTORY</strong>}
    <span>{loaded.checks?answers.length:'—'} Tech Check entries across {loaded.checks?checks.length:'—'} completed stage(s) · {loaded.photos?photos.length:'—'} photos · {loaded.signatures?signatures.length:'—'} signatures · {loaded.notes?notes.length:'—'} notes</span>
    {Object.values(loaded).some(value=>!value)&&<small role='status'>Some evidence records are unavailable in this response. A dash means unverified information.</small>}
    {failures>0&&<strong>{failures} FAILED CHECK(S) — REVIEW REQUIRED</strong>}
    {checks.map((check,index)=><div className='audit-mini' key={check.id||index}><b>{check.stage} · {check.department} · {check.technician}</b>{check.signature&&<SignatureLink signature={check.signature}/>} {list(check.answers).map((answer,answerIndex)=><small key={answer.id||answerIndex}>{answer.title||('Step '+answer.step)}: {answer.answer}{answer.note?' — '+answer.note:''}{answer.by?' · '+answer.by:''}</small>)}</div>)}
    {photos.length>0&&<div className='owner-evidence-photos'>{photos.map((photo,index)=><EvidencePhoto key={photo.path||photo.id||index} photo={photo}/>)}</div>}
    {signatures.length>0&&<div className='audit-mini'><b>Signatures</b>{signatures.map((signature,index)=><SignatureLink key={signature.documentId||signature.id||index} signature={signature}/>)}</div>}
    {notes.map((note,index)=><small key={note.id||index}>Note: {note.text}{note.by?' · '+note.by:''}</small>)}
  </div>;
}

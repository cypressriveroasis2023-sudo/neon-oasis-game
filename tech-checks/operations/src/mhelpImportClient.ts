import { importTicketFingerprint, validateImportSource, type ImportSource, type ReviewedImportTicket } from './mhelpImportModel';
import { type MhelpImportAdapter, type SavedImport, type StagedTicketAttachment } from './mhelpImportPersistence';

export type ImportApi = { get(path:string):Promise<{data:any}>; post(path:string,body:unknown):Promise<{data:any}> };
export type ImportHistoryRow = StagedTicketAttachment & {filename:string;sourceTicketId:string;createdAt:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const checkedId=(id:string)=>{if(!uuid.test(id))throw new Error('The import identity could not be verified.');return id;};
export function checkedImportAttachment(value:any):StagedTicketAttachment {
  if(!value||!uuid.test(value.id)||!uuid.test(value.organizationId)||!['staged','trash'].includes(value.state)||value.recoverable!==true||!/^[a-f0-9]{64}$/.test(value.sha256)||!Number.isSafeInteger(value.byteLength)||value.byteLength<=0||value.jobId&&!uuid.test(value.jobId))throw new Error('The saved import attachment could not be verified.');
  if(value.attemptId!==undefined&&!uuid.test(value.attemptId)||value.disposition!=null&&!['created','duplicate'].includes(value.disposition)||value.disposition==='duplicate'&&!value.jobId)throw new Error('The import recovery metadata could not be verified.');
  if(value.source){validateImportSource(value.source);if(value.source.sha256!==value.sha256||value.source.byteLength!==value.byteLength)throw new Error('The import source metadata does not match its saved bytes.');}
  return value;
}
export function checkedImportHistory(value:any):ImportHistoryRow[] {
  if(!value||value.complete!==true||!Array.isArray(value.items)||value.items.some((row:any)=>typeof row.filename!=='string'||typeof row.sourceTicketId!=='string'||typeof row.createdAt!=='string'))throw new Error('Import history could not be verified.');
  value.items.forEach(checkedImportAttachment);
  if(new Set(value.items.map((row:any)=>row.id)).size!==value.items.length)throw new Error('Import history contains inconsistent identities.');
  return value.items;
}
export async function fileBytesBase64(file:File) {
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
  for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
}
export function mhelpImportClient(api:ImportApi) {
  const adapter:MhelpImportAdapter={
    commit:async({attachmentId,ticket})=>(await api.post('/api/mhelpdesk/imports/commit',{attachmentId:checkedId(attachmentId),ticket})).data,
    readJob:async id=>(await api.get('/api/mhelpdesk/imports/jobs/'+checkedId(id))).data as SavedImport|null,
    moveToRecoverableTrash:async(id,verifiedJobId,ticket)=>{await api.post('/api/mhelpdesk/imports/attachments/'+checkedId(id)+'/trash',{verifiedJobId:checkedId(verifiedJobId),ticket});},
    readAttachment:async id=>{const result=(await api.get('/api/mhelpdesk/imports/attachments/'+checkedId(id))).data;return result===null?null:checkedImportAttachment(result);},
  };
  return {
    adapter,
    stage:async(attemptId:string,source:ImportSource,file:File)=>checkedImportAttachment((await api.post('/api/mhelpdesk/imports/stage',{attemptId:checkedId(attemptId),source,bytesBase64:await fileBytesBase64(file)})).data),
    readAttempt:async(id:string)=>{const value=(await api.get('/api/mhelpdesk/imports/attempt/'+checkedId(id))).data;if(value===null)return null;const checked=checkedImportAttachment(value);if(checked.attemptId!==id)throw new Error('The recovered attachment belongs to a different import attempt.');return checked;},
    history:async()=>checkedImportHistory((await api.get('/api/mhelpdesk/imports')).data),
    restore:async(id:string)=>{
      await api.post('/api/mhelpdesk/imports/attachments/'+checkedId(id)+'/restore',{});
      const value=await adapter.readAttachment(id);
      if(!value||value.state!=='staged')throw new Error('The restored copy could not be verified. Refresh imports before retrying.');
      return value;
    },
    recoverSaved:async(attachment:StagedTicketAttachment,ticket:ReviewedImportTicket)=>{
      if(!attachment.jobId)return null;
      if(attachment.sha256!==ticket.source.sha256||attachment.byteLength!==ticket.source.byteLength)throw new Error('The recovered attachment does not match this original file.');
      // A confirmed duplicate points to a PRE-EXISTING job. Its attachment and
      // reviewed fields intentionally differ from this separately retained copy.
      if(attachment.disposition==='duplicate'){
        if(!attachment.source||attachment.source.sourceTicketId!==ticket.source.sourceTicketId||attachment.source.filename!==ticket.source.filename||attachment.source.parserId!==ticket.source.parserId||attachment.source.parserVersion!==ticket.source.parserVersion||attachment.state!=='staged')throw new Error('Duplicate import provenance could not be verified. The source copy is retained.');
        return {status:'duplicate' as const,jobId:attachment.jobId};
      }
      const saved=await adapter.readJob(attachment.jobId);
      if(!saved||saved.jobId!==attachment.jobId||saved.organizationId!==attachment.organizationId||saved.attachmentId!==attachment.id||saved.status!=='saved'||importTicketFingerprint(saved.ticket)!==importTicketFingerprint(ticket))throw new Error('A saved job exists, but it does not match every reviewed field. Open it for review; the imported copy is retained.');
      return {status:'saved' as const,saved};
    },
    download:async(row:ImportHistoryRow)=>{
      const value=(await api.get('/api/mhelpdesk/imports/attachments/'+checkedId(row.id)+'/download')).data;
      if(!value||value.filename!==row.filename||value.mimeType!=='application/pdf'||value.sha256!==row.sha256||typeof value.bytesBase64!=='string')throw new Error('The retained source copy could not be verified.');
      const bytes=Uint8Array.from(atob(value.bytesBase64),(character:string)=>character.charCodeAt(0));
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
      if(digest!==row.sha256||bytes.length!==row.byteLength)throw new Error('The retained source bytes do not match the saved original.');
      return new Blob([bytes],{type:'application/pdf'});
    },
  };
}

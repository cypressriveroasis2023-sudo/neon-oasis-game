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
const unavailable = (): never => { throw new Error('mHelp ticket import is not available in COS.'); };
export function mhelpImportClient(_api:ImportApi,_current=()=>true) {
  const adapter:MhelpImportAdapter={
    commit:async()=>unavailable(),
    readJob:async()=>unavailable(),
    moveToRecoverableTrash:async()=>unavailable(),
    readAttachment:async()=>unavailable(),
  };
  return {
    adapter,
    stage:async(..._args:unknown[]):Promise<StagedTicketAttachment>=>unavailable(),
    readAttempt:async(..._args:unknown[]):Promise<StagedTicketAttachment|null>=>unavailable(),
    history:async(..._args:unknown[]):Promise<ImportHistoryRow[]>=>unavailable(),
    restore:async(..._args:unknown[]):Promise<StagedTicketAttachment>=>unavailable(),
    recoverSaved:async(..._args:unknown[]):Promise<{status:'duplicate';jobId:string}|{status:'saved';saved:SavedImport}|null>=>unavailable(),
    download:async(..._args:unknown[]):Promise<Blob>=>unavailable(),
  };
}

/** A verification is a series of independent writes, never an all-or-nothing
 * browser transaction. Read each batch back before starting the next one.
 * A lost POST response is not permission to repeat that POST. */
export type VerifyProduct = {productId:string;unitNumber:string};
export type VerificationRow = {
 productId:string;name:string;status:'online'|'offline'|'unknown';
 reason:string;checkedAt:string|null;outcome:'returned'|'not_confirmed';
};
type Receipt = {contract:'COS_VERIFY_PRODUCTS_NOW_V1';connections?:unknown;items:Array<Omit<VerificationRow,'name'|'outcome'>>};
type Options = {
 current:()=>boolean;
 check:(productIds:string[])=>Promise<unknown>;
 readback:(connections?:unknown)=>Promise<unknown>;
 progress?:(rows:VerificationRow[],total:number,phase:'checking'|'reading')=>void;
};
class InvalidVerificationReceipt extends Error {}
const blocked=(error:unknown)=>error instanceof InvalidVerificationReceipt||[401,403,409].includes(Number((error as {response?:{status?:unknown}})?.response?.status));
/** Keep a bounded API explanation, not arbitrary thrown payloads or stacks. */
function requestFailureDetail(error:unknown):string {
 if(!(error instanceof Error)||error.name!=='OperationsApiError')return '';
 const reported=(error as Error & {response?:{data?:{error?:unknown}}}).response?.data?.error;
 return typeof reported==='string'&&reported===error.message&&reported.length>0&&reported.length<=500&&
  !/[\x00-\x1f\x7f<>]/.test(reported)?reported+' ':'';
}
export function verificationOutcomeLabel(row:VerificationRow):string {
 if(row.outcome==='not_confirmed')return 'Check not confirmed';
 if(row.status==='online')return 'Online';
 if(row.status==='offline')return 'Offline';
 // A failed/stale check is not a request to change working camera settings.
 return /^(?:No verified public tracker IP is available\b|Saved camera IP or port configuration needs correction\.)/.test(row.reason)
  ?'Needs correction':'Unresolved';
}
function readReceipt(value:unknown,batch:VerifyProduct[]):Receipt {
 const v=value as Receipt|null;
 if(!v||v.contract!=='COS_VERIFY_PRODUCTS_NOW_V1'||!Array.isArray(v.items)||v.items.length!==batch.length||
  v.items.some(r=>!r||typeof r!=='object')||new Set(v.items.map(r=>r.productId)).size!==batch.length||
  v.items.some(r=>!batch.some(p=>p.productId===r.productId)||!['online','offline','unknown'].includes(r.status)||
   typeof r.reason!=='string'||r.reason.length>2000||(r.status==='unknown'?r.checkedAt!==null:
   typeof r.checkedAt!=='string'||!Number.isFinite(Date.parse(r.checkedAt))))) {
  throw new InvalidVerificationReceipt('The check response could not be confirmed. Review saved results before retrying.');
 }
 return v;
}
export async function runFleetVerification(products:VerifyProduct[],options:Options) {
 const snapshot=[...new Map(products.map(p=>[p.productId,{...p}])).values()];
 const rows:VerificationRow[]=[];
 let readbackConfirmed=false;
 for(let i=0;i<snapshot.length;i+=4){
  if(!options.current())return null;
  const batch=snapshot.slice(i,i+4);let receipt:Receipt|undefined,stop=false;
  try {
   const response=await options.check(batch.map(p=>p.productId));
   if(!options.current())return null;
   receipt=readReceipt(response,batch);
   rows.push(...receipt.items.map(r=>({...r,name:batch.find(p=>p.productId===r.productId)!.unitNumber,outcome:'returned' as const})));
  } catch(error) {
   if(!options.current())return null;
   stop=blocked(error);
   rows.push(...batch.map(p=>({productId:p.productId,name:p.unitNumber,status:'unknown' as const,
    checkedAt:null,outcome:'not_confirmed' as const,
    reason:requestFailureDetail(error)+(stop?'Verification stopped because access, source state or the response could not be confirmed. No automatic retry was made.':
     'This request did not return a confirmed result. It may have saved some checks; saved results are being reloaded. The request was not repeated.')})));
  }
  if(!options.current())return null;
  options.progress?.([...rows],snapshot.length,'reading');
  // A failed POST can still have saved a partial batch. Recover with a read,
  // not a repeated check, and do not lose already returned results.
  try {await options.readback(receipt?.connections);if(!options.current())return null;readbackConfirmed=true;}
  catch(error){if(!options.current())return null;readbackConfirmed=false;stop=stop||blocked(error);}
  if(!options.current())return null;
  options.progress?.([...rows],snapshot.length,'checking');
  if(stop)break;
 }
 const count=(status:VerificationRow['status'])=>rows.filter(r=>r.outcome==='returned'&&r.status===status).length;
 return {rows,requested:snapshot.length,online:count('online'),offline:count('offline'),
  unresolved:count('unknown'),notConfirmed:rows.filter(r=>r.outcome==='not_confirmed').length,
  notAttempted:snapshot.length-rows.length,readbackConfirmed};
}
export type FleetVerificationSummary=NonNullable<Awaited<ReturnType<typeof runFleetVerification>>>;
export function verificationSummaryText(value:FleetVerificationSummary){
 const counts=value.online+' online · '+value.offline+' offline · '+value.unresolved+' unresolved · '+
  value.notConfirmed+' not confirmed'+(value.notAttempted?' · '+value.notAttempted+' not attempted':'');
 return (value.notAttempted?'Verification stopped. ':'Verification requests finished. ')+counts+'. '+
  (value.readbackConfirmed?'Fleet reloaded from saved evidence.':'Fleet refresh could not be confirmed. Returned results remain listed; refresh saved results before retrying.')+
  (value.unresolved?' Unresolved units retain their reported reasons; verification does not invent missing settings.':'');
}

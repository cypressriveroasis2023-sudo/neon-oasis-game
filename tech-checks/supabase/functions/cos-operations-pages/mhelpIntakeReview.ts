/** Pure saved-status DTO. No transport, credentials, mutation or scheduler imports. */
class IntakeReviewError extends Error {constructor(){super('Saved intake status could not be verified');}}
const row=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new IntakeReviewError();return value as Record<string,unknown>;};
const exact=(value:Record<string,unknown>,keys:string[])=>{if(Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key)))throw new IntakeReviewError();};
const utc=(value:unknown):string=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw new IntakeReviewError();return value;};
export const REVIEW_CONTRACT='cos-mhelp-intake-review-v1';
export type IntakeReviewStatus={
  contract:typeof REVIEW_CONTRACT;enabled:boolean;activationAt:string|null;pendingReviewCount:number;createdCount:number;
  lastAttemptAt:string|null;lastSuccessAt:string|null;failureCount:number;retryAfter:string|null;lastErrorCode:string|null;
  held:Array<{ticketNumber:string;reasonCodes:string[]}>;heldTruncated:boolean;
};
const reasonCodesAllowed=new Set(['assignment_identity_unverified','configuration_reviewer_inactive','existing_ticket_requires_reconciliation','source_changed_review_required','source_creation_in_future','source_schema_unverified','source_scope_or_route_invalid','source_status_incomplete_or_deleted','source_status_review_required','source_status_reviewer_inactive','source_status_terminal','source_status_unreviewed','ticket_lead_inactive_or_unverified','ticket_lead_unverified','ticket_lead_policy_conflict','type_mapping_reviewer_inactive','type_mapping_unverified']);
const errorCodes=['SOURCE_UNAVAILABLE','SOURCE_INVALID','BATCH_LIMIT','WRITE_UNAVAILABLE','RECEIPT_INVALID','DEADLINE','CONFIGURATION','INTERNAL'];
export function projectIntakeReview(value:unknown):IntakeReviewStatus {
  const v=row(value);exact(v,['contract','enabled','activationAt','pendingReviewCount','createdCount','lastAttemptAt','lastSuccessAt','failureCount','retryAfter','lastErrorCode','held','heldTruncated']);
  const bad=()=>{throw new IntakeReviewError();};
  if(v.contract!==REVIEW_CONTRACT||typeof v.enabled!=='boolean'||typeof v.heldTruncated!=='boolean'||!Array.isArray(v.held)||v.held.length>25)bad();
  const count=(x:unknown,max=100000000)=>{if(typeof x!=='number'||!Number.isSafeInteger(x)||x<0||x>max)bad();return x as number;};
  const time=(x:unknown)=>x===null?null:utc(x);
  if(v.lastErrorCode!==null&&(typeof v.lastErrorCode!=='string'||!errorCodes.includes(v.lastErrorCode)))bad();
  const held=(v.held as unknown[]).map(x=>{const item=row(x);exact(item,['ticketNumber','reasonCodes']);if(typeof item.ticketNumber!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,127}$/.test(item.ticketNumber)||!Array.isArray(item.reasonCodes)||item.reasonCodes.length>40)bad();
    const reasonCodes=(item.reasonCodes as unknown[]).map(code=>{if(typeof code!=='string'||!reasonCodesAllowed.has(code))bad();return code as string;});return {ticketNumber:item.ticketNumber as string,reasonCodes};});
  const pendingReviewCount=count(v.pendingReviewCount);if(held.length>pendingReviewCount||v.heldTruncated!==(pendingReviewCount>held.length))bad();
  return {contract:REVIEW_CONTRACT,enabled:v.enabled as boolean,activationAt:time(v.activationAt),pendingReviewCount,createdCount:count(v.createdCount),lastAttemptAt:time(v.lastAttemptAt),lastSuccessAt:time(v.lastSuccessAt),failureCount:count(v.failureCount,16),retryAfter:time(v.retryAfter),lastErrorCode:v.lastErrorCode as string|null,held,heldTruncated:v.heldTruncated as boolean};
}

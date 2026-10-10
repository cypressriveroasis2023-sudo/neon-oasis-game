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
const reasonCodesAllowed=new Set(['assignment_identity_unverified','configuration_reviewer_inactive','existing_ticket_requires_reconciliation','source_changed_review_required','source_identity_changed_review_required','source_creation_in_future','source_schema_unverified','source_scope_or_route_invalid','source_status_incomplete_or_deleted','source_status_review_required','source_status_reviewer_inactive','source_status_terminal','source_status_unreviewed','ticket_lead_inactive_or_unverified','ticket_lead_unverified','ticket_lead_policy_conflict','type_mapping_reviewer_inactive','type_mapping_unverified']);
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

/** Explicit opt-in leaves the original saved review contract byte-compatible. */
export const PENDING_SCHEDULE_CAPABILITY='pending_schedule_v1';
export const PENDING_STATUS_CONTRACT='cos-mhelp-pending-status-v1';
export const EXTENDED_REVIEW_CONTRACT='cos-mhelp-intake-status-pending-v1';
const pendingStates=['created','existing','review_needed','deferred'] as const;
const pendingCodes=['SOURCE_UNAVAILABLE','SOURCE_INVALID','DEADLINE','CONFIGURATION','INTERNAL'] as const;
export type PendingScheduleStatus={
  contract:typeof PENDING_STATUS_CONTRACT;waitingCount:number;dueCount:number;oldestWaitingCreatedAt:string|null;
  lastRefreshAt:string|null;lastRefreshState:typeof pendingStates[number]|null;lastRefreshCode:typeof pendingCodes[number]|null;
};
export type ExtendedIntakeReviewStatus={contract:typeof EXTENDED_REVIEW_CONTRACT;review:IntakeReviewStatus;pendingSchedule:PendingScheduleStatus|null};
export function projectPendingScheduleStatus(value:unknown):PendingScheduleStatus {
  const v=row(value);exact(v,['contract','waitingCount','dueCount','oldestWaitingCreatedAt','lastRefreshAt','lastRefreshState','lastRefreshCode']);
  const bad=()=>{throw new IntakeReviewError();};
  const count=(x:unknown)=>{if(typeof x!=='number'||!Number.isSafeInteger(x)||x<0||x>100000000)bad();return x as number;};
  const time=(x:unknown)=>x===null?null:utc(x);
  if(v.contract!==PENDING_STATUS_CONTRACT||v.lastRefreshState!==null&&!pendingStates.includes(v.lastRefreshState as typeof pendingStates[number])||v.lastRefreshCode!==null&&!pendingCodes.includes(v.lastRefreshCode as typeof pendingCodes[number]))bad();
  const waitingCount=count(v.waitingCount),dueCount=count(v.dueCount),oldestWaitingCreatedAt=time(v.oldestWaitingCreatedAt);
  if(dueCount>waitingCount||(waitingCount===0)!==(oldestWaitingCreatedAt===null))bad();
  return {contract:PENDING_STATUS_CONTRACT,waitingCount,dueCount,oldestWaitingCreatedAt,lastRefreshAt:time(v.lastRefreshAt),lastRefreshState:v.lastRefreshState as PendingScheduleStatus['lastRefreshState'],lastRefreshCode:v.lastRefreshCode as PendingScheduleStatus['lastRefreshCode']};
}
/** Old backends may still return v1 when the client explicitly asks for enrichment evidence. */
export function projectIntakeStatus(value:unknown,capability?:typeof PENDING_SCHEDULE_CAPABILITY):IntakeReviewStatus|ExtendedIntakeReviewStatus {
  if(capability!==undefined&&capability!==PENDING_SCHEDULE_CAPABILITY)throw new IntakeReviewError();
  const v=row(value);
  if(capability===undefined||v.contract===REVIEW_CONTRACT)return projectIntakeReview(v);
  exact(v,['contract','review','pendingSchedule']);
  if(v.contract!==EXTENDED_REVIEW_CONTRACT)throw new IntakeReviewError();
  return {contract:EXTENDED_REVIEW_CONTRACT,review:projectIntakeReview(v.review),pendingSchedule:v.pendingSchedule===null?null:projectPendingScheduleStatus(v.pendingSchedule)};
}

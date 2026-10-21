import {currentSource,type BridgeOptions} from './mhelpEquipmentWriteBridge.ts';
export type Assignment={placement:string;customer:string;customerId:string;address:{street:string;city:string;state:string;zip:string}};
export type AssignmentReview={contract:'COS_OWNER_ASSIGNMENT_REVIEW_V1';stageId:string;sourceSha256:string;censusSha256:string;reviewDigest:string;approved:boolean;items:{productId:string;unitNumber:string;before:Assignment;after:Assignment;identity:{nativeUnitId:string|null;nativeLabel:string|null;trackerId:string|null;trackerLabel:string|null};current:{nativePlacement:string|null;nativeStatus:string|null;internalTrackerPlacement:string|null;internalTrackerCustomer:string|null;internalTrackerSite:string|null;gpsPresent:boolean;shopReceiptId:string|null;shopRecordedAt:string|null};guardChanged:boolean;eligible:boolean;blocker:string|null}[]};
export async function reviewOwnerEquipmentAssignments(o:BridgeOptions&{stageId:string;action:'read'|'approve';reviewDigest?:string;confirmationText?:string}):Promise<AssignmentReview>{
 const invalid=()=>{throw Error('Protected COS equipment admission: current explicit assignment review required');};
 if(!/^[a-f0-9-]{36}$/i.test(o.stageId)||!['read','approve'].includes(o.action))invalid();
 if(o.action==='approve'&&(!/^[a-f0-9]{64}$/.test(o.reviewDigest||'')||typeof o.confirmationText!=='string'||o.confirmationText.trim().length<24||o.confirmationText.length>800))invalid();
 const {preview,census}=await currentSource(o);
 const result=await o.rpc('cos_owner_mhelp_assignment_review_v1',{p_actor_user_id:o.actorId,p_organization_id:o.organizationId,p_stage_id:o.stageId,p_source_sha256:preview.sourceSha256,p_current_2027_sha256:census.sourceSha256,p_action:o.action,p_expected_digest:o.reviewDigest??null,p_confirmation:o.confirmationText??null}) as AssignmentReview;
 if(result?.contract!=='COS_OWNER_ASSIGNMENT_REVIEW_V1'||result.stageId!==o.stageId||result.sourceSha256!==preview.sourceSha256||result.censusSha256!==census.sourceSha256||!/^[a-f0-9]{64}$/.test(result.reviewDigest)||!Array.isArray(result.items)||result.items.length>10000||typeof result.approved!=='boolean'||o.action==='approve'&&!result.approved)invalid();
 // Database projection contains no endpoints, IPs, SIMs, secrets or raw CSV.
 return result;
}

import {currentSource,type BridgeOptions} from './mhelpEquipmentWriteBridge.ts';
export type Assignment={placement:string;customer:string;customerId:string;address:{street:string;city:string;state:string;zip:string}};
export type AssignmentReference={productId:string;customerId:string;placement:string;serviceLocationId:string|null;observedAt:string};
export type AssignmentContinuity={kind:'timestamp_only'|'assignment_difference';previousAssignment:AssignmentReference;currentAssignment:AssignmentReference};
export type AssignmentReviewItem={productId:string;unitNumber:string;before:Assignment;after:Assignment;identity:{nativeUnitId:string|null;nativeLabel:string|null;trackerId:string|null;trackerLabel:string|null};current:{nativePlacement:string|null;nativeStatus:string|null;internalTrackerPlacement:string|null;internalTrackerCustomer:string|null;internalTrackerSite:string|null;gpsPresent:boolean;shopReceiptId:string|null;shopRecordedAt:string|null};guardChanged:boolean;eligible:boolean;blocker:string|null;sourceAssignmentChanged?:boolean;continuity?:AssignmentContinuity|null};
export type AssignmentReview={contract:'COS_OWNER_ASSIGNMENT_REVIEW_V1';stageId:string;sourceSha256:string;censusSha256:string;reviewDigest:string;approved:boolean;items:AssignmentReviewItem[]};
const ID=/^[1-9][0-9]{0,14}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,HASH=/^[a-f0-9]{64}$/;
const invalid=():never=>{throw Error('Protected COS equipment admission: current explicit assignment review required');};
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:invalid();
const text=(v:unknown,max=4000):string=>typeof v==='string'&&v.length<=max?v:invalid();
const nullableText=(v:unknown):string|null=>v===null?null:text(v);
const bool=(v:unknown):boolean=>typeof v==='boolean'?v:invalid();
const id=(v:unknown):string=>typeof v==='string'&&ID.test(v)?v:invalid();
const uuid=(v:unknown):string|null=>v===null?null:typeof v==='string'&&UUID.test(v)?v:invalid();
const placement=(v:unknown):string=>v==='FIELD'||v==='SHOP'?v:invalid();
function observedAt(v:unknown):string{
 // Historical evidence contains PostgreSQL timestamptz text with an explicit
 // hour-only offset. Validate its calendar and timezone without rewriting the
 // original string: fractional precision and evidence digests must stay exact.
 if(typeof v!=='string'||v.length>64)return invalid();
 const match=/^([0-9]{4})-([0-9]{2})-([0-9]{2})[T ]([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,6}))?(Z|[+-]([0-9]{2})(?::([0-9]{2}))?)$/.exec(v);
 if(!match||match[0]!==v)return invalid();
 const [,yearText,monthText,dayText,hourText,minuteText,secondText,,zone,zoneHour,zoneMinute]=match;
 const year=Number(yearText),month=Number(monthText),day=Number(dayText);
 const leap=year%4===0&&(year%100!==0||year%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(year<1||month<1||month>12||day<1||day>days[month-1]||
  Number(hourText)>23||Number(minuteText)>59||Number(secondText)>59||
  zone!=='Z'&&(Number(zoneHour)>15||Number(zoneMinute||0)>59)||!Number.isFinite(Date.parse(v)))invalid();
 return v;
}
function assignment(v:unknown):Assignment{
 const a=object(v),address=object(a.address);
 return {placement:placement(a.placement),customer:text(a.customer),customerId:id(a.customerId),address:{street:text(address.street),city:text(address.city),state:text(address.state),zip:text(address.zip)}};
}
function reference(v:unknown,productId:string):AssignmentReference{
 const r=object(v);if(r.productId!==productId)invalid();
 return {productId,customerId:id(r.customerId),placement:placement(r.placement),serviceLocationId:r.serviceLocationId===null?null:text(r.serviceLocationId,250),observedAt:observedAt(r.observedAt)};
}
function reviewItem(value:unknown):AssignmentReviewItem{
 const r=object(value),productId=id(r.productId),before=assignment(r.before),after=assignment(r.after),identity=object(r.identity),current=object(r.current);
 const nativeUnitId=uuid(identity.nativeUnitId),trackerId=uuid(identity.trackerId);
 if(!nativeUnitId&&!trackerId)invalid();
 const out:AssignmentReviewItem={productId,unitNumber:text(r.unitNumber,250),before,after,
  identity:{nativeUnitId,nativeLabel:nullableText(identity.nativeLabel),trackerId,trackerLabel:nullableText(identity.trackerLabel)},
  current:{nativePlacement:nullableText(current.nativePlacement),nativeStatus:nullableText(current.nativeStatus),internalTrackerPlacement:nullableText(current.internalTrackerPlacement),internalTrackerCustomer:nullableText(current.internalTrackerCustomer),internalTrackerSite:nullableText(current.internalTrackerSite),gpsPresent:bool(current.gpsPresent),shopReceiptId:uuid(current.shopReceiptId),shopRecordedAt:current.shopRecordedAt===null?null:observedAt(current.shopRecordedAt)},
  guardChanged:bool(r.guardChanged),eligible:bool(r.eligible),blocker:nullableText(r.blocker),
  sourceAssignmentChanged:r.sourceAssignmentChanged===undefined?before.placement!==after.placement||before.customerId!==after.customerId||before.customer!==after.customer:bool(r.sourceAssignmentChanged)};
 if(!out.unitNumber||nativeUnitId&&!out.identity.nativeLabel||trackerId&&!out.identity.trackerLabel||!out.eligible&&!out.blocker)invalid();
 // An unavailable/ambiguous link is a review blocker, not a reason to hide the read.
 if(r.continuity===null)out.continuity=null;
 else if(r.continuity!==undefined){
  const c=object(r.continuity),previousAssignment=reference(c.previousAssignment,productId),currentAssignment=reference(c.currentAssignment,productId);
  const kind=c.kind==='timestamp_only'||c.kind==='assignment_difference'?c.kind:invalid();
  const same=previousAssignment.customerId===currentAssignment.customerId&&previousAssignment.placement===currentAssignment.placement&&previousAssignment.serviceLocationId===currentAssignment.serviceLocationId;
  if(kind==='timestamp_only'&&(!same||previousAssignment.observedAt===currentAssignment.observedAt)||kind==='assignment_difference'&&same)invalid();
  out.continuity={kind,previousAssignment,currentAssignment};
 }
 return out;
}
export async function reviewOwnerEquipmentAssignments(o:BridgeOptions&{stageId:string;action:'read'|'approve';reviewDigest?:string;confirmationText?:string}):Promise<AssignmentReview>{
 if(!UUID.test(o.stageId)||!['read','approve'].includes(o.action))invalid();
 if(o.action==='approve'&&(!HASH.test(o.reviewDigest||'')||typeof o.confirmationText!=='string'||o.confirmationText.trim().length<24||o.confirmationText.length>800))invalid();
 const {preview,census,rows}=await currentSource(o);
 const result=object(await o.rpc('cos_owner_mhelp_assignment_review_v1',{p_actor_user_id:o.actorId,p_organization_id:o.organizationId,p_stage_id:o.stageId,p_source_sha256:preview.sourceSha256,p_current_2027_sha256:census.sourceSha256,p_action:o.action,p_expected_digest:o.reviewDigest??null,p_confirmation:o.confirmationText??null}));
 if(result.contract!=='COS_OWNER_ASSIGNMENT_REVIEW_V1'||result.stageId!==o.stageId||result.sourceSha256!==preview.sourceSha256||result.censusSha256!==census.sourceSha256||typeof result.reviewDigest!=='string'||!HASH.test(result.reviewDigest)||!Array.isArray(result.items)||result.items.length>rows.length||typeof result.approved!=='boolean'||o.action==='approve'&&!result.approved)invalid();
 const items=(result.items as unknown[]).map(reviewItem),seen=new Set<string>(),sourceIds=new Set(rows.map(r=>r.productId));
 for(const item of items){if(seen.has(item.productId)||!sourceIds.has(item.productId))invalid();seen.add(item.productId);}
 // Whitelist the safe review projection; never forward raw bindings, link rows,
 // endpoints, IPs, SIMs, secrets or arbitrary database receipt fields to the UI.
 return {contract:'COS_OWNER_ASSIGNMENT_REVIEW_V1',stageId:o.stageId,sourceSha256:preview.sourceSha256,censusSha256:census.sourceSha256,reviewDigest:result.reviewDigest as string,approved:result.approved as boolean,items};
}

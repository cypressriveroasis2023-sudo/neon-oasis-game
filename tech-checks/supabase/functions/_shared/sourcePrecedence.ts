/** A reviewed import decision is not an Owner move or a camera/health identity. */
type Row=Record<string,any>;
const object=(v:unknown):v is Row=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const id=(v:unknown)=>typeof v==='string'&&/^[1-9]\d{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;
const text=(v:unknown)=>typeof v==='string'&&v===v.trim()&&v.length>0&&v.length<=250&&!/[\x00-\x1f\x7f]/.test(v);
export type SourcePrecedence={contract:'COS_REVIEWED_SOURCE_PRECEDENCE_V1';decisionId:string;reviewedSourceRevision:string;sourceRevision:string;unitKey:string;deviceIds:string[];legacyAuditId:string;legacyAuditSha256:string;legacyAuditRowSha256:string;reviewedAt:string;reviewKind:'administrator_import_review'};
const keys=['contract','decisionId','reviewedSourceRevision','sourceRevision','unitKey','deviceIds','legacyAuditId','legacyAuditSha256','legacyAuditRowSha256','reviewedAt','reviewKind'];
export function checkedSourcePrecedence(source:unknown):SourcePrecedence|null{
 if(!object(source)||!Object.hasOwn(source,'sourcePrecedence'))return null;
 const p=source.sourcePrecedence;
 if(source.schemaVersion!==1||source.sourceSystem!=='mhelpdesk_product_import'||source.entityKind!=='equipment_unit'||source.eligibility!=='FIELD'
  ||!object(p)||Object.keys(p).length!==keys.length||!keys.every(k=>Object.hasOwn(p,k))||p.contract!=='COS_REVIEWED_SOURCE_PRECEDENCE_V1'||p.reviewKind!=='administrator_import_review'
  ||!uuid(p.decisionId)||!uuid(p.reviewedSourceRevision)||!uuid(p.sourceRevision)||p.sourceRevision!==source.sourceRevision||p.reviewedSourceRevision===p.sourceRevision
  ||!text(p.unitKey)||!id(p.legacyAuditId)||!sha(p.legacyAuditSha256)||!sha(p.legacyAuditRowSha256)
  ||typeof p.reviewedAt!=='string'||!Number.isFinite(Date.parse(p.reviewedAt))
  ||!Array.isArray(p.deviceIds)||!p.deviceIds.length||p.deviceIds.length>1000||p.deviceIds.some((v:unknown)=>!id(v))||new Set(p.deviceIds).size!==p.deviceIds.length)return null;
 return {contract:p.contract,decisionId:p.decisionId,reviewedSourceRevision:p.reviewedSourceRevision,sourceRevision:p.sourceRevision,unitKey:p.unitKey,deviceIds:[...p.deviceIds],legacyAuditId:p.legacyAuditId,legacyAuditSha256:p.legacyAuditSha256,legacyAuditRowSha256:p.legacyAuditRowSha256,reviewedAt:p.reviewedAt,reviewKind:p.reviewKind};
}
/** Same length-prefixed UTF-8 fields as SQL. Preserve sub-millisecond audit time. */
export async function sourcePrecedenceAuditSha256(a:Row):Promise<string|null>{
 const auditId=String(a.id),ids=Array.isArray(a.device_ids)?a.device_ids.map(String):[];
 const stamp=typeof a.created_at==='string'?Date.parse(a.created_at):NaN;
 if(!id(auditId)||!text(a.unit_key)||!text(a.action)||!Number.isFinite(stamp)||!ids.length||ids.some(v=>!id(v))||new Set(ids).size!==ids.length)return null;
 const fraction=/\.(\d+)(?:Z|[+-]\d\d(?::?\d\d)?)$/.exec(a.created_at)?.[1]||'';
 const micros=String(BigInt(stamp)*1000n+BigInt((fraction+'000000').slice(3,6)));
 const values=[auditId,a.unit_key,a.action,a.contract??null,a.placement??null,a.control_id??null,a.request_id??null,a.site_label??null,a.street_address??null,micros,ids.sort((a,b)=>BigInt(a)<BigInt(b)?-1:1).join(',')];
 if(values.some(v=>v!==null&&typeof v!=='string'))return null;
 const encoder=new TextEncoder(),canonical=values.map(v=>v===null?'-1:':encoder.encode(v).length+':'+v).join('');
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(canonical))),x=>x.toString(16).padStart(2,'0')).join('');
}

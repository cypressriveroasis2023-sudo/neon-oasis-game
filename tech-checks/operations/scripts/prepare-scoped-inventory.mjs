import {createHash} from 'node:crypto';
const families=new Set(['Sniper','Sniper ES','Sniper 2','Sniper 2 SA','Sniper 4','Radar - Sniper','Thermal - Sniper','CAM-V']);
const fields=['unitNumber','category','customerId','customer','placement','lifecycle'];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Offline review plan, deliberately not executable SQL. No batch activation or
 * receipt timestamp changes are permitted by this plan. Source evidence is a
 * derived map, never represented as the original CSV byte hash. */
export function prepareScopedInventory({activeSha256,before,source,sourceEvidence,heldProductIds=[]}){
 if(!/^[a-f0-9]{64}$/.test(activeSha256)||!sourceEvidence?.libraryFileId||!sourceEvidence.receivedAt||!Number.isFinite(Date.parse(sourceEvidence.receivedAt)))throw Error('Source provenance and active revision required');
 const check=rows=>{
  if(!Array.isArray(rows)||!rows.length)throw Error('Complete record arrays required');
  const map=new Map();for(const r of rows){if(!r||!/^\d+$/.test(r.productId)||map.has(r.productId))throw Error('Duplicate or invalid ProductId');map.set(r.productId,r);}return map;
 };
 const old=check(before),current=check(source),holds=new Set(heldProductIds),operations=[],review=[];
 for(const row of source){
  if(!families.has(row.category))throw Error('Out-of-scope family');
  if(fields.some(k=>typeof row[k]!=='string')||!row.unitNumber||!row.customer||!/^\d+$/.test(row.customerId)||!['FIELD','SHOP'].includes(row.placement)||!['UNFLAGGED','DO_NOT_USE','MISSING'].includes(row.lifecycle))throw Error('Invalid source assignment');
  const previous=old.get(row.productId);
  if(holds.has(row.productId)||!previous){review.push({productId:row.productId,reason:!previous?'new_product_identity_requires_review':'explicit_identity_hold',target:row});continue;}
  if(!families.has(previous.category))throw Error('Existing ProductId belongs to another family');
  if(previous.unitNumber!==row.unitNumber||previous.lifecycle!==row.lifecycle||previous.category!==row.category){review.push({productId:row.productId,reason:'label_family_or_restriction_changed',target:row});continue;}
  const changes=Object.fromEntries(fields.filter(k=>previous[k]!==row[k]).map(k=>[k,{before:previous[k],after:row[k]}]));
  if(!Object.keys(changes).length)continue;
  if(previous.binding&&!/^[a-f0-9]{64}$/.test(previous.binding.expectedGuard))throw Error('Binding guard required');
  operations.push({productId:row.productId,expectedRecord:structuredClone(previous),expectedRecordSha256:hash(previous),expectedBindingGuard:previous.binding?.expectedGuard??null,changes,sourceEvidence:structuredClone(sourceEvidence)});
 }
 for(const row of before)if(families.has(row.category)&&!current.has(row.productId))review.push({productId:row.productId,reason:'absent_source_product_retain_history',previous:row});
 return {contract:'COS_SCOPED_INVENTORY_REVIEW_V1',executable:false,expectedActiveSha256:activeSha256,operations,review,
  invariants:{globalReceiptUnchanged:true,unaffectedRowsUnchanged:true,ipsEndpointsHealthHistoryUnchanged:true,noDeletes:true,noActivationChanges:true},
  requiredExecutionChecks:['Existing actor and tenant authorization','Exact expected active revision and before-record equality','Fresh authority-graph guard and no competing ProductId','Reject newer Owner or source edits','Append scoped evidence with its own timestamp; retain all other row authority timestamps','Append rollback evidence; restore only if scoped revision still matches']};
}

/** Explicit source replacement pairs hold identity; they never transfer a binding.
 * Returns private parameter data for review, not a database connection. */
export function scopedExecutionRequest({plan,before,source,replacements=[],actorId,organizationId,revision,requestId,evidence}){
 const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
 if(![actorId,organizationId,requestId].every(v=>uuid.test(v))||!Number.isSafeInteger(revision)||revision<0||plan.contract!=='COS_SCOPED_INVENTORY_REVIEW_V1')throw Error('Reviewed actor, tenant and scoped revision required');
 if(evidence?.kind!=='derived_mapping'||!/^libfile_[a-zA-Z0-9]+$/.test(evidence.libraryFileId)||!['sha256','authorizationSha256'].every(k=>/^[a-f0-9]{64}$/.test(evidence[k]))||!/(Z|[+-]\d\d:\d\d)$/.test(evidence.receivedAt)||!Number.isFinite(Date.parse(evidence.receivedAt)))throw Error('Derived source evidence required');
 const targets=new Map(source.map(r=>[r.productId,r])),old=new Map(before.map(r=>[r.productId,r]));
 const pick=r=>Object.fromEntries(['productId',...fields].map(k=>[k,r[k]]));
 const operations=plan.operations.map(op=>({mode:'assignment',expectedRecord:op.expectedRecord,after:pick(targets.get(op.productId))}));
 const used=new Set(operations.map(op=>op.expectedRecord.productId));
 for(const pair of replacements){
  const previous=old.get(pair.previousProductId),target=targets.get(pair.productId);
  if(!previous||!target||old.has(pair.productId)||targets.has(pair.previousProductId)||used.has(pair.previousProductId)||used.has(pair.productId)||!families.has(previous.category)||['unitNumber','category','lifecycle'].some(k=>previous[k]!==target[k]))throw Error('Invalid source-only replacement review');
  if(pair.inventoryOnlyReason!==undefined&&(pair.inventoryOnlyReason!=='no_sim'||target.placement!=='SHOP'))throw Error('Invalid inventory-only restriction');
  used.add(pair.previousProductId);used.add(pair.productId);operations.push({mode:'replace_source_hold',expectedRecord:previous,after:pick(target),...(pair.inventoryOnlyReason?{inventoryOnlyReason:pair.inventoryOnlyReason}:{})});
 }
 return {actorId,organizationId,baseSha256:plan.expectedActiveSha256,revision,requestId,evidence,operations};
}
/** SQL literals use PostgreSQL quoting, never shell interpolation. */
export function scopedStatements(request){
 const literal=value=>value===null?'null':"'"+String(value).replaceAll("'","''")+"'";
 const args=[request.actorId,request.organizationId,request.baseSha256,request.revision,request.requestId,JSON.stringify(request.evidence),JSON.stringify(request.operations)].map(literal).join(',');
 return {'dry-run.sql':`begin;\nselect cos_mhelp_placement_private.review_scoped_inventory(${args},false);\nrollback;\n`,
 'apply.sql':`begin;\nselect cos_mhelp_placement_private.review_scoped_inventory(${args},true);\ncommit;\n`,
 'rollback.sql':`begin;\nselect cos_mhelp_placement_private.rollback_scoped_inventory(${[request.actorId,request.organizationId,request.baseSha256,request.revision+1,request.requestId,request.evidence.authorizationSha256].map(literal).join(',')});\ncommit;\n`};
}

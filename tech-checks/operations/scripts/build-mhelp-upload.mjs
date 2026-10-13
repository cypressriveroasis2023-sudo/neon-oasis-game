/** Offline preparer. Private source bytes and generated SQL must stay outside git.
 * This script never connects to a provider or database and never executes SQL. */
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
export const sha=value=>createHash('sha256').update(value).digest('hex');
const positive=value=>typeof value==='string'&&/^[1-9][0-9]{0,14}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const normalized=value=>String(value).trim().replace(/\s+/g,' ').toLowerCase();
/** RFC4180 subset, including quoted CRLF, commas, escaped quotes and UTF-8 BOM. */
export function parseCsv(text){
 const rows=[];let row=[],cell='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(c==='"'){if(cell||closed)throw Error('Unexpected CSV quote');quoted=true;continue;}
  if(c===','||c==='\n'||c==='\r'){row.push(cell);cell='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;rows.push(row);row=[];}continue;}
  if(closed)throw Error('Unexpected text after CSV quote');cell+=c;
 }
 if(quoted)throw Error('Unclosed CSV quote');if(cell||row.length||closed){row.push(cell);rows.push(row);}
 if(!rows.length)throw Error('Empty CSV');const keys=rows.shift();keys[0]=keys[0].replace(/^\uFEFF/,'');
 if(new Set(keys).size!==keys.length)throw Error('Duplicate CSV columns');
 return rows.filter(r=>r.some(Boolean)).map((r,i)=>{if(r.length!==keys.length)throw Error('CSV column mismatch at record '+(i+2));return Object.fromEntries(keys.map((k,j)=>[k,r[j]]));});
}
export function prepare({csvBytes,canonical,review,guards,trackerSupplement=null,aliasReview=null,expectedActiveSha256=null}){
 if(!canonical?.source||sha(csvBytes)!==canonical.source.sha256||csvBytes.length!==canonical.source.size_bytes)throw Error('Original CSV hash/size does not match source receipt');
 if(review?.source?.sha256!==canonical.source.sha256)throw Error('Identity review is for a different source');
 const rows=parseCsv(csvBytes.toString('utf8')),source=canonical.source,companies=canonical.authority.company_customer_ids;
 if(rows.length!==canonical.records.length||rows.length!==canonical.summary.records||rows.length!==review.records.length)throw Error('Incomplete source/review census');
 const sourceMap=new Map(canonical.records.map(r=>[r.product_id,r])),reviews=new Map(review.records.map(r=>[r.product_id,r])),guardMap=new Map(guards.map(r=>[r.productId,r]));
 if(sourceMap.size!==rows.length||reviews.size!==rows.length||guardMap.size!==guards.length)throw Error('Duplicate reviewed ProductId');
 const seen=new Set(),targets=new Set();
 const records=rows.map((raw,i)=>{
  const s=sourceMap.get(raw.ProductId);let r=reviews.get(raw.ProductId);
  const alias=(Array.isArray(aliasReview?.records)?aliasReview.records:[aliasReview]).find(a=>a?.productId===raw.ProductId||a?.product_id===raw.ProductId);
  if(alias?.matchMethod==='owner_confirmed_alias'){
   if(alias.contract!=='COS_OWNER_CONFIRMED_ALIAS_V1'||alias.sourceLabel!==raw.ProductModel||!alias.approval?.messageId||!alias.approval?.ownerQuote||!alias.canonicalDisplay||alias.canonicalFamily!==alias.sourceFamily)throw Error('Invalid explicit Owner alias evidence');
   r={...r,status:'owner_confirmed_alias',match_method:'owner_confirmed_alias',tracker_id:alias.trackerId,native_unit_id:alias.nativeUnitId,canonical_family_unit:alias.canonicalFamily+':'+alias.canonicalUnitIdentifier,hold_reasons:[],evidence:alias,registry_candidates:{tracker:alias.trackerId?[{id:alias.trackerId,label:alias.unitLabels[alias.trackerId]}]:[],native:alias.nativeUnitId?[{id:alias.nativeUnitId,label:alias.unitLabels[alias.nativeUnitId]}]:[]}};
  }
  if(!positive(raw.ProductId)||seen.has(raw.ProductId)||!positive(raw.CustomerId)||!s||!r)throw Error('Invalid or duplicate ProductId/customer identity');seen.add(raw.ProductId);
  for(const [key,csvKey] of [['unit','ProductModel'],['category','Category'],['customer_id','CustomerId'],['customer','CustomerName'],['address','Address'],['city','City'],['state','State'],['zip','Zip']])if(s[key]!==raw[csvKey])throw Error('Sanitized source differs from CSV: '+key);
  if(r.source_unit!==raw.ProductModel||r.source_category!==raw.Category||r.csv_record!==i+2||s.csv_record!==i+2)throw Error('Reviewed source identity/row changed');
  const placement=Object.hasOwn(companies,raw.CustomerId)?'SHOP':'FIELD';
  if(placement==='SHOP'&&normalized(companies[raw.CustomerId])!==normalized(raw.CustomerName))throw Error('Company CustomerId label changed');
  const lifecycle=/\bDO\s+NOT\s+USE\b/i.test(raw.ProductModel)?'DO_NOT_USE':/\bMISSING\b/i.test(raw.ProductModel)?'MISSING':'UNFLAGGED';
  if(s.placement!==placement||s.lifecycle!==lifecycle)throw Error('Placement/lifecycle review mismatch');
  const possibleAliasUnitIds=[...new Set([...(r.registry_candidates?.tracker||[]),...(r.registry_candidates?.native||[])].map(x=>x.id))];
    if(alias)possibleAliasUnitIds.push(...(alias.candidateUnitIds||[]));
  let binding=null,holdReason=r.hold_reasons?.join(';')||null;
  if(['existing_reviewed_binding','unambiguous_canonical_candidate','owner_confirmed_alias'].includes(r.status)){
   const g=guardMap.get(raw.ProductId);if(!g||!/^[a-f0-9]{64}$/.test(g.expectedGuard)||!/^[a-f0-9]{64}$/.test(g.representationEvidenceSha256))throw Error('Current authority-graph guard required');
   if(g.competingProductId)holdReason='competing_active_product_id';
   else if(!g.representedUnitIds?.length)holdReason='bound_inventory_not_in_reviewed_map';
   else if(alias?.hold===true)holdReason=alias.reason||'unresolved_possible_alias';
   else{
    const tracker=(r.registry_candidates.tracker||[]).find(x=>x.id===r.tracker_id),native=(r.registry_candidates.native||[]).find(x=>x.id===r.native_unit_id);
    if(r.tracker_id&&!tracker||r.native_unit_id&&!native||!r.tracker_id&&!r.native_unit_id)throw Error('Missing selected identity evidence');
    const method=r.match_method==='owner_confirmed_alias'?'owner_confirmed_alias':r.match_method==='reviewed_product_id'?'reviewed_product_id':r.match_method==='exact_canonical_family_unit'?'exact_family_unit':r.match_method==='exact_canonical_family_unit_with_archive_exclusion'?'archived_alias':null;
    if(!method||method!=='reviewed_product_id'&&!r.canonical_family_unit)throw Error('Unsupported identity matching');
    binding={productId:raw.ProductId,trackerId:r.tracker_id||null,nativeUnitId:r.native_unit_id||null,trackerLabel:tracker?.label||null,nativeLabel:native?.label||null,fullLabel:raw.ProductModel,representedUnitIds:g.representedUnitIds,representationEvidenceSha256:g.representationEvidenceSha256,matchMethod:method,canonicalKey:r.canonical_family_unit,evidenceSha256:sha(JSON.stringify({identity:r.evidence,representedUnitIds:g.representedUnitIds,representationEvidenceSha256:g.representationEvidenceSha256})),reviewEvidence:r.evidence,expectedGuard:g.expectedGuard};
    const prior=s.reviewed_binding;
    if(prior?.state==='confirmed'&&prior.product_id===raw.ProductId&&positive(prior.customer_id)&&['FIELD','SHOP'].includes(prior.placement))binding.previousAssignment={productId:raw.ProductId,customerId:prior.customer_id,placement:prior.placement,serviceLocationId:prior.service_location_id||null,observedAt:prior.observed_at};
    for(const target of [binding.trackerId,binding.nativeUnitId].filter(Boolean)){if(!uuid(target)||targets.has(target))throw Error('Duplicate or invalid bound inventory identity');targets.add(target);}
    holdReason=null;
   }
  }
  const candidates=binding?[]:[...new Set(possibleAliasUnitIds)];if(candidates.some(x=>!uuid(x)))throw Error('Invalid possible-alias target');
  return {productId:raw.ProductId,unitNumber:raw.ProductModel,category:raw.Category,customerId:raw.CustomerId,customer:raw.CustomerName,
   ...(alias?.canonicalDisplay?{displayUnitNumber:alias.canonicalDisplay,displayAuthorizationSha256:sha(JSON.stringify({approval:alias.approval,displayApproval:alias.displayApproval||null,canonicalDisplay:alias.canonicalDisplay}))}:{}),sourceAddress:{street:raw.Address,city:raw.City,state:raw.State,zip:raw.Zip},sourceRow:i+2,placement,lifecycle,
   placementHeld:alias?.placementHeld===true,sourceDates:{creationDate:raw.CreationDate,statusDates:Object.fromEntries(Object.entries(raw).filter(([k,v])=>k.endsWith('_Date_of_Status')&&v))},binding,holdReason,possibleAliasUnitIds:candidates};
 });
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/.test(source.received_at_conversation_minute_utc))throw Error('Verified upload receipt minute required');
 const receivedAt=source.received_at_conversation_minute_utc.replace('Z',':00Z');
 const trackerSource=trackerSupplement?.trackerSource||trackerSupplement?.source,trackerRecords=trackerSupplement?.trackerRecords||trackerSupplement?.records||[];
 if(trackerSupplement&&(!trackerSource||trackerSource.complete!==true||trackerSource.contract!=='COS_CURRENT_TRACKER_CENSUS_V1'||!/^[a-f0-9]{64}$/.test(trackerSource.sourceSha256)||trackerSource.totalSourceRecords!==trackerRecords.length))throw Error('Complete reviewed tracker census required');
 if(trackerRecords.some(r=>r.binding?.state==='linked'&&(!/^[a-f0-9]{64}$/.test(r.binding.expectedGuard)||!Array.isArray(r.binding.representedUnitIds))))throw Error('Current tracker identity guard required');
 const receipt={contract:'COS_MHELP_UPLOAD_V1',sourceSha256:source.sha256,libraryFileId:source.library_file_id,filename:source.filename,receivedMessageId:source.received_message_id,
  receivedAt,receivedAtPrecision:'minute',exportAsOf:null,recordCount:records.length,companyCustomerIds:Object.keys(companies),authorizationSha256:sha(JSON.stringify(canonical.authority)),
  sourceDatesAreNotExportTimestamps:true,trackerRecords:trackerSupplement?.trackerRecords||trackerSupplement?.records||[],trackerSource:trackerSupplement?.trackerSource||trackerSupplement?.source||null};
 if(expectedActiveSha256!==null&&!/^[a-f0-9]{64}$/.test(expectedActiveSha256))throw Error('Invalid expected active upload');
 return {receipt,records,expectedActiveSha256,summary:{totalRecords:records.length,boundRecords:records.filter(r=>r.binding).length,fieldRecords:records.filter(r=>r.placement==='FIELD').length,shopRecords:records.filter(r=>r.placement==='SHOP').length,unflaggedFieldRecords:records.filter(r=>r.placement==='FIELD'&&r.lifecycle==='UNFLAGGED').length,unflaggedShopRecords:records.filter(r=>r.placement==='SHOP'&&r.lifecycle==='UNFLAGGED').length,heldRecords:records.filter(r=>!r.binding&&r.possibleAliasUnitIds.length).length,unlinkedRecords:records.filter(r=>!r.binding&&!r.possibleAliasUnitIds.length).length}};
}
const literal=value=>value===null?'null':"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
const str=value=>value===null?'null':"'"+value.replaceAll("'","''")+"'";
export function statements(plan){const start="\\set ON_ERROR_STOP on\nbegin;\nset local lock_timeout='2s';\nset local statement_timeout='30s';\n";
 const invoke=apply=>'select cos_mhelp_placement_private.review_upload('+literal(plan.receipt)+','+literal(plan.records)+','+str(plan.expectedActiveSha256)+','+apply+');\n';
 return {'dry-run.sql':start+invoke('false')+'rollback;\n','apply.sql':start+invoke('true')+'commit;\n',
 'rollback.sql':start+'select cos_mhelp_placement_private.rollback_upload('+str(plan.receipt.sourceSha256)+','+str(plan.expectedActiveSha256)+','+str(plan.receipt.authorizationSha256)+');\ncommit;\n'};
}
async function outside(path){const actual=await realpath(path);if(actual===repo||actual.startsWith(repo+'/'))throw Error('Private input/output must stay outside the repository');return actual;}
export async function build({csvPath,canonicalPath,reviewPath,guardsPath,outPath,trackerPath,aliasPath}){
 const inputs=await Promise.all([csvPath,canonicalPath,reviewPath,guardsPath].map(outside));
 await outside(dirname(resolve(outPath)));await mkdir(outPath,{recursive:true,mode:0o700});const out=await outside(outPath);
 const [csvBytes,...json]=await Promise.all(inputs.map(p=>readFile(p)));const plan=prepare({csvBytes,canonical:JSON.parse(json[0]),review:JSON.parse(json[1]),guards:JSON.parse(json[2]),trackerSupplement:trackerPath?JSON.parse(await readFile(await outside(trackerPath),'utf8')):null,aliasReview:aliasPath?JSON.parse(await readFile(await outside(aliasPath),'utf8')):null});
 const files={...statements(plan),'normalized-plan.json':JSON.stringify(plan,null,2)+'\n'};const hashes={};
 for(const [name,content] of Object.entries(files)){await writeFile(resolve(out,name),content,{mode:0o600,flag:'wx'});hashes[name]=sha(content);}
 const manifest={status:'prepared_not_executed',sourceSha256:plan.receipt.sourceSha256,...plan.summary,files:hashes,productionWrites:0,providerCalls:0};
 await writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [csvPath,canonicalPath,reviewPath,guardsPath,outPath,trackerPath,aliasPath]=process.argv.slice(2);if(!outPath)throw Error('Usage: build-mhelp-upload.mjs CSV CANONICAL REVIEW GUARDS PRIVATE_OUTPUT [TRACKER] [ALIASES]');
 console.log(JSON.stringify(await build({csvPath,canonicalPath,reviewPath,guardsPath,outPath,trackerPath,aliasPath}),null,2));
}

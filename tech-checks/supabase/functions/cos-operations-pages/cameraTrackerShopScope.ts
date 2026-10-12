import {canonicalTrackerKey,cameraTimestamp} from './cameraPlacementEvidence.ts';
import {placementMatchKey,placementIdentityConcernKey} from './placementProjection.ts';

type Row=Record<string,any>;
export type ShopScopeRead={inventory:Row[];sources:Row[];nativeUnits:Row[];devices:Row[];audits:Row[];identity:Row;matches:Row[];ownerClaims:Row[];mhelpReceipt?:Row|null};
const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const object=(v:unknown):v is Row=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const decimal=(v:unknown)=>typeof v==='string'&&/^[1-9]\d{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;
const recordId=(v:unknown)=>decimal(v)?String(v):typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):null;
const full=(v:unknown)=>typeof v==='string'?v.trim().replace(/\s+/g,' ').toUpperCase():'';
const key=(v:unknown)=>placementMatchKey(v);
const concern=(v:unknown)=>placementIdentityConcernKey(v);
const id=(r:Row)=>(r.readOnly===true?'tracker':'equipment_unit')+'|'+r.id;
const sourceId=(s:Row)=>s.entityKind+'|'+s.nativeUnitId;
// This optional allowance is smaller than the baseline fleet reader. Oversized
// evidence stays review instead of competing with the primary health response.
const MAX_ROWS=5000,MAX_WORK=2000000;
const validArray=(v:unknown):v is Row[]=>Array.isArray(v)&&v.length<=MAX_ROWS&&v.every(object);
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const sourceFields=['schemaVersion','organizationId','sourceSystem','entityKind','nativeUnitId','productId','unitNumber','sourceRevision','eventId','sourceFileSha256','sourceRowSha256','nativeGuardSha256','placement','eligibility'];
const sourceProof=(s:Row)=>sourceFields.map(k=>s[k]);
const inventoryProof=(r:Row)=>['id','unitNumber','readOnly','placementSource','placementAuditId','placement','placementStatus','hasUnitGps','locationVerification','installedSiteId'].map(k=>r[k]);
function nativeProof(s:Row){
 const p=s.nativeSourceIdentity;
 return object(p)&&p.contract==='COS_IMPORTED_NATIVE_SOURCE_IDENTITY_V1'&&uuid(p.trackerId)&&typeof p.trackerUnitNumber==='string'
  &&['nativeUnitId','productId','unitNumber','sourceRevision','sourceFileSha256','sourceRowSha256','nativeGuardSha256'].every(k=>p[k]===s[k])
  &&key(p.trackerUnitNumber)===key(s.unitNumber);
}
function validSource(s:Row){
 return s.schemaVersion===1&&s.organizationId===ORG&&s.sourceSystem==='mhelpdesk_product_import'
  &&['equipment_unit','tracker'].includes(s.entityKind)&&uuid(s.nativeUnitId)&&uuid(s.sourceRevision)&&decimal(s.productId)&&decimal(s.eventId)
  &&typeof s.unitNumber==='string'&&key(s.unitNumber).startsWith('typed:')&&['sourceFileSha256','sourceRowSha256','nativeGuardSha256'].every(k=>sha(s[k]))
  &&s.placement==='SHOP'&&s.eligibility==='tombstone'&&s.installation===null&&s.addressSha256===null&&s.suppliedComponents===null
  &&!Object.hasOwn(s,'sourcePrecedence')&&!Object.hasOwn(s,'sourceRecordId')
  &&(s.entityKind==='equipment_unit'?nativeProof(s):s.nativeSourceIdentity===null);
}

// A separately enabled placement feed is deny-only here: it can veto an older
// import proof but can never supply the positive SHOP or camera identity proof.
const MHELP_FRESH_MS=40*60*1000;
const receiptFields=['trackerId','nativeUnitId','trackerLabel','nativeLabel','guardCurrent','state','placement','observedAt','locationReview'];
const receiptLabel=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=250&&!/[\x00-\x1f\x7f<>]/.test(v);
function validMhelpReceipt(value:unknown){
 if(value==null)return true;
 if(!object(value)||value.contract!=='COS_MHELP_PLACEMENT_V1'||typeof value.enabled!=='boolean'||!Array.isArray(value.items)||value.items.length>1000)return false;
 const rows=value.items;
 return rows.every((r:unknown)=>object(r)&&uuid(r.trackerId)&&(r.nativeUnitId===null||uuid(r.nativeUnitId))&&receiptLabel(r.trackerLabel)
  &&(r.nativeLabel===null||receiptLabel(r.nativeLabel))&&['confirmed','held'].includes(r.state))
  &&new Set(rows.map((r:Row)=>r.trackerId)).size===rows.length
  &&new Set(rows.filter((r:Row)=>r.nativeUnitId!==null).map((r:Row)=>r.nativeUnitId)).size===rows.filter((r:Row)=>r.nativeUnitId!==null).length;
}
function receiptCovers(s:Row,r:Row){
 const ids=[s.nativeUnitId,...(s.entityKind==='equipment_unit'?[s.nativeSourceIdentity.trackerId]:[])],base=concern(s.unitNumber);
 // Label matches are vetoes only, including an identity replacement or sibling.
 return ids.includes(r.trackerId)||ids.includes(r.nativeUnitId)||concern(r.trackerLabel)===base||concern(r.nativeLabel)===base;
}
function mhelpAgrees(s:Row,before:ShopScopeRead,after:ShopScopeRead){
 const receipts=[before.mhelpReceipt,after.mhelpReceipt];
 const modes=receipts.map(r=>r==null?'absent':r.enabled?'enabled':'disabled');
 if(modes[0]!==modes[1])return false;
 if(modes[0]!=='enabled')return true;
 const covered=receipts.map(r=>r!.items.filter((v:Row)=>receiptCovers(s,v)));
 // An enabled feed needs positive current coverage in both observations; a
 // vanished link cannot resurrect the older imported SHOP allowance.
 if(covered.some(rows=>rows.length!==1))return false;
 const [old,current]=covered.map(rows=>rows[0]),now=Date.now();
 const fresh=(value:unknown)=>{const at=cameraTimestamp(value,now).at;return at!==null&&now-Date.parse(at)<=MHELP_FRESH_MS;};
 for(let n=0;n<2;n++){
  const r=covered[n][0],receipt=receipts[n]!;
  if(r.guardCurrent!==true||r.state!=='confirmed'||r.placement!=='SHOP'||typeof r.locationReview!=='boolean'||!fresh(r.observedAt)||!fresh(receipt.lastSuccessAt)
   ||Date.parse(receipt.lastSuccessAt)<Date.parse(r.observedAt))return false;
  if(s.entityKind==='equipment_unit'){
   if(r.nativeUnitId!==s.nativeUnitId||r.nativeLabel!==s.unitNumber||r.trackerId!==s.nativeSourceIdentity.trackerId||r.trackerLabel!==s.nativeSourceIdentity.trackerUnitNumber)return false;
  }else if(r.trackerId!==s.nativeUnitId||r.trackerLabel!==s.unitNumber||r.nativeUnitId!==null||r.nativeLabel!==null)return false;
 }
 return same(receiptFields.map(k=>old[k]),receiptFields.map(k=>current[k]))&&before.mhelpReceipt!.lastSuccessAt===after.mhelpReceipt!.lastSuccessAt;
}

function validRead(r:ShopScopeRead){
 if(!object(r)||![r.inventory,r.sources,r.nativeUnits,r.devices,r.audits,r.matches,r.ownerClaims].every(validArray)||!object(r.identity)||!validMhelpReceipt(r.mhelpReceipt))return false;
 if(r.inventory.some(v=>!uuid(v.id)||typeof v.unitNumber!=='string'||typeof v.readOnly!=='boolean')||new Set(r.inventory.map(id)).size!==r.inventory.length
  ||r.sources.some(v=>!['equipment_unit','tracker'].includes(v.entityKind)||!uuid(v.nativeUnitId)||typeof v.unitNumber!=='string')||new Set(r.sources.map(sourceId)).size!==r.sources.length
  ||r.nativeUnits.some(v=>!uuid(v.id)||v.organization_id!==ORG||typeof v.unit_number!=='string')||new Set(r.nativeUnits.map(v=>v.id)).size!==r.nativeUnits.length
  ||r.devices.some(v=>!recordId(v.id)||typeof v.unit_key!=='string')||new Set(r.devices.map(v=>recordId(v.id))).size!==r.devices.length
  ||r.audits.some(v=>!recordId(v.id)||typeof v.unit_key!=='string'||!Array.isArray(v.device_ids)||v.device_ids.some((d:unknown)=>!recordId(d))||new Set(v.device_ids.map(recordId)).size!==v.device_ids.length)
  ||new Set(r.audits.map(v=>recordId(v.id))).size!==r.audits.length
  ||r.matches.some(v=>!uuid(v.id)||!uuid(v.equipment_unit_id))||new Set(r.matches.map(v=>v.id)).size!==r.matches.length
  ||r.ownerClaims.some(v=>!uuid(v.id)||!uuid(v.native_unit_id)||typeof v.legacy_unit_key!=='string')||new Set(r.ownerClaims.map(v=>v.id)).size!==r.ownerClaims.length)return false;
 const native=r.inventory.filter(v=>!v.readOnly);
 const nativeById=new Map(r.nativeUnits.map(n=>[n.id,n]));
 if(native.length!==r.nativeUnits.length||native.some(v=>nativeById.get(v.id)?.unit_number!==v.unitNumber))return false;
 const i=r.identity;
 return i.identityVersion===1&&validArray(i.unitIdentities)&&validArray(i.identityWarnings)
  &&(i.ownerConfirmedIdentityVersion===undefined?i.ownerConfirmedUnitIdentities===undefined:i.ownerConfirmedIdentityVersion===1&&validArray(i.ownerConfirmedUnitIdentities))
  &&[...i.unitIdentities,...(i.ownerConfirmedUnitIdentities||[]),...i.identityWarnings].every(p=>typeof p.unitId==='string'&&Array.isArray(p.unitKeys)&&p.unitKeys.every((k:unknown)=>typeof k==='string')&&Array.isArray(p.deviceIds));
}
function eligible(s:Row,r:ShopScopeRead){
 if(!validSource(s))return false;
 const rows=r.inventory.filter(v=>id(v)===sourceId(s));if(rows.length!==1)return false;
 const row=rows[0],base=concern(s.unitNumber);
 if(row.unitNumber!==s.unitNumber||r.inventory.filter(v=>concern(v.unitNumber)===base).length!==1
  ||r.sources.filter(v=>concern(v.unitNumber)===base).length!==1||r.sources.filter(v=>v.sourceSystem===s.sourceSystem&&v.productId===s.productId).length!==1
  ||row.placementSource==='owner'||row.placementAuditId!=null||row.placement==='UNKNOWN'||row.placementStatus==='needs_identity_review'
  ||row.hasUnitGps===true||row.locationVerification==='owner_verified'||row.installedSiteId!=null)return false;
 // Existing guarded RPC output is the positive durable identity proof. Labels
 // only select a synthetic inventory placeholder, never any provider resource.
 if(s.entityKind==='equipment_unit'&&r.nativeUnits.filter(v=>v.id===s.nativeUnitId&&v.unit_number===s.unitNumber).length!==1)return false;
 if(r.devices.some(d=>concern(d.unit_key)===base)||r.audits.some(a=>concern(a.unit_key)===base))return false;
 if(r.matches.some(m=>m.equipment_unit_id===s.nativeUnitId)||r.ownerClaims.some(c=>c.native_unit_id===s.nativeUnitId||concern(c.legacy_unit_key)===base))return false;
 const i=r.identity;
 if([...i.unitIdentities,...(i.ownerConfirmedUnitIdentities||[]),...i.identityWarnings].some(p=>p.unitId===s.nativeUnitId||p.unitKeys.some((k:string)=>concern(k)===base)))return false;
 return true;
}

export type ShopScopeFallback='timeout'|'source-read'|'current-read'|'projection-invalid';
type ShopScopeReader={onFallback?:(reason:ShopScopeFallback)=>void;readSources:(inventory:Row[],signal:AbortSignal)=>Promise<Row[]>;readCurrent:(signal:AbortSignal)=>Promise<Omit<ShopScopeRead,'sources'>>};
/** Optional bounded read-through. Never caches an allowance or returns partial
 * pages. Abort propagates to every source/snapshot/identity fetch. These are
 * point-in-time observations, not a cross-database lock or an ABA guarantee. */
export async function currentTrackerShopScope(summary:Row,tracker:Row[],initial:Omit<ShopScopeRead,'sources'>,reader:ShopScopeReader,timeoutMs=10000):Promise<Row>{
 let reported=false;
 const fallback=(reason:ShopScopeFallback)=>{if(reported)return;reported=true;try{reader.onFallback?.(reason);}catch{/* Diagnostics never affect presentation. */}};
 if(!summary?.rows?.some((r:Row)=>r.trackerOnly===true&&r.scope==='unknown'&&String(r.id).startsWith('tracker:')))return summary;
 if(!validArray(initial?.inventory)||!initial.inventory.length){fallback('projection-invalid');return summary;}
 const controller=new AbortController(),deadline=Date.now()+timeoutMs;let timer:ReturnType<typeof setTimeout>|undefined,stage:ShopScopeFallback='source-read';
 const bounded=new Promise<Row>(resolve=>{timer=setTimeout(()=>{controller.abort();fallback('timeout');resolve(summary);},timeoutMs);});
 const operation=(async()=>{
  const before={...initial,sources:await reader.readSources(initial.inventory,controller.signal)};
  controller.signal.throwIfAborted();stage='current-read';
  const current=await reader.readCurrent(controller.signal);controller.signal.throwIfAborted();stage='source-read';
  const after={...current,sources:await reader.readSources(current.inventory,controller.signal)};
  controller.signal.throwIfAborted();stage='projection-invalid';
  const result=projectTrackerShopScope(summary,tracker,before,after,deadline);
  // No admissible current proof is distinct from a failed source fetch. These
  // fixed reasons contain no source values, identity, or exception messages.
  if(result===summary)fallback(Date.now()>=deadline?'timeout':'projection-invalid');
  return result;
 })().catch(()=>{fallback(controller.signal.aborted||Date.now()>=deadline?'timeout':stage);return summary;});
 try{return await Promise.race([operation,bounded]);}finally{clearTimeout(timer);controller.abort();}
}

/** Pure, optional summary-v3 presentation. Call only with two complete reads of
 * the existing guarded source RPC and corresponding inventory/Owner snapshots.
 * A failure returns the original unresolved summary. No provider proof, field
 * placement, camera association, deletion, import or database write is made.
 */
export function projectTrackerShopScope(summary:Row,tracker:Row[],before:ShopScopeRead,after:ShopScopeRead,deadline=Infinity):Row{
 if(!object(summary)||summary.evidenceVersion!==2||!validArray(summary.rows)||!object(summary.inventory)||!validArray(tracker)||!validRead(before)||!validRead(after))return summary;
 const candidates=summary.rows.filter(r=>r.trackerOnly===true&&r.scope==='unknown'&&String(r.id).startsWith('tracker:')).length;
 const scanSize=summary.rows.length+tracker.length+[before,after].reduce((n,r)=>n+r.inventory.length+r.sources.length+r.nativeUnits.length+r.devices.length+r.audits.length+r.matches.length+r.ownerClaims.length+r.identity.unitIdentities.length+r.identity.identityWarnings.length+(r.identity.ownerConfirmedUnitIdentities?.length||0)+(r.mhelpReceipt?.items.length||0),0);
 if(candidates*scanSize>MAX_WORK||Date.now()>=deadline)return summary;
 if(tracker.some(t=>['canonical_family','unit_tag','source_label','tracker_state'].some(k=>typeof t[k]!=='string')))return summary;
 const inventory=summary.inventory;
 const counts=['allRecords','activeFieldRecords','activeShopRecords','inactiveRecords','unknownScopeRecords'];
 if(counts.some(k=>!Number.isSafeInteger(inventory[k])||inventory[k]<0)||inventory.allRecords!==summary.rows.length||summary.totalDevices!==inventory.allRecords
  ||inventory.allRecords!==inventory.activeFieldRecords+inventory.activeShopRecords+inventory.inactiveRecords+inventory.unknownScopeRecords
  ||summary.shopRoot!==inventory.activeShopRecords||summary.fieldDevices!==inventory.activeFieldRecords
  ||new Set(summary.rows.map(r=>String(r.id))).size!==summary.rows.length)return summary;
 for(const [scope,count] of [['field','activeFieldRecords'],['shop','activeShopRecords'],['inactive','inactiveRecords'],['unknown','unknownScopeRecords']])if(summary.rows.filter(r=>r.scope===scope).length!==inventory[count])return summary;
 const moved=new Set<string>();
 for(const row of summary.rows){
  if(Date.now()>=deadline)return summary;
  if(row.trackerOnly!==true||row.type!=='tracker_unit'||row.scope!=='unknown'||row.status!=='review'||typeof row.id!=='string'||!row.id.startsWith('tracker:'))continue;
  const records=tracker.filter(t=>t.tracker_state==='field_or_unknown'&&'tracker:'+canonicalTrackerKey(t as any)===row.id);
  if(records.length!==1||tracker.filter(t=>'tracker:'+canonicalTrackerKey(t as any)===row.id).length!==1
   ||full(records[0].source_label)!==full(row.unit)||!key(row.unit).startsWith('typed:')
   ||key(records[0].canonical_family+' '+records[0].unit_tag)!==key(row.unit))continue;
  const fullKey=key(row.unit),base=concern(row.unit);
  if(tracker.filter(t=>concern(t.source_label)===base).length!==1||summary.rows.filter(r=>concern(r.unit)===base).length!==1)continue;
  const sources=before.sources.filter(s=>key(s.unitNumber)===fullKey);if(sources.length!==1)continue;
  const source=sources[0],fresh=after.sources.filter(s=>sourceId(s)===sourceId(source));
  if(fresh.length!==1||!eligible(source,before)||!eligible(fresh[0],after)||!same(sourceProof(source),sourceProof(fresh[0]))||!mhelpAgrees(source,before,after))continue;
  if(source.entityKind==='equipment_unit'&&!same(source.nativeSourceIdentity,fresh[0].nativeSourceIdentity))continue;
  const oldRow=before.inventory.find(r=>id(r)===sourceId(source))!,newRow=after.inventory.find(r=>id(r)===sourceId(source))!;
  if(!same(inventoryProof(oldRow),inventoryProof(newRow)))continue;
  if(source.entityKind==='equipment_unit'&&!same(before.nativeUnits.find(r=>r.id===source.nativeUnitId),after.nativeUnits.find(r=>r.id===source.nativeUnitId)))continue;
  moved.add(row.id);
 }
 if(!moved.size||Date.now()>=deadline)return summary;
 return {...summary,rows:summary.rows.map(r=>moved.has(r.id)?{...r,scope:'shop'}:r),shopRoot:summary.shopRoot+moved.size,
  inventory:{...inventory,activeShopRecords:inventory.activeShopRecords+moved.size,unknownScopeRecords:inventory.unknownScopeRecords-moved.size}};
}

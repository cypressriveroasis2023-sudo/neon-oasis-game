/** Physical placement derives only from future, version-marked Owner decisions. No credentials or writes. */
type Row=Record<string,any>;
const object=(v:unknown):v is Row=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const fullKey=(v:unknown)=>typeof v==='string'?v.trim().replace(/\s+/g,' ').toUpperCase():'';
const auditKey=(v:unknown)=>typeof v==='string'?v.trim().toUpperCase():'';
const idString=(v:unknown)=>typeof v==='string'&&/^[1-9]\d*$/.test(v)?v:typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):null;
const stamp=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?Date.parse(v):NaN;
const text=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
function fail(message:string):never{throw Object.assign(new Error(message),{status:503});}
/** Typed families retain embedded digits and decimal/HDC suffixes. Unknown labels need a complete exact match. */
export function placementMatchKey(value:unknown):string {
 if(typeof value!=='string')return '';
 const m=/^(SNIPER\s*[24]|RECON\s*(?:2|II)|SOLAR\s*(?:STAND\s*72|POLE\s*72|SKID\s*144))(?=\s|[-#])\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)(HD4|HDC[24]S?)?$/i.exec(value.trim())
 ||/^(HELIOS|RANGER|AXIS\s*SOLAR\s*SPOTTER|AXIS\s*SPOTTER|SOLAR\s*SPOTTER|SPOTTER|SS\s*HYBRID|SNIPER|CAM\s*V|RECON|RII|RI|RSU|ALPHA)\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)(HD4|HDC[24]S?)?$/i.exec(value.trim());
 if(!m)return 'full:'+fullKey(value);
 const f=m[1].toUpperCase().replace(/\s/g,''),family=({RI:'RECON',RII:'RECON2',RECONII:'RECON2'} as Row)[f]||f;
 const [whole,fraction]=m[2].split('.');if(Number(whole)===0)return 'full:'+fullKey(value);
 return 'typed:'+family+'|'+Number(whole)+(fraction===undefined?'':'.'+fraction)+(m[3]?'|'+m[3].toUpperCase():'');
}
/** DENIAL ONLY: related model/variant labels may need Owner review; never a join. */
export function placementIdentityConcernKey(value:unknown):string {
 const key=placementMatchKey(value);if(!key.startsWith('typed:'))return key;
 const [family,number]=key.slice(6).split('|');
 const related=['SPOTTER','SOLARSPOTTER','AXISSPOTTER','AXISSOLARSPOTTER'].includes(family)?'SPOTTER':/^SNIPER[24]?$/.test(family)?'SNIPER':/^RECON2?$/.test(family)?'RECON':family;
 return 'concern:'+related+'|'+number;
}
/** Audit query projects only these columns; arbitrary audit JSON, reasons and before_state stay private. */
export function currentOwnerPlacements(audits:unknown,devices:unknown):Row[] {
 if(!Array.isArray(audits)||!Array.isArray(devices)||audits.length>100000||devices.length>100000)fail('Current placement could not be verified. Reload the unit.');
 const latest=new Map<string,Row>(),marked=new Map<string,Row>();
 for(const a of audits){
  if(!object(a)||!idString(a.id)||typeof a.unit_key!=='string')fail('Placement history returned an invalid identity.');
  const key=auditKey(a.unit_key),previous=latest.get(key);
  if(!previous||BigInt(idString(a.id)!)>BigInt(idString(previous.id)!))latest.set(key,a);
  const previousMarked=marked.get(key);if(a.contract==='COS_CAMERA_PLACEMENT_V2'&&(!previousMarked||BigInt(idString(a.id)!)>BigInt(idString(previousMarked.id)!)))marked.set(key,a);
 }
 const overrides:Row[]=[];
 for(const latestAudit of latest.values()){
  const a=latestAudit.contract==='COS_CAMERA_PLACEMENT_V2'?latestAudit:marked.get(auditKey(latestAudit.unit_key));if(!a)continue;
  let conflictReason=latestAudit!==a?'Camera inventory changed after the last Owner move. Review this unit’s identity.':null;
  const ids=Array.isArray(a.device_ids)?a.device_ids.map(idString):[];
  const current=devices.filter(d=>object(d)&&auditKey(d.unit_key)===auditKey(a.unit_key)).map(d=>idString(d.id));
  if(!ids.length||ids.some(id=>!id)||current.some(id=>!id)||new Set(ids).size!==ids.length||new Set(current).size!==current.length||ids.length!==current.length||ids.some(id=>!current.includes(id)))conflictReason='Camera identity changed after its placement move. Review this unit before using its field location.';
  if(!['SHOP','FIELD'].includes(a.placement)||a.action!==(a.placement==='SHOP'?'MOVE_TO_ROOT':'MOVE_TO_FIELD')||!Number.isFinite(stamp(a.created_at))||!uuid(a.request_id)||!uuid(a.control_id)
   ||a.placement==='FIELD'&&(!text(a.site_label,250)||!text(a.street_address,600)))fail('The saved Owner placement is incomplete.');
  const matchKey=placementMatchKey(a.unit_key);
  if(devices.some(d=>placementMatchKey(d.unit_key)===matchKey&&auditKey(d.unit_key)!==auditKey(a.unit_key)))conflictReason='Camera aliases need review before this unit’s placement can be shown.';
  overrides.push({...a,matchKey,conflictReason});
 }
 return overrides;
}
async function addressHash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value.replace(/\s+/g,' ').trim().toLowerCase()))),x=>x.toString(16).padStart(2,'0')).join('');}
const coordinate=(v:unknown,limit:number)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=limit;
async function movedRow(raw:Row,a:Row):Promise<Row>{
 const {_sourceField:_source,_placementProof:proof,...row}=raw;
 const address=a.placement==='FIELD'?a.street_address:row.address;
 // A later matching, unique Owner history proof can establish a new pin, including at a new address.
 const valid= a.placement==='FIELD'&&row.readOnly===false&&row.hasUnitGps===true&&object(proof)&&proof.owner===true&&uuid(proof.historyId)
  &&coordinate(row.historicalLatitude,90)&&coordinate(row.historicalLongitude,180)
  &&stamp(row.gpsRecordedAt)>stamp(a.created_at)&&typeof proof.note==='string'&&proof.note.split('\n')[0]==='COS_FIELD_LOCATION_V1|address_sha256='+await addressHash(address)+'|confirmed=true';
 return {...row,placement:a.placement,placementSource:'owner',placementUnitKey:a.unit_key,placementAuditId:idString(a.id),placementUpdatedAt:a.created_at,
  currentLocationType:a.placement.toLowerCase(),status:a.placement==='FIELD'?'field':row.status,
  installedSiteId:null,customer:null,activeJobNumber:null,site:a.placement==='FIELD'?a.site_label:row.site,address,
  addressSource:a.placement==='FIELD'?'Owner confirmed installation address':row.addressSource,addressUpdatedAt:a.placement==='FIELD'?a.created_at:row.addressUpdatedAt,
  latitude:valid?row.historicalLatitude:null,longitude:valid?row.historicalLongitude:null,coordinateSource:valid?row.historicalCoordinateSource:null,
  locationVerification:valid?'owner_verified':'address_changed',locationVerifiedAt:valid?row.gpsRecordedAt:null,locationHistoryId:valid?proof.historyId:null,
  addressEstimateTrackerId:null,addressEstimateUnitNumber:null,
  locationNote:row.locationNote};
}
/** Structural input only: the caller must supply the result of verifiedHealthIdentities.
 * Keep this module independent of that verifier (which uses currentOwnerPlacements).
 * No provider matching, serial access, review-scope changes or persistent identity writes here.
 */
export type ReviewedPlacementIdentity={identityVersion:1;unitIdentities:Row[];identityWarnings:Row[];ownerConfirmedIdentityVersion?:1;ownerConfirmedUnitIdentities?:Row[]};
const sameIds=(a:unknown[],b:unknown[])=>a.length===b.length&&new Set(a).size===a.length&&new Set(b).size===b.length&&a.every(id=>b.includes(id));
function nativePlacementAliases(inventory:Row[],audits:Row[],devices:Row[],overrides:Row[],identity:ReviewedPlacementIdentity){
 if(!object(identity)||identity.identityVersion!==1||!Array.isArray(identity.unitIdentities)||!Array.isArray(identity.identityWarnings))fail('Reviewed placement identities are unavailable.');
 if(new Set(audits.map(a=>idString(a.id))).size!==audits.length)fail('Placement history returned duplicate audit identities.');
 if(identity.ownerConfirmedIdentityVersion===undefined?identity.ownerConfirmedUnitIdentities!==undefined:identity.ownerConfirmedIdentityVersion!==1||!Array.isArray(identity.ownerConfirmedUnitIdentities)||identity.ownerConfirmedUnitIdentities.length>1000||identity.ownerConfirmedUnitIdentities.some(p=>p.kind!=='owner_confirmed_native'))fail('Owner-confirmed placement identity contract is unavailable.');
 if(identity.unitIdentities.some(p=>p.kind==='owner_confirmed_native'))fail('Owner-confirmed identities require their additive contract.');
 const proofs=[...identity.unitIdentities,...(identity.ownerConfirmedUnitIdentities||[])],warnings=identity.identityWarnings;
 if(proofs.some(p=>!object(p)||!uuid(p.unitId)||!text(p.unitNumber,250)||!['native_provider','owner_placement','owner_confirmed_native'].includes(p.kind)||!Array.isArray(p.deviceIds)||!p.deviceIds.length||p.deviceIds.some((id:unknown)=>typeof id!=='string'||idString(id)!==id)||!Array.isArray(p.unitKeys)||!p.unitKeys.length||p.unitKeys.some((key:unknown)=>!text(key,250))||!/^[a-f0-9]{64}$/.test(p.proof))
  ||warnings.some(w=>!object(w)||(!uuid(w.unitId)&&!/^unavailable:[a-f0-9]{64}$/.test(w.unitId))||!text(w.reason,1000)||!Array.isArray(w.deviceIds)||w.deviceIds.some((id:unknown)=>typeof id!=='string'||idString(id)!==id)||new Set(w.deviceIds).size!==w.deviceIds.length||!Array.isArray(w.unitKeys)||w.unitKeys.some((key:unknown)=>!text(key,250))||new Set(w.unitKeys).size!==w.unitKeys.length))fail('Reviewed placement identities are malformed.');
 const related=(claim:Row,key:string,ids:string[])=>claim.unitKeys.some((k:string)=>auditKey(k)===auditKey(key))||claim.deviceIds.some((id:string)=>ids.includes(id));
 const targets:Row[]=[],blocked=new Map<string,Set<string>>();
 const block=(key:string,ids:string[])=>blocked.set(auditKey(key),new Set([...(blocked.get(auditKey(key))||[]),...ids]));
 // A warning never becomes a fallback name match or a camera-only generated row.
 for(const warning of warnings){
  for(const key of warning.unitKeys)block(key,[warning.unitId]);
  for(const a of overrides)if(related(warning,a.unit_key,a.device_ids.map(idString)))block(a.unit_key,[warning.unitId]);
 }
 for(const proof of proofs.filter(p=>['native_provider','owner_confirmed_native'].includes(p.kind))){
  const keys=proof.unitKeys,rawKey=keys[0],rawMatch=placementMatchKey(rawKey),nativeMatch=placementMatchKey(proof.unitNumber);
  const rows=inventory.filter(row=>row.id===proof.unitId),group=devices.filter(d=>auditKey(d.unit_key)===auditKey(rawKey));
  const ids=group.map(d=>idString(d.id)),latest=audits.filter(a=>auditKey(a.unit_key)===auditKey(rawKey)).sort((a,b)=>BigInt(idString(a.id)!)>BigInt(idString(b.id)!)?-1:1)[0];
  const current=overrides.find(a=>auditKey(a.unit_key)===auditKey(rawKey));
  const relatedProofs=proofs.filter(p=>p.unitId===proof.unitId||keys.some((key:string)=>related(p,key,proof.deviceIds)));
  const competingRows=inventory.filter(row=>row.id!==proof.unitId&&[rawMatch,nativeMatch].includes(placementMatchKey(row.unitNumber)));
  const auditConflict=audits.some(a=>auditKey(a.unit_key)!==auditKey(rawKey)&&(
   [rawMatch,nativeMatch].includes(placementMatchKey(a.unit_key))||Array.isArray(a.device_ids)&&a.device_ids.map(idString).some((id:string|null)=>id!==null&&proof.deviceIds.includes(id))
   ||current&&a.control_id===current.control_id));
  const valid=keys.length===1&&rawKey===rawKey.trim()&&rows.length===1&&rows[0].readOnly===false&&rows[0].unitNumber===proof.unitNumber
   &&group.length>0&&group.every(d=>d.unit_key===rawKey)&&sameIds(proof.deviceIds,ids)&&relatedProofs.length===1&&!competingRows.length
   &&!warnings.some(w=>w.unitId===proof.unitId||related(w,rawKey,proof.deviceIds))
   &&!devices.some(d=>[rawMatch,nativeMatch].includes(placementMatchKey(d.unit_key))&&d.unit_key!==rawKey)
   &&!auditConflict&&(!current||!current.conflictReason&&current.unit_key===rawKey&&sameIds(current.device_ids.map(idString),proof.deviceIds)
    &&latest&&idString(latest.id)===idString(current.id)&&(!inventory.some(row=>row.id===current.control_id)))
   &&(!latest||latest.unit_key===rawKey);
  if(!valid){for(const key of keys)block(key,[proof.unitId,...competingRows.map(r=>r.id)]);continue;}
  targets.push({contract:'COS_NATIVE_PLACEMENT_ALIAS_V1',writerContract:'COS_CAMERA_PLACEMENT_V2',unitId:proof.unitId,unitNumber:proof.unitNumber,
   unitKey:rawKey,deviceIds:[...proof.deviceIds].sort(),proof:proof.proof,auditId:latest?idString(latest.id):null});
 }
 // A reused control UUID cannot create one order-dependent shadow for competing moves.
 for(const a of overrides)if(overrides.some(other=>other!==a&&other.control_id===a.control_id))block(a.unit_key,proofs.filter(p=>related(p,a.unit_key,a.device_ids.map(idString))).map(p=>p.unitId));
 // Protected native identities cannot be claimed by an unrelated name-only move.
 for(const a of overrides){
  const rows=inventory.filter(row=>placementMatchKey(row.unitNumber)===a.matchKey);
  for(const row of rows)if(proofs.some(p=>['native_provider','owner_confirmed_native'].includes(p.kind)&&p.unitId===row.id&&!related(p,a.unit_key,a.device_ids.map(idString)))||warnings.some(w=>w.unitId===row.id))block(a.unit_key,[row.id]);
 }
 return {targets:targets.filter(t=>!blocked.has(auditKey(t.unitKey))),blocked};
}

/** Healthy unmarked rows and pins are unchanged. Explicit identity warnings are deny-only quarantines. */
export async function projectOwnerPlacement(snapshot:unknown,audits:unknown,devices:unknown,identity?:ReviewedPlacementIdentity,nativeUnits?:unknown):Promise<Row>{
 if(!object(snapshot)||!Array.isArray(snapshot.items)||!Array.isArray(snapshot.inventoryItems)||!object(snapshot.summary))fail('Field placement is unavailable. Reload the Field Map.');
 // The map RPC and identity-source reads are independent snapshots. A vanished, duplicated
 // or renamed native row must not fall back to its earlier map address/pin, even if all
 // resource bindings disappeared too. This agreement is a denial guard, never identity proof.
 if(identity){
  if(!Array.isArray(nativeUnits)||nativeUnits.length>100000||nativeUnits.some(row=>!object(row)||!uuid(row.id)||!text(row.unit_number,250))||new Set(nativeUnits.map(row=>row.id)).size!==nativeUnits.length)fail('Native inventory identity membership is unavailable or duplicated.');
  const byNativeId=new Map(nativeUnits.map(row=>[row.id,row]));
  if(snapshot.inventoryItems.some((row:Row)=>row?.readOnly===false&&(!byNativeId.has(row.id)||byNativeId.get(row.id)!.unit_number!==row.unitNumber)))fail('Native inventory changed while Field Map was loading. Reload before using its placement.');
 }
 const overrides=currentOwnerPlacements(audits,devices),byKey=new Map<string,Row[]>(),seen=new Set<string>();
 for(const row of snapshot.inventoryItems){
  if(!object(row)||!uuid(row.id)||seen.has(row.id)||typeof row.unitNumber!=='string'||typeof row._sourceField!=='boolean')fail('Field inventory returned inconsistent identities.');
  seen.add(row.id);const key=placementMatchKey(row.unitNumber);byKey.set(key,[...(byKey.get(key)||[]),row]);
 }
 const aliases=identity?nativePlacementAliases(snapshot.inventoryItems,audits as Row[],devices as Row[],overrides,identity):null;
 const replacements=new Map<string,Row>(),extra:Row[]=[],placementReviews:Row[]=[];
 const hold=(a:Row,matches:Row[],reason:string)=>{placementReviews.push({unitNumber:a.unit_key,reason,placementAuditId:idString(a.id)});for(const raw of matches){const {_sourceField:_source,_placementProof:_proof,...row}=raw;replacements.set(row.id,{...row,placement:'UNKNOWN',placementStatus:'needs_identity_review',placementReviewReason:reason,latitude:null,longitude:null,coordinateSource:null,locationVerification:'address_changed',locationVerifiedAt:null,locationHistoryId:null,addressEstimateTrackerId:null,addressEstimateUnitNumber:null});}};
 // A verified negative native UUID remains meaningful when every current camera binding
 // is gone. Keep the record/history in inventory, but never its stale current field pin.
 if(identity)for(const warning of identity.identityWarnings){
  const rows=snapshot.inventoryItems.filter((row:Row)=>row.id===warning.unitId);
  if(rows.length)hold({unit_key:rows[0].unitNumber,id:null},rows,warning.reason||'The reviewed native identity is unavailable. Review this unit before using its location.');
 }
 for(const a of overrides){
  const target=aliases?.targets.find(t=>t.unitKey===a.unit_key),blocked=aliases?.blocked.get(auditKey(a.unit_key));
  const matches=target?snapshot.inventoryItems.filter((row:Row)=>row.id===target.unitId):byKey.get(a.matchKey)||[];
  if(blocked){hold(a,[...new Set([...matches,...snapshot.inventoryItems.filter((row:Row)=>blocked.has(row.id))])],'The reviewed native placement association changed or is ambiguous. Review this unit’s identity.');continue;}
  if(a.conflictReason||matches.length>1){hold(a,matches,a.conflictReason||'The moved camera matches more than one field record. Review its identity.');continue;}
  if(matches.length===1)replacements.set(matches[0].id,await movedRow(matches[0],a));
  else if(a.placement==='FIELD'){
   const possible=snapshot.inventoryItems.filter((row:Row)=>row.readOnly===false&&placementIdentityConcernKey(row.unitNumber)===placementIdentityConcernKey(a.unit_key));
   if(possible.length){hold(a,possible,'A possible existing equipment model or suffix needs explicit Owner identity review before creating a separate camera placement.');continue;}
   if(seen.has(a.control_id)||extra.some(r=>r.id===a.control_id)){hold(a,matches,'The camera placement identity conflicts with an existing map record. Review its identity.');continue;}
   // A camera-only placement uses its immutable first-move control UUID, never a fabricated native unit ID.
   // It remains read-only until a registered equipment identity is linked.
   extra.push({id:a.control_id,unitNumber:a.unit_key,modelName:'Camera unit',status:'field',currentLocationType:'field',site:a.site_label,address:a.street_address,
    addressSource:'Owner confirmed installation address',readOnly:true,recordSource:'Owner camera placement',hasUnitGps:false,latitude:null,longitude:null,
    coordinateSource:null,locationVerification:'address_only',locationNote:'Camera unit is not linked to registered equipment. Verify its identity before saving a map pin.',
    placement:'FIELD',placementSource:'owner',placementUnitKey:a.unit_key,placementAuditId:idString(a.id),placementUpdatedAt:a.created_at});
  }
 }
 const inventory=snapshot.inventoryItems.map((raw:Row)=>{const {_sourceField:_source,_placementProof:_proof,...row}=raw;return replacements.get(raw.id)||row;});
 const items=snapshot.inventoryItems.filter((row:Row)=>replacements.has(row.id)?replacements.get(row.id)!.placement==='FIELD':row._sourceField===true).map((raw:Row)=>{const {_sourceField:_source,_placementProof:_proof,...row}=raw;return replacements.get(raw.id)||row;}).concat(extra);
 return {...snapshot,items,inventoryItems:inventory.concat(extra),placementReviews,...(aliases?{placementProjectionVersion:2,nativePlacementAliases:aliases.targets}:{}),summary:{...snapshot.summary,fieldUnits:items.length,
  mappedUnits:items.filter((r:Row)=>r.latitude!=null&&r.longitude!=null).length,unitGps:items.filter((r:Row)=>r.hasUnitGps===true).length,
  missingGps:items.filter((r:Row)=>r.latitude==null||r.longitude==null).length,addressUnits:items.filter((r:Row)=>typeof r.address==='string'&&r.address.trim()).length}};
}

/** Internal effective placement only. Source observations remain byte-for-byte intact. */
export function projectCameraOwnerPlacement(devices:unknown,audits:unknown):Row[]{
 const overrides=currentOwnerPlacements(audits,devices),byUnit=new Map(overrides.map(a=>[auditKey(a.unit_key),a.conflictReason?'UNKNOWN':a.placement])),conflicts=new Set(overrides.filter(a=>a.conflictReason).map(a=>a.matchKey));
 return (devices as Row[]).map(row=>conflicts.has(placementMatchKey(row.unit_key))?{...row,__ownerPlacement:'UNKNOWN'}:byUnit.has(auditKey(row.unit_key))?{...row,__ownerPlacement:byUnit.get(auditKey(row.unit_key))}:row);
}


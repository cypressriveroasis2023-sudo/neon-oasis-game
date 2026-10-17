import {checkedMhelpPlacements} from './mhelpPlacementProjection.ts';
import {placementIdentityConcernKey} from './placementProjection.ts';
type Row=Record<string,any>;
const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const encoder=new TextEncoder(),hex=(value:ArrayBuffer)=>[...new Uint8Array(value)].map(n=>n.toString(16).padStart(2,'0')).join('');
const exact=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=160&&v===v.trim()&&!/[\x00-\x1f\x7f<>]/.test(v);
const stable=(value:any):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export class HandoffLocationError extends Error{constructor(message:string,readonly status:number){super(message);}}
const unavailable=()=>{throw new HandoffLocationError('Current Shop placement could not be verified. Reload and resolve the recorded placement before handing off equipment.',409);};
export type HandoffLocationRead={map:Row;mhelp:Row;equipment:Row[]};
function proofItems(items:Row[],read:HandoffLocationRead,now:number){
 const {map,mhelp,equipment}=read;
 if(!map||map.effectivePlacementVersion!==1||!Array.isArray(map.inventoryItems)||map.inventoryItems.length>20000||!Array.isArray(map.items)||!Array.isArray(equipment)||equipment.length>20000||mhelp?.enabled!==true||mhelp.errorCode||!Number.isFinite(Date.parse(mhelp.lastSuccessAt))||now-Date.parse(mhelp.lastSuccessAt)>40*60*1000||Date.parse(mhelp.lastSuccessAt)>now)unavailable();
 const links=checkedMhelpPlacements(mhelp,now);
 return items.map(item=>{
  const legacy=equipment.filter(r=>r.equipment_key===item.equipment_key);
  if(legacy.length!==1||legacy[0].canonical_family!==item.family||legacy[0].unit_tag!==item.unit_tag||legacy[0].tracker_state!=='shop'||!Number.isFinite(Date.parse(legacy[0].updated_at))||equipment.filter(r=>r.canonical_family===item.family&&r.unit_tag===item.unit_tag).length!==1)unavailable();
  const label=item.family+' '+item.unit_tag,concern=placementIdentityConcernKey(label);
  const rows=map.inventoryItems.filter((r:Row)=>placementIdentityConcernKey(r?.unitNumber)===concern);
  // A family-qualified exact label selects a guarded placement observation;
  // a loose/number-only sibling is a veto and never a positive association.
  if(rows.length!==1)unavailable();const row=rows[0];
  if(row.unitNumber!==label||!UUID.test(row.id)||typeof row.readOnly!=='boolean'||row.placement!=='SHOP'||row.effectivePlacement?.contract!=='COS_EFFECTIVE_FLEET_PLACEMENT_V1'||row.effectivePlacement.state!=='shop'||row.effectivePlacement.reason||row.activeInventoryEligible!==true||row.placementReviewReason||row.placementStatus==='needs_identity_review'||row.representationStatus==='conflict'||row.installedSiteId||row.hasUnitGps===true||map.items.some((r:Row)=>r.id===row.id))unavailable();
  const covered=mhelp.items.filter((r:Row)=>r.trackerId===row.id||r.nativeUnitId===row.id||placementIdentityConcernKey(r.trackerLabel)===concern||placementIdentityConcernKey(r.nativeLabel)===concern);
  if(covered.length!==1||!links.includes(covered[0]))unavailable();const link=covered[0];
  if(link.placement!=='SHOP'||link.locationReview!==false||link.assignmentChanged===true||Date.parse(mhelp.lastSuccessAt)<Date.parse(link.observedAt)|| (row.readOnly?link.trackerId!==row.id||link.trackerLabel!==label:link.nativeUnitId!==row.id||link.nativeLabel!==label))unavailable();
  return {equipment_key:item.equipment_key,family:item.family,unit_tag:item.unit_tag,legacy_updated_at:legacy[0].updated_at,native_id:row.id,tracker_id:link.trackerId,observed_at:link.observedAt,authority:{effective:row.effectivePlacement,placementAuditId:row.placementAuditId??null,placementUpdatedAt:row.placementUpdatedAt??null,placementEvidence:row.placementEvidence??null,mhelp:{trackerId:link.trackerId,nativeUnitId:link.nativeUnitId,trackerLabel:link.trackerLabel,nativeLabel:link.nativeLabel,guardCurrent:link.guardCurrent,observedAt:link.observedAt,placement:link.placement,lastSuccessAt:mhelp.lastSuccessAt}}};
 });
}
/** Two complete authenticated reads, followed by a 30-second actor/request-bound
 * attestation. This is a current observation, not a distributed database lock.
 * Legacy custody is checked again under its shared transaction lock on consume. */
export async function issueHandoffLocationProof(context:Row,body:Row,read:()=>Promise<HandoffLocationRead>,getSecret:()=>string|undefined,now=()=>Date.now()){
 if(!context?.actorId||!UUID.test(context.legacyId)||!(context.legacyOwner===true||context.department==='it')||!body||Object.keys(body).some(k=>!['request_id','purpose','items'].includes(k))||!UUID.test(body.request_id)||!['checkout','inventory_release'].includes(body.purpose)||body.purpose==='inventory_release'&&!context.legacyOwner)throw new HandoffLocationError('A verified IT or Owner action is required.',403);
 const items=body.items;
 if(!Array.isArray(items)||items.length<1||items.length>20||items.some(i=>!i||Object.keys(i).sort().join(',')!=='equipment_key,family,unit_tag'||!['equipment_key','family','unit_tag'].every(k=>exact(i[k])))||new Set(items.map(i=>i.equipment_key)).size!==items.length)throw new HandoffLocationError('Exact equipment identities required.',400);
 const secret=getSecret();if(typeof secret!=='string'||!/^[a-f0-9]{64}$/.test(secret))throw new HandoffLocationError('Shop verification is held for installation review.',503);
 const ordered=[...items].sort((a,b)=>a.equipment_key.localeCompare(b.equipment_key));
 const before=proofItems(ordered,await read(),now()),after=proofItems(ordered,await read(),now());
 if(stable(before)!==stable(after))unavailable();
 const issued=Math.floor(now()/1000),payload=JSON.stringify({version:7,key_id:'v1',organization_id:ORG,actor_id:context.legacyId,request_id:body.request_id,purpose:body.purpose,issued_at:issued,expires_at:issued+30,items:await Promise.all(after.map(async({authority,...item})=>({...item,authority_sha256:hex(await crypto.subtle.digest('SHA-256',encoder.encode(stable(authority))))})))});
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/../g)!.map(n=>parseInt(n,16))),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return {payload,signature:hex(await crypto.subtle.sign('HMAC',key,encoder.encode(payload)))};
}

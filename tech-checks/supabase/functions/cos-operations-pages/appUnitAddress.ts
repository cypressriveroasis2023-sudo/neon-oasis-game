import {APP_UNIT_ADDRESS_CONTRACT, checkedAppAddressProof, checkedAppAddressAuthority} from '../_shared/appUnitAddressContract.ts';
import {placementMatchKey, placementIdentityConcernKey, currentOwnerPlacements} from './placementProjection.ts';
import {addressDigest, parseAddress} from './censusAddress.ts';
import {validInstallation} from './importedAddressContract.ts';

type Row=Record<string,any>;
const object=(v:unknown):v is Row=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const decimal=(v:unknown)=>typeof v==='string'&&/^[1-9]\d{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;
const clean=(v:unknown,max:number)=>typeof v==='string'&&v===v.trim()&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f<>]/.test(v);
const trackerRecordId=(v:unknown)=>typeof v==='string'&&v.length<=400&&/^google_sheet:[A-Za-z0-9_-]{10,128}:(?:0|[1-9][0-9]{0,18}):[A-Za-z][A-Za-z0-9 ._-]{0,159}\|[A-Za-z0-9._-]{1,40}$/.test(v);
function fail(message:string,status=409):never{throw Object.assign(new Error(message),{status});}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const validPartial=(v:unknown)=>v===null||object(v)&&Object.keys(v).length===4&&['street','city','state','zip'].every(k=>Object.hasOwn(v,k)&&(v[k]===null||typeof v[k]==='string'&&v[k].length<=300&&!/[\x00-\x1f\x7f<>]/.test(v[k])));

/** Native actor/history data stays inside the authenticated Operations response. */
export function checkedNativeAppAddress(value:unknown,id:string):Row {
 if(!object(value)||value.contract!==APP_UNIT_ADDRESS_CONTRACT||value.unitId!==id||!uuid(id)||!clean(value.unitNumber,160)
  ||!object(value.sourceIdentity)||!uuid(value.sourceRevision)||!(value.revision===null||uuid(value.revision))
  ||!sha(value.stableIdentitySha256)||!sha(value.placementRevision)||!['FIELD','SHOP','INACTIVE'].includes(value.placement)
  ||!validPartial(value.installation)||!(value.siteLabel===null||clean(value.siteLabel,250))||typeof value.sourceConflict!=='boolean'
  ||typeof value.editable!=='boolean'||!Array.isArray(value.history)||value.history.length>20)fail('The current unit address is incomplete. Reload before editing.',503);
 const identity=value.sourceIdentity;
 if(!(identity.sourceSystem==='mhelpdesk_product_import'&&decimal(identity.productId)&&Object.keys(identity).length===2
  ||identity.sourceSystem==='google_sheet_tracker'&&trackerRecordId(identity.sourceRecordId)&&Object.keys(identity).length===2))fail('The imported unit identity is unavailable.',503);
 const authority=checkedAppAddressAuthority(value.addressAuthority,value.revision);
 if(value.revision!==null&&!authority||value.revision===null&&value.addressAuthority!=null)fail('The current app address authority is incomplete.',503);
 const history=value.history.map((h:unknown)=>{
  if(!object(h)||!uuid(h.revision)||!uuid(h.actorUserId)||!['owner','it'].includes(h.actorRole)||!clean(h.savedAt,40)||!Number.isFinite(Date.parse(h.savedAt))
   ||!['FIELD','SHOP','INACTIVE'].includes(h.placement)||!validPartial(h.installation))fail('The unit address history is incomplete.',503);
  return {revision:h.revision,actorUserId:h.actorUserId,actorRole:h.actorRole,savedAt:h.savedAt,placement:h.placement,installation:h.installation};
 });
 return {contract:APP_UNIT_ADDRESS_CONTRACT,unitId:id,unitNumber:value.unitNumber,sourceIdentity:{...identity},sourceRevision:value.sourceRevision,
  revision:value.revision,stableIdentitySha256:value.stableIdentitySha256,placementRevision:value.placementRevision,placement:value.placement,
  installation:value.installation,siteLabel:value.siteLabel,sourceConflict:value.sourceConflict,history,editable:value.editable,
  ...(authority?{addressAuthority:authority}:{})};
}

/** Labels only discover an exact existing raw group for a separate authoritative
 * legacy proof. They never link equipment, cameras, IPs, or health evidence. */
export function appAddressLegacyKey(unit:Row,bundle:Row):string|null {
 const sources=bundle?.sources,identity=bundle?.identity;
 if(!object(sources)||![sources.units,sources.devices,sources.audits].every(v=>Array.isArray(v)&&v.length<=100000&&v.every(object))
  ||!object(identity)||identity.identityVersion!==1||!Array.isArray(identity.unitIdentities)||!Array.isArray(identity.identityWarnings)
  ||identity.ownerConfirmedIdentityVersion!==undefined&&(identity.ownerConfirmedIdentityVersion!==1||!Array.isArray(identity.ownerConfirmedUnitIdentities)))fail('Current unit identity evidence is unavailable.',503);
 const target=placementMatchKey(unit.unitNumber),concern=placementIdentityConcernKey(unit.unitNumber);
 // Denial is deliberately broader than identity. A related model needs review.
 if(sources.units.some((u:Row)=>u.id===unit.unitId||placementIdentityConcernKey(u.unit_number)===concern))fail('This imported unit now has a competing registered identity. Review its identity before editing.');
 const related=sources.devices.filter((d:Row)=>placementIdentityConcernKey(d.unit_key)===concern);
 if(related.some((d:Row)=>typeof d.unit_key!=='string'||placementMatchKey(d.unit_key)!==target||!decimal(String(d.id))))fail('The camera family or unit variant needs identity review.');
 const keys=[...new Set<string>(related.map((d:Row)=>d.unit_key))],ids=related.map((d:Row)=>String(d.id));
 if(keys.length>1||new Set(ids).size!==ids.length)fail('The camera group has conflicting identities.');
 const claims=[...identity.unitIdentities,...(identity.ownerConfirmedUnitIdentities||[]),...identity.identityWarnings];
 if(claims.some(p=>!object(p)||!Array.isArray(p.unitKeys)||!Array.isArray(p.deviceIds)))fail('Current identity commitments are incomplete.',503);
 const relatedClaims=claims.filter(p=>p.unitId===unit.unitId||p.unitKeys.some((k:unknown)=>placementIdentityConcernKey(k)===concern)||p.deviceIds.some((id:unknown)=>ids.includes(String(id))));
 // A current standalone Owner camera control is historical placement evidence,
 // not a competing registered equipment identity. Permit only its exact whole
 // group; native/provider claims and every warning remain denial conditions.
 const owner=keys.length===1?currentOwnerPlacements(sources.audits,sources.devices).find(p=>p.unit_key===keys[0]):null;
 if(relatedClaims.length>1||relatedClaims.some(p=>p.kind!=='owner_placement'||!owner||owner.conflictReason||p.unitId!==owner.control_id
  ||p.placementAuditId!==String(owner.id)||!sha(p.proof)||p.unitKeys.length!==1||p.unitKeys[0]!==keys[0]
  ||p.deviceIds.length!==ids.length||new Set(p.deviceIds).size!==ids.length||!p.deviceIds.every((id:unknown)=>ids.includes(String(id)))))fail('An existing equipment association needs review before this imported unit can be edited.');
 if(sources.audits.some((a:Row)=>!Array.isArray(a.device_ids)))fail('Current placement history is incomplete.',503);
 const audits=sources.audits.filter((a:Row)=>placementIdentityConcernKey(a.unit_key)===concern||a.device_ids.some((id:unknown)=>ids.includes(String(id))));
 if(!keys.length&&audits.length||audits.some((a:Row)=>a.unit_key!==keys[0]))fail('Historical camera identity conflicts with this imported unit.');
 return keys[0]??null;
}

type Options={readNative:(id:string)=>Promise<unknown>;readIdentity:()=>Promise<Row>;readProof:(unitNumber:string,key:string|null)=>Promise<unknown>;save:(args:Row)=>Promise<unknown>;capability:()=>Promise<boolean>};
export function createAppUnitAddress(options:Options){
 const snapshot=async(id:string)=>{
  const first=checkedNativeAppAddress(await options.readNative(id),id),discovery=await options.readIdentity(),key=appAddressLegacyKey(first,discovery);
  const before=checkedAppAddressProof(await options.readProof(first.unitNumber,key));if(!before||before.legacyUnitKey!==key)fail('Current placement could not be verified. Reload before editing.');
  // The displayed Owner address and effective-before audit must come from an
  // identity/placement read bracketed by both proofs, never an earlier discovery.
  const bundle=await options.readIdentity();
  if(appAddressLegacyKey(first,bundle)!==key)fail('The current unit identity changed while loading. Reload before editing.');
  const current=checkedNativeAppAddress(await options.readNative(id),id),after=checkedAppAddressProof(await options.readProof(current.unitNumber,key));
  if(!same(first,current)||!after||!same(before,after))fail('The unit source or placement changed while loading. Reload before editing.');
  const nativePlacementRevision=current.placementRevision;
  const revision=await addressDigest(JSON.stringify({nativePlacementRevision,proof:after}));
  const {stableIdentitySha256:_stable,addressAuthority:_authority,...visible}=current;
  // A current app proof outranks exactly the legacy history reviewed at save.
  // A later legacy move wins. Its current address is the editor prefill.
  const app=checkedAppAddressAuthority(current.addressAuthority,current.revision);
  const appCurrent=Boolean(app&&same({...app,revision:undefined},{...after,revision:undefined}));
  if(!appCurrent&&key!==null){
   const placement=currentOwnerPlacements(bundle.sources.audits,bundle.sources.devices).find(p=>p.unit_key===key);
   if(placement?.conflictReason)fail('The current placement needs identity review.');
   if(placement){
    visible.placement=placement.placement;visible.siteLabel=placement.placement==='FIELD'?placement.site_label:null;
    if(placement.placement==='FIELD'){
     const parsed=parseAddress(placement.street_address);
     // A legacy free-text address that cannot be safely separated is not a blank
     // editable form. The user must first repair it through the existing editor.
     if(!parsed||!validInstallation(parsed))fail('The existing Owner address needs review before it can be safely edited here.');
     visible.installation=parsed;
    }else visible.installation=null;
   }
  }
  const response:Row={...visible,placementRevision:revision};
  return {raw:current,proof:after,nativePlacementRevision,visible:response};
 };
 return async(method:string,id:string,body:unknown)=>{
  if(!uuid(id))fail('A stable imported unit identifier is required.',400);
  if(!await options.capability())fail('App address editing is not enabled for this backend yet.',503);
  if(method!=='GET'&&method!=='POST')fail('Method not supported.',405);
  const before=await snapshot(id);
  if(method==='GET')return before.visible;
  if(!object(body)||Object.keys(body).some(k=>!['requestId','expectedSourceRevision','expectedRevision','expectedPlacementRevision','placement','installation','siteLabel','confirmed'].includes(k))
   ||!uuid(body.requestId)||!uuid(body.expectedSourceRevision)||!(body.expectedRevision===null||uuid(body.expectedRevision))||!sha(body.expectedPlacementRevision)
   ||!['FIELD','SHOP','INACTIVE'].includes(body.placement)||body.confirmed!==true||!(body.siteLabel===null||clean(body.siteLabel,250))
   ||body.placement==='FIELD'&&!validInstallation(body.installation)||body.placement!=='FIELD'&&body.installation!==null)fail('Review and confirm a valid unit installation address.',400);
  if(!before.raw.editable)fail('This unit is not currently editable.',403);
  if(body.expectedSourceRevision!==before.visible.sourceRevision||body.expectedRevision!==before.visible.revision||body.expectedPlacementRevision!==before.visible.placementRevision)fail('The unit source or placement changed. Reload before saving.');
  if(body.placement===before.visible.placement&&same(body.installation,before.visible.installation)&&body.siteLabel===before.visible.siteLabel)return {changed:false,record:before.visible};
  const proof=checkedAppAddressProof(await options.readProof(before.raw.unitNumber,before.proof.legacyUnitKey));
  if(!proof||!same(proof,before.proof))fail('The placement changed before saving. Reload before editing.');
  const result=await options.save({p_native_unit_id:id,p_expected_source_revision:before.raw.sourceRevision,p_expected_overlay_revision:before.raw.revision,
   p_expected_stable_identity_sha256:before.raw.stableIdentitySha256,p_expected_placement_revision:before.nativePlacementRevision,p_placement_proof:proof,
   p_request_id:body.requestId,p_placement:body.placement,p_installation:body.installation,p_site_label:body.siteLabel,
   p_effective_before:{placement:before.visible.placement,installation:before.visible.installation,siteLabel:before.visible.siteLabel}});
  if(!object(result)||typeof result.changed!=='boolean')fail('The save could not be confirmed. Reload before editing.',503);
  checkedNativeAppAddress(result.record,id);
  // These databases cannot commit atomically. Never report an effective change
  // without fresh proof; the persisted app audit remains truthful if a later
  // legacy move raced and now takes precedence.
  const after=await snapshot(id);
  if(!same(after.proof,proof))fail('The address was saved, but another placement change now takes priority. Reload to review it.');
  return {changed:result.changed,record:after.visible};
 };
}

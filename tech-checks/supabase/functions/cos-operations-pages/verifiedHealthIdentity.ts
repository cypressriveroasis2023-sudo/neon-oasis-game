import {currentOwnerPlacements} from './placementProjection.ts';
import {REVIEWED_NATIVE_IDENTITIES, REVIEWED_OWNER_IDENTITIES, REVIEWED_NATIVE_RESOURCES, REVIEWED_OWNER_RESOURCES, REVIEWED_OWNER_PHYSICAL_IDENTITIES, type ReviewedIdentityResources} from './verifiedHealthIdentityScope.ts';

/** Identity-only projections. Provider serials and native association records never leave this module. */
type Row=Record<string,any>;
export type UnitHealthIdentity={unitId:string;unitNumber:string;kind:'native_provider'|'owner_placement';deviceIds:string[];unitKeys:string[];proof:string;placementAuditId?:string};
export type IdentityWarning={unitId:string;reason:string;deviceIds:string[];unitKeys:string[]};
export type IdentitySources={units:Row[];matches:Row[];providers:Row[];devices:Row[];audits:Row[]};
export type IdentityReview={native:Readonly<Record<string,string>>;owner:ReadonlySet<string>;nativeResources:Readonly<Record<string,ReviewedIdentityResources>>;ownerResources:Readonly<Record<string,ReviewedIdentityResources>>;ownerPhysical:Readonly<Record<string,string>>};
const organizationId='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const record=(value:unknown):value is Row=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value===value.trim();
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const decimal=(value:unknown):string|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):typeof value==='string'&&/^[1-9][0-9]*$/.test(value)?value:null;
const sortIds=(values:string[])=>[...values].sort((a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0);
const exactSet=(left:string[],right:string[])=>left.length===right.length&&new Set(left).size===left.length&&new Set(right).size===right.length&&left.every(value=>right.includes(value));
const index=(rows:Row[],key:string)=>{const out=new Map<unknown,Row[]>();for(const row of rows)out.set(row[key],[...(out.get(row[key])||[]),row]);return out;};
export async function identityDigest(value:unknown):Promise<string>{
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export const nativeIdentityKey=(unitId:string)=>identityDigest(['COS_HEALTH_NATIVE_UNIT_V1',unitId]);
export const ownerIdentityKey=(controlId:string)=>identityDigest(['COS_HEALTH_OWNER_CONTROL_V1',controlId]);
export const healthResourceKey=(deviceId:string)=>identityDigest(['COS_HEALTH_RESOURCE_V1',deviceId]);
export const healthSourceUnitKey=(unitKey:string)=>identityDigest(['COS_HEALTH_SOURCE_UNIT_V1',unitKey]);
/** Canonical complete reviewed association; timestamps/status/placement are not identity evidence. */
export function nativeIdentityTuple(unit:Row,associations:{match:Row;provider:Row;device:Row}[]) {
 const mappings=associations.map(({match,provider,device})=>[
  match.id,match.equipment_unit_id,match.vigilant_device_id,match.camera_key,match.match_method,match.confidence,
  provider.id,provider.source,provider.external_device_id,provider.device_name,provider.device_type,
  decimal(device.id),device.source,device.external_device_id,device.device_serial,device.unit_key,device.device_type,
 ]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
 return ['COS_HEALTH_NATIVE_ASSOCIATION_V1',organizationId,unit.id,unit.unit_number,mappings];
}
/** Only the reviewed explicit Owner control/audit and its complete resource set are admitted. */
export function ownerIdentityTuple(audit:Row) {
 return ['COS_HEALTH_OWNER_ASSOCIATION_V1',organizationId,audit.control_id,audit.unit_key,decimal(audit.id),sortIds(audit.device_ids.map(decimal))];
}
/** Database membership alone is not proof that the same physical cameras remain. */
export function ownerPhysicalIdentityTuple(audit:Row,devices:Row[]) {
 const resources=devices.map(device=>[decimal(device.id),device.source,device.device_type,device.device_serial,device.external_device_id,device.unit_key])
  .sort((a,b)=>BigInt(a[0]!)<BigInt(b[0]!)?-1:BigInt(a[0]!)>BigInt(b[0]!)?1:0);
 return ['COS_HEALTH_OWNER_RESOURCES_V1',organizationId,audit.control_id,resources];
}
const reviewed:IdentityReview={native:REVIEWED_NATIVE_IDENTITIES,owner:REVIEWED_OWNER_IDENTITIES,nativeResources:REVIEWED_NATIVE_RESOURCES,ownerResources:REVIEWED_OWNER_RESOURCES,ownerPhysical:REVIEWED_OWNER_PHYSICAL_IDENTITIES};

/** Read-only: exact durable joins and whole-group checks, never a name/IP/address alias. */
export async function verifiedHealthIdentities(sources:IdentitySources,review:IdentityReview=reviewed) {
 const {units,matches,providers,devices,audits}=sources;
 if(![units,matches,providers,devices,audits].every(rows=>Array.isArray(rows)&&rows.length<=100000&&rows.every(record)))throw new Error('Health identity source records are unavailable.');
 // Even irrelevant duplicate ownership evidence participates in uniqueness checks.
 const unitIds=index(units,'id'),matchIds=index(matches,'id'),providerIds=index(providers,'id'),externalProviders=index(providers,'external_device_id');
 const byNative=index(matches,'equipment_unit_id'),resourceOwners=index(matches,'vigilant_device_id');
 const deviceIds=index(devices.map(row=>({...row,id:decimal(row.id)})),'id'),externalDevices=index(devices,'external_device_id'),serialDevices=index(devices,'device_serial');
 // Warning bindings are a separate, one-way safety projection. Resolve only exact
 // commitments from the prior review, never a changed match/provider association.
 // Source-key commitments also quarantine new IDs in an existing reviewed group.
 const presentIds=new Map<string,string>(),presentKeys=new Map<string,string>();
 for(const id of deviceIds.keys())if(typeof id==='string')presentIds.set(await healthResourceKey(id),id);
 for(const key of new Set(devices.map(device=>device.unit_key)))if(text(key))presentKeys.set(await healthSourceUnitKey(key),key);
 const warningBindings=new Map<string,Pick<IdentityWarning,'deviceIds'|'unitKeys'>>();
 const bindWarning=(unitId:string,resources:ReviewedIdentityResources|undefined)=>{
  warningBindings.set(unitId,{
   deviceIds:sortIds([...new Set((resources?.deviceIds||[]).flatMap(hash=>presentIds.has(hash)?[presentIds.get(hash)!]:[]))]),
   unitKeys:[...new Set((resources?.unitKeys||[]).flatMap(hash=>presentKeys.has(hash)?[presentKeys.get(hash)!]:[]))].sort(),
  });
 };
 const identities:UnitHealthIdentity[]=[],warnings=new Map<string,IdentityWarning>();
 const reject=(unitId:string,reason:string)=>{
  if(!warnings.has(unitId))warnings.set(unitId,{unitId,reason,...(warningBindings.get(unitId)||{deviceIds:[],unitKeys:[]})});
 };
 const rejectUnavailable=(reviewKey:string,resources:ReviewedIdentityResources,reason:string)=>{
  // No present durable UUID can be claimed. This opaque warning-only ID is not
  // an equipment alias; its reviewed source bindings quarantine surviving cards.
  const unitId='unavailable:'+reviewKey;bindWarning(unitId,resources);
  const binding=warningBindings.get(unitId)!;
  if(binding.deviceIds.length||binding.unitKeys.length)reject(unitId,reason);
 };
 const presentNativeKeys=new Set<string>();
 for(const unit of units){
  if(!uuid(unit.id))continue;
  const reviewKey=await nativeIdentityKey(unit.id),expected=review.native[reviewKey];if(!expected)continue;
  presentNativeKeys.add(reviewKey);
  bindWarning(unit.id,review.nativeResources[reviewKey]);
  if(unit.organization_id!==organizationId||unitIds.get(unit.id)?.length!==1||!text(unit.unit_number)){reject(unit.id,'Native equipment identity changed or is duplicated.');continue;}
  const links=byNative.get(unit.id)||[];
  if(!links.length){reject(unit.id,'Reviewed provider-resource mappings are missing.');continue;}
  const associations:{match:Row;provider:Row;device:Row}[]=[];
  let reason:string|null=null;
  for(const match of links){
   if(match.organization_id!==organizationId||!uuid(match.id)||matchIds.get(match.id)?.length!==1||!uuid(match.vigilant_device_id)||resourceOwners.get(match.vigilant_device_id)?.length!==1||!text(match.camera_key)||!text(match.match_method)||!text(match.confidence)){reason='Provider-resource mapping ownership is missing, changed or duplicated.';break;}
   const candidates=providerIds.get(match.vigilant_device_id)||[],provider=candidates[0];
   if(candidates.length!==1||provider.organization_id!==organizationId||provider.source!=='vigilant_control_center'||!text(provider.external_device_id)||externalProviders.get(provider.external_device_id)?.length!==1||!text(provider.device_name)||!['IPC','NVR'].includes(provider.device_type)){reason='Provider identity is missing, duplicated or has an unverified family.';break;}
   const legacy=externalDevices.get(provider.external_device_id)||[],device=legacy[0];
   if(legacy.length!==1||!decimal(device.id)||deviceIds.get(decimal(device.id))?.length!==1||device.source!=='vigilant_control_center'||!text(device.device_serial)||serialDevices.get(device.device_serial)?.length!==1||!text(device.unit_key)||device.device_type!==provider.device_type){reason='Legacy resource identity is missing, duplicated or inconsistent.';break;}
   associations.push({match,provider,device});
  }
  if(reason){reject(unit.id,reason);continue;}
  const boundIds=associations.map(row=>decimal(row.device.id)!),unitKeys=[...new Set(associations.map(row=>row.device.unit_key as string))].sort();
  const wholeGroupIds=devices.filter(device=>unitKeys.includes(device.unit_key)).map(device=>decimal(device.id));
  if(wholeGroupIds.some(id=>!id)||!exactSet(boundIds,wholeGroupIds as string[])){reject(unit.id,'Reviewed mapping is partial or the current source unit has extra/duplicate resources.');continue;}
  const proof=await identityDigest(nativeIdentityTuple(unit,associations));
  if(proof!==expected){reject(unit.id,'The complete reviewed native/provider association has changed.');continue;}
  identities.push({unitId:unit.id,unitNumber:unit.unit_number,kind:'native_provider',deviceIds:sortIds(boundIds),unitKeys,proof});
 }
 for(const [key,resources] of Object.entries(review.nativeResources))if(review.native[key]&&!presentNativeKeys.has(key))rejectUnavailable(key,resources,'Reviewed native equipment identity is missing from the current inventory.');
 // A newer audit can replace the reviewed control, key or resource set. Keep the
 // prior control visible as untrusted even when it disappears from current moves.
 const knownOwners=new Set<string>(),presentOwnerKeys=new Set<string>();
 for(const audit of audits){
  if(!uuid(audit.control_id))continue;
  const key=await ownerIdentityKey(audit.control_id),resources=review.ownerResources[key];
  if(resources){knownOwners.add(audit.control_id);presentOwnerKeys.add(key);bindWarning(audit.control_id,resources);}
 }
 for(const [key,resources] of Object.entries(review.ownerResources))if(!presentOwnerKeys.has(key))rejectUnavailable(key,resources,'Reviewed Owner placement history is missing from the current inventory.');
 const currentOwners=new Set<string>();
 for(const audit of currentOwnerPlacements(audits,devices)){
  if(!uuid(audit.control_id))continue;
  currentOwners.add(audit.control_id);
  if(audit.conflictReason){reject(audit.control_id,'Owner placement identity needs review: '+audit.conflictReason);continue;}
  const proof=await identityDigest(ownerIdentityTuple(audit));
  if(!review.owner.has(proof)){
   if(knownOwners.has(audit.control_id))reject(audit.control_id,'The current Owner placement audit has not been reviewed for health identity.');
   continue;
  }
  const ownerDevices=devices.filter(device=>audit.device_ids.map(decimal).includes(decimal(device.id))),boundIds=ownerDevices.map(device=>decimal(device.id)!);
  // Keep the audit's exact unit key; normalization is not permission to create an alias.
  if(!exactSet(boundIds,audit.device_ids.map(decimal))||ownerDevices.some(device=>device.unit_key!==audit.unit_key||deviceIds.get(decimal(device.id))?.length!==1)||unitIds.has(audit.control_id)){reject(audit.control_id,'Owner control identity or exact resource membership is inconsistent.');continue;}
  if(ownerDevices.some(device=>device.source!=='vigilant_control_center'||device.device_type!=='IPC'||!text(device.device_serial)||serialDevices.get(device.device_serial)?.length!==1||!text(device.external_device_id)||externalDevices.get(device.external_device_id)?.length!==1)){
   reject(audit.control_id,'Owner physical camera identity is missing, duplicated or has an unverified provider or resource kind.');continue;
  }
  if(await identityDigest(ownerPhysicalIdentityTuple(audit,ownerDevices))!==review.ownerPhysical[await ownerIdentityKey(audit.control_id)]){
   reject(audit.control_id,'The reviewed Owner physical camera identities have changed.');continue;
  }
  identities.push({unitId:audit.control_id,unitNumber:audit.unit_key,kind:'owner_placement',deviceIds:sortIds(boundIds),unitKeys:[audit.unit_key],proof,placementAuditId:decimal(audit.id)!});
 }
 for(const unitId of knownOwners)if(!currentOwners.has(unitId))reject(unitId,'The reviewed Owner placement control is no longer current.');
 // No approved overlap exists. Future overlapping aliases require a separately reviewed association.
 const claims=new Map<string,Set<string>>();
 for(const identity of identities)for(const id of identity.deviceIds)claims.set(id,new Set([...(claims.get(id)||[]),identity.unitId]));
 const conflicts=new Set(identities.filter(identity=>identity.deviceIds.some(id=>claims.get(id)!.size!==1)).map(identity=>identity.unitId));
 for(const unitId of conflicts)reject(unitId,'Health resources have more than one equipment identity.');
 return {identityVersion:1 as const,unitIdentities:identities.filter(identity=>!warnings.has(identity.unitId)).sort((a,b)=>a.unitId.localeCompare(b.unitId)),identityWarnings:[...warnings.values()].sort((a,b)=>a.unitId.localeCompare(b.unitId))};
}

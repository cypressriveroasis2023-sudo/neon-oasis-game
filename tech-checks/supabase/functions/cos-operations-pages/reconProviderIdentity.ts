import {reconDigest,reconResourceKey,reconAreaKey,type ReconProviderInventory} from '../_shared/reconProviderInventory.ts';
import {REVIEWED_RECON_PROVIDER_GROUPS,type ReconReview} from './reconProviderIdentityScope.ts';
type Row=Record<string,any>;
const object=(v:unknown):v is Row=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const id=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):typeof v==='string'&&/^[1-9]\d*$/.test(v)?v:null;
const exact=(a:string[],b:string[])=>a.length===b.length&&new Set(a).size===a.length&&new Set(b).size===b.length&&a.every(v=>b.includes(v));
const fresh=(v:unknown,now:number)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&Date.parse(v)>0&&Date.parse(v)<=now&&now-Date.parse(v)<=20*60*1000;
export const reconTrackerKey=(unitId:string)=>reconDigest(['COS_RECON_TRACKER_V1',unitId]);
export const reconTrackerTuple=(unit:Row)=>['COS_RECON_TRACKER_ASSIGNMENT_V1',unit.id,unit.unitNumber,unit.modelName,unit.readOnly,unit.recordSource??null,unit.snapshotImportedAt??null,unit.sourceVerifiedAt??null];
export const reconPhysicalTuple=(devices:Row[])=>['COS_RECON_AREA_PHYSICAL_V1',devices.map(d=>[id(d.id),d.source,d.device_type,d.external_device_id,d.device_serial,d.unit_key]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))];
export async function projectReconProviderIdentities(units:Row[],devices:Row[],integrations:Row[],review:Readonly<Record<string,ReconReview>>=REVIEWED_RECON_PROVIDER_GROUPS,now=Date.now()){
 const identities:Row[]=[],warnings:Row[]=[];
 if(![units,devices,integrations].every(x=>Array.isArray(x)&&x.every(object)))throw Error('Reconeyez assignment sources are unavailable.');
 const presentIds=new Map<string,string>(),presentKeys=new Map<string,string>();
 for(const d of devices){if(id(d.id))presentIds.set(await reconDigest(['COS_HEALTH_RESOURCE_V1',id(d.id)]),id(d.id)!);if(typeof d.unit_key==='string')presentKeys.set(await reconDigest(['COS_HEALTH_SOURCE_UNIT_V1',d.unit_key]),d.unit_key);}
 const provider=integrations.length===1&&integrations[0].provider==='reconeyez'?integrations[0]:null,index:ReconProviderInventory|undefined=provider?.identity_inventory;
 const validIndex=Boolean(provider?.enabled===true&&provider.last_sync_status==='ok'&&index?.schemaVersion===1&&fresh(index.observedAt,now)&&fresh(provider.last_sync_at,now)&&Date.parse(provider.last_sync_at)===Date.parse(index.observedAt)&&Number.isSafeInteger(index.resourceCount)&&index.resourceCount>0&&Array.isArray(index.groups)&&index.groups.every(g=>object(g)&&hash(g.areaKey)&&hash(g.proof)&&Array.isArray(g.bridgeKeys)&&g.bridgeKeys.every(hash)&&Array.isArray(g.detectorKeys)&&g.detectorKeys.every(hash)&&typeof g.bridgePrefixUnique==='boolean'&&(g.bridgeLastEventAt===null||typeof g.bridgeLastEventAt==='string')));
 const seen=new Set<string>();
 for(const unit of units){
  if(!uuid(unit.id))continue;const key=await reconTrackerKey(unit.id),expected=review[key];if(!expected)continue;seen.add(key);
  const resources={deviceIds:expected.resourceIds.flatMap(k=>presentIds.has(k)?[presentIds.get(k)!]:[]),unitKeys:expected.sourceKeys.flatMap(k=>presentKeys.has(k)?[presentKeys.get(k)!]:[])};
  const reject=(reason:string)=>warnings.push({unitId:unit.id,reason,...resources});
  if(units.filter(x=>x.id===unit.id).length!==1||unit.readOnly!==true||unit.modelName!=='RECON II'||await reconDigest(reconTrackerTuple(unit))!==expected.trackerProof){reject('The reviewed Recon II tracker assignment changed.');continue;}
  if(!validIndex){reject('Reconeyez inventory proof is missing, stale or its authenticated refresh failed.');continue;}
  const groups=index!.groups.filter(g=>g.areaKey===expected.areaKey||g.bridgeKeys.includes(expected.bridgeKey)),group=groups[0];
  if(groups.length!==1||group.proof!==expected.providerProof||!group.bridgePrefixUnique||!exact(group.bridgeKeys,[expected.bridgeKey])||group.detectorKeys.length!==expected.detectorCount){reject('The reviewed Reconeyez provider-area bridge or detector membership changed.');continue;}
  const rows=devices.filter(d=>resources.deviceIds.includes(String(d.id)));
  if(rows.length!==expected.detectorCount||!exact(rows.map(d=>String(d.id)),resources.deviceIds)||rows.some(d=>devices.filter(x=>String(x.id)===String(d.id)).length!==1||d.source!=='reconeyez'||d.device_type!=='Reconeyez detector'||typeof d.external_device_id!=='string'||d.device_serial!=='reconeyez:'+d.external_device_id||devices.filter(x=>x.external_device_id===d.external_device_id||x.device_serial===d.device_serial).length!==1)||await reconDigest(reconPhysicalTuple(rows))!==expected.physicalProof){reject('The reviewed Reconeyez detector identities are incomplete or replaced.');continue;}
  const keys=[...new Set(rows.map(d=>d.unit_key))];
  if(keys.length!==1||await reconAreaKey(keys[0])!==expected.areaKey||!exact(devices.filter(d=>keys.includes(d.unit_key)).map(d=>String(d.id)),resources.deviceIds)||!exact((await Promise.all(rows.map(d=>reconResourceKey(d.external_device_id)))).sort(),group.detectorKeys)||index!.groups.some(g=>g!==group&&g.detectorKeys.some(k=>group.detectorKeys.includes(k)))){reject('Reconeyez detector provider-area ownership is conflicting or changed.');continue;}
  const proof=await reconDigest(['COS_RECON_REVIEWED_AREA_V1',key,expected]);
  identities.push({unitId:unit.id,unitNumber:unit.unitNumber,kind:'reconeyez_area',deviceIds:resources.deviceIds,unitKeys:keys,proof,providerArea:{detectorCount:expected.detectorCount,inventoryObservedAt:index!.observedAt,bridgeLastEventAt:group.bridgeLastEventAt}});
 }
 for(const [key,expected]of Object.entries(review))if(!seen.has(key)){const deviceIds=expected.resourceIds.flatMap(k=>presentIds.has(k)?[presentIds.get(k)!]:[]),unitKeys=expected.sourceKeys.flatMap(k=>presentKeys.has(k)?[presentKeys.get(k)!]:[]);if(deviceIds.length||unitKeys.length)warnings.push({unitId:'unavailable:recon:'+key,reason:'The reviewed Recon II tracker assignment is missing.',deviceIds,unitKeys});}
 return {reconProviderIdentityVersion:1 as const,reconProviderUnitIdentities:identities,identityWarnings:warnings};
}
/** No provider-area claim can overlap an existing native or Owner-confirmed identity. */
export function appendReconProviderIdentities(identity:Row,recon:Row){
 const all=[...(identity.unitIdentities||[]),...(identity.ownerConfirmedUnitIdentities||[]),...recon.reconProviderUnitIdentities],warnings=[...(identity.identityWarnings||[]),...recon.identityWarnings];
 for(const claim of all)if(all.some(other=>other!==claim&&(other.unitId===claim.unitId||other.deviceIds.some((id:string)=>claim.deviceIds.includes(id))))||warnings.some(w=>w.unitId!==claim.unitId&&(w.deviceIds?.some((id:string)=>claim.deviceIds.includes(id))||w.unitKeys?.some((key:string)=>claim.unitKeys.includes(key)))))warnings.push({unitId:claim.unitId,reason:'Provider resources have conflicting reviewed equipment assignments.',deviceIds:claim.deviceIds,unitKeys:claim.unitKeys});
 const clean=(rows:Row[])=>rows.filter(row=>!warnings.some(w=>w.unitId===row.unitId));
 return {...identity,unitIdentities:clean(identity.unitIdentities||[]),...(identity.ownerConfirmedUnitIdentities?{ownerConfirmedUnitIdentities:clean(identity.ownerConfirmedUnitIdentities)}:{}),reconProviderIdentityVersion:1,reconProviderUnitIdentities:clean(recon.reconProviderUnitIdentities),identityWarnings:[...new Map(warnings.map(w=>[w.unitId,w])).values()]};
}

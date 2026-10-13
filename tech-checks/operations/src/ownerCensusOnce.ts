import { checkedAddressEstimate } from './fieldAddressEstimates';
import { isCurrentFieldPin, normalizeLocationAddress } from './fieldLocations';
import { checkedFieldMap } from './gpsPersistence';
type Row=Record<string,any>;
export type OwnerCensusOnceBinding={nativeUnitId:string;auditId:string;unitKey:string;addressSha256:string;nativeGuardSha256:string};
type Api={get(path:string):Promise<{data:any}>;post(path:string,body:unknown,options?:{signal?:AbortSignal}):Promise<{data:any}>};
const object=(value:unknown):value is Row=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const key=(value:OwnerCensusOnceBinding)=>JSON.stringify(value);
const proofKeys=['contract','nativeUnitId','auditId','unitKey','addressSha256','nativeGuardSha256','complete'];
export const ownerCensusSessionAllowed=(value:unknown)=>object(value)&&value.authorized===true&&value.legacyOwner===true&&value.role==='Owner';
export function ownerCensusPolicyMessage(row:unknown):string|null{
  const r=object(row)&&row.locationGeocode;
  if(!object(r)||r.censusOnly!==true)return null;
  if(r.status==='held'||r.censusOnlyState==='held')return 'The approved lookup is on hold because its current installation evidence could not be verified. Refresh to review its saved state.';
  if(r.censusOnlyState==='draining')return 'The approved lookup is waiting for earlier address work to finish. Refresh later to inspect its availability; no lookup will start automatically.';
  if(r.censusOnlyState==='consumed')return 'The approved lookup allowance is already used. No automatic retry will run.';
  return null;
}
/** A ready cache marker is insufficient: only a complete server-generated native proof enables this action. */
export async function checkedOwnerCensusOnceBinding(snapshot:unknown,nativeUnitId:string,state:'ready'|'consumed'='ready'):Promise<OwnerCensusOnceBinding|null>{
  if(!object(snapshot)||!Array.isArray(snapshot.items)||!Array.isArray(snapshot.ownerCensusProofs)||snapshot.ownerCensusProofs.length>1000)return null;
  const rows=snapshot.items.filter((row:unknown)=>object(row)&&row.id===nativeUnitId);
  if(rows.length!==1)return null;
  const row=rows[0],r=row.locationGeocode,g=r?.censusOnlyGuard;
  if(!uuid(row.id)||row.readOnly!==false||row.placement!=='FIELD'||row.placementSource!=='owner'||row.placementStatus==='needs_identity_review'
    ||row.status!=='field'||row.currentLocationType!=='field'||row.addressSource!=='Owner confirmed installation address'
    ||!['address_changed','address_only'].includes(row.locationVerification)||isCurrentFieldPin(row)||row.latitude!==null||row.longitude!==null
    ||row.coordinateSource!==null||row.locationVerifiedAt!==null||row.locationHistoryId!==null||typeof row.address!=='string'||!row.address.trim()
    ||!object(r)||r.provider!=='us_census_address_range'||r.benchmark!=='Public_AR_Current'||r.censusOnly!==true||r.censusOnlyState!==state
    ||state==='ready'&&!['invalid_address','no_match','provider_error'].includes(r.status)
    ||!object(g)||Object.keys(g).length!==2||g.nativeUnitId!==row.id||!hash(g.nativeGuardSha256)
    ||typeof row.placementAuditId!=='string'||!/^[1-9]\d*$/.test(row.placementAuditId)||r.auditId!==row.placementAuditId
    ||typeof row.placementUnitKey!=='string'||!row.placementUnitKey.trim()||r.unitKey!==row.placementUnitKey||!hash(r.addressSha256))return null;
  const matches=snapshot.ownerCensusProofs.filter((p:unknown)=>object(p)&&p.nativeUnitId===row.id);
  if(matches.length!==1)return null;
  const p=matches[0];
  if(Object.keys(p).length!==proofKeys.length||proofKeys.some(name=>!Object.hasOwn(p,name))||p.contract!=='COS_OWNER_ONE_CENSUS_NATIVE_V1'||p.complete!==true
    ||p.auditId!==r.auditId||p.unitKey!==r.unitKey||p.addressSha256!==r.addressSha256||p.nativeGuardSha256!==g.nativeGuardSha256)return null;
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalizeLocationAddress(row.address)))),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(digest!==r.addressSha256)return null;
  return {nativeUnitId:row.id,auditId:r.auditId,unitKey:r.unitKey,addressSha256:r.addressSha256,nativeGuardSha256:g.nativeGuardSha256};
}
export type OwnerCensusOnceResult={snapshot:Row;outcome:'estimate'|'current_verified'|'no_match'|'changed'|'unconfirmed';message:string};
/** One deliberate POST, never replayed. Both success and uncertainty are resolved only by a fresh map read. */
export function createOwnerCensusOnceAction(api:Api,now=()=>Date.now()){
  let running=false,epoch=0,controller:AbortController|null=null;
  const attempted=new Set<string>();
  return {
    get busy(){return running;},
    wasAttempted(binding:OwnerCensusOnceBinding){return attempted.has(key(binding));},
    invalidate(){epoch++;controller?.abort();},
    async run(binding:OwnerCensusOnceBinding,isCurrent=()=>true):Promise<OwnerCensusOnceResult>{
      if(running)throw Error('An approved Census lookup is already in progress.');
      const expected=structuredClone(binding),fingerprint=key(expected),generation=epoch;
      if(attempted.has(fingerprint))throw Error('This approved lookup was already submitted. Refresh to inspect its saved result.');
      const current=()=>generation===epoch&&isCurrent();
      if(!current())throw Error('The selected installation or session changed. Refresh before continuing.');
      running=true;controller=new AbortController();
      try{
        if(!ownerCensusSessionAllowed((await api.get('/api/session')).data)||!current())throw Error('An active Owner session is required for this approved lookup.');
        const before=checkedFieldMap((await api.get('/api/field-map')).data);
        const fresh=await checkedOwnerCensusOnceBinding(before,expected.nativeUnitId);
        if(!current()||!fresh||key(fresh)!==fingerprint)throw Error('The approved installation or allowance changed. Refresh the map; no lookup was sent.');
        if(!ownerCensusSessionAllowed((await api.get('/api/session')).data)||!current())throw Error('The Owner session changed. No lookup was sent.');
        attempted.add(fingerprint);
        const {nativeUnitId,...body}=expected;
        try{await api.post('/api/field-map/'+nativeUnitId+'/owner-census-once',body,{signal:controller.signal});}
        catch{/* A timeout may already have consumed the allowance. Never repeat the POST. */}
        if(!current())throw Error('The lookup result belongs to an earlier selection or session. Refresh to inspect its saved state.');
        let snapshot:Row;
        try{snapshot=checkedFieldMap((await api.get('/api/field-map')).data);}
        catch{throw Error('The approved lookup could not be confirmed. Refresh to inspect its saved result; this view will not send it again.');}
        if(!current())throw Error('The lookup result belongs to an earlier selection or session. Refresh to inspect its saved state.');
        const rows=snapshot.items.filter((row:Row)=>row.id===expected.nativeUnitId),row=rows.length===1?rows[0]:null;
        if(row&&isCurrentFieldPin(row))return {snapshot,outcome:'current_verified',message:'A current Owner-verified location is available and remains authoritative.'};
        const consumed=await checkedOwnerCensusOnceBinding(snapshot,expected.nativeUnitId,'consumed');
        if(!current())throw Error('The selected installation or session changed. Refresh to inspect its saved state.');
        if(!row||row.placementAuditId!==expected.auditId||row.placementUnitKey!==expected.unitKey||row.locationGeocode?.addressSha256!==expected.addressSha256)
          return {snapshot,outcome:'changed',message:'The installation changed. The map now shows the latest saved state; no lookup will be repeated.'};
        if(row.locationGeocode?.status==='held'||row.locationGeocode?.censusOnlyState==='draining')return {snapshot,outcome:'unconfirmed',message:ownerCensusPolicyMessage(row)||'The approved lookup is on hold. Refresh to review its saved state.'};
        if(consumed&&key(consumed)===fingerprint){
          const estimate=await checkedAddressEstimate(row,now());
          if(!current())throw Error('The selected installation or session changed. Refresh to inspect its saved state.');
          if(estimate?.confidence==='address_range_interpolation')return {snapshot,outcome:'estimate',message:'The Census building estimate is available. The suite and installed unit position remain unverified.'};
          if(['no_match','invalid_address','provider_error'].includes(row.locationGeocode.status))return {snapshot,outcome:'no_match',message:'The approved Census lookup produced no usable building estimate. The allowance is used; no automatic retry will run.'};
        }
        return {snapshot,outcome:'unconfirmed',message:'The approved lookup is not yet confirmed. Refresh to inspect its saved status; no lookup will be repeated.'};
      }finally{running=false;controller=null;}
    },
  };
}

import { normalizeLocationAddress, isCurrentFieldPin } from './fieldLocations';
import { checkedFieldMap } from './gpsPersistence';
import { ownerCensusSessionAllowed } from './ownerCensusOnce';
type Row=Record<string,any>;
type Api={get(path:string):Promise<{data:any}>;post(path:string,body:unknown,options?:{signal?:AbortSignal}):Promise<{data:any}>};
export type OwnerCensusPreparationBinding={nativeUnitId:string;auditId:string;unitKey:string;addressSha256:string;snapshotSha256:string};
export type OwnerCensusPreparationReceipt={eligible:true;nativeGuardSha256:string;nativeSourceSha256:string;preparedAt:string};
const object=(value:unknown):value is Row=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
const stable=(value:unknown)=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const ownerId=(value:unknown)=>ownerCensusSessionAllowed(value)&&object(value)&&uuid(value.productionOwnerUserId)?value.productionOwnerUserId:null;
/** Preparation is an exact private server marker, never an allowance or a general lookup control. */
export async function checkedOwnerCensusPreparationBinding(snapshot:unknown,nativeUnitId:string):Promise<OwnerCensusPreparationBinding|null>{
  if(!object(snapshot)||!Array.isArray(snapshot.items))return null;
  const rows=snapshot.items.filter((row:unknown)=>object(row)&&row.id===nativeUnitId);
  if(rows.length!==1)return null;
  const row=rows[0],r=row.locationGeocode,p=r?.censusPreparation;
  if(!uuid(row.id)||row.readOnly!==false||row.placement!=='FIELD'||row.placementSource!=='owner'||row.placementStatus==='needs_identity_review'
    ||row.status!=='field'||row.currentLocationType!=='field'||row.addressSource!=='Owner confirmed installation address'
    ||!['address_changed','address_only'].includes(row.locationVerification)||isCurrentFieldPin(row)||row.latitude!==null||row.longitude!==null
    ||row.coordinateSource!==null||row.locationVerifiedAt!==null||row.locationHistoryId!==null||typeof row.address!=='string'||!row.address.trim()
    ||!object(r)||r.status!=='invalid_address'||r.provider!=='us_census_address_range'||r.benchmark!=='Public_AR_Current'
    ||r.censusOnly!=null||r.censusOnlyState!=null||r.censusOnlyGuard!=null
    ||!object(p)||Object.keys(p).length!==1||p.nativeUnitId!==row.id
    ||typeof row.placementAuditId!=='string'||!/^[1-9]\d*$/.test(row.placementAuditId)||r.auditId!==row.placementAuditId
    ||typeof row.placementUnitKey!=='string'||!row.placementUnitKey.trim()||r.unitKey!==row.placementUnitKey||!hash(r.addressSha256))return null;
  if(snapshot.ownerCensusProofs!==undefined&&(!Array.isArray(snapshot.ownerCensusProofs)||snapshot.ownerCensusProofs.some((proof:unknown)=>object(proof)&&proof.nativeUnitId===row.id)))return null;
  if(await digest(normalizeLocationAddress(row.address))!==r.addressSha256)return null;
  // A client-only public-row fingerprint detects source changes between display/preflight/readback.
  // It grants no authority, is never transmitted, and is separate from the complete native server proof.
  return {nativeUnitId:row.id,auditId:r.auditId,unitKey:r.unitKey,addressSha256:r.addressSha256,snapshotSha256:await digest(stable(row))};
}
export function checkedOwnerCensusPreparationReceipt(value:unknown):OwnerCensusPreparationReceipt|null{
  if(!object(value)||Object.keys(value).length!==4||value.eligible!==true||!hash(value.nativeGuardSha256)||!hash(value.nativeSourceSha256)||typeof value.preparedAt!=='string')return null;
  const parts=/^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value.preparedAt);
  if(!parts||!Number.isFinite(Date.parse(value.preparedAt)))return null;
  const calendar=new Date(Date.UTC(Number(parts[1]),Number(parts[2])-1,Number(parts[3])));
  if(calendar.getUTCFullYear()!==Number(parts[1])||calendar.getUTCMonth()+1!==Number(parts[2])||calendar.getUTCDate()!==Number(parts[3]))return null;
  return {eligible:true,nativeGuardSha256:value.nativeGuardSha256,nativeSourceSha256:value.nativeSourceSha256,preparedAt:value.preparedAt};
}
/** One explicit read-only proof request. This never enrolls an allowance or calls the Run endpoint. */
export function createOwnerCensusPreparation(api:Api,now=()=>Date.now()){
  let running=false,epoch=0,controller:AbortController|null=null;
  return {
    get busy(){return running;},
    invalidate(){epoch++;controller?.abort();},
    async prepare(binding:OwnerCensusPreparationBinding,isCurrent=()=>true):Promise<{snapshot:Row;receipt:OwnerCensusPreparationReceipt}>{
      if(running)throw Error('Preparation is already in progress.');
      const expected=structuredClone(binding),generation=epoch,current=()=>generation===epoch&&isCurrent();
      const same=(value:OwnerCensusPreparationBinding|null)=>value&&stable(value)===stable(expected);
      if(!current())throw Error('The selected installation or session changed. Refresh before preparing.');
      running=true;controller=new AbortController();
      try{
        const actor=ownerId((await api.get('/api/session')).data);
        if(!actor||!current())throw Error('An active Owner session is required to prepare this lookup.');
        const before=checkedFieldMap((await api.get('/api/field-map')).data);
        if(!same(await checkedOwnerCensusPreparationBinding(before,expected.nativeUnitId))||!current())throw Error('The approved preparation or installation changed. Refresh the map; no lookup was started.');
        if(ownerId((await api.get('/api/session')).data)!==actor||!current())throw Error('The Owner session changed. No lookup was started.');
        const body={auditId:expected.auditId,unitKey:expected.unitKey,addressSha256:expected.addressSha256};
        const requestedAt=now();
        let result:unknown;
        try{result=(await api.post('/api/field-map/'+expected.nativeUnitId+'/owner-census-prepare',body,{signal:controller.signal})).data;}
        catch(cause){
          // Display only safe categories, never transport/backend error text or response bodies.
          const failure=object(cause)?cause.preparationFailure:null,status=object(cause)&&object(cause.response)?cause.response.status:null;
          const category=['timeout','auth','source_hold','upstream_failure','cancelled'].includes(failure)?failure
            :[401,403].includes(status)?'auth':status===409?'source_hold':[408,504].includes(status)?'timeout':status===499?'cancelled':'upstream_failure';
          const messages={
            timeout:'Preparation timed out while waiting for saved evidence. No lookup was started. Refresh before preparing again.',
            auth:'Preparation stopped because the Owner session could not be verified. No lookup was started.',
            source_hold:'Preparation is on hold because the current approval or installation evidence could not be verified. No lookup was started. Refresh to review its saved state.',
            upstream_failure:'Preparation could not reach or read the saved evidence service. No lookup was started. Refresh before preparing again.',
            cancelled:'Preparation was cancelled because the selection or session changed. No lookup was started.',
          };
          throw Error(messages[category as keyof typeof messages]);
        }
        if(!current())throw Error('Preparation belongs to an earlier selection or session. No lookup was started.');
        const receipt=checkedOwnerCensusPreparationReceipt(result);
        if(!receipt)throw Error('Preparation returned incomplete or unsupported proof. No lookup was started.');
        // Permit ordinary clock skew, but reject an old cached or future receipt.
        if(Date.parse(receipt.preparedAt)<requestedAt-120000||Date.parse(receipt.preparedAt)>now()+120000)throw Error('Preparation returned a stale or future receipt. No lookup was started.');
        const snapshot=checkedFieldMap((await api.get('/api/field-map')).data);
        if(!same(await checkedOwnerCensusPreparationBinding(snapshot,expected.nativeUnitId))||!current())throw Error('The installation changed during preparation. Refresh and prepare again; no lookup was started.');
        if(ownerId((await api.get('/api/session')).data)!==actor||!current())throw Error('The Owner session changed. The preparation is no longer available.');
        return {snapshot,receipt};
      }finally{running=false;controller=null;}
    },
  };
}

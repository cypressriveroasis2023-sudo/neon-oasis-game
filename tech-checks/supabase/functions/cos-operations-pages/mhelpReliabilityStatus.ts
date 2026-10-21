/** Credential-free allowlist for existing authenticated placement snapshots. */
type Row=Record<string,any>;
const object=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const stamp=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null;
export function checkedMhelpReliabilityStatus(value:unknown){
 if(!object(value)||value.contract!=='COS_MHELP_RELIABILITY_STATUS_V1'||!object(value.auth)||!object(value.inventory))return null;
 const a=value.auth,i=value.inventory;
 if(!['verified','reconnect_required','not_yet_verified'].includes(a.state)||typeof i.paused!=='boolean'||typeof i.updating!=='boolean'||typeof i.failed!=='boolean')return null;
 // Never pass through token revisions, errors, arbitrary provider text or extras.
 return {contract:'COS_MHELP_RELIABILITY_STATUS_V1',auth:{state:a.state,verifiedAt:stamp(a.verifiedAt),renewalCheckFailed:a.renewalCheckFailed===true,renewalFailedAt:stamp(a.renewalFailedAt)},inventory:{paused:i.paused,updating:i.updating,failed:i.failed,
  lastAttemptAt:stamp(i.lastAttemptAt),lastSuccessAt:stamp(i.lastSuccessAt),nextEligibleAt:stamp(i.nextEligibleAt)}};
}
export function attachMhelpReliabilityStatus(snapshot:Row,receipt:unknown):Row{
 const status=checkedMhelpReliabilityStatus(object(receipt)?receipt.reliability:null);
 if(!object(snapshot.mhelpPlacementSync))return snapshot;
 const {reliability:_prior,...sync}=snapshot.mhelpPlacementSync;
 return {...snapshot,mhelpPlacementSync:{...sync,...(status?{reliability:status}:{})}};
}

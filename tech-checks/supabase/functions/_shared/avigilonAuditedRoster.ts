import type {Roster,AuditUnit,Endpoint} from './avigilonCheckRun.ts';
/** Inputs are the server's reconciled upload/map, independently verified resource
 * identities and current device records. No name, address or IP identity joins. */
export async function auditedAvigilonRoster(tenantId:string,snapshot:any,identities:any[],devices:any[]):Promise<Roster>{
 if(!snapshot?.uploadInventory?.sourceSha256||!snapshot.uploadInventory.payloadSha256||!Array.isArray(snapshot.fleetRoster?.items)||!Array.isArray(identities)||!Array.isArray(devices))throw Error('Audited roster unavailable');
 const units:AuditUnit[]=snapshot.fleetRoster.items.flatMap((r:any)=>{
  const claims=identities.filter(i=>i.unitId===r.unitId),ids=claims.length===1?claims[0].deviceIds:[];
  const members=Array.isArray(ids)&&ids.length&&new Set(ids).size===ids.length?ids:[null];
  return members.map((deviceId:string|null)=>{
  const hits=deviceId?devices.filter(d=>String(d.id)===deviceId):[];
  const d=hits.length===1?hits[0]:null,verified=r.kind==='unit'&&['field','shop'].includes(r.placement)&&!!r.unitId&&claims.length===1&&d!==null;
  const restricted=r.lifecycle!=='active'||r.active!==true||/DO NOT USE/i.test(r.unitNumber)||Boolean(d&&(d.monitoring_enabled!==true||String(d.activation_state).toLowerCase()!=='active'));
  const endpoint:Endpoint|null=verified&&d.public_ip?{deviceId:String(d.id),revision:String(d.connection_revision),ip:d.public_ip,ports:Array.isArray(d.expected_ports)?d.expected_ports:[],profile:d.monitoring_profile}:null;
  return {id:members.length>1?r.id+'/'+deviceId:r.id,name:members.length>1?r.unitNumber+' · Device '+deviceId:r.unitNumber,family:r.category,placement:r.placement==='field'?'FIELD':r.placement==='shop'?'SHOP':r.recordedSourcePlacement==='field'?'FIELD':r.recordedSourcePlacement==='shop'?'SHOP':'UNKNOWN',restricted,identityVerified:verified,endpoint};
  });
 });
 const payload=JSON.stringify([tenantId,snapshot.uploadInventory.sourceSha256,snapshot.uploadInventory.payloadSha256,snapshot.uploadInventory.scopedRevision??0,units]);
 const revision=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload))),v=>v.toString(16).padStart(2,'0')).join('');
 return {tenantId,revision,units};
}

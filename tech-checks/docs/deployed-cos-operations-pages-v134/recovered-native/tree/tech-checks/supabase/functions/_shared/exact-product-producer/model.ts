/** Inert review candidate. No network, credential, database or scheduler adapter. */
import {buildExactProductConnections, completedSavedTcpCheck, TRACKER_CONNECTION_CENSUS_V2,
 type SavedTcpEndpoint} from '../../../../operations/src/exactProductConnection.ts';
import {directPublicHost} from '../scheduledDirectService.ts';

type Row=Record<string,any>;
export const CONTRACT='COS_EXACT_PRODUCT_PRODUCER_V1';
export const FAMILIES=['Spotter','Solar Spotter','Ranger'] as const;
const ID=/^[1-9][0-9]{0,14}$/;
const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const object=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const revision=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?String(v):typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)?v:null;
const terminal=(v:unknown)=>typeof v==='string'&&/(?:^|\W)(RETIRED|DECOMMISSIONED|STOLEN|DNU|DO\s+NOT\s+USE|NOT\s+IN\s+USE)(?:$|\W)/i.test(v);
export type Endpoint=SavedTcpEndpoint & {source:string;monitoringProfile:string;activationState:string;unitKey:string;deviceName:string;organization:string};
/** This is a REQUIRED FUTURE trusted admission contract, not an authorization
 * obtainable from IP/name matching, PR306 preview, or an untrusted request.
 * The adapter must validate the committed Product->native->resource chain,
 * ownership/reservations and complete membership against current epochs. */
export type IdentityAdmission={
 contract:'COS_COMMITTED_PRODUCT_DEVICE_V1';productId:string;nativeUnitId:string;
 deviceIds:string[];family:typeof FAMILIES[number];protocol:'saved_tcp';
 source:string;monitoringProfile:string;state:'active'|'held'|'revoked';
 admissionRevision:string;nativeEpoch:string;resourceEpoch:string;physicalDigest:string;
};
export type Snapshot={
 contract:typeof CONTRACT;complete:true;authorityEpoch:string;
 mhelp:Row;tracker:Row;endpoints:Endpoint[];identities:IdentityAdmission[];
};
export type Candidate={productId:string;device:Endpoint;identity:IdentityAdmission;guard:string};
export type Plan={selected:Candidate[];held:{productId:string;reason:string}[]};
function canonical(v:any):string{
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(object(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
 return JSON.stringify(v);
}
export async function digest(v:unknown):Promise<string>{
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v)));
 return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export function targetsValid(ids:readonly string[]):boolean{
 return Array.isArray(ids)&&ids.length>0&&ids.length<=64&&new Set(ids).size===ids.length&&ids.every(id=>typeof id==='string'&&ID.test(id));
}
/** Preserve ALL consumer admission holds without generating fake TCP proof.
 * Null proofs intentionally make its final missing-proof hold the ONLY allow
 * case. This exact text dependency fails closed if consumer wording changes;
 * migrate to a shared machine-readable admission result in a separate review. */
const MISSING_PROOF='No fresh, completed, exact-target TCP/service-port check is available.';
export async function planExactProductChecks(raw:Snapshot,ids:readonly string[],now:number):Promise<Plan>{
 if(!targetsValid(ids))throw Error('Invalid bounded Product-ID selection');
 const fail=(reason:string):Plan=>({selected:[],held:ids.map(productId=>({productId,reason}))});
 if(!object(raw)||raw.contract!==CONTRACT||raw.complete!==true||!SHA.test(raw.authorityEpoch)
  ||!object(raw.mhelp)||raw.mhelp.source!=='mhelpdesk_api'||!object(raw.tracker)||raw.tracker.contract!==TRACKER_CONNECTION_CENSUS_V2
  ||!Array.isArray(raw.endpoints)||!Array.isArray(raw.identities)||raw.identities.length>10000
  ||raw.endpoints.some(d=>!object(d))||raw.identities.some(d=>!object(d)))return fail('source_unavailable');
 const proofFree=raw.endpoints.map(d=>({...d,portStatus:null}));
 const evaluated=buildExactProductConnections(raw.mhelp,raw.tracker,proofFree,now);
 if(!evaluated)return fail('source_unavailable');
 // Duplicate IDs at different IPs must not let publication hit another row.
 if(new Set(raw.endpoints.map(d=>String(d.deviceId))).size!==raw.endpoints.length)return fail('duplicate_device_id');
 const {verifiedAt: _verifiedAt,...trackerGuard}=raw.tracker;
 const guard=await digest({authorityEpoch:raw.authorityEpoch,mhelp:raw.mhelp,tracker:trackerGuard,
  endpoints:proofFree.map(({portStatus,...d})=>d),identities:raw.identities});
 const selected:Candidate[]=[],held:Plan['held']=[];
 for(const productId of ids){
  const hold=(reason:string)=>held.push({productId,reason});
  const item=evaluated.items.find(p=>p.productId===productId);
  if(!item||item.status!=='unknown'||item.reason!==MISSING_PROOF){hold('source_identity_or_endpoint_hold');continue;}
  const claims=raw.identities.filter(i=>i.productId===productId),i=claims[0];
  if(claims.length!==1||i.contract!=='COS_COMMITTED_PRODUCT_DEVICE_V1'||i.state!=='active'||!UUID.test(i.nativeUnitId)
   ||!FAMILIES.includes(i.family)||i.protocol!=='saved_tcp'||revision(i.admissionRevision)===null
   ||![i.nativeEpoch,i.resourceEpoch,i.physicalDigest].every(v=>typeof v==='string'&&SHA.test(v))
   ||!Array.isArray(i.deviceIds)||i.deviceIds.length!==1||!ID.test(i.deviceIds[0])
   ||!i.source||!i.monitoringProfile){hold('committed_identity_required');continue;}
  // Revoked/foreign/held identity commitments continue to reserve resources.
  if(raw.identities.some(other=>other!==i&&(other.nativeUnitId===i.nativeUnitId||
   !Array.isArray(other.deviceIds)||other.deviceIds.some(id=>i.deviceIds.includes(id))))){hold('identity_reservation_conflict');continue;}
  const d=raw.endpoints.find(d=>String(d.deviceId)===i.deviceIds[0]);
  const tracker=raw.tracker.records.find((r:Row)=>r.productId===productId);
  if(!d||d.publicIp!==tracker.publicIp||d.source!==i.source||d.monitoringProfile!==i.monitoringProfile){hold('endpoint_ownership_changed');continue;}
  if(d.monitoringEnabled!==true||!['active','deactivated'].includes(d.activationState)
   ||[d.activationState,d.unitKey,d.deviceName,d.organization].some(terminal)){hold('monitoring_or_lifecycle_hold');continue;}
  if(!directPublicHost(d.publicIp)||directPublicHost(d.publicIp)!==d.publicIp||revision(d.connectionRevision)===null
   ||!Array.isArray(d.expectedPorts)||!d.expectedPorts.length||d.expectedPorts.length>32
   ||new Set(d.expectedPorts).size!==d.expectedPorts.length||d.expectedPorts.some(p=>!Number.isInteger(p)||p<1||p>65535)){
   hold('saved_configuration_invalid');continue;
  }
  selected.push({productId,device:structuredClone(d),identity:structuredClone(i),guard});
 }
 return {selected,held};
}
export type PortOutcome={online:boolean;attempted:true;latency_ms:number|null;error?:string};
/** Consume the same strict completed-proof validator as the display consumer. */
export function completedObservation(c:Candidate,ports:Record<string,unknown>,at:number){
 const reachable=Object.values(ports).some(p=>object(p)&&p.online===true);
 const portStatus={...ports,_connection:{ip:c.device.publicIp,revision:c.device.connectionRevision,
  checkedAt:new Date(at).toISOString(),status:reachable?'online':'offline',reachable}};
 const checked=completedSavedTcpCheck({...c.device,portStatus},at);
 return checked?{portStatus,status:checked.status,checkedAt:checked.checkedAt}:null;
}

import {readMhelpInventoryAuthority} from './mhelpInventoryAuthority';
import {cameraTimestamp} from './cameraEvidence';
import {savedCameraConnection} from '../../supabase/functions/cos-operations-pages/cameraEvidence';

/** Pure, read-only boundary between the accepted mHelp Product-ID census,
 * the server's CURRENT 2027 tracker read, and saved TCP/service-port checks.
 * Never accept an IP supplied by a browser or infer Product IDs from labels.
 *
 * The server must construct the tracker envelope from its protected Google
 * Viewer read and independently validate the complete Product-ID census.
 * This model does NOT fetch endpoints, trigger checks or write inventory.
 */
export const EXACT_PRODUCT_CONNECTION_CONTRACT='COS_EXACT_PRODUCT_CONNECTIONS_V2' as const;
export const VERIFIED_TRACKER_IP_CONTRACT='COS_VERIFIED_2027_PRODUCT_IPS_V1' as const;
export const TRACKER_CONNECTION_CENSUS_V2='COS_VERIFIED_2027_PRODUCT_IPS_V2' as const;
export const TRACKER_CONNECTION_HOLDS=['placement_mismatch','customer_mismatch','identity_mismatch','tracker_restriction'] as const;
export type TrackerConnectionHold=typeof TRACKER_CONNECTION_HOLDS[number];
export const TRACKER_IP_WORKBOOK='1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA';
const ID=/^[1-9][0-9]{0,14}$/;
const HASH=/^[a-f0-9]{64}$/;
const SOURCE_FRESH_MS=30*60*1000;
const object=(v:unknown):v is Record<string,any>=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const safeTime=(v:unknown,now:number,windowMs:number):string|null=>{
 if(typeof v!=='string')return null;
 const parsed=Date.parse(v);
 return Number.isFinite(parsed)&&parsed>0&&parsed<=now&&now-parsed<=windowMs?new Date(parsed).toISOString():null;
};
export type VerifiedTrackerIpRow={
 productId:string;recordId:string;placement:'FIELD'|'SHOP';publicIp:string|null;
 reviewReasons?:TrackerConnectionHold[];sourceRow?:number;
};
export type VerifiedTrackerIpCensus={
 contract:typeof VERIFIED_TRACKER_IP_CONTRACT;
 workbookId:typeof TRACKER_IP_WORKBOOK;
 expectedMhelpSourceSha256:string;
 verifiedAt:string;
 records:VerifiedTrackerIpRow[];
};
export type VerifiedTrackerIpCensusV2=Omit<VerifiedTrackerIpCensus,'contract'> & {
 contract:typeof TRACKER_CONNECTION_CENSUS_V2;
 trackerSourceSha256:string;sourceExport:string;
 records:Array<VerifiedTrackerIpRow & {reviewReasons:TrackerConnectionHold[];sourceRow:number}>;
};
export type SavedTcpEndpoint={
 deviceId:number|string;
 publicIp:string|null;
 expectedPorts:number[];
 connectionRevision:number|string;
 monitoringEnabled:boolean;
 portStatus:Record<string,unknown>|null;
};
export type ExactProductConnectionStatus='online'|'offline'|'unknown';
export type ExactProductConnection={
 productId:string;
 status:ExactProductConnectionStatus;
 basis:'tcp_service_port';
 checkedAt:string|null;
 resourceId:string|null;
 reason:string;
};
export type ExactProductConnectionEnvelope={
 contract:typeof EXACT_PRODUCT_CONNECTION_CONTRACT;
 sourceSha256:string;
 trackerVerifiedAt:string;
 items:ExactProductConnection[];
};
const unknown=(productId:string,reason:string):ExactProductConnection=>({
 productId,status:'unknown',basis:'tcp_service_port',checkedAt:null,resourceId:null,reason
});
const publicIp=(value:unknown):string|null=>{
 if(typeof value!=='string'||!value||value!==value.trim())return null;
 const saved=savedCameraConnection(value,[]);
 return saved?.publicIp===value?value:null;
};
const revision=(value:unknown):string|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?String(value):
 typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)?value:null;
/** A completed TCP timeout or explicit refusal is a valid nonresponse.
 * Routing, DNS, permission, authentication and arbitrary transport errors are
 * not a completed reachability result. Do not collapse all socket errors.
 */
const validPortNonresponseError=(v:unknown)=>v===undefined||v===null
 ||v==='timeout'||v==='Connection refused (os error 111)'
 ||v==='Connection timed out (os error 110)';
/** The saved sweep schema does not include "attempted" on historic port
 * records. Those records prove a real attempt with a measured positive
 * response, or with an explicit bounded TCP nonresponse and a latency field.
 * A bare online:false (or online:true) must never be interpreted as a
 * completed service-port probe.
 */
const completedPortOutcome=(v:unknown):v is Record<string,any>=>{
 if(!object(v)||typeof v.online!=='boolean'||v.attempted===false
   ||v.attempted!==undefined&&v.attempted!==true
   ||v.errorCode||v.error_code||v.technicalError)return false;
 const hasLatency=typeof v.latency_ms==='number'&&Number.isFinite(v.latency_ms)&&v.latency_ms>=0;
 const measured=Object.hasOwn(v,'latency_ms')&&(v.latency_ms===null||hasLatency);
 if(v.online)return (v.error===undefined||v.error===null)&&(v.attempted===true||hasLatency);
 return validPortNonresponseError(v.error)
  &&(v.attempted===true||typeof v.error==='string'&&measured);
};
const deviceId=(v:unknown):string|null=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):
 typeof v==='string'&&ID.test(v)?v:null;

/** The evidence boundary is deliberately stricter than displaying a saved
 * endpoint: every configured port must have one finished Boolean outcome,
 * the checked IP and configuration revision must still match, and the
 * underlying observation must be recent. A first valid complete negative
 * result is OFFLINE; confirmedOutage and three-failure thresholds are NOT
 * applied to connectivity. Video and provider acceptance are not checked.
 */
export function completedSavedTcpCheck(device:SavedTcpEndpoint,now=Date.now()):Omit<ExactProductConnection,'productId'>|null{
 if(device.monitoringEnabled!==true||!deviceId(device.deviceId))return null;
 const ip=publicIp(device.publicIp),rev=revision(device.connectionRevision);
 if(!ip||rev===null||!Array.isArray(device.expectedPorts)||!device.expectedPorts.length||device.expectedPorts.length>128||!object(device.portStatus))return null;
 const ports=device.expectedPorts;
 if(new Set(ports).size!==ports.length||ports.some(v=>!Number.isInteger(v)||v<1||v>65535))return null;
 const proof=device.portStatus._connection;
 if(!object(proof)||proof.ip!==ip||revision(proof.revision)!==rev||!['online','offline','verifying'].includes(proof.status)||typeof proof.reachable!=='boolean'
  ||proof.error||proof.errorCode||proof.error_code)return null;
 const observed=cameraTimestamp(proof.checkedAt,now);
 if(!observed.fresh||!observed.at)return null;
 const checkedAt=observed.at;
 const observedPorts=Object.keys(device.portStatus).filter(k=>/^[1-9][0-9]{0,4}$/.test(k)&&Number(k)<=65535);
 if(observedPorts.length!==ports.length||ports.some(p=>!observedPorts.includes(String(p))))return null;
 const states=ports.map(port=>device.portStatus![String(port)]);
 if(states.some(v=>!completedPortOutcome(v)))return null;
 const responded=states.some(v=>(v as Record<string,any>).online===true);
 if(responded&&proof.status==='online'&&proof.reachable===true)return {
  status:'online',basis:'tcp_service_port',checkedAt,resourceId:deviceId(device.deviceId),
  reason:'Completed saved TCP/service-port check responded. Camera video is not verified.'
 };
 if(!responded&&['offline','verifying'].includes(proof.status)&&proof.reachable===false)return {
  status:'offline',basis:'tcp_service_port',checkedAt,resourceId:deviceId(device.deviceId),
  reason:'Completed saved TCP/service-port check had no response on all configured ports. Camera video is not verified.'
 };
 return null;
}

/** Missing/duplicate IDs, changed source hashes or workbook identity fail
 * the whole census closed. V1 still requires every placement to agree. V2
 * keeps explicit per-Product-ID source holds as Unknown, never relocates
 * inventory, and still reserves held/Shop endpoint ownership. No IPs leave.
 */
export function buildExactProductConnections(
 acceptedMhelp:unknown,tracker:unknown,devices:readonly SavedTcpEndpoint[],now=Date.now(),resourceMembership?:ReadonlyMap<string,readonly string[]>
):ExactProductConnectionEnvelope|null{
 const authority=readMhelpInventoryAuthority(acceptedMhelp,now);
 if(!authority||authority.stale||!object(tracker)||![VERIFIED_TRACKER_IP_CONTRACT,TRACKER_CONNECTION_CENSUS_V2].includes(tracker.contract)
  ||tracker.workbookId!==TRACKER_IP_WORKBOOK
  ||tracker.expectedMhelpSourceSha256!==authority.sourceSha256
  ||!HASH.test(tracker.expectedMhelpSourceSha256)
  ||!safeTime(tracker.verifiedAt,now,SOURCE_FRESH_MS)
  ||!Array.isArray(tracker.records)||tracker.records.length!==authority.total
  ||!Array.isArray(devices)||devices.length>10000)return null;
 const isolated=tracker.contract===TRACKER_CONNECTION_CENSUS_V2;
 if(isolated&&(!HASH.test(tracker.trackerSourceSha256)||!/^ServiceItem_List_[0-9]{14}\.csv$/.test(tracker.sourceExport)))return null;
 const products=(acceptedMhelp as {records:Record<string,any>[]}).records;
 const expected=new Map(products.map(p=>[p.productId,p]));
 const byProduct=new Map<string,VerifiedTrackerIpRow>();
 const ipClaims=new Map<string,number>(),sourceRows=new Set<number>();
 for(const raw of tracker.records){
  if(!object(raw)||typeof raw.productId!=='string'||!ID.test(raw.productId)||byProduct.has(raw.productId)
   ||raw.recordId!=='mhelp_product:'+raw.productId||!['FIELD','SHOP'].includes(raw.placement)
   ||!expected.has(raw.productId)
   ||!(raw.publicIp===null||typeof raw.publicIp==='string'&&raw.publicIp.length<=80))return null;
  const mismatch=expected.get(raw.productId)?.placement!==raw.placement;
  if(isolated){
   if(!Number.isSafeInteger(raw.sourceRow)||raw.sourceRow<2||raw.sourceRow>12000||sourceRows.has(raw.sourceRow)
    ||!Array.isArray(raw.reviewReasons)||new Set(raw.reviewReasons).size!==raw.reviewReasons.length
    ||raw.reviewReasons.some((reason:unknown)=>!TRACKER_CONNECTION_HOLDS.includes(reason as TrackerConnectionHold))
    ||mismatch!==raw.reviewReasons.includes('placement_mismatch'))return null;
   sourceRows.add(raw.sourceRow);
  }else if(mismatch||raw.reviewReasons!==undefined)return null;
  const row=raw as VerifiedTrackerIpRow;byProduct.set(raw.productId,row);
  // Held/Shop records still reserve their IP: ignoring them could give a
  // different Product ID false ownership of a shared endpoint.
  if(publicIp(row.publicIp))ipClaims.set(row.publicIp!,(ipClaims.get(row.publicIp!)||0)+1);
 }
 if(byProduct.size!==expected.size||[...expected.keys()].some(id=>!byProduct.has(id)))return null;
 const endpoints=new Map<string,SavedTcpEndpoint[]>();
 for(const device of devices){
  if(!object(device)||!deviceId(device.deviceId)||!Array.isArray(device.expectedPorts))return null;
  const ip=publicIp(device.publicIp);
  if(!ip)continue;
  const list=endpoints.get(ip)||[];list.push(device as SavedTcpEndpoint);endpoints.set(ip,list);
 }
 const items=products.filter(p=>p.placement==='FIELD').map(product=>{
  const pid=product.productId,row=byProduct.get(pid)!;
  if(row.reviewReasons?.length)return unknown(pid,'Current tracker and mHelp source disagree for this Product ID. Placement or identity review is required; no connection status is assigned.');
  if(product.uploadLifecycle!=='UNFLAGGED')return unknown(pid,'Inactive, Missing or Do Not Use source; no operational connection is claimed.');
  const binding=object(product.binding)?product.binding:null;
  if(binding?.state==='held'||binding?.placementHeld===true||Array.isArray(binding?.candidateUnitIds)&&binding.candidateUnitIds.length>0)
   return unknown(pid,'Equipment identity or placement is held for review.');
  const ip=publicIp(row.publicIp);
  if(!ip)return unknown(pid,'No verified public tracker IP is available for this Product ID.');
  if(ipClaims.get(ip)!==1)return unknown(pid,'Another Product ID claims this tracker IP; verify endpoint ownership.');
  const devicesForIp=endpoints.get(ip)||[];
  if(devicesForIp.length!==1)return unknown(pid,devicesForIp.length?'More than one saved endpoint claims this tracker IP; verify exact device ownership.':'No saved camera endpoint matches the current tracker IP.');
  const result=completedSavedTcpCheck(devicesForIp[0],now);
  if(!result)return unknown(pid,'No fresh, completed, exact-target TCP/service-port check is available.');
  if(!resourceMembership?.get(pid)?.includes(String(devicesForIp[0].deviceId)))return unknown(pid,'No current verified Product-to-resource membership is available for this saved endpoint.');
  return {productId:pid,...result};
 });
 if(items.length!==authority.field)return null;
 return {contract:EXACT_PRODUCT_CONNECTION_CONTRACT,sourceSha256:authority.sourceSha256,trackerVerifiedAt:safeTime(tracker.verifiedAt,now,SOURCE_FRESH_MS)!,items};
}

/** Browser-facing verification also rejects an incomplete/replayed census.
 * This is a presentation check, not a substitute for the protected server's
 * independently retrieved and authenticated tracker/endpoint sources.
 */
export function readExactProductConnections(value:unknown,sourceSha256:string,expectedFieldIds:readonly string[],now=Date.now()):Map<string,ExactProductConnection>|null{
 if(!object(value)||value.contract!==EXACT_PRODUCT_CONNECTION_CONTRACT||value.sourceSha256!==sourceSha256||!HASH.test(sourceSha256)
  ||!safeTime(value.trackerVerifiedAt,now,SOURCE_FRESH_MS)||!Array.isArray(value.items)||value.items.length<expectedFieldIds.length||value.items.length>10000)return null;
 const expected=new Set(expectedFieldIds);
 if(expected.size!==expectedFieldIds.length)return null;
 const result=new Map<string,ExactProductConnection>(),seen=new Set<string>();
 for(const raw of value.items){
  if(!object(raw)||!ID.test(raw.productId)||seen.has(raw.productId)
   ||!['online','offline','unknown'].includes(raw.status)||raw.basis!=='tcp_service_port'||typeof raw.reason!=='string'||raw.reason.length>300
   ||!(raw.resourceId===null||deviceId(raw.resourceId)===raw.resourceId))return null;
  if(raw.status==='unknown'&&(raw.resourceId!==null||raw.checkedAt!==null)||raw.status!=='unknown'&&(!raw.resourceId||!cameraTimestamp(raw.checkedAt,now).fresh))return null;
  // A later authenticated Shop move can narrow the Field view without
  // changing the upstream reviewed mHelp source digest. Never surface its
  // saved Field connection under Shop; do not require an identical subset.
  seen.add(raw.productId);
  if(expected.has(raw.productId))result.set(raw.productId,raw as ExactProductConnection);
 }
 return result.size===expected.size?result:null;
}

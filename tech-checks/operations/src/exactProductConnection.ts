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
export const EXACT_PRODUCT_CONNECTION_CONTRACT='COS_EXACT_PRODUCT_CONNECTIONS_V1' as const;
export const VERIFIED_TRACKER_IP_CONTRACT='COS_VERIFIED_2027_PRODUCT_IPS_V1' as const;
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
};
export type VerifiedTrackerIpCensus={
 contract:typeof VERIFIED_TRACKER_IP_CONTRACT;
 workbookId:typeof TRACKER_IP_WORKBOOK;
 expectedMhelpSourceSha256:string;
 verifiedAt:string;
 records:VerifiedTrackerIpRow[];
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
 if(!object(proof)||proof.ip!==ip||revision(proof.revision)!==rev||proof.status!=='online'&&proof.status!=='offline'||typeof proof.reachable!=='boolean'
  ||proof.error||proof.errorCode||proof.error_code)return null;
 const checkedAt=cameraTimestamp(proof.checkedAt,now).at;
 if(!checkedAt)return null;
 const observedPorts=Object.keys(device.portStatus).filter(k=>/^[1-9][0-9]{0,4}$/.test(k)&&Number(k)<=65535);
 if(observedPorts.length!==ports.length||ports.some(p=>!observedPorts.includes(String(p))))return null;
 const states=ports.map(port=>device.portStatus![String(port)]);
 if(states.some(v=>!object(v)||typeof v.online!=='boolean'||v.attempted===false||v.error||v.errorCode||v.error_code||v.technicalError))return null;
 const responded=states.some(v=>(v as Record<string,any>).online===true);
 if(responded&&proof.status==='online'&&proof.reachable===true)return {
  status:'online',basis:'tcp_service_port',checkedAt,resourceId:deviceId(device.deviceId),
  reason:'Completed saved TCP/service-port check responded. Camera video is not verified.'
 };
 if(!responded&&proof.status==='offline'&&proof.reachable===false)return {
  status:'offline',basis:'tcp_service_port',checkedAt,resourceId:deviceId(device.deviceId),
  reason:'Completed saved TCP/service-port check had no response on all configured ports. Camera video is not verified.'
 };
 return null;
}

/** Fail the WHOLE source envelope closed if one Product ID, placement, source
 * hash, or workbook identity is missing or different. The resulting statuses
 * are for existing products only, and never carry public IPs or credentials.
 */
export function buildExactProductConnections(
 acceptedMhelp:unknown,tracker:unknown,devices:readonly SavedTcpEndpoint[],now=Date.now()
):ExactProductConnectionEnvelope|null{
 const authority=readMhelpInventoryAuthority(acceptedMhelp,now);
 if(!authority||!object(tracker)||tracker.contract!==VERIFIED_TRACKER_IP_CONTRACT
  ||tracker.workbookId!==TRACKER_IP_WORKBOOK
  ||tracker.expectedMhelpSourceSha256!==authority.sourceSha256
  ||!HASH.test(tracker.expectedMhelpSourceSha256)
  ||!safeTime(tracker.verifiedAt,now,SOURCE_FRESH_MS)
  ||!Array.isArray(tracker.records)||tracker.records.length!==authority.total
  ||!Array.isArray(devices)||devices.length>10000)return null;
 const products=(acceptedMhelp as {records:Record<string,any>[]}).records;
 const expected=new Map(products.map(p=>[p.productId,p]));
 const byProduct=new Map<string,VerifiedTrackerIpRow>();
 const ipClaims=new Map<string,number>();
 for(const raw of tracker.records){
  if(!object(raw)||typeof raw.productId!=='string'||!ID.test(raw.productId)||byProduct.has(raw.productId)
   ||raw.recordId!=='mhelp_product:'+raw.productId||!['FIELD','SHOP'].includes(raw.placement)
   ||!expected.has(raw.productId)||expected.get(raw.productId)?.placement!==raw.placement
   ||!(raw.publicIp===null||typeof raw.publicIp==='string'&&raw.publicIp.length<=80))return null;
  const row=raw as VerifiedTrackerIpRow;byProduct.set(raw.productId,row);
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

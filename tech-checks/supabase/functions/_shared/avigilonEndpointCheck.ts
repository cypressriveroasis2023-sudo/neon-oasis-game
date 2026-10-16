import type {Actor,Endpoint,ProbeResult} from './avigilonCheckRun.ts';
export type PortResult={kind:'responded'|'nonresponse'|'checker_failure';latencyMs:number|null};
export type CurrentEndpoint=Endpoint&{enabled:boolean;active:boolean;restricted:boolean;consecutiveFailures:number;firstFailedAt:string|null};
export type Publication={p_device_id:string;p_revision:string;p_public_ip:string;p_expected_ports:number[];p_monitoring_profile:string;p_source:'manual_tcp_check';p_health:Record<string,unknown>};
export function allowedPublicIpv4(value:string){const host=value.replace(/\/32$/,''),parts=host.split('.');if(parts.length!==4||parts.some(p=>!/^(0|[1-9]\d{0,2})$/.test(p)||Number(p)>255))return null;const [a,b,c]=parts.map(Number);if(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||(b===0&&(c===0||c===2))))||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113))return null;return host;}
/** Only known endpoint outcomes are nonresponse. Resource exhaustion, permissions,
 * cancellation, invalid input and unknown runtime errors remain checker failures. */
export function tcpErrorKind(error:unknown):PortResult['kind']{return error instanceof Error&&['ConnectionRefused','TimedOut','EndpointTimeout'].includes(error.name)?'nonresponse':'checker_failure';}
export function createAvigilonEndpointCheck(d:{read:(actor:Actor,id:string)=>Promise<CurrentEndpoint>;tcp:(host:string,port:number,signal:AbortSignal)=>Promise<PortResult>;publish:(actor:Actor,publication:Publication)=>Promise<{ok:boolean}>;now?:()=>number}){
 const now=d.now||Date.now;
 return async(actor:Actor,endpoint:Endpoint,signal:AbortSignal):Promise<ProbeResult>=>{
  if(!actor.canCheck||signal.aborted)throw Error('checker_unavailable');
  const current=await d.read(actor,endpoint.deviceId),host=allowedPublicIpv4(endpoint.ip);
  if(!host||!current.enabled||!current.active||current.restricted||!['sniper','camv'].includes(endpoint.profile)||!endpoint.ports.length||endpoint.ports.length>32||endpoint.ports.some(p=>!Number.isInteger(p)||p<1||p>65535))throw Error('checker_unavailable');
  for(const k of ['deviceId','revision','ip','profile','ports'] as const)if(JSON.stringify(current[k])!==JSON.stringify(endpoint[k]))throw Error('endpoint_or_roster_changed');
  const ports=[...new Set(endpoint.ports)];
  const results=await Promise.all(ports.map(async port=>{try{return {port,result:await d.tcp(host,port,signal)};}catch{return {port,result:{kind:'checker_failure',latencyMs:null} as PortResult};}}));
  // Partial infrastructure failures cannot be represented by the existing RPC's
  // boolean-only port schema. Keep the run unknown; do not publish false ports.
  if(signal.aborted||results.some(x=>!['responded','nonresponse'].includes(x.result.kind)))throw Error('checker_unavailable');
  const online=results.some(x=>x.result.kind==='responded'),at=new Date(now()).toISOString(),failures=online?0:Math.min(3,current.consecutiveFailures+1);
  if(!Number.isInteger(current.consecutiveFailures)||current.consecutiveFailures<0)throw Error('checker_unavailable');
  const confirmed=!online&&failures>=3;
  const saved=await d.publish(actor,{p_device_id:endpoint.deviceId,p_revision:endpoint.revision,p_public_ip:endpoint.ip,p_expected_ports:endpoint.ports,p_monitoring_profile:endpoint.profile,p_source:'manual_tcp_check',p_health:{overall_status:online?'online':'offline',ip_reachable:online,port_status:Object.fromEntries(results.map(x=>[x.port,{online:x.result.kind==='responded',latency_ms:x.result.latencyMs}])),checked_at:at,consecutive_failures:failures,first_failed_at:online?null:current.firstFailedAt||at,confirmed_outage:confirmed,confirmation_reason:confirmed?'3+ consecutive failed health checks':null,detail:online?'Avigilon service port responded':'No approved Avigilon service port responded',...(online?{acknowledged_at:null,acknowledged_by:null,...(current.consecutiveFailures>0?{last_recovered_at:at}:{})}:{})}});
  if(saved.ok!==true)throw Error('endpoint_or_roster_changed');
  if(signal.aborted)throw Error('checker_unavailable');
  return {outcome:online?'online':'nonresponse',checkedAt:at,revision:endpoint.revision,confirmedOutage:confirmed};
 };
}

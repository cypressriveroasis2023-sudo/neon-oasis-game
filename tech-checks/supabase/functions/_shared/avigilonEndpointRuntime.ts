import {authorityToken} from './avigilonReadBoundary.ts';
import {allowedPublicIpv4,tcpErrorKind,type CurrentEndpoint,type PortResult} from './avigilonEndpointCheck.ts';
import type {Actor,Endpoint} from './avigilonCheckRun.ts';
const sameEndpoint=(a:Endpoint,b:Endpoint)=>['deviceId','revision','ip','profile','ports'].every(k=>JSON.stringify((a as any)?.[k])===JSON.stringify((b as any)?.[k]));
/** Read only admitted native authority. Legacy responses never seed a new check. */
export function currentAdmittedEndpoint(envelope:any,actor:Actor,deviceId:string):CurrentEndpoint{
 if(!actor?.canCheck||envelope?.contract!=='COS_AVIGILON_PUBLICATIONS_V1'||envelope.tenantId!==actor.tenantId)throw Error('Current endpoint unavailable');
 const token=authorityToken(envelope.authority,actor.tenantId),roster=envelope.roster;
 if(roster?.tenantId!==actor.tenantId||roster.revision!==token.rosterRevision||!Array.isArray(roster.units)||!Array.isArray(envelope.items))throw Error('Current endpoint unavailable');
 const owners=roster.units.filter((u:any)=>u.endpoint?.deviceId===deviceId);
 if(!/^\d+$/.test(deviceId)||new Set(roster.units.map((u:any)=>u.id)).size!==roster.units.length||owners.length!==1)throw Error('Endpoint ownership ambiguous');
 const unit=owners[0],endpoint=unit.endpoint;
 if(unit.placement!=='FIELD'||unit.restricted!==false||unit.identityVerified!==true||!unit.nativeUnitId||!endpoint||!/^\d+$/.test(endpoint.revision)||!allowedPublicIpv4(endpoint.ip)||!['sniper','camv'].includes(endpoint.profile)||!Array.isArray(endpoint.ports)||!endpoint.ports.length||endpoint.ports.length>32||endpoint.ports.some((p:any)=>!Number.isInteger(p)||p<1||p>65535)||new Set(endpoint.ports).size!==endpoint.ports.length)throw Error('Endpoint is not eligible Field inventory');
 if(roster.units.some((u:any)=>u!==unit&&u.endpoint&&allowedPublicIpv4(u.endpoint.ip)===allowedPublicIpv4(endpoint.ip)&&u.endpoint.ports?.some((p:number)=>endpoint.ports.includes(p))))throw Error('Endpoint ownership ambiguous');
 const items=envelope.items.filter((i:any)=>i.deviceId===deviceId);
 if(items.length!==1)throw Error('Current endpoint evidence unavailable');
 const item=items[0];
 if(!sameEndpoint(item.endpoint,endpoint)||item.placement!=='FIELD'||item.restricted!==false||(item.receipt===null)!==(item.health===null)||item.receipt===undefined||item.health===undefined)throw Error('Current endpoint evidence changed');
 let failures=0;
 if(item.receipt){const r=item.receipt,h=item.health;
  if(r.unitId!==unit.id||r.endpointRevision!==endpoint.revision||!/^[1-9]\d*$/.test(r.publicationReceipt)||!['online','nonresponse'].includes(r.outcome)||r.completedAt!==h.checked_at||!Number.isFinite(Date.parse(h.checked_at))||typeof h.ip_reachable!=='boolean'||!Number.isInteger(h.consecutive_failures)||h.consecutive_failures<0||h.consecutive_failures>3||r.confirmedOutage!==h.confirmed_outage||h.confirmed_outage!==(h.consecutive_failures>=3)||(r.outcome==='online')!==h.ip_reachable||(h.ip_reachable&&h.consecutive_failures!==0))throw Error('Current endpoint receipt invalid');
  failures=h.consecutive_failures;
 }
 // Native SQL owns failure accumulation and confirmation. It does not retain a
 // first_failed_at field; do not invent one from import or provider timestamps.
 return {...endpoint,enabled:true,active:true,restricted:false,consecutiveFailures:failures,firstFailedAt:null};
}
export type Socket={close:()=>void};
export type Connect=(options:{hostname:string;port:number;transport:'tcp'})=>Promise<Socket>;
/** Bounded TCP service reachability only. Late sockets always close, including
 * runtimes whose connect operation cannot itself be aborted. No video claim. */
export function createBoundedAvigilonTcp(connect:Connect,timeoutMs=1400,now=Date.now){
 if(typeof connect!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error('Reviewed TCP adapter required');
 return (host:string,port:number,signal:AbortSignal):Promise<PortResult>=>new Promise(resolve=>{
  if(signal.aborted||!allowedPublicIpv4(host)||!Number.isInteger(port)||port<1||port>65535){resolve({kind:'checker_failure',latencyMs:null});return;}
  const started=now();let done=false;let timer:ReturnType<typeof setTimeout>;
  const finish=(kind:PortResult['kind'])=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);resolve({kind,latencyMs:kind==='responded'?Math.max(0,now()-started):null});};
  const abort=()=>finish('checker_failure');signal.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>finish('nonresponse'),timeoutMs);
  if(signal.aborted){abort();return;}
  Promise.resolve().then(()=>{if(done)return null;return connect({hostname:host.replace(/\/32$/,''),port,transport:'tcp'});}).then(socket=>{if(!socket||typeof socket.close!=='function'){finish('checker_failure');return;}try{socket.close();}catch{finish('checker_failure');return;}finish('responded');},error=>finish(signal.aborted?'checker_failure':tcpErrorKind(error)));
 });
}

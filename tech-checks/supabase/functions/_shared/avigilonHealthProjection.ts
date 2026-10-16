import {authorityToken,validateReceiptMembership} from './avigilonReadBoundary.ts';
/** Shared summary input for Fleet, Camera Health, details and CSV. Native receipt
 * is authoritative; legacy health is not a fallback for managed endpoints. */
export function projectAvigilonHealth(summary:any,envelope:any,tenantId:string,devices?:any[]){
 if(envelope?.contract!=='COS_AVIGILON_PUBLICATIONS_V1'||envelope.tenantId!==tenantId||!Array.isArray(envelope.items))throw Error('Current Avigilon health unavailable');
 const token=authorityToken(envelope.authority,tenantId);
 const ids=envelope.items.map((i:any)=>i.deviceId);
 if(ids.some((id:any)=>typeof id!=='string'||!/^\d+$/.test(id))||new Set(ids).size!==ids.length)throw Error('Ambiguous Avigilon publication identities');
 const items=new Map<string,any>(envelope.items.map((i:any)=>[i.deviceId,i]));
 const rows=summary.rows.map((row:any)=>{
  const direct=['sniper','sniper es','sniper 2','sniper 2 sa','sniper 4','radar - sniper','thermal - sniper','camv','cam-v'].includes(String(row.type).toLowerCase());
  const item=items.get(String(row.id))||(direct?{receipt:null,health:null,endpoint:null}:null);if(!item)return row;
  const {receipt,health,endpoint}=item;
  if(receipt===undefined||health===undefined||(receipt===null)!==(health===null))throw Error('Incomplete Avigilon receipt');
  if(receipt&&(typeof receipt.publicationReceipt!=='string'||!/^\d+$/.test(receipt.publicationReceipt)||receipt.endpointRevision!==endpoint?.revision||receipt.completedAt!==health.checked_at||!['online','nonresponse'].includes(receipt.outcome)||typeof health.ip_reachable!=='boolean'||receipt.confirmedOutage!==health.confirmed_outage||!Number.isInteger(health.consecutive_failures)||health.consecutive_failures<0||health.consecutive_failures>3||receipt.confirmedOutage!==(health.consecutive_failures>=3)|| (receipt.outcome==='online')!==health.ip_reachable))throw Error('Invalid Avigilon receipt');
  const owner=receipt?validateReceiptMembership(summary,envelope,item):null;
  // IP is compared, never used as an identity join. Existing connection, provider,
  // activation and inventory placement remain independent and unchanged.
  const device=devices?.filter(d=>String(d.id)===String(row.id));
  const revisionMatches=!devices||device?.length===1&&String(device[0].connection_revision)===endpoint?.revision;
  const matches=revisionMatches&&endpoint?.deviceId===String(row.id)&&row.connection?.publicIp===endpoint.ip&&JSON.stringify(row.connection?.ports)===JSON.stringify(endpoint.ports);
  const current=receipt&&matches&&item.placement==='FIELD'&&item.restricted===false&&row.scope!=='shop'&&row.scope!=='inactive';
  const evidence={kind:'service_port',source:'Avigilon native publication',resource:'service',active:Boolean(current),status:current?health.ip_reachable?'online':'offline':'unknown',observedAt:current?health.checked_at:null,lastOnlineAt:null,reachable:current?health.ip_reachable:null,confirmedOutage:current?health.confirmed_outage:false,consecutiveFailures:current?health.consecutive_failures:null};
  return {...row,serviceEvidence:evidence,...(row.evidence?.kind==='service_port'?{evidence}:{}),...(row.evidence?.kind!=='provider'?{checkedAt:evidence.observedAt}:{}),avigilonPublication:current?{receiptId:receipt.publicationReceipt,unitId:owner.nativeUnitId,rosterUnitId:receipt.unitId,endpointRevision:receipt.endpointRevision}:null};
 });
 return {...summary,rows,avigilonAuthority:token};
}
